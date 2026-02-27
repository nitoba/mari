// db/schema.ts (trecho)
import {
  datetime,
  index,
  int,
  json,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

export const chatSessions = mysqlTable(
  'chat_sessions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: int('user_id').notNull(),
    title: varchar('title', { length: 255 }),
    createdAt: datetime('created_at', { mode: 'date' }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date' }).notNull(),

    nextSeq: int('next_seq').notNull().default(0),
    meta: json('meta'),

    // --- LOCK ---
    lockToken: varchar('lock_token', { length: 64 }),
    lockUntil: datetime('lock_until', { mode: 'date' }),

    // --- SUMMARY POINTER ---
    // "até qual seq foi resumido"
    summarySeq: int('summary_seq').notNull().default(-1),
  },
  (t) => [index('idx_sessions_user_updated').on(t.userId, t.updatedAt)],
)

export type ChatRole = 'user' | 'assistant' | 'toolResult'
/**
 * content: armazene o objeto de mensagem do Pi (AgentMessage)
 * Assim você rehidrata direto via replaceMessages(rows.map(r => r.content)).
 */
export const chatMessages = mysqlTable(
  'chat_messages',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()), // UUID
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    userId: int('user_id').notNull(),

    seq: int('seq').notNull(), // ordem determinística na sessão
    role: varchar('role', { length: 16 }).notNull(), // user | assistant | toolResult
    content: json('content').notNull(), // AgentMessage (JSON)
    createdAt: datetime('created_at', { mode: 'date' }).notNull(),

    // idempotência por requestId (todas as rows do turno carregam o mesmo requestId)
    requestId: varchar('request_id', { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_messages_session_seq').on(t.sessionId, t.seq),
    index('idx_messages_session_request').on(t.sessionId, t.requestId),
    index('idx_messages_session_user').on(t.sessionId, t.userId),
  ],
)

export const chatSessionSummaries = mysqlTable(
  'chat_session_summaries',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()), // UUID
    sessionId: varchar('session_id', { length: 36 }).notNull(),
    userId: int('user_id').notNull(),

    // resumo cobre mensagens até seq = coveredToSeq
    coveredToSeq: int('covered_to_seq').notNull(),

    // salve como AgentMessage (ex.: role:"assistant", content:[{type:"text", text:"..."}])
    summaryMessage: json('summary_message').notNull(),

    createdAt: datetime('created_at', { mode: 'date' }).notNull(),
  },
  (t) => [
    uniqueIndex('uq_summary_session_covered').on(t.sessionId, t.coveredToSeq),
  ],
)
