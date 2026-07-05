import { describe, it, expect } from "vitest"
import {
  buildTaskSummary,
  shouldShowFileChanges,
  splitExecutionSummary,
} from "./task-summary"
import type { ChatMessage } from "./types"

describe("splitExecutionSummary", () => {
  it("splits at ## 执行汇总 heading", () => {
    const content = "Intro text.\n\n## 执行汇总\n\n- Done A\n- Done B"
    expect(splitExecutionSummary(content)).toEqual({
      before: "Intro text.",
      summary: "## 执行汇总\n\n- Done A\n- Done B",
    })
  })

  it("splits at **执行汇总** line", () => {
    const content = "Work complete.\n\n**执行汇总**\n\n- item"
    expect(splitExecutionSummary(content)).toEqual({
      before: "Work complete.",
      summary: "**执行汇总**\n\n- item",
    })
  })

  it("returns full content when no summary marker", () => {
    const content = "Just a normal reply."
    expect(splitExecutionSummary(content)).toEqual({
      before: content,
      summary: "",
    })
  })
})

describe("shouldShowFileChanges", () => {
  const base: ChatMessage = {
    id: "a-1",
    role: "assistant",
    content: "",
    createdAt: "",
    mode: "auto",
    streaming: false,
    activitySteps: [
      {
        id: "s1",
        kind: "tool",
        round: 1,
        label: "write",
        tool: "write_file",
        args: JSON.stringify({ path: "src/foo.ts" }),
        status: "success",
      },
    ],
  }

  it("is true for completed auto messages with file changes", () => {
    expect(shouldShowFileChanges(base)).toBe(true)
  })

  it("is false while streaming", () => {
    expect(shouldShowFileChanges({ ...base, streaming: true })).toBe(false)
  })

  it("is false without file changes", () => {
    expect(
      shouldShowFileChanges({
        ...base,
        activitySteps: [
          {
            id: "s1",
            kind: "tool",
            round: 1,
            label: "read",
            tool: "read_file",
            args: JSON.stringify({ path: "src/foo.ts" }),
            status: "success",
          },
        ],
      }),
    ).toBe(false)
  })
})

describe("buildTaskSummary", () => {
  it("merges diffs and write_file steps", () => {
    const summary = buildTaskSummary(
      [
        {
          id: "s1",
          kind: "tool",
          round: 1,
          label: "write",
          tool: "write_file",
          args: JSON.stringify({ path: "a.ts" }),
          status: "success",
        },
      ],
      [
        {
          filePath: "b.ts",
          additions: 2,
          deletions: 1,
          language: "typescript",
          lines: [],
          status: "applied",
        },
      ],
    )
    expect(summary.files.map((f) => f.path)).toEqual(["a.ts", "b.ts"])
  })
})
