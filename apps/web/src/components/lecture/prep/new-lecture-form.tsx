"use client";

import type { AccessibilityMode } from "@sightline/contracts";
import { Button, buttonVariants } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import { Label } from "@sightline/ui/components/label";
import { Captions, LoaderCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { ClayCard, InlineAlert, PageHeader } from "@/components/clay/clay";
import { useCreateSession } from "@/hooks/use-sessions";
import { errorMessage } from "@/lib/api";
import { useLiveLecture } from "@/providers/live-lecture-provider";

import { ModePicker } from "./mode-picker";

/** Step 1 of a lecture: a title, an optional subject and the mode. Submitting creates the DRAFT lecture once. */
export function NewLectureForm() {
  const router = useRouter();
  const create = useCreateSession();
  const lecture = useLiveLecture();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<AccessibilityMode>("DEAF");
  const [touched, setTouched] = useState(false);
  const submitted = useRef(false);
  const titleError = touched && !title.trim() ? "Give the lecture a title, like “EE101 Lecture 8”." : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!title.trim() || submitted.current) return;
    submitted.current = true; // a double click or Enter repeat can't create a second lecture
    create.mutate(
      { title: title.trim(), subject: subject.trim() || undefined, mode },
      {
        onSuccess: (session) => router.replace(`/lecture/${session.id}` as Route),
        onError: () => {
          submitted.current = false;
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader icon={Captions} title="New lecture"/>

      {lecture.activeId && (
        <ClayCard tone="marigold" className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="font-semibold">“{lecture.session?.title}” is still live. End it before starting another.</p>
          <Link href={`/lecture/${lecture.activeId}` as Route} className={buttonVariants({ variant: "clay-soft" })}>
            Return to lecture
          </Link>
        </ClayCard>
      )}

      <ClayCard className="p-6 sm:p-8">
        <form onSubmit={submit} noValidate className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="title">Lecture title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="EE101 Lecture 8: Thevenin equivalents"
              maxLength={200}
              autoFocus
              aria-invalid={Boolean(titleError) || undefined}
              aria-describedby={titleError ? "title-error" : undefined}
            />
            {titleError && (
              <p id="title-error" className="text-sm font-medium text-destructive">
                {titleError}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">
              Subject <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Basic Electrical Engineering" maxLength={200} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">How will you follow this lecture?</p>
            <ModePicker value={mode} onChange={setMode} />
          </div>

          {create.isError && <InlineAlert>{errorMessage(create.error)}</InlineAlert>}

          <Button type="submit" variant="clay" size="lg" disabled={create.isPending || create.isSuccess}>
            {(create.isPending || create.isSuccess) && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
            {create.isPending || create.isSuccess ? "Creating lecture" : "Continue"}
          </Button>
        </form>
      </ClayCard>
    </div>
  );
}
