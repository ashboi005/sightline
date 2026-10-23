import type { ViewerCommand } from "./commands.types"

const COMMANDS: Readonly<Record<string, ViewerCommand>> = {
  select: { kind: "select" },
  "clear selection": { kind: "clear" },
  track: { kind: "track" },
  "stop tracking": { kind: "tracking-stop" },
  "stop voice": { kind: "voice-stop" },
}

export const viewerCommandPhrases = Object.keys(COMMANDS)

export function normalizeCommand(text: string) {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ")
}

export function parseViewerCommand(text: string): ViewerCommand | null {
  const phrase = normalizeCommand(text)
  return Object.hasOwn(COMMANDS, phrase) ? COMMANDS[phrase]! : null
}
