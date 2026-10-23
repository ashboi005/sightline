"use client";

import { Camera, MousePointer2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type {
  ObjectBox,
  ObjectChoice,
  ObjectMatch,
} from "@/features/esp-camera/tracking/object-tracking.types";

type Point = readonly [number, number];
export function EspCameraView({
  title,
  subtitle,
  source,
  live,
  match,
  recovering = false,
  gaze,
  gazeHeld = false,
  select,
  aim,
  onAim,
}: {
  title: string;
  subtitle: string;
  source: HTMLCanvasElement | null;
  live: boolean;
  match?: ObjectMatch | null;
  recovering?: boolean;
  gaze?: Point | null;
  gazeHeld?: boolean;
  select?: (choice: ObjectChoice) => void;
  aim?: Point;
  onAim?: (point: Point) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Point | null>(null);
  const [rectangle, setRectangle] = useState<ObjectBox | null>(null);
  const latest = useRef({
    source,
    live,
    match,
    recovering,
    gaze,
    gazeHeld,
    aim,
    rectangle,
  });
  latest.current = {
    source,
    live,
    match,
    recovering,
    gaze,
    gazeHeld,
    aim,
    rectangle,
  };
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const destination = canvas.current,
        state = latest.current;
      if (destination && !state.live) {
        destination
          .getContext("2d")
          ?.clearRect(0, 0, destination.width, destination.height);
      } else if (destination && state.source && state.live) {
        if (destination.width !== state.source.width)
          destination.width = state.source.width;
        if (destination.height !== state.source.height)
          destination.height = state.source.height;
        const ctx = destination.getContext("2d");
        if (ctx) {
          const { width, height } = destination;
          ctx.drawImage(state.source, 0, 0);
          const box =
            state.rectangle ??
            (state.match &&
            performance.now() - state.match.timestamp <=
              (state.recovering ? 1200 : 500)
              ? state.match.box
              : null);
          ctx.lineWidth = Math.max(2, width / 300);
          if (box) {
            ctx.strokeStyle = state.recovering ? "#f5d073" : "#b8e0c2";
            ctx.setLineDash(state.recovering ? [6, 4] : []);
            ctx.fillStyle = "#b8e0c218";
            ctx.fillRect(
              box[0] * width,
              box[1] * height,
              (box[2] - box[0]) * width,
              (box[3] - box[1]) * height,
            );
            ctx.strokeRect(
              box[0] * width,
              box[1] * height,
              (box[2] - box[0]) * width,
              (box[3] - box[1]) * height,
            );
            ctx.setLineDash([]);
          }
          const point = state.gaze ?? state.aim;
          if (point) {
            ctx.globalAlpha = state.gazeHeld ? 0.4 : 1;
            const x = point[0] * width,
              y = point[1] * height,
              radius = width / 45;
            ctx.strokeStyle = state.gaze ? "#f5d073" : "#ffffffb0";
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - radius * 1.7, y);
            ctx.lineTo(x + radius * 1.7, y);
            ctx.moveTo(x, y - radius * 1.7);
            ctx.lineTo(x, y + radius * 1.7);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  const pointAt = (event: PointerEvent<HTMLCanvasElement>): Point | null => {
    const el = event.currentTarget,
      rect = el.getBoundingClientRect();
    const scale = Math.min(rect.width / el.width, rect.height / el.height);
    const x =
      (event.clientX - rect.left - (rect.width - el.width * scale) / 2) /
      (el.width * scale);
    const y =
      (event.clientY - rect.top - (rect.height - el.height * scale) / 2) /
      (el.height * scale);
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y] : null;
  };
  return (
    <section className="overflow-hidden rounded-[1.4rem] bg-[#141d1b] text-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-bold">
          <Camera className="size-4" />
          {title}
        </h3>
        <span className="text-xs text-white/65">
          {live ? "Live" : "Not connected"}
        </span>
      </div>
      <div className="relative aspect-[4/3] bg-black/15">
        <canvas
          ref={canvas}
          className={`h-full w-full object-contain ${select ? "touch-none cursor-crosshair" : ""}`}
          aria-label={title + " preview"}
          onPointerDown={(event) => {
            if (!select || !live) return;
            drag.current = pointAt(event);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const point = pointAt(event),
              start = drag.current;
            if (point && start)
              setRectangle([
                Math.min(start[0], point[0]),
                Math.min(start[1], point[1]),
                Math.max(start[0], point[0]),
                Math.max(start[1], point[1]),
              ]);
          }}
          onPointerUp={(event) => {
            const point = pointAt(event),
              start = drag.current;
            drag.current = null;
            setRectangle(null);
            if (!point || !start || !select) return;
            onAim?.(point);
            if (
              Math.abs(point[0] - start[0]) > 0.015 &&
              Math.abs(point[1] - start[1]) > 0.015
            )
              select({
                box: [
                  Math.min(start[0], point[0]),
                  Math.min(start[1], point[1]),
                  Math.max(start[0], point[0]),
                  Math.max(start[1], point[1]),
                ],
              });
            else select({ point });
          }}
          onPointerCancel={() => {
            drag.current = null;
            setRectangle(null);
          }}
        />
        {!live && (
          <div className="absolute inset-0 grid place-content-center gap-3 p-5 text-center text-white/55">
            <Camera className="mx-auto size-8" />
            <p className="text-sm">{subtitle}</p>
          </div>
        )}
      </div>
      <p className="flex min-h-12 items-center gap-2 px-4 py-3 text-xs text-white/65">
        {select && <MousePointer2 className="size-3.5 shrink-0" />}
        {subtitle}
      </p>
    </section>
  );
}
