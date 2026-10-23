import {
  Camera,
  Contrast,
  Crop,
  Image as ImageIcon,
  Pencil,
  Plus,
} from "lucide-react"
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import {
  CameraRecoveryBannerStyles,
  EyeCameraOutlineStyles,
  EyeCornerModeSwitchStyles,
  EyeManualCornerHandleStyles,
  EyeManualCornerLayerStyles,
  EyeManualModelLineStyles,
  EyeManualModelMoveTargetStyles,
  EyeManualModelOverlayStyles,
  EyePreviewEmptyStyles,
  EyePreviewHeadingStyles,
  EyePreviewImageStyles,
  EyePreviewStageStyles,
  EyePreviewStyles,
  EyePreviewSwitchStyles,
  EyePreviewToolsStyles,
  EyeRoiEditStyles,
  EyeRoiHandleStyles,
  EyeRoiOverlayStyles,
  EyeRoiToolbarStyles,
} from "../../tracking-ui/camera-styles"
import { StatusLightStyles } from "../../tracking-ui/layout-styles"
import { setCanvasDimensions } from "../canvas-sizing"
import type { Ellipse, Point, Rect } from "../eye-tracking.types"
import { fitPreviewCard, fitSquarePreview } from "../preview-layout"
import { moveRegion, regionFromPoints, resizeRegion } from "../roi"
import type { ResizeHandle } from "../roi.types"
import { CameraTransformControls } from "./camera-transform-controls"
import type {
  EyePreviewDrawingOptions,
  EyePreviewHandleDefinition,
  EyePreviewProps,
  ManualCornerGesture,
  ManualCornerSelection,
  RegionGesture,
} from "./eye-preview.types"
const HANDLES: EyePreviewHandleDefinition[] = [
  { handle: "nw", label: "top left", x: 0, y: 0 },
  { handle: "n", label: "top", x: 50, y: 0 },
  { handle: "ne", label: "top right", x: 100, y: 0 },
  { handle: "e", label: "right", x: 100, y: 50 },
  { handle: "se", label: "bottom right", x: 100, y: 100 },
  { handle: "s", label: "bottom", x: 50, y: 100 },
  { handle: "sw", label: "bottom left", x: 0, y: 100 },
  { handle: "w", label: "left", x: 0, y: 50 },
]
function drawEllipse(
  ctx: CanvasRenderingContext2D,
  e: Ellipse,
  offset: Point,
  color: string
) {
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(
    e.center[0] + offset[0],
    e.center[1] + offset[1],
    e.major,
    e.minor,
    e.angle,
    0,
    2 * Math.PI
  )
  ctx.stroke()
}
function moveCornerPair(
  corners: [Point, Point],
  delta: Point,
  width: number,
  height: number
): [Point, Point] {
  const minX = Math.min(corners[0][0], corners[1][0])
  const maxX = Math.max(corners[0][0], corners[1][0])
  const minY = Math.min(corners[0][1], corners[1][1])
  const maxY = Math.max(corners[0][1], corners[1][1])
  const dx = Math.max(-minX, Math.min(width - maxX, delta[0]))
  const dy = Math.max(-minY, Math.min(height - maxY, delta[1]))
  return [
    [corners[0][0] + dx, corners[0][1] + dy],
    [corners[1][0] + dx, corners[1][1] + dy],
  ]
}
function resizeCornerPair(
  corners: [Point, Point],
  index: number,
  point: Point,
  width: number,
  height: number
): [Point, Point] {
  const center: Point = [
    (corners[0][0] + corners[1][0]) / 2,
    (corners[0][1] + corners[1][1]) / 2,
  ]
  const direction = index === 0 ? -1 : 1
  const dx = (point[0] - center[0]) * direction
  const dy = (point[1] - center[1]) * direction
  const requestedRadius = Math.hypot(dx, dy)
  if (requestedRadius === 0) {
    return corners
  }
  const unit: Point = [dx / requestedRadius, dy / requestedRadius]
  let maximumRadius = Number.POSITIVE_INFINITY
  if (unit[0] > 0) {
    maximumRadius = Math.min(maximumRadius, (width - center[0]) / unit[0])
  } else if (unit[0] < 0) {
    maximumRadius = Math.min(maximumRadius, -center[0] / unit[0])
  }
  if (unit[1] > 0) {
    maximumRadius = Math.min(maximumRadius, (height - center[1]) / unit[1])
  } else if (unit[1] < 0) {
    maximumRadius = Math.min(maximumRadius, -center[1] / unit[1])
  }
  const radius = Math.min(requestedRadius, maximumRadius)
  return [
    [center[0] - unit[0] * radius, center[1] - unit[1] * radius],
    [center[0] + unit[0] * radius, center[1] + unit[1] * radius],
  ]
}
export function drawEyePreviewFrame(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  {
    frame,
    roi,
    corners,
    selection = null,
    selectRegion = false,
    showModel = true,
    cornerMode = null,
    view = "image",
  }: EyePreviewDrawingOptions
) {
  setCanvasDimensions(canvas, source.width, source.height)
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return
  }
  const colors = getComputedStyle(canvas)
  ctx.drawImage(source, 0, 0)
  const preview = frame?.detection.previews[frame.detection.selected]
  if (view === "threshold") {
    ctx.fillStyle = "#111111"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (preview?.mask && frame) {
      const image = ctx.createImageData(frame.roi.width, frame.roi.height)
      for (let i = 0; i < preview.mask.length; i++) {
        const j = i * 4
        image.data[j] = image.data[j + 1] = image.data[j + 2] = preview.mask[i]
        image.data[j + 3] = 255
      }
      ctx.putImageData(image, frame.roi.x, frame.roi.y)
    }
  }
  const rect = selection ?? roi
  ctx.fillStyle = "rgba(0,0,0,.42)"
  ctx.beginPath()
  ctx.rect(0, 0, canvas.width, canvas.height)
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.fill("evenodd")
  ctx.strokeStyle = selectRegion
    ? "#fafafa"
    : colors.getPropertyValue("--eye-pupil").trim() || "#a7d7c5"
  ctx.lineWidth = 1.5
  ctx.setLineDash([7, 5])
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.setLineDash([])
  const candidate = frame?.detection.candidate
  if (!frame?.detection.ellipse && candidate) {
    ctx.setLineDash([4, 4])
    drawEllipse(
      ctx,
      candidate,
      [roi.x, roi.y],
      colors.getPropertyValue("--eye-ray").trim() || "#edd7a4"
    )
    ctx.setLineDash([])
  }
  if (frame?.detection.ellipse) {
    drawEllipse(
      ctx,
      frame.detection.ellipse,
      [roi.x, roi.y],
      colors.getPropertyValue("--eye-pupil").trim() || "#a7d7c5"
    )
    const p = frame.detection.ellipse.center
    ctx.fillStyle = "#fafafa"
    ctx.beginPath()
    ctx.arc(p[0] + roi.x, p[1] + roi.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (showModel && frame?.model && view === "image") {
    const m = frame.model
    ctx.strokeStyle =
      colors.getPropertyValue("--eye-sphere").trim() || "#b8cafa"
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(...m.center, m.radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(m.center[0] - 6, m.center[1])
    ctx.lineTo(m.center[0] + 6, m.center[1])
    ctx.moveTo(m.center[0], m.center[1] - 6)
    ctx.lineTo(m.center[0], m.center[1] + 6)
    ctx.stroke()
    if (frame.detection.ellipse) {
      ctx.strokeStyle = colors.getPropertyValue("--eye-ray").trim() || "#edd7a4"
      ctx.beginPath()
      ctx.moveTo(...m.center)
      ctx.lineTo(
        frame.detection.ellipse.center[0] + roi.x,
        frame.detection.ellipse.center[1] + roi.y
      )
      ctx.stroke()
    }
  }
  if (cornerMode !== "edit") {
    for (const p of corners ?? []) {
      ctx.fillStyle = colors.getPropertyValue("--eye-ray").trim() || "#edd7a4"
      ctx.beginPath()
      ctx.arc(...p, 5, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
export function EyePreview({
  tracker,
  selectRegion,
  cornerMode,
  pendingCorner,
  onRegion,
  onCorner,
  onCornerModeChange,
  onMoveCorners,
  onMovePendingCorner,
  onEditRegion,
  onThresholdViewChange,
  showModel = false,
  onTransformChange,
  transformDisabled = false,
  readOnly = false,
}: EyePreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<RegionGesture | null>(null)
  const cornerGesture = useRef<ManualCornerGesture | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [cornerSelection, setCornerSelection] =
    useState<ManualCornerSelection | null>(null)
  const [redraw, setRedraw] = useState(false)
  const [view, setView] = useState<"image" | "threshold">("image")
  const { frame, dimensions } = tracker
  const roi = tracker.settings.roi
  const displayRegion = selection ?? roi
  let previewClassName = ""
  if (selectRegion) {
    previewClassName = redraw ? "selectable" : "movable"
  } else if (cornerMode === "create") {
    previewClassName = "selectable"
  }
  let previewLabel = "Eye camera preview"
  if (selectRegion) {
    previewLabel =
      "Eye region editor. Arrow keys move; Shift and arrows resize; Alt uses 10 pixel steps."
  } else if (cornerMode === "create" && pendingCorner) {
    previewLabel =
      "Eye camera preview. Drag the first corner if needed, then select the other corner."
  } else if (cornerMode === "edit" && tracker.settings.corners) {
    previewLabel =
      "Eye camera preview. Drag a plus endpoint to resize the eye model, or drag inside its circle to move it."
  } else if (cornerMode === "create") {
    previewLabel = "Eye camera preview. Click to place the first eye corner."
  }
  useEffect(() => {
    if (view === "threshold") {
      onThresholdViewChange?.(true)
    }
  }, [onThresholdViewChange, view])
  useLayoutEffect(() => {
    const preview = previewRef.current
    const previewCard = preview?.closest<HTMLElement>(".eye-preview-card")
    const workspace = previewCard?.parentElement
    const stage = preview?.querySelector<HTMLElement>(".eye-preview-stage")
    const emptyStage = preview?.querySelector<HTMLElement>(".eye-preview-empty")
    const hasSource = !!tracker.source
    if (
      !preview ||
      !previewCard ||
      !workspace ||
      (hasSource && !stage) ||
      (!hasSource && !emptyStage)
    ) {
      return
    }
    const Observer = window.ResizeObserver
    if (!Observer) {
      return
    }
    const heading = preview.querySelector<HTMLElement>(".eye-preview-heading")
    const toolbar = preview.querySelector<HTMLElement>(".eye-roi-toolbar")
    const thresholdCard = workspace.querySelector<HTMLElement>(
      ".eye-threshold-controls"
    )
    const details = workspace.querySelector<HTMLElement>(
      ".eye-pipeline-details"
    )
    const resize = () => {
      const workspaceStyle = getComputedStyle(workspace)
      const cardStyle = getComputedStyle(previewCard)
      const previewStyle = getComputedStyle(preview)
      const rowGap = Number.parseFloat(workspaceStyle.rowGap) || 0
      const columnGap = Number.parseFloat(workspaceStyle.columnGap) || 0
      const workspacePaddingWidth =
        (Number.parseFloat(workspaceStyle.paddingLeft) || 0) +
        (Number.parseFloat(workspaceStyle.paddingRight) || 0)
      const workspacePaddingHeight =
        (Number.parseFloat(workspaceStyle.paddingTop) || 0) +
        (Number.parseFloat(workspaceStyle.paddingBottom) || 0)
      const cardBorderWidth =
        (Number.parseFloat(cardStyle.borderLeftWidth) || 0) +
        (Number.parseFloat(cardStyle.borderRightWidth) || 0)
      const cardBorderHeight =
        (Number.parseFloat(cardStyle.borderTopWidth) || 0) +
        (Number.parseFloat(cardStyle.borderBottomWidth) || 0)
      const previewBorderHeight =
        (Number.parseFloat(previewStyle.borderTopWidth) || 0) +
        (Number.parseFloat(previewStyle.borderBottomWidth) || 0)
      const detailsStyle = details && getComputedStyle(details)
      const detailsHeight =
        details && !details.hidden
          ? details.getBoundingClientRect().height +
            (Number.parseFloat(detailsStyle?.marginTop ?? "0") || 0) +
            (Number.parseFloat(detailsStyle?.marginBottom ?? "0") || 0)
          : 0
      const detailsInsideCard = !!details && previewCard.contains(details)
      const thresholdBounds = thresholdCard?.getBoundingClientRect()
      const previewBounds = previewCard.getBoundingClientRect()
      const besideThreshold =
        !!thresholdBounds &&
        thresholdBounds.left < previewBounds.left &&
        thresholdBounds.right <= previewBounds.left + 1
      let externalDetailsHeight = 0
      if (!detailsInsideCard && detailsHeight > 0) {
        externalDetailsHeight = detailsHeight + rowGap
      }
      const availableHeight =
        workspace.clientHeight -
        workspacePaddingHeight -
        externalDetailsHeight -
        (!besideThreshold && thresholdBounds
          ? thresholdBounds.height + rowGap
          : 0)
      const maximumWidth =
        workspace.clientWidth -
        workspacePaddingWidth -
        (besideThreshold ? (thresholdBounds?.width ?? 0) + columnGap : 0) -
        cardBorderWidth
      const maximumHeight = availableHeight - cardBorderHeight
      if (!hasSource) {
        previewCard.style.removeProperty("width")
        previewCard.style.removeProperty("height")
        preview.style.removeProperty("width")
        preview.style.removeProperty("height")
        const fitted = fitSquarePreview(
          preview.clientWidth,
          preview.clientHeight - (heading?.getBoundingClientRect().height ?? 0)
        )
        if (!fitted || !emptyStage) {
          emptyStage?.style.removeProperty("width")
          emptyStage?.style.removeProperty("height")
          return
        }
        emptyStage.style.width = `${fitted.width}px`
        emptyStage.style.height = `${fitted.height}px`
        return
      }
      if (!stage) {
        return
      }
      const chromeHeight =
        (heading?.getBoundingClientRect().height ?? 0) +
        (toolbar?.getBoundingClientRect().height ?? 0) +
        previewBorderHeight
      const fitted = fitPreviewCard(
        dimensions.width,
        dimensions.height,
        maximumWidth,
        maximumHeight,
        chromeHeight,
        detailsInsideCard ? detailsHeight : 0
      )
      if (!fitted) {
        previewCard.style.removeProperty("width")
        previewCard.style.removeProperty("height")
        preview.style.removeProperty("width")
        preview.style.removeProperty("height")
        stage.style.removeProperty("width")
        stage.style.removeProperty("height")
        return
      }
      previewCard.style.width = `${fitted.card.width + cardBorderWidth}px`
      previewCard.style.height = `${fitted.card.height + cardBorderHeight}px`
      preview.style.width = `${fitted.preview.width}px`
      preview.style.height = `${fitted.preview.height}px`
      stage.style.width = `${fitted.image.width}px`
      stage.style.height = `${fitted.image.height}px`
    }
    const observer = new Observer(resize)
    observer.observe(workspace)
    observer.observe(previewCard)
    if (thresholdCard) {
      observer.observe(thresholdCard)
    }
    if (details) {
      observer.observe(details)
    }
    if (heading) {
      observer.observe(heading)
    }
    if (toolbar) {
      observer.observe(toolbar)
    }
    if (emptyStage) {
      observer.observe(emptyStage)
    }
    observer.observe(preview)
    resize()
    return () => observer.disconnect()
  }, [
    dimensions.height,
    dimensions.width,
    selectRegion,
    showModel,
    tracker.source,
  ])
  useEffect(() => {
    const canvas = ref.current
    const source = tracker.sourceCanvas.current
    if (!canvas || !source) {
      return
    }
    drawEyePreviewFrame(canvas, source, {
      frame,
      roi,
      corners: tracker.settings.corners,
      selection,
      selectRegion,
      showModel,
      cornerMode,
      view,
    })
  }, [
    frame,
    tracker.sourceCanvas,
    tracker.settings.corners,
    pendingCorner,
    roi,
    selection,
    cornerMode,
    selectRegion,
    showModel,
    view,
  ])
  function point<T extends Element>(event: PointerEvent<T>): Point {
    const canvas = ref.current!
    const box = canvas.getBoundingClientRect()
    return [
      Math.round(
        Math.max(
          0,
          Math.min(
            dimensions.width,
            ((event.clientX - box.left) * dimensions.width) / box.width
          )
        )
      ),
      Math.round(
        Math.max(
          0,
          Math.min(
            dimensions.height,
            ((event.clientY - box.top) * dimensions.height) / box.height
          )
        )
      ),
    ]
  }
  function getCornerStyle(position: Point) {
    return {
      left: `${(position[0] / dimensions.width) * 100}%`,
      top: `${(position[1] / dimensions.height) * 100}%`,
    }
  }
  function beginGesture(
    event: PointerEvent<HTMLElement>,
    handle?: ResizeHandle
  ) {
    if (event.button !== 0 || gesture.current) {
      return
    }
    const p = point(event)
    if (cornerMode === "create" && !selectRegion) {
      onCorner(p)
      return
    }
    if (!selectRegion) {
      return
    }
    event.preventDefault()
    const inside =
      p[0] >= roi.x &&
      p[0] <= roi.x + roi.width &&
      p[1] >= roi.y &&
      p[1] <= roi.y + roi.height
    gesture.current = {
      pointerId: event.pointerId,
      start: p,
      region: roi,
      mode: handle ?? (redraw || !inside ? "draw" : "move"),
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus()
  }
  function beginCornerGesture(
    event: PointerEvent<Element>,
    index: number | null
  ) {
    if (event.button !== 0 || cornerGesture.current || gesture.current) {
      return
    }
    const savedCorner =
      index === null ? pendingCorner : tracker.settings.corners?.[index]
    if (!savedCorner) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (index === null) {
      cornerGesture.current = {
        pointerId: event.pointerId,
        target: "pending",
        start: savedCorner,
      }
      setCornerSelection({ target: "pending", point: savedCorner })
    } else {
      const corners = tracker.settings.corners
      if (!corners) {
        return
      }
      cornerGesture.current = {
        pointerId: event.pointerId,
        target: "point",
        index,
        start: savedCorner,
        corners: [[...corners[0]], [...corners[1]]],
      }
      setCornerSelection({
        target: "model",
        corners: [[...corners[0]], [...corners[1]]],
      })
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function beginModelGesture(event: PointerEvent<SVGCircleElement>) {
    const corners = tracker.settings.corners
    if (event.button !== 0 || !corners || cornerGesture.current) {
      return
    }
    event.preventDefault()
    cornerGesture.current = {
      pointerId: event.pointerId,
      target: "model",
      start: point(event),
      corners: [[...corners[0]], [...corners[1]]],
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveCornerGesture(event: PointerEvent<HTMLElement>) {
    const current = cornerGesture.current
    if (!current || current.pointerId !== event.pointerId) {
      return false
    }
    const next = point(event)
    if (current.target === "model") {
      const delta: Point = [
        next[0] - current.start[0],
        next[1] - current.start[1],
      ]
      setCornerSelection({
        target: "model",
        corners: moveCornerPair(
          current.corners,
          delta,
          dimensions.width,
          dimensions.height
        ),
      })
    } else if (current.target === "pending") {
      setCornerSelection({ target: "pending", point: next })
    } else {
      setCornerSelection({
        target: "model",
        corners: resizeCornerPair(
          current.corners,
          current.index,
          next,
          dimensions.width,
          dimensions.height
        ),
      })
    }
    return true
  }
  function finishCornerGesture(event: PointerEvent<HTMLElement>) {
    const current = cornerGesture.current
    if (!current || current.pointerId !== event.pointerId) {
      return false
    }
    const next = point(event)
    const moved =
      Math.hypot(next[0] - current.start[0], next[1] - current.start[1]) >= 2
    cornerGesture.current = null
    setCornerSelection(null)
    if (moved) {
      if (current.target === "pending") {
        onMovePendingCorner(next)
      } else if (current.target === "point") {
        onMoveCorners(
          resizeCornerPair(
            current.corners,
            current.index,
            next,
            dimensions.width,
            dimensions.height
          )
        )
      } else {
        const delta: Point = [
          next[0] - current.start[0],
          next[1] - current.start[1],
        ]
        onMoveCorners(
          moveCornerPair(
            current.corners,
            delta,
            dimensions.width,
            dimensions.height
          )
        )
      }
    }
    return true
  }
  function moveCornerWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number | null
  ) {
    const direction: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const delta = direction[event.key]
    const current =
      index === null ? pendingCorner : tracker.settings.corners?.[index]
    if (!delta || !current) {
      return
    }
    event.preventDefault()
    const amount = event.altKey ? 10 : 1
    const next: Point = [
      Math.max(0, Math.min(dimensions.width, current[0] + delta[0] * amount)),
      Math.max(0, Math.min(dimensions.height, current[1] + delta[1] * amount)),
    ]
    if (index === null) {
      onMovePendingCorner(next)
    } else if (tracker.settings.corners) {
      onMoveCorners(
        resizeCornerPair(
          tracker.settings.corners,
          index,
          next,
          dimensions.width,
          dimensions.height
        )
      )
    }
  }
  function moveModelWithKeyboard(event: KeyboardEvent<SVGCircleElement>) {
    const direction: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const delta = direction[event.key]
    const corners = tracker.settings.corners
    if (!delta || !corners) {
      return
    }
    event.preventDefault()
    const amount = event.altKey ? 10 : 1
    onMoveCorners(
      moveCornerPair(
        corners,
        [delta[0] * amount, delta[1] * amount],
        dimensions.width,
        dimensions.height
      )
    )
  }
  function nextRegion(event: PointerEvent<HTMLElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) {
      return null
    }
    const p = point(event)
    const delta: Point = [p[0] - current.start[0], p[1] - current.start[1]]
    if (current.mode === "draw") {
      return regionFromPoints(current.start, p, dimensions)
    }
    if (current.mode === "move") {
      return moveRegion(current.region, delta, dimensions)
    }
    return resizeRegion(current.region, current.mode, delta, dimensions)
  }
  function commitRegion(next: Rect) {
    if (
      next.x !== roi.x ||
      next.y !== roi.y ||
      next.width !== roi.width ||
      next.height !== roi.height
    ) {
      onRegion(next)
    }
  }
  function cancelGesture() {
    gesture.current = null
    cornerGesture.current = null
    setSelection(null)
    setCornerSelection(null)
  }
  function finishGesture(event: PointerEvent<HTMLElement>) {
    if (finishCornerGesture(event)) {
      return
    }
    const current = gesture.current
    const next = nextRegion(event)
    if (!current || !next) {
      return
    }
    const p = point(event)
    const moved =
      Math.hypot(p[0] - current.start[0], p[1] - current.start[1]) >= 2
    cancelGesture()
    setRedraw(false)
    if (moved) {
      commitRegion(next)
    }
  }
  function editWithKeyboard(
    event: KeyboardEvent<HTMLElement>,
    handle?: ResizeHandle
  ) {
    if (!selectRegion) {
      return
    }
    if (event.key === "Escape") {
      cancelGesture()
      setRedraw(false)
      return
    }
    const direction: Record<string, Point> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const delta = direction[event.key]
    if (!delta) {
      return
    }
    event.preventDefault()
    const amount = event.altKey ? 10 : 1
    const change: Point = [delta[0] * amount, delta[1] * amount]
    commitRegion(
      handle || event.shiftKey
        ? resizeRegion(roi, handle ?? "se", change, dimensions)
        : moveRegion(roi, change, dimensions)
    )
  }
  const visiblePendingCorner =
    cornerSelection?.target === "pending"
      ? cornerSelection.point
      : pendingCorner
  const savedCorners = tracker.settings.corners
  let visibleCorners = savedCorners
  if (savedCorners) {
    visibleCorners = [0, 1].map((index) => {
      if (cornerSelection?.target === "model") {
        return cornerSelection.corners[index]
      }
      return savedCorners[index]
    }) as [Point, Point]
  }
  const modelCenter: Point | null = visibleCorners
    ? [
        (visibleCorners[0][0] + visibleCorners[1][0]) / 2,
        (visibleCorners[0][1] + visibleCorners[1][1]) / 2,
      ]
    : null
  const modelRadius = visibleCorners
    ? Math.hypot(
        visibleCorners[1][0] - visibleCorners[0][0],
        visibleCorners[1][1] - visibleCorners[0][1]
      ) / 2
    : 0
  const cameraRecoveryLabel =
    tracker.connection === "waiting"
      ? "Waiting for camera frames…"
      : "Reconnecting eye camera automatically…"
  const regionEditingHint = redraw
    ? "Draw a new box"
    : "Drag to move · handles to resize"
  const canvasTabIndex = selectRegion || cornerMode === "create" ? 0 : undefined
  return (
    <div
      className={`eye-preview ${EyePreviewStyles} ${tracker.source ? "has-source" : "is-empty"}`}
      ref={previewRef}
    >
      <div className={`eye-preview-heading ${EyePreviewHeadingStyles}`}>
        <span>
          <span
            className={
              tracker.source &&
              (!tracker.connection || tracker.connection === "live")
                ? `status-light ${StatusLightStyles} on`
                : `status-light ${StatusLightStyles}`
            }
          />
          Eye camera
        </span>
        {tracker.source && !readOnly && (
          <div className={`eye-preview-tools ${EyePreviewToolsStyles}`}>
            {tracker.transform && (
              <CameraTransformControls
                label="Eye camera"
                value={tracker.transform}
                disabled={transformDisabled}
                onChange={(value) => {
                  tracker.setTransform(value)
                  onTransformChange?.()
                }}
              />
            )}
            <div
              className={`eye-preview-switch ${EyePreviewSwitchStyles}`}
              role="group"
              aria-label="Preview display"
            >
              <button
                aria-label="Show camera image"
                title="Show camera image"
                aria-pressed={view === "image"}
                data-tooltip="Show camera image"
                onClick={() => {
                  setView("image")
                  onThresholdViewChange?.(false)
                }}
              >
                <ImageIcon size={15} aria-hidden="true" />
              </button>
              <button
                aria-label="Show threshold view"
                title="Show threshold view"
                aria-pressed={view === "threshold"}
                data-tooltip="Show threshold view"
                onClick={() => setView("threshold")}
              >
                <Contrast size={15} aria-hidden="true" />
              </button>
            </div>
            {cornerMode && (
              <div
                className={`eye-corner-mode-switch ${EyeCornerModeSwitchStyles}`}
                role="group"
                aria-label="Manual eye model mode"
              >
                <button
                  type="button"
                  aria-label="Create eye model"
                  data-tooltip="Create eye model"
                  aria-pressed={cornerMode === "create"}
                  onClick={() => onCornerModeChange("create")}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Edit eye model"
                  data-tooltip="Edit eye model"
                  aria-pressed={cornerMode === "edit"}
                  disabled={!tracker.settings.corners}
                  onClick={() => onCornerModeChange("edit")}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
              </div>
            )}
            <button
              className={`eye-roi-edit ${EyeRoiEditStyles} ${selectRegion ? "active" : ""}`}
              aria-label="Edit eye region"
              title="Edit eye region"
              data-tooltip="Edit eye region"
              aria-pressed={selectRegion}
              onClick={() => {
                setRedraw(false)
                onEditRegion?.()
                ref.current?.focus()
              }}
            >
              <Crop size={15} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {tracker.source ? (
        <>
          {tracker.source.kind === "network" &&
            (tracker.connection === "waiting" ||
              tracker.connection === "reconnecting") && (
              <div
                className={`camera-recovery-banner ${CameraRecoveryBannerStyles}`}
                role="status"
              >
                {cameraRecoveryLabel}
              </div>
            )}
          {selectRegion && (
            <div className={`eye-roi-toolbar ${EyeRoiToolbarStyles}`}>
              <span>{regionEditingHint}</span>
              <button aria-pressed={redraw} onClick={() => setRedraw(!redraw)}>
                Redraw
              </button>
            </div>
          )}
          <div
            className={`eye-preview-stage ${EyePreviewStageStyles}`}
            style={{
              aspectRatio: dimensions.width / dimensions.height,
            }}
          >
            <div
              className={`eye-preview-image ${EyePreviewImageStyles}`}
              style={{ maxWidth: dimensions.width }}
              onPointerMove={(event) => {
                if (moveCornerGesture(event)) {
                  return
                }
                const next = nextRegion(event)
                if (next) {
                  setSelection(next)
                }
              }}
              onPointerUp={finishGesture}
              onPointerCancel={cancelGesture}
              onLostPointerCapture={cancelGesture}
            >
              <canvas
                ref={ref}
                width={dimensions.width}
                height={dimensions.height}
                aria-label={previewLabel}
                tabIndex={canvasTabIndex}
                className={previewClassName}
                onPointerDown={(event) => beginGesture(event)}
                onKeyDown={(event) => editWithKeyboard(event)}
              />
              {cornerMode && (
                <div
                  className={`eye-manual-corner-layer ${EyeManualCornerLayerStyles}`}
                >
                  {cornerMode === "edit" && modelCenter && (
                    <svg
                      className={`eye-manual-model-overlay ${EyeManualModelOverlayStyles}`}
                      viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
                      aria-label="Manual eye model position controls"
                    >
                      <circle
                        className={`eye-manual-model-line ${EyeManualModelLineStyles}`}
                        cx={modelCenter[0]}
                        cy={modelCenter[1]}
                        r={modelRadius}
                      />
                      <circle
                        className={`eye-manual-model-move-target ${EyeManualModelMoveTargetStyles}`}
                        cx={modelCenter[0]}
                        cy={modelCenter[1]}
                        r={modelRadius}
                        role="button"
                        tabIndex={0}
                        aria-label="Move eye model"
                        onPointerDown={beginModelGesture}
                        onKeyDown={moveModelWithKeyboard}
                      />
                    </svg>
                  )}
                  {cornerMode === "create" && visiblePendingCorner && (
                    <button
                      type="button"
                      className={`eye-manual-corner-handle ${EyeManualCornerHandleStyles} pending`}
                      aria-label="Move first eye corner"
                      title="Drag to reposition the first corner"
                      style={getCornerStyle(visiblePendingCorner)}
                      onPointerDown={(event) => beginCornerGesture(event, null)}
                      onKeyDown={(event) => moveCornerWithKeyboard(event, null)}
                    >
                      <Plus size={12} aria-hidden="true" />
                    </button>
                  )}
                  {cornerMode === "edit" &&
                    !pendingCorner &&
                    visibleCorners?.map((corner, index) => {
                      return (
                        <button
                          key={index}
                          type="button"
                          className={`eye-manual-corner-handle ${EyeManualCornerHandleStyles}`}
                          aria-label={`Move eye corner ${index + 1}`}
                          title={`Drag to reposition eye corner ${index + 1}`}
                          style={getCornerStyle(corner)}
                          onPointerDown={(event) =>
                            beginCornerGesture(event, index)
                          }
                          onKeyDown={(event) =>
                            moveCornerWithKeyboard(event, index)
                          }
                        >
                          <Plus size={12} aria-hidden="true" />
                        </button>
                      )
                    })}
                </div>
              )}
              {selectRegion && !redraw && (
                <div
                  className={`eye-roi-overlay ${EyeRoiOverlayStyles}`}
                  style={{
                    left: `${(displayRegion.x / dimensions.width) * 100}%`,
                    top: `${(displayRegion.y / dimensions.height) * 100}%`,
                    width: `${(displayRegion.width / dimensions.width) * 100}%`,
                    height: `${(displayRegion.height / dimensions.height) * 100}%`,
                  }}
                >
                  {HANDLES.map(({ handle, label, x, y }) => (
                    <button
                      key={handle}
                      className={`eye-roi-handle ${EyeRoiHandleStyles} ${handle}`}
                      aria-label={`Resize ROI ${label}`}
                      title={`Resize ${label}; arrow keys adjust`}
                      style={{ left: `${x}%`, top: `${y}%` }}
                      onPointerDown={(event) => beginGesture(event, handle)}
                      onKeyDown={(event) => editWithKeyboard(event, handle)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className={`eye-preview-empty ${EyePreviewEmptyStyles}`}>
          <div className={`eye-camera-outline ${EyeCameraOutlineStyles}`}>
            <Camera size={30} strokeWidth={1.2} />
          </div>
          <p>No camera connected</p>
        </div>
      )}
    </div>
  )
}
