import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { TurnEndEvent, UIStreamWriteEvent } from '@/lib/chat/types'
import { buildAgrotraceCoordinatorPrompt } from '@/lib/pi-agent/agrotrace-router'
import {
  findCachedTurnByRequestId,
  getOrCreateDbSession,
} from '@/lib/chat/persistence'
import { acquireDbSessionLock, releaseDbSessionLock } from '@/lib/chat/lock'
import { appendTurn } from '@/lib/chat/turn'
import { maybeSummarizeSession } from '@/lib/chat/summarize'
import { getMessageText, parseChatRequest } from '@/lib/chat/request'
import {
  createInitialStreamState,
  getUnknownErrorMessage,
  handleSessionEvent,
  writerTap,
} from '@/lib/chat/stream-utils'
import {
  createBusyResponseStream,
  createCachedResponseStream,
} from '@/lib/chat/cached'
import { setupAgentSession } from '@/lib/chat/session'
import { auth } from '@/lib/auth'

const LOCK_TTL_MS = 120_000

async function getUserId(request: Request): Promise<number> {
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session) {
    throw new Error('Unauthorized')
  }

  return session.user.id
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = await parseChatRequest(request)

        if ('error' in parsed) {
          return new Response(JSON.stringify({ error: parsed.error }), {
            status: parsed.status,
            headers: { 'content-type': 'application/json' },
          })
        }

        const { sessionId, requestId, messages, modelSelection } = parsed

        const userId = await getUserId(request)

        const { id: dbSessionId } = await getOrCreateDbSession(
          userId,
          sessionId,
        )

        const lastUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === 'user')

        const userText = lastUserMessage ? getMessageText(lastUserMessage) : ''

        const cached = await findCachedTurnByRequestId(
          userId,
          dbSessionId,
          requestId,
        )

        if (cached && cached.length > 0) {
          const stream = createCachedResponseStream(cached)
          return createUIMessageStreamResponse({ stream })
        }

        const lockToken = `req:${requestId}`
        const locked = await acquireDbSessionLock({
          userId,
          sessionId: dbSessionId,
          lockToken,
          ttlMs: LOCK_TTL_MS,
        })

        if (!locked) {
          const stream = createBusyResponseStream()
          return createUIMessageStreamResponse({ stream })
        }

        const { session } = await setupAgentSession(
          modelSelection,
          userId,
          dbSessionId,
        )

        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            const streamState = createInitialStreamState()
            const streamEvents: Array<UIStreamWriteEvent> = []
            const tapped = writerTap(writer, streamEvents)

            let lastTurnEnd: TurnEndEvent | null = null

            const unsubscribe = session.subscribe(
              (event: AgentSessionEvent) => {
                handleSessionEvent(streamState, tapped, event)

                if (event.type === 'turn_end') {
                  lastTurnEnd = event as unknown as TurnEndEvent
                }
              },
            )

            const abortListener = () => {
              void session.abort()
            }

            request.signal.addEventListener('abort', abortListener)

            tapped.write({ type: 'start' })

            try {
              if (!userText) {
                streamState.finishReason = 'error'
                tapped.write({
                  type: 'error',
                  errorText: 'Mensagem vazia. Envie um texto para continuar.',
                })
              } else {
                const coordinatorPrompt =
                  buildAgrotraceCoordinatorPrompt(userText)
                await session.prompt(coordinatorPrompt)
              }
            } catch (error) {
              if (request.signal.aborted) {
                streamState.finishReason = 'error'
                tapped.write({
                  type: 'abort',
                  reason: 'Client aborted request.',
                })
              } else {
                streamState.finishReason = 'error'
                tapped.write({
                  type: 'error',
                  errorText: getUnknownErrorMessage(error),
                })
              }
            } finally {
              request.signal.removeEventListener('abort', abortListener)
              unsubscribe()

              while (streamState.openSteps > 0) {
                tapped.write({ type: 'finish-step' })
                streamState.openSteps -= 1
              }

              tapped.write({
                type: 'finish',
                finishReason: streamState.finishReason,
              })

              try {
                await appendTurn({
                  userId,
                  sessionId: dbSessionId,
                  requestId,
                  userText,
                  assistantMessage:
                    ((lastTurnEnd as unknown as TurnEndEvent).message as any) ??
                    null,
                  toolResults: Array.isArray(
                    (lastTurnEnd as unknown as TurnEndEvent).toolResults,
                  )
                    ? ((lastTurnEnd as unknown as TurnEndEvent)
                        .toolResults as Array<any>)
                    : [],
                })

                await maybeSummarizeSession({
                  userId,
                  sessionId: dbSessionId,
                  tailKeep: 80,
                  buffer: 40,
                })
              } finally {
                await releaseDbSessionLock({
                  userId,
                  sessionId: dbSessionId,
                  lockToken,
                })
              }
            }
          },
        })

        return createUIMessageStreamResponse({ stream })
      },
    },
  },
})
