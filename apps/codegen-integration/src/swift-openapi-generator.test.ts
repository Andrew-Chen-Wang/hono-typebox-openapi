import { exec } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { has, reachableSpecs } from "./helpers"

const execAsync = promisify(exec)
const here = dirname(fileURLToPath(import.meta.url))
const swiftDir = join(here, "..", "swift")
const specPath = join(swiftDir, "Sources", "Client", "openapi.json")

// swift-openapi-generator emits `warning: Schema "..." is not supported, reason: "...", skipping`
// and then SILENTLY DROPS the property from the generated client. A spec that triggers this is
// broken for Swift even though `swift build` still exits 0, so we treat these warnings as
// failures — that is the whole point of an end-to-end codegen test. The current library
// normalizes every shape we know of, so the committed source (:3000) produces none; a server
// running an older library version (e.g. :3001) will fail here with the offending paths listed.
const DROP_WARNING = /is not supported, reason:[^\n]*skipping/i
const COMPILE_ERROR = /error:/i

// Evaluated at collection time so we can statically skip when nothing is runnable.
const swiftAvailable = has("swift")
const sources = swiftAvailable ? await reachableSpecs("/openapi-ios") : []

describe("swift-openapi-generator: generate + compile, no dropped properties", () => {
  if (!swiftAvailable) {
    it.skip("requires the Swift toolchain (`swift` not found)", () => {})
    return
  }
  if (sources.length === 0) {
    it.skip("requires a server exposing /openapi-ios (none reachable on :3000/:3001)", () => {})
    return
  }

  it.each(sources)(
    "compiles a Swift client from $name $url with no skipped schemas",
    async ({ spec }) => {
      await mkdir(dirname(specPath), { recursive: true })
      await writeFile(specPath, spec)

      // `swift build` runs the OpenAPIGenerator build-tool plugin (generate) and compiles the
      // result. A non-zero exit rejects the promise; `exec` still gives us stdout/stderr on a
      // clean exit so we can also fail on dropped-property warnings.
      const { stdout, stderr } = await execAsync("swift build", {
        cwd: swiftDir,
        timeout: 600_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      const log = `${stdout}\n${stderr}`

      const dropped = log.split("\n").filter((l) => DROP_WARNING.test(l))
      expect(
        dropped,
        `swift-openapi-generator skipped ${dropped.length} unsupported schema(s):\n${dropped.join("\n")}`,
      ).toEqual([])
      expect(log).not.toMatch(COMPILE_ERROR)
    },
    600_000,
  )
})
