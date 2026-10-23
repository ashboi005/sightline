# Sign service: ASL letters → text

One CPU alphabet classifier reads MediaPipe hand landmarks. A movement guard and one-second hold accept deliberate letters; a general English decoder adds word boundaries and can restore repeated letters. There is no lexical-sign model, dynamic vocabulary configuration, CUDA requirement, or runtime model download.

## Fresh computer setup (Windows PowerShell)

Requirements: Windows x64, Git, [uv](https://docs.astral.sh/uv/getting-started/installation/), and a webcam for live testing. Bun is only needed for the frontend and the optional root-script shortcuts.

Install uv from the linked official instructions if `uv --version` is unavailable, then open a new terminal. From a new clone:

```powershell
New-Item -ItemType Directory -Force "$HOME/Desktop/Codex-projects" | Out-Null
Set-Location "$HOME/Desktop/Codex-projects"
git clone https://github.com/ashboi005/sightline.git
Set-Location sightline

uv python install 3.12
uv sync --project apps/sign-service --frozen
uv run --project apps/sign-service --frozen sign-service-check-models --offline
```

For an existing checkout, pull the commit containing these changes, then rerun the last two commands. Run all commands below **from the repository root**. You do not need to activate a virtual environment.

The committed `apps/sign-service/uv.lock` pins dependencies. The ~20 MB classifier, metadata and source license are included under `sign_service/assets/landmark_forest/`; the loader verifies its SHA-256 before use. Setup installs the dependencies and bundled MediaPipe/dictionary resources. After setup, the recognition service works offline without API keys, a GPU, training data, or the frontend.

The verification command reports one classifier, CPU execution, A–Z support and synthetic timing. It verifies model execution, **not recognition accuracy**.

## Test the backend directly

```powershell
uv run --project apps/sign-service --frozen sign-service-camera
```

This opens the webcam and runs the production recognizer/decoder directly. No WebSocket server, browser or app backend is needed.

- Use one hand anywhere in the camera view, with the whole hand visible.
- Form the letter, then hold the handshape steady for about **one second**. Moving/uncertain frames restart the hold. At least four fresh observations are needed, so very low frame rates take longer.
- The preview distinguishes the current model guess from **accepted letters**.
- Move directly to the next different letter; keeping the same shape held does not repeat it.
- For a repeated letter, briefly lower/re-show the hand (at least about 0.25 seconds, under one second).
- Lower the hand for about one second to finish the phrase. The preview shows raw spelling and backend-decoded text separately.
- `R`: discard/reset. `S`: pause/resume and discard. `Q` or Escape: close and release the webcam.

If needed, append `--camera 1` to select a different camera. Close this tester before enabling the browser camera.

## Start the WebSocket server

In terminal A:

```powershell
uv run --project apps/sign-service --frozen sign-service
```

Expected startup line:

```text
[sign-service] listening on ws://localhost:7788/ws
```

Leave this terminal running. Recognition readiness is confirmed by the first `service.ready` WebSocket message, not just by the listening line. The model name identifies the landmark forest and English decoder; `vocabulary` is the fixed A–Z alphabet required by protocol v1. Unsupported arbitrary words can be fingerspelled; word spellings are not a second vocabulary.

In terminal B, test the **real WebSocket route** with the backend webcam client:

```powershell
uv run --project apps/sign-service --frozen sign-service-ws-camera --url ws://localhost:7788/ws
```

Use the same hold/release instructions as the direct tester. The client displays and logs messages from the running service. Do not run the direct tester and this client simultaneously against the same camera.

To check connectivity without opening the camera:

```powershell
@'
import asyncio, json
from websockets.asyncio.client import connect

async def main():
    async with connect("ws://127.0.0.1:7788/ws") as socket:
        print(json.loads(await socket.recv()))

asyncio.run(main())
'@ | uv run --project apps/sign-service --frozen python -
```

Expect `type: service.ready`, `protocolVersion: "1"` and the A–Z vocabulary. `MODEL_UNAVAILABLE` is a setup/model error; fix it before testing recognition.

To use another port, set `$env:SIGN_SERVICE_PORT='7789'` in terminal A before starting. Use that port in clients too. Stop the server with Ctrl+C.

## Share the model WebSocket through ngrok

Install the [official ngrok CLI](https://ngrok.com/download/windows), then authenticate it once on your computer:

```powershell
ngrok config add-authtoken YOUR_NGROK_AUTHTOKEN
```

Keep the token in ngrok's local configuration or the `NGROK_AUTHTOKEN` environment variable. Do not commit it to this repository. If ngrok is not on PATH, set `$env:NGROK_BIN='C:/path/to/ngrok.exe'`. The helper also supports a locally installed binary in `.cache/tools/ngrok/`.

Terminal A — start the model with a network-friendly frame freshness allowance:

```powershell
$env:SIGN_SERVICE_MAX_FRAME_AGE_MS='1000'
bun run sign:dev
```

One-time static domain setup: copy the domain assigned to your account from
[ngrok Domains](https://dashboard.ngrok.com/domains). Save it in **`.env.local` at the repository root**
(copy `.env.ngrok.example` if helpful):

```dotenv
NGROK_DOMAIN=your-assigned-domain.ngrok-free.app
```

The `sign:tunnel` command explicitly loads this gitignored file when run from the repository root (automatic environment loading is disabled in this workspace).
You can also set `$env:NGROK_DOMAIN='your-assigned-domain.ngrok-free.app'` in terminal B.
Use your account's assigned/reserved domain. The command always requests it with `--url` and
refuses to start if it is missing or invalid; it never falls back to a random URL.

Terminal B — open the tunnel at that static domain:

```powershell
bun run sign:tunnel
```

The command forwards `http://127.0.0.1:7788`, disables HTTP request inspection, and prints:

```text
[sign:tunnel] WebSocket: wss://YOUR_ASSIGNED_DOMAIN/ws
NEXT_PUBLIC_SIGN_SERVICE_URL=wss://YOUR_ASSIGNED_DOMAIN/ws
```

Set that exact `NEXT_PUBLIC_SIGN_SERVICE_URL` line in `apps/web/.env`, then restart the frontend so Next.js rebuilds with it. A deployed frontend needs the same value in its deployment/build environment. Keep both terminals running. Ctrl+C in terminal B closes the public endpoint. The same configured static URL is requested on every restart; the model and tunnel must still be running for it to respond. `SIGN_SERVICE_PORT` selects a different upstream port for both commands; set it in both terminals. Both commands fall back to `PORT`, then `7788`. Change `NGROK_DOMAIN` only when intentionally switching to another domain on your account; then update the frontend environment and restart it.

Use `wss://` for the public WebSocket connection and retain `/ws`. [ngrok's HTTP endpoints support WebSocket upgrades directly](https://ngrok.com/docs/using-ngrok-with/websockets). The public endpoint reaches the recognizer while the tunnel runs; anyone who has the URL can connect. The local API/frontend ports are not forwarded by this command.

The local freshness default remains 150 ms. `SIGN_SERVICE_MAX_FRAME_AGE_MS` accepts 1–5000 ms; 1000 ms allows normal internet/tunnel latency while rejecting older queued frames. Keep client/server clocks synchronized. Stream reset/stop fencing and bounded inference remain in effect.

To verify public connectivity, run the camera client with the printed URL (close the browser camera first):

```powershell
uv run --project apps/sign-service --frozen sign-service-ws-camera --url wss://YOUR_ASSIGNED_DOMAIN/ws
```

A successful `service.ready` followed by `hands.status` verifies the public protocol route. This is a transport check, not a recognition-accuracy result.

## Connect the browser

Install [Bun 1.4.4](https://bun.sh/docs/installation) and follow the [repository quick start](../../README.md#quick-start-everything-mocked-no-external-services) to install the JavaScript workspace and create the web/server environment files.

Use the **real sign-service command above in place of `mock:sign`**. Start the API and frontend separately with `bun run dev:server` and `bun run dev:web`; `dev:demo` also launches a sign mock and must not run alongside the real recognizer on port 7788.

Before starting the frontend, set this in `apps/web/.env`:

```dotenv
NEXT_PUBLIC_SIGN_SERVICE_URL=ws://localhost:7788/ws
```

Open `http://localhost:3001/sign` with the default web port, choose a lecture, wait for **Recogniser connected**, then select **Turn camera on** and **Start recognising**. If starting Next on a custom port such as 3301, open that port and match the API's `CORS_ORIGIN`. Keep `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_SERVER_WS_URL` matched to the API port.

Accepted raw letters append to the editable **Sentence draft**; the dashed **Guess** is tentative and is never submitted. Recognition continues to the next letter without choosing or correcting words in the browser. Press **Space** (or **Add space**) between words. Press **Enter** in the draft (or **Send sentence**) only when the sentence is ready. Keyboard Backspace/typing can correct the draft; the **Backspace** button deletes its last character. Repeated held predictions do not restore a deleted letter. Lowering the hand adds no spaces and never submits, saves or speaks the sentence.

Stopping the camera or reconnecting preserves the draft; **Clear sentence** discards it. Sending uses the existing compose/persistence/speech path only after explicit confirmation. A failed send keeps the draft for retry, and repeated Enter while saving does not duplicate it. With `USE_MOCK_DATA=true`, those app providers are simulated; hand tracking and alphabet recognition still come from this real service.

## Troubleshooting

- **Old CUDA/model errors or unexpected words:** stop every old recognizer and sign mock, then start only this service. The current model uses CPU and cannot produce a CUDA dependency error. Restart the browser connection after replacing the service.
- **Camera busy:** close the other webcam tester or browser camera, then retry. Use `--camera 1` for another device.
- **Live image but no hands:** keep the whole hand in view with even lighting. The tracker automatically tries grayscale recovery for strong camera color casts.
- **Connection refused:** keep terminal A running and match the port with `NEXT_PUBLIC_SIGN_SERVICE_URL`; restart Next after editing `.env`.

## Automated and video checks

```powershell
uv run --project apps/sign-service --frozen pytest -q apps/sign-service/tests
uv run --project apps/sign-service --frozen ruff check apps/sign-service/sign_service apps/sign-service/tests
uv run --project apps/sign-service --frozen python -m sign_service.evaluate_videos apps/sign-service/test_data/open_the_book.mp4 --report .data/open-book-report.json
```

Omit the video path to evaluate every supported clip in `test_data`. Expected letters come from the filename **only for scoring after inference**, never for prediction or training. Reports keep raw and language-assisted output separate and exit nonzero on a mismatch. Test videos are optional for startup; supply your own clips if absent from the checkout.

The one-second hold deliberately favors learners. The current `open_the_book.mp4` reevaluation produces `K` rather than `OPENTHEBOOK` and fails. Fast recordings with shorter holds can be rejected; an older four-frame result is not evidence for the current timing. Live reliability, J/Z motion signs, arbitrary-user accuracy and owner signoff remain unverified. A consistently wrong stable classification can still be accepted; the hold reduces accidental transition letters rather than fixing the model's classification errors.

For Bun users, the equivalent repository-root shortcuts are:

| Task | Command |
| --- | --- |
| Install Python dependencies | `bun run sign:setup` |
| Verify bundled model | `bun run sign:verify --offline` |
| Direct webcam tester | `bun run sign:camera` |
| WebSocket server | `bun run sign:dev` |
| Python tests | `bun run sign:test` |
| Video evaluation | `bun run sign:eval` |

## Implementation

`model.py` tracks hands (including bounded grayscale recovery for strong camera color casts); `alphabet_recognizer.py` builds features and suppresses moving inputs; `landmark_pipeline.py` runs the single numeric forest; `decoding.py` applies fresh-evidence holds; `spelling_language.py` reconstructs English words; `server.py` implements protocol v1 with stream isolation and bounded scheduling.

Native model confidence is preserved, with a 0.15 acceptance floor. The English decoder may add spaces or adjacent repeated letters, but cannot substitute, delete, or insert unrelated visual letters. Names and ambiguous repeats can still be misinterpreted. Training uses public landmark data; no acceptance-video frames were training inputs. Optional training tools are isolated in the `training` dependency group and are unnecessary for setup or inference.

The inactive emnikhil CNN implementation/weights and its PyTorch, CUDA, Transformers and H5 dependencies have been removed. Historical experiments and provenance are recorded in the [evaluation record](../../docs/implementation/alphabet-video-evaluation.md).
