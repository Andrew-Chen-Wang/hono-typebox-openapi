import { oauthGoogle } from "@website/lib/oauth.ts"
import { generateCodeVerifier, generateState } from "arctic"
import { cookies } from "next/headers"

export async function GET() {
  const state = generateState()
  const codeVerifier = generateCodeVerifier()
  const url = oauthGoogle.createAuthorizationURL(state, codeVerifier, [
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
    "https://www.googleapis.com/auth/userinfo.profile",
  ])

  const cookieStore = await cookies()
  cookieStore.set("google_oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 minutes
    sameSite: "lax",
  })
  cookieStore.set("google_code_verifier", codeVerifier, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 minutes
    sameSite: "lax",
  })

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
    },
  })
}
