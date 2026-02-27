import { relations } from 'drizzle-orm'
import {
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/mysql-core'

export const user = mysqlTable('usuario', {
  id: int('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // image: text('image'),
  pessoaId: varchar('pessoa_id', { length: 36 }),
  createdAt: timestamp('criado_em', { fsp: 3 }).defaultNow().notNull(),
  updatedAt: timestamp('atualizado_em', { fsp: 3 })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const pessoa = mysqlTable('pessoa', {
  id: int('id').primaryKey(),
  nome: varchar('nome', { length: 255 }).notNull(),
  sobrenome: varchar('sobrenome', { length: 255 }).notNull(),
})

export const session = mysqlTable(
  'session',
  {
    id: int('id').primaryKey(),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: timestamp('criado_em', { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp('atualizado_em', { fsp: 3 })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: int('usuario_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
)

export const account = mysqlTable(
  'account',
  {
    id: int('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: int('usuario_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { fsp: 3 }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { fsp: 3 }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('criado_em', { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp('atualizado_em', { fsp: 3 })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
)

export const verification = mysqlTable(
  'verification',
  {
    id: int('id').primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
    createdAt: timestamp('criado_em', { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp('atualizado_em', { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
)

export const userRelations = relations(user, ({ one, many }) => ({
  sessions: many(session),
  accounts: many(account),
  pessoa: one(pessoa, {
    fields: [user.pessoaId],
    references: [pessoa.id],
  }),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))
