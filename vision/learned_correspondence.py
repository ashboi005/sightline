"""Local learned point correspondences; no category or identity probability."""

import copy
from dataclasses import dataclass

import cv2
import torch
from kornia.feature import LoFTR
from kornia.feature.loftr.loftr import default_cfg

from prepare import MODELS


def view_size(image):
    height, width = image.shape[:2]
    scale = 320 / max(height, width)
    return (max(8, round(width * scale / 8) * 8), max(8, round(height * scale / 8) * 8))


@dataclass(frozen=True)
class EncodedView:
    size: tuple[int, int]
    coarse_shape: tuple[int, int]
    coarse: torch.Tensor
    fine: torch.Tensor


class LearnedCorrespondence:
    def __init__(self, device):
        self.device = device
        config = copy.deepcopy(default_cfg)
        config["coarse"]["temp_bug_fix"] = True
        self.model = LoFTR(pretrained=None, config=config)
        weights = torch.load(
            MODELS / "loftr_indoor_ds_new.ckpt", map_location="cpu", weights_only=True
        )
        self.model.load_state_dict(weights["state_dict"], strict=True)
        self.model = self.model.to(device).eval()

    def tensor(self, image):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.resize(gray, view_size(image))
        gray = cv2.createCLAHE(2, (4, 4)).apply(gray)
        return torch.from_numpy(gray).to(self.device).float()[None, None] / 255

    @torch.inference_mode()
    def encode(self, image):
        with torch.autocast(self.device, dtype=torch.float16, enabled=self.device == "mps"):
            coarse, fine = self.model.backbone(self.tensor(image))
            shape = tuple(coarse.shape[2:])
            positioned = self.model.pos_encoding(coarse).permute(0, 2, 3, 1)
            coarse = positioned.reshape(1, -1, positioned.shape[-1])
        return EncodedView(view_size(image), shape, coarse, fine)

    @torch.inference_mode()
    def match_encoded(self, source, target):
        # Same coarse/fine inference stages as pinned Kornia 0.8.3's LoFTR
        # forward, with independent CNN features supplied by the caller. Only
        # pre-attention Source features can be reused across Target frames.
        data = {
            "bs": 1,
            "hw0_i": source.size[::-1],
            "hw1_i": target.size[::-1],
            "hw0_c": source.coarse_shape,
            "hw1_c": target.coarse_shape,
            "hw0_f": source.fine.shape[2:],
            "hw1_f": target.fine.shape[2:],
        }
        with torch.autocast(self.device, dtype=torch.float16, enabled=self.device == "mps"):
            a, b = self.model.loftr_coarse(source.coarse, target.coarse)
            self.model.coarse_matching(a, b, data)
            fine_a, fine_b = self.model.fine_preprocess(source.fine, target.fine, a, b, data)
            if fine_a.size(0):
                fine_a, fine_b = self.model.loftr_fine(fine_a, fine_b)
            self.model.fine_matching(fine_a, fine_b, data)
        # Mutual match/confidence filtering, geometry and foreground policy
        # remain unchanged. Cross-attention outputs are never cached.
        first = data["mkpts0_f"].float().cpu().numpy() / source.size
        second = data["mkpts1_f"].float().cpu().numpy() / target.size
        return first, second

    def match(self, source, target):
        return self.match_encoded(self.encode(source), self.encode(target))
