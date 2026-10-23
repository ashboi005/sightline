import { normalizeCommand } from "../esp-camera/voice/commands";

const commands = {
  select: "select",
  focus: "select",
  "clear selection": "clear",
  "stop listening": "clear",
  "stop voice": "voice-stop",
} as const;
export const focusCommandPhrases = Object.keys(commands);
export function parseFocusCommand(text: string) {
  const phrase = normalizeCommand(text);
  return Object.hasOwn(commands, phrase)
    ? commands[phrase as keyof typeof commands]
    : null;
}
