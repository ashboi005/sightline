import type { GazeZone } from "@sightline/contracts";

/**
 * Deaf-mode caption pausing. The server never pauses anything: this decides, from gaze zones and the student's
 * own controls, whether the caption feed scrolls live or holds still at a bookmark.
 *
 *  LIVE      auto-scroll follows the newest caption
 *  AWAY      the student looked at the board, a person or away: scroll frozen, new lines collected after the bookmark
 *  CATCH_UP  back on the screen with missed lines: they stay highlighted until the student chooses "Resume live"
 *  MANUAL    paused by the student (or by scrolling up), e.g. when tracking isn't available
 *
 * `bookmarkSeq` is the seq of the last caption on screen when the student left; everything after it is "missed".
 */
export type PauseState =
  | { kind: "LIVE" }
  | { kind: "AWAY"; bookmarkSeq: number; since: number }
  | { kind: "CATCH_UP"; bookmarkSeq: number }
  | { kind: "MANUAL"; bookmarkSeq: number };

export type PauseEvent =
  /** A zone change from the gaze bridge. `lastSeq` = seq of the newest committed caption (-1 if none). */
  | { type: "gaze"; zone: GazeZone; lastSeq: number; ts: number }
  | { type: "pause"; lastSeq: number }
  | { type: "resume" };

export const LIVE: PauseState = { kind: "LIVE" };

const isAwayZone = (zone: GazeZone) => zone === "BOARD" || zone === "PERSON" || zone === "AWAY";

export function pauseReducer(state: PauseState, event: PauseEvent): PauseState {
  switch (event.type) {
    case "resume":
      return LIVE;
    case "pause":
      return state.kind === "LIVE" ? { kind: "MANUAL", bookmarkSeq: event.lastSeq } : state;
    case "gaze": {
      if (event.zone === "UNKNOWN") return state; // a blink or lost tracking is not a decision
      if (isAwayZone(event.zone)) {
        if (state.kind === "LIVE") return { kind: "AWAY", bookmarkSeq: event.lastSeq, since: event.ts };
        // Looking away again while catching up keeps the original bookmark, so nothing missed is dropped.
        if (state.kind === "CATCH_UP") return { kind: "AWAY", bookmarkSeq: state.bookmarkSeq, since: event.ts };
        return state;
      }
      // SCREEN
      if (state.kind !== "AWAY") return state;
      return event.lastSeq > state.bookmarkSeq ? { kind: "CATCH_UP", bookmarkSeq: state.bookmarkSeq } : LIVE;
    }
  }
}

export const isFrozen = (state: PauseState) => state.kind !== "LIVE";

export const bookmarkOf = (state: PauseState) => (state.kind === "LIVE" ? null : state.bookmarkSeq);

/** How many committed captions arrived after the bookmark. */
export function missedCount(state: PauseState, seqs: number[]) {
  const bookmark = bookmarkOf(state);
  return bookmark === null ? 0 : seqs.filter((seq) => seq > bookmark).length;
}
