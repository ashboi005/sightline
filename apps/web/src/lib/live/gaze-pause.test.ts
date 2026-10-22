import { describe, expect, test } from "bun:test";

import { LIVE, missedCount, pauseReducer, type PauseState } from "./gaze-pause";

const gaze = (zone: "SCREEN" | "BOARD" | "PERSON" | "AWAY" | "UNKNOWN", lastSeq: number) =>
  ({ type: "gaze", zone, lastSeq, ts: 1000 }) as const;

describe("gaze pause", () => {
  test("looking at the board freezes at the last caption on screen", () => {
    expect(pauseReducer(LIVE, gaze("BOARD", 4))).toEqual({ kind: "AWAY", bookmarkSeq: 4, since: 1000 });
  });

  test("blinks (UNKNOWN) never change state", () => {
    const away: PauseState = { kind: "AWAY", bookmarkSeq: 4, since: 1 };
    expect(pauseReducer(LIVE, gaze("UNKNOWN", 9))).toBe(LIVE);
    expect(pauseReducer(away, gaze("UNKNOWN", 9))).toBe(away);
  });

  test("returning with missed lines waits for Resume live", () => {
    const away = pauseReducer(LIVE, gaze("PERSON", 4));
    const back = pauseReducer(away, gaze("SCREEN", 7));
    expect(back).toEqual({ kind: "CATCH_UP", bookmarkSeq: 4 });
    expect(missedCount(back, [3, 4, 5, 6, 7])).toBe(3);
    expect(pauseReducer(back, { type: "resume" })).toBe(LIVE);
  });

  test("returning before anything new was said goes straight back to live", () => {
    const away = pauseReducer(LIVE, gaze("AWAY", 4));
    expect(pauseReducer(away, gaze("SCREEN", 4))).toBe(LIVE);
  });

  test("looking away again while catching up keeps the first bookmark", () => {
    const catchUp: PauseState = { kind: "CATCH_UP", bookmarkSeq: 2 };
    expect(pauseReducer(catchUp, gaze("BOARD", 8))).toMatchObject({ kind: "AWAY", bookmarkSeq: 2 });
  });

  test("manual pause is kept through gaze changes until resumed", () => {
    const manual = pauseReducer(LIVE, { type: "pause", lastSeq: 5 });
    expect(manual).toEqual({ kind: "MANUAL", bookmarkSeq: 5 });
    expect(pauseReducer(manual, gaze("BOARD", 6))).toBe(manual);
    expect(pauseReducer(manual, gaze("SCREEN", 6))).toBe(manual);
    expect(pauseReducer(manual, { type: "resume" })).toBe(LIVE);
  });

  test("live state has nothing missed", () => {
    expect(missedCount(LIVE, [1, 2, 3])).toBe(0);
  });
});
