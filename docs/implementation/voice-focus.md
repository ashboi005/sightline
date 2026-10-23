# Calibrated POV voice focus

Open **Focus a person** in the workspace sidebar (`/focus`). It is available before a lecture and in either lecture mode, reusing the current cameras and loaded calibration. The same controls remain in the live lecture UI in **Hard of Hearing** mode. It uses the existing `apps/speaker-service` for face tracking and audio separation, with its pinned **AV-MossFormer2-TSE-16K** engine as the default. The browser's local Vosk recognizer handles commands only; it does not isolate speech. No separate separation service is used.

## Use

1. Complete Eye Tracker Setup and load the saved calibration for the connected eye and POV scene cameras. Both USB and network/MJPEG sources use the shared, oriented scene canvas.
2. Start the existing focus speaker service. For the development preview on port 3011:

   ```sh
   cd apps/speaker-service
   uv run sightline-speaker --device auto --origin http://localhost:3011 --port 7800
   ```

   Install the existing service's dependencies and model assets first, as described in its README. Match the port to `NEXT_PUBLIC_SPEAKER_SERVICE_URL`: this local workspace uses `ws://127.0.0.1:7800/live`; the code default is port 7799.
3. In Voice Focus, choose **Microphone input** explicitly, preview the POV feed, choose the speaker/hearing aids, and check video/microphone timing. The picker starts empty; capture never picks a default input automatically. System default is available as an explicit choice. Refresh lists device names after microphone access is allowed. Clap while watching the preview. A negative video offset compensates for video that arrives later than sound. The existing service accepts offsets from −500 to +500 ms. Confirm timing before starting; changing the offset or microphone clears that confirmation.
4. Start Voice Focus, then enable voice commands. Look **inside the detected face box** and say **select** or **focus**. A face is needed because the separator uses the selected person's visible lips. A whole-body point or the nearest unrelated face is never substituted.
5. The selected service face ID stays latched while tracked, even if gaze moves elsewhere. Say **stop listening** / **clear selection** to clear it. **Stop voice** disables commands while leaving the current focus active. The buttons provide equivalent manual selection and stop controls.

Opening focus does not restart calibration or connect another camera. **Preview POV camera** attaches to the existing scene camera or connects its saved source. The eye-tracking indicator reads the native camera first, then the optional external gaze bridge; network stalls display a waiting/reconnecting status. A live eye image without a locked model or loaded mapping is labelled **Eye camera live**, with an explanation of what is missing for gaze selection.

## Failure behavior

- Selection reads the current calibrated eye/scene measurements at command time. Stale, future, invalid, low-confidence, ambiguous, off-face or missing gaze cannot select a speaker. A cursor held briefly for visual continuity cannot authorize selection.
- Missing/stale face observations or a frozen feed clear the target and cancel queued focused audio. A newcomer is not automatically selected. Select again after reacquiring the person.
- Service disconnects clear face IDs and playback. Reconnecting starts a fresh service session and requires selection again; old target generations cannot play audio.
- Actual decoded POV frame IDs/timestamps drive JPEG capture. A canvas capture stream repeating frozen pixels is not treated as fresh video. Late JPEG callbacks are discarded after stop. Portrait/rotated images retain their aspect ratio while staying within the existing service's 640×480 image limits.
- The speaker service already enforces audio/video coverage with no frame gap over 150 ms. A slow or intermittent ESP/MJPEG feed may support the gaze cursor but be insufficient for lip-based audio separation. It pauses with a timing/target error rather than playing the room mix or duplicating frames to simulate mouth movement. Improve capture/network frame rate and alignment before retrying. Offsets cannot repair dropped frames or delays beyond the supported range.
- Audio output uses a dedicated playback AudioContext and its selected sink. The shared microphone continues to serve captions and local commands. A failed requested sink reports an error; an unplugged selected output stops focus. Browsers without output-selection support can use the system default.
- Stopping, cancelling or failing standalone focus releases its microphone. During a live lecture the microphone stays available to captions. Cancelling a pending microphone permission request prevents a late permission result from starting focus.
- Changing microphone stops focus; check timing and start again. Captions in a live lecture resume using the new input. Capture requests the selected device ID exactly; an unavailable input reports an error without retrying another microphone. The selection remains with the workspace while navigating, and starts empty after a reload.
- Service face IDs are temporary positional tracks, not biometric identity recognition. Detection and separation quality depend on the existing model, a visible face, microphone quality, lighting and aligned video. Crossing people, severe occlusion and low-resolution lips still need real-device evaluation.
- Motion uses every incoming camera frame. Small faces receive spatially balanced feature samples; weak motion evidence needs a real fresh detection supported by matching texture and tracked facial landmarks. A supported crop can replace a rejected wide-frame fit during a head turn. Short detection misses retain the selected ID for up to 600 ms only with stronger image-flow evidence. Missing fits do not create mouth observations or extend the deadline; box overlap alone cannot transfer the selection to a newcomer.
- AV-MossFormer2 receives its full three-second context with a 1.8-second stride, rather than the legacy RTFS 120 ms minimum / 400 ms history. Initial output needs three seconds plus inference and playback delay. The UI names the running model and shows **Preparing audio** until the current selection receives focused audio. It does not promise perfect voice removal when lips are obscured or out of view.
- Microphone timestamps identify each chunk's first source sample; JPEG encoding delay does not shift frame alignment. Browser playback trims already played source spans, so overlapping or repeated replies do not replay the same speech.
- Selection and clearing discard microphone PCM while retaining only the short real-video history needed for the configured offset (at most 650 ms). Replay rewinds discard that history. Negative offsets allow time for the aligned video to arrive; they do not relax the 150 ms frame coverage/skew requirement.

MQTT broker/topic settings and X-only ESP servo behavior are unchanged by this integration. No mixed microphone audio is used as a fallback for focused playback.

## Verification

Regression coverage includes confirmed gaze selection, latch retention, loss/reconnect invalidation, stale/frozen frames, audio generation cancellation, output routing, startup failure/cancellation and shared-microphone command cleanup. Native browser/audio/worker boundaries are simulated in these tests. They do not establish real-model isolation quality or network/hardware accuracy.

On 2026-10-23, after the focus UI, microphone selection, audio playback and readiness fixes, the workspace JavaScript suites passed 527 tests (387 web, 34 live-client, 106 server), with 15 existing external-service integration tests skipped. The workspace type check and web production build passed. The build retains the existing Varlock dynamic-import warning.

Run JavaScript suites in their separate workspace processes with `bun run --filter '*' test`. Running bare `bun test` from the repository root mixes Happy DOM's browser `Response` and `WebSocket` globals into Bun server fixtures. That combined run failed these 14 existing server tests; all pass in the isolated server suite:

- `S3ObjectStorage (against a fake S3)`: `puts, stats, gets and deletes objects`; `presigns SigV4 PUT and GET URLs that a client can use directly`.
- `Gemini-compatible embedding batches request float vectors and configured dimensions`.
- `embeddings rotate keys on 429 and fall back to the same model via another provider when all are limited`.
- `createMastraGenerate → Merge Gateway (OpenAI-compatible)`: `sends the full gateway model id with the bearer key and returns the validated object`; `rejects output that does not match the schema (caller falls back)`.
- `GatewayVisionDescriber → Merge Gateway`: `sends the image to the vision model and returns a one-line description`.
- `SarvamStt`: `authenticates, sends base64 PCM, and maps START_SPEECH → … → final transcript under one id`; `clears the placeholder when Sarvam returns an empty transcript`.
- `DeepgramStt`: `authenticates, forwards audio, and maps interim → final under one segment id`; `clears the interim line when a final result comes back empty`; `sends KeepAlive while no audio flows`.
- `ElevenLabsStt`: `mints a token, streams base64 PCM after session_started, maps partial → committed under one id`; `surfaces provider errors and stops on terminal ones`.

The Python speaker environment and pinned AV-MossFormer2 assets are installed, and the real service on port 7800 is running AV on MPS. The Python suite passed 185 tests with six opt-in checks skipped; a real checkpoint load/inference test and recording tests also passed. The live WebSocket path held one selection throughout a 31.936-second 320×180/15 fps three-person recording, returning all 510,976 source samples once, without target loss or flow pauses. Two short overlapping-speech GRID samples measured +13.6/+14.0 dB SI-SDR improvement using clean stems for scoring only. These results do not establish accuracy on live ESP cameras or physical speaker routing; those still need a device session.
