"""Cross-view acquisition from immutable selected-region local features."""

import math
import time

import cv2
import numpy as np

from camera_quality import compatible_color
from context_acquisition import AcquiredRegion
from learned_correspondence import view_size
from matching import box_overlap, crop, stable_projection, valid_box


class VerificationLimit(RuntimeError):
    """Competing support could not be exhaustively checked in a bounded pass."""


def foreground_mask(memory, size, dilation=3):
    logits = memory.get("pred_masks") if memory is not None else None
    if logits is None:
        return None
    array = logits[0, 0].float().cpu().numpy()
    if array.ndim != 2 or not np.isfinite(array).all():
        return None
    mask = np.uint8(cv2.resize(array, size, interpolation=cv2.INTER_LINEAR) > 0)
    if dilation:
        mask = cv2.dilate(mask, np.ones((2 * dilation + 1, 2 * dilation + 1), np.uint8))
    return mask


def foreground_points(points, mask):
    points = np.asarray(points)
    if points.ndim != 2 or points.shape[1:] != (2,) or not np.isfinite(points).all():
        return np.zeros(len(points), bool)
    pixels = np.rint(points * [mask.shape[1] - 1, mask.shape[0] - 1]).astype(int)
    inside = np.all(points >= 0, axis=1) & np.all(points <= 1, axis=1)
    pixels = np.clip(pixels, [0, 0], [mask.shape[1] - 1, mask.shape[0] - 1])
    return inside & (mask[pixels[:, 1], pixels[:, 0]] != 0)


def projected_region(a, b, region, source_size, target_size, affine):
    area = np.prod((np.asarray(region[2:]) - region[:2]) * source_size)
    if cv2.contourArea(cv2.convexHull(a)) / area < 0.1:
        return None
    x1, y1, x2, y2 = region
    corners = np.float32([[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) * source_size
    corners = np.float32(corners).reshape(-1, 1, 2)
    projected = cv2.transform(corners, affine)
    if not stable_projection(a, b, corners, projected):
        return None
    points = projected.reshape(-1, 2) / target_size
    low, high = points.min(axis=0), points.max(axis=0)
    extent = np.prod(high - low)
    clipped = np.clip([*low, *high], 0, 1).tolist()
    try:
        valid_box(clipped)
    except ValueError:
        return None
    visible = np.prod(np.asarray(clipped[2:]) - clipped[:2])
    return clipped if 0.0005 < extent < 1 and visible / extent >= 0.5 else None


def geometric_region(
    first, second, region, source_size, target_size, candidate=None, excluded=None
):
    """Verify a candidate, or independently inspect competing geometric groups."""
    first, second = np.asarray(first), np.asarray(second)
    if (
        first.ndim != 2
        or first.shape[1:] != (2,)
        or second.shape != first.shape
        or not np.isfinite(first).all()
        or not np.isfinite(second).all()
        or np.any(first < 0)
        or np.any(first > 1)
        or np.any(second < 0)
        or np.any(second > 1)
    ):
        return None
    selected = np.all(first >= region[:2], axis=1) & np.all(first <= region[2:], axis=1)
    if candidate is not None:
        selected &= np.all(second >= candidate[:2], axis=1) & np.all(
            second <= candidate[2:], axis=1
        )
    a = np.float32(first[selected] * source_size)
    b = np.float32(second[selected] * target_size)
    extent = candidate if candidate is not None else excluded
    tolerance = (
        3
        if extent is None
        else max(3, 0.08 * max((np.asarray(extent[2:]) - extent[:2]) * target_size))
    )
    for _ in range(20 if excluded is not None else 1):
        if len(a) < 8 or len(np.unique(a, axis=0)) < 8 or len(np.unique(b, axis=0)) < 8:
            return None
        affine, mask = cv2.estimateAffine2D(
            a,
            b,
            method=cv2.RANSAC,
            ransacReprojThreshold=tolerance,
            maxIters=5000,
            confidence=0.999,
        )
        if affine is None or mask is None or not np.isfinite(affine).all():
            return None
        accepted = mask.ravel().astype(bool)
        if accepted.sum() < 8:
            return None
        # A competitor need not dominate all leftovers: several duplicates can
        # split the point set. Inspect each supported group independently.
        if excluded is None and accepted.mean() <= 0.8:
            return None
        result = projected_region(
            a[accepted], b[accepted], region, source_size, target_size, affine
        )
        if result is not None:
            if candidate is not None and box_overlap(result, candidate) < 0.5:
                return None
            if excluded is None or box_overlap(result, excluded) < 0.5:
                return result
        if excluded is None:
            return None
        a, b = a[~accepted], b[~accepted]
    if len(a) >= 8:
        raise VerificationLimit()
    return None


class ViewAcquisition:
    def __init__(
        self, image, box, reference, matcher, backend, clock=time.monotonic, source_memory=None
    ):
        self.reference = reference
        self.matcher = matcher
        self.backend = backend
        self.clock = clock
        height, width = image.shape[:2]
        pixels = np.asarray(box) * [width, height, width, height]
        self.contexts = []
        self.encoded_sources = {}
        mask = foreground_mask(source_memory, (width, height), dilation=0)
        for fraction in (0.1, 0.2):
            margin = max(32, round(min(height, width) * fraction / 8) * 8)
            left, top = np.maximum(0, pixels[:2] - margin).astype(int)
            right, bottom = np.minimum([width, height], pixels[2:] + margin).astype(int)
            context = image[top:bottom, left:right].copy()
            relative = (pixels - [left, top, left, top]) / [
                right - left,
                bottom - top,
                right - left,
                bottom - top,
            ]
            context_mask = (
                None
                if mask is None
                else cv2.resize(
                    mask[top:bottom, left:right],
                    view_size(context),
                    interpolation=cv2.INTER_NEAREST,
                )
            )
            if context_mask is not None:
                context_mask = cv2.dilate(context_mask, np.ones((7, 7), np.uint8))
            self.contexts.append((context, relative, context_mask))
        self.reset()

    def reset(self):
        self.pending = None
        self.shape = None

    def update(self, image, candidates):
        if image.shape != self.shape:
            self.reset()
            self.shape = image.shape
        previous, self.pending = self.pending, None
        if not candidates or len(candidates) > 20:
            return {"status": "ambiguous" if len(candidates) > 20 else "searching"}
        deadline = time.monotonic() + 2
        order = [previous[3]] if previous is not None else range(len(self.contexts))
        target_features = None
        for index in order:
            source, region, source_mask = self.contexts[index]
            if source_mask is None:
                return {"status": "searching"}
            if index not in self.encoded_sources:
                self.encoded_sources[index] = self.matcher.encode(source)
            if target_features is None:
                target_features = self.matcher.encode(image)
            source_features = self.encoded_sources[index]
            first, second = self.matcher.match_encoded(source_features, target_features)
            source_supported = foreground_points(first, source_mask)
            first, second = first[source_supported], second[source_supported]
            verified = []
            for candidate in candidates:
                if time.monotonic() >= deadline:
                    return {"status": "searching"}
                proposed = geometric_region(
                    first, second, region, view_size(source), view_size(image), candidate.box
                )
                if proposed is None:
                    continue
                prediction = self.backend.predict(
                    image,
                    candidate.box,
                    0,
                    {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}},
                )
                try:
                    valid_box(prediction.box)
                except (TypeError, ValueError):
                    continue
                # Grayscale features must not override contradictory colour from
                # the immutable Scene selection (e.g. another coloured case).
                if not compatible_color(self.reference.image, crop(image, prediction.box)):
                    continue
                target_mask = foreground_mask(prediction.memory, view_size(image))
                if target_mask is None:
                    continue
                supported = foreground_points(second, target_mask)
                proposed = geometric_region(
                    first[supported],
                    second[supported],
                    region,
                    view_size(source),
                    view_size(image),
                    candidate.box,
                )
                if proposed is None:
                    continue
                if (
                    not 0.95 < prediction.presence <= 1
                    or not 0.8 <= prediction.quality <= 1
                    or box_overlap(prediction.box, proposed) < 0.5
                    or box_overlap(prediction.box, candidate.box) < 0.5
                ):
                    continue
                if not any(box_overlap(prediction.box, other.box) > 0.5 for other in verified):
                    verified.append(prediction)
            if len(verified) > 1:
                return {"status": "ambiguous"}
            if not verified:
                continue
            prediction = verified[0]
            # Mutual matching can favour one duplicate. Mask it and search again
            # independently; a second distributed geometric match forbids a lock.
            remaining = image.copy()
            h, w = remaining.shape[:2]
            x1, y1, x2, y2 = prediction.box
            remaining[
                max(0, math.floor(y1 * h) - 2) : min(h, math.ceil(y2 * h) + 2),
                max(0, math.floor(x1 * w) - 2) : min(w, math.ceil(x2 * w) + 2),
            ] = 0
            a, b = self.matcher.match_encoded(source_features, self.matcher.encode(remaining))
            source_supported = foreground_points(a, source_mask)
            try:
                competitor = geometric_region(
                    a[source_supported],
                    b[source_supported],
                    region,
                    view_size(source),
                    view_size(image),
                    excluded=prediction.box,
                )
            except VerificationLimit:
                return {"status": "searching"}
            if competitor is not None and box_overlap(competitor, prediction.box) < 0.5:
                return {"status": "ambiguous"}
            if time.monotonic() >= deadline:
                return {"status": "searching"}
            now = self.clock()
            confirmed = False
            if previous is not None and previous[3] == index and 0 <= now - previous[2] <= 2:
                score = self.backend.similarity(prediction.memory, previous[1])
                confirmed = (
                    box_overlap(previous[0], prediction.box) >= 0.5
                    and math.isfinite(score)
                    and 0.8 < score <= 1
                )
            if not confirmed:
                self.pending = (list(prediction.box), prediction.memory, now, index)
                return {"status": "searching"}
            return {
                "status": "matched",
                "box": list(prediction.box),
                "score": prediction.presence,
                "maskQuality": prediction.quality,
                "method": "temporal",
                "acquisition": AcquiredRegion(
                    self.reference, image, list(prediction.box), prediction
                ),
            }
        return {"status": "searching"}
