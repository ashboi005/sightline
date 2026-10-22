"use client";

import { Tabs, TabsList, TabsPanel, TabsTab } from "@sightline/ui/components/tabs";
import { cn } from "@sightline/ui/lib/utils";
import { ChevronDown, Ear, Hand, ImagePlus, Presentation } from "lucide-react";
import { useEffect, useState } from "react";

import { IconTile, InlineAlert } from "@/components/clay/clay";
import { SignPanel } from "@/components/sign/sign-panel";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { BoardPanel } from "./board-panel";
import { CaptionsView } from "./captions-view";
import { LiveHeader } from "./live-header";
import { SlidesPanel } from "./slides-panel";
import { VoiceFocusPanel } from "./voice-focus-panel";

type PanelId = "slides" | "voice" | "sign" | "board";
const OPEN_KEY = "sightline.live-panels";

const PANELS: { id: PanelId; title: string; short: string; icon: typeof Hand; tone: "marigold" | "sage" | "lilac" }[] = [
  { id: "slides", title: "Slides", short: "Slides", icon: Presentation, tone: "marigold" },
  { id: "voice", title: "Voice focus", short: "Voice", icon: Ear, tone: "sage" },
  { id: "sign", title: "Sign", short: "Sign", icon: Hand, tone: "lilac" },
  { id: "board", title: "Board snapshots", short: "Board", icon: ImagePlus, tone: "sage" },
];

function PanelBody({ id }: { id: PanelId }) {
  const lecture = useLiveLecture();
  if (id === "slides") return <SlidesPanel />;
  if (id === "voice") return <VoiceFocusPanel />;
  if (id === "sign") return <SignPanel sessionId={lecture.activeId} variant="panel" />;
  return <BoardPanel />;
}

/** Remembered open/closed state of the side panels. */
function useOpenPanels() {
  const [open, setOpen] = useState<Record<PanelId, boolean>>({ slides: true, voice: true, sign: false, board: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "null");
      if (saved) setOpen((o) => ({ ...o, ...saved }));
    } catch {}
  }, []);
  const toggle = (id: PanelId) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  return { open, toggle };
}

function SidePanels({ panels }: { panels: typeof PANELS }) {
  const { open, toggle } = useOpenPanels();
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto pr-1 pb-2">
      {panels.map((p) => (
        <section key={p.id} className="rounded-[1.5rem] clay">
          <h2>
            <button
              type="button"
              aria-expanded={open[p.id]}
              aria-controls={`panel-${p.id}`}
              onClick={() => toggle(p.id)}
              className="flex w-full items-center gap-3 rounded-[1.5rem] px-4 py-3 text-left font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <IconTile icon={p.icon} tone={p.tone} size="sm" />
              <span className="flex-1">{p.title}</span>
              <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform motion-reduce:transition-none", open[p.id] && "rotate-180")} />
            </button>
          </h2>
          {open[p.id] && (
            <div id={`panel-${p.id}`} className="px-4 pb-4">
              <PanelBody id={p.id} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * The lecture in progress: captions are the main reading region; slides, voice focus (hard-of-hearing mode), sign
 * and board snapshots sit beside them on wide screens and behind tabs on small ones. Only one layout is mounted,
 * so devices and services are never opened twice.
 */
export function LiveWorkspace() {
  const lecture = useLiveLecture();
  const wide = useMediaQuery("(min-width: 1024px)");
  const panels = PANELS.filter((p) => p.id !== "voice" || lecture.mode === "HARD_OF_HEARING");
  const error = lecture.live.lastError;

  return (
    <div className="mx-auto flex max-w-[110rem] flex-col gap-4 lg:h-[calc(100svh-4rem)]">
      <LiveHeader />
      {error && <InlineAlert>{error.code === "NOT_LIVE" ? "This lecture isn't live any more." : error.message}</InlineAlert>}

      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] gap-4">
          <CaptionsView className="min-h-0" />
          <SidePanels panels={panels} />
        </div>
      ) : (
        <Tabs defaultValue="captions">
          <TabsList aria-label="Lecture panels" className="flex w-full overflow-x-auto">
            <TabsTab value="captions" className="flex-1">
              Captions
            </TabsTab>
            {panels.map((p) => (
              <TabsTab key={p.id} value={p.id} className="flex-1">
                {p.short}
              </TabsTab>
            ))}
          </TabsList>
          <TabsPanel value="captions" className="mt-3">
            <CaptionsView className="h-[calc(100svh-15rem)] min-h-96" />
          </TabsPanel>
          {panels.map((p) => (
            <TabsPanel key={p.id} value={p.id} className="mt-3 rounded-[1.5rem] clay p-4">
              <PanelBody id={p.id} />
            </TabsPanel>
          ))}
        </Tabs>
      )}
    </div>
  );
}
