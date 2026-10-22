"use client";

import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches. Renders the `serverFallback` value before hydration. */
export function useMediaQuery(query: string, serverFallback = true) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverFallback,
  );
}
