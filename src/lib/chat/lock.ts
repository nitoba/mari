// db/lock.ts
import { and, eq, isNull, lt, or } from 'drizzle-orm'
import { db } from '../db/db'
import { chatSessions } from '../db/schema/chat'

export async function acquireDbSessionLock(params: {
  userId: number
  sessionId: string
  lockToken: string // gere no handler (ex.: crypto.randomUUID())
  ttlMs: number // ex.: 120_000
}) {
  const now = new Date()
  const until = new Date(now.getTime() + params.ttlMs)

  // tenta adquirir lock se:
  // - lockUntil IS NULL
  // - ou lockUntil < now (expirado)
  // - ou lockToken já é o mesmo (reentrada idempotente do mesmo request, opcional)
  const result = await db
    .update(chatSessions)
    .set({ lockToken: params.lockToken, lockUntil: until, updatedAt: now })
    .where(
      and(
        eq(chatSessions.id, params.sessionId),
        eq(chatSessions.userId, params.userId),
        or(
          isNull(chatSessions.lockUntil),
          lt(chatSessions.lockUntil, now),
          eq(chatSessions.lockToken, params.lockToken),
        ),
      ),
    )

  // drizzle retorna { rowsAffected } no driver mysql2
  const rowsAffected = (result as any).rowsAffected ?? 0
  return rowsAffected === 1
}

export async function releaseDbSessionLock(params: {
  userId: number
  sessionId: string
  lockToken: string
}) {
  // libera somente se o token bater
  await db
    .update(chatSessions)
    .set({ lockToken: null, lockUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(chatSessions.id, params.sessionId),
        eq(chatSessions.userId, params.userId),
        eq(chatSessions.lockToken, params.lockToken),
      ),
    )
}
