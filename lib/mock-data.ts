import type {
  Project,
  Session,
  FileNode,
  GitFile,
  Memory,
  Note,
  Skill,
} from "./types"

export const projects: Project[] = []

export const sessions: Session[] = []

export const fileTree: FileNode[] = []

export const gitFiles: GitFile[] = []

export const memories: Memory[] = []

export const notes: Note[] = []

export const skills: Skill[] = []

export const slashCommands: { cmd: string; desc: string }[] = []
