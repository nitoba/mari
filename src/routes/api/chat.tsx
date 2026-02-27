import { createFileRoute } from '@tanstack/react-router'
import { createUIMessageStream, createUIMessageStreamResponse } from 'ai'
import type { UIMessage } from 'ai'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import type { AssistantMessageEvent } from '@mariozechner/pi-ai'
import type { PiModelSelection } from '@/lib/pi-agent/runtime'
import { buildAgrotraceCoordinatorPrompt } from '@/lib/pi-agent/agrotrace-router'
import {
  PI_THINKING_LEVELS,
  createStatelessAgentSession,
} from '@/lib/pi-agent/runtime'
import {
  findCachedTurnByRequestId,
  getOrCreateDbSession,
} from '@/lib/chat/persistence'
import { acquireDbSessionLock, releaseDbSessionLock } from '@/lib/chat/lock'
import { loadContextForAgent } from '@/lib/chat/context'
import { appendTurn } from '@/lib/chat/turn'
import { maybeSummarizeSession } from '@/lib/chat/summarize'

type ChatRequestBody = {
  sessionId?: string // ✅ agora a sessão vem do client
  requestId?: string
  messages?: Array<UIMessage>
  model?: {
    provider?: string
    modelId?: string
    thinkingLevel?: string
  }
}

type StreamFinishReason = 'stop' | 'length' | 'tool-calls' | 'error' | 'other'

type ToolCallInfo = {
  toolCallId: string
  toolName: string
}

type TurnEndEvent = {
  type: 'turn_end'
  message?: unknown
  toolResults?: unknown[]
}

type StreamState = {
  finishReason: StreamFinishReason
  openSteps: number
  textPartIds: Map<number, string>
  reasoningPartIds: Map<number, string>
  toolCallInfoByContentIndex: Map<number, ToolCallInfo>
  toolNamesByCallId: Map<string, string>
  toolInputsByCallId: Map<string, Record<string, unknown>>
  startedToolCalls: Set<string>
  availableToolCalls: Set<string>
}

type UIStreamWriteEvent =
  | { type: 'start' }
  | { type: 'start-step' }
  | { type: 'finish-step' }
  | { type: 'finish'; finishReason: StreamFinishReason }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | {
      type: 'tool-input-available'
      toolCallId: string
      toolName: string
      input: Record<string, unknown>
    }
  | { type: 'tool-input-delta'; toolCallId: string; inputTextDelta: string }
  | {
      type: 'tool-output-available'
      toolCallId: string
      output: Record<string, unknown>
    }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string }
  | { type: 'error'; errorText: string }
  | { type: 'abort'; reason: string }

const VALID_THINKING_LEVELS = new Set(PI_THINKING_LEVELS)

type UIMessageStreamWriter = Parameters<
  Parameters<typeof createUIMessageStream>[0]['execute']
>[0]['writer']

const getMessageText = (message: UIMessage): string =>
  message.parts
    .filter(
      (part): part is Extract<typeof part, { type: 'text' }> =>
        part.type === 'text',
    )
    .map((part) => part.text)
    .join('')
    .trim()

const createChunkId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getUnknownErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unexpected pi agent error.'
}

const parseRequestedModelSelection = (
  body: ChatRequestBody,
): PiModelSelection | undefined => {
  const requestedModel = body.model
  if (!requestedModel) return undefined

  const normalizedProvider = requestedModel.provider?.trim()
  const normalizedModelId = requestedModel.modelId?.trim()
  const normalizedThinkingLevel = requestedModel.thinkingLevel?.trim()

  const thinkingLevel =
    normalizedThinkingLevel &&
    VALID_THINKING_LEVELS.has(
      normalizedThinkingLevel as (typeof PI_THINKING_LEVELS)[number],
    )
      ? (normalizedThinkingLevel as (typeof PI_THINKING_LEVELS)[number])
      : undefined

  if (!normalizedProvider && !normalizedModelId && !thinkingLevel) {
    return undefined
  }

  return {
    provider: normalizedProvider || undefined,
    modelId: normalizedModelId || undefined,
    thinkingLevel,
  }
}

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value
  return { value }
}

const toToolInput = (value: unknown): Record<string, unknown> => {
  if (isRecord(value)) return value
  if (value === undefined) return {}
  return { value }
}

const extractToolContentText = (value: unknown): string | null => {
  if (!Array.isArray(value)) return null

  const text = value
    .map((part) => {
      if (!isRecord(part)) return null
      if (part.type !== 'text') return null
      if (typeof part.text !== 'string') return null
      return part.text
    })
    .filter((part): part is string => part !== null)
    .join('\n')
    .trim()

  return text || null
}

const toToolOutput = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return { value }

  const details = value.details
  const serializedDetails =
    details === undefined ? undefined : toObjectRecord(details)
  const contentText = extractToolContentText(value.content)

  if (serializedDetails && contentText) {
    return {
      ...serializedDetails,
      content: contentText,
    }
  }

  if (serializedDetails) {
    return serializedDetails
  }

  if (contentText) {
    return { content: contentText }
  }

  return value
}

const getToolErrorText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message

  if (isRecord(value)) {
    if (typeof value.error === 'string') return value.error
    if (typeof value.message === 'string') return value.message

    const contentText = extractToolContentText(value.content)
    if (contentText) return contentText
  }

  return 'Tool execution failed.'
}

const mapStopReasonToFinishReason = (
  reason: 'stop' | 'length' | 'toolUse' | 'aborted' | 'error' | undefined,
): StreamFinishReason => {
  if (reason === 'stop') return 'stop'
  if (reason === 'length') return 'length'
  if (reason === 'toolUse') return 'tool-calls'
  if (reason === 'aborted' || reason === 'error') return 'error'
  return 'other'
}

const getToolCallFromPartial = (
  assistantMessageEvent: Extract<
    AssistantMessageEvent,
    { type: 'toolcall_start' | 'toolcall_delta' }
  >,
): ToolCallInfo | null => {
  const contentPart =
    assistantMessageEvent.partial.content[assistantMessageEvent.contentIndex]

  if (contentPart.type !== 'toolCall') {
    return null
  }

  return {
    toolCallId: contentPart.id,
    toolName: contentPart.name,
  }
}

const ensureTextPartStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  contentIndex: number,
): string => {
  const existingId = state.textPartIds.get(contentIndex)
  if (existingId) return existingId

  const textPartId = createChunkId(`text-${contentIndex}`)
  state.textPartIds.set(contentIndex, textPartId)
  writer.write({ type: 'text-start', id: textPartId })
  return textPartId
}

const ensureReasoningPartStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  contentIndex: number,
): string => {
  const existingId = state.reasoningPartIds.get(contentIndex)
  if (existingId) return existingId

  const reasoningPartId = createChunkId(`reasoning-${contentIndex}`)
  state.reasoningPartIds.set(contentIndex, reasoningPartId)
  writer.write({ type: 'reasoning-start', id: reasoningPartId })
  return reasoningPartId
}

const ensureToolInputStarted = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  toolCallId: string,
  toolName: string,
): void => {
  if (state.startedToolCalls.has(toolCallId)) return

  state.startedToolCalls.add(toolCallId)
  writer.write({
    type: 'tool-input-start',
    toolCallId,
    toolName,
  })
}

const ensureToolInputAvailable = (
  state: StreamState,
  writer: UIMessageStreamWriter,
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): void => {
  if (state.availableToolCalls.has(toolCallId)) return

  state.availableToolCalls.add(toolCallId)
  writer.write({
    type: 'tool-input-available',
    toolCallId,
    toolName,
    input,
  })
}

const createInitialStreamState = (): StreamState => ({
  finishReason: 'stop',
  openSteps: 0,
  textPartIds: new Map<number, string>(),
  reasoningPartIds: new Map<number, string>(),
  toolCallInfoByContentIndex: new Map<number, ToolCallInfo>(),
  toolNamesByCallId: new Map<string, string>(),
  toolInputsByCallId: new Map<string, Record<string, unknown>>(),
  startedToolCalls: new Set<string>(),
  availableToolCalls: new Set<string>(),
})

/**
 * Tap para gravar exatamente o que foi emitido (replay idêntico no cached)
 */
const writerTap = (
  writer: UIMessageStreamWriter,
  sink: Array<UIStreamWriteEvent>,
) => ({
  write: (evt: UIStreamWriteEvent) => {
    sink.push(evt)
    writer.write(evt as any)
  },
})

const handleAssistantMessageEvent = (
  state: StreamState,
  writer: { write: (evt: UIStreamWriteEvent) => void },
  assistantMessageEvent: AssistantMessageEvent,
): void => {
  switch (assistantMessageEvent.type) {
    case 'start':
      return

    case 'text_start': {
      const existingId = state.textPartIds.get(
        assistantMessageEvent.contentIndex,
      )
      const textPartId =
        existingId ??
        createChunkId(`text-${assistantMessageEvent.contentIndex}`)
      if (!existingId) {
        state.textPartIds.set(assistantMessageEvent.contentIndex, textPartId)
        writer.write({ type: 'text-start', id: textPartId })
      }
      return
    }

    case 'text_delta': {
      const textPartId = ensureTextPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({
        type: 'text-delta',
        id: textPartId,
        delta: assistantMessageEvent.delta,
      })
      return
    }

    case 'text_end': {
      const textPartId = ensureTextPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({ type: 'text-end', id: textPartId })
      state.textPartIds.delete(assistantMessageEvent.contentIndex)
      return
    }

    case 'thinking_start': {
      const existingId = state.reasoningPartIds.get(
        assistantMessageEvent.contentIndex,
      )
      const reasoningPartId =
        existingId ??
        createChunkId(`reasoning-${assistantMessageEvent.contentIndex}`)
      if (!existingId) {
        state.reasoningPartIds.set(
          assistantMessageEvent.contentIndex,
          reasoningPartId,
        )
        writer.write({ type: 'reasoning-start', id: reasoningPartId })
      }
      return
    }

    case 'thinking_delta': {
      const reasoningPartId = ensureReasoningPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({
        type: 'reasoning-delta',
        id: reasoningPartId,
        delta: assistantMessageEvent.delta,
      })
      return
    }

    case 'thinking_end': {
      const reasoningPartId = ensureReasoningPartStarted(
        state,
        writer as any,
        assistantMessageEvent.contentIndex,
      )
      writer.write({ type: 'reasoning-end', id: reasoningPartId })
      state.reasoningPartIds.delete(assistantMessageEvent.contentIndex)
      return
    }

    case 'toolcall_start': {
      const toolCallInfo = getToolCallFromPartial(assistantMessageEvent) ?? {
        toolCallId: createChunkId(`tool-${assistantMessageEvent.contentIndex}`),
        toolName: 'tool',
      }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      return
    }

    case 'toolcall_delta': {
      const toolCallInfo = state.toolCallInfoByContentIndex.get(
        assistantMessageEvent.contentIndex,
      ) ??
        getToolCallFromPartial(assistantMessageEvent) ?? {
          toolCallId: createChunkId(
            `tool-${assistantMessageEvent.contentIndex}`,
          ),
          toolName: 'tool',
        }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )

      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )

      writer.write({
        type: 'tool-input-delta',
        toolCallId: toolCallInfo.toolCallId,
        inputTextDelta: assistantMessageEvent.delta,
      })
      return
    }

    case 'toolcall_end': {
      const toolInput = toToolInput(assistantMessageEvent.toolCall.arguments)
      const toolCallInfo: ToolCallInfo = {
        toolCallId: assistantMessageEvent.toolCall.id,
        toolName: assistantMessageEvent.toolCall.name,
      }

      state.toolCallInfoByContentIndex.set(
        assistantMessageEvent.contentIndex,
        toolCallInfo,
      )
      state.toolNamesByCallId.set(
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      state.toolInputsByCallId.set(toolCallInfo.toolCallId, toolInput)

      ensureToolInputStarted(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
      )
      ensureToolInputAvailable(
        state,
        writer as any,
        toolCallInfo.toolCallId,
        toolCallInfo.toolName,
        toolInput,
      )
      return
    }

    case 'done': {
      state.finishReason = mapStopReasonToFinishReason(
        assistantMessageEvent.reason,
      )
      return
    }

    case 'error': {
      state.finishReason = mapStopReasonToFinishReason(
        assistantMessageEvent.reason,
      )
      writer.write({
        type: 'error',
        errorText:
          assistantMessageEvent.error.errorMessage ?? 'Assistant error.',
      })
      return
    }
  }
}

const handleSessionEvent = (
  state: StreamState,
  writer: { write: (evt: UIStreamWriteEvent) => void },
  event: AgentSessionEvent,
): void => {
  switch (event.type) {
    case 'turn_start': {
      state.textPartIds.clear()
      state.reasoningPartIds.clear()
      state.toolCallInfoByContentIndex.clear()
      state.startedToolCalls.clear()
      state.availableToolCalls.clear()
      state.toolNamesByCallId.clear()
      state.toolInputsByCallId.clear()
      writer.write({ type: 'start-step' })
      state.openSteps += 1
      return
    }

    case 'turn_end': {
      if (state.openSteps > 0) {
        writer.write({ type: 'finish-step' })
        state.openSteps -= 1
      }
      state.textPartIds.clear()
      state.reasoningPartIds.clear()
      state.toolCallInfoByContentIndex.clear()
      state.startedToolCalls.clear()
      state.availableToolCalls.clear()
      state.toolNamesByCallId.clear()
      state.toolInputsByCallId.clear()
      return
    }

    case 'message_update': {
      handleAssistantMessageEvent(state, writer, event.assistantMessageEvent)
      return
    }

    case 'tool_execution_start': {
      const toolInput = toToolInput(event.args)
      const toolName =
        state.toolNamesByCallId.get(event.toolCallId) ?? event.toolName

      state.toolNamesByCallId.set(event.toolCallId, toolName)
      state.toolInputsByCallId.set(event.toolCallId, toolInput)

      ensureToolInputStarted(state, writer as any, event.toolCallId, toolName)
      ensureToolInputAvailable(
        state,
        writer as any,
        event.toolCallId,
        toolName,
        toolInput,
      )
      return
    }

    case 'tool_execution_end': {
      const toolName =
        state.toolNamesByCallId.get(event.toolCallId) ?? event.toolName
      const toolInput = state.toolInputsByCallId.get(event.toolCallId) ?? {}

      ensureToolInputStarted(state, writer as any, event.toolCallId, toolName)
      ensureToolInputAvailable(
        state,
        writer as any,
        event.toolCallId,
        toolName,
        toolInput,
      )

      if (event.isError) {
        state.finishReason = 'error'
        writer.write({
          type: 'tool-output-error',
          toolCallId: event.toolCallId,
          errorText: getToolErrorText(event.result),
        })
        return
      }

      writer.write({
        type: 'tool-output-available',
        toolCallId: event.toolCallId,
        output: toToolOutput(event.result),
      })
      return
    }
  }
}

/**
 * Plugue sua auth aqui. Usei header pra facilitar.
 */
const getUserId = (request: Request): string => {
  const headerUser = request.headers.get('x-user-id')
  if (headerUser && headerUser.trim()) return headerUser.trim()
  return '1'
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as ChatRequestBody
        const messages = Array.isArray(body.messages) ? body.messages : []
        const requestedModelSelection = parseRequestedModelSelection(body)

        const sessionId =
          typeof body.sessionId === 'string' && body.sessionId.trim()
            ? body.sessionId.trim()
            : ''

        const requestId =
          typeof body.requestId === 'string' && body.requestId.trim()
            ? body.requestId.trim()
            : ''

        const userId = getUserId(request)

        if (!requestId) {
          return new Response(JSON.stringify({ error: 'Missing requestId' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }

        const { id: dbSessionId } = await getOrCreateDbSession(
          userId,
          sessionId,
        )

        const lastUserMessage = [...messages]
          .reverse()
          .find((message) => message.role === 'user')

        const userText = lastUserMessage ? getMessageText(lastUserMessage) : ''

        // Idempotência (cached)
        const cached = await findCachedTurnByRequestId(
          userId,
          dbSessionId,
          requestId,
        )

        if (cached && cached.length > 0) {
          const stream = createUIMessageStream({
            execute: async ({ writer }) => {
              writer.write({ type: 'start' })
              writer.write({ type: 'start-step' })

              // 1) tool outputs a partir das mensagens toolResult
              const toolResults = cached.filter((m) => m.role === 'toolResult')
              for (const tr of toolResults) {
                const msg = tr.content as any
                const toolCallId =
                  msg.toolCallId ?? msg.toolCall?.id ?? `tool-${tr.seq}`
                const toolName = msg.toolName ?? msg.toolCall?.name ?? 'tool'

                // output (ou erro)
                if (msg.isError) {
                  writer.write({
                    type: 'tool-output-error',
                    toolCallId,
                    errorText: getToolErrorText(msg),
                  })
                } else {
                  writer.write({
                    type: 'tool-output-available',
                    toolCallId,
                    output: toToolOutput(msg),
                  })
                }
              }

              // 2) texto do assistente (mensagem final)
              const assistantRow = cached.find((m) => m.role === 'assistant')
              const assistantMsg = assistantRow?.content as any

              // Extrai texto do content[] (blocos type:'text')
              const text = Array.isArray(assistantMsg?.content)
                ? assistantMsg.content
                    .filter(
                      (p: any) =>
                        p?.type === 'text' && typeof p.text === 'string',
                    )
                    .map((p: any) => p.text)
                    .join('')
                    .trim()
                : ''

              if (text) {
                const id = createChunkId('text-cached')
                writer.write({ type: 'text-start', id })
                writer.write({ type: 'text-delta', id, delta: text })
                writer.write({ type: 'text-end', id })
              }

              writer.write({ type: 'finish-step' })
              writer.write({ type: 'finish', finishReason: 'stop' })
            },
          })

          return createUIMessageStreamResponse({ stream })
        }

        // lock por sessão (evita prompts simultâneos)
        const lockToken = `req:${requestId}`
        const ttlMs = 120_000
        const locked = await acquireDbSessionLock({
          userId,
          sessionId: dbSessionId,
          lockToken,
          ttlMs,
        })

        if (!locked) {
          const stream = createUIMessageStream({
            execute: async ({ writer }) => {
              writer.write({ type: 'start' })
              writer.write({ type: 'error', errorText: 'SESSION_BUSY' })
              writer.write({ type: 'finish', finishReason: 'error' })
            },
          })
          return createUIMessageStreamResponse({ stream })
        }

        // cria sessão stateless e rehidrata contexto do DB (summary + tail)
        const session = await createStatelessAgentSession(
          requestedModelSelection,
        )
        const contextMessages = await loadContextForAgent({
          userId,
          sessionId: dbSessionId,
          tailLimit: 80,
        })
        session.agent.replaceMessages(contextMessages.messages)

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

              // Persistência: turno + replay idêntico
              try {
                await appendTurn({
                  userId,
                  sessionId: dbSessionId,
                  requestId,
                  userText,
                  assistantMessage:
                    ((lastTurnEnd as unknown as TurnEndEvent)
                      ?.message as any) ?? null,
                  toolResults: Array.isArray(
                    (lastTurnEnd as unknown as TurnEndEvent)?.toolResults,
                  )
                    ? ((lastTurnEnd as unknown as TurnEndEvent)!
                        .toolResults as any[])
                    : [],
                })

                // Summary (opcional)
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
