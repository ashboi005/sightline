import type { SceneSession, SceneSessionSnapshot } from "./scene-session"

export type ValidationRecoveryControlsProps = {
  onCorrect: () => void
  session: SceneSession
  state: SceneSessionSnapshot
  canCapture: boolean
  prepare?: () => void
}
