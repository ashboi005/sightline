import { expect, test } from "bun:test"
import { parseViewerCommand } from "../commands"

test("only explicit complete ESP camera commands can change tracking state", () => {
  expect(parseViewerCommand("select")).toEqual({ kind: "select" })
  expect(parseViewerCommand("clear selection")).toEqual({ kind: "clear" })
  expect(parseViewerCommand("  TRACK! ")).toEqual({ kind: "track" })
  expect(parseViewerCommand("stop   tracking")).toEqual({ kind: "tracking-stop" })
  expect(parseViewerCommand("stop voice")).toEqual({ kind: "voice-stop" })
  for (const text of ["", "please track", "track it", "don't track", "select track", "clear", "take photo", "scene camera"]) {
    expect(parseViewerCommand(text)).toBeNull()
  }
})
