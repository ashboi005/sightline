/**
 * OWNER: Ashwath. Detects when the teacher is talking about something visual, so the web app can grab the
 * scene frame. Pure + cheap: runs on every refined caption. English and Hinglish phrasings.
 */

const CUES: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(look|see|notice|observe)\s+(at\s+)?(this|that|the|here)\b/i, label: "look at this" },
  { pattern: /\bas you can see\b/i, label: "as you can see" },
  { pattern: /\b(let me|i'?ll|i will|i'?m going to)\s+(draw|sketch|write|show)\b/i, label: "teacher is drawing" },
  { pattern: /\b(on|at) the (board|screen|slide)\b/i, label: "on the board" },
  { pattern: /\b(this|that|the following|the above|the below)\s+(diagram|figure|graph|circuit|chart|plot|table|picture|drawing|equation|derivation)\b/i, label: "diagram" },
  { pattern: /\bhere (we have|you can see|is the)\b/i, label: "here we have" },
  // Hinglish (Roman + Devanagari)
  { pattern: /\b(board|screen)\s*(pe|par|mein)\b/i, label: "board pe" },
  { pattern: /\b(yahan|idhar|isko|ise|ye|yeh)\s+(dekho|dekhiye|dekhte)\b/i, label: "yahan dekho" },
  { pattern: /\b(is|ye|yeh)\s+(diagram|figure|graph|circuit)\b/i, label: "is diagram" },
  { pattern: /(बोर्ड|यहाँ देखो|इधर देखो|ये देखो|डायग्राम|चित्र)/, label: "board (hi)" },
];

export function detectVisualCue(text: string): string | null {
  for (const cue of CUES) if (cue.pattern.test(text)) return cue.label;
  return null;
}

/** At most one cue-triggered snapshot per session every `cooldownMs`. */
export class CueCooldown {
  private readonly last = new Map<string, number>();

  constructor(private readonly cooldownMs = 20_000) {}

  allow(sessionId: string, now = Date.now()): boolean {
    const prev = this.last.get(sessionId);
    if (prev !== undefined && now - prev < this.cooldownMs) return false;
    this.last.set(sessionId, now);
    return true;
  }
}
