"""Positional face tracks and model-aligned mouth observations."""

import os
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np

from .media import DecodedMedia, nearest_frame_indices
from .model import VIDEO_FPS

Box = tuple[float, float, float, float]


@dataclass
class FaceObservation:
    timestamp: float
    box: Box
    anchors: np.ndarray
    mouth: np.ndarray


@dataclass
class FaceTrack:
    id: str
    observations: list[FaceObservation] = field(default_factory=list)
    manual: bool = False


def box_iou(a: Box, b: Box) -> float:
    left = max(a[0], b[0])
    top = max(a[1], b[1])
    right = min(a[0] + a[2], b[0] + b[2])
    bottom = min(a[1] + a[3], b[1] + b[3])
    overlap = max(0.0, right - left) * max(0.0, bottom - top)
    union = a[2] * a[3] + b[2] * b[3] - overlap
    return overlap / union if union > 0 else 0.0


def associate_boxes(previous: dict[str, Box], current: list[Box]) -> list[str | None]:
    result: list[str | None] = [None] * len(current)
    if not previous or not current:
        return result
    identities = list(previous)
    scores = np.array([[box_iou(previous[key], box) for box in current] for key in identities])
    for index in range(len(current)):
        row = int(scores[:, index].argmax())
        score = scores[row, index]
        if score < 0.35 or int(scores[row].argmax()) != index:
            continue
        alternatives = np.delete(scores[row], index)
        rivals = np.delete(scores[:, index], row)
        if (alternatives.size and score - alternatives.max() < 0.15) or (
            rivals.size and score - rivals.max() < 0.15
        ):
            continue
        result[index] = identities[row]
    return result


class FaceAssociator:
    def __init__(self, max_gap: float = 0.6):
        self.max_gap = max_gap
        self.last_seen: dict[str, tuple[Box, float]] = {}

    def update(self, boxes: list[Box], timestamp: float) -> list[str]:
        self.last_seen = {
            key: value
            for key, value in self.last_seen.items()
            if 0 <= timestamp - value[1] <= self.max_gap
        }
        previous = {key: value[0] for key, value in self.last_seen.items()}
        matches = associate_boxes(previous, boxes)
        identities = [identity or uuid4().hex[:12] for identity in matches]
        # Box overlap alone cannot establish who returned after an occlusion.
        # Only people observed in consecutive detection passes keep continuity.
        self.last_seen = {
            identity: (box, timestamp) for identity, box in zip(identities, boxes, strict=True)
        }
        return identities


def validate_region(region: Box) -> None:
    if (
        len(region) != 4
        or not np.isfinite(region).all()
        or region[0] < 0
        or region[1] < 0
        or region[2] <= 0
        or region[3] <= 0
        or region[0] + region[2] > 1
        or region[1] + region[3] > 1
    ):
        raise ValueError("Face region must fit inside the normalized image")


def crop_square(image: np.ndarray, center: tuple[float, float], size: int) -> np.ndarray:
    left = int(round(center[0] - size / 2))
    top = int(round(center[1] - size / 2))
    ys = np.arange(top, top + size).clip(0, image.shape[0] - 1)
    xs = np.arange(left, left + size).clip(0, image.shape[1] - 1)
    return image[np.ix_(ys, xs)]


def normalize_mouth(image: np.ndarray) -> np.ndarray:
    return ((image.astype(np.float32) / 255.0 - 0.421) / 0.165).astype(np.float32)


FACE_MODEL_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"


def face_model_path() -> Path:
    """Pinned MediaPipe Face Landmarker (float16 v1); override with SPEAKER_FACE_MODEL."""
    override = os.environ.get("SPEAKER_FACE_MODEL")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "models/face_landmarker.task"


def detector_observations(
    result, width: int, height: int, timestamp: float
) -> list[FaceObservation]:
    detections = []
    for landmarks in result.face_landmarks:
        points = np.array([[point.x, point.y] for point in landmarks])
        minimum = points.min(axis=0).clip(0, 1)
        maximum = points.max(axis=0).clip(0, 1)
        box = (
            float(minimum[0]),
            float(minimum[1]),
            float(maximum[0] - minimum[0]),
            float(maximum[1] - minimum[1]),
        )
        pixel_points = points * [width, height]
        anchors = pixel_points[[2, 33, 133, 362, 263]]
        mouth = pixel_points[[61, 291, 13, 14]].mean(axis=0)
        detections.append(FaceObservation(timestamp, box, anchors, mouth))
    return detections


def track_faces(
    media: DecodedMedia, model_path: Path | None = None, region: Box | None = None
) -> list[FaceTrack]:
    import mediapipe as mp

    model_path = model_path or face_model_path()
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=6,
        min_face_detection_confidence=0.3,
        min_face_presence_confidence=0.3,
    )
    tracks: dict[str, FaceTrack] = {}
    associator = FaceAssociator()
    if region is not None:
        validate_region(region)
    last_time = -1.0
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as detector:
        for index, frame in enumerate(media.frames):
            timestamp = float(media.timestamps[index])
            if index and timestamp - last_time < 0.1:
                continue
            left, top = 0, 0
            image = frame
            if region is not None:
                left, top = round(region[0] * media.width), round(region[1] * media.height)
                right = min(media.width, round((region[0] + region[2]) * media.width))
                bottom = min(media.height, round((region[1] + region[3]) * media.height))
                image = np.ascontiguousarray(frame[top:bottom, left:right])
                if image.shape[0] < 8 or image.shape[1] < 8:
                    raise ValueError("Face region is too small")
            result = detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=image))
            observations = detector_observations(result, image.shape[1], image.shape[0], timestamp)
            if region is not None:
                for observation in observations:
                    x, y, width, height = observation.box
                    observation.box = (
                        (left + x * image.shape[1]) / media.width,
                        (top + y * image.shape[0]) / media.height,
                        width * image.shape[1] / media.width,
                        height * image.shape[0] / media.height,
                    )
                    observation.anchors += [left, top]
                    observation.mouth += [left, top]
            assignments = associator.update(
                [observation.box for observation in observations], timestamp
            )
            for identity, observation in zip(assignments, observations, strict=True):
                track = tracks.setdefault(identity, FaceTrack(identity, manual=region is not None))
                track.observations.append(observation)
            last_time = timestamp
    return [track for track in tracks.values() if len(track.observations) >= 3]


def mouth_patch(
    frame: np.ndarray, observation: FaceObservation, smoothed_anchors: np.ndarray
) -> np.ndarray:
    # A fixed five-point frontal geometry at 256x256; no third-party mean-face data.
    target = np.array([[128, 139], [78, 100], [104, 100], [152, 100], [178, 100]], dtype=np.float32)
    transform, _ = cv2.estimateAffinePartial2D(
        smoothed_anchors.astype(np.float32), target, method=cv2.LMEDS
    )
    if transform is None or not np.isfinite(transform).all():
        raise ValueError("Face alignment is unreliable; reacquire the target")
    gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
    aligned = cv2.warpAffine(gray, transform, (256, 256), borderMode=cv2.BORDER_REPLICATE)
    center = transform[:, :2] @ observation.mouth + transform[:, 2]
    crop = crop_square(aligned, (float(center[0]), float(center[1])), 96)[4:92, 4:92]
    return normalize_mouth(crop)


def _matched_sequence(
    media: DecodedMedia, track: FaceTrack, start: float, duration: float
) -> list[tuple[int, int]]:
    if not track.observations:
        raise ValueError("Selected face has no usable observations")
    desired = start + np.arange(round(duration * VIDEO_FPS)) / VIDEO_FPS
    # Only context beyond EOF repeats the last frame; real internal gaps still fail.
    desired = np.minimum(desired, media.timestamps[-1])
    frame_indices = nearest_frame_indices(media.timestamps, desired)
    observations = track.observations
    observed_times = np.array([observation.timestamp for observation in observations])
    observation_indices = nearest_frame_indices(observed_times, desired)
    matches = []
    for timestamp, frame_index, observation_index in zip(
        desired, frame_indices, observation_indices, strict=True
    ):
        if abs(timestamp - observations[int(observation_index)].timestamp) > 0.35:
            raise ValueError("Selected face was lost; extraction paused")
        matches.append((int(frame_index), int(observation_index)))
    return matches


def mouth_sequence(
    media: DecodedMedia, track: FaceTrack, start: float, duration: float
) -> np.ndarray:
    patches = []
    observations = track.observations
    for frame_index, observation_index in _matched_sequence(media, track, start, duration):
        observation = observations[observation_index]
        first = max(0, observation_index - 3)
        last = min(len(observations), observation_index + 4)
        anchors = np.mean([item.anchors for item in observations[first:last]], axis=0)
        patches.append(mouth_patch(media.frames[frame_index], observation, anchors))
    return np.stack(patches).astype(np.float32)


def prepare_frames(
    media: DecodedMedia, track: FaceTrack, start: float, duration: float, engine: str = "rtfs"
) -> np.ndarray:
    """Shared clip/live boundary; each engine receives its own trained visual geometry."""
    if engine == "rtfs":
        return mouth_sequence(media, track, start, duration)
    if engine != "av-mossformer2":
        raise ValueError("Unsupported separation engine")

    from scipy.signal import medfilt

    matches = _matched_sequence(media, track, start, duration)
    boxes = np.array([track.observations[index].box for _, index in matches])
    for box in boxes:
        validate_region(box)
    size = np.maximum(boxes[:, 2] * media.width, boxes[:, 3] * media.height) / 2
    center_x = (boxes[:, 0] + boxes[:, 2] / 2) * media.width
    center_y = (boxes[:, 1] + boxes[:, 3] / 2) * media.height
    kernel = min(13, 2 * ((len(matches) - 1) // 2) + 1)
    size, center_x, center_y = (medfilt(values, kernel) for values in (size, center_x, center_y))
    patches = []
    for (frame_index, _), radius, x, y in zip(matches, size, center_x, center_y, strict=True):
        padding = int(radius * 1.8)
        frame = np.pad(
            media.frames[frame_index],
            ((padding, padding), (padding, padding), (0, 0)),
            constant_values=110,
        )
        x, y = x + padding, y + padding
        face = frame[
            int(y - radius) : int(y + radius * 1.8),
            int(x - radius * 1.4) : int(x + radius * 1.4),
        ]
        if not face.size:
            raise ValueError("Selected face region is too small")
        gray = cv2.cvtColor(cv2.resize(face, (224, 224)), cv2.COLOR_RGB2GRAY)[56:168, 56:168]
        patches.append((gray.astype(np.float32) / 255.0 - 0.4161) / 0.1688)
    return np.stack(patches).astype(np.float32)


def manual_track(media: DecodedMedia, region: Box) -> FaceTrack:
    tracks = track_faces(media, region=region)
    usable = [track for track in tracks if len(track.observations) >= 0.4 * media.duration * 7.5]
    if len(usable) != 1:
        raise ValueError("Mark a region containing exactly one visible face")
    return usable[0]


def track_in_region(track: FaceTrack, region: Box) -> bool:
    """An explicit correction takes ownership of its marked face area."""
    for observation in track.observations:
        x, y, width, height = observation.box
        center = (x + width / 2, y + height / 2)
        if (
            region[0] <= center[0] <= region[0] + region[2]
            and region[1] <= center[1] <= region[1] + region[3]
        ):
            return True
    return False
