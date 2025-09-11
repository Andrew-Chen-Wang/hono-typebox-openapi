import { exec } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { createClient } from "@hey-api/openapi-ts"
import { describe, expect, it } from "vitest"

const execAsync = promisify(exec)

describe("OpenAPI Generation with hey-api", () => {
  it("should generate OpenAPI specs via command line and create client with hey-api", async () => {
    // Create a temporary directory
    const tempDir = await mkdtemp(join(tmpdir(), "openapi-test-"))

    try {
      // Generate OpenAPI specs using the command line
      const currentDir = dirname(fileURLToPath(import.meta.url))
      const { stdout } = await execAsync("npx tsx src/index.ts --openapi", {
        cwd: currentDir,
      })

      // Write specs to temporary file
      const specsPath = join(tempDir, "openapi.json")
      await writeFile(specsPath, stdout)

      // Create output directory for hey-api
      const outputDir = join(tempDir, "client")

      // Use hey-api to generate client
      await createClient({
        input: specsPath,
        output: outputDir,
      })

      // Verify that the specs were generated correctly by parsing the JSON
      const specs = JSON.parse(stdout) as {
        info: { title: string; version: string }
        paths: Record<string, unknown>
      }
      expect(specs).toBeDefined()
      expect(specs.info.title).toBe("Internal API")
      expect(specs.info.version).toBe("1.0.0")
      expect(specs.paths).toBeDefined()
    } finally {
      // Clean up temporary directory
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
