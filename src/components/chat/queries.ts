import { randomUUID } from 'node:crypto'
import { queryOptions } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { ChatConversationSummary } from './types'

import { db } from '@/lib/db/db'
import { chatMessages, chatSessions } from '@/lib/db/schema/chat'
import { auth } from '@/lib/auth'

type ChatMessage = {
  id: string
  role: 'system' | 'user' | 'assistant'
  parts: Array<{
    type: 'text'
    text: string
  }>
}

const DEFAULT_CONVERSATION_TITLE = 'New chat'

const chatBaseQueryKey = ['chat'] as const

export const chatQueryKeys = {
  all: chatBaseQueryKey,
  conversations: () => [...chatBaseQueryKey, 'conversations'] as const,
  conversationMessages: (conversationId: string) =>
    [...chatBaseQueryKey, 'conversations', conversationId, 'messages'] as const,
}

/**
 * ⚠️ Troque por sua auth real.
 * TanStack Start permite ter contexto do request no serverFn dependendo do setup.
 * Se você já tem um helper `getUser()` no server, use ele aqui.
 */
async function getUserIdOrThrow(): Promise<number> {
  const headers = getRequestHeaders()
  const session = await auth.api.getSession({ headers })
  if (!session) {
    throw new Error('Unauthorized')
  }
  return session.user.id as unknown as number
}

/**
 * Seu chatMessages.content armazena AgentMessage do Pi:
 * { role: 'user'|'assistant'|'toolResult', content: Array<{type:'text', text:string} | ...> }
 */
function extractTextFromPiAgentMessage(agentMessage: unknown): string {
  if (!agentMessage || typeof agentMessage !== 'object') return ''
  const msg = agentMessage as any
  const blocks = msg?.content
  if (!Array.isArray(blocks)) return ''

  return blocks
    .map((b: any) =>
      b?.type === 'text' && typeof b.text === 'string' ? b.text : '',
    )
    .join('')
    .trim()
}

function toUiTextMessage(
  id: string,
  role: ChatMessage['role'],
  text: string,
): ChatMessage {
  return { id, role, parts: [{ type: 'text', text }] }
}

/**
 * Decide o que mostrar no UI:
 * - user: ok
 * - assistant: ok
 * - toolResult: por padrão não vira "mensagem" no chat (ele aparece no stream durante a execução)
 */
function mapDbRowsToChatMessages(
  rows: Array<{
    id: string
    role: string
    content: unknown
  }>,
): Array<ChatMessage> {
  const out: Array<ChatMessage> = []

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!row || row.role === 'toolResult') continue

    const text = extractTextFromPiAgentMessage(row.content)
    const uiRole: ChatMessage['role'] =
      row.role === 'user' ? 'user' : 'assistant'
    out.push(toUiTextMessage(row.id, uiRole, text))
  }

  return out
}

/**
 * Preview: última mensagem visível (user/assistant).
 */
async function getConversationPreview(
  userId: number,
  sessionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      content: chatMessages.content,
      role: chatMessages.role,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.sessionId, sessionId),
        sql`${chatMessages.role} <> 'toolResult'`,
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(1)

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (row === null) return null

  const text = extractTextFromPiAgentMessage(row.content)
  return text || null
}

/**
 * Count: quantas mensagens visíveis (user/assistant).
 */
async function getVisibleMessageCount(
  userId: number,
  sessionId: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.sessionId, sessionId),
        sql`${chatMessages.role} <> 'toolResult'`,
      ),
    )

  if (rows.length === 0) return 0
  return Number(rows[0].count)
}

/**
 * ---------- Server Fns ----------
 */

const getConversationsServerFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const userId = await getUserIdOrThrow()

    // lista sessões do usuário (ordenado por updatedAt)
    const sessions = await db
      .select({
        id: chatSessions.id,
        title: chatSessions.title,
        updatedAt: chatSessions.updatedAt,
      })
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(100)

    // N+1 simples (ok no começo). Se crescer, otimizamos com join/subquery.
    const summaries: Array<ChatConversationSummary> = []
    for (const s of sessions) {
      const preview = await getConversationPreview(userId, s.id)
      const messageCount = await getVisibleMessageCount(userId, s.id)

      summaries.push({
        id: s.id,
        title: s.title ?? DEFAULT_CONVERSATION_TITLE,
        updatedAt: new Date(s.updatedAt).getTime(),
        preview,
        messageCount,
      })
    }

    return summaries
  },
)

const getConversationMessagesInput = z.object({
  conversationId: z.string(), // aqui é chatSessions.id
})

const getConversationMessagesServerFn = createServerFn({ method: 'GET' })
  .inputValidator(getConversationMessagesInput)
  .handler(async ({ data }) => {
    const userId = await getUserIdOrThrow()
    const sessionId = data.conversationId

    const sessionExists = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)),
      )
      .limit(1)
      .then((rows) => rows.at(0))

    if (!sessionExists) throw new Error('Conversation not found')

    // mensagens (inclui toolResult, mas filtramos no map)
    const rows = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        seq: chatMessages.seq,
      })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId),
        ),
      )
      .orderBy(asc(chatMessages.seq))
      .limit(500)

    return mapDbRowsToChatMessages(rows)
  })

const createConversationInput = z.object({
  title: z.string().trim().min(1).max(80).optional(),
})

const createConversationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(createConversationInput)
  .handler(async ({ data }) => {
    const userId = await getUserIdOrThrow()
    const now = new Date()
    const sessionId = randomUUID()

    await db.insert(chatSessions).values({
      id: sessionId,
      userId,
      title: data.title ?? DEFAULT_CONVERSATION_TITLE,
      createdAt: now,
      updatedAt: now,
      nextSeq: 0,
      meta: null,
      lockToken: null,
      lockUntil: null,
      summarySeq: -1,
    })

    const created: ChatConversationSummary = {
      id: sessionId,
      title: data.title ?? DEFAULT_CONVERSATION_TITLE,
      updatedAt: now.getTime(),
      preview: null,
      messageCount: 0,
    }

    return created
  })

const renameConversationInput = z.object({
  conversationId: z.string(),
  title: z.string().trim().min(1).max(80),
})

const renameConversationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(renameConversationInput)
  .handler(async ({ data }) => {
    const userId = await getUserIdOrThrow()
    const now = new Date()

    const existing = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, data.conversationId),
          eq(chatSessions.userId, userId),
        ),
      )
      .limit(1)

    if (existing.length === 0) throw new Error('Conversation not found')

    await db
      .update(chatSessions)
      .set({ title: data.title, updatedAt: now })
      .where(
        and(
          eq(chatSessions.id, data.conversationId),
          eq(chatSessions.userId, userId),
        ),
      )

    const preview = await getConversationPreview(userId, data.conversationId)
    const messageCount = await getVisibleMessageCount(
      userId,
      data.conversationId,
    )

    const renamed: ChatConversationSummary = {
      id: data.conversationId,
      title: data.title,
      updatedAt: now.getTime(),
      preview,
      messageCount,
    }

    return renamed
  })

const deleteConversationInput = z.object({
  conversationId: z.string(),
})

const deleteConversationServerFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteConversationInput)
  .handler(async ({ data }) => {
    const userId = await getUserIdOrThrow()

    const existing = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, data.conversationId),
          eq(chatSessions.userId, userId),
        ),
      )
      .limit(1)

    if (existing.length === 0) throw new Error('Conversation not found')

    await db
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, data.conversationId),
          eq(chatMessages.userId, userId),
        ),
      )

    await db
      .delete(chatSessions)
      .where(
        and(
          eq(chatSessions.id, data.conversationId),
          eq(chatSessions.userId, userId),
        ),
      )

    return { conversationId: data.conversationId }
  })

/**
 * ---------- Query options / mutations ----------
 */

export const chatConversationsQueryOptions = () =>
  queryOptions({
    queryKey: chatQueryKeys.conversations(),
    queryFn: () => getConversationsServerFn(),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

export const chatConversationMessagesQueryOptions = (conversationId: string) =>
  queryOptions({
    queryKey: chatQueryKeys.conversationMessages(conversationId),
    queryFn: () =>
      getConversationMessagesServerFn({ data: { conversationId } }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

export const createChatConversationMutation = (input?: { title?: string }) =>
  createConversationServerFn({ data: input ?? {} })

export const renameChatConversationMutation = (input: {
  conversationId: string
  title: string
}) => renameConversationServerFn({ data: input })

export const deleteChatConversationMutation = (input: {
  conversationId: string
}) => deleteConversationServerFn({ data: input })
