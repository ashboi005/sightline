import type { GazeMeasurement } from "./scene.types"
import type { SessionLog } from "./session.types"
export type { SessionLog } from "./session.types"
export function createSessionLog(
  startedAt: number,
  metadata: Record<string, unknown>
): SessionLog {
  return {
    createdAt: new Date().toISOString(),
    startedAt,
    endedAt: null,
    timeOrigin: performance.timeOrigin,
    metadata,
    measurements: [],
    hands: [],
    truncated: false,
  }
}
export function appendMeasurement(
  session: SessionLog,
  measurement: GazeMeasurement
) {
  if (
    !Number.isFinite(measurement.timestamp) ||
    measurement.timestamp < session.startedAt ||
    session.endedAt !== null
  ) {
    return
  }
  const previous = session.measurements.at(-1)
  if (
    previous &&
    previous.eyeId === measurement.eyeId &&
    previous.sceneId === measurement.sceneId &&
    previous.valid === measurement.valid &&
    previous.reason === measurement.reason
  ) {
    return
  }
  if (session.measurements.length >= 18000) {
    session.truncated = true
    return
  }
  session.measurements.push({ ...measurement })
}
const cell = (value: string | number | boolean | null) =>
  value === null ? "" : `"${String(value).replaceAll('"', '""')}"`
export function exportSessionCsv(session: SessionLog): string {
  const header =
    "session_ms,timestamp_ms,eye_frame_id,scene_frame_id,eye_timestamp_ms,scene_timestamp_ms,confidence,normalized_x,normalized_y,pixel_x,pixel_y,valid,reason,extrapolated,estimated,preview"
  const number = (n: number | null | undefined) =>
    n === null || n === undefined || !Number.isFinite(n) ? "" : String(n)
  const rows = session.measurements.map((m) =>
    [
      number(m.timestamp - session.startedAt),
      number(m.timestamp),
      number(m.eyeId),
      number(m.sceneId),
      number(m.eyeTimestamp),
      number(m.sceneTimestamp),
      number(m.confidence),
      number(m.position?.[0]),
      number(m.position?.[1]),
      number(m.pixels?.[0]),
      number(m.pixels?.[1]),
      m.valid ? "1" : "0",
      cell(m.reason),
      m.extrapolated ? "1" : "0",
      m.estimated ? "1" : "0",
      m.preview ? "1" : "0",
    ].join(",")
  )
  return [header, ...rows].join("\n") + "\n"
}
export function exportSessionJson(session: SessionLog): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      coordinates:
        "camera-image: normalized x right / y down; pixels in native scene dimensions",
      timestamps:
        "monotonic performance.now() milliseconds; epoch = timeOrigin + timestamp; session_ms relative to startedAt",
      ...session,
    },
    null,
    2
  )
}
