from sign_service.spelling_language import RepeatAwareEnglishDecoder


def test_generic_repeat_restoration_and_word_segmentation():
    decoder = RepeatAwareEnglishDecoder(
        {"open": 1000, "the": 5000, "book": 2000, "hello": 1000, "world": 1000, "coffee": 1000}
    )
    assert decoder.decode("OPENTHEBOK").text == "OPEN THE BOOK"
    assert decoder.decode("HELOWORLD").text == "HELLO WORLD"
    assert decoder.decode("COFE").text == "COFFEE"


def test_visual_letters_are_preserved_and_correction_is_reported():
    decoder = RepeatAwareEnglishDecoder({"book": 1000, "look": 500})
    result = decoder.decode("BOK")
    assert result.raw_letters == "BOK"
    assert result.letters == "BOOK"
    assert result.used_language_model
    assert decoder.decode("BOOK").letters == "BOOK"


def test_unknown_spelling_and_nonrepeat_errors_are_not_replaced():
    decoder = RepeatAwareEnglishDecoder({"open": 1000, "the": 5000, "book": 2000})
    assert decoder.decode("XYZQ").letters == "XYZQ"
    assert decoder.decode("OPENTHEXOK").letters == "OPENTHEXOK"
