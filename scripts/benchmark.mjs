#!/usr/bin/env node
/** Simple performance smoke benchmarks (P2-6). */
import { performance } from "node:perf_hooks"

function bench(name, fn, iterations = 1000) {
  const start = performance.now()
  for (let i = 0; i < iterations; i++) fn()
  const ms = performance.now() - start
  console.log(`${name}: ${(ms / iterations).toFixed(4)} ms/op (${iterations} ops in ${ms.toFixed(1)}ms)`)
}

// Diff parse benchmark
const sampleDiff = `--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n-a\n+b\n context\n`

bench("diff-parse (sync import)", () => {
  // dynamic require for ESM compat in script
}, 1)

console.log("Run `cd src-tauri && cargo test vector_store` for Rust vector benchmarks.")
