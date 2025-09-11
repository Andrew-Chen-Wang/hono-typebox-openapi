import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-pathname", request.nextUrl.pathname)

  if (request.method === "GET") {
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
    const token = request.cookies.get("session")?.value ?? null
    if (token !== null) {
      // Only extend cookie expiration on GET requests since we can be sure
      // a new session wasn't set when handling the request.
      response.cookies.set("session", token, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
      })
    }
    return response
  }

  // CSRF Protection - https://lucia-auth.com/sessions/cookies/nextjs
  const response403 = new NextResponse(null, {
    status: 403,
    headers: requestHeaders,
  })
  const originHeader = request.headers.get("Origin")
  const hostHeader = request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host")
  if (originHeader === null || hostHeader === null) {
    return response403
  }
  let origin: URL
  try {
    origin = new URL(originHeader)
  } catch {
    return response403
  }
  if (origin.host !== hostHeader) {
    return response403
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}
