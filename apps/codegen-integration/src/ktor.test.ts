import { exec, execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { reachableSpecs } from "./helpers"

const execAsync = promisify(exec)
const here = dirname(fileURLToPath(import.meta.url))
const repoBin = join(here, "..", "node_modules", ".bin", "openapi-generator-cli")
const generatorCli = existsSync(repoBin) ? repoBin : "npx --yes @openapitools/openapi-generator-cli"

// The Ktor client is produced from the DEFAULT spec (no target) first, per the plan: a
// dedicated `ktor` target is only introduced if the default output cannot generate/compile.
// If/when that target exists, switch this path to "/openapi-android".
const SPEC_PATH = "/openapi"

// openapi-generator's kotlin template emits a Gradle 7.x wrapper. Gradle 7.x only runs on
// JDK <= 19 — under a newer JDK (e.g. the JDK 26 that may be the only one on a dev machine)
// the build aborts with "Unsupported class file major version", and the failing Kotlin/Gradle
// compile can thrash the host. So the compile step REQUIRES a Gradle-7-compatible JDK. We locate
// one explicitly (never falling back to an unknown ambient JDK) and skip the whole test when none
// is present. In CI, actions/setup-java provides JDK 17 (see .github/workflows/ci.yml).
//
// We deliberately do NOT rely on the machine's default JDK: a dev box may run a too-new default
// (e.g. zulu-26) that we must not disturb. Instead we discover a compatible JDK in a side
// location and pin it onto the build's env only. Install one without changing the default via
// `brew install openjdk@17` (a formula, not the `zulu@17` .pkg cask which registers globally and
// needs sudo). Override the search with CODEGEN_GRADLE_JAVA_HOME=/path/to/jdk17.
const MIN_JDK = 8
const MAX_JDK = 19 // highest major Gradle 7.x supports

// The major version of the JDK at `home`, or undefined if it can't be determined.
function jdkMajor(home: string): number | undefined {
  try {
    const out = execSync(`"${home}/bin/java" -version 2>&1`).toString()
    // "1.8.0_x" -> 8; "17.0.1"/"21"/"26" -> that number.
    const m = /version "(?:1\.)?(\d+)/.exec(out)
    return m ? Number(m[1]) : undefined
  } catch {
    return undefined
  }
}

// Returns a JAVA_HOME whose JDK major version is in [MIN_JDK, MAX_JDK], or undefined.
function compatibleJavaHome(): string | undefined {
  const candidates: string[] = []

  // 1. Explicit override (highest priority) — point at any JDK without touching the machine default.
  if (process.env.CODEGEN_GRADLE_JAVA_HOME) candidates.push(process.env.CODEGEN_GRADLE_JAVA_HOME)

  // 2. Homebrew `openjdk@N` formulae: installed without sudo and NOT registered as the system
  //    default, so they don't show up under `java_home`. Probe the well-known prefixes directly.
  for (const prefix of ["/opt/homebrew/opt", "/usr/local/opt"]) {
    for (const v of ["17", "21", "11"]) {
      candidates.push(`${prefix}/openjdk@${v}/libexec/openjdk.jdk/Contents/Home`)
    }
  }

  // 3. macOS: enumerate EVERY registered JDK via `java_home -V` (capital V, prints all to stderr).
  //    We do not use `java_home -v 17`: when no 17 is installed it falls back to the newest JDK
  //    (e.g. 26), and even with 17 installed its "at least N" semantics can return a newer one —
  //    so we list them all and verify each major version below.
  try {
    const listing = execSync("/usr/libexec/java_home -V 2>&1", {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString()
    for (const m of listing.matchAll(/(\/.*\/Contents\/Home)\s*$/gm)) {
      candidates.push(m[1].trim())
    }
  } catch {
    // not macOS, or no JDKs registered
  }

  // 4. Linux/CI (no java_home tool): the JDK selected by JAVA_HOME / PATH.
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME)

  for (const home of candidates) {
    if (!existsSync(home)) continue
    const major = jdkMajor(home)
    if (major !== undefined && major >= MIN_JDK && major <= MAX_JDK) return home
  }
  return undefined
}

const javaHome = compatibleJavaHome()
const sources = javaHome ? await reachableSpecs(SPEC_PATH) : []

describe("openapi-generator kotlin/ktor: generate + compile", () => {
  if (!javaHome) {
    it.skip("requires a Gradle-compatible JDK (<=19, e.g. JDK 17); none found", () => {})
    return
  }
  if (sources.length === 0) {
    it.skip(`requires a server exposing ${SPEC_PATH} (none reachable)`, () => {})
    return
  }

  // Pin the whole toolchain (openapi-generator + Gradle + Kotlin compiler are all Java) to the
  // compatible JDK, and cap Gradle so a pathological spec can never exhaust the host.
  const env = {
    ...process.env,
    JAVA_HOME: javaHome,
    PATH: `${javaHome}/bin:${process.env.PATH}`,
    GRADLE_OPTS: "-Dorg.gradle.jvmargs=-Xmx768m -Dorg.gradle.daemon=false",
  }

  it.each(sources)(
    "compiles a Ktor Kotlin client generated from $name $url",
    async ({ spec }) => {
      const work = await mkdtemp(join(tmpdir(), "ktor-codegen-"))
      try {
        const specFile = join(work, "openapi.json")
        const out = join(work, "client")
        await mkdir(out, { recursive: true })
        await writeFile(specFile, spec)

        // Generate a Ktor-based Kotlin client (jvm-ktor: pure-JVM Ktor client, compiles with
        // just a JDK + the emitted Gradle wrapper — no Kotlin/Native or Android SDK needed).
        await execAsync(
          `${generatorCli} generate -g kotlin --additional-properties=library=jvm-ktor -i "${specFile}" -o "${out}"`,
          { cwd: work, env, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
        )

        // Compile via the generated Gradle wrapper (downloads its own Gradle; needs only a JDK).
        const gradlew = join(out, "gradlew")
        const hasWrapper = existsSync(gradlew)
        if (hasWrapper) await chmod(gradlew, 0o755) // openapi-generator emits it non-executable
        const cmd = hasWrapper
          ? "./gradlew --no-daemon --max-workers=1 assemble"
          : "gradle --no-daemon --max-workers=1 assemble"

        // A non-zero exit rejects the promise and fails the test; the BUILD FAILED check is a
        // secondary guard in case the wrapper reports failure without a non-zero exit.
        const { stdout, stderr } = await execAsync(cmd, {
          cwd: out,
          env,
          timeout: 900_000,
          maxBuffer: 64 * 1024 * 1024,
        })
        expect(`${stdout}\n${stderr}`).not.toMatch(/\bBUILD FAILED\b/)
      } finally {
        await rm(work, { recursive: true, force: true })
      }
    },
    1_200_000,
  )
})
