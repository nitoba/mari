import { drizzle } from 'drizzle-orm/mysql2'

const connectionConfig = {
  host: process.env.DB_HOST!,
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USERNAME!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_NAME!,
}

const connectionString = `mysql://${connectionConfig.user}:${connectionConfig.password}@${connectionConfig.host}:${connectionConfig.port}/${connectionConfig.database}`

export const db = drizzle(connectionString, {logger: true})
