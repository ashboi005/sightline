"""Bounded Lucas–Kanade region motion with backward and geometric checks."""

import cv2
import numpy as np


def follow_flow(previous, image, box):
    height, width = image.shape[:2]
    old = cv2.cvtColor(previous, cv2.COLOR_BGR2GRAY)
    current = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mask = np.zeros_like(old)
    x1, y1, x2, y2 = box
    mask[round(y1 * height) : round(y2 * height), round(x1 * width) : round(x2 * width)] = 255
    points = cv2.goodFeaturesToTrack(old, 100, 0.015, 4, mask=mask, blockSize=5)
    if points is None or len(points) < 8:
        return None
    options = {
        "winSize": (21, 21),
        "maxLevel": 3,
        "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.03),
    }
    moved, status, _ = cv2.calcOpticalFlowPyrLK(old, current, points, None, **options)
    if moved is None:
        return None
    recovered, back, _ = cv2.calcOpticalFlowPyrLK(current, old, moved, None, **options)
    if recovered is None:
        return None
    reliable = (
        (status.ravel() == 1)
        & (back.ravel() == 1)
        & (np.linalg.norm(points - recovered, axis=2).ravel() < 1.5)
        & np.isfinite(moved).all(axis=(1, 2))
    )
    if reliable.sum() < 8 or reliable.mean() <= 0.8:
        return None
    source = points[reliable].reshape(-1, 2)
    destination = moved[reliable].reshape(-1, 2)
    transform, inliers = cv2.estimateAffinePartial2D(
        source, destination, method=cv2.RANSAC, ransacReprojThreshold=3
    )
    if transform is None or inliers is None or not np.isfinite(transform).all():
        return None
    accepted = inliers.ravel().astype(bool)
    score = float(accepted.mean())
    if score <= 0.8 or accepted.sum() < 8:
        return None
    area = (x2 - x1) * width * (y2 - y1) * height
    if cv2.contourArea(cv2.convexHull(source[accepted])) < 0.1 * area:
        return None
    scale = np.linalg.norm(transform[:, 0])
    if not 0.8 <= scale <= 1.25:
        return None
    # Transform the center and isotropic size. Re-bounding rotated corners every
    # frame compounds tiny rotations into an ever-growing axis-aligned rectangle.
    center = transform @ np.array([(x1 + x2) * width / 2, (y1 + y2) * height / 2, 1])
    size = np.array([(x2 - x1) * width, (y2 - y1) * height]) * scale
    low = np.clip((center - size / 2) / [width, height], 0, 1)
    high = np.clip((center + size / 2) / [width, height], 0, 1)
    if np.any(high <= low):
        return None
    return {"box": [*low, *high], "score": score, "inliers": int(accepted.sum())}
