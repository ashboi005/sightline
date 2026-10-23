import { beforeEach, expect, test } from "bun:test";
import { createSceneProfileStore } from "../features/scene-eye-tracking/calibration-profiles";
import { DEFAULT_CAMERA_TRANSFORM } from "../features/eye-tracking/camera-transform";
import {
  SceneSession,
  hasCurrentAccuracyCheck,
} from "../features/scene-eye-tracking/scene-session";
import { calibrate } from "./fixtures";
const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
};
const setup = {
  trackerFormat: "spatial" as const,
  orientation: {
    eye: DEFAULT_CAMERA_TRANSFORM,
    scene: DEFAULT_CAMERA_TRANSFORM,
  },
};
function draft() {
  const state = calibrate().s.getSnapshot();
  return {
    calibration: state.calibration!,
    method: state.method,
    offset: [0, 0] as [number, number],
    delayMs: 0,
    unverified: false,
  };
}
beforeEach(() => values.clear());
test("account-scoped saves survive reload without exposing another user's mappings", () => {
  const kate = createSceneProfileStore("kate", storage);
  const alex = createSceneProfileStore("alex", storage);
  const saved = kate.save("Classroom", draft(), setup);
  expect(alex.read().profiles).toEqual([]);
  alex.save("Classroom", draft(), setup);
  expect(createSceneProfileStore("kate", storage).read().selectedId).toBe(
    saved.id,
  );
  expect(kate.read().profiles).toHaveLength(1);
});
test("replacement updates the chosen ID and preserves other profiles", () => {
  const store = createSceneProfileStore("kate", storage);
  const a = store.save("Room A", draft(), setup);
  const b = store.save("Room B", draft(), setup);
  store.save(
    "Room A updated",
    { ...draft(), offset: [0.02, 0.01] },
    setup,
    a.id,
  );
  expect(store.read().profiles).toHaveLength(2);
  expect(store.read().profiles.find((p) => p.id === a.id)?.offset).toEqual([
    0.02, 0.01,
  ]);
  expect(store.read().profiles.find((p) => p.id === b.id)).toEqual(b);
});
test("failed writes leave the old calibration intact and report the failure", () => {
  const good = createSceneProfileStore("kate", storage);
  const old = good.save("Classroom", draft(), setup);
  const failing = createSceneProfileStore("kate", {
    ...storage,
    setItem: () => {
      throw new Error("quota");
    },
  });
  expect(() => failing.save("Replacement", draft(), setup, old.id)).toThrow(
    /save/i,
  );
  expect(good.read().profiles[0]).toEqual(old);
});
test("a write that cannot be read back is not reported as a saved calibration", () => {
  const store = createSceneProfileStore("kate", {
    getItem: () => null,
    setItem: () => {},
  });
  expect(() => store.save("Classroom", draft(), setup)).toThrow(/save/i);
});
test("restored mapping never claims a fresh accuracy pass", () => {
  const store = createSceneProfileStore("kate", storage);
  const saved = store.save("Classroom", draft(), setup);
  const session = new SceneSession();
  session.restoreCalibration(saved);
  expect(hasCurrentAccuracyCheck(session.getSnapshot())).toBe(false);
  expect(saved.calibration.holds.every((h) => h.pairs.length === 1)).toBe(true);
});
test("anonymous saves and cross-account replacement IDs are refused", () => {
  expect(() => createSceneProfileStore("", storage)).toThrow(/user/i);
  const a = createSceneProfileStore("a", storage).save("A", draft(), setup);
  expect(() =>
    createSceneProfileStore("b", storage).save("B", draft(), setup, a.id),
  ).toThrow(/removed/i);
});
test("corrupt payloads are ignored and invalid drafts cannot replace a saved profile", () => {
  const store = createSceneProfileStore("kate", storage);
  const saved = store.save("Classroom", draft(), setup);
  expect(() => store.save("", draft(), setup, saved.id)).toThrow(/name/i);
  expect(store.read().profiles[0]).toEqual(saved);
  values.set(store.key, "{broken");
  expect(store.read().profiles).toEqual([]);
});
