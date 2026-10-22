"""One incremental CPU face preprocessor per bounded live session."""

from collections import deque
from io import BytesIO

import cv2
import numpy as np
from PIL import Image

from .faces import (
    FaceAssociator,
    FaceObservation,
    FaceTrack,
    associate_boxes,
    box_iou,
    detector_observations,
    face_model_path,
    validate_region,
)


def decode_frame(payload: bytes) -> np.ndarray:
    with Image.open(BytesIO(payload)) as metadata:
        if metadata.format != "JPEG" or not (
            8 <= metadata.width <= 640 and 8 <= metadata.height <= 480
        ):
            raise ValueError("Live JPEG dimensions must be at most 640x480")
    image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Live JPEG could not be decoded")
    return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def distinct_observations(
    observations: list[FaceObservation], width: int, height: int
) -> list[FaceObservation]:
    """Merge duplicate landmark fits, retaining distinct overlapping faces."""
    distinct = []
    for observation in observations:
        face_size = min(observation.box[2] * width, observation.box[3] * height)
        duplicate = any(
            box_iou(observation.box, other.box) >= 0.65
            and np.linalg.norm(observation.anchors - other.anchors, axis=1).mean()
            <= 0.15 * face_size
            for other in distinct
        )
        if not duplicate:
            distinct.append(observation)
    return distinct


class LiveFaces:
    def __init__(self):
        self.detector = None
        self.associator = FaceAssociator()
        self.tracks: dict[str, FaceTrack] = {}
        self.last_detection = -1.0
        self.region = None

    def correct(self, region):
        if region is not None:
            validate_region(region)
        self.region = region
        self.associator = FaceAssociator()
        self.tracks.clear()
        self.last_detection = -1.0

    def initialize(self):
        import mediapipe as mp

        if self.detector is None:
            options = mp.tasks.vision.FaceLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(face_model_path())),
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_faces=6,
                min_face_detection_confidence=0.3,
                min_face_presence_confidence=0.3,
            )
            self.detector = mp.tasks.vision.FaceLandmarker.create_from_options(options)

    def detect(self, image: np.ndarray, timestamp: float, retain_from: float | None = None):
        if timestamp - self.last_detection < 0.18:
            return
        self.initialize()
        observations = self._observe(image, timestamp, self.region)
        if self.region is None:
            previous = {key: track.observations[-1].box for key, track in self.tracks.items()}
            matched = associate_boxes(previous, [item.box for item in observations])
            for identity, track in self.tracks.items():
                last = track.observations[-1]
                if identity in matched or timestamp - last.timestamp > 0.35:
                    continue
                if any(box_iou(last.box, item.box) >= 0.35 for item in observations):
                    continue
                x, y, w, h = last.box
                left = max(0, x - 0.6 * w)
                top = max(0, y - 0.6 * h)
                region = (left, top, min(1, x + 1.6 * w) - left, min(1, y + 1.6 * h) - top)
                recovered = self._observe(image, timestamp, region)
                if len(recovered) == 1 and box_iou(last.box, recovered[0].box) >= 0.35:
                    observations += recovered
        elif len(observations) > 1:
            raise ValueError("Correct a region containing exactly one face")
        identities = self.associator.update([o.box for o in observations], timestamp)
        for identity, observation in zip(identities, observations, strict=True):
            track = self.tracks.setdefault(
                identity, FaceTrack(identity, manual=self.region is not None)
            )
            track.observations.append(observation)
        self.last_detection = timestamp
        self.tracks = {
            key: track for key, track in self.tracks.items() if key in self.associator.last_seen
        }
        oldest = timestamp - 3.5
        if retain_from is not None:
            oldest = min(oldest, retain_from - 0.35)
        for track in self.tracks.values():
            # Covers the bounded 4 MiB source queue (65.5 s), plus context, at >=180 ms/fit.
            track.observations = list(
                deque((o for o in track.observations if o.timestamp >= oldest), maxlen=384)
            )

    def _observe(self, image, timestamp, region):
        import mediapipe as mp

        height, width = image.shape[:2]
        left, top = 0, 0
        crop = image
        if region is not None:
            x, y, w, h = region
            left, top = round(x * width), round(y * height)
            crop = np.ascontiguousarray(
                image[top : round((y + h) * height), left : round((x + w) * width)]
            )
            if min(crop.shape[:2]) < 8:
                return []
        detected = self.detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=crop))
        observations = detector_observations(detected, crop.shape[1], crop.shape[0], timestamp)
        if region is not None:
            for observation in observations:
                x, y, w, h = observation.box
                observation.box = (
                    (left + x * crop.shape[1]) / width,
                    (top + y * crop.shape[0]) / height,
                    w * crop.shape[1] / width,
                    h * crop.shape[0] / height,
                )
                observation.anchors += [left, top]
                observation.mouth += [left, top]
        return distinct_observations(observations, width, height)

    def view(self):
        return [
            {
                "id": t.id,
                "manual": t.manual,
                "observations": [
                    {"timestamp": t.observations[-1].timestamp, "box": t.observations[-1].box}
                ],
            }
            for t in self.tracks.values()
        ]

    def close(self):
        if self.detector:
            self.detector.close()
            self.detector = None
