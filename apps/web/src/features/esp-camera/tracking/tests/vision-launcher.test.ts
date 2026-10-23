import { expect, test } from "bun:test"
import { applicationServerArguments } from "../../../../../scripts/run-with-vision"

test("the vision launcher keeps Sightline's development port and webpack mode", () => {
  expect(applicationServerArguments("/next-cli", "dev", [], "/node")).toEqual([
    "/node", "/next-cli", "dev", "--webpack", "--port", "3001",
  ])
})

test("an explicitly supplied Next port is preserved without duplicate defaults", () => {
  expect(applicationServerArguments("/next-cli", "start", ["--port", "4016", "--hostname", "127.0.0.1"], "/node")).toEqual([
    "/node", "/next-cli", "start", "--port", "4016", "--hostname", "127.0.0.1",
  ])
  expect(applicationServerArguments("/next-cli", "dev", ["-p", "4017"], "/node")).toEqual([
    "/node", "/next-cli", "dev", "--webpack", "-p", "4017",
  ])
})
