"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSceneProfileStore,
  sceneProfileSetupIssue,
} from "@/features/scene-tracking/features/scene-eye-tracking/calibration-profiles";
import type { SceneProfileSetup } from "@/features/scene-tracking/features/scene-eye-tracking/calibration-profiles.types";
import type {
  CalibrationMethod,
  SceneCalibration,
} from "@/features/scene-tracking/features/scene-eye-tracking/scene.types";
import type { Point } from "@/features/scene-tracking/features/eye-tracking/eye-tracking.types";
import {
  canUseSceneCalibration,
  type SceneSession,
  type SceneSessionSnapshot,
} from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";

const browserStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
};

/** Persistence and explicit replacement intent are separate from the live calibration. */
export function useSceneProfiles(
  userId: string,
  session: SceneSession,
  state: SceneSessionSnapshot,
  setup: SceneProfileSetup,
  ready: boolean,
) {
  const store = useMemo(
    () => createSceneProfileStore(userId, browserStorage),
    [userId],
  );
  const [library, setLibrary] = useState(() => store.read());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const attempted = useRef<SceneSessionSnapshot["calibration"]>(null);
  const savedMapping = useRef<SceneSessionSnapshot["calibration"]>(null);
  const attemptedAdjustment = useRef("");
  const active = library.profiles.find((p) => p.id === activeId) ?? null;
  const replacing = library.profiles.find((p) => p.id === replaceId) ?? null;

  const save = useCallback(
    (name?: string, asNew = false) => {
      const current = session.getSnapshot();
      try {
        if (current.capture)
          throw new Error(
            "Finish or cancel the current capture before saving your calibration.",
          );
        const calibration =
          current.fitFailure?.previewCalibration ?? current.calibration;
        if (!calibration)
          throw new Error(
            "There is no fitted calibration mapping to save yet.",
          );
        const usable =
          calibration === current.calibration &&
          canUseSceneCalibration(current);
        const replacesMapping =
          replaceId || (activeId && calibration !== savedMapping.current);
        if (replacesMapping && !asNew && !usable)
          throw new Error(
            "Complete a successful accuracy check before replacing your saved calibration. You can save this preview as new instead.",
          );
        const id = asNew ? undefined : (replaceId ?? activeId ?? undefined);
        const latest = store.read();
        const existing = latest.profiles.find((p) => p.id === id);
        let number = latest.profiles.length + 1;
        while (
          latest.profiles.some((p) => p.name === `Scene calibration ${number}`)
        )
          number++;
        const profile = store.save(
          name ?? existing?.name ?? `Scene calibration ${number}`,
          {
            calibration,
            method: current.method,
            offset: current.offset,
            delayMs: current.delayMs,
            unverified: !usable,
          },
          setup,
          id,
        );
        savedMapping.current = calibration;
        attempted.current = current.calibration;
        setActiveId(profile.id);
        setReplaceId(null);
        setLibrary(store.read());
        setError("");
        setMessage(
          `Saved “${profile.name}” to your profile on this browser.${profile.unverified ? " Accuracy not verified; your mapping is kept for preview and a fresh check." : ""}`,
        );
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not save this calibration.",
        );
        return false;
      }
    },
    [activeId, replaceId, session, setup, store],
  );

  useEffect(() => {
    if (
      !ready ||
      state.capture ||
      !state.calibration ||
      state.calibration === attempted.current
    )
      return;
    if (!state.validation?.passed && state.method !== "one-point") return;
    attempted.current = state.calibration;
    save();
  }, [
    ready,
    save,
    state.calibration,
    state.capture,
    state.method,
    state.validation?.passed,
  ]);

  // Keep adjustments and verification eligibility with the active saved mapping.
  useEffect(() => {
    if (
      !active ||
      !ready ||
      state.capture ||
      state.calibration !== savedMapping.current
    )
      return;
    const unverified = !canUseSceneCalibration(state);
    if (
      active.offset.every((v, i) => v === state.offset[i]) &&
      !!active.unverified === unverified
    )
      return;
    const signature = JSON.stringify([active.id, state.offset, unverified]);
    if (attemptedAdjustment.current === signature) return;
    attemptedAdjustment.current = signature;
    save();
  }, [active, ready, save, state]);

  function load(id: string) {
    if (!ready || state.capture) return false;
    try {
      const profile = store.read().profiles.find((p) => p.id === id);
      if (!profile) throw new Error("This calibration is no longer saved.");
      const issue = sceneProfileSetupIssue(profile, setup);
      if (issue) throw new Error(issue);
      store.select(id);
      session.restoreCalibration({
        ...profile,
        unverified:
          profile.unverified ||
          !setup.fingerprint ||
          setup.fingerprint !== profile.setup.fingerprint,
      });
      attempted.current = session.getSnapshot().calibration;
      savedMapping.current = attempted.current;
      setActiveId(id);
      setReplaceId(null);
      setLibrary(store.read());
      setError("");
      setMessage(
        "Calibration loaded. Run a fresh accuracy check after putting on your headset.",
      );
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load this calibration.",
      );
      return false;
    }
  }

  function begin(replacementId?: string) {
    const current = session.getSnapshot();
    if (current.capture) {
      setError(
        "Finish or cancel the current capture before starting a new calibration.",
      );
      return false;
    }
    const calibration =
      current.fitFailure?.previewCalibration ?? current.calibration;
    if (calibration) {
      // Preserve an unverified replacement as a separate draft so an accepted
      // profile cannot be overwritten by starting another run.
      const usable =
        calibration === current.calibration && canUseSceneCalibration(current);
      const asNew =
        !usable &&
        !!(replaceId || (activeId && calibration !== savedMapping.current));
      const alreadySaved =
        active &&
        calibration === savedMapping.current &&
        active.method === current.method &&
        active.delayMs === current.delayMs &&
        active.offset.every(
          (value, index) => value === current.offset[index],
        ) &&
        !!active.unverified === !usable &&
        store
          .read()
          .profiles.some(
            (profile) =>
              profile.id === active.id &&
              profile.updatedAt === active.updatedAt,
          );
      if (!alreadySaved && !save(undefined, asNew)) return false;
    }
    session.invalidate();
    attempted.current = null;
    savedMapping.current = null;
    setActiveId(null);
    setReplaceId(replacementId ?? null);
    setError("");
    if (!calibration) setMessage("");
    return true;
  }

  async function importCalibration(file: File) {
    try {
      if (file.size > 2_000_000)
        throw new Error("Choose a calibration JSON file smaller than 2 MB.");
      const data: unknown = JSON.parse(await file.text());
      if (
        !data ||
        typeof data !== "object" ||
        !("calibration" in data) ||
        !data.calibration ||
        typeof data.calibration !== "object"
      )
        throw new Error("This file does not contain a calibration mapping.");
      const calibration = data.calibration as SceneCalibration;
      const method =
        calibration.method ?? ("method" in data ? data.method : "hand");
      if (
        !["hand", "marker", "one-point"].includes(String(method)) ||
        (method === "one-point") !== !!calibration.onePoint
      )
        throw new Error("The calibration method does not match the mapping.");
      const latest = store.read();
      let name = "Recovered calibration";
      for (
        let number = 2;
        latest.profiles.some((profile) => profile.name === name);
        number++
      )
        name = `Recovered calibration ${number}`;
      const profile = store.save(
        name,
        {
          calibration,
          method: method as CalibrationMethod,
          offset: ("offset" in data ? data.offset : [0, 0]) as Point,
          delayMs: ("delayMs" in data ? data.delayMs : 0) as number,
          // A diagnostic file cannot establish the current eye model or accuracy.
          unverified: true,
        },
        { ...setup, fingerprint: undefined },
      );
      setLibrary(store.read());
      setError("");
      setMessage(
        `Recovered “${profile.name}”. Its mapping is saved; run a fresh accuracy check before using it.`,
      );
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this calibration.",
      );
      return false;
    }
  }

  return {
    library,
    active,
    replacing,
    error,
    message,
    save,
    load,
    begin,
    importCalibration,
    canLoad: ready && !state.capture,
  };
}
