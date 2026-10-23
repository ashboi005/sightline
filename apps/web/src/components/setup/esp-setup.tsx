"use client";

import { useEffect, useState } from "react";
import { Button } from "@sightline/ui/components/button";
import {
  Camera,
  Check,
  Crosshair,
  Eye,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Square,
  Unplug,
  Wifi,
} from "lucide-react";
import {
  ClayCard,
  InlineAlert,
  PageHeader,
  StatusPill,
} from "@/components/clay/clay";
import { useEspSetup } from "@/features/esp-camera/use-esp-setup";
import { useSession } from "@/hooks/use-auth";
import { CameraTransformControls } from "@/features/scene-tracking/features/eye-tracking/components/camera-transform-controls";
import { EspCameraView } from "./esp-camera-view";
import { sameSource } from "@/features/esp-camera/tracking/object-tracking";
import { ESP_DEFAULT_INVERT_PAN } from "@/features/esp-camera/server/configuration";

export function EspSetup({ onEyeSetup }: { onEyeSetup: () => void }) {
  const setup = useEspSetup();
  const { runtime, target, tracking, control, controller, model } = setup;
  const user = useSession().data?.user;
  const [url, setUrl] = useState("");
  const [invert, setInvert] = useState(ESP_DEFAULT_INVERT_PAN);
  const storageKey = user ? `sightline.esp-camera.${user.id}.v2` : null;
  useEffect(() => {
    setUrl("");
    setInvert(ESP_DEFAULT_INVERT_PAN);
    if (!storageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved && typeof saved.url === "string") {
        setUrl(saved.url);
        setInvert(
          typeof saved.invert === "boolean"
            ? saved.invert
            : ESP_DEFAULT_INVERT_PAN,
        );
      } else {
        // Keep the camera URL while migrating the old, incorrect mount default.
        const legacy = JSON.parse(
          localStorage.getItem(storageKey.replace(/\.v2$/, ".v1")) ?? "null",
        );
        if (legacy && typeof legacy.url === "string") setUrl(legacy.url);
      }
    } catch {
      /* A camera remains usable without browser storage. */
    }
  }, [storageKey]);
  const connect = async () => {
    setup.setNotice("");
    let next: URL;
    try {
      next = new URL(url.trim());
      if (
        !["http:", "https:"].includes(next.protocol) ||
        next.username ||
        next.password
      )
        throw new Error();
    } catch {
      setup.setNotice(
        "Enter a complete HTTP or HTTPS camera stream URL without embedded credentials.",
      );
      return;
    }
    for (const source of [runtime.scene.source, runtime.tracker.source]) {
      if (!source?.url) continue;
      const other = new URL(source.url);
      if (
        next.href === other.href ||
        (next.hostname === other.hostname &&
          next.pathname === "/stream" &&
          other.pathname === "/stream")
      ) {
        setup.setNotice(
          "Use a separate ESP-CAM for this third view. That camera is already connected to the eye tracker setup.",
        );
        return;
      }
    }
    setup.objects.clear();
    controller.disconnect();
    if (storageKey)
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify({ url: next.href, invert }),
        );
      } catch {
        /* Optional preference. */
      }
    // A single source owns the ESP preview; all views and inference share its canvas.
    await Promise.all([
      target.camera.startNetworkStream(next.href),
      controller.connect(next.href, invert),
    ]);
  };
  const connected = target.connection === "live";
  const paused = control.reply?.status === "paused";
  const trackingActive = control.reply?.status === "tracking" || paused;
  const recovering =
    !tracking.match &&
    !!tracking.lastMatch &&
    performance.now() - tracking.lastMatch.timestamp <= 1200 &&
    sameSource(tracking.lastMatch, target.camera.getSnapshot());
  const sceneRecovering =
    !tracking.scene &&
    !!tracking.lastScene &&
    performance.now() - tracking.lastScene.timestamp <= 1200 &&
    sameSource(tracking.lastScene, runtime.scene.camera.getSnapshot());
  const selected = !!tracking.reference;
  const lost = !!tracking.requiresReselect;
  const currentStep = trackingActive ? 2 : connected ? 1 : 0;
  const busy = target.busy || control.busy;
  const tracker = runtime.tracker;
  return (
    <div className="scene-setup space-y-6">
      <PageHeader
        icon={Camera}
        tone="lilac"
        title="ESP-CAM Setup"
        description="Select one person with your gaze, verify them in the ESP-CAM view, then say “track” to follow them."
        actions={
          <StatusPill
            kind={
              paused
                ? "attention"
                : trackingActive
                  ? "live"
                  : connected
                    ? "ready"
                    : "idle"
            }
          >
            {paused
              ? "Reacquiring person"
              : trackingActive
                ? "Following selected person"
                : connected
                  ? "Camera connected"
                  : "Third camera"}
          </StatusPill>
        }
      />
      <ol
        aria-label="ESP-CAM setup progress"
        className="grid gap-2 rounded-3xl p-3 clay-sm sm:grid-cols-3"
      >
        {["Connect ESP-CAM", "Select a person", "Follow the person"].map(
          (label, i) => (
            <li
              key={label}
              aria-current={currentStep === i ? "step" : undefined}
              className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${currentStep === i ? "clay-lilac text-lilac-ink" : "text-muted-foreground"}`}
            >
              <span className="grid size-7 place-items-center rounded-full bg-white/50">
                {currentStep > i ? <Check className="size-4" /> : i + 1}
              </span>
              {label}
            </li>
          ),
        )}
      </ol>
      <ClayCard className="p-5 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Wifi className="size-5 text-lilac-ink" />
              Connect your third camera
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep your eye and scene cameras connected. Use the ESP-CAM’s
              separate video stream here.
            </p>
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void connect();
              }}
            >
              <label className="min-w-0 flex-1 text-sm font-semibold">
                Camera stream URL
                <input
                  className="mt-2 h-12 w-full rounded-2xl border bg-background/70 px-4 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  disabled={busy || connected}
                  placeholder="http://esp32cam.local:81/stream"
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <Button
                type="submit"
                variant="clay"
                className="h-12"
                disabled={busy || connected || !url.trim()}
              >
                {busy ? (
                  <RefreshCw className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Wifi />
                )}
                {busy ? "Connecting…" : "Connect"}
              </Button>
              {(target.source || control.reply || busy) && (
                <Button
                  type="button"
                  variant="clay-soft"
                  className="h-12"
                  onClick={() => {
                    setup.clear();
                    controller.disconnect();
                    target.camera.stop();
                  }}
                >
                  <Unplug />
                  Disconnect
                </Button>
              )}
            </form>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>
                MJPEG / ESP32-CAM · HTTP / HTTPS video · IP or .local hostname
              </span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={invert}
                  disabled={!!control.reply || busy}
                  onChange={(event) => setInvert(event.target.checked)}
                />
                Positive X moves camera left
              </label>
            </div>
          </div>
          <div className="space-y-3 rounded-2xl bg-lilac/35 p-4 text-sm">
            <p className="flex items-center gap-2 font-bold text-lilac-ink">
              <Radio className="size-4" />
              Servo connection
            </p>
            <p className="break-all font-mono text-xs">
              broker.hivemq.com:1883
              <br />
              esp32cam/kate/servo/delta
            </p>
            <StatusPill kind={control.reply?.mqttConnected ? "ready" : "idle"}>
              {control.reply?.mqttConnected
                ? "Broker connected"
                : "Broker disconnected"}
            </StatusPill>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {control.reply?.camera
                ? `Reported position: X ${control.reply.camera.servoX}° · Y ${control.reply.camera.servoY}°`
                : "Device position telemetry unavailable. The live target view is your movement feedback."}
            </p>
          </div>
        </div>
        {(target.error || control.error || setup.notice) && (
          <InlineAlert className="mt-4">
            {target.error || control.error || setup.notice}
          </InlineAlert>
        )}
      </ClayCard>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold">Three views. One person.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Look at a person in your scene, enable voice and say “select”. Check
            the green box in the ESP-CAM view, then say “track”.
          </p>
        </div>
        <Button variant="clay-soft" onClick={onEyeSetup}>
          <Eye />
          Eye Tracker Setup
        </Button>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-3">
        <EspCameraView
          title="01 · Eye camera"
          subtitle={
            tracker.connection === "live"
              ? "Your existing eye tracker"
              : "Connect in Eye Tracker Setup"
          }
          source={tracker.sourceCanvas.current}
          live={tracker.connection === "live"}
        />
        <EspCameraView
          title="02 · Scene camera"
          subtitle={
            runtime.scene.connection === "live"
              ? lost
                ? "Lock lost · select the person again"
                : tracking.sceneStatus === "lost"
                  ? "Person left scene · reference retained for ESP-CAM"
                  : tracking.scene
                    ? "Person selected in scene"
                    : selected
                      ? "Checking the selected person in scene…"
                      : "Look at a person's body · say “select”"
              : "Connect in Eye Tracker Setup"
          }
          source={runtime.scene.camera.rawCanvas}
          live={runtime.scene.connection === "live"}
          match={
            tracking.scene ?? (sceneRecovering ? tracking.lastScene : null)
          }
          recovering={sceneRecovering}
          gaze={setup.gazeDisplay}
          gazeHeld={setup.gazeHeld}
          select={model.status === "ready" ? setup.select : undefined}
        />
        <div className="space-y-3">
          <EspCameraView
            title="03 · ESP-CAM"
            subtitle={
              !connected
                ? "Connect the third camera to find your selected person"
                : lost
                  ? "Lock lost · movement stopped · select again"
                  : paused || recovering
                    ? "Reacquiring the selected person · movement paused"
                    : trackingActive
                      ? "Following · keeping the selected person centered"
                      : setup.fresh
                        ? "Person matched · check this is who you selected"
                        : selected
                          ? "Searching for the selected person…"
                          : "Your independent target camera"
            }
            source={target.camera.rawCanvas}
            live={connected}
            match={tracking.match ?? (recovering ? tracking.lastMatch : null)}
            recovering={recovering}
            aim={[0.5, 0.5]}
          />
          <CameraTransformControls
            label="ESP-CAM"
            value={target.transform}
            disabled={trackingActive}
            onChange={(value) => {
              setup.clear();
              target.camera.setTransform(value);
            }}
          />
        </div>
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.65fr)]">
        <ClayCard className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">
              {selected ? tracking.reference!.label : "Choose who to follow"}
            </h2>
            <StatusPill
              kind={
                lost ||
                tracking.status === "error" ||
                tracking.status === "ambiguous"
                  ? "attention"
                  : setup.fresh
                    ? "ready"
                    : selected
                      ? "working"
                      : "idle"
              }
            >
              {lost
                ? "Select again"
                : tracking.status === "selecting"
                  ? "Selecting…"
                  : setup.fresh
                    ? "Selected person matched"
                    : tracking.status === "ambiguous"
                      ? "People look similar"
                      : selected && !connected
                        ? "Person selected"
                        : selected
                          ? "Finding selected person"
                          : "No selection"}
            </StatusPill>
          </div>
          {tracking.reference?.preview && (
            <div className="flex items-center gap-4 rounded-2xl bg-sage/30 p-3">
              {/* Ephemeral JPEG from the exact selection frame, never a live substitute. */}
              <img
                src={tracking.reference.preview}
                alt="Person selected from the scene camera"
                className="h-24 w-16 shrink-0 rounded-xl bg-black/10 object-contain"
                width={64}
                height={96}
              />
              <div className="space-y-1 text-sm">
                <p className="font-bold">Your selected person</p>
                <p className="text-xs text-muted-foreground">
                  Reference captured when you selected. Check this is the person
                  you meant.
                </p>
                <p className="text-xs font-semibold">
                  Scene:{" "}
                  {runtime.scene.connection !== "live"
                    ? "not connected"
                    : lost
                      ? "select again"
                      : tracking.sceneStatus === "lost"
                        ? "reference retained"
                        : tracking.scene
                          ? "locked"
                          : "checking"}
                  {" · "}ESP-CAM:{" "}
                  {!connected
                    ? "not connected"
                    : lost
                      ? "select again"
                      : setup.fresh
                        ? "matched"
                        : tracking.targetStatus === "ambiguous"
                          ? "uncertain"
                          : "searching"}
                </p>
              </div>
            </div>
          )}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {lost
              ? "The selected person could no longer be verified. The reference stays here, and following is stopped. Select that person again in Scene to make a new lock."
              : selected && !connected
                ? "The person is selected in Scene. Connect the third camera above to find the same person in its view."
                : tracking.status === "ambiguous"
                  ? "Two people look too similar to confirm this selection. Wait for a clearer view of the selected person."
                  : "Select the person in Scene, then check that the ESP-CAM finds the same person. Press Track or say “track” only after checking their body box."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="clay-soft"
              disabled={
                model.status !== "ready" ||
                !setup.gaze ||
                tracking.status === "selecting"
              }
              onClick={setup.selectAtGaze}
            >
              <Crosshair />
              Select at gaze
            </Button>
            <Button variant="ghost" disabled={!selected} onClick={setup.clear}>
              Clear selection
            </Button>
          </div>
          <p role="status" className="text-sm text-muted-foreground">
            {setup.gazeMessage} You can also click a person's body or draw
            around one person in the scene view.
          </p>
          {(tracking.selectionError || tracking.error) && (
            <InlineAlert>
              {tracking.selectionError || tracking.error}
            </InlineAlert>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button
              variant="clay"
              disabled={!setup.canTrack || trackingActive}
              onClick={setup.track}
            >
              <Crosshair />
              {paused
                ? "Movement paused"
                : trackingActive
                  ? "Following person"
                  : "Track person"}
            </Button>
            <Button
              variant={trackingActive ? "destructive" : "clay-soft"}
              disabled={!control.reply}
              onClick={() => controller.stop()}
            >
              <Square />
              Stop
            </Button>
            <span
              role="status"
              className="flex-1 text-xs leading-relaxed text-muted-foreground"
            >
              {control.reply?.message ||
                "Connect the ESP-CAM and verify a match to begin."}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Brief stream gaps pause movement and keep your person selected. Two
            fresh confirmations can resume following within two seconds. A lost
            person lock requires selecting the person again. Leaving setup stops
            following.
          </p>
        </ClayCard>
        <ClayCard tone="sage" className="space-y-4 p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Mic className="size-5" />
            Hands-free control
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Enable voice, look at the person's body and say{" "}
            <strong>“select”</strong>. The gaze cursor selects that person in
            the scene view. Check their match in the ESP-CAM view, then say{" "}
            <strong>“track”</strong>. Say <strong>“stop tracking”</strong> to
            stop following. Voice recognition runs on this device.
          </p>
          <Button
            variant="clay-soft"
            disabled={setup.speech.status === "starting"}
            onClick={() =>
              setup.speech.status === "listening"
                ? setup.voice.stop()
                : void setup.startVoice()
            }
          >
            {setup.speech.status === "listening" ? <MicOff /> : <Mic />}
            {setup.speech.status === "listening"
              ? "Turn voice off"
              : setup.speech.status === "starting"
                ? "Starting voice…"
                : "Enable voice"}
          </Button>
          <p role="status" className="text-xs text-muted-foreground">
            {setup.speech.message}
          </p>
          <div className="space-y-2 border-t border-sage-ink/10 pt-4">
            <StatusPill
              kind={
                model.status === "ready"
                  ? "ready"
                  : model.status === "loading"
                    ? "working"
                    : "attention"
              }
            >
              {model.status === "ready"
                ? "Vision ready"
                : model.status === "loading"
                  ? "Loading vision"
                  : "Vision offline"}
            </StatusPill>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {model.message} Person matching runs on your Sightline server
              using the installed models.
            </p>
            {model.status === "error" && (
              <Button size="sm" variant="ghost" onClick={setup.retryModel}>
                <RefreshCw />
                Retry vision
              </Button>
            )}
          </div>
        </ClayCard>
      </div>
    </div>
  );
}
