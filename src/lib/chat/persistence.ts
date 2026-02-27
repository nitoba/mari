// db/persistence.ts
import { randomUUID } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/db'
import { chatMessages, chatSessions } from '../db/schema/chat'
import type { ChatRole } from '../db/schema/chat'

export async function getOrCreateDbSession(userId: number, sessionId: string) {
  const [sess] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (sess !== undefined && sess !== null) return sess

  await db.insert(chatSessions).values({
    id: sessionId,
    userId,
    nextSeq: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return {
    id: sessionId,
    userId,
    nextSeq: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export async function loadHistory(
  userId: number,
  sessionId: string,
  limit = 80,
) {
  // pega desc e reverte (mais rápido com índice)
  const rows = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.userId, userId),
      ),
    )
    .orderBy(desc(chatMessages.seq))
    .limit(limit)

  return rows.reverse()
}

export async function findCachedTurnByRequestId(
  userId: number,
  sessionId: string,
  requestId: string,
) {
  // se já existe assistant com requestId, consideramos turno já processado
  const assistant = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.requestId, requestId),
        eq(chatMessages.role, 'assistant'),
      ),
    )
    .limit(1)

  if (assistant.length === 0) return null

  const all = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.sessionId, sessionId),
        eq(chatMessages.requestId, requestId),
      ),
    )
    .orderBy(desc(chatMessages.seq))

  return all.reverse()
}

export async function appendMessage(params: {
  userId: number
  sessionId: string
  role: ChatRole
  content: any // AgentMessage (JSON)
  requestId: string
}) {
  return db.transaction(async (tx) => {
    // lock da sessão para garantir seq e evitar interleaving
    const [sess] = await tx
      .select({ nextSeq: chatSessions.nextSeq })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.id, params.sessionId),
          eq(chatSessions.userId, params.userId),
        ),
      )
      .for('update')

    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!sess) throw new Error('SESSION_NOT_FOUND')

    const seq = sess.nextSeq

    await tx
      .update(chatSessions)
      .set({ nextSeq: seq + 1, updatedAt: new Date() })
      .where(eq(chatSessions.id, params.sessionId))

    await tx.insert(chatMessages).values({
      id: randomUUID(),
      sessionId: params.sessionId,
      userId: params.userId,
      seq,
      role: params.role,
      content: params.content,
      createdAt: new Date(),
      requestId: params.requestId,
    })

    return seq
  })
}
