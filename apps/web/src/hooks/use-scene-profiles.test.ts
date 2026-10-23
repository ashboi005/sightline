import { afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSceneProfiles } from "./use-scene-profiles";
import { createSceneProfileStore } from "@/features/scene-tracking/features/scene-eye-tracking/calibration-profiles";
import { SceneSession } from "@/features/scene-tracking/features/scene-eye-tracking/scene-session";
import { fitOnePointCalibration } from "@/features/scene-tracking/features/scene-eye-tracking/one-point-calibration";
import { DEFAULT_CAMERA_TRANSFORM } from "@/features/scene-tracking/features/eye-tracking/camera-transform";
import { CALIBRATION_TARGETS } from "@/features/scene-tracking/features/scene-eye-tracking/calibration";
import {
  calibrate,
  collectValidation,
} from "@/features/scene-tracking/tests/fixtures";

if (typeof document === "undefined") GlobalRegistrator.register();
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const setup = {
  trackerFormat: "spatial" as const,
  fingerprint: "camera-geometry",
  orientation: {
    eye: DEFAULT_CAMERA_TRANSFORM,
    scene: DEFAULT_CAMERA_TRANSFORM,
  },
};
let root: Root;
let profiles: ReturnType<typeof useSceneProfiles>;
function Harness({
  session,
  ready = true,
}: {
  session: SceneSession;
  ready?: boolean;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  profiles = useSceneProfiles("test-student", session, state, setup, ready);
  return null;
}
beforeEach(() => {
  localStorage.clear();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(() => root.unmount());
});

test("one-point gain adjustments update the active profile instead of making new profiles", async () => {
  const calibration = fitOnePointCalibration(
    calibrate().s.getSnapshot().calibration!.holds[0],
    null,
  )!.calibration;
  const session = new SceneSession("one-point");
  session.restoreCalibration({
    calibration,
    method: "one-point",
    offset: [0, 0],
    delayMs: 0,
  });
  await act(() => root.render(createElement(Harness, { session })));
  const first = profiles.library.profiles[0].id;
  await act(() => session.setOnePointGain([1, 1]));
  await act(() => session.setOnePointGain([1.5, 1]));
  expect(profiles.library.profiles).toHaveLength(1);
  expect(profiles.library.profiles[0].id).toBe(first);
  expect(profiles.library.profiles[0].calibration.onePoint?.gain).toEqual([
    1.5, 1,
  ]);
});

test("saving as new preserves the current run and the original saved calibration", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles[0]);
  const current = session.getSnapshot();
  let saved;
  await act(() => {
    saved = profiles.save(undefined, true);
  });
  expect(saved).toBe(true);
  expect(session.getSnapshot()).toBe(current);
  const library = createSceneProfileStore("test-student", localStorage).read();
  expect(library.profiles).toHaveLength(2);
  expect(
    library.profiles.find((profile) => profile.id === original.id),
  ).toEqual(original);
  expect(profiles.active?.id).not.toBe(original.id);
  expect(profiles.active?.calibration.coefficients).toEqual(
    current.calibration!.coefficients,
  );
});

test("failed replacement cannot overwrite the previous saved mapping", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles[0]);
  await act(() => profiles.begin(original.id));
  const failed = calibrate(false);
  collectValidation(failed.s, failed.id, () => [0.2, 0]);
  expect(failed.s.getSnapshot().validation?.passed).toBe(false);
  await act(() =>
    session.restoreCalibration({
      calibration: failed.s.getSnapshot().calibration!,
      method: "hand",
      offset: [0, 0],
      delayMs: 0,
      unverified: true,
    }),
  );
  let saved = true;
  await act(() => {
    saved = profiles.save("Failed replacement");
  });
  expect(saved).toBe(false);
  expect(
    createSceneProfileStore("test-student", localStorage).read().profiles[0],
  ).toEqual(original);
});

test("a failed live recalibration cannot overwrite the active saved profile", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles[0]);
  const failed = calibrate(false);
  collectValidation(failed.s, failed.id, () => [0.2, 0]);
  await act(() =>
    session.restoreCalibration({
      calibration: failed.s.getSnapshot().calibration!,
      method: "hand",
      offset: [0, 0],
      delayMs: 0,
      unverified: true,
    }),
  );
  expect(profiles.replacing).toBeNull();
  let saved = true;
  await act(() => {
    saved = profiles.save();
  });
  expect(saved).toBe(false);
  expect(
    createSceneProfileStore("test-student", localStorage).read().profiles[0],
  ).toEqual(original);
  await act(() => {
    saved = profiles.save("Unverified preview", true);
  });
  expect(saved).toBe(true);
  expect(profiles.library.profiles).toHaveLength(2);
});

test("starting a new calibration saves the completed unverified mapping before clearing it", async () => {
  const session = calibrate(false).s;
  session.cancelCapture();
  const mapping = session.getSnapshot().calibration!;
  await act(() => root.render(createElement(Harness, { session })));
  expect(profiles.library.profiles).toHaveLength(0);
  let started;
  await act(() => {
    started = profiles.begin();
  });
  expect(started).toBe(true);
  expect(session.getSnapshot().calibration).toBeNull();
  const saved = createSceneProfileStore("test-student", localStorage).read()
    .profiles;
  expect(saved).toHaveLength(1);
  expect(saved[0].calibration.coefficients).toEqual(mapping.coefficients);
  expect(saved[0].unverified).toBe(true);
});

test("a failed save prevents restarting setup from discarding the current mapping", async () => {
  const session = calibrate(false).s;
  session.cancelCapture();
  const mapping = session.getSnapshot().calibration;
  await act(() => root.render(createElement(Harness, { session })));
  const originalStorage = localStorage;
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  )!;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: originalStorage.getItem.bind(originalStorage),
      setItem: () => {
        throw new Error("quota");
      },
    },
  });
  try {
    let started;
    await act(() => {
      started = profiles.begin();
    });
    expect(started).toBe(false);
    expect(session.getSnapshot().calibration).toBe(mapping);
    expect(profiles.error).toMatch(/save|storage/i);
  } finally {
    Object.defineProperty(globalThis, "localStorage", originalDescriptor);
  }
});

test("a network interruption cannot prevent a completed mapping from being saved", async () => {
  const session = calibrate(false).s;
  session.cancelCapture();
  await act(() =>
    root.render(createElement(Harness, { session, ready: false })),
  );
  let saved;
  await act(() => {
    saved = profiles.save("Network headset");
  });
  expect(saved).toBe(true);
  expect(profiles.library.profiles[0].name).toBe("Network headset");
  expect(profiles.library.profiles[0].unverified).toBe(true);
});

test("save failures explain missing mappings instead of silently returning false", async () => {
  const session = new SceneSession();
  await act(() => root.render(createElement(Harness, { session })));
  let saved;
  await act(() => {
    saved = profiles.save();
  });
  expect(saved).toBe(false);
  expect(profiles.error).toMatch(/mapping|calibration/i);
});

test("restarting setup never cancels an active point capture", async () => {
  const session = new SceneSession();
  session.startCapture("calibration");
  await act(() => root.render(createElement(Harness, { session })));
  let started;
  await act(() => {
    started = profiles.begin();
  });
  expect(started).toBe(false);
  expect(session.getSnapshot().capture).toBe("calibration");
});

test("importing diagnostic data recovers the mapping as an unverified profile without changing the live run", async () => {
  const session = new SceneSession();
  await act(() => root.render(createElement(Harness, { session })));
  const recovered = calibrate().s.getSnapshot();
  const file = new File(
    [
      JSON.stringify({
        version: 1,
        calibration: recovered.calibration,
        validation: recovered.validation,
        delayMs: 20,
        offset: [0.01, 0],
      }),
    ],
    "scene-calibration-diagnostics.json",
  );
  let imported;
  await act(async () => {
    imported = await profiles.importCalibration(file);
  });
  expect(imported).toBe(true);
  expect(session.getSnapshot().calibration).toBeNull();
  const saved = createSceneProfileStore("test-student", localStorage).read()
    .profiles[0];
  expect(saved.name).toBe("Recovered calibration");
  expect(saved.calibration.coefficients).toEqual(
    recovered.calibration!.coefficients,
  );
  expect(saved.calibration.holds.every((hold) => hold.pairs.length === 1)).toBe(
    true,
  );
  expect(saved.unverified).toBe(true);
  expect(saved.setup.fingerprint).toBeUndefined();
  expect(
    createSceneProfileStore("another-student", localStorage).read().profiles,
  ).toHaveLength(0);
});

test("invalid diagnostic imports cannot erase existing profiles", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles);
  let imported;
  await act(async () => {
    imported = await profiles.importCalibration(
      new File(['{"calibration":{"holds":[]}}'], "invalid.json"),
    );
  });
  expect(imported).toBe(false);
  expect(profiles.error).not.toBe("");
  expect(
    createSceneProfileStore("test-student", localStorage).read().profiles,
  ).toEqual(original);
});

function collectFailedFit(session: SceneSession) {
  session.startCapture("calibration");
  let id = 0;
  for (const [index, [x, y]] of CALIBRATION_TARGETS.entries()) {
    for (let frame = 0; frame < 35; frame++) {
      id++;
      session.addEye({
        id,
        timestamp: id * 50,
        feature: [x - 0.5 + (index === 1 ? 0.2 : 0), y - 0.5],
        confidence: 0.95,
        valid: true,
      });
      session.observeHand(
        {
          scene: {
            id,
            timestamp: id * 50,
            width: 640,
            height: 480,
            generation: 1,
          },
          landmarks: [Array.from({ length: 21 }, () => ({ x, y, z: 0 }))],
          worldLandmarks: [],
          handedness: ["Right"],
        },
        id * 50,
      );
      if (session.getSnapshot().collection?.canLock) session.lockPoint();
    }
  }
}

test("starting another run preserves a failed fit candidate without requiring a live preview", async () => {
  const session = new SceneSession();
  collectFailedFit(session);
  expect(session.getSnapshot().calibration).toBeNull();
  expect(session.getSnapshot().fitFailure?.previewCalibration).toBeDefined();
  await act(() => root.render(createElement(Harness, { session })));
  let started;
  await act(() => {
    started = profiles.begin();
  });
  expect(started).toBe(true);
  const saved = createSceneProfileStore("test-student", localStorage).read()
    .profiles[0];
  expect(saved.calibration.holds).toHaveLength(9);
  expect(saved.unverified).toBe(true);
});

test("a failed replacement fit is saved separately instead of being discarded behind the accepted mapping", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles[0]);
  await act(() => collectFailedFit(session));
  expect(session.getSnapshot().fitFailure?.previewCalibration).toBeDefined();
  let started;
  await act(() => {
    started = profiles.begin();
  });
  expect(started).toBe(true);
  const saved = createSceneProfileStore("test-student", localStorage).read()
    .profiles;
  expect(saved).toHaveLength(2);
  expect(saved.find((profile) => profile.id === original.id)).toEqual(original);
  expect(saved.find((profile) => profile.id !== original.id)?.unverified).toBe(
    true,
  );
});

test("starting new after an unverified replacement preserves both the accepted profile and the draft", async () => {
  const session = calibrate().s;
  await act(() => root.render(createElement(Harness, { session })));
  const original = structuredClone(profiles.library.profiles[0]);
  await act(() => profiles.begin(original.id));
  const candidate = calibrate(false).s.getSnapshot().calibration!;
  await act(() =>
    session.restoreCalibration({
      calibration: candidate,
      method: "hand",
      offset: [0, 0],
      delayMs: 0,
      unverified: true,
    }),
  );
  let started;
  await act(() => {
    started = profiles.begin();
  });
  expect(started).toBe(true);
  const saved = createSceneProfileStore("test-student", localStorage).read()
    .profiles;
  expect(saved).toHaveLength(2);
  expect(saved.find((profile) => profile.id === original.id)).toEqual(original);
  expect(saved.find((profile) => profile.id !== original.id)?.unverified).toBe(
    true,
  );
});
