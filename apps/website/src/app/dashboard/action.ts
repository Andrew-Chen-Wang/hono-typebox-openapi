"use server"

import {
  deleteSessionTokenCookie,
  getCurrentSession,
  invalidateSession,
} from "@website/lib/auth.ts"
import { redirect } from "next/navigation"

interface ActionResult {
  error: string | null
}

export async function logout(callbackUrl?: string): Promise<ActionResult> {
  const session = await getCurrentSession()
  if (!session) {
    return {
      error: "Unauthorized",
    }
  }

  await invalidateSession(session.session.sessionKey)
  await deleteSessionTokenCookie()
  return redirect(callbackUrl ?? "/login")
}
