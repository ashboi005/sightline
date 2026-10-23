"use client";

import { Button } from "@sightline/ui/components/button";
import { Mic, RefreshCw } from "lucide-react";
import { useId } from "react";

import { InlineAlert } from "@/components/clay/clay";
import { useLiveLecture } from "@/providers/live-lecture-provider";

/** Device discovery never requests capture or picks an input for the user. */
export function MicrophoneInput() {
  const { mic, voice } = useLiveLecture();
  const id = useId();
  const namedInputs = mic.devices.filter(
    (device) =>
      device.deviceId !== "default" && device.deviceId !== "communications",
  );
  const missing =
    mic.deviceId &&
    mic.deviceId !== "default" &&
    !namedInputs.some((device) => device.deviceId === mic.deviceId);
  return (
    <div className="space-y-2 rounded-2xl clay-inset p-3">
      <label
        htmlFor={`${id}-microphone`}
        className="flex items-center gap-2 text-xs font-bold"
      >
        <Mic className="size-4" /> Microphone input
      </label>
      <div className="flex items-center gap-2">
        <select
          id={`${id}-microphone`}
          value={mic.deviceId}
          disabled={mic.busy || voice.starting}
          aria-describedby={`${id}-hint`}
          onChange={(event) => void mic.select(event.target.value)}
          className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="" disabled>
            Choose a microphone
          </option>
          <option value="default">
            {mic.devices.find((device) => device.deviceId === "default")
              ?.label || "System default microphone"}
          </option>
          {namedInputs.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
          {missing && (
            <option value={mic.deviceId}>
              Selected microphone (unavailable)
            </option>
          )}
        </select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh microphones"
          title="Refresh microphones"
          disabled={mic.refreshing || mic.busy || voice.starting}
          onClick={() => void mic.refreshDevices()}
        >
          <RefreshCw
            className={
              mic.refreshing ? "animate-spin motion-reduce:animate-none" : ""
            }
          />
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {!mic.deviceId
          ? "Choose the input to use. Your browser asks for access when you start."
          : voice.active
            ? "Changing input stops voice focus. Check timing and start again with the new microphone."
            : "Used for captions, voice commands and voice focus. Refresh to update device names after allowing access."}
      </p>
      {(mic.error || mic.deviceError) && (
        <InlineAlert>{mic.error || mic.deviceError}</InlineAlert>
      )}
    </div>
  );
}
