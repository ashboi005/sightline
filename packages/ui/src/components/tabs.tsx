"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@sightline/ui/lib/utils";

const Tabs = TabsPrimitive.Root;

/** A sunken track; the selected tab rises as a clay chip. */
function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn("inline-flex items-center gap-1 rounded-2xl bg-muted p-1 shadow-[var(--clay-sunken)]", className)}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-semibold text-muted-foreground outline-none transition-[color,background,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-card data-[active]:text-foreground data-[active]:shadow-[var(--clay-shadow-sm)]",
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn("outline-none", className)} {...props} />;
}

export { Tabs, TabsList, TabsPanel, TabsTab };
