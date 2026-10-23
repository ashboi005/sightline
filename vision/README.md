# Sightline vision companion

The companion selects a detected person in Scene, independently finds the same person in the ESP camera image, and maintains separate confirmation state for each camera. The app uses YOLO26s and OSNet-AIN on the same machine as the Next server. The generic object reference evaluator lazily loads the older YOLOE, SAM 2.1 Tiny, DINOv2 and LoFTR stack. MPS is used when available; other machines use CPU. No camera capture, microphone access, MQTT publication or servo control happens in this service.

From the repository root, prepare the pinned runtime and public model files once:

```sh
SAM2_BUILD_CUDA=0 uv sync --project vision --frozen
uv run --project vision vision/prepare.py
bun run --cwd apps/web prepare:voice
```

Vision weights, including retained reference models, require about 343 MiB under ignored `.local-reference/vision-models`; the Python environment needs additional disk space. Model files are checked against `assets.json` before inference. Preparation downloads only missing or invalid assets. Inference does not download models. Voice preparation serves its English model, WASM and worker from `apps/web/public/voice-runtime`; speech recognition executes in the browser.

Start the optional companion together with Sightline:

```sh
SIGHTLINE_LOCAL_VISION=1 bun run --cwd apps/web dev
```

The launcher can also be used directly from `apps/web`:

```sh
SIGHTLINE_LOCAL_VISION=1 bun scripts/run-with-vision.ts dev --port 3001
# After building the Next application:
SIGHTLINE_LOCAL_VISION=1 bun scripts/run-with-vision.ts start --port 3001
```

Without `SIGHTLINE_LOCAL_VISION=1`, normal Next startup does not start Python. `SIGHTLINE_WEB_NODE` can choose a Node executable; otherwise the launcher uses Node from PATH. `--port`/`-p` take precedence over `PORT`, with 3001 as the default. Development retains Webpack.

The launcher creates a random per-process bearer secret and binds Python to an ephemeral loopback port. It passes `GAZE_VISION_URL` and `GAZE_VISION_SECRET` only to the Next process and stops its companion on shutdown. The authenticated Next `/api/viewer-vision` route handles browser access; never expose the Python port publicly. A hosted deployment needs a persistent Next process, Python dependencies and weights on that server, a writable `.local-reference` directory, and sufficient CPU/RAM. This is not a serverless function deployment. Analysis frames are processed on the configured Sightline server, which may be different from the browser's computer.

For a container with the companion included, explicitly select the optional `tracking` target from the repository root:

```sh
docker build --target tracking -f apps/web/Dockerfile \
  --secret id=web_env,src=apps/web/.env \
  --secret id=server_env,src=apps/server/.env \
  --build-arg NEXT_PUBLIC_SERVER_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_SERVER_WS_URL=wss://api.example.com \
  -t sightline-web-tracking .
```

Replace the example public addresses with the deployment's API addresses, and provide the same runtime environment and server connectivity as the ordinary web container. The tracking target installs uv 0.12.1, managed Python 3.12, a fresh Linux environment from `uv.lock`, and checksum-verified weights at build time. Its Bun launcher starts the companion and then the existing `node --import varlock/auto-load server.js` entry point; it forwards the generated secret and handles shutdown. The Python listener stays inside the container. No extra exposed port is needed. `HOSTNAME=0.0.0.0` and `PORT=3001` retain the ordinary container defaults.

The default Docker target remains the ordinary standalone web runner. Compose does not enable vision unless its web build is explicitly configured with `target: tracking`. The tracking image enables `SIGHTLINE_LOCAL_VISION=1`; setting it to `0` disables companion startup. Host `.venv` directories, model caches, captured media under `.local-reference`/`tmp`, and generated browser runtimes are excluded from the build context. Browser voice assets are rebuilt from the verified public archive.

The frozen Linux dependency graph includes PyTorch's CUDA/Triton packages even though this engine uses CPU on Linux, so the optional image can be several GiB. Linux container performance has not been measured; the existing MPS measurements do not establish hosted CPU latency. A Docker image build and container smoke test are still required before deployment. This packaging was checked through launcher tests and source inspection; the development machine has no Docker CLI.

Requests use `status`, `select`, `track` (Scene memory), `match` (independent ESP acquisition/memory), and `clear`. Selected references stay in bounded memory, expire after ten idle minutes, and are removed on Clear. The browser rejects results older than 500 ms and invalidates results after camera or selection changes. Similar candidates, weak texture, occlusion or large viewpoint changes can remain searching or ambiguous. Scores measure evidence consistency, not calibrated identity probabilities; an explicit tracking action is required by the control layer before movement.

Run fixture tests without physical cameras or hardware:

```sh
uv run --project vision pytest
uv run --project vision ruff check vision
bun test apps/web/src/features/esp-camera/tracking/tests apps/web/src/features/esp-camera/voice/tests
```

`smoke.py` runs real inference on the installed Ultralytics public sample images. The test suite uses synthetic images and an isolated loopback HTTP fixture. `evaluate_video.py` accepts only explicitly supplied local files and does not open devices automatically. See [NOTICE.md](NOTICE.md) and `licenses/` for upstream attribution, including Ultralytics' AGPL-3.0 terms.
## Person-only ESP-CAM selection

Sightline's ESP-CAM setup selects a detected person, using YOLO26s and OSNet-AIN body appearance to compare that same person across the Scene and Target cameras. The app proxy forces person-only selection; a background/object click cannot start a generic object track. The original descriptor stays immutable and competing people must be separated by a matching margin. Ambiguous or missing observations pause following instead of selecting another person. No face recognition or saved identity database is used.

Run the existing preparation command after updating: `uv run --project vision vision/prepare.py`. It now verifies/downloads `yolo26s.pt` and `osnet_ain_msmt17.pth` as well as the retained reference assets. Restart `bun run --cwd apps/web dev:tracking --port 3011` to replace the Python companion; frontend hot reload does not reload Python. Runtime inference uses the local verified files without downloads. Generic reference evaluation lazily loads its older model stack and is not the app selection mode.
