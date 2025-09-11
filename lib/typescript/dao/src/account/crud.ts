import type { DB } from "@template-nextjs/db"
import type { Insertable, Kysely, Selectable } from "kysely"
import { v7 } from "uuid"

export function crudAccount(db: Kysely<DB>) {
  async function create(data: Insertable<DB["account"]>): Promise<Selectable<DB["account"]>> {
    if (!data.id) {
      data.id = v7()
    }
    return await db.transaction().execute(async (tx) => {
      return await tx.insertInto("account").values(data).returningAll().executeTakeFirstOrThrow()
    })
  }

  return { create }
}
