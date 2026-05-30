import { execSync } from "node:child_process"

/**
 * Spec sources the integration tests fetch from.
 *
 * - `local`   -> the committed example app (apps/internal-api). Public, simple spec. It binds a
 *                high port (34100 by default) because low ports are taken by the BestFit dev app
 *                (:3000) and its OpenAPI server (:3001) on dev machines. Override the bind port
 *                with PORT, and the URL the tests look for with CODEGEN_LOCAL_URL.
 * - `bestfit` -> a private app on :3001 with a much more complex spec, used only at dev time.
 *                Its spec is NEVER committed; we only fetch it at runtime if it happens to be
 *                running. When BestFit surfaces a codegen problem, reproduce it as a narrow,
 *                anonymized synthetic schema under src/repros/ — never copy BestFit details.
 */
export const SOURCES = {
  local: process.env.CODEGEN_LOCAL_URL ?? "http://localhost:34100",
  bestfit: process.env.CODEGEN_BESTFIT_URL ?? "http://localhost:3001",
} as const

/**
 * Fetch a spec, returning its text or `null` if the endpoint is unreachable, errors, or does
 * not serve a genuine OpenAPI JSON document.
 *
 * We do NOT follow redirects and we require an `openapi` field: an unrelated app squatting the
 * port (e.g. one that 307-redirects to a login page) must not be mistaken for a spec source.
 */
export async function fetchSpec(url: string, timeoutMs = 2000): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" })
    if (!res.ok) return null
    const text = await res.text()
    let doc: unknown
    try {
      doc = JSON.parse(text)
    } catch {
      return null
    }
    if (!doc || typeof (doc as { openapi?: unknown }).openapi !== "string") return null
    return text
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** True if `cmd` is on PATH (used to skip tests when a toolchain is absent). */
export function has(cmd: string): boolean {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore", shell: "/bin/sh" })
    return true
  } catch {
    return false
  }
}

export type ReachableSpec = { name: string; url: string; spec: string }

/** Return every SOURCE whose `${base}${path}` endpoint is reachable, with its spec text. */
export async function reachableSpecs(path: string): Promise<ReachableSpec[]> {
  const out: ReachableSpec[] = []
  for (const [name, base] of Object.entries(SOURCES)) {
    const url = `${base}${path}`
    const spec = await fetchSpec(url)
    if (spec) out.push({ name, url, spec })
  }
  return out
}
