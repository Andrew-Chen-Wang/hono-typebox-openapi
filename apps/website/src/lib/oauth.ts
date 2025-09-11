import { Google } from "arctic"

export const oauthGoogle = new Google(
  // biome-ignore lint/style/noNonNullAssertion: process.env needs non-null assertion here
  process.env.GOOGLE_CLIENT_ID!,
  // biome-ignore lint/style/noNonNullAssertion: process.env needs non-null assertion here
  process.env.GOOGLE_CLIENT_SECRET!,
  // biome-ignore lint/style/noNonNullAssertion: process.env needs non-null assertion here
  `${process.env.NEXT_PUBLIC_HOST_URL!}/login/google/callback`,
)
