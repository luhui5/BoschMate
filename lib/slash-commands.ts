/**
 * Slash command handler — maps /commands to real backend actions.
 */

import {
  isTauri,
  runTests,
  runLinter,
  compressMemories,
  sandboxExec,
} from "@/lib/tauri-api"

export interface SlashContext {
  projectId?: string
}

export interface SlashCommand {
  name: string
  description: string
  takesArgs: boolean
  handler: (args: string | undefined, ctx: SlashContext) => string | Promise<string>
}

const builtinCommands: SlashCommand[] = [
  {
    name: "test",
    description: "Run project tests",
    takesArgs: true,
    handler: async (args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Tests require an open project in the desktop app."
      const result = await runTests(ctx.projectId, args)
      return `**${result.command}** (exit ${result.exitCode})\n\n${result.stdout}\n${result.stderr}`.trim()
    },
  },
  {
    name: "format",
    description: "Format code with project formatter",
    takesArgs: true,
    handler: async (args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Format requires an open project."
      const cmd = args ? `npm run format -- ${args}` : "npm run format"
      const result = await sandboxExec(ctx.projectId, cmd)
      return result.stdout || result.stderr || "Format completed."
    },
  },
  {
    name: "lint",
    description: "Run linter and show issues",
    takesArgs: true,
    handler: async (args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Lint requires an open project."
      const result = await runLinter(ctx.projectId, args)
      if (result.issues.length === 0) return `${result.command}\n\nNo issues found.\n${result.rawOutput.slice(0, 2000)}`
      const lines = result.issues.slice(0, 20).map((i) => `${i.file}:${i.line} ${i.message}`)
      return `${result.command}\n\n${lines.join("\n")}`
    },
  },
  {
    name: "changelog",
    description: "Generate changelog from git history",
    takesArgs: false,
    handler: async (_args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Changelog requires git project."
      const result = await sandboxExec(ctx.projectId, "git log --oneline -20")
      return result.stdout || "No git history."
    },
  },
  {
    name: "deps",
    description: "Check outdated dependencies",
    takesArgs: false,
    handler: async (_args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Dependency check requires open project."
      const result = await sandboxExec(ctx.projectId, "npm outdated || true")
      return result.stdout || result.stderr || "Dependency check done."
    },
  },
  {
    name: "init",
    description: "Initialize a new project from template",
    takesArgs: true,
    handler: async (args) => `Use 主页 → 新建项目 to initialize${args ? `: ${args}` : ""}.`,
  },
  {
    name: "compress-memory",
    description: "Manually trigger memory compression",
    takesArgs: false,
    handler: async (_args, ctx) => {
      if (!ctx.projectId || !isTauri()) return "Memory compression requires open project."
      const n = await compressMemories(ctx.projectId)
      return `Compressed ${n} memory entries.`
    },
  },
]

export function getCommands(): SlashCommand[] {
  return [...builtinCommands]
}

export function parseCommand(input: string): { command: string; args?: string } | null {
  if (!input.startsWith("/")) return null
  const trimmed = input.slice(1).trim()
  if (!trimmed) return null
  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) return { command: trimmed }
  return { command: trimmed.slice(0, spaceIdx), args: trimmed.slice(spaceIdx + 1).trim() }
}

export async function executeCommand(
  name: string,
  ctx: SlashContext,
  args?: string,
): Promise<string> {
  const cmd = builtinCommands.find((c) => c.name === name)
  if (!cmd) return `Unknown command: /${name}. Type / to see available commands.`
  try {
    return await cmd.handler(args, ctx)
  } catch (e) {
    return `Command /${name} failed: ${e}`
  }
}

export function getSuggestions(partial: string): SlashCommand[] {
  if (!partial.startsWith("/")) return []
  const prefix = partial.slice(1).toLowerCase()
  return builtinCommands.filter((c) => c.name.startsWith(prefix))
}
