import type { DB } from "@template-nextjs/db"
import type { Kysely, Selectable } from "kysely"

type SessionUser = Pick<Selectable<DB["user"]>, "id" | "isAdmin" | "name" | "email">

type SessionValidationResult = {
  session: Selectable<DB["session"]>
  user: SessionUser
} | null

export function authUser(db: Kysely<DB>) {
  async function validateSessionToken(sessionKey: string): Promise<SessionValidationResult> {
    const row = await db
      .selectFrom("session")
      .innerJoin("user", "user.id", "session.userId")
      .where("session.sessionKey", "=", sessionKey)
      .select([
        "session.sessionKey",
        "session.expires",
        "session.userId",
        "user.id",
        "user.isAdmin",
        "user.name",
        "user.email",
      ])
      .executeTakeFirst()

    if (!row) {
      return null
    }
    const session: Selectable<DB["session"]> = {
      sessionKey: row.sessionKey,
      userId: row.userId,
      expires: row.expires,
    }
    const user: SessionUser = {
      id: row.id,
      isAdmin: row.isAdmin,
      name: row.name,
      email: row.email,
    }
    if (Date.now() >= session.expires.getTime()) {
      await db.deleteFrom("session").where("sessionKey", "=", session.sessionKey).execute()
      return null
    }
    if (Date.now() >= session.expires.getTime() - 1000 * 60 * 60 * 24 * 15) {
      session.expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30)
      await db
        .updateTable("session")
        .set("expires", session.expires)
        .where("sessionKey", "=", session.sessionKey)
        .execute()
    }
    return { session, user }
  }

  return { validateSessionToken }
}
