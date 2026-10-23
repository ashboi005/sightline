import { useCallback, useEffect, useRef, useState } from "react"
import {
  cameraFrameGeometry,
  normalizeCameraTransform,
  readCameraTransform,
  saveCameraTransform,
  type CameraTransform,
} from "./camera-transform"
import type {
  FrameDimensions,
  FrameSettings,
  Point,
  TrackingFrame,
} from "./eye-tracking.types"
import { NetworkCamera, type NetworkConnectionState } from "./network-camera"
import {
  readTrackerPreferences,
  resizeTrackerSettings,
  saveTrackerPreferences,
} from "./tracker-preferences"
import { useTrackerWorker } from "./use-tracker-worker"
import type {
  TrackerController,
  TrackerRuntimeState,
  TrackerSource,
} from "./use-tracker.types"
import {
  getCameraErrorMessage,
  getVideoErrorMessage,
  waitForVideoDimensions,
} from "./video-source"
export const DEFAULT_SETTINGS: FrameSettings = {
  format: "spatial",
  roi: { x: 0, y: 0, width: 640, height: 480 },
  threshold: 0,
  thresholdMode: "auto",
  fov: 45,
  radiusMm: 12,
  corners: null,
  locked: false,
}
const DEFAULT_DIMENSIONS: FrameDimensions = { width: 640, height: 480 }
function defaultSettingsFor(
  format: FrameSettings["format"],
  dimensions: FrameDimensions
): FrameSettings {
  const classic = format === "classic"
  return {
    ...DEFAULT_SETTINGS,
    format,
    roi: { x: 0, y: 0, ...dimensions },
    threshold: classic ? 50 : 0,
    thresholdMode: classic ? "manual" : "auto",
  }
}
export function useTracker(): TrackerController {
  const [transform, setTransformState] = useState(() =>
    readCameraTransform("eye")
  )
  const [connection, setConnection] = useState<NetworkConnectionState>("idle")
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [preferences] = useState(readTrackerPreferences)
  const preferencesRef = useRef(preferences)
  const activeFormat = "spatial"
  const savedSettings = preferences[activeFormat]
  const initialDimensions = savedSettings?.frameDimensions ?? DEFAULT_DIMENSIONS
  const [settings, setSettings] = useState<FrameSettings>(() =>
    savedSettings
      ? { ...savedSettings.settings, locked: false }
      : defaultSettingsFor(activeFormat, initialDimensions)
  )
  const [dimensions, setDimensions] =
    useState<FrameDimensions>(initialDimensions)
  const dimensionsRef = useRef(dimensions)
  const [frame, setFrame] = useState<TrackingFrame | null>(null)
  const [source, setSource] = useState<TrackerSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [engineReady, setEngineReady] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    preferencesRef.current = saveTrackerPreferences(
      preferencesRef.current,
      settings,
      dimensions
    )
  }, [dimensions, settings])
  const sourceCanvas = useRef<HTMLCanvasElement | null>(null)
  const latest = useRef<TrackingFrame | null>(null)
  const control = useRef<TrackerRuntimeState>({
    settings,
    source: null,
    video: null,
    network: null,
    networkFrame: null,
    lastNetworkSequence: -1,
    networkInterruptedAt: 0,
    transform,
    inputDimensions: DEFAULT_DIMENSIONS,
    stream: null,
    url: "",
    generation: 0,
    sourceEpoch: 0,
    sequence: 0,
    inflight: false,
    inflightGeneration: -1,
    worker: null,
    ready: false,
    previewMasksEnabled: false,
    sampleTarget: null,
    blink: false,
    lastVideoTime: -1,
  })
  const clearFrame = useCallback(() => {
    latest.current = null
    setFrame(null)
  }, [])
  const refreshDevices = useCallback(async () => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.enumerateDevices) {
      return
    }
    try {
      const list = await mediaDevices.enumerateDevices()
      setDevices(list.filter((device) => device.kind === "videoinput"))
    } catch {
      // Camera enumeration can be unavailable until the browser grants access.
    }
  }, [])
  useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    void refreshDevices()
    if (!mediaDevices?.addEventListener) {
      return
    }
    const handleDeviceChange = () => void refreshDevices()
    mediaDevices.addEventListener("devicechange", handleDeviceChange)
    return () =>
      mediaDevices.removeEventListener("devicechange", handleDeviceChange)
  }, [refreshDevices])
  const stopSource = useCallback(
    (preserveModel = false) => {
      const c = control.current
      if (!preserveModel) {
        c.generation++
      }
      c.sourceEpoch++
      // The worker still owns any submitted frame. Its stale response releases
      // that request before a restarted source can submit the next frame.
      c.stream?.getTracks().forEach((track) => track.stop())
      c.stream = null
      c.network?.stop()
      c.network = null
      c.networkFrame = null
      c.lastNetworkSequence = -1
      setConnection("idle")
      setReconnectAttempt(0)
      if (c.video) {
        c.video.pause()
        c.video.srcObject = null
        c.video.removeAttribute("src")
        c.video.load()
        c.video = null
      }
      if (c.url) {
        URL.revokeObjectURL(c.url)
      }
      c.url = ""
      c.source = null
      c.lastVideoTime = -1
      c.sampleTarget = null
      if (!preserveModel) {
        c.settings = { ...c.settings, locked: false }
      }
      setSettings(c.settings)
      if (sourceCanvas.current) {
        const canvas = sourceCanvas.current
        canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height)
      }
      setSource(null)
      setBusy(false)
      clearFrame()
    },
    [clearFrame]
  )
  const stop = useCallback(() => stopSource(), [stopSource])
  const configure = useCallback(
    (next: Partial<FrameSettings>, invalidate = true) => {
      const c = control.current
      const changingFormat = !!next.format && next.format !== c.settings.format
      let nextSettings: FrameSettings
      if (changingFormat && next.format) {
        preferencesRef.current = saveTrackerPreferences(
          preferencesRef.current,
          c.settings,
          dimensionsRef.current
        )
        const saved = preferencesRef.current[next.format]
        const nextDimensions = c.source
          ? dimensionsRef.current
          : (saved?.frameDimensions ?? dimensionsRef.current)
        let baseSettings: FrameSettings
        if (saved && c.source) {
          baseSettings = resizeTrackerSettings(saved, nextDimensions)
        } else if (saved) {
          baseSettings = { ...saved.settings, locked: false }
        } else {
          baseSettings = defaultSettingsFor(next.format, nextDimensions)
        }
        nextSettings = { ...baseSettings, ...next }
        if (!c.source && saved) {
          dimensionsRef.current = saved.frameDimensions
          setDimensions(saved.frameDimensions)
        }
      } else {
        nextSettings = { ...c.settings, ...next }
      }
      c.settings = {
        ...nextSettings,
        ...(invalidate ? { locked: false } : {}),
      }
      if (changingFormat) {
        preferencesRef.current = saveTrackerPreferences(
          preferencesRef.current,
          c.settings,
          dimensionsRef.current
        )
      }
      if (invalidate) {
        c.generation++
        clearFrame()
      }
      setSettings(c.settings)
    },
    [clearFrame]
  )
  const activate = useCallback(
    (
      next: TrackerSource,
      video: HTMLVideoElement | null,
      frameSize?: FrameDimensions,
      previousSource: TrackerSource | null = null
    ) => {
      const c = control.current
      const inputWidth =
        video?.videoWidth ?? frameSize?.width ?? DEFAULT_DIMENSIONS.width
      const inputHeight =
        video?.videoHeight ?? frameSize?.height ?? DEFAULT_DIMENSIONS.height
      const rotated = cameraFrameGeometry(inputWidth, inputHeight, c.transform)
      const scale = Math.min(
        DEFAULT_DIMENSIONS.width / rotated.width,
        DEFAULT_DIMENSIONS.height / rotated.height,
        1
      )
      const width = Math.max(2, Math.round(rotated.width * scale))
      const height = Math.max(2, Math.round(rotated.height * scale))
      const sameSource =
        previousSource?.kind === next.kind &&
        (next.kind === "camera"
          ? previousSource.deviceId === next.deviceId
          : previousSource.url === next.url)
      const preserveModel =
        c.settings.locked &&
        sameSource &&
        inputWidth === c.inputDimensions.width &&
        inputHeight === c.inputDimensions.height &&
        width === dimensionsRef.current.width &&
        height === dimensionsRef.current.height
      c.inputDimensions = { width: inputWidth, height: inputHeight }
      if (!preserveModel) {
        if (c.settings.locked) {
          c.generation++
        }
        c.settings = resizeTrackerSettings(
          {
            frameDimensions: dimensionsRef.current,
            settings: c.settings,
          },
          { width, height }
        )
      }
      c.video = video
      c.source = next
      const canvas = sourceCanvas.current ?? document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      sourceCanvas.current = canvas
      dimensionsRef.current = { width, height }
      setDimensions(dimensionsRef.current)
      setSettings(c.settings)
      setSource(next)
      setBusy(false)
      setConnection("live")
    },
    []
  )
  const startCamera = useCallback(
    async (deviceId: string, excludedDeviceId?: string) => {
      const previousSource = control.current.source
      const reconnecting =
        previousSource?.kind === "camera" &&
        (!deviceId || previousSource.deviceId === deviceId)
      stopSource(reconnecting && control.current.settings.locked)
      setBusy(true)
      setError("")
      const c = control.current
      const generation = c.sourceEpoch
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "Camera access needs localhost or HTTPS in a supported browser."
          )
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
            width: { ideal: DEFAULT_DIMENSIONS.width },
            height: { ideal: DEFAULT_DIMENSIONS.height },
          },
          audio: false,
        })
        if (generation !== c.sourceEpoch) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        c.stream = stream
        const actualId =
          stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId
        if (excludedDeviceId && actualId === excludedDeviceId) {
          throw new Error(
            "Choose different USB devices for the eye camera and the scene camera."
          )
        }
        const video = document.createElement("video")
        video.muted = true
        video.playsInline = true
        video.srcObject = stream
        c.video = video
        await video.play()
        await waitForVideoDimensions(video)
        if (generation !== c.sourceEpoch) {
          return
        }
        activate(
          {
            kind: "camera",
            name: stream.getVideoTracks()[0]?.label || "Camera",
            deviceId:
              stream.getVideoTracks()[0]?.getSettings?.().deviceId || deviceId,
          },
          video,
          undefined,
          reconnecting ? previousSource : null
        )
        stream.getVideoTracks()[0]?.addEventListener(
          "ended",
          () => {
            if (c.stream === stream) {
              stop()
              setError("Camera disconnected. Reconnect it and start again.")
            }
          },
          { once: true }
        )
        void refreshDevices()
      } catch (cause) {
        if (generation === c.sourceEpoch) {
          stop()
          setError(getCameraErrorMessage(cause))
        }
      }
    },
    [stop, stopSource, activate, refreshDevices]
  )
  const startNetworkStream = useCallback(
    async (input: string) => {
      const url = input.trim()
      const previousSource = control.current.source
      const reconnecting =
        previousSource?.kind === "network" && previousSource.url === url
      stopSource(reconnecting && control.current.settings.locked)
      setError("")
      const c = control.current
      const epoch = c.sourceEpoch
      const next: TrackerSource = { kind: "network", name: url, url }
      const network = new NetworkCamera({
        onStatus: (state, attempt) => {
          if (epoch !== c.sourceEpoch) {
            return
          }
          setConnection(state)
          setReconnectAttempt(attempt)
          setBusy(state === "connecting" || state === "reconnecting")
        },
        onError: (message) => {
          if (epoch === c.sourceEpoch) {
            setError(message)
            setBusy(false)
          }
        },
        onFrame: (frame) => {
          if (epoch !== c.sourceEpoch) {
            return
          }
          c.networkFrame = frame
          if (!frame) {
            c.networkInterruptedAt = performance.now()
            clearFrame()
            return
          }
          const resized =
            c.inputDimensions.width !== frame.width ||
            c.inputDimensions.height !== frame.height
          if (!c.source || resized) {
            if (c.source) {
              c.generation++
              clearFrame()
            }
            activate(
              {
                ...next,
                key: url + ":" + epoch + ":" + frame.width + "x" + frame.height,
              },
              null,
              { width: frame.width, height: frame.height },
              reconnecting ? previousSource : null
            )
          }
        },
      })
      c.network = network
      await network.start(url)
    },
    [stopSource, activate, clearFrame]
  )
  const setTransform = useCallback(
    (value: CameraTransform) => {
      const c = control.current
      const next = normalizeCameraTransform(value)
      if (JSON.stringify(c.transform) === JSON.stringify(next)) {
        return
      }
      c.transform = next
      saveCameraTransform("eye", next)
      setTransformState(next)
      const rotated = cameraFrameGeometry(
        c.inputDimensions.width,
        c.inputDimensions.height,
        next
      )
      const scale = Math.min(640 / rotated.width, 480 / rotated.height, 1)
      const size = {
        width: Math.max(2, Math.round(rotated.width * scale)),
        height: Math.max(2, Math.round(rotated.height * scale)),
      }
      dimensionsRef.current = size
      setDimensions(size)
      if (sourceCanvas.current) {
        sourceCanvas.current.width = size.width
        sourceCanvas.current.height = size.height
      }
      c.settings = {
        ...c.settings,
        roi: { x: 0, y: 0, ...size },
        corners: null,
        locked: false,
      }
      c.generation++
      c.lastNetworkSequence = -1
      c.lastVideoTime = -1
      setSettings(c.settings)
      clearFrame()
    },
    [clearFrame]
  )
  const startVideo = useCallback(
    async (file: File) => {
      stop()
      setBusy(true)
      setError("")
      const c = control.current
      const generation = c.sourceEpoch
      try {
        c.url = URL.createObjectURL(file)
        const video = document.createElement("video")
        video.muted = true
        video.playsInline = true
        video.loop = true
        video.src = c.url
        c.video = video
        await video.play()
        await waitForVideoDimensions(video)
        if (generation !== c.sourceEpoch) {
          return
        }
        activate({ kind: "video", name: file.name }, video)
      } catch (cause) {
        if (generation === c.sourceEpoch) {
          stop()
          setError(getVideoErrorMessage(cause))
        }
      }
    },
    [stop, activate]
  )
  const startSample = useCallback(() => {
    stop()
    setError("")
    activate({ kind: "sample", name: "Synthetic eye sample" }, null)
  }, [stop, activate])
  const setSampleTarget = useCallback((point: Point | null) => {
    control.current.sampleTarget = point
  }, [])
  const setPreviewMasksEnabled = useCallback((enabled: boolean) => {
    control.current.previewMasksEnabled = enabled
  }, [])
  const setBlink = useCallback((value: boolean) => {
    control.current.blink = value
  }, [])
  useTrackerWorker({ control, latest }, sourceCanvas, {
    clearFrame,
    stop,
    setEngineReady,
    setError,
    setFrame,
  })
  return {
    transform,
    setTransform,
    connection,
    reconnectAttempt,
    dimensions,
    settings,
    configure,
    frame,
    latest,
    source,
    sourceCanvas,
    busy,
    error,
    setError,
    engineReady,
    devices,
    startCamera,
    startNetworkStream,
    startVideo,
    startSample,
    stop,
    setSampleTarget,
    setPreviewMasksEnabled,
    setBlink,
  }
}
