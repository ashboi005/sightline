"""Corroborate coarse appearance across resolution, exposure and blur changes.

This is candidate verification, never a location search or identity probability.
The ordinary full-detail matcher remains the first acquisition path.
"""

from itertools import product

import cv2
import numpy as np


def sharpness(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(float)
    return float(np.mean(cv2.Laplacian(gray, cv2.CV_64F) ** 2) / (gray.var() + 1e-8))


def compatible_color(first, second):
    colors = []
    for image in (first, second):
        height, width = image.shape[:2]
        interior = image[
            round(height * 0.35) : round(height * 0.8), round(width * 0.25) : round(width * 0.75)
        ]
        color = np.uint8([[interior.mean(axis=(0, 1))]])
        colors.append(cv2.cvtColor(color, cv2.COLOR_BGR2HSV)[0, 0].astype(float))
    a, b = colors
    if min(a[1], b[1]) < 24:
        return max(a[1], b[1]) < 60
    difference = abs(a[0] - b[0])
    return min(difference, 180 - difference) <= 15


def quality_pair(first, second):
    """Return normalized views only with distinctive, aligned coarse evidence."""
    if min(*first.shape[:2], *second.shape[:2]) < 12:
        return None
    aspect_a = first.shape[1] / first.shape[0]
    aspect_b = second.shape[1] / second.shape[0]
    if not 2 / 3 <= aspect_b / aspect_a <= 1.5 or not compatible_color(first, second):
        return None
    size = (32, 64) if aspect_a < 1 else (64, 32)
    a, b = (cv2.resize(image, size) for image in (first, second))
    sharp_a, sharp_b = sharpness(a), sharpness(b)
    gray_a, gray_b = (cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) for image in (a, b))
    if min(gray_a.std(), gray_b.std()) < 8:
        return None
    disparity = max(sharp_a, sharp_b) / max(1e-6, min(sharp_a, sharp_b))
    exposure_change = abs(float(gray_a.mean()) - float(gray_b.mean()))
    # Do not broaden same-quality recovery into coarse category matching.
    if not (disparity >= 3 and min(sharp_a, sharp_b) < 0.1) and exposure_change < 30:
        return None
    sigma = 3 if disparity >= 3 else 1
    source = cv2.GaussianBlur(a, (0, 0), sigma)
    current = cv2.GaussianBlur(b, (0, 0), sigma)
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY).astype(float)
    centered = gray - gray.mean()
    height, width = second.shape[:2]
    pad_y, pad_x = round(height * 0.3), round(width * 0.3)
    padded = cv2.copyMakeBorder(second, pad_y, pad_y, pad_x, pad_x, cv2.BORDER_REPLICATE)
    best = -1.0
    # Bound crop alignment to small box/perspective differences, not arbitrary
    # deformation or a scan for an unrelated subregion inside the proposal.
    for x, y, sx, sy in product((-0.1, 0, 0.1), (-0.1, 0, 0.1), (0.9, 1, 1.1), (0.9, 1, 1.1)):
        region = padded[
            pad_y + round(y * height) : pad_y + round((y + sy) * height),
            pad_x + round(x * width) : pad_x + round((x + sx) * width),
        ]
        candidate = cv2.GaussianBlur(cv2.resize(region, size), (0, 0), sigma)
        values = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY).astype(float)
        denominator = gray.std() * values.std()
        if denominator > 1e-8:
            score = float(np.mean(centered * (values - values.mean())) / denominator)
            best = max(best, score)
    if not np.isfinite(best) or best <= 0.92:
        return None

    # Saturation/white balance varies strongly between cameras. Keep colour
    # identity in the raw hue gate; use luminance for descriptor corroboration.
    def descriptor_view(image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(float)
        low, high = np.percentile(gray, [5, 95])
        normalized = np.uint8(np.clip((gray - low) / max(1, high - low) * 255, 0, 255))
        return cv2.cvtColor(normalized, cv2.COLOR_GRAY2BGR)

    return descriptor_view(source), descriptor_view(current), best
