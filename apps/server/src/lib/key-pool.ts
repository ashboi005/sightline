/**
 * API-key rotation for providers with tight per-key quotas (Gemini: requests per minute AND per day, per Google
 * Cloud project — so each key must come from a different project).
 *
 * Cooldowns are per key AND per model (Gemini quotas are per model per project: an exhausted notes model must not
 * bench the key for the caption model):
 *  - round-robin per call across healthy keys, so the per-minute quota is spread instead of burning one key to 429;
 *  - a key that fails cools down and the same request retries on the next key at once:
 *      429 per-minute  → Google's RetryInfo.retryDelay, or 60 s
 *      429 per-day     → 1 h (re-probed hourly; the daily quota resets at midnight Pacific)
 *      401/403/invalid → 10 min, every model (bad or revoked key; logged loudly)
 *      5xx             → 5 s (usually model overload: one quick hop to another key)
 *  - when every key is cooling the caller falls back (Gemini → the same model through Merge).
 */

export interface PooledKey {
  key: string;
  /** "gemini#2", for logs. Never log the key itself. */
  label: string;
  /** model → cooldown. "*" applies to every model (e.g. an invalid key). */
  cooling: Map<string, { until: number; reason: string }>;
  uses: number;
  failures: number;
}

export interface Cooldown {
  ms: number;
  reason: string;
  /** Applies to every model on this key (bad key) rather than just the one that failed. */
  allModels?: boolean;
}

function coolingFor(k: PooledKey, model: string, now: number) {
  for (const scope of [model, "*"]) {
    const c = k.cooling.get(scope);
    if (c && c.until > now) return c;
  }
  return null;
}

export class KeyPool {
  private cursor = 0;
  readonly keys: PooledKey[];

  constructor(
    readonly provider: string,
    keys: (string | undefined)[],
  ) {
    const unique = [...new Set(keys.map((k) => k?.trim()).filter((k): k is string => !!k))];
    this.keys = unique.map((key, i) => ({ key, label: `${provider}#${i + 1}`, cooling: new Map(), uses: 0, failures: 0 }));
  }

  get size() {
    return this.keys.length;
  }

  /** The next key healthy for `model`, round-robin, skipping `exclude`. null when all are cooling. */
  next(model: string, exclude: Set<PooledKey> = new Set()): PooledKey | null {
    const now = Date.now();
    for (let n = 0; n < this.keys.length; n++) {
      const idx = (this.cursor + n) % this.keys.length;
      const k = this.keys[idx]!;
      if (exclude.has(k) || coolingFor(k, model, now)) continue;
      this.cursor = (idx + 1) % this.keys.length;
      k.uses++;
      return k;
    }
    return null;
  }

  cool(k: PooledKey, model: string, c: Cooldown) {
    k.cooling.set(c.allModels ? "*" : model, { until: Date.now() + c.ms, reason: c.reason });
    k.failures++;
    console[c.allModels ? "error" : "warn"](`[llm] ${k.label}${c.allModels ? "" : ` (${model})`} cooling ${Math.round(c.ms / 1000)}s: ${c.reason}`);
  }

  status() {
    const now = Date.now();
    return this.keys.map((k) => ({
      label: k.label,
      uses: k.uses,
      failures: k.failures,
      cooling: [...k.cooling].filter(([, c]) => c.until > now).map(([model, c]) => ({ model, inSec: Math.round((c.until - now) / 1000), reason: c.reason })),
    }));
  }
}

/** The cooldown for a failed request from its HTTP status and (Gemini) error body; null = not the key's fault. */
export function cooldownFor(status: number, body: string): Cooldown | null {
  if (status === 429) {
    if (/PerDay/i.test(body)) return { ms: 60 * 60_000, reason: "daily quota exhausted" };
    const delay = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
    const ms = delay ? Math.ceil(Number(delay[1]) * 1000) + 500 : 60_000;
    return { ms: Math.min(ms, 10 * 60_000), reason: "rate limited" };
  }
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|API key not valid|valid API key/i.test(body))) {
    return { ms: 10 * 60_000, reason: `auth failed (${status}), check this key`, allModels: true };
  }
  if (status >= 500) return { ms: 5_000, reason: `server error ${status}` };
  return null;
}

/** HTTP status + body from an AI SDK APICallError (possibly wrapped in `cause`), or null for non-HTTP failures. */
export function httpFailure(error: unknown): { status: number; body: string } | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { statusCode?: unknown; status?: unknown; responseBody?: unknown; cause?: unknown };
    const status = typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : null;
    if (status) return { status, body: typeof e.responseBody === "string" ? e.responseBody : "" };
    current = e.cause;
  }
  return null;
}
