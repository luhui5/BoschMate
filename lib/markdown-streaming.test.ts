import { describe, it, expect } from "vitest"
import { parseBlocks } from "./markdown-blocks"
import { parseStreamingMarkdown, splitStreamingMarkdown } from "./markdown-streaming"

describe("splitStreamingMarkdown", () => {
  it("keeps a single in-progress line as tail", () => {
    expect(splitStreamingMarkdown("Hello **world")).toEqual({
      stableText: "",
      tail: "Hello **world",
    })
  })

  it("promotes completed lines to stable text", () => {
    expect(splitStreamingMarkdown("## Title\nBody in progress")).toEqual({
      stableText: "## Title",
      tail: "Body in progress",
    })
  })

  it("treats trailing newline as complete stable content", () => {
    expect(splitStreamingMarkdown("## Title\n")).toEqual({
      stableText: "## Title",
      tail: "",
    })
  })

  it("holds incomplete headings in the tail", () => {
    expect(splitStreamingMarkdown("Done.\n###")).toEqual({
      stableText: "Done.",
      tail: "###",
    })
  })

  it("holds unclosed code fences in the tail", () => {
    expect(splitStreamingMarkdown("Intro\n```ts\nconst x = 1")).toEqual({
      stableText: "Intro",
      tail: "```ts\nconst x = 1",
    })
  })

  it("holds incomplete table headers in the tail", () => {
    expect(splitStreamingMarkdown("Before\n| a | b |")).toEqual({
      stableText: "Before",
      tail: "| a | b |",
    })
  })
})

describe("parseStreamingMarkdown", () => {
  it("parses stable blocks while streaming", () => {
    const { blocks, tail } = parseStreamingMarkdown("## Done\nStill typing", true)
    expect(blocks).toEqual([{ type: "heading", level: 2, text: "Done" }])
    expect(tail).toBe("Still typing")
  })

  it("matches full parse when not streaming", () => {
    const text = "## Title\n\nParagraph one."
    expect(parseStreamingMarkdown(text, false)).toEqual({
      blocks: parseBlocks(text),
      tail: "",
    })
  })

  it("does not swallow content after an unclosed fence", () => {
    const { blocks, tail } = parseStreamingMarkdown("## OK\n```\ncode line", true)
    expect(blocks).toEqual([{ type: "heading", level: 2, text: "OK" }])
    expect(tail).toBe("```\ncode line")
  })
})
