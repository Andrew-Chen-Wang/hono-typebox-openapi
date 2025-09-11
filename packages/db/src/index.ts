import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely"
import pg from "pg"
import type { DB } from "./types.ts"

// Re-define __dirname since we are using JS when generating OpenAPI specs in apps/internal-api
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config({ path: `${__dirname}/../../../apps/website/.env` })

const dialect = new PostgresDialect({
  pool: new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
  }),
})

export const db = new Kysely<DB>({
  dialect,
  plugins: [new CamelCasePlugin()],
})

export type { DB }
