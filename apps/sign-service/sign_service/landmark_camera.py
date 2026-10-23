"""Direct backend webcam test using the production alphabet/English decoder."""

import argparse
import time

import cv2

from .alphabet_recognizer import AlphabetRecognizer
from .decoding import PhraseDecoder
from .landmark_pipeline import LandmarkPipeline
from .types import continuity_gap_ms


def run(args):
    pipeline = LandmarkPipeline()
    capture = recognizer = None
    try:
        pipeline.ensure_loaded()
        if pipeline.load_error:
            raise RuntimeError(pipeline.load_error)
        recognizer = AlphabetRecognizer(pipeline)
        if recognizer.load_error:
            raise RuntimeError(recognizer.load_error)
        decoder = PhraseDecoder(
            fingerspell_threshold=recognizer.confidence_threshold,
            spelling_decoder=recognizer.spelling_decoder,
            max_evidence_gap_ms=continuity_gap_ms(args.fps),
        )
        recognizer.configure_frame_rate(args.fps)
        capture = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
        if not capture.isOpened():
            capture.release()
            capture = cv2.VideoCapture(args.camera)
        if not capture.isOpened():
            raise RuntimeError(f"Cannot open camera {args.camera}; close other camera apps")
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)
        paused = False
        sequence = 0
        last_tracking = None
        last_text = last_raw = "-"
        print(f"[ready] {pipeline.model_name}; CPU; one alphabet classifier", flush=True)
        print(
            "One hand anywhere in view. Hold each letter still for about 1 second; lower hand for 1s to finish.",
            flush=True,
        )
        print(
            "Raw letters and backend-decoded text are shown separately. R reset; S pause; Q quit.",
            flush=True,
        )
        while True:
            started = time.monotonic()
            ok, image = capture.read()
            if not ok or image is None:
                raise RuntimeError("Camera returned an empty frame")
            image = cv2.resize(image, (args.width, args.height))
            prediction = None
            hands = 0
            if not paused:
                encoded, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
                if not encoded:
                    raise RuntimeError("JPEG encoding failed")
                sequence += 1
                ts = time.time_ns() // 1_000_000
                tracked = recognizer.track(jpeg.tobytes(), ts)
                hands = tracked.hands_detected
                tracking = (hands, recognizer.extractor.detection_mode)
                if tracking != last_tracking:
                    print(f"[tracking] hands={hands} input={tracking[1]}", flush=True)
                    last_tracking = tracking
                messages = decoder.hands(hands, time.monotonic(), ts)
                if tracked.observation is not None:
                    evidence = recognizer.predict(tracked.observation)
                    prediction = evidence.prediction
                    messages += decoder.prediction(prediction, evidence.observation, ts)
                for message in messages:
                    if message["type"] == "phrase.end" and decoder.spelling_results:
                        result = decoder.spelling_results[-1]
                        last_raw, last_text = result.raw_letters, result.text
                        print(
                            f"[phrase] raw={last_raw!r}; decoded={last_text!r}; "
                            f"language_assisted={result.used_language_model}",
                            flush=True,
                        )
            preview = cv2.flip(recognizer.extractor.draw_last_landmarks(image), 1)
            current = "".join(letter for letter, _ in decoder.letters)
            lines = [
                "Sightline: one public-data alphabet model",
                f"Hands: {hands}   {'PAUSED' if paused else 'RUNNING'}   {recognizer.extractor.detection_mode}",
                f"Letter: {prediction.gloss} ({prediction.confidence:.2f})"
                if prediction
                else "Letter: -",
                f"Accepted letters: {current or '-'}",
                f"Last raw: {last_raw}",
                f"Backend text: {last_text}",
                "Lower hand for 1s to finish. R reset / S pause / Q quit",
            ]
            for index, line in enumerate(lines):
                cv2.putText(
                    preview,
                    line,
                    (12, 26 + index * 25),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 230, 0),
                    1,
                    cv2.LINE_AA,
                )
            cv2.imshow("Sightline sign-service backend test", preview)
            wait_ms = max(1, round((1 / args.fps - (time.monotonic() - started)) * 1000))
            key = cv2.waitKey(wait_ms) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord("r"):
                decoder.reset()
                recognizer.reset()
                last_text = last_raw = "-"
            elif key == ord("s"):
                paused = not paused
                decoder.reset()
                recognizer.reset()
    finally:
        if capture is not None:
            capture.release()
        cv2.destroyAllWindows()
        if recognizer is not None:
            recognizer.close()
        pipeline.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=480)
    parser.add_argument("--fps", type=int, choices=range(1, 31), default=12)
    args = parser.parse_args()
    if args.width < 32 or args.height < 32:
        parser.error("camera dimensions must be at least 32")
    try:
        run(args)
    except KeyboardInterrupt:
        pass
    except Exception as error:
        parser.exit(1, f"camera test error: {error}\n")


if __name__ == "__main__":
    main()
