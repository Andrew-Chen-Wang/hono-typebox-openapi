import type { AppType } from "@api/internal"
import { hc } from "hono/client"

if (!process.env.NEXT_PUBLIC_HOST_URL) {
  throw new Error("NEXT_PUBLIC_HOST_URL is required")
}
export const client = hc<AppType>(process.env.NEXT_PUBLIC_HOST_URL)
