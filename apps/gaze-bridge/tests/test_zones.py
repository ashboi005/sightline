from gaze_bridge.server import DEFAULT_TARGETS
from gaze_bridge.tracker import TrackerSample
from gaze_bridge.zones import Debouncer, ZoneClassifier, ZoneReading

classifier = ZoneClassifier(list(DEFAULT_TARGETS))


def zone(**kw):
    r = classifier.classify(TrackerSample(**kw))
    return r.zone, r.target_id


def test_screen_board_person_away_unknown():
    assert zone(screen=(0.5, 0.5), yaw=0, pitch=-20) == ("SCREEN", None)
    assert zone(screen=(1.03, 0.5)) == ("SCREEN", None)  # inside margin
    assert zone(yaw=3, pitch=12) == ("BOARD", "teacher")
    assert zone(yaw=-44, pitch=0) == ("PERSON", "peer_left")
    assert zone(yaw=48, pitch=0) == ("PERSON", "peer_right")
    assert zone(yaw=-80, pitch=0) == ("AWAY", None)
    assert zone(yaw=0, pitch=0) == ("PERSON", "teacher")
    assert zone(eye="BLINK", screen=(0.5, 0.5)) == ("UNKNOWN", None)
    assert zone(screen=(0.5, 0.5), confidence=0.1) == ("UNKNOWN", None)


def test_debounce_holds_and_ignores_blinks():
    d = Debouncer(hold_s=0.15)
    screen = ZoneReading("SCREEN", None, 0.9)
    board = ZoneReading("BOARD", "teacher", 0.9)
    assert d.update(screen, 0.0) is None
    assert d.update(screen, 0.2) == screen
    assert d.update(board, 1.0) is None
    assert d.update(ZoneReading("UNKNOWN", None, 0.1), 1.05) is None  # blink resets candidate
    assert d.update(board, 1.1) is None
    assert d.update(board, 1.2) is None
    assert d.update(board, 1.26) == board
    assert d.current == board
