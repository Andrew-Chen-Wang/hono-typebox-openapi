import { defineProject } from "vitest/config"

// The swift and ktor cases each kick off a heavy native build (swift build / Gradle + Kotlin
// compile). Running them concurrently spikes machine load hard, so force this project's test
// files to run one at a time. fileParallelism:false serializes files; singleFork keeps them in
// one worker so two builds never overlap. The pure-schema repros are trivial and unaffected.
export default defineProject({
  test: {
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
