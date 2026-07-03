import { describe, it, expect } from "vitest"
import { parseUnifiedDiff } from "./diff-parser"

describe("parseUnifiedDiff", () => {
  it("parses additions and deletions", () => {
    const diff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,2 +1,2 @@
-old
+new
`
    const hunk = parseUnifiedDiff("foo.ts", diff, "pending")
    expect(hunk.additions).toBe(1)
    expect(hunk.deletions).toBe(1)
    expect(hunk.filePath).toBe("foo.ts")
  })
})
