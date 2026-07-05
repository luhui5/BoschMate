import { describe, expect, it } from "vitest"
import { buildLlmMessages } from "@/lib/chat-history"
import type { AssistantMessage } from "@/lib/assistant-sessions"

function msg(
  partial: Partial<AssistantMessage> & Pick<AssistantMessage, "role" | "content">,
): AssistantMessage {
  const { role, content, ...rest } = partial
  return {
    id: "m1",
    ...rest,
    role,
    content,
  }
}

describe("buildLlmMessages", () => {
  it("returns user/assistant alternation without tool steps", () => {
    const messages = [
      msg({ role: "user", content: "hello" }),
      msg({ role: "assistant", content: "hi there" }),
    ]
    const out = buildLlmMessages(messages, "follow up")
    expect(out).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "follow up" },
    ])
  })

  it("inserts digest after assistant message with tool steps", () => {
    const messages = [
      msg({ role: "user", content: "read main" }),
      msg({
        role: "assistant",
        content: "Here is the summary.",
        activitySteps: [
          {
            id: "s1",
            kind: "tool",
            round: 1,
            label: "read_file",
            tool: "read_file",
            args: JSON.stringify({ path: "src/main.rs" }),
            status: "success",
            result: "fn main() {}",
          },
        ],
      }),
    ]
    const out = buildLlmMessages(messages, "what does main do?")
    expect(out).toHaveLength(4)
    expect(out[0]).toEqual({ role: "user", content: "read main" })
    expect(out[1]).toEqual({ role: "assistant", content: "Here is the summary." })
    expect(out[2]!.role).toBe("user")
    expect(out[2]!.content).toContain("Previous tool results")
    expect(out[2]!.content).toContain("read_file")
    expect(out[2]!.content).toContain("src/main.rs")
    expect(out[3]).toEqual({ role: "user", content: "what does main do?" })
  })

  it("keeps only the most recent N assistant turns with tool digests", () => {
    const makeTurn = (n: number) => [
      msg({ role: "user", content: `q${n}` }),
      msg({
        role: "assistant",
        content: `a${n}`,
        activitySteps: [
          {
            id: `s${n}`,
            kind: "tool",
            round: 1,
            label: "grep",
            tool: "grep",
            args: JSON.stringify({ pattern: `term${n}` }),
            status: "success",
            result: `match${n}`,
          },
        ],
      }),
    ]

    const messages = [...makeTurn(1), ...makeTurn(2), ...makeTurn(3), ...makeTurn(4)]
    const out = buildLlmMessages(messages, "final", { maxTurnsWithTools: 2 })

    const digests = out.filter(
      (m) => m.role === "user" && m.content.startsWith("Previous tool results"),
    )
    expect(digests).toHaveLength(2)
    expect(digests[0]!.content).toContain("term3")
    expect(digests[1]!.content).toContain("term4")
    expect(out[out.length - 1]).toEqual({ role: "user", content: "final" })
  })

  it("truncates long tool results without throwing", () => {
    const longResult = "x".repeat(500)
    const messages = [
      msg({ role: "user", content: "read" }),
      msg({
        role: "assistant",
        content: "done",
        activitySteps: [
          {
            id: "s1",
            kind: "tool",
            round: 1,
            label: "read_file",
            tool: "read_file",
            args: JSON.stringify({ path: "big.txt" }),
            status: "success",
            result: longResult,
          },
        ],
      }),
    ]
    const out = buildLlmMessages(messages, "next", { maxResultChars: 50 })
    const digest = out.find(
      (m) => m.role === "user" && m.content.startsWith("Previous tool results"),
    )
    expect(digest).toBeDefined()
    expect(digest!.content.length).toBeLessThan(longResult.length + 200)
    expect(digest!.content).toContain("…")
  })

  it("skips streaming and empty assistant messages", () => {
    const messages = [
      msg({ role: "user", content: "q" }),
      msg({ role: "assistant", content: "", streaming: true }),
      msg({ role: "assistant", content: "real answer" }),
    ]
    const out = buildLlmMessages(messages, "next")
    expect(out).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "real answer" },
      { role: "user", content: "next" },
    ])
  })

  it("ignores non-success tool steps", () => {
    const messages = [
      msg({
        role: "assistant",
        content: "trying",
        activitySteps: [
          {
            id: "s1",
            kind: "tool",
            round: 1,
            label: "grep",
            tool: "grep",
            status: "error",
            result: "failed",
          },
        ],
      }),
    ]
    const out = buildLlmMessages(messages, "next")
    expect(out).toEqual([
      { role: "assistant", content: "trying" },
      { role: "user", content: "next" },
    ])
  })
})
