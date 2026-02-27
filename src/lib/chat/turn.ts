import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db } from '../db/db'
import { chatMessages, chatSessions } from '../db/schema/chat'

type AgentMessage = any
type ChatRole = 'user' | 'assistant' | 'toolResult'

export async function appendTurn(params: {
  userId: string
  sessionId: string
  requestId: string

  userText: string
  assistantMessage: AgentMessage | null
  toolResults: AgentMessage[]
}) {
  const now = new Date()

  const rows: Array<{ role: ChatRole; content: AgentMessage }> = []

  // 1) user message (persistida no DB — mas NÃO foi colocada no agent)
  rows.push({
    role: 'user',
    content: {
      role: 'user',
      content: [{ type: 'text', text: params.userText }],
    },
  })

  // 2) assistant message
  if (params.assistantMessage) {
    rows.push({ role: 'assistant', content: params.assistantMessage })
  }

  // 3) tool results (mensagens separadas)
  for (const tr of params.toolResults) {
    rows.push({ role: 'toolResult', content: tr })
  }

  await db.transaction(async (tx) => {
    // lock da sessão p/ reservar seq
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

    if (!sess) throw new Error('SESSION_NOT_FOUND')

    const startSeq = sess.nextSeq
    const count = rows.length

    await tx
      .update(chatSessions)
      .set({ nextSeq: startSeq + count, updatedAt: now })
      .where(eq(chatSessions.id, params.sessionId))

    // insert batch
    await tx.insert(chatMessages).values(
      rows.map((r, i) => ({
        id: randomUUID(),
        sessionId: params.sessionId,
        userId: params.userId,
        seq: startSeq + i,
        role: r.role,
        content: r.content,
        createdAt: now,
        requestId: params.requestId,
      })),
    )
  })
}
