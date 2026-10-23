"use client";

import { startMicCapture, type MicCapture } from "@sightline/live-client";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeMediaError } from "@/lib/media/errors";

/** One explicitly selected microphone, shared by captions, focus and local voice commands. */
export function useMicrophone() {
  const micRef = useRef<MicCapture | null>(null);
  const selected = useRef("");
  const pending = useRef<Promise<MicCapture | null> | null>(null);
  const generation = useRef(0);
  const inventory = useRef(0);
  const mounted = useRef(true);
  const [mic, setMic] = useState<MicCapture | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    generation.current++;
    pending.current = null;
    const previous = micRef.current;
    micRef.current = null;
    if (mounted.current) {
      setMic(null);
      setBusy(false);
    }
    await previous?.stop();
  }, []);

  const refreshDevices = useCallback(async () => {
    const request = ++inventory.current;
    setRefreshing(true);
    try {
      const media = navigator.mediaDevices;
      if (!media?.enumerateDevices)
        throw new Error(
          "Microphone selection needs a supported browser over localhost or HTTPS.",
        );
      const inputs = (await media.enumerateDevices()).filter(
        (device) => device.kind === "audioinput" && device.deviceId,
      );
      if (!mounted.current || request !== inventory.current) return;
      setDevices(inputs);
      setDeviceError(null);
      if (
        micRef.current &&
        selected.current !== "default" &&
        !inputs.some((device) => device.deviceId === selected.current)
      ) {
        await stop();
        if (mounted.current)
          setError(
            "The selected microphone disconnected. Choose an input and restart voice focus.",
          );
      }
    } catch (cause) {
      if (mounted.current && request === inventory.current)
        setDeviceError(
          cause instanceof Error
            ? cause.message
            : "Microphones could not be listed. Try refreshing the list.",
        );
    } finally {
      if (mounted.current && request === inventory.current)
        setRefreshing(false);
    }
  }, [stop]);

  const start = useCallback(async () => {
    if (!selected.current) {
      setError("Choose a microphone input before starting.");
      return null;
    }
    if (micRef.current) return micRef.current;
    if (pending.current) return pending.current;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    const task = startMicCapture({ deviceId: selected.current })
      .then(async (capture) => {
        if (!mounted.current || request !== generation.current) {
          await capture.stop();
          return null;
        }
        micRef.current = capture;
        setMic(capture);
        void refreshDevices();
        return capture;
      })
      .catch((cause: unknown) => {
        if (mounted.current && request === generation.current)
          setError(describeMediaError(cause, "microphone"));
        return null;
      })
      .finally(() => {
        if (pending.current === task) {
          pending.current = null;
          if (mounted.current) setBusy(false);
        }
      });
    pending.current = task;
    return task;
  }, [refreshDevices]);

  const select = useCallback(
    async (id: string) => {
      if (selected.current === id) return;
      selected.current = id;
      setDeviceId(id);
      setError(null);
      await stop();
    },
    [stop],
  );

  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    const media = navigator.mediaDevices;
    const changed = () => void refreshDevices();
    media?.addEventListener("devicechange", changed);
    return () => {
      mounted.current = false;
      generation.current++;
      inventory.current++;
      media?.removeEventListener("devicechange", changed);
      void micRef.current?.stop();
      micRef.current = null;
    };
  }, [refreshDevices]);

  useEffect(() => {
    if (!mic) return;
    const changed = () => {
      if (mic.context.state !== "closed" || micRef.current !== mic) return;
      void stop();
      setError(
        "Microphone capture stopped. Check the selected input and start again.",
      );
    };
    mic.context.addEventListener("statechange", changed);
    return () => mic.context.removeEventListener("statechange", changed);
  }, [mic, stop]);

  return {
    mic,
    deviceId,
    devices,
    busy,
    refreshing,
    error,
    deviceError,
    start,
    stop,
    select,
    refreshDevices,
  };
}
