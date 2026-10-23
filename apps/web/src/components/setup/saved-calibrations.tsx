"use client";
import { Button } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import {
  BookmarkCheck,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { ClayCard, InlineAlert, StatusPill } from "@/components/clay/clay";
import { useSceneTracking } from "@/providers/scene/context";
import { canUseSceneCalibration } from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";

export function SavedCalibrations() {
  const { profiles, state, setStep, tracker, invalidateEye } =
    useSceneTracking();
  const [open, setOpen] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const start = (id?: string) => {
    if (!profiles.begin(id)) return;
    tracker.configure({ locked: false });
    invalidateEye();
    setStep(0);
    setOpen(false);
  };
  return (
    <ClayCard className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BookmarkCheck className="size-5 text-sage-ink" />
          <div>
            <h2 className="font-bold">Your calibrations</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Saved to your account on this browser.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            aria-label="Import calibration diagnostics"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                setOpen(true);
                void profiles.importCalibration(file);
              }
            }}
          />
          <Button
            variant="ghost"
            disabled={!!state.capture}
            onClick={() => importInput.current?.click()}
          >
            <Upload /> Import diagnostics
          </Button>
          <Button
            variant="clay-soft"
            disabled={
              !!state.capture ||
              !(state.calibration || state.fitFailure?.previewCalibration)
            }
            onClick={() => {
              if (profiles.save(undefined, true)) setOpen(true);
            }}
            title="Save the current mapping as a new profile and keep this setup open"
          >
            <Plus /> Save as new calibration
          </Button>
          <Button
            variant="ghost"
            disabled={!!state.capture}
            onClick={() => start()}
            title="Preserve the current mapping and return to the first setup step"
          >
            <RotateCcw /> Restart setup
          </Button>
          <Button
            variant="ghost"
            aria-expanded={open}
            aria-controls="saved-calibrations"
            onClick={() => setOpen((v) => !v)}
          >
            {open
              ? "Hide saved"
              : `Saved (${profiles.library.profiles.length})`}
          </Button>
        </div>
      </div>
      {profiles.replacing && (
        <p className="mt-4 rounded-xl bg-lilac p-3 text-sm text-lilac-ink">
          Replacing “{profiles.replacing.name}”. Your saved version stays intact
          until the new calibration succeeds.
        </p>
      )}
      {open && (
        <div id="saved-calibrations" className="mt-5 space-y-3">
          {profiles.library.profiles.length === 0 ? (
            <p className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
              Your first calibration will appear here when you finish setup.
            </p>
          ) : (
            <>
              {!profiles.canLoad && (
                <p className="text-sm text-muted-foreground">
                  Connect both cameras and lock your eye model before using a
                  saved calibration.
                </p>
              )}
              <ul className="grid gap-3 sm:grid-cols-2">
                {profiles.library.profiles.map((profile) => (
                  <li
                    key={profile.id}
                    className="rounded-2xl bg-card/70 p-4 ring-1 ring-border"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="break-words font-bold">{profile.name}</h3>
                      {profile.unverified && (
                        <StatusPill kind="attention">
                          Accuracy not verified
                        </StatusPill>
                      )}
                      {profiles.active?.id === profile.id && (
                        <StatusPill
                          kind={profile.unverified ? "idle" : "ready"}
                        >
                          {profile.unverified ? "Current draft" : "In use"}
                        </StatusPill>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {profile.method === "one-point"
                        ? "One point · estimate"
                        : profile.method === "marker"
                          ? "Marker · 9 positions"
                          : "Hand · 9 positions"}{" "}
                      · {new Date(profile.updatedAt).toLocaleDateString()}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="clay"
                        disabled={!profiles.canLoad}
                        onClick={() => {
                          if (profiles.load(profile.id)) setStep(6);
                        }}
                      >
                        <Play /> Use saved
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!state.capture}
                        onClick={() => start()}
                        title="Go through all setup steps and save a new calibration"
                      >
                        <RotateCcw /> Replay steps
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!state.capture}
                        onClick={() => start(profile.id)}
                      >
                        <RefreshCw /> Replace
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {profiles.error && (
        <InlineAlert className="mt-4">{profiles.error}</InlineAlert>
      )}
      {(state.calibration || state.fitFailure?.previewCalibration) &&
        !state.capture && (
          <div className="mt-5">
            <SaveCalibration key={profiles.active?.id ?? "unsaved"} />
          </div>
        )}
      {!state.calibration &&
        !state.fitFailure?.previewCalibration &&
        profiles.message && (
          <p className="mt-4 text-sm text-sage-ink" role="status">
            {profiles.message}
          </p>
        )}
    </ClayCard>
  );
}

export function SaveCalibration() {
  const { profiles, state } = useSceneTracking();
  const [name, setName] = useState("");
  const mapping = state.fitFailure?.previewCalibration ?? state.calibration;
  const unverified =
    mapping !== state.calibration || !canUseSceneCalibration(state);
  return (
    <div className="space-y-3 rounded-2xl bg-sage/50 p-4">
      <div className="flex items-center gap-2 font-bold">
        <BookmarkCheck className="size-4" />
        {profiles.active ? "Calibration saved" : "Save your calibration"}
      </div>
      <p className="text-sm text-muted-foreground" role="status">
        {profiles.message || "Keep this mapping so you can use it again."}
      </p>
      {unverified && (
        <p className="text-sm text-muted-foreground">
          Save this mapping as a draft. Its accuracy still needs to be checked.
        </p>
      )}
      <label className="block text-sm font-semibold" htmlFor="calibration-name">
        Calibration name
      </label>
      <Input
        id="calibration-name"
        value={name}
        maxLength={60}
        placeholder={profiles.active?.name ?? "e.g. Lecture room · headset"}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="clay"
          disabled={!!state.capture || !mapping}
          onClick={() => profiles.save(name.trim() || profiles.active?.name)}
        >
          {profiles.active ? "Save changes" : "Save calibration"}
        </Button>
        <Button
          variant="clay-soft"
          disabled={!!state.capture || !mapping}
          onClick={() => profiles.save(name.trim() || undefined, true)}
        >
          Save as new
        </Button>
      </div>
    </div>
  );
}
