"""Person-only selection and immutable, session-local cross-camera identity evidence."""

import math

import numpy as np

from matching import box_overlap, valid_box

MIN_IDENTITY_SCORE = 0.65
MIN_IDENTITY_MARGIN = 0.08
MIN_PERSON_CONFIDENCE = 0.3
MIN_VIEW_SCORE = 0.8
RECOVERY_SECONDS = 2.0


def select_person(people, point, box):
    people = [person for person in people if person.confidence >= MIN_PERSON_CONFIDENCE]
    if box is not None:
        region = valid_box(box)

        # A deliberate torso rectangle can be much smaller than a full-body box.
        # Measure how much of the user's rectangle belongs to each person.
        def coverage(person):
            left, top = max(region[0], person.box[0]), max(region[1], person.box[1])
            right, bottom = min(region[2], person.box[2]), min(region[3], person.box[3])
            return (
                max(0, right - left)
                * max(0, bottom - top)
                / ((region[2] - region[0]) * (region[3] - region[1]))
            )

        matches = sorted(people, key=coverage, reverse=True)
        if not matches or coverage(matches[0]) < 0.6:
            raise ValueError("Draw around one detected person, including their body.")
        if len(matches) > 1 and coverage(matches[1]) > 0.25:
            raise ValueError("People overlap here. Choose a clearer view of one person.")
        return matches[0]
    if (
        not isinstance(point, (list, tuple))
        or len(point) != 2
        or not all(
            isinstance(x, (int, float))
            and not isinstance(x, bool)
            and math.isfinite(x)
            and 0 <= x <= 1
            for x in point
        )
    ):
        raise ValueError("Look at or click one detected person.")
    matches = [
        person
        for person in people
        if person.box[0] <= point[0] <= person.box[2] and person.box[1] <= point[1] <= person.box[3]
    ]
    if not matches:
        raise ValueError("No person detected at that point. Look at their body and select again.")
    if len(matches) != 1:
        raise ValueError("People overlap here. Choose a clearer part of the person's body.")
    return matches[0]


class PersonIdentity:
    def __init__(self, descriptor, distractors=()):
        descriptor = np.asarray(descriptor, dtype=np.float32)
        norm = np.linalg.norm(descriptor)
        if descriptor.ndim != 1 or not np.isfinite(descriptor).all() or norm < 1e-6:
            raise ValueError("The selected person's appearance could not be read. Select again.")
        self.anchor = descriptor / norm
        self.anchor.flags.writeable = False
        self.distractors = []
        for other in distractors:
            feature = np.asarray(other, dtype=np.float32)
            norm = np.linalg.norm(feature)
            if feature.shape == self.anchor.shape and np.isfinite(feature).all() and norm > 1e-6:
                self.distractors.append(feature / norm)

    def new_view(self, person=None, now=None):
        view = PersonView(self)
        if person is not None and now is not None:
            view.box = person.box
            view.local_anchor = self.anchor
            view.last_seen = now
        return view


class PersonView:
    def __init__(self, identity):
        self.identity = identity
        self.box = None
        self.pending = None
        self.last_seen = -math.inf
        self.last_update = -math.inf
        self.local_anchor = None
        self.distractors = list(identity.distractors)
        self.lost = False

    def unavailable(self, status="searching"):
        self.pending = None
        if self.lost:
            return {
                "status": "lost",
                "requiresReselect": True,
                "reason": "Person lock lost. Select the person again; movement has stopped.",
            }
        return {"status": status}

    def update(self, people, descriptors, now):
        if not math.isfinite(now) or now <= self.last_update:
            return self.unavailable()
        self.last_update = now
        if self.local_anchor is not None and now - self.last_seen > RECOVERY_SECONDS:
            self.lost = True
        if self.lost:
            return self.unavailable()
        if not people:
            return self.unavailable()
        descriptors = np.asarray(descriptors)
        if (
            descriptors.shape != (len(people), len(self.identity.anchor))
            or not np.isfinite(descriptors).all()
        ):
            return self.unavailable()
        norms = np.linalg.norm(descriptors, axis=1, keepdims=True)
        descriptors = descriptors / np.maximum(norms, 1e-8)
        scores = descriptors @ self.identity.anchor
        # Once acquired, the same camera must also agree with its own immutable
        # reference. A sole visible person is not proof of the selected identity.
        local_scores = descriptors @ self.local_anchor if self.local_anchor is not None else scores
        order = np.argsort(scores)[::-1]
        best = int(order[0])
        score = float(np.clip(scores[best], -1, 1))
        margin = score - max(0, float(scores[order[1]])) if len(order) > 1 else score
        candidate = people[best]
        if self.distractors:
            negative_score = float(np.max(descriptors[best] @ np.stack(self.distractors).T))
            margin = min(margin, max(score, float(local_scores[best])) - negative_score)
        if (
            score < MIN_IDENTITY_SCORE
            or candidate.confidence < MIN_PERSON_CONFIDENCE
            or (self.local_anchor is not None and local_scores[best] < MIN_VIEW_SCORE)
        ):
            return self.unavailable()
        if margin < MIN_IDENTITY_MARGIN:
            return self.unavailable("ambiguous")
        continuous = (
            self.box is not None
            and now - self.last_seen <= RECOVERY_SECONDS
            and box_overlap(self.box, candidate.box) >= 0.15
        )
        if self.local_anchor is not None and not continuous:
            return self.unavailable()
        confirmed = (
            self.pending is not None
            and now - self.pending[1] <= 0.75
            and box_overlap(self.pending[0], candidate.box) >= 0.4
            and float(descriptors[best] @ self.pending[2]) >= MIN_VIEW_SCORE
        )
        if not continuous and not confirmed:
            self.pending = (candidate.box, now, descriptors[best].copy())
            return {"status": "searching"}
        self.pending = None
        if self.local_anchor is None:
            self.local_anchor = descriptors[best].copy()
        # Remember distinct bystanders while the selected person is visible, so
        # their later disappearance cannot improve a bystander's identity margin.
        for index, other in enumerate(people):
            if (
                index != best
                and len(self.distractors) < 16
                and other.confidence >= MIN_PERSON_CONFIDENCE
                and box_overlap(candidate.box, other.box) < 0.15
                and scores[index] < score - MIN_IDENTITY_MARGIN
                and not any(float(descriptors[index] @ item) > 0.95 for item in self.distractors)
            ):
                self.distractors.append(descriptors[index].copy())
        self.box = candidate.box
        self.last_seen = now
        return {
            "status": "matched",
            "box": list(candidate.box),
            "method": "person",
            "score": score,
            "identityMargin": margin,
            "detectionConfidence": candidate.confidence,
        }
