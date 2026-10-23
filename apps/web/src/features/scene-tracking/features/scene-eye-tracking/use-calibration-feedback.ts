import { useCallback, useEffect, useRef, useState } from "react"
import { MAX_FRAME_AGE_MS } from "./calibration"
import type { SceneSession } from "./scene-session"
import type { CalibrationHold, CollectionResult } from "./scene.types"
import type { Cue } from "./use-calibration-feedback.types"
const CUES = {
  locked: [[520, 0, 0.1]],
  lost: [[140, 0, 0.18]],
  saved: [
    [880, 0, 0.08],
    [1320, 0.12, 0.1],
  ],
} satisfies Record<Cue, number[][]>
function createTone(audio: AudioContext, frequency: number, volume: number) {
  const tone = audio.createOscillator()
  const gain = audio.createGain()
  tone.frequency.value = frequency
  gain.gain.setValueAtTime(0, audio.currentTime)
  gain.gain.linearRampToValueAtTime(volume, audio.currentTime + 0.01)
  tone.connect(gain)
  gain.connect(audio.destination)
  tone.onended = () => {
    tone.disconnect()
    gain.disconnect()
  }
  return { tone, gain }
}
function playCue(audio: AudioContext, cue: Cue) {
  for (const [frequency, delay, duration] of CUES[cue]) {
    const { tone, gain } = createTone(audio, frequency, 0.1)
    const start = audio.currentTime + delay
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(0.1, start + 0.01)
    gain.gain.linearRampToValueAtTime(0, start + duration)
    tone.start(start)
    tone.stop(start + duration + 0.01)
  }
}
const SOUND_KEY = "sightline.scene.point-sound"
export function useCalibrationFeedback(session: SceneSession) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off"
    } catch {
      return true
    }
  })
  const context = useRef<AudioContext | null>(null)
  const lastSaved = useRef<CalibrationHold | null>(null)
  const previous = useRef<CollectionResult | null>(null)
  const progressTone = useRef<ReturnType<typeof createTone> | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastBuzz = useRef(-Infinity)
  const stopProgress = useCallback(() => {
    if (deadline.current) {
      clearTimeout(deadline.current)
    }
    deadline.current = null
    const current = progressTone.current
    const audio = context.current
    progressTone.current = null
    if (!current || !audio) {
      return
    }
    try {
      current.gain.gain.cancelScheduledValues(audio.currentTime)
      current.gain.gain.setValueAtTime(0.04, audio.currentTime)
      current.gain.gain.linearRampToValueAtTime(0, audio.currentTime + 0.02)
      current.tone.stop(audio.currentTime + 0.03)
    } catch {
      /* A disconnected audio device cannot interrupt collection. */
    }
  }, [])
  // Unlock audio from a click/Space gesture, never by requesting a permission.
  const unlockAudio = useCallback(() => {
    try {
      context.current ??= new AudioContext()
      void context.current.resume().catch(() => {})
    } catch {
      /* Audio is optional; capture remains available. */
    }
  }, [])
  const prepare = useCallback(() => {
    if (enabled) {
      unlockAudio()
    }
  }, [enabled, unlockAudio])
  useEffect(
    () =>
      session.subscribe(() => {
        const collection = session.getSnapshot().collection
        const before = previous.current
        previous.current = collection
        if (!collection) {
          stopProgress()
          return
        }
        const saved = collection?.holds.at(-1)
        const audio = context.current
        const canPlay = enabled && audio?.state === "running"
        const buzz = () => {
          if (!canPlay || performance.now() - lastBuzz.current < 1000) {
            return
          }
          lastBuzz.current = performance.now()
          playCue(audio, "lost")
        }
        let cue: Cue | null = null
        if (
          collection.status === "saved" &&
          saved &&
          saved !== lastSaved.current
        ) {
          lastSaved.current = saved
          cue = "saved"
        } else if (
          collection.status === "capturing" &&
          collection.samples > 0
        ) {
          if (!before || before.samples === 0) {
            cue = "locked"
          }
        }
        try {
          if (collection.status !== "capturing" || !canPlay) {
            stopProgress()
            if (
              collection.armed &&
              before?.armed &&
              ((collection.status === "paused" && before.status !== "paused") ||
                (before.status === "capturing" &&
                  collection.status === "settling"))
            ) {
              buzz()
            }
          } else if (collection.samples > (before?.samples ?? 0)) {
            if (!progressTone.current) {
              progressTone.current = createTone(audio, 660, 0.04)
              progressTone.current.tone.start()
            }
            if (deadline.current) {
              clearTimeout(deadline.current)
            }
            // Renew only from new paired samples. Repaints cannot sustain sound.
            deadline.current = setTimeout(() => {
              stopProgress()
              if (session.getSnapshot().collection?.armed) {
                try {
                  buzz()
                } catch {
                  /* Optional audio. */
                }
              }
            }, MAX_FRAME_AGE_MS)
          }
          if (cue && canPlay) {
            playCue(audio, cue)
          }
        } catch {
          /* A failed audio device must never interrupt collection. */
        }
      }),
    [enabled, session, stopProgress]
  )
  useEffect(() => {
    if (!enabled) {
      stopProgress()
    }
  }, [enabled, stopProgress])
  useEffect(
    () => () => {
      stopProgress()
      void context.current?.close().catch(() => {})
    },
    [stopProgress]
  )
  const toggle = () => {
    const next = !enabled
    if (next) {
      unlockAudio()
    } else {
      stopProgress()
    }
    setEnabled(next)
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off")
    } catch {
      /* Preference storage is optional. */
    }
  }
  return { enabled, prepare, toggle }
}
