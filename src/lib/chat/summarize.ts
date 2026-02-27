/* eslint-disable @typescript-eslint/no-unnecessary-condition */
// chat/summarize.ts
import { randomUUID } from 'node:crypto'
import { and, asc, eq, gt, lte } from 'drizzle-orm'
import {
  SessionManager,
  createAgentSession,
} from '@mariozechner/pi-coding-agent'
import { db } from '@/lib/db/db'
import {
  chatMessages,
  chatSessionSummaries,
  chatSessions,
} from '@/lib/db/schema/chat'

type AgentMessage = any

function makeSummarySystemPrompt(): AgentMessage {
  return {
    role: 'system',
    content: [
      {
        type: 'text',
        text:
          'Você é um componente de sumarização. Crie um resumo conciso e factual do histórico fornecido, ' +
          'mantendo decisões, contexto, preferências do usuário, tarefas pendentes e resultados de tools. ' +
          'Não invente nada. Responda somente com o resumo.',
      },
    ],
  }
}

export async function maybeSummarizeSession(params: {
  userId: number
  sessionId: string
  // quantas mensagens manter fora do summary
  tailKeep: number // ex.: 80
  buffer: number // ex.: 40
  // modelo/config (se quiser usar diferente do chat)
  agentConfig?: any
}) {
  // lock do summary: reusar lock da sessão (ideal)
  const [sess] = await db
    .select({
      summarySeq: chatSessions.summarySeq,
      nextSeq: chatSessions.nextSeq,
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.id, params.sessionId),
        eq(chatSessions.userId, params.userId),
      ),
    )
    .limit(1)

  if (!sess) return

  const latestSeq = sess.nextSeq - 1
  const delta = latestSeq - sess.summarySeq

  if (delta <= params.tailKeep + params.buffer) return

  // vamos resumir uma fatia antiga: do (summarySeq+1) até (latestSeq - tailKeep)
  const coveredToSeq = latestSeq - params.tailKeep

  const rowsToSummarize = await db
    .select()
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.sessionId, params.sessionId),
        eq(chatMessages.userId, params.userId),
        gt(chatMessages.seq, sess.summarySeq),
        lte(chatMessages.seq, coveredToSeq),
      ),
    )
    .orderBy(asc(chatMessages.seq))

  if (rowsToSummarize.length === 0) return

  const toSummarize: Array<AgentMessage> = rowsToSummarize.map((r) => r.content)

  // cria uma sessão “summarizer”
  const sumSession = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    ...params.agentConfig,
  })

  // seed: system summary prompt + histórico a resumir
  sumSession.session.agent.replaceMessages([
    makeSummarySystemPrompt(),
    ...toSummarize,
  ])

  let finalAssistant: AgentMessage | null = null
  const unsub = sumSession.session.subscribe((event: any) => {
    if (event.type === 'turn_end') finalAssistant = event.message ?? null
  })

  try {
    await sumSession.session.prompt('Gere o resumo agora.')
  } finally {
    unsub()
  }

  if (!finalAssistant) return

  // salva summary e avança summarySeq numa transação
  await db.transaction(async (tx) => {
    await tx.insert(chatSessionSummaries).values({
      id: randomUUID(),
      sessionId: params.sessionId,
      userId: params.userId,
      coveredToSeq,
      summaryMessage: finalAssistant,
      createdAt: new Date(),
    })

    await tx
      .update(chatSessions)
      .set({ summarySeq: coveredToSeq, updatedAt: new Date() })
      .where(
        and(
          eq(chatSessions.id, params.sessionId),
          eq(chatSessions.userId, params.userId),
        ),
      )
  })
}
