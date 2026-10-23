/** Static Tailwind primitives for threshold presentation. */

export const EyeThresholdControlsStyles = `
  [grid-column:1] [grid-row:1] min-w-0 min-h-0
  w-full h-full [align-self:stretch] grid
  [grid-template-rows:auto_minmax(0,_1fr)] [padding:0] [align-content:start] [row-gap:0]
  [margin:0] [border:1px_solid_var(--line)] [border-radius:10px] [background:var(--card)]
  [@container(max-width:_900px)]:[grid-column:1] [@container(max-width:_900px)]:[grid-row:1] [@container(max-width:_900px)]:[grid-template-rows:auto_auto]
`

export const EyeThresholdHeadingStyles = `
  flex items-center justify-between [gap:12px]
  [min-height:44px] [padding:8px_14px] [border-bottom:1px_solid_var(--line)]
`

export const EyeThresholdTuningStyles = `
  grid [align-content:center] [gap:20px] [padding:16px]
  [@container(max-width:_900px)]:[grid-template-columns:auto_minmax(0,_1fr)] [@container(max-width:_900px)]:items-center [@container(max-width:_900px)]:[gap:10px] [@container(max-width:_900px)]:[padding:10px]
`

export const EyeThresholdTitleStyles = `
  flex [align-items:baseline] [gap:9px] [&_strong]:[font-size:12px]
  [&_strong]:[font-weight:600] [&_>_span]:[color:var(--dim)] [&_>_span]:[font-size:10px]
`

export const EyeThresholdModesStyles = `
  flex [gap:3px] [padding:3px] [border:1px_solid_var(--line)]
  [background:#1c1e1d] [border-radius:7px] [margin:0] [justify-self:start]
  [&_button]:grid [&_button]:place-items-center [&_button]:[width:34px] [&_button]:[height:28px]
  [&_button]:[padding:0] [&_button]:[border-radius:4px] [&_button]:[color:var(--dim)] [&_button]:[font-size:10px]
  [&_button]:[font-weight:550] [&_button]:[min-height:32px] [&_button[aria-pressed="true"]]:[color:var(--ink)] [&_button[aria-pressed="true"]]:[background:#303633]
  [&_button[aria-pressed="true"]]:[box-shadow:inset_0_0_0_1px_#414844]
`

export const EyeThresholdControlRowStyles = `
  grid [grid-template-columns:minmax(0,_1fr)_64px] [grid-template-areas:"label_value"_"slider_slider"] items-center
  [column-gap:12px] [row-gap:8px] [margin:0] [&:only-child]:[grid-column:1_/_-1]
  max-[480px]:[grid-template-columns:minmax(0,_1fr)_58px] max-[480px]:[column-gap:8px] max-[480px]:[row-gap:6px] [@container(max-width:_900px)]:[grid-template-columns:minmax(0,_1fr)_58px]
  [@container(max-width:_900px)]:[grid-template-areas:"slider_value"] [@container(max-width:_900px)]:[column-gap:8px] [@container(max-width:_900px)]:[row-gap:0]
`

export const EyeThresholdFieldLabelStyles = `
  [grid-area:label] [color:var(--dim)] [font-size:11px] [white-space:nowrap]
  [@container(max-width:_900px)]:hidden
`

export const EyeThresholdSliderStyles = `
  [grid-area:slider] [appearance:none] w-full [height:18px]
  [margin:0] [padding:0] [background:transparent] cursor-pointer
  [&::-webkit-slider-runnable-track]:[height:6px] [&::-webkit-slider-runnable-track]:[border-radius:999px] [&::-webkit-slider-runnable-track]:[background:linear-gradient(_to_right,_var(--eye-pupil)_0%,_var(--eye-pupil)_var(--threshold-progress),_#353936_var(--threshold-progress),_#353936_100%_)] [&::-webkit-slider-thumb]:[appearance:none]
  [&::-webkit-slider-thumb]:[width:16px] [&::-webkit-slider-thumb]:[height:16px] [&::-webkit-slider-thumb]:[margin-top:-5px] [&::-webkit-slider-thumb]:[border:2px_solid_var(--eye-pupil)]
  [&::-webkit-slider-thumb]:[border-radius:50%] [&::-webkit-slider-thumb]:[background:#f2f5f3] [&::-webkit-slider-thumb]:[box-shadow:0_1px_4px_#0008] [&::-moz-range-track]:[height:6px]
  [&::-moz-range-track]:[border-radius:999px] [&::-moz-range-track]:[background:#353936] [&::-moz-range-progress]:[height:6px] [&::-moz-range-progress]:[border-radius:999px]
  [&::-moz-range-progress]:[background:var(--eye-pupil)] [&::-moz-range-thumb]:[width:12px] [&::-moz-range-thumb]:[height:12px] [&::-moz-range-thumb]:[border:2px_solid_var(--eye-pupil)]
  [&::-moz-range-thumb]:[border-radius:50%] [&::-moz-range-thumb]:[background:#f2f5f3] [&::-moz-range-thumb]:[box-shadow:0_1px_4px_#0008]
`

export const EyeThresholdValueStyles = `
  [grid-area:value] [width:64px] [height:32px] [padding:5px_7px]
  [border:1px_solid_var(--line)] [border-radius:6px] [color:var(--ink)] [background:#0d0e0d]
  [font-size:11px] tabular-nums text-center [&::-webkit-inner-spin-button]:[opacity:0.55]
  [&::-webkit-outer-spin-button]:[opacity:0.55] max-[480px]:[width:58px] [@container(max-width:_900px)]:[width:58px]
`
