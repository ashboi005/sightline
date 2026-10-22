"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@sightline/ui/components/tooltip";

/** In the collapsed icon rail, a control's label moves into a tooltip (keep it as the accessible name too). */
export function RailTip({ label, show, children }: { label: string; show: boolean; children: React.ReactElement }) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10} className="rounded-xl px-2.5 py-1.5 text-sm font-semibold">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
