"""Conservative dense appearance search for smooth regions without ORB corners.

Normalized correlation is a similarity score, never a probability of identity.
Uniform regions, weak results and similar non-overlapping peaks stay unconfirmed.
"""

import cv2
import numpy as np

from matching import Candidate, box_overlap, crop, project_box


def choose_appearance(reference, image, *, unique_region=(0, 0, 1, 1)):
    """Search appearance; deduplicate at the selected child region's scale."""
    height, width = image.shape[:2]
    # Keep the useful pixels of small references; large objects stay cheap.
    reference_side = min(reference.image.shape[:2])
    reduction = min(1, max(480 / max(height, width), 24 / reference_side))
    view_image = cv2.resize(image, (round(width * reduction), round(height * reduction)))
    template = cv2.resize(
        reference.image,
        (
            max(1, round(reference.image.shape[1] * reduction)),
            max(1, round(reference.image.shape[0] * reduction)),
        ),
    )
    gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    if min(gray.shape) < 12 or gray.std() < 8:
        return {"status": "searching"}
    view_height, view_width = view_image.shape[:2]
    view = cv2.cvtColor(view_image, cv2.COLOR_BGR2GRAY)
    margin_y, margin_x = max(1, gray.shape[0] // 10), max(1, gray.shape[1] // 10)
    mean_color = template[margin_y:-margin_y, margin_x:-margin_x].mean(axis=(0, 1))
    matches = []
    region_width = unique_region[2] - unique_region[0]
    region_height = unique_region[3] - unique_region[1]
    for scale in (0.8, 0.9, 1.0, 1.1, 1.25):
        w, h = round(gray.shape[1] * scale), round(gray.shape[0] * scale)
        if not 12 <= w <= view_width or not 12 <= h <= view_height:
            continue
        resized = cv2.resize(gray, (w, h))
        for angle in (-10, -5, 0, 5, 10):
            rotated = cv2.warpAffine(
                resized,
                cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1),
                (w, h),
                borderValue=float(gray.mean()),
            )
            # Interior detail avoids interpolation/padding at the rotated crop's edge.
            dx, dy = max(1, w // 10), max(1, h // 10)
            detail = rotated[dy:-dy, dx:-dx]
            scores = cv2.matchTemplate(view, detail, cv2.TM_CCOEFF_NORMED)
            scores[~np.isfinite(scores)] = -1
            for _ in range(3):
                _, score, _, (x, y) = cv2.minMaxLoc(scores)
                if score <= 0.92:
                    break
                color = view_image[y : y + detail.shape[0], x : x + detail.shape[1]].mean(
                    axis=(0, 1)
                )
                if np.max(np.abs(color - mean_color)) < 30:
                    matches.append(
                        {
                            "box": [
                                max(0, (x - dx) / view_width),
                                max(0, (y - dy) / view_height),
                                min(1, (x - dx + w) / view_width),
                                min(1, (y - dy + h) / view_height),
                            ],
                            "score": score,
                            "method": "appearance",
                        }
                    )
                suppress_x = max(1, round(w * region_width / 2))
                suppress_y = max(1, round(h * region_height / 2))
                scores[
                    max(0, y - suppress_y) : min(scores.shape[0], y + suppress_y + 1),
                    max(0, x - suppress_x) : min(scores.shape[1], x + suppress_x + 1),
                ] = -1
    matches.sort(key=lambda match: match["score"], reverse=True)
    distinct = []
    for match in matches:
        if not any(
            box_overlap(
                project_box(match["box"], unique_region), project_box(other["box"], unique_region)
            )
            > 0.5
            for other in distinct
        ):
            distinct.append(match)
    if not distinct:
        return {"status": "searching"}
    if len(distinct) > 1 and distinct[0]["score"] - distinct[1]["score"] < 0.08:
        return {"status": "ambiguous"}
    return {"status": "matched", **distinct[0]}


def confirm_region(reference, image, box):
    """Corroborate a proposed track against its fixed initial appearance."""
    match = reference.compare(image, Candidate(tuple(box), 0.0))
    if match and box_overlap(match["box"], box) >= 0.5:
        return {"status": "matched", **match}
    original = cv2.resize(reference.image, (48, 48))
    proposed = cv2.resize(crop(image, box), (48, 48))
    first = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY).astype(float)
    second = cv2.cvtColor(proposed, cv2.COLOR_BGR2GRAY).astype(float)
    if min(first.std(), second.std()) < 8:
        return {"status": "searching"}
    similarity = float(
        np.mean((first - first.mean()) * (second - second.mean())) / (first.std() * second.std())
    )
    color_change = np.max(np.abs(original.mean(axis=(0, 1)) - proposed.mean(axis=(0, 1))))
    if similarity <= 0.92 or color_change >= 30:
        return {"status": "searching"}
    return {
        "status": "matched",
        "box": list(box),
        "score": min(1.0, similarity),
        "method": "appearance",
    }
