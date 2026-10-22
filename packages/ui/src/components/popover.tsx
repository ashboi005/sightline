"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@sightline/ui/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  side = "top",
  sideOffset = 8,
  align = "center",
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <PopoverPrimitive.Popup
          className={cn(
            "max-w-xs origin-(--transform-origin) rounded-2xl bg-popover p-4 text-sm text-popover-foreground shadow-[var(--clay-shadow)] outline-none transition-[opacity,transform] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none",
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

const PopoverTitle = PopoverPrimitive.Title;
const PopoverDescription = PopoverPrimitive.Description;

export { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger };
