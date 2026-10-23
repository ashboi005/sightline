import { expect, test } from "bun:test";
import type { AccessibilityMode } from "@sightline/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { GazeProvider } from "@/providers/gaze-provider";
import { LiveLectureProvider } from "@/providers/live-lecture-provider";
import { SceneContext } from "@/providers/scene/context";
import type { SceneRuntime } from "@/providers/scene/runtime";
import { Readiness } from "./readiness";
import { VoiceFocusPanel } from "../live/voice-focus-panel";
import { CaptionsView } from "../live/captions-view";

function renderReadiness({
  stale = false,
  reconnecting = false,
  panel = false,
  captions = false,
  mode = "DEAF",
}: {
  stale?: boolean;
  reconnecting?: boolean;
  panel?: boolean;
  captions?: boolean;
  mode?: AccessibilityMode;
} = {}) {
  const query = new QueryClient();
  query.setQueryData(["health"], { mocks: { speech: false } });
  const runtime = {
    tracker: {
      source: { kind: "network", name: "Eye", url: "http://camera/eye" },
      connection: reconnecting ? "reconnecting" : "live",
      busy: reconnecting,
      settings: { locked: true },
      frame: {
        timestamp: performance.now() - (stale ? 5000 : 0),
        gaze: { direction: [0, 0, 1] },
      },
    },
    state: { calibration: {}, capture: null },
    media: { stream: null, video: null, error: null },
  } as unknown as SceneRuntime;
  const html = renderToStaticMarkup(
    <QueryClientProvider client={query}>
      <GazeProvider>
        <SceneContext value={runtime}>
          {panel || captions ? (
            <LiveLectureProvider>
              {captions ? <CaptionsView /> : <VoiceFocusPanel />}
            </LiveLectureProvider>
          ) : (
            <Readiness mode={mode} />
          )}
        </SceneContext>
      </GazeProvider>
    </QueryClientProvider>,
  );
  query.clear();
  return html;
}

test("pre-lecture readiness recognizes the calibrated network eye camera without a gaze bridge", () => {
  const html = renderReadiness();
  expect(html).toContain("Eye tracking live");
  expect(html).not.toContain("Not connected");
  expect(html).not.toContain("Turn on the webcam");
});

test("voice focus shows the gaze selection action before startup instead of hiding it", () => {
  const html = renderReadiness({ panel: true });
  expect(html).toContain("Select at gaze");
  expect(html).toContain("Enable voice");
  expect(html).toContain("Start voice focus");
});

test("voice focus exposes an explicit microphone input choice alongside speaker output", () => {
  const html = renderReadiness({ panel: true });
  expect(html).toContain("Microphone input");
  expect(html).toContain("Choose a microphone");
  expect(html).toContain("Speaker output");
});

test("live captions expose microphone selection without mounting the voice focus panel", () => {
  const html = renderReadiness({ captions: true });
  expect(html).toContain("Turn on microphone");
  expect(html).toContain("Microphone input");
  expect(html).toContain("Choose a microphone");
});

test("person focus can be opened before starting a lecture in either mode", () => {
  for (const mode of ["DEAF", "HARD_OF_HEARING"] as const) {
    const html = renderReadiness({ mode });
    expect(html).toMatch(/href="\/focus"[^>]*>[^<]*Focus a person/);
  }
});

test("network stalls are reported as waiting for frames instead of a live eye tracker", () => {
  const html = renderReadiness({ stale: true });
  expect(html).toContain("Waiting for eye frames");
  expect(html).not.toContain("Eye tracking live");
});

test("network reconnects do not claim the camera is disconnected or require recalibration", () => {
  const html = renderReadiness({ reconnecting: true });
  expect(html).toContain("Reconnecting eye camera");
  expect(html).not.toContain("Not connected");
  expect(html).not.toContain("Not calibrated");
});
