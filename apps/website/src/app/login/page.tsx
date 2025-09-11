import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { Suspense } from "react"
import { SignInForm } from "./sign-in-form.tsx"

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your account",
}

export default function SignInPage() {
  return (
    <div className="py-36 flex flex-col items-center justify-center">
      <div className="mx-auto flex w-full flex-col justify-center flex flex-col gap-y-6 sm:w-[350px]">
        <div className="flex flex-col gap-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign up or sign in to your account</p>
        </div>
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  )
}
