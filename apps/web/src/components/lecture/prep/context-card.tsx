"use client";

import { SLIDE_UPLOAD_ACCEPT, SLIDE_UPLOAD_MAX_BYTES } from "@sightline/contracts";
import { Button } from "@sightline/ui/components/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@sightline/ui/components/tabs";
import { Textarea } from "@sightline/ui/components/textarea";
import { cn } from "@sightline/ui/lib/utils";
import { FileText, LoaderCircle, RefreshCw, Type, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { ClayCard, InlineAlert, SectionTitle, StatusPill } from "@/components/clay/clay";
import { useLectureContext, useSetContextText, useSlides, useUploadSlides } from "@/hooks/use-lecture-data";
import { assetUrl, errorMessage } from "@/lib/api";
import { processingLabel } from "@/lib/format";

const MB = 1024 * 1024;

/** Client-side check against the contract's limits, so a wrong file fails instantly with a clear reason. */
function checkFile(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!(SLIDE_UPLOAD_ACCEPT as readonly string[]).includes(ext)) return `“${file.name}” isn't a PDF, PPT or PPTX file.`;
  if (file.size > SLIDE_UPLOAD_MAX_BYTES) return `“${file.name}” is ${Math.round(file.size / MB)} MB. Slides must be 50 MB or smaller.`;
  return null;
}

function SlidesUpload({ sessionId }: { sessionId: string }) {
  const slides = useSlides(sessionId);
  const upload = useUploadSlides(sessionId);
  const input = useRef<HTMLInputElement>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const deck = slides.data;

  const send = (file: File) => {
    const problem = checkFile(file);
    setFileError(problem);
    if (problem) return;
    setLastFile(file);
    upload.mutate(file);
  };

  const status = upload.isPending ? null : deck?.status;

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) send(file);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-[1.4rem] border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-marigold bg-highlight" : "border-border bg-muted/50",
        )}
      >
        <Upload aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="font-semibold">Drop the lecture slides here</p>
        <p className="text-sm text-muted-foreground">PDF, PPT or PPTX, up to 50 MB</p>
        <Button variant="clay-soft" onClick={() => input.current?.click()} disabled={upload.isPending}>
          Choose a file
        </Button>
        <input
          ref={input}
          type="file"
          accept={SLIDE_UPLOAD_ACCEPT.join(",")}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) send(file);
            e.target.value = "";
          }}
        />
      </div>

      {fileError && <InlineAlert>{fileError}</InlineAlert>}

      <div aria-live="polite" className="space-y-3">
        {upload.isPending && (
          <p className="flex items-center gap-2 text-sm font-semibold">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            Uploading {lastFile?.name}…
          </p>
        )}
        {upload.isError && (
          <InlineAlert
            action={
              lastFile && (
                <Button variant="clay-soft" size="sm" onClick={() => send(lastFile)}>
                  <RefreshCw /> Retry
                </Button>
              )
            }
          >
            The upload didn&apos;t go through. {errorMessage(upload.error)}
          </InlineAlert>
        )}
        {deck && status && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <FileText aria-hidden="true" className="size-4 text-muted-foreground" />
            <span className="font-semibold">{deck.fileName}</span>
            <StatusPill kind={processingLabel(deck.status, "Slides").kind}>
              {status === "PROCESSING" ? "Reading the slides…" : status === "READY" ? `${deck.pageCount} slides ready` : processingLabel(status, "Slides").label}
            </StatusPill>
          </div>
        )}
        {deck?.status === "FAILED" && (
          <InlineAlert
            action={
              lastFile && (
                <Button variant="clay-soft" size="sm" onClick={() => send(lastFile)}>
                  <RefreshCw /> Try again
                </Button>
              )
            }
          >
            {deck.error ?? "The slides couldn't be read."} {!lastFile && "Choose the file again to retry."}
          </InlineAlert>
        )}
        {deck?.status === "READY" && deck.slides.length > 0 && (
          <ol className="flex snap-x gap-3 overflow-x-auto pb-2" aria-label="Slide preview">
            {deck.slides.map((s) => (
              <li key={s.id} className="w-44 shrink-0 snap-start">
                <img src={assetUrl(s.imageUrl)} alt={s.title ?? `Slide ${s.index + 1}`} className="aspect-video w-full rounded-xl border bg-card object-cover" />
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {s.index + 1}. {s.title}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function TopicText({ sessionId, initial }: { sessionId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const save = useSetContextText(sessionId);
  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        maxLength={20_000}
        aria-label="What the lecture covers"
        placeholder="Kirchhoff's laws: current law (KCL) at nodes, voltage law (KVL) around loops, Ohm's law recap, mesh analysis."
        className="min-h-32"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="clay-soft" disabled={!text.trim() || save.isPending} onClick={() => save.mutate(text.trim())}>
          {save.isPending && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
          Save topic
        </Button>
        {save.isError && <span className="text-sm text-destructive">{errorMessage(save.error)}</span>}
      </div>
    </div>
  );
}

/** Slides or typed context teach the captions the lecture's vocabulary. */
export function ContextCard({ sessionId }: { sessionId: string }) {
  const context = useLectureContext(sessionId);
  const ctx = context.data;
  const label = ctx ? processingLabel(ctx.status, "Context") : null;

  return (
    <ClayCard className="p-6">
      <SectionTitle aside={label && <StatusPill kind={label.kind}>{ctx?.status === "READY" ? "Captions know this lecture" : label.label}</StatusPill>}>
        What the lecture is about
      </SectionTitle>
      <p className="mt-1.5 text-muted-foreground">
        Sightline learns the subject&apos;s words, so captions spell them right and spoken formulas become maths.
      </p>

      <Tabs defaultValue="slides" className="mt-5">
        <TabsList aria-label="How to add context">
          <TabsTab value="slides">
            <Upload className="size-4" /> Upload slides
          </TabsTab>
          <TabsTab value="text">
            <Type className="size-4" /> Type the topic
          </TabsTab>
        </TabsList>
        <TabsPanel value="slides" className="mt-4">
          <SlidesUpload sessionId={sessionId} />
        </TabsPanel>
        <TabsPanel value="text" className="mt-4">
          {context.isSuccess && <TopicText sessionId={sessionId} initial={ctx?.text ?? ""} />}
        </TabsPanel>
      </Tabs>

      {ctx?.status === "FAILED" && <InlineAlert className="mt-4">{ctx.error ?? "Sightline couldn't learn from this context. Try other slides or text."}</InlineAlert>}
      {ctx?.status === "READY" && ctx.topics.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold">Topics Sightline found</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ctx.topics.map((topic) => (
              <li key={topic} className="rounded-full bg-lilac px-2.5 py-1 text-sm font-semibold text-lilac-ink">
                {topic}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ctx?.status === "READY" && ctx.glossary.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold">Words the captions will get right</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ctx.glossary.slice(0, 16).map((t) => (
              <li key={t.id} className="rounded-full bg-sage px-2.5 py-1 text-sm font-semibold text-sage-ink">
                {t.term}
              </li>
            ))}
            {ctx.glossary.length > 16 && <li className="px-1 py-1 text-sm text-muted-foreground">+{ctx.glossary.length - 16} more</li>}
          </ul>
        </div>
      )}
    </ClayCard>
  );
}
