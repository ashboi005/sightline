"use client";
import { createContext, use } from "react";
import type { SceneRuntime } from "./runtime";
export const SceneContext = createContext<SceneRuntime | null>(null);
export function useSceneTracking() {
  const value = use(SceneContext);
  if (!value) throw new Error("Scene tracking needs the workspace provider.");
  return value;
}
