"use client"

import { logout } from "@website/app/dashboard/action.ts"
import { Button } from "@website/components/ui/button.tsx"
import { client } from "@website/lib/client.ts"

export function Dashboard() {
  async function handleDeleteUser() {
    const r = await client.api.v1.user.me.delete.$delete()
    if (r.ok) {
      await logout()
    }
  }

  async function handleLogout() {
    await logout()
  }

  return (
    <div className={"flex flex-row gap-4"}>
      <Button
        onClick={() => {
          handleLogout().catch(console.error)
        }}
      >
        Logout
      </Button>
      <Button
        onClick={() => {
          handleDeleteUser().catch(console.error)
        }}
      >
        Delete User
      </Button>
    </div>
  )
}
