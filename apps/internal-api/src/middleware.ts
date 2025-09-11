import { authUser } from "@lib/dao"
import { sha256 } from "@oslojs/crypto/sha2"
import { encodeHexLowerCase } from "@oslojs/encoding"
import type { DB } from "@template-nextjs/db"
import { db } from "@template-nextjs/db"
import type { Context } from "hono"
import { getCookie } from "hono/cookie"
import { createMiddleware } from "hono/factory"
import { HTTPException } from "hono/http-exception"
import type { Selectable } from "kysely"
import { ErrorCode } from "./utils/errors.enum.ts"
import { throwHTTPException } from "./utils/http-exception.ts"

type SessionUser = Pick<Selectable<DB["user"]>, "id" | "isAdmin" | "name" | "email">

export async function getSession(
  c:
    | Context<{ Variables: { user: SessionUser; session: Selectable<DB["session"]> } }, string>
    | Context<
        { Variables: { user: SessionUser | null; session: Selectable<DB["session"]> | null } },
        string
      >,
) {
  const sessionToken = getCookie(c, "session")
  if (!sessionToken) {
    throwHTTPException(401, ErrorCode.Unauthenticated, "Unauthenticated")
  }

  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(sessionToken)))
  try {
    const session = await authUser(db).validateSessionToken(sessionId)
    if (!session) throwHTTPException(401, ErrorCode.Unauthenticated, "Unauthenticated")
    return session
  } catch {
    // Typically this means we're unable to connect to the database
    throwHTTPException(503, ErrorCode.ServiceUnavailable, "Service unavailable")
  }
}

export const authMiddleware = createMiddleware<{
  Variables: {
    user: SessionUser
    session: Selectable<DB["session"]>
  }
}>(async (c, next) => {
  const session = await getSession(c)
  c.set("user", session.user)
  c.set("session", session.session)

  await next()
})

export const authNoThrowMiddleware = createMiddleware<{
  Variables: {
    user: SessionUser | null
    session: Selectable<DB["session"]> | null
  }
}>(async (c, next) => {
  try {
    const session = await getSession(c)
    c.set("user", session.user)
    c.set("session", session.session)
  } catch (e) {
    if (e instanceof HTTPException && e.status === 401) {
      c.set("user", null)
      c.set("session", null)
    } else {
      throw e
    }
  }

  await next()
})
