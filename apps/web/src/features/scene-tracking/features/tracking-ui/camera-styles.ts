/** Static Tailwind primitives for camera presentation. */

export const EyePreviewStyles = `
  relative [flex:1_1_auto] min-h-0 flex
  flex-col [border-radius:0] [background:var(--eye-preview)] [border:0]
  overflow-hidden [box-shadow:none] [&.is-empty]:[flex:1_1_auto] [&.is-empty]:w-full
  [&.is-empty]:h-full [&.is-empty]:min-h-0 [&.is-empty]:[align-self:stretch] [&.has-source]:[flex:1_1_auto]
  [&.has-source]:w-full [&.has-source]:h-full [&.has-source]:[max-width:100%] [&.has-source]:[align-self:stretch]
  [&_button:focus-visible]:[outline:2px_solid_var(--eye-sphere)] [&_button:focus-visible]:[outline-offset:2px]
`

export const EyePreviewHeadingStyles = `
  [flex:0_0_auto] flex-wrap [gap:8px] relative
  [z-index:4] flex items-center justify-between
  [color:var(--eye-preview-text)] [min-height:44px] [padding:8px_12px] [font-size:11px]
  [border-bottom:1px_solid_var(--eye-preview-line)] [&_>_span:first-child]:flex [&_>_span:first-child]:items-center [&_>_span:first-child]:[gap:8px]
  [&_>_span:last-child:not(:first-child)]:[font-size:8px] [&_>_span:last-child:not(:first-child)]:[letter-spacing:1.4px] [&_>_span:last-child:not(:first-child)]:[color:var(--eye-preview-muted)] [@media(max-height:_760px)]:[min-height:44px]
  [@media(max-height:_760px)]:[padding:8px_10px]
`

export const EyePreviewStageStyles = `
  [flex:0_0_auto] min-h-0 w-auto [max-width:100%]
  [align-self:center] [margin-block:auto] flex items-center
  justify-center overflow-hidden
`

export const EyePreviewImageStyles = `
  [&_>_canvas]:w-full [&_>_canvas]:h-full [&_>_canvas]:[max-width:100%] [&_>_canvas]:[max-height:100%]
  [&_>_canvas]:object-contain [&_>_canvas]:block [&_>_canvas]:[touch-action:none] [&_>_canvas]:[background:var(--eye-preview)]
  [&_>_canvas.selectable]:cursor-crosshair relative [flex:0_1_auto] w-full
  h-full [max-width:none] [max-height:none] [margin-inline:auto]
  [&_>_canvas.movable]:[cursor:move] [&_>_canvas:focus-visible]:[outline:2px_solid_var(--eye-sphere)] [&_>_canvas:focus-visible]:[outline-offset:-3px]
`

export const EyePreviewEmptyStyles = `
  [flex:0_0_auto] [width:min(100%,_420px)] [aspect-ratio:1] min-h-0
  flex flex-col items-center justify-center
  [align-self:center] [margin-block:auto] relative [background:var(--eye-preview)]
  [&_h2]:[font-size:17px] [&_h2]:[font-weight:450] [&_h2]:[letter-spacing:-0.4px] [&_h2]:[color:var(--eye-preview-text)]
  [&_p]:[color:var(--eye-preview-muted)] [&_p]:[font-size:11px] [&_p]:[margin-top:7px]
`

export const EyeCameraOutlineStyles = `
  [width:65px] [height:65px] [border:1px_solid_var(--eye-preview-line)] [border-radius:18px]
  grid place-items-center [color:var(--eye-preview-muted)] [margin:0_0_18px]
`

export const EyeThumbnailsStyles = `
  grid [grid-template-columns:repeat(3,_minmax(0,_1fr))] [gap:12px] max-[900px]:[gap:7px]
`

export const EyeThumbnailStyles = `
  [border:1px_solid_var(--line)] [background:var(--card)] [border-radius:7px] overflow-hidden
  [&.selected]:[border-color:var(--primary)] [&_>_div:last-child]:[padding:8px_10px] [&_>_div:last-child]:flex [&_>_div:last-child]:justify-between
  [&_>_div:last-child]:[font-size:9px] [&_>_div:last-child]:[gap:3px] [&_>_div:last-child_span:last-child]:[font-size:8px] [&_>_div:last-child_span:last-child]:[color:var(--muted-foreground)]
  max-[900px]:[&_>_div:last-child]:flex-col
`

export const EyeThumbnailImageStyles = `
  [height:84px] flex items-center justify-center
  [background:var(--muted)] [color:var(--muted-foreground)] [&_canvas]:w-full [&_canvas]:h-full
  [&_canvas]:object-contain [&_canvas]:[background:var(--eye-preview)] min-[1500px]:[height:100px]
`

export const EyeModelLockStatusStyles = `
  [align-self:center] [flex:1_1_auto] [margin-left:auto] [color:var(--muted-foreground)]
  [font-size:11px] [line-height:1.3] text-right overflow-hidden
  [text-overflow:ellipsis] [white-space:nowrap] max-[650px]:[margin-left:0] max-[650px]:text-center
`

export const EyeSphereStyles = `
  [margin-top:25px] [&_>_canvas]:w-full [&_>_canvas]:h-auto max-[650px]:[&_>_canvas]:[max-height:150px]
`

export const EyeSphereMetricsStyles = `
  flex justify-between text-center [gap:10px]
  [&_>_span]:[font-size:18px] [&_>_span]:[font-weight:450] [&_small]:block [&_small]:[font-size:8px]
  [&_small]:[font-weight:400] [&_small]:[color:var(--muted-foreground)] [&_small]:[margin-top:3px]
`

export const EyeManualCornerLayerStyles = `
  absolute [inset:0] overflow-visible pointer-events-none
  [z-index:2]
`

export const EyeManualModelOverlayStyles = `
  absolute [inset:0] w-full h-full
  overflow-visible pointer-events-none [z-index:1]
`

export const EyeManualModelLineStyles = `
  [fill:none] [stroke:color-mix(in_srgb,_var(--primary)_68%,_transparent)] [stroke-width:2] [stroke-dasharray:5_5]
  pointer-events-none
`

export const EyeManualModelMoveTargetStyles = `
  [fill:transparent] [stroke:transparent] [stroke-width:0] [cursor:move]
  [pointer-events:all] [touch-action:none] [&:focus-visible]:[stroke:color-mix(in_srgb,_var(--primary)_26%,_transparent)] [&:focus-visible]:[outline:none]
`

export const EyeManualCornerHandleStyles = `
  absolute grid [width:26px] [height:26px]
  place-items-center [padding:0] [transform:translate(-50%,_-50%)] [border:0]
  [border-radius:0] [background:transparent] [color:#ff2d2d] [box-shadow:none]
  [filter:drop-shadow(0_0_2px_rgba(0,_0,_0,_0.95))_drop-shadow(0_0_3px_rgba(255,_45,_45,_0.75))] [cursor:grab] [pointer-events:auto] [touch-action:none]
  [&:hover]:[filter:drop-shadow(0_0_2px_rgba(0,_0,_0,_0.95))_drop-shadow(0_0_5px_rgba(255,_45,_45,_0.9))] [&:active]:[cursor:grabbing] [&:focus-visible]:[outline:2px_solid_var(--eye-sphere)] [&:focus-visible]:[outline-offset:3px]
`

export const EyePreviewToolsStyles = `
  flex items-center [gap:6px] [&_button]:[padding:5px_8px]
  [&_button]:[border-radius:3px] [&_button]:[font-size:10px] [&_button]:[color:var(--eye-preview-muted)] [&_button]:[background:transparent]
  [&_button]:[line-height:1.3] [&_.eye-roi-edit]:grid [&_.eye-roi-edit]:place-items-center [&_.eye-roi-edit]:[width:29px]
  [&_.eye-roi-edit]:[height:28px] [&_.eye-roi-edit]:[padding:0] [&_.eye-roi-edit]:[gap:5px] [&_.eye-roi-edit]:[border:1px_solid_var(--eye-preview-line)]
  [&_.eye-roi-edit]:[color:var(--eye-preview-text)] [&_.eye-roi-edit.active]:[color:var(--eye-sphere)] [&_.eye-roi-edit.active]:[border-color:var(--eye-sphere)] [&_.eye-roi-edit.active]:[background:color-mix(in_srgb,_var(--eye-sphere)_12%,_var(--eye-preview))]
  [&_.eye-corner-mode-switch_button]:relative [&_.eye-corner-mode-switch_button]:grid [&_.eye-corner-mode-switch_button]:[width:27px] [&_.eye-corner-mode-switch_button]:[height:25px]
  [&_.eye-corner-mode-switch_button]:place-items-center [&_.eye-corner-mode-switch_button]:[padding:0] [&_.eye-corner-mode-switch_button]:[border-radius:3px] [&_.eye-corner-mode-switch_button[aria-pressed="true"]]:[color:var(--eye-sphere)]
  [&_.eye-corner-mode-switch_button[aria-pressed="true"]]:[background:color-mix(in_srgb,_var(--eye-sphere)_12%,_var(--eye-preview))] [&_.eye-corner-mode-switch_button:disabled]:[opacity:0.4] [&_.eye-corner-mode-switch_button:disabled]:cursor-not-allowed
`

export const EyePreviewSwitchStyles = `
  flex items-center [padding:2px] [gap:2px]
  [border:1px_solid_var(--eye-preview-line)] [border-radius:5px] [&_button[aria-pressed="true"]]:[color:var(--eye-preview-text)] [&_button[aria-pressed="true"]]:[background:var(--eye-preview-line)]
  [&_button]:grid [&_button]:place-items-center [&_button]:[width:29px] [&_button]:[height:28px]
  [&_button]:[padding:0]
`

export const EyeRoiEditStyles = `
  flex items-center
`

export const EyeRoiToolbarStyles = `
  flex items-center [&_button]:[padding:5px_8px] [&_button]:[border-radius:3px]
  [&_button]:[font-size:10px] [&_button]:[color:var(--eye-sphere)] [&_button]:[background:transparent] [&_button]:[line-height:1.3]
  [&_button[aria-pressed="true"]]:[color:var(--eye-sphere)] [&_button[aria-pressed="true"]]:[border-color:var(--eye-sphere)] [&_button[aria-pressed="true"]]:[background:color-mix(in_srgb,_var(--eye-sphere)_12%,_var(--eye-preview))] justify-between
  [gap:8px] [padding:5px_12px] [color:var(--eye-sphere)] [border-bottom:1px_solid_var(--eye-preview-line)]
  [font-size:10px] [background:color-mix(in_srgb,_var(--eye-sphere)_8%,_var(--eye-preview))] [&_button]:[border:1px_solid_var(--eye-preview-line)]
`

export const EyeCornerModeSwitchStyles = `
  flex items-center [gap:2px] [padding:2px]
  [border:1px_solid_var(--eye-preview-line)] [border-radius:5px]
`

export const EyeRoiOverlayStyles = `
  absolute pointer-events-none
`

export const EyeRoiHandleStyles = `
  absolute [width:24px] [height:24px] [transform:translate(-50%,_-50%)]
  [pointer-events:auto] [touch-action:none] [border:0] [background:transparent]
  [&::after]:[content:""] [&::after]:block [&::after]:[width:9px] [&::after]:[height:9px]
  [&::after]:[border:1px_solid_var(--eye-preview)] [&::after]:[border-radius:2px] [&::after]:[background:var(--eye-sphere)] [&::after]:[margin:auto]
  [&::after]:[box-shadow:0_0_0_1px_var(--eye-sphere)] [&.n]:[cursor:ns-resize] [&.s]:[cursor:ns-resize] [&.e]:[cursor:ew-resize]
  [&.w]:[cursor:ew-resize] [&.nw]:[cursor:nwse-resize] [&.se]:[cursor:nwse-resize] [&.ne]:[cursor:nesw-resize]
  [&.sw]:[cursor:nesw-resize]
`

export const EyeRoiCoordinatesStyles = `
  [gap:0_10px] [margin-top:6px] [&_.eye-field]:[margin:7px_0]
`

export const EyePipelineDetailsStyles = `
  [flex:0_0_auto] [max-height:45%] min-h-0 overflow-y-auto
  [margin-top:0] [padding:10px_12px_0] [&_.eye-thumbnails]:[margin-top:12px] [&_summary_>_span]:[font-size:9px]
`

export const CameraTransformControlsStyles = `
  inline-flex items-center [gap:2px] [padding:3px]
  [border:1px_solid_var(--border)] [border-radius:7px] [background:#161817] [&_button]:grid
  [&_button]:place-items-center [&_button]:[flex:0_0_30px] [&_button]:[width:30px] [&_button]:[height:28px]
  [&_button]:[border-radius:4px] [&_button]:[color:var(--muted-foreground)] [&_button:hover]:[background:#303633] [&_button:hover]:[color:var(--primary)]
  [&_button[aria-pressed="true"]]:[background:#303633] [&_button[aria-pressed="true"]]:[color:var(--primary)]
`

export const CameraAngleStyles = `
  flex items-center [color:var(--muted-foreground)] [font-size:11px]
  [padding-right:4px] [&_input]:[width:46px] [&_input]:min-w-0 [&_input]:[height:28px]
  [&_input]:[padding:0_3px] [&_input]:[border:0] [&_input]:[background:transparent] [&_input]:[color:var(--foreground)]
  [&_input]:text-right [&_input]:[font-size:11px]
`

export const CameraRecoveryBannerStyles = `
  absolute [z-index:3] [bottom:12px] [left:50%]
  [transform:translateX(-50%)] [max-width:calc(100%_-_24px)] [width:max-content] [border:1px_solid_#414844]
  [border-radius:7px] [padding:8px_12px] [font-size:11px] [background:#202a25e6]
  [color:var(--primary)] pointer-events-none
`

export const CameraSpinnerStyles = `
  motion-safe:animate-spin
`
