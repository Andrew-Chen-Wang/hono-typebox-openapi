import { authUser } from "@lib/dao/user/auth"
import { sha256 } from "@oslojs/crypto/sha2"
import { encodeBase32LowerCaseNoPadding, encodeHexLowerCase } from "@oslojs/encoding"
import { type DB, db } from "@template-nextjs/db"
import type { Selectable } from "kysely"
import { cookies } from "next/headers"
import { cache } from "react"

export function generateSessionToken(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return encodeBase32LowerCaseNoPadding(bytes)
}

export async function createSession(
  token: string,
  userId: string,
): Promise<Selectable<DB["session"]>> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
  const newSession = {
    sessionKey: sessionId,
    userId,
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  }
  await db.insertInto("session").values(newSession).executeTakeFirstOrThrow()
  return newSession
}

export type SessionUser = Pick<Selectable<DB["user"]>, "id" | "isAdmin" | "name" | "email">

export type SessionValidationResult = {
  session: Selectable<DB["session"]>
  user: SessionUser
} | null

export async function validateSessionToken(token: string): Promise<SessionValidationResult> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
  return await authUser(db).validateSessionToken(sessionId)
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await db.deleteFrom("session").where("sessionKey", "=", sessionId).execute()
}

export async function setSessionTokenCookie(token: string, expiresAt: Date): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  })
}

export async function deleteSessionTokenCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set("session", "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  })
}

export const getCurrentSession = cache(async (): Promise<SessionValidationResult> => {
  const cookieStore = await cookies()
  const token = cookieStore.get("session")?.value ?? null
  if (token === null) return null
  return await validateSessionToken(token)
})
