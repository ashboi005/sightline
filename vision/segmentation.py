"""Pinned SAM 2.1 Tiny inference for one frame and an explicit camera memory.

The streaming step follows Meta's Apache-2.0 SAM2Base.track_step, exposing
mask quality and keeping memory ownership outside the shared model. See NOTICE.md.
"""

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import torch
from hydra.utils import instantiate
from omegaconf import OmegaConf
from sam2.utils.transforms import SAM2Transforms

from prepare import MODELS


@dataclass
class MaskPrediction:
    box: list | None
    presence: float
    quality: float
    memory: dict


class SegmentationModel:
    def __init__(self, device):
        self.device = device
        config = OmegaConf.load(Path(__file__).with_name("configs") / "sam2_tiny.yaml")
        # Compared 1024/512/384 on M1 Pro. Mixed-precision 512 preserves
        # clothing detail while keeping regular two-camera requests fresh.
        config.model.image_size = 512
        self.model = instantiate(config.model, _recursive_=True)
        weights = torch.load(MODELS / "sam2.1_hiera_tiny.pt", map_location="cpu", weights_only=True)
        self.model.load_state_dict(weights["model"], strict=True)
        self.model = self.model.to(device).eval()
        self.transform = SAM2Transforms(resolution=512, mask_threshold=0)

    @staticmethod
    def similarity(candidate, anchor):
        # The SAM mask token already participates in object memory attention.
        # Its cosine is supplementary evidence, not identity probability.
        a = candidate["obj_ptr"].float().flatten()
        b = anchor["obj_ptr"].float().flatten()
        return float(torch.nn.functional.cosine_similarity(a, b, dim=0).clamp(-1, 1).item())

    @torch.inference_mode()
    def predict(self, image, box, index, outputs):
        # MPS mixed precision was measured on all six replay cases. Keep CPU
        # inference in float32; positional encodings retain their native dtype.
        with torch.autocast(self.device, dtype=torch.float16, enabled=self.device == "mps"):
            return self._predict(image, box, index, outputs)

    def _predict(self, image, box, index, outputs):
        tensor = self.transform(cv2.cvtColor(image, cv2.COLOR_BGR2RGB)).to(self.device)[None]
        _, features, positions, sizes = self.model._prepare_backbone_features(
            self.model.forward_image(tensor)
        )
        points = None
        if box is not None:
            x1, y1, x2, y2 = np.asarray(box) * self.model.image_size
            points = {
                "point_coords": torch.tensor(
                    [[[x1, y1], [x2, y2]]], dtype=torch.float32, device=self.device
                ),
                "point_labels": torch.tensor([[2, 3]], dtype=torch.int64, device=self.device),
            }
        memory, sam, _, _ = self.model._track_step(
            index,
            index == 0,
            features,
            positions,
            sizes,
            points,
            None,
            outputs,
            index + 1,
            False,
            None,
        )
        _, _, quality, low, high, pointer, object_logits = sam
        memory.update(pred_masks=low, obj_ptr=pointer, object_score_logits=object_logits)
        self.model._encode_memory_in_output(
            features, sizes, points, True, high, object_logits, memory
        )
        # Large images and backbone features are transient, never stored per frame.
        logits = high[0, 0].float().cpu().numpy()
        height, width = image.shape[:2]
        mask = cv2.resize(logits, (width, height), interpolation=cv2.INTER_LINEAR) > 0
        ys, xs = np.where(mask)
        tracked_box = None
        if len(xs):
            tracked_box = [
                float(xs.min() / width),
                float(ys.min() / height),
                float((xs.max() + 1) / width),
                float((ys.max() + 1) / height),
            ]
        return MaskPrediction(
            tracked_box,
            float(object_logits.sigmoid().item()),
            float(quality.max().item()),
            memory,
        )
