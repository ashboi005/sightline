import numpy as np
import pytest

from nanotrack import NanoTracker


class NetworkBoundary:
    def __init__(self, outputs=None):
        self.outputs = outputs

    def setInput(self, *args):
        pass

    def forward(self, *args):
        return self.outputs if self.outputs else np.zeros((1, 96, 8, 8), np.float32)


def tracker(monkeypatch, column=7, bad=None):
    cls = np.full((1, 2, 15, 15), -10, np.float32)
    cls[:, 0] = 10
    cls[0, 0, 7, column] = -10
    cls[0, 1, 7, column] = 10
    loc = np.full((1, 4, 15, 15), 31.75, np.float32)
    if bad == "shape":
        cls = cls[:, :, :14, :]
    if bad == "nan":
        loc[0, 0, 0, 0] = np.nan
    nets = iter([NetworkBoundary(), NetworkBoundary((cls, loc))])
    monkeypatch.setattr("nanotrack.cv2.dnn.readNet", lambda *args: next(nets))
    result = NanoTracker()
    image = np.full((240, 320, 3), 100, np.uint8)
    result.init(image, (50, 50, 40, 40))
    return result, image


def test_native_15_by_15_center_and_offset_use_search_scale(monkeypatch):
    nano, image = tracker(monkeypatch)
    assert nano.update(image)[1] == (50, 50, 40, 40)
    assert nano.getTrackingScore() > 0.99
    nano, image = tracker(monkeypatch, column=8)
    assert nano.update(image)[1] == (60, 50, 40, 40)


@pytest.mark.parametrize("bad", ["shape", "nan"])
def test_invalid_dnn_outputs_are_rejected(monkeypatch, bad):
    nano, image = tracker(monkeypatch, bad=bad)
    with pytest.raises(RuntimeError, match="invalid model output"):
        nano.update(image)


def test_search_near_boundary_pads_crop_and_clips_center_and_size(monkeypatch):
    nano, image = tracker(monkeypatch, column=6)
    nano.center = np.array([0.0, 0.0])
    ok, pixels = nano.update(image)
    assert ok and np.all(nano.center >= 0)
    assert np.all(nano.size <= [320, 240])
    assert pixels[2:] == (40, 40)
