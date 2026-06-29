/**
 * Slash command handler — maps /commands to functions.
 * Commands can be built-in or provided by Skills.
 */

export interface SlashCommand {
  name: string
  description: string
  /** If true, the command takes the rest of the input as arguments */
  takesArgs: boolean
  handler: (args?: string) => string | Promise<string>
}

const builtinCommands: SlashCommand[] = [
  {
    name: "test",
    description: "Run project tests",
    takesArgs: true,
    handler: async (args) => {
      // Trigger sandbox_exec via Tauri or return placeholder
      return `Running tests${args ? ` for ${args}` : ""}...`
    },
  },
  {
    name: "format",
    description: "Format code with project formatter",
    takesArgs: true,
    handler: async (args) => {
      return `Formatting code${args ? `: ${args}` : ""}...`
    },
  },
  {
    name: "lint",
    description: "Run linter and show issues",
    takesArgs: true,
    handler: async (args) => {
      return `Running linter${args ? ` on ${args}` : ""}...`
    },
  },
  {
    name: "changelog",
    description: "Generate changelog from git history",
    takesArgs: false,
    handler: async () => {
      return "Generating changelog from git commits..."
    },
  },
  {
    name: "deps",
    description: "Check outdated dependencies",
    takesArgs: false,
    handler: async () => {
      return "Checking dependencies for updates and vulnerabilities..."
    },
  },
  {
    name: "init",
    description: "Initialize a new project from template",
    takesArgs: true,
    handler: async (args) => {
      return `Initializing new project${args ? `: ${args}` : ""}...`
    },
  },
  {
    name: "onboarding",
    description: "Re-run the onboarding wizard",
    takesArgs: false,
    handler: async () => {
      return "Opening onboarding wizard..."
    },
  },
  {
    name: "compress-memory",
    description: "Manually trigger memory compression",
    takesArgs: false,
    handler: async () => {
      return "Compressing memories..."
    },
  },
]

/** Get all registered slash commands */
export function getCommands(): SlashCommand[] {
  return [...builtinCommands]
}

/** Parse a slash command from user input. Returns null if no command detected. */
export function parseCommand(input: string): { command: string; args?: string } | null {
  if (!input.startsWith("/")) return null
  const trimmed = input.slice(1).trim()
  if (!trimmed) return null

  const spaceIdx = trimmed.indexOf(" ")
  if (spaceIdx === -1) {
    return { command: trimmed }
  }
  return {
    command: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}

/** Execute a slash command. Returns the result text. */
export async function executeCommand(
  name: string,
  args?: string
): Promise<string> {
  const cmd = builtinCommands.find((c) => c.name === name)
  if (!cmd) {
    return `Unknown command: /${name}. Type / to see available commands.`
  }
  try {
    return await cmd.handler(args)
  } catch (e) {
    return `Command /${name} failed: ${e}`
  }
}

/** Get autocomplete suggestions for a partial command */
export function getSuggestions(partial: string): SlashCommand[] {
  if (!partial.startsWith("/")) return []
  const prefix = partial.slice(1).toLowerCase()
  return builtinCommands.filter(
    (c) => c.name.startsWith(prefix)
  )
}
