"use server"

import { getCurrentSession } from "@website/lib/auth.ts"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Dashboard } from "./dashboard.tsx"

export default async function Page() {
  const session = await getCurrentSession()
  if (!session) {
    const headersList = await headers()
    return redirect(`/login?next=${headersList.get("x-pathname") ?? "/dashboard"}`)
  }

  return <Dashboard />
}
