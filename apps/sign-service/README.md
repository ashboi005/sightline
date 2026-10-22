# Sign-service camera test

This is a small local viewer for testing the recognizer before the web frontend
is ready. It opens the webcam, sends JPEG frames to the sign-service WebSocket,
and renders the latest hands status, partial gloss, committed tokens, phrase
end, and errors over the preview.

## Install

From this directory:

```powershell
python -m pip install -e ".[test]"
```

The service uses MediaPipe `0.10.21`, which provides the
`mediapipe.solutions.hands` API used by the landmark extractor.

Live recognition uses two pretrained Hugging Face models; no project-specific
training or prototype recording is required:

- `dima806/asl_alphabet_image_detection` for static A-Z fingerspelling
- `Shawon16/VideoMAE_WLASL_2000_200_epochs_p20_SR_8_kinetics` for dynamic WLASL
  signs whose labels are present in the Sightline vocabulary

The first service start downloads these models from Hugging Face and caches
them locally. For a preloaded/offline machine, set `HF_HUB_OFFLINE=1` after the
models have been downloaded. You can override the model IDs with
`SIGN_IMAGE_MODEL_ID` and `SIGN_VIDEO_MODEL_ID`.

The service requires CUDA by default and uses FP16 autocast on the GPU. Install
the CUDA PyTorch build rather than the CPU-only PyPI build:

```powershell
python -m pip uninstall -y torch torchvision torchaudio
python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

Verify before starting the server:

```powershell
python -c "import torch; print(torch.__version__); print(torch.version.cuda); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

For this workstation the expected device is `NVIDIA GeForce RTX 5060`.

## Start the service

In terminal 1:

```powershell
python -m sign_service.server
```

The first startup can take several minutes while the two Hugging Face model
weights are downloaded. Keep the terminal open until it prints the listening
message. Later starts use the local Hugging Face cache.

## Start the camera viewer

In terminal 2:

```powershell
python -m sign_service.camera_client
```

Or, after editable installation:

```powershell
sign-service-camera
```

Options:

```powershell
python -m sign_service.camera_client --camera 1 --fps 12 --width 640 --height 480
```

Controls in the camera window:

- `r`: send `phrase.reset`
- `s`: stop/start the WebSocket stream
- `q` or `Escape`: stop the stream and quit

The preview is mirrored for the signer, but transmitted JPEGs are not mirrored.
The client keeps only the newest frame, so slow model inference does not create
an unbounded camera latency queue.

## Model-only recognition

There is no prototype recorder, local training dataset, geometric fallback, or
hardcoded acronym map. Static A-Z fingerspelling comes from the pretrained
alphabet model; dynamic signs come from the pretrained WLASL model. Arbitrary
spelled words are assembled from the model's stable letter outputs.

The camera window draws the local MediaPipe landmarks and hand boxes. If the
window says `camera hands: 0`, improve lighting/framing before judging the
classifier. If it sees one or two hands but recognition is wrong, recalibrate
that label with three fresh repetitions and make sure the sign is held for a
short, consistent burst.
