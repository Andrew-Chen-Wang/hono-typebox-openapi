import { db } from "@template-nextjs/db"
import { createSession, generateSessionToken, setSessionTokenCookie } from "@website/lib/auth"
import { oauthGoogle } from "@website/lib/oauth"
import { decodeIdToken } from "arctic"
import { cookies } from "next/headers"

import { crudAccount } from "@lib/dao/account/crud"
import { crudUser } from "@lib/dao/user/crud"
import type { OAuth2Tokens } from "arctic"

interface GoogleClaims {
  sub: string
  name: string
  email: string
  picture: string
  email_verified: boolean
  family_name: string
  given_name: string
  exp: number
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const cookieStore = await cookies()
  const storedState = cookieStore.get("google_oauth_state")?.value ?? null
  const codeVerifier = cookieStore.get("google_code_verifier")?.value ?? null
  cookieStore.delete("google_oauth_state")
  cookieStore.delete("google_code_verifier")
  if (code === null || state === null || storedState === null || codeVerifier === null) {
    return new Response(null, {
      status: 400,
    })
  }
  if (state !== storedState) {
    return new Response(null, {
      status: 400,
    })
  }

  let tokens: OAuth2Tokens
  try {
    tokens = await oauthGoogle.validateAuthorizationCode(code, codeVerifier)
  } catch (e) {
    // Invalid code or client credentials
    return new Response(null, {
      status: 400,
    })
  }
  const claims = decodeIdToken(tokens.idToken()) as GoogleClaims
  const googleUserId = claims.sub
  const name = claims.name
  const email = claims.email
  const image = claims.picture
  // const emailVerified = claims.email_verified
  const exp = claims.exp

  const existingUser = await db
    .selectFrom("account")
    .where("providerAccountId", "=", googleUserId)
    .where("provider", "=", "google")
    .select("userId")
    .executeTakeFirst()

  if (existingUser) {
    const sessionToken = generateSessionToken()
    const session = await createSession(sessionToken, existingUser.userId)
    await setSessionTokenCookie(sessionToken, session.expires)
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
      },
    })
  }

  let user = await db.selectFrom("user").where("email", "=", email).selectAll().executeTakeFirst()
  user ??= await crudUser(db).createUser({
    id: "",
    name,
    email,
    image,
  })
  await crudAccount(db).create({
    id: "",
    userId: user.id,
    provider: "google",
    providerAccountId: googleUserId,
    type: "oauth",
    scope: tokens.scopes().join(" "),
    idToken: tokens.idToken(),
    accessToken: tokens.accessToken(),
    tokenType: tokens.tokenType(),
    expiresAt: exp,
  })

  const sessionToken = generateSessionToken()
  const session = await createSession(sessionToken, user.id)
  await setSessionTokenCookie(sessionToken, session.expires)
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
    },
  })
}
