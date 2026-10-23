/** Static Tailwind primitives for scene presentation. */

export const SceneRecoveryStyles = `
  motion-safe:[&_svg]:animate-spin absolute [z-index:2] [top:16px]
  [left:50%] [transform:translateX(-50%)] flex items-center
  [gap:9px] [width:max-content] [max-width:calc(100%_-_24px)] [border:1px_solid_#414844]
  [border-radius:8px] [background:#1c211ee6] [color:#c8dfd5] [padding:10px_14px]
  [font-size:12px]
`

export const SceneWorkspaceStyles = `
  grid [flex:1_1_auto] min-h-0 w-full
  [max-width:1550px] [padding:0_4%_8px] [grid-template-columns:minmax(0,_1fr)_320px] [grid-template-rows:minmax(0,_1fr)]
  [gap:16px] items-stretch [margin:0_auto] [&[hidden]]:hidden
  [&.with-eye-preview]:[grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)_320px] [&.with-eye-preview.with-screen-marker]:[grid-template-columns:repeat(3,_minmax(0,_1fr))] [&.with-eye-preview.with-screen-marker]:[grid-template-areas:"eye_marker_scene"] [&.with-eye-preview.with-screen-marker]:[grid-template-rows:minmax(430px,_1fr)]
  [&.with-eye-preview.with-screen-marker]:overflow-y-auto [&.with-screen-marker_>_.scene-camera-preview]:[grid-area:scene] [&.with-screen-marker_>_.scene-eye-preview]:[grid-area:eye] [&.with-eye-preview.with-screen-marker_>_.has-stage]:[grid-area:marker]
  [&.with-eye-preview.with-screen-marker_>_.has-stage]:grid [&.with-eye-preview.with-screen-marker_>_.has-stage]:[grid-template-rows:38px_minmax(190px,_1fr)_minmax(180px,_0.85fr)] [&.with-eye-preview.with-screen-marker_>_.has-stage]:[gap:12px] [&.with-eye-preview.with-screen-marker_>_.has-stage]:h-full
  [&.with-eye-preview.with-screen-marker_>_.has-stage]:min-h-0 [&.with-eye-preview.with-screen-marker_>_.has-stage]:overflow-hidden [&.with-eye-preview.with-screen-marker_>_.has-stage]:[align-self:stretch] [&.with-eye-preview.with-screen-marker_.eye-controls-body]:overflow-y-auto
  [&.with-eye-preview.with-screen-marker_.eye-controls-body]:min-h-0 [&_progress]:w-full [&_progress]:[height:8px] [&_progress]:[accent-color:#83d7b2]
  [&_small]:[line-height:1.5] [&_small]:[color:#888] [&_small]:[font-size:11px] max-[1000px]:[grid-template-columns:minmax(0,_1fr)_320px]
  max-[1000px]:[gap:16px] max-[1000px]:[&.with-eye-preview]:[grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] max-[1000px]:[&.with-eye-preview]:[grid-template-rows:minmax(260px,_45svh)_auto] max-[1000px]:[&.with-eye-preview]:overflow-y-auto
  max-[1000px]:[&.with-eye-preview_>_.eye-controls]:[grid-column:1_/_-1] max-[1000px]:[&.with-eye-preview_>_.eye-controls]:h-auto max-[1000px]:[&.with-eye-preview_>_.eye-controls]:[align-self:start] max-[1000px]:[&.with-eye-preview_>_.eye-controls]:overflow-visible
  max-[1000px]:[&.with-eye-preview_.eye-controls-body]:[flex:0_0_auto] max-[1000px]:[&.with-eye-preview_.eye-controls-body]:overflow-visible max-[760px]:[grid-template-columns:1fr] max-[760px]:[grid-template-rows:minmax(240px,_40svh)_auto]
  max-[760px]:overflow-y-auto max-[760px]:[&.with-eye-preview]:[grid-template-columns:1fr] max-[760px]:[&.with-eye-preview]:[grid-template-rows:minmax(240px,_40svh)_minmax(240px,_40svh)_auto] max-[760px]:[&_.eye-step-panel]:w-full
  max-[760px]:[&_.eye-controls]:h-auto max-[760px]:[&_.eye-controls]:overflow-visible max-[760px]:[&_.eye-controls-body]:overflow-visible max-[760px]:[&.with-eye-preview.with-screen-marker]:[grid-template-columns:repeat(2,_minmax(0,_1fr))]
  max-[760px]:[&.with-eye-preview.with-screen-marker]:[grid-template-areas:"marker_marker"_"eye_scene"] max-[760px]:[&.with-eye-preview.with-screen-marker]:[grid-template-rows:470px_minmax(250px,_40svh)] max-[760px]:[&.with-screen-marker_>_.has-stage]:[grid-column:1_/_-1]
`

export const ScreenMarkerStageStyles = `
  relative min-w-0 min-h-0 [container-type:size]
`

export const ScreenCalibrationMarkerStyles = `
  absolute [left:50%] [top:50%] [transform:translate(-50%,_-50%)_scale(var(--marker-scale,_1))]
  [width:min(100cqw,_100cqh)] [max-width:min(100cqw,_100cqh)] h-auto [aspect-ratio:1]
  [border-radius:50%] [user-select:none]
`

export const ScreenMarkerSizeStyles = `
  absolute [right:0] [bottom:0] flex
  [gap:4px] [z-index:1] [&_.eye-action-icon[data-tooltip]::after]:[left:auto] [&_.eye-action-icon[data-tooltip]::after]:[right:0]
  [&_.eye-action-icon[data-tooltip]::after]:[top:auto] [&_.eye-action-icon[data-tooltip]::after]:[bottom:calc(100%_+_6px)] [&_.eye-action-icon[data-tooltip]::after]:[transform:none]
`

export const SceneDelaySettingsStyles = `
  [margin-top:12px] [color:#999] [font-size:12px] [&_summary]:flex
  [&_summary]:items-center [&_summary]:[gap:7px] [&_summary]:cursor-pointer [&_summary]:[list-style:none]
  [&_summary::-webkit-details-marker]:hidden [&_.eye-field]:[margin-top:12px]
`

export const SceneEyePreviewStyles = `
  [&_.eye-preview-stage]:[flex:1_1_auto] [&_.eye-preview-stage]:w-full [&_.eye-preview-heading]:[min-height:54px]
`

export const SceneEyeStatusStyles = `
  [min-height:38px] [gap:10px] [&_.scene-eye-state]:min-w-0 [&_.scene-eye-state]:[font-size:11px]
`

export const SceneEyeStateStyles = `
  [&.ready]:[color:#a8d8c6] [&.waiting]:[color:#e0bb73]
`

export const SceneMainPreviewStyles = `
  min-w-0 min-h-0 flex flex-col
  [background:#111] [border:1px_solid_#292929] [border-radius:11px] overflow-hidden
`

export const SceneSourceHeadingStyles = `
  flex items-center justify-between [gap:12px]
  [padding:9px_12px] [font-size:12px] [color:#aaa] relative
  [z-index:4] [flex:0_0_auto] flex-wrap [border-bottom:1px_solid_#292929]
`

export const SceneStatusStripStyles = `
  flex items-center justify-start [gap:20px]
  [padding:10px_12px] [font-size:12px] [color:#aaa] [flex:0_0_auto]
  [border-top:1px_solid_#292929] flex-wrap [&_>_span]:inline-flex [&_>_span]:items-center
  [&_>_span]:[gap:7px] [&_.scene-indicator]:[color:#737a76] [&_.scene-indicator.ready]:[color:#a8d8c6] [&_.scene-indicator.recovering]:[color:#fbbf24]
  [&_>_span:first-child]:[margin-right:auto] max-[760px]:[font-size:11px] max-[760px]:[gap:12px]
`

export const ScenePreviewCaptionStyles = `
  flex items-center justify-between [gap:12px]
  [padding:14px_18px] [font-size:12px] [color:#ddd] absolute
  [bottom:0] [left:0] [right:0] [background:linear-gradient(transparent,_rgba(0,_0,_0,_0.7))]
  pointer-events-none
`

export const SceneSourceTitleStyles = `
  flex items-center [gap:8px] [color:#f4f4f2]
  [font-size:12px]
`

export const ScenePreviewStyles = `
  relative [flex:1_1_auto] grid place-items-center
  [background:#080808] overflow-hidden min-h-0 [&_canvas]:block
  [&_canvas]:w-full [&_canvas]:h-full [&_canvas]:object-contain [&_canvas]:min-h-0
  [&_canvas]:absolute [&_canvas]:[inset:0] [&_canvas[hidden]]:hidden
`

export const SceneEmptyStyles = `
  absolute [inset:0] flex flex-col
  justify-center items-center [padding:28px] text-center
  [gap:14px] [&_h2]:[font-size:22px] [&_h2]:[line-height:1.2] [&_h2]:[margin:0]
  [&_h2]:[font-weight:500] [&_p]:[max-width:340px] [&_p]:[color:#8c8c8c] [&_p]:[line-height:1.6]
  [&_p]:[font-size:14px] [&_p]:[margin:0]
`

export const SceneInstructionStyles = `
  [font-size:14px] [line-height:1.65] [color:#ddd]
`

export const SceneCaptureCountStyles = `
  flex items-center justify-between [margin:16px_0_10px]
  [font-size:12px] [&_strong]:[color:#a8d8c6]
`

export const SceneCalibrationInstructionStyles = `
  flex items-start justify-between [gap:12px]
  [&_.scene-instruction]:[flex:1] [&_.scene-instruction]:[margin:0] [&_.eye-action-icon[data-tooltip]::after]:[left:auto] [&_.eye-action-icon[data-tooltip]::after]:[right:0]
  [&_.eye-action-icon[data-tooltip]::after]:[transform:none]
`

export const SceneHoldStatusStyles = `
  grid items-start justify-between [gap:12px]
  [grid-template-columns:minmax(0,_1fr)_64px] [min-height:4.5em] [font-size:13px] [line-height:1.5]
  [&_[role="status"]]:min-w-0 [&_[role="status"]]:[overflow-wrap:anywhere] [&_small]:text-right [&_small]:tabular-nums
  [&_small]:[white-space:nowrap] [&_small]:[padding-top:2px] [&_small]:[margin:0]
`

export const SceneMetricsStyles = `
  grid [gap:12px] [padding:16px] [background:#151515]
  [border:1px_solid_#292929] [border-radius:8px] [&_div]:flex [&_div]:flex-col
  [&_div]:[gap:5px] [&_span]:[color:#999] [&_span]:[font-size:12px] [&_strong]:[font-size:14px]
  [&_strong]:[font-weight:500] [&_strong]:[color:#eee] [&_.scene-validation-points]:grid [&_.scene-validation-points]:[grid-template-columns:repeat(5,_minmax(0,_1fr))]
  [&_.scene-validation-points]:[gap:5px]
`

export const SceneValidationRecoveryStyles = `
  grid [gap:12px] [&_.eye-action-icon[data-tooltip]::after]:[left:auto] [&_.eye-action-icon[data-tooltip]::after]:[right:0]
  [&_.eye-action-icon[data-tooltip]::after]:[transform:none]
`

export const ScenePreviewWarningStyles = `
  [color:#e0bb73] [font-size:12px]
`

export const SceneValidationPointsStyles = `
  [&_>_span]:grid [&_>_span]:[gap:3px] [&_>_span]:[font-size:11px] [&_>_span]:text-center
`

export const SceneOffsetFieldsStyles = `
  grid [grid-template-columns:repeat(2,_minmax(0,_1fr))] [gap:8px] [&_.eye-field]:min-w-0
  [&_.eye-field]:[margin:0] [&_input]:min-w-0 [&_input]:w-full
`

export const SceneRecordingStyles = `
  [border-top:1px_solid_#303030] [padding-top:20px] [margin-top:12px] grid
  [gap:14px] [&_h3]:[font-size:15px] [&_h3]:[font-weight:500] [&_h3]:[margin:0]
`

export const SceneProfileControlsStyles = `
  grid [gap:8px] [margin-bottom:16px] [padding-bottom:14px]
  [border-bottom:1px_solid_#303030] [font-size:12px] [&_p]:[margin:0]
`

export const SceneProfileRowStyles = `
  flex items-center [gap:6px] min-w-0
  [&_select]:[flex:1] [&_select]:min-w-0 [&_select]:w-full [&_select]:[height:38px]
  [&_select]:[padding:0_9px] [&_select]:[border:1px_solid_#303530] [&_select]:[border-radius:6px] [&_select]:[background:#131613]
  [&_select]:[color:inherit] [&_select]:[font:inherit] [&_input]:[flex:1] [&_input]:min-w-0
  [&_input]:w-full [&_input]:[height:38px] [&_input]:[padding:0_9px] [&_input]:[border:1px_solid_#303530]
  [&_input]:[border-radius:6px] [&_input]:[background:#131613] [&_input]:[color:inherit] [&_input]:[font:inherit]
  [&_.eye-action-icon]:[flex:0_0_34px] [&_.eye-action-icon]:[min-width:34px] [&_.eye-action-icon]:[width:34px] [&_.eye-action-icon]:[height:38px]
  [&_.eye-action-icon]:[min-height:38px] [&_.eye-action-icon]:[padding:0] [&_select:focus-visible]:[outline:2px_solid_var(--eye-accent,_#aad6c6)] [&_select:focus-visible]:[outline-offset:2px]
  [&_input:focus-visible]:[outline:2px_solid_var(--eye-accent,_#aad6c6)] [&_input:focus-visible]:[outline-offset:2px]
`

export const SceneCheckboxStyles = `
  flex items-center [gap:8px] [font-size:12px]
  [color:#aaa] [&_input]:[accent-color:#ddd]
`

export const SceneDownloadsStyles = `
  grid [gap:8px] [&_a]:[text-decoration:none] [&_a]:text-center
`

export const SceneHeatmapStyles = `
  [margin:0] [&_img]:w-full [&_img]:[border-radius:8px] [&_figcaption]:[font-size:11px]
  [&_figcaption]:[color:#888] [&_figcaption]:[line-height:1.5] [&_figcaption]:[margin-top:6px]
`

export const SceneCalibrationMethodsStyles = `
  [&.eye-source-type]:grid [&.eye-source-type]:[grid-template-columns:repeat(3,_minmax(0,_1fr))] [&.eye-source-type]:[gap:5px] [&.eye-source-type]:[margin-bottom:12px]
  [&_button]:min-w-0 [&_button]:flex [&_button]:flex-col [&_button]:items-center
  [&_button]:justify-center [&_button]:[gap:5px] [&_button]:[padding:9px_4px] [&_button[aria-checked="true"]]:[border-color:var(--eye-accent,_#aad6c6)]
  [&_button[aria-checked="true"]]:[background:#aad6c610] [&_button[data-tooltip]::after]:[width:min(230px,_60vw)] [&_button[data-tooltip]::after]:[white-space:normal] [&_button:first-child[data-tooltip]::after]:[left:0]
  [&_button:first-child[data-tooltip]::after]:[transform:none] [&_button:last-child[data-tooltip]::after]:[left:auto] [&_button:last-child[data-tooltip]::after]:[right:0] [&_button:last-child[data-tooltip]::after]:[transform:none]
`

export const SceneEstimatedLabelStyles = `
  block [color:#edc47d] [font-size:12px] [margin:8px_0_12px]
`

export const SceneProjectionControlsStyles = `
  [margin-top:12px] [font-size:12px] [color:#b8c0bd] [&_summary]:cursor-pointer
  [&_summary]:[margin-bottom:10px]
`
