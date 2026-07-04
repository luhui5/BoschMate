import type { AgentMode } from "./types"

/** SQLite project row for global Bosch Assistant chat (not tied to a code repo). */
export const ASSISTANT_PROJECT_ID = "__assistant__"

/** Default agent mode for new sessions and prompt fallbacks. */
export const DEFAULT_AGENT_MODE: AgentMode = "edit"
