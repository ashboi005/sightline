import { Presentation } from "lucide-react";

import { Formula } from "@/components/formula";

/** Static excerpt of a lecture in the workspace, shown beside the auth forms on wide screens. */
export function AuthAside() {
  return (
    <aside className="relative hidden overflow-hidden bg-slate p-12 text-[#ecedea] lg:flex lg:flex-col lg:justify-between">
      <p className="max-w-sm text-3xl leading-tight font-bold tracking-[-0.02em] text-balance">
        Look up at the board. The lecture waits for you.
      </p>

      <div aria-hidden="true" className="space-y-5 text-xl leading-normal font-medium">
        <p className="text-[#ecedea]/55">The current flowing into a node equals the current flowing out.</p>
        <div className="rounded-lg bg-white/6 px-3 py-1.5 text-[#ecedea]/80">
          <Formula tex="\sum I_{\text{in}} = \sum I_{\text{out}}" display />
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-marigold">
          <Presentation className="size-4" />
          You looked at the board
          <span className="flex-1 border-t-2 border-dashed border-marigold/70" />
        </div>
        <p className="-mx-2 rounded-md bg-marigold/25 px-2">
          Now the voltage law. Around any closed loop, <Formula tex="\sum V = 0" />.
        </p>
        <p className="-mx-2 rounded-md bg-marigold/25 px-2">
          So across each resistor in the loop, <Formula tex="V = IR" />.
        </p>
      </div>

      <p className="text-sm text-[#ecedea]/60">EE101: Kirchhoff&apos;s laws, 10:03</p>
    </aside>
  );
}
