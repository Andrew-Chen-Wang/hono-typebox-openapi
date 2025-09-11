import type { DB } from "@template-nextjs/db"
import type { Insertable, Kysely, Selectable } from "kysely"
import { v7 } from "uuid"

export function crudUser(db: Kysely<DB>) {
  async function createUser(data: Insertable<DB["user"]>): Promise<Selectable<DB["user"]>> {
    if (!data.id) {
      data.id = v7()
    }
    return await db.transaction().execute(async (tx) => {
      return await tx.insertInto("user").values(data).returningAll().executeTakeFirstOrThrow()
    })
  }

  async function deleteUser(userId: string): Promise<boolean> {
    try {
      await db.transaction().execute(async (tx) => {
        await tx.deleteFrom("user").where("id", "=", userId).execute()
      })
      return true
    } catch {
      return false
    }
  }

  return { createUser, deleteUser }
}
