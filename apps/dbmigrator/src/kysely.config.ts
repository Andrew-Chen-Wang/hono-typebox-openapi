import { db } from "@template-nextjs/db"
import { defineConfig } from "kysely-ctl"

const format = (num: number): string => num.toString().padStart(2, "0")

const getPrefix = (): string => {
  const now = new Date()
  return `${now.getFullYear()}_${format(now.getMonth())}_${format(now.getDate())}_${format(now.getHours())}_${format(now.getMinutes())}_${format(now.getSeconds())}_`
}

export default defineConfig({
  // @ts-ignore
  kysely: db,
  migrations: {
    migrationFolder: "migrations",
    getMigrationPrefix: getPrefix,
  },
  seeds: {
    seedFolder: "seeds",
    getSeedPrefix(): string | Promise<string> {
      return getPrefix()
    },
  },
})
