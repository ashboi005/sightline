"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type OutputDevices = MediaDevices & {
  selectAudioOutput?: (options?: {
    deviceId?: string;
  }) => Promise<MediaDeviceInfo>;
};

/** Output selection lives with the lecture, so collapsing or changing panels keeps the same speaker. */
export function useSpeakerOutput(
  change: (id: string) => Promise<void>,
  lost: () => void,
  active: boolean,
) {
  const [deviceId, setDeviceId] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canChoose, setCanChoose] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ deviceId, active, lost });
  latest.current = { deviceId, active, lost };

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const media = navigator.mediaDevices as OutputDevices | undefined;
    setCanChoose(!!media?.selectAudioOutput);
    const refresh = async (changed = false) => {
      try {
        const outputs = ((await media?.enumerateDevices()) ?? []).filter(
          (d) => d.kind === "audiooutput",
        );
        if (cancelled) return;
        setDevices(outputs);
        const current = latest.current;
        if (
          changed &&
          current.active &&
          current.deviceId &&
          !outputs.some((d) => d.deviceId === current.deviceId)
        ) {
          setError(
            "The selected speaker disconnected. Choose an output and restart voice focus.",
          );
          current.lost();
        }
      } catch {
        /* System default remains available without device enumeration permission. */
      }
    };
    void refresh();
    const changed = () => void refresh(true);
    media?.addEventListener("devicechange", changed);
    return () => {
      cancelled = true;
      mounted.current = false;
      media?.removeEventListener("devicechange", changed);
    };
  }, [active]);

  const update = useCallback(
    async (
      resolve: () => Promise<{ id: string; device?: MediaDeviceInfo }>,
    ) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError(null);
      try {
        const { id, device } = await resolve();
        if (!mounted.current) return;
        await change(id);
        if (mounted.current) {
          if (device)
            setDevices((current) => [
              ...current.filter((d) => d.deviceId !== id),
              device,
            ]);
          setDeviceId(id);
        }
      } catch (error) {
        if (mounted.current)
          setError(
            error instanceof Error
              ? error.message
              : "The selected speaker could not be opened.",
          );
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [change],
  );

  const select = useCallback(
    (id: string) => update(async () => ({ id })),
    [update],
  );

  const choose = useCallback(async () => {
    const media = navigator.mediaDevices as OutputDevices | undefined;
    const selectOutput = media?.selectAudioOutput;
    if (!selectOutput || pending.current) return;
    await update(async () => {
      const output = await selectOutput.call(media, {
        deviceId: latest.current.deviceId || undefined,
      });
      return { id: output.deviceId, device: output };
    });
  }, [update]);

  return { deviceId, devices, busy, error, canChoose, select, choose };
}
