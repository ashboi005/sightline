/** Static Tailwind primitives for layout presentation. */

export const EyeAppStyles = `
  [--background:#090909] [--foreground:#f4f4f2] [--card:#141514] [--card-foreground:#f4f4f2]
  [--popover:#171817] [--popover-foreground:#f4f4f2] [--primary:#a7d7c5] [--primary-foreground:#102019]
  [--secondary:#202220] [--secondary-foreground:#f4f4f2] [--muted:#202220] [--muted-foreground:#a3a6a3]
  [--accent:#a7d7c5] [--accent-foreground:#102019] [--border:#303330] [--input:#343835]
  [--ring:#a7d7c5] [--ink:var(--foreground)] [--dim:var(--muted-foreground)] [--line:var(--border)]
  [--eye-action:var(--primary)] [--eye-pupil:#a7d7c5] [--eye-sphere:#b8cafa] [--eye-ray:#edd7a4]
  [--eye-preview:#111111] [--eye-preview-line:#353535] [--eye-preview-text:#fafafa] [--eye-preview-muted:#a3a3a3]
  bg-[#090909] [color:var(--ink)] [height:100svh] min-h-0
  flex flex-col overflow-hidden [font-family:"Geist_Variable",_sans-serif]
  [font-size:14px] [line-height:1.5] [color-scheme:dark] [&_*]:[box-sizing:border-box]
  [&_button]:[-webkit-tap-highlight-color:transparent] [&_a]:[-webkit-tap-highlight-color:transparent] [&_button]:cursor-pointer [&_button:disabled]:cursor-not-allowed
  [&_button:disabled]:[opacity:0.4] [&_button:focus-visible]:[outline:2px_solid_var(--primary)] [&_button:focus-visible]:[outline-offset:2px] [&_a:focus-visible]:[outline:2px_solid_var(--primary)]
  [&_a:focus-visible]:[outline-offset:4px] [&_input:focus-visible]:[outline:2px_solid_var(--primary)] [&_input:focus-visible]:[outline-offset:4px] [&_select:focus-visible]:[outline:2px_solid_var(--primary)]
  [&_select:focus-visible]:[outline-offset:4px] [&_summary:focus-visible]:[outline:2px_solid_var(--primary)] [&_summary:focus-visible]:[outline-offset:4px] motion-reduce:[&_*]:[transition:none_!important]
`

export const EyeBrandStyles = `
  flex items-center [gap:11px] [font-size:20px]
  [font-weight:650] [letter-spacing:-0.6px] [text-decoration:none] max-[650px]:[font-size:18px]
`

export const EyeLogoStyles = `
  grid place-items-center [width:34px] [height:34px]
  [border:1px_solid_var(--border)] [border-radius:10px]
`

export const EyeVersionStyles = `
  [font-size:10px] [letter-spacing:0.4px] [color:var(--muted-foreground)] [border:1px_solid_var(--line)]
  [border-radius:5px] [padding:2px_5px] [margin-left:2px]
`

export const EyeLocalStyles = `
  flex items-center [gap:8px] [font-size:12px]
  max-[650px]:[font-size:0] max-[650px]:[gap:0]
`

export const StatusLightStyles = `
  inline-block [flex-shrink:0] [width:6px] [height:6px]
  [background:var(--muted-foreground)] [border-radius:50%] [&.on]:[background:var(--eye-pupil)] [&.on]:[box-shadow:0_0_0_3px_color-mix(in_srgb,_var(--eye-pupil)_18%,_transparent)]
`

export const EyeTitleRowStyles = `
  [flex:0_0_auto] w-full [max-width:1550px] [min-height:66px]
  [margin:0_auto] [padding:9px_4%] flex justify-between
  [gap:25px] items-center [&_h1]:[font-size:24px] [&_h1]:[line-height:1.3]
  [&_h1]:[font-weight:520] [&_h1]:[letter-spacing:-1.2px] [&_h1]:[margin:0] max-[1150px]:[padding-left:3%]
  max-[1150px]:[padding-right:3%] max-[900px]:[min-height:58px] max-[900px]:[padding-top:7px] max-[900px]:[padding-bottom:7px]
  max-[900px]:[&_h1]:[font-size:22px] max-[650px]:[min-height:52px] max-[650px]:[padding:6px_14px] max-[650px]:[gap:8px]
  max-[650px]:[&_h1]:[font-size:18px] max-[480px]:[gap:6px] max-[480px]:[min-height:48px] max-[480px]:[&_h1]:[font-size:16px]
  [@media(max-height:_760px)]:[min-height:54px] [@media(max-height:_760px)]:[padding-top:5px] [@media(max-height:_760px)]:[padding-bottom:5px]
`

export const EyeEyebrowStyles = `
  [font-size:10px] [letter-spacing:1.6px] [font-weight:600] [color:var(--muted-foreground)]
`

export const EyeFormatsStyles = `
  flex [border:1px_solid_var(--line)] [border-radius:10px] [background:var(--muted)]
  [padding:4px] [gap:4px] [&_button]:[min-width:100px] [&_button]:[padding:7px_13px]
  [&_button]:[border:1px_solid_transparent] [&_button]:[border-radius:7px] [&_button]:flex [&_button]:flex-row
  [&_button]:[gap:8px] [&_button]:text-left [&_button]:[color:var(--muted-foreground)] [&_button[aria-pressed="true"]]:[background:var(--card)]
  [&_button[aria-pressed="true"]]:[border-color:var(--border)] [&_button[aria-pressed="true"]]:[box-shadow:0_2px_4px_#00000008] [&_button[aria-pressed="true"]]:[color:var(--ink)] [&_span]:[font-size:12px]
  [&_span]:[font-weight:650] [&_small]:[font-size:10px] max-[900px]:[&_button]:[min-width:110px] max-[900px]:[&_button]:[padding:6px_9px]
  max-[650px]:[&_button]:[min-width:90px] max-[650px]:[&_button]:[padding:5px_7px] max-[650px]:[&_span]:[font-size:10px] max-[650px]:[&_small]:[font-size:8px]
  max-[480px]:[&_button]:[min-width:82px] max-[480px]:[&_button]:[padding-inline:5px] max-[480px]:[&_small]:hidden [&_button]:items-center
  [&_button]:justify-center
`

export const EyeStepNavStyles = `
  [flex:0_0_auto] w-full [max-width:1550px] [margin:0_auto]
  [padding:0_4%_8px] max-[1150px]:[padding-left:3%] max-[1150px]:[padding-right:3%] max-[650px]:[padding:0_14px_6px]
  max-[650px]:[overflow-x:auto] max-[650px]:[scrollbar-width:thin] [@media(max-height:_760px)]:[padding-bottom:4px]
`

export const EyeBreadcrumbsStyles = `
  flex items-center [list-style:none] [margin:0]
  [padding:0] [&_li]:[flex:1_1_0] [&_li]:min-w-0 [&_li]:flex
  [&_li]:items-center [&_li]:[gap:0] [&_li:not(:last-child)]:justify-between max-[650px]:flex
  max-[650px]:[width:max-content] max-[650px]:[min-width:100%] max-[650px]:[gap:0] max-[650px]:[&_li]:[flex:0_0_auto]
`

export const EyeStepChevronStyles = `
  [flex:0_0_auto] [margin-inline:12px] [color:var(--muted-foreground)] max-[650px]:[margin-inline:8px]
`

export const EyeStepStyles = `
  w-auto [flex:0_1_auto] min-w-0 [min-height:34px]
  flex items-center [gap:8px] text-left
  [padding:5px_0] [font-size:11px] [color:var(--muted-foreground)] [border:0]
  [border-radius:0] [background:transparent] [&.active]:[color:var(--foreground)] [&.active]:[font-weight:600]
  [&.done]:[color:var(--foreground)] [&.active_.eye-step-number]:[background:var(--primary)] [&.active_.eye-step-number]:[color:var(--primary-foreground)] [&.active_.eye-step-number]:[border-color:var(--primary)]
  [&.done_.eye-step-number]:[color:var(--foreground)] [&.done_.eye-step-number]:[background:var(--muted)] max-[1150px]:[gap:6px] max-[1150px]:[padding-inline:6px]
  max-[1150px]:[font-size:10px] max-[650px]:[min-height:30px] max-[650px]:[gap:5px] max-[650px]:[padding:4px_0]
  max-[650px]:[font-size:9px]
`

export const EyeStepNumberStyles = `
  [width:22px] [height:22px] [flex:0_0_22px] grid
  place-items-center [border:1px_solid_var(--border)] [border-radius:50%] [font-size:9px]
  [font-weight:500] max-[650px]:[width:20px] max-[650px]:[height:20px] max-[650px]:[flex-basis:20px]
`

export const EyeStepTextStyles = `
  overflow-hidden [white-space:nowrap] [text-overflow:ellipsis]
`

export const EyeWorkspaceStyles = `
  [--eye-card-gap:16px] [container-type:inline-size] [flex:1_1_auto] w-full
  [max-width:1550px] min-h-0 [margin:0_auto] grid
  [grid-template-columns:minmax(0,_1fr)_320px] [grid-template-rows:minmax(0,_1fr)] [gap:var(--eye-card-gap)] [padding:0_4%_8px]
  overflow-hidden [&[hidden]]:hidden min-[1500px]:[--eye-card-gap:20px] min-[1500px]:[grid-template-columns:minmax(0,_1fr)_320px]
  max-[1150px]:[--eye-card-gap:12px] max-[1150px]:[grid-template-columns:minmax(0,_1fr)_280px] max-[1150px]:[padding-left:3%] max-[1150px]:[padding-right:3%]
  max-[900px]:[--eye-card-gap:10px] max-[900px]:[grid-template-columns:minmax(0,_1fr)_250px] max-[650px]:[--eye-card-gap:8px] max-[650px]:[grid-template-columns:minmax(0,_1fr)_220px]
  max-[650px]:[padding:0_14px_6px] max-[480px]:[grid-template-columns:minmax(0,_1fr)] max-[480px]:[grid-template-rows:minmax(280px,_1fr)_auto]
  max-[480px]:[gap:6px] max-[480px]:overflow-y-auto
  max-[480px]:[&>_.eye-controls]:h-auto max-[480px]:[&>_.eye-controls]:min-h-min
  max-[480px]:[&_.eye-controls-body]:[flex:0_0_auto] max-[480px]:[&_.eye-controls-body]:overflow-visible
  [@media(max-height:_760px)]:[padding-bottom:4px]
`

export const EyePreviewColumnStyles = `
  min-w-0 min-h-0 overflow-hidden grid [grid-template-columns:minmax(220px,_280px)_minmax(0,_1fr)]
  [grid-template-rows:minmax(0,_1fr)] [column-gap:var(--eye-card-gap)] [row-gap:10px] [@container(max-width:_900px)]:[grid-template-columns:minmax(0,_1fr)]
  [@container(max-width:_900px)]:[grid-template-rows:auto_minmax(0,_1fr)]
`

export const EyePreviewCardStyles = `
  [grid-column:2] [grid-row:1] min-w-0 min-h-0
  flex flex-col overflow-hidden [border:1px_solid_var(--line)]
  [border-radius:11px] [background:var(--eye-preview)] [&.is-empty]:[justify-self:stretch] [&.has-source]:[align-self:stretch]
  [&.has-source]:[justify-self:stretch] [&.has-source]:w-full [&.has-source]:h-full [&.has-source]:[max-width:100%]
  [@container(max-width:_900px)]:[grid-column:1] [@container(max-width:_900px)]:[grid-row:2]
`

export const EyeControlsStyles = `
  [container-type:inline-size] h-full min-h-0 min-w-0
  [margin:0] [padding:0] flex flex-col
  overflow-hidden [background:var(--card)] [border:1px_solid_var(--line)] [border-radius:10px]
  [&_h3]:[font-size:17px] [&_h3]:[letter-spacing:-0.5px] [&_h3]:[font-weight:530] [&_h3]:[margin:16px_0_6px]
  [&_h3]:[line-height:1.4] [&_>_.eye-button]:w-full [&_>_.eye-button]:[margin:9px_0] [&_form_>_.eye-button:not(.eye-action-icon)]:w-full
  [&_form_>_.eye-button:not(.eye-action-icon)]:[margin-top:8px]
`

export const EyeControlsHeadingStyles = `
  relative [z-index:20] [flex:0_0_auto] min-w-0
  flex items-center justify-between [gap:10px]
  [min-height:44px] [padding:8px_14px] [border-bottom:1px_solid_var(--line)] [&_h2]:[font-size:13px]
  [&_h2]:[line-height:1.25] [&_h2]:[letter-spacing:0] [&_h2]:[font-weight:520] [&_h2]:[margin:0]
  [&_p]:[font-size:11px] [&_p]:[color:var(--dim)] [&_p]:[line-height:1.45] [&_p]:[margin:0]
`

export const EyeControlsBodyStyles = `
  [flex:1_1_auto] min-h-0 overflow-y-auto [overscroll-behavior:contain]
  [padding:12px_14px] [&_>_.eye-head-preview]:[padding-top:0] [&_>_.eye-head-preview]:[border-top:0] max-[480px]:[padding:10px]
`

export const EyeBottomBarStyles = `
  [flex:0_0_auto] w-full [max-width:1550px] [margin:0_auto]
  [padding:7px_4%_10px] flex items-center justify-end
  [gap:20px] [&_>_div]:flex [&_>_div]:[gap:10px] [&_>_div]:[margin-left:auto]
  [&.has-model-status_>_div]:w-full [&_.eye-button]:[min-width:110px] max-[1150px]:[padding-left:3%] max-[1150px]:[padding-right:3%]
  max-[650px]:[padding:6px_14px_8px] max-[650px]:[&_.eye-button]:[flex:0_0_auto] max-[650px]:[&_.eye-button]:[min-width:96px] max-[650px]:[&_.eye-button]:[min-height:34px]
  max-[650px]:[&_.eye-button]:[font-size:10px] [@media(max-height:_760px)]:[padding-top:4px] [@media(max-height:_760px)]:[padding-bottom:7px]
`
