"""Instance corroboration; detector category confidence alone is never a match."""

import math
import time
from dataclasses import dataclass

import cv2
import numpy as np

Box = tuple[float, float, float, float]


def valid_box(value) -> Box:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("Choose a valid object rectangle.")
    if any(
        isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x)
        for x in value
    ):
        raise ValueError("Choose a valid object rectangle.")
    x1, y1, x2, y2 = value
    if not 0 <= x1 < x2 <= 1 or not 0 <= y1 < y2 <= 1:
        raise ValueError("Choose a valid object rectangle.")
    return tuple(float(x) for x in value)


def project_box(parent, region):
    """Map a normalized child region into a proposed parent box."""
    x1, y1, x2, y2 = parent
    a, b, c, d = region
    return [x1 + a * (x2 - x1), y1 + b * (y2 - y1), x1 + c * (x2 - x1), y1 + d * (y2 - y1)]


def stable_projection(source, destination, corners, projected):
    affine, _ = cv2.estimateAffinePartial2D(
        np.float32(source), np.float32(destination), method=cv2.LMEDS
    )
    if affine is None or not np.isfinite(affine).all():
        return False
    expected = cv2.transform(corners, affine)
    area = cv2.contourArea(expected)
    # A sparse projective fit must agree with the extent implied by local motion.
    # Large disagreement makes the selected region's unobserved edges uncertain.
    return area > 0 and 0.5 < cv2.contourArea(np.float32(projected)) / area < 2


def crop(image, box: Box):
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    left = min(width - 1, round(x1 * width))
    top = min(height - 1, round(y1 * height))
    right = min(width, max(left + 1, round(x2 * width)))
    bottom = min(height, max(top + 1, round(y2 * height)))
    roi = image[top:bottom, left:right]
    scale = min(1, 800 / max(roi.shape[:2]))
    return cv2.resize(
        roi, (max(1, round(roi.shape[1] * scale)), max(1, round(roi.shape[0] * scale)))
    )


@dataclass(frozen=True)
class Candidate:
    box: Box
    confidence: float


class Reference:
    def __init__(self, image, box: Box):
        self.image = crop(image, valid_box(box))
        self.orb = cv2.ORB_create(nfeatures=1500, fastThreshold=10, edgeThreshold=12)
        self.points, self.descriptors = ([], None)
        if min(self.image.shape[:2]) >= 32:
            self.points, self.descriptors = self.orb.detectAndCompute(self.image, None)

    def compare(self, image, candidate: Candidate):
        if self.descriptors is None or len(self.points) < 8:
            return None
        target = crop(image, valid_box(candidate.box))
        if min(target.shape[:2]) < 32:
            return None
        points, descriptors = self.orb.detectAndCompute(target, None)
        if descriptors is None or len(points) < 8:
            return None
        pairs = cv2.BFMatcher(cv2.NORM_HAMMING).knnMatch(self.descriptors, descriptors, k=2)
        good = [
            pair[0]
            for pair in pairs
            if len(pair) == 2 and pair[0].distance < 0.7 * pair[1].distance
        ]
        # One destination feature cannot corroborate multiple reference features.
        unique = {}
        for match in sorted(good, key=lambda item: item.distance):
            unique.setdefault(match.trainIdx, match)
        good = list(unique.values())
        if len(good) < 8:
            return None
        source_points = np.float32([self.points[m.queryIdx].pt for m in good])
        target_points = np.float32([points[m.trainIdx].pt for m in good])
        homography, mask = cv2.findHomography(source_points, target_points, cv2.RANSAC, 4.0)
        if homography is None or mask is None or not np.isfinite(homography).all():
            return None
        accepted = mask.ravel().astype(bool)
        inliers = int(accepted.sum())
        score = inliers / len(good)
        if inliers < 8 or score <= 0.80:
            return None
        height, width = self.image.shape[:2]
        coverage = cv2.contourArea(cv2.convexHull(source_points[accepted])) / (width * height)
        if coverage < 0.10:
            return None
        corners = np.float32([[0, 0], [width, 0], [width, height], [0, height]]).reshape(-1, 1, 2)
        projected = cv2.perspectiveTransform(corners, homography)
        target_area = target.shape[0] * target.shape[1]
        area = cv2.contourArea(projected)
        if (
            not stable_projection(
                source_points[accepted], target_points[accepted], corners, projected
            )
            or not np.isfinite(projected).all()
            or not cv2.isContourConvex(projected)
            or not 0.0005 * target_area < area < 4 * target_area
        ):
            return None
        x1, y1, x2, y2 = candidate.box
        coordinates = projected.reshape(-1, 2)
        low = coordinates.min(axis=0) / [target.shape[1], target.shape[0]]
        high = coordinates.max(axis=0) / [target.shape[1], target.shape[0]]
        box = [
            max(0, x1 + low[0] * (x2 - x1)),
            max(0, y1 + low[1] * (y2 - y1)),
            min(1, x1 + high[0] * (x2 - x1)),
            min(1, y1 + high[1] * (y2 - y1)),
        ]
        if box[0] >= box[2] or box[1] >= box[3]:
            return None
        return {
            "box": box,
            "score": score,
            "inliers": inliers,
            "detectionConfidence": candidate.confidence,
        }


def choose_match(reference: Reference, image, candidates: list[Candidate], *, deadline=None):
    matches = []
    for candidate in candidates:
        if deadline is not None and time.monotonic() >= deadline:
            return {"status": "searching"}
        result = reference.compare(image, candidate)
        if result:
            matches.append(result)
            if candidate.box == (0, 0, 1, 1):
                # A whole-view homography can choose one of two similar objects.
                # Exclude that region and require no equally plausible instance.
                remaining = image.copy()
                h, w = image.shape[:2]
                x1, y1, x2, y2 = result["box"]
                remaining[
                    max(0, math.floor(y1 * h) - 2) : min(h, math.ceil(y2 * h) + 2),
                    max(0, math.floor(x1 * w) - 2) : min(w, math.ceil(x2 * w) + 2),
                ] = 0
                if deadline is not None and time.monotonic() >= deadline:
                    return {"status": "searching"}
                second = reference.compare(remaining, candidate)
                if second:
                    matches.append(second)
    matches.sort(key=lambda result: result["score"], reverse=True)
    distinct = []
    for match in matches:
        if not any(box_overlap(match["box"], other["box"]) > 0.5 for other in distinct):
            distinct.append(match)
    matches = distinct
    if not matches:
        return {"status": "searching"}
    if len(matches) > 1 and matches[0]["score"] - matches[1]["score"] < 0.08:
        return {"status": "ambiguous"}
    return {"status": "matched", **matches[0]}


def box_overlap(first, second):
    x1, y1, x2, y2 = first
    a1, b1, a2, b2 = second
    intersection = max(0, min(x2, a2) - max(x1, a1)) * max(0, min(y2, b2) - max(y1, b1))
    union = (x2 - x1) * (y2 - y1) + (a2 - a1) * (b2 - b1) - intersection
    return intersection / union if union > 0 else 0
