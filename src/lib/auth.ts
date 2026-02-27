import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { customSession } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { compare, hash } from 'bcryptjs'
import { db } from './db/db'
import * as schema from './db/schema/auth'
import type { User } from 'better-auth'


type CustomUser = User & {
  id: number
  pessoaId: number
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'mysql',
    schema: schema,
  }),
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: {
    fields: {
      createdAt: 'criado_em',
      updatedAt: 'atualizado_em'
    },
    additionalFields: {
      pessoaId: {
        type: 'number',
        fieldName: 'pessoaId',
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    password: {
      async hash(password) {
        return await hash(password, 12)
      },
      async verify({ hash: passwordHashed ,password }) {
        return await compare(password, passwordHashed)
      }
    }
  },
  plugins: [
    tanstackStartCookies(),
    customSession(async ({ user, session }) => {
      const userWithAdditionalFields = user as CustomUser
      let name = userWithAdditionalFields.email // fallback

      // If user has a pessoaId, fetch the name from pessoa table
      if (userWithAdditionalFields.pessoaId) {
        const result = await db
          .select({
            nome: schema.pessoa.nome,
            sobreNome: schema.pessoa.sobrenome,
          })
          .from(schema.pessoa)
          .where(eq(schema.pessoa.id, userWithAdditionalFields.pessoaId))
          .limit(1)

        if (result.length > 0) {
          name = `${result[0].nome} ${result[0].sobreNome}`
        }
      }

      return {
        user: {
          ...user,
          name, // Add/Override name from pessoa table
        },
        session,
      }
    }),
  ],
})
