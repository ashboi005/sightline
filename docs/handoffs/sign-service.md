# Sign Service Handover

**Updated:** 2026-10-22
**Repository:** Sightline
**Current revision:** `38ca735 sign-service model inintial implementation`
**Owner:** Harnoor / sign-service

## Goal

Deliver a real-time sign service at `ws://localhost:7788/ws` that follows the
Sightline sign-service contract and recognizes live signing without a
project-specific training dataset or prototype calibration.

The active recognition design is a two-model pretrained pipeline:

```text
MediaPipe Hands
  ├── isolated hand crop → Hugging Face A-Z alphabet model
  └── rolling 16-frame video window → Hugging Face WLASL VideoMAE model
```

Stable alphabet predictions are assembled into arbitrary fingerspelled glosses.
There is no special handling for `KCL`, `RIA`, `OHM`, or any other acronym.

The service must preserve these protocol outputs:

- `service.ready`
- `hands.status`
- `sign.partial`
- `sign.token`
- `phrase.end`
- `error`

## Current state

### Implemented

- WebSocket server at `ws://localhost:7788/ws`.
- `SELF` and `PEER` stream support.
- Stale-frame dropping and concurrent-processing protection.
- Hands status throttling.
- Stable token commitment and hands-down phrase detection.
- Standalone OpenCV webcam client:
  - `python -m sign_service.camera_client`
  - `sign-service-camera`
- MediaPipe hand landmark boxes and skeleton overlay in the camera viewer.
- Hugging Face A-Z image classifier.
- Hugging Face WLASL dynamic video classifier.
- Generic spelling aggregation:
  - `K`, `C`, `L` → `KCL`
  - `R`, `I`, `A` → `RIA`
  - arbitrary words are handled the same way.
- Legacy prototype recording/reset utilities removed from the active code path.
- Legacy landmark BiLSTM/checkpoint recognition removed from the active code path.
- Geometric hand-shape, finger-count, acronym, and motion-to-word fallbacks
  removed from the active code path.

### Active Hugging Face models

```text
SIGN_IMAGE_MODEL_ID=prithivMLmods/Alphabet-Sign-Language-Detection
SIGN_VIDEO_MODEL_ID=Shawon16/VideoMAE_WLASL_2000_200_epochs_p20_SR_8_kinetics
```

The image model exposes 26 alphabet labels. The WLASL model exposes 2000
dynamic-sign labels. WLASL outputs are filtered against the Sightline
vocabulary before being emitted as gloss tokens.

### GPU verification already completed

The current local virtual environment was upgraded from CPU-only PyTorch to:

```text
torch 2.11.0+cu128
CUDA build 12.8
cuda_available True
NVIDIA GeForce RTX 5060 Laptop GPU
compute capability (12, 0)
```

`nvidia-smi` reports an RTX 5060 Laptop GPU with approximately 8 GB VRAM and a
CUDA 13.1-capable driver.

The two pretrained models loaded successfully on CUDA:

```text
[sign-model] device=cuda amp=True image_labels=26 video_labels=2000
```

The model-only synthetic inference smoke test reported approximately:

```text
alphabet inference: 1463 ms
video inference:     235 ms
GPU allocated:       698 MB
GPU peak:            744 MB
```

The synthetic image was blank, so those predictions are not an accuracy
measurement. A real-camera accuracy evaluation is still required.

## Important files

### Runtime

- `apps/sign-service/sign_service/server.py`
  - WebSocket protocol and phrase state machine.
- `apps/sign-service/sign_service/recognizer.py`
  - Per-stream prediction smoothing and frame result adapter.
- `apps/sign-service/sign_service/hf_pipeline.py`
  - Hugging Face model loading, MediaPipe crops, GPU device selection,
    FP16 autocast, A-Z inference, WLASL inference, and diagnostics.
- `apps/sign-service/sign_service/model.py`
  - MediaPipe Hands extraction, normalization, preview drawing, and shared
    vocabulary/prediction types.
- `apps/sign-service/sign_service/camera_client.py`
  - Standalone webcam/WebSocket viewer.

### Configuration and docs

- `apps/sign-service/pyproject.toml`
  - Python dependencies and console entry points.
- `apps/sign-service/README.md`
  - Local install, GPU setup, server startup, and camera-client instructions.
- `packages/contracts/src/protocols/sign-service.ts`
  - Protocol source of truth.
- `docs/contracts/sign-service.md`
  - Protocol contract and message examples.
- `packages/mocks/fixtures/sign.phrases.json`
  - Six demo phrases and required gloss vocabulary.

### Tests

- `apps/sign-service/tests/test_ws_protocol.py`
  - Executable WebSocket contract test.

The previous prototype recorder/reset files are intentionally no longer part of
the model-only implementation.

## Fresh-machine setup

Do not rely on an existing Hugging Face cache. The next verification must use a
fresh cache and download the models again.

From `apps/sign-service`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1

python -m pip install --upgrade pip
python -m pip install -e ".[test]"

python -m pip uninstall -y torch torchvision torchaudio
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

Use a clean Hugging Face cache:

```powershell
$env:HF_HOME = "$env:TEMP\sightline-hf-clean"
$env:HF_HUB_CACHE = "$env:HF_HOME\hub"
Remove-Item Env:HF_HUB_OFFLINE -ErrorAction SilentlyContinue
```

Verify CPU/GPU/runtime state before starting the server:

```powershell
python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0)); print(torch.cuda.get_device_capability(0))"
nvidia-smi
```

Expected values include:

```text
CUDA-enabled torch build
True
NVIDIA GeForce RTX 5060
(12, 0)
```

Start the service with CUDA required:

```powershell
$env:SIGN_MODEL_DEVICE = "cuda"
$env:SIGN_REQUIRE_CUDA = "1"
python -m sign_service.server
```

The first start downloads both models. Keep the terminal open until the server
prints its listening message and model diagnostics. Later starts may use the
cache; use `HF_HUB_OFFLINE=1` only after a successful fresh download/load.

## Fresh model/API verification

The next implementation pass must load the actual downloaded model configs and
processors rather than assuming model-card behavior.

Verify all of the following after a fresh download:

1. `AutoImageProcessor` loads for the alphabet model.
2. `AutoModelForImageClassification` loads for the alphabet model.
3. The alphabet `id2label` contains exactly the expected A-Z labels.
4. `AutoImageProcessor` loads for the WLASL model.
5. `AutoModelForVideoClassification` loads for the WLASL model.
6. The WLASL `id2label` map is present and deterministic.
7. Both models are on `cuda:0`.
8. Input tensors are on CUDA before inference.
9. FP16 autocast is active.
10. `nvidia-smi` shows the Python process using model VRAM during inference.

If a fresh model exposes a different processor API, tensor shape, label map, or
normalization configuration, adapt `hf_pipeline.py` to the downloaded model.
Do not silently reuse the previous preprocessing assumptions.

## How to run locally

Terminal 1:

```powershell
cd apps/sign-service
.\.venv\Scripts\Activate.ps1
$env:SIGN_MODEL_DEVICE = "cuda"
$env:SIGN_REQUIRE_CUDA = "1"
python -m sign_service.server
```

Terminal 2:

```powershell
cd apps/sign-service
.\.venv\Scripts\Activate.ps1
python -m sign_service.camera_client
```

Camera controls:

- `r`: send `phrase.reset`
- `s`: stop/start the WebSocket stream
- `q` or `Escape`: quit

Watch both the camera overlay and server terminal. The server should report
device/model diagnostics and the camera should show hand landmarks and boxes.

## Checks and evidence

### Passed previously

```powershell
python -m pip check
```

Result:

```text
No broken requirements found.
```

The executable protocol test passed before the latest handover-only changes:

```powershell
python tests/test_ws_protocol.py
```

Results included:

```text
sign-service websocket protocol test passed
```

### Needs rerun after handover cleanup

Run these after the fresh-machine setup and any further changes:

```powershell
python -m pytest -q tests
python tests/test_ws_protocol.py
python -m compileall -q sign_service tests
python -m pip check
git diff --check
```

At the time of this handover, the pytest folder has no regular pytest test
function after removing the legacy checkpoint test; the executable protocol
test remains the primary WebSocket check. Add a focused Hugging Face runtime
test before calling the model-only path complete.

## Known gaps

1. No real-camera accuracy benchmark has been recorded after switching to the
   Hugging Face models.
2. Blank-image inference was used only for a GPU execution smoke test.
3. The WLASL model is large and may not meet the service's original 60 ms
   per-frame target on every machine. It is throttled to a rolling video window
   rather than run on every frame.
4. WLASL can only emit labels that exist in its trained vocabulary and the
   service vocabulary. Unsupported complex words must be fingerspelled through
   the alphabet model.
5. The README model ID may need synchronization with the current active image
   model if it still names the older `dima806` model.
6. CUDA model installation is currently documented separately from the broad
   `torch>=2,<3` package requirement. A future setup script should make the
   CUDA wheel selection explicit for Windows/NVIDIA machines.

## Next concrete action

On a clean environment, redownload both Hugging Face models with a fresh
`HF_HOME`, verify the model processors/label maps and CUDA placement, then run
the camera client while recording:

- alphabet accuracy for at least A, B, C, K, L, R, I, and A;
- generic spelling of `KCL` and `RIA`;
- dynamic WLASL predictions for simple supported signs;
- image/video inference latency and GPU memory;
- false repeated-label behavior.

Use those measurements to tune only the actual model-specific preprocessing and
arbitration in `hf_pipeline.py`. Do not reintroduce prototype files,
handcrafted ASL rules, or hardcoded acronym maps.
