"""YOLOE visual proposals with independent geometric instance verification."""

import os
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCAL = ROOT / ".local-reference"
(LOCAL / "vision-config").mkdir(parents=True, exist_ok=True)
os.environ["YOLO_CONFIG_DIR"] = str(LOCAL / "vision-config")
os.environ["MPLCONFIGDIR"] = str(LOCAL / "vision-config" / "matplotlib")
os.environ["YOLO_AUTOINSTALL"] = "false"
os.environ["YOLO_OFFLINE"] = "true"

import numpy as np  # noqa: E402
import torch  # noqa: E402
from ultralytics import YOLO, YOLOE, settings  # noqa: E402
from ultralytics.models.yolo.yoloe import YOLOEVPSegPredictor  # noqa: E402

from appearance import choose_appearance, confirm_region  # noqa: E402
from context_acquisition import ContextAcquisition  # noqa: E402
from cross_camera import CrossCameraAcquisition  # noqa: E402
from matching import Candidate, Reference, box_overlap, choose_match, crop, valid_box  # noqa: E402
from memory_tracking import MemoryTracker  # noqa: E402
from person_tracking import PersonIdentity, select_person  # noqa: E402
from prepare import MODELS, verify  # noqa: E402
from sessions import Sessions  # noqa: E402
from view_acquisition import ViewAcquisition  # noqa: E402


class VisionEngine:
    def __init__(self):
        import json

        for asset in json.loads(Path(__file__).with_name("assets.json").read_text()):
            if not verify(MODELS / asset["name"], asset["sha256"]):
                raise RuntimeError(
                    "Vision models missing. Run uv run --project vision vision/prepare.py."
                )
        settings.update(
            {
                key: False
                for key in (
                    "sync",
                    "wandb",
                    "mlflow",
                    "tensorboard",
                    "comet",
                    "clearml",
                    "neptune",
                    "dvc",
                )
                if key in settings
            }
        )
        torch.set_num_threads(4)
        import cv2

        cv2.setNumThreads(4)
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        from learned_appearance import PersonAppearanceModel

        self.people = YOLO(str(MODELS / "yolo26s.pt"))
        self.person_appearance = PersonAppearanceModel(self.device)
        self.sessions = Sessions()
        self.active = None
        self.options = {
            "imgsz": 640,
            "device": self.device,
            "verbose": False,
            "save": False,
            "conf": 0.25,
            "max_det": 20,
            "rect": False,
        }
        warm = np.zeros((480, 640, 3), np.uint8)
        self.people.predict(warm, classes=[0], **self.options)
        self.person_appearance.describe([warm])

    def load_object_models(self):
        """Legacy reference evaluation only; the person-only app never loads these."""
        from learned_appearance import AppearanceModel
        from learned_correspondence import LearnedCorrespondence
        from segmentation import SegmentationModel

        self.segmentation = SegmentationModel(self.device)
        self.appearance = AppearanceModel(self.device)
        self.correspondence = LearnedCorrespondence(self.device)
        self.detector = YOLOE(str(MODELS / "yoloe-26n-seg-pf.pt"))
        self.visual = YOLOE(str(MODELS / "yoloe-26n-seg.pt"))
        warm = np.zeros((480, 640, 3), np.uint8)
        empty_memory = {"cond_frame_outputs": {}, "non_cond_frame_outputs": {}}
        initial = self.segmentation.predict(warm, [0.1, 0.1, 0.6, 0.6], 0, empty_memory)
        empty_memory["cond_frame_outputs"][0] = initial.memory
        self.segmentation.predict(warm, None, 1, empty_memory)
        self.appearance.score(warm[:64, :64], warm[:64, :64])
        self.correspondence.match(warm, warm)
        self.detector.predict(warm, **self.options)
        self.visual.predict(
            warm,
            refer_image=warm,
            visual_prompts={"bboxes": np.array([[80, 80, 400, 400]]), "cls": np.array([0])},
            predictor=YOLOEVPSegPredictor,
            **self.options,
        )

    def status(self):
        return {
            "status": "ready",
            "model": "Person selection · YOLO26s + OSNet-AIN",
            "device": self.device,
        }

    def detect_people(self, image):
        prediction = self.people.predict(image, classes=[0], **self.options)[0]
        return self.candidates(prediction, image)

    def select(self, image, point, box, kind="object"):
        if kind == "person":
            people = self.detect_people(image)
            person = select_person(people, point, box)
            descriptors = self.person_appearance.describe(
                [crop(image, item.box) for item in people]
            )
            index = next(i for i, item in enumerate(people) if item is person)
            identity = PersonIdentity(
                descriptors[index],
                distractors=[
                    feature
                    for i, feature in enumerate(descriptors)
                    if i != index
                    and people[i].confidence >= 0.3
                    and box_overlap(person.box, people[i].box) < 0.15
                ],
            )
            token = self.sessions.add(
                {
                    "kind": "person",
                    "identity": identity,
                    "scene": identity.new_view(person, time.monotonic()),
                    "target": identity.new_view(),
                    "stream": None,
                }
            )
            import base64

            import cv2

            preview = crop(image, person.box)
            height, width = preview.shape[:2]
            scale = min(1, 192 / max(height, width))
            preview = cv2.resize(
                preview, (max(1, round(width * scale)), max(1, round(height * scale)))
            )
            ok, jpeg = cv2.imencode(".jpg", preview, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return {
                "token": token,
                "box": list(person.box),
                "label": "Selected person",
                "preview": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
                if ok
                else None,
            }
        if kind != "object":
            raise ValueError("Unknown selection type.")
        if not hasattr(self, "visual"):
            self.load_object_models()
        height, width = image.shape[:2]
        label = "Selected object"
        if box is None:
            if (
                not isinstance(point, list)
                or len(point) != 2
                or not all(
                    isinstance(x, (float, int))
                    and not isinstance(x, bool)
                    and np.isfinite(x)
                    and 0 <= x <= 1
                    for x in point
                )
            ):
                raise ValueError("Click an object or drag a box in Scene.")
            prediction = self.detector.predict(image, **self.options)[0]
            contained = []
            for detected in prediction.boxes:
                x1, y1, x2, y2 = detected.xyxy[0].cpu().tolist()
                if x1 <= point[0] * width <= x2 and y1 <= point[1] * height <= y2:
                    contained.append(
                        (
                            (x2 - x1) * (y2 - y1),
                            (x1 / width, y1 / height, x2 / width, y2 / height),
                            prediction.names[int(detected.cls[0])],
                        )
                    )
            if not contained:
                raise ValueError("No object detected here. Drag a box around it, then Select.")
            _, box, label = min(contained, key=lambda item: item[0])
        box = valid_box(box)
        if (box[2] - box[0]) * width < 12 or (box[3] - box[1]) * height < 12:
            raise ValueError("Choose a larger object rectangle.")
        reference = Reference(image, box)
        pixels = np.array([[box[0] * width, box[1] * height, box[2] * width, box[3] * height]])
        self.visual.predict(
            image,
            refer_image=image,
            visual_prompts={"bboxes": pixels, "cls": np.array([0])},
            predictor=YOLOEVPSegPredictor,
            **self.options,
        )
        embedding = self.visual.model.pe.detach().clone()
        scene = MemoryTracker(
            image, box, backend=self.segmentation, reference=reference, appearance=self.appearance
        )
        token = self.sessions.add(
            {
                "reference": reference,
                "embedding": embedding,
                "label": label,
                "scene": scene,
                "target": None,
                "stream": None,
                "cross_acquisition": CrossCameraAcquisition(
                    reference,
                    scene.outputs["cond_frame_outputs"][0],
                    self.segmentation,
                    self.appearance,
                ),
                "view_acquisition": (
                    ViewAcquisition(
                        image,
                        box,
                        reference,
                        self.correspondence,
                        self.segmentation,
                        source_memory=scene.outputs["cond_frame_outputs"][0],
                    )
                    if getattr(self, "correspondence", None) is not None
                    else None
                ),
                "view_search": getattr(self, "correspondence", None) is not None,
                "context_acquisition": ContextAcquisition.create(
                    image, box, reference, scene.outputs["cond_frame_outputs"][0], self.segmentation
                ),
            }
        )
        self.active = token
        return {"token": token, "box": list(box), "label": label}

    def track(self, token, image):
        selected = self.sessions.get(token)
        if selected.get("kind") == "person":
            return self.update_person(selected["scene"], image)
        result = selected["scene"].update(image)
        if result["status"] == "matched":
            return result
        if selected["scene"].active or selected["scene"].recovering:
            return result
        acquired = self.find(token, image)
        if acquired["status"] == "matched":
            try:
                selected["scene"] = MemoryTracker(
                    image,
                    acquired["box"],
                    backend=self.segmentation,
                    reference=selected["reference"],
                    appearance=self.appearance,
                )
            except ValueError:
                return {"status": "searching"}
        return acquired

    @staticmethod
    def reset_acquisitions(selected):
        selected["view_search"] = selected.get("view_acquisition") is not None
        for name in ("context_acquisition", "cross_acquisition", "view_acquisition"):
            if selected.get(name) is not None:
                selected[name].reset()

    def match(self, token, image, stream=0):
        selected = self.sessions.get(token)
        if selected.get("kind") == "person":
            if selected["stream"] != stream:
                if selected["target"].local_anchor is not None:
                    selected["target"].lost = True
                    return selected["target"].unavailable()
                selected["target"] = selected["identity"].new_view()
                selected["stream"] = stream
            return self.update_person(selected["target"], image)
        try:
            if selected["stream"] != stream:
                selected["target"] = None
                selected["stream"] = stream
                self.reset_acquisitions(selected)
            tracker = selected["target"]
            if tracker is not None:
                result = tracker.update(image)
                if result["status"] == "matched":
                    return result
                if tracker.active or tracker.recovering:
                    return result
            context_result = None
            context = selected.get("context_acquisition")
            view = selected.get("view_acquisition")
            use_view = view is not None and selected.get("view_search", False)
            if context is not None and not use_view:
                result = context.update(image)
                if result["status"] == "matched":
                    self.reset_acquisitions(selected)
                    acquisition = result.pop("acquisition")
                    try:
                        selected["target"] = MemoryTracker(
                            image,
                            result["box"],
                            backend=self.segmentation,
                            reference=selected["reference"],
                            appearance=self.appearance,
                            acquisition=acquisition,
                        )
                    except ValueError:
                        return {"status": "searching"}
                    return result
                context_result = result
            if use_view:
                quality = selected["cross_acquisition"]
                confirming = view.pending is not None or quality.pending is not None
                # Give verified evidence a direct confirmation pass. Otherwise
                # retain cheap global matching before cross-view models.
                result = (
                    {"status": "searching"}
                    if confirming
                    else self.find(token, image, True, proposals=False)
                )
                if result["status"] == "searching":
                    prediction = self.detector.predict(image, **self.options)[0]
                    candidates = self.candidates(prediction, image)
                    if view.pending is None:
                        # Reuse proposals for existing quality verification before
                        # spending time on learned cross-view correspondence.
                        result = quality.update(image, candidates, time.monotonic() + 0.25)
                    if result["status"] == "searching" and quality.pending is None:
                        result = view.update(image, candidates)
                # An unsuccessful confirmation must leave a turn for legacy
                # acquisition, even if another pending candidate was seeded.
                selected["view_search"] = (
                    view.pending is not None or quality.pending is not None
                ) and not confirming
            else:
                result = self.find(token, image, True)
                # If learned evidence fails, give the older quality/context path
                # a turn. Its pending confirmation takes precedence over a retry.
                selected["view_search"] = (
                    result["status"] == "searching"
                    and view is not None
                    and selected["cross_acquisition"].pending is None
                    and (context is None or context.pending is None)
                )
            if result["status"] == "matched":
                self.reset_acquisitions(selected)
                acquisition = result.pop("acquisition", None)
                try:
                    selected["target"] = MemoryTracker(
                        image,
                        result["box"],
                        backend=self.segmentation,
                        reference=selected["reference"],
                        appearance=self.appearance,
                        acquisition=acquisition,
                    )
                except ValueError:
                    return {"status": "searching"}
            if result["status"] == "searching" and context_result is not None:
                return context_result
            return result
        except Exception:
            self.reset_acquisitions(selected)
            raise

    def update_person(self, view, image):
        people = self.detect_people(image)
        descriptors = self.person_appearance.describe(
            [crop(image, person.box) for person in people]
        )
        return view.update(people, descriptors, time.monotonic())

    def find(self, token, image, cross_camera=False, *, proposals=True):
        selected = self.sessions.get(token)
        acquisition = selected.get("cross_acquisition") if cross_camera else None

        def ordinary(result):
            if acquisition is not None:
                acquisition.reset()
            return result

        try:
            deadline = time.monotonic() + 0.25
            # Reacquisition must use the user's immutable selection. Recent temporal
            # crops can be contaminated by drift, even when a model score stays high.
            reference = selected["reference"]
            # Try cheap global corroboration first. Proposal inference and dense
            # searches must not multiply across every reference and candidate.
            result = choose_match(
                reference, image, [Candidate((0, 0, 1, 1), 0.0)], deadline=deadline
            )
            if result["status"] != "searching":
                return ordinary(result)
            if time.monotonic() >= deadline:
                return ordinary({"status": "searching"})
            result = choose_appearance(reference, image)
            if result["status"] == "matched":
                # Dense search compares the crop interior. A clipped or different
                # perimeter can fail the full-reference check required to start a
                # track; rejecting it here lets independent proposals run.
                if confirm_region(reference, image, result["box"])["status"] != "matched":
                    result = {"status": "searching"}
            if result["status"] != "searching":
                return ordinary(result)
            if time.monotonic() >= deadline:
                return ordinary({"status": "searching"})
            if not proposals:
                return ordinary({"status": "searching"})
            if self.active != token:
                self.visual.set_classes(["selected object"], selected["embedding"])
                self.active = token
            prediction = self.visual.predict(image, **self.options)[0]
            generic = False
            if (
                acquisition is not None
                and self.appearance is not None
                and len(prediction.boxes) == 0
            ):
                # Severe query blur can suppress visual-prompt detections entirely.
                # Generic detections propose locations only; original Scene
                # evidence still has to independently verify each candidate.
                if time.monotonic() >= deadline:
                    return ordinary({"status": "searching"})
                prediction = self.detector.predict(image, **self.options)[0]
                generic = True
            candidates = self.candidates(prediction, image)
            if generic:
                return acquisition.update(image, candidates, deadline)
            result = choose_match(reference, image, candidates, deadline=deadline)
            if result["status"] == "searching" and acquisition is not None:
                return acquisition.update(image, candidates, deadline)
            return ordinary(result)
        except Exception:
            if acquisition is not None:
                acquisition.reset()
            raise

    @staticmethod
    def candidates(prediction, image):
        height, width = image.shape[:2]
        candidates = []
        for detected in prediction.boxes:
            x1, y1, x2, y2 = detected.xyxy[0].cpu().tolist()
            box = tuple(
                max(0, min(1, value))
                for value in (x1 / width, y1 / height, x2 / width, y2 / height)
            )
            if box[2] > box[0] and box[3] > box[1]:
                candidates.append(Candidate(box, float(detected.conf[0])))
        return candidates

    def expire(self):
        self.sessions.expire()
        if self.active not in self.sessions.items and hasattr(self, "visual"):
            self.active = None
            self.visual.predictor = None
            self.detector.predictor = None

    def clear(self, token):
        self.sessions.clear(token)
        self.expire()
