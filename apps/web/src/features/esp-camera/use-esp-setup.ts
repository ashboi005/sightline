"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSceneCamera } from "../scene-tracking/features/scene-eye-tracking/use-scene-camera";
import { useSceneTracking } from "@/providers/scene/context";
import {
  ObjectTracking,
  requestVision,
  sameSource,
} from "./tracking/object-tracking";
import type { ObjectChoice } from "./tracking/object-tracking.types";
import { EspControlClient } from "./control-client";
import { sensorTargetX } from "./target-geometry";
import { LocalVoiceController } from "./voice/local-voice";
import { parseViewerCommand } from "./voice/commands";
import { SceneGazeCursor } from "./tracking/selection";

export function useEspSetup() {
  const runtime = useSceneTracking();
  const target = useSceneCamera("esp");
  const [objects] = useState(() => new ObjectTracking());
  const tracking = useSyncExternalStore(objects.subscribe, objects.getSnapshot);
  const [controller] = useState(() => new EspControlClient());
  const control = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [voice] = useState(() => new LocalVoiceController());
  const speech = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const [model, setModel] = useState({
    status: "loading",
    message: "Checking the vision service…",
  });
  const [modelRevision, setModelRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [pulse, setPulse] = useState(0);
  const cursorProcessor = useRef<SceneGazeCursor | null>(null);
  cursorProcessor.current ??= new SceneGazeCursor();
  const latest = useRef({ runtime, target, tracking, model });
  latest.current = { runtime, target, tracking, model };
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const result = await requestVision({ action: "status" }, abort.signal);
        if (abort.signal.aborted) return;
        const status = String(result.status);
        setModel({
          status,
          message:
            status === "ready"
              ? "Vision model ready"
              : status === "loading"
                ? "Warming up the vision model…"
                : String(result.error || "The vision model is unavailable."),
        });
        if (status === "loading") timer = setTimeout(check, 3000);
      } catch (error) {
        if (!abort.signal.aborted)
          setModel({
            status: "error",
            message:
              error instanceof Error ? error.message : "Vision is unavailable.",
          });
      }
    };
    void check();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [modelRevision]);
  useEffect(() => {
    voice.mount();
    let iteration = 0,
      sequence = 0,
      lastStamp = -1;
    let lostStopped = false;
    const timer = setInterval(() => {
      if (document.hidden) return;
      const { runtime: current, target: camera } = latest.current;
      void objects.tick(current.scene.camera, camera.camera);
      const observation = objects.getSnapshot();
      if (observation.requiresReselect && !lostStopped) {
        lostStopped = true;
        controller.stop(
          "Person lock lost. Select the person again before tracking.",
        );
      } else if (!observation.requiresReselect) lostStopped = false;
      const match = observation.requiresReselect ? null : observation.match;
      const frame = camera.camera.getSnapshot().frame;
      const now = performance.now();
      const valid =
        match &&
        frame &&
        camera.connection === "live" &&
        sameSource(match, camera.camera.getSnapshot()) &&
        now >= match.timestamp &&
        now - match.timestamp <= 500;
      if (valid && frame && match && match.timestamp !== lastStamp) {
        const x = sensorTargetX(
          [
            (match.box[0] + match.box[2]) / 2,
            (match.box[1] + match.box[3]) / 2,
          ],
          frame,
          camera.transform,
        );
        if (x !== null) {
          lastStamp = match.timestamp;
          void controller.observe({
            x,
            confidence: match.score,
            frameId: ++sequence,
            capturedAt: Date.now() - (now - match.timestamp),
            ...(match.method === "person"
              ? {
                  personEvidence: {
                    detectionConfidence: match.detectionConfidence!,
                    identityMargin: match.identityMargin!,
                  },
                }
              : {}),
          });
        }
      }
      if (++iteration % 10 === 0) void controller.poll();
      if (iteration % 2 === 0) setPulse((value) => value + 1);
    }, 100);
    const hidden = () => {
      if (document.hidden) {
        controller.stop("Following stopped while setup is hidden.");
        voice.stop();
      }
    };
    const exit = () => controller.disconnect();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", exit);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", exit);
      controller.disconnect();
      voice.dispose();
      objects.clear();
    };
  }, [controller, objects, voice]);
  const select = useCallback(
    (choice: ObjectChoice) => {
      if (latest.current.model.status !== "ready") {
        setNotice(
          "Wait for the person detector to be ready before selecting someone.",
        );
        return;
      }
      if (objects.getSnapshot().status === "selecting") return;
      controller.stop(
        "Selection changed. Confirm the new target before tracking.",
      );
      setNotice("");
      void objects.select(runtime.scene.camera, choice);
    },
    [controller, objects, runtime.scene.camera],
  );
  const clear = () => {
    controller.stop();
    objects.clear();
  };
  const cursor = cursorProcessor.current.read(
    runtime.state,
    runtime.scene.camera.getSnapshot(),
    runtime.tracker.settings.locked && runtime.tracker.connection === "live",
    performance.now(),
  );
  const selectAtGaze = useCallback(() => {
    const current = latest.current.runtime;
    // Speech can finish between React renders. Read the session at command time.
    const cursor = cursorProcessor.current!.read(
      current.state.session.getSnapshot(),
      current.scene.camera.getSnapshot(),
      current.tracker.settings.locked && current.tracker.connection === "live",
      performance.now(),
    );
    if (!cursor.point) {
      setNotice(cursor.message);
      return;
    }
    select({ point: cursor.point });
  }, [select]);
  const match = tracking.match;
  const fresh =
    !!match &&
    !!target.frame &&
    sameSource(match, target.camera.getSnapshot()) &&
    performance.now() - match.timestamp <= 500 &&
    target.connection === "live";
  const canTrack =
    !tracking.requiresReselect &&
    fresh &&
    !!control.reply?.canArm &&
    !control.busy;
  const track = () => {
    if (!canTrack) {
      setNotice(
        "Wait for a clear target match in the ESP-CAM view and a connected broker.",
      );
      return;
    }
    setNotice("");
    void controller.track();
  };
  const actions = useRef({ selectAtGaze, clear, track });
  actions.current = { selectAtGaze, clear, track };
  const startVoice = () =>
    voice.start((text) => {
      const command = parseViewerCommand(text),
        current = actions.current;
      if (command?.kind === "select") current.selectAtGaze();
      else if (command?.kind === "clear") current.clear();
      else if (command?.kind === "track") current.track();
      else if (command?.kind === "tracking-stop") controller.stop();
      else if (command?.kind === "voice-stop") voice.stop();
    });
  return {
    runtime,
    target,
    objects,
    tracking,
    controller,
    control,
    speech,
    voice,
    model,
    retryModel: () => setModelRevision((value) => value + 1),
    notice,
    setNotice,
    gaze: cursor.point,
    gazeDisplay: cursor.displayPoint,
    gazeHeld: cursor.held,
    gazeMessage: cursor.message,
    canTrack,
    fresh,
    select,
    selectAtGaze,
    clear,
    track,
    startVoice,
    pulse,
  };
}
