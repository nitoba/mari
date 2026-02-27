// db/context.ts
import { db } from '../db/db'
import { chatMessages, chatSessions } from '../db/schema/chat'
import { chatSessionSummaries } from '../db/schema/chat' // ajuste import
import { and, asc, eq, gt } from 'drizzle-orm'

export async function loadContextForAgent(params: {
  userId: string
  sessionId: string
  tailLimit: number // ex.: 80
}) {
  const [sess] = await db
    .select({ summarySeq: chatSessions.summarySeq })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, params.sessionId),
        eq(chatSessions.userId, params.userId),
      ),
    )
    .limit(1)

  if (!sess) throw new Error('SESSION_NOT_FOUND')

  // 1) pega o último summary (se existir)
  let summaryMessage: any | null = null
  if (sess.summarySeq >= 0) {
    const [sum] = await db
      .select({ summaryMessage: chatSessionSummaries.summaryMessage })
      .from(chatSessionSummaries)
      .where(
        and(
          eq(chatSessionSummaries.sessionId, params.sessionId),
          eq(chatSessionSummaries.userId, params.userId),
          eq(chatSessionSummaries.coveredToSeq, sess.summarySeq),
        ),
      )
      .limit(1)

    summaryMessage = sum?.summaryMessage ?? null
  }

  // 2) pega tail (mensagens após summarySeq)
  const tailRows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, params.sessionId),
        eq(chatMessages.userId, params.userId),
        gt(chatMessages.seq, sess.summarySeq),
      ),
    )
    .orderBy(asc(chatMessages.seq))
    .limit(params.tailLimit)

  const messages = []
  if (summaryMessage) messages.push(summaryMessage)
  messages.push(...tailRows.map((r) => r.content))

  return { messages, summarySeq: sess.summarySeq }
}
