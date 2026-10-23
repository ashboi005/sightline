from sign_service.decoding import PhraseDecoder
from sign_service.types import Prediction


def feed(decoder, gloss, kind="FINGERSPELL", count=None, start=0, confidence=0.9):
    count = (11 if kind == "FINGERSPELL" else 4) if count is None else count
    messages = []
    for i in range(count):
        observation = start + i
        messages += decoder.prediction(
            Prediction(gloss, confidence, kind), observation, 1000 + observation * 100
        )
    return messages


def spelling(decoder):
    return "".join(letter for letter, _ in decoder.letters)


def test_forming_a_sign_does_not_commit_a_short_lived_wrong_letter():
    decoder = PhraseDecoder()
    feed(decoder, "C", count=8)
    assert spelling(decoder) == ""
    messages = feed(decoder, "A", start=8)
    assert spelling(decoder) == "A"
    assert messages[-1]["acceptedGloss"] == "A"
    assert messages[-1]["gloss"] == "A"


def test_different_letters_need_no_hands_down_between_them():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    feed(decoder, "B", start=11)
    feed(decoder, "A", start=22)
    assert spelling(decoder) == "ABA"


def test_held_letter_is_once_but_release_allows_double_letter():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    feed(decoder, "A", start=11, count=30)
    assert spelling(decoder) == "A"
    decoder.hands(0, 5, 5000)
    decoder.hands(1, 5.3, 5300)
    feed(decoder, "A", start=44)
    decoder.hands(0, 7, 7000)
    messages = decoder.hands(0, 8.1, 8100)
    assert [m["token"]["gloss"] for m in messages if m["type"] == "sign.token"] == ["AA"]
    assert messages[-1]["tokenIds"] == [messages[0]["token"]["id"]]
    assert decoder.hands(0, 9.2, 9200) == []


def test_brief_tracking_dropout_does_not_duplicate_a_held_letter():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    decoder.hands(0, 2, 2000)
    decoder.hands(1, 2.08, 2080)
    feed(decoder, "A", start=12)
    assert spelling(decoder) == "A"


def test_movement_abstention_restarts_the_whole_hold():
    decoder = PhraseDecoder()
    feed(decoder, "A", count=8)
    decoder.prediction(None, 8, 1800)
    feed(decoder, "A", count=8, start=9)
    assert spelling(decoder) == ""
    feed(decoder, "A", count=3, start=17)
    assert spelling(decoder) == "A"


def test_missing_frames_cannot_count_as_a_continuous_hold():
    decoder = PhraseDecoder()
    feed(decoder, "A", count=4)
    feed(decoder, "A", count=4, start=10)
    assert spelling(decoder) == ""
    feed(decoder, "A", count=7, start=14)
    assert spelling(decoder) == "A"


def test_cached_observation_cannot_complete_a_letter_hold():
    decoder = PhraseDecoder()
    decoder.prediction(Prediction("A", 0.9, "FINGERSPELL"), 1, 1000)
    for ts in range(1100, 2500, 100):
        decoder.prediction(Prediction("A", 0.9, "FINGERSPELL"), 1, ts)
    assert spelling(decoder) == ""


def test_partial_separates_accepted_letters_from_candidate_and_clears_on_motion():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    messages = feed(decoder, "B", count=1, start=11)
    assert messages[-1]["gloss"] == "AB"
    assert messages[-1]["acceptedGloss"] == "A"
    messages = decoder.prediction(None, 12, 2200)
    assert messages[-1]["gloss"] == "A"
    assert messages[-1]["acceptedGloss"] == "A"


def test_arbitrary_spelling_flushes_before_lexical_sign():
    decoder = PhraseDecoder()
    for i, letter in enumerate("XYZ"):
        feed(decoder, letter, start=i * 11)
    messages = feed(decoder, "PLEASE", "SIGN", start=33)
    tokens = [m["token"] for m in messages if m["type"] == "sign.token"]
    assert [(t["gloss"], t["kind"]) for t in tokens] == [("XYZ", "FINGERSPELL"), ("PLEASE", "SIGN")]
    assert all(t["confidence"] == 0.9 for t in tokens)


def test_cached_observation_never_becomes_stable():
    decoder = PhraseDecoder()
    messages = []
    for _ in range(12):
        messages += decoder.prediction(Prediction("PLEASE", 0.9, "SIGN"), 7, 1000)
    assert not any(m["type"] == "sign.token" for m in messages)


def test_reset_discards_spelling_and_pending_phrase():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    decoder.reset()
    decoder.hands(0, 0, 1000)
    assert decoder.hands(0, 2, 3000) == []


def test_low_confidence_and_unknown_predictions_break_stability():
    decoder = PhraseDecoder()
    feed(decoder, "PLEASE", "SIGN", count=3)
    decoder.prediction(None, 3, 1300)
    messages = feed(decoder, "PLEASE", "SIGN", count=1, start=4)
    messages += feed(decoder, "WHAT", "SIGN", count=2, start=5)
    assert not any(m["type"] == "sign.token" for m in messages)


def test_stable_model_blank_rearms_a_repeated_letter_without_ending_phrase():
    decoder = PhraseDecoder()
    feed(decoder, "A")
    messages = feed(decoder, "blank", "BLANK", start=11)
    assert not any(message["type"] in {"sign.token", "phrase.end"} for message in messages)
    feed(decoder, "A", start=15)
    decoder.hands(0, 4, 4000)
    messages = decoder.hands(0, 5.1, 5100)
    assert [m["token"]["gloss"] for m in messages if m["type"] == "sign.token"] == ["AA"]


def test_backend_language_decoding_emits_words_and_keeps_raw_confidence():
    from sign_service.spelling_language import RepeatAwareEnglishDecoder

    language = RepeatAwareEnglishDecoder({"open": 1000, "the": 5000, "book": 2000})
    decoder = PhraseDecoder(fingerspell_threshold=0.15, spelling_decoder=language.decode)
    for index, letter in enumerate("OPENTHEBOK"):
        feed(decoder, letter, start=index * 11, confidence=0.2)
    decoder.hands(0, 12, 12000)
    messages = decoder.hands(0, 13.1, 13100)
    tokens = [m["token"] for m in messages if m["type"] == "sign.token"]
    assert [t["gloss"] for t in tokens] == ["OPEN", "THE", "BOOK"]
    assert all(t["confidence"] == 0.2 for t in tokens)
    assert decoder.spelling_results[-1].raw_letters == "OPENTHEBOK"
    assert messages[-1]["tokenIds"] == [t["id"] for t in tokens]


def test_accepted_partial_preserves_minimum_confidence_over_the_hold():
    decoder = PhraseDecoder(fingerspell_threshold=0.15)
    messages = []
    for index in range(11):
        messages += decoder.prediction(
            Prediction("A", 0.2 if index == 0 else 0.9, "FINGERSPELL"),
            index, 1000 + index * 100,
        )
    assert messages[-1]["acceptedGloss"] == "A"
    assert messages[-1]["confidence"] == 0.2
    decoder.hands(0, 3, 3000)
    tokens = decoder.hands(0, 4.1, 4100)
    assert tokens[0]["token"]["confidence"] == 0.2
