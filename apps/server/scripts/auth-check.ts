export {};
/**
 * End-to-end auth check against a running server with REAL auth (MOCK_AUTH=false) and Postgres.
 *   SERVER_URL=http://localhost:3000 WEB_ORIGIN=http://localhost:3001 bun run --filter server check:auth
 *
 * Exercises exactly what the browser does: CORS preflight from the web origin, better-auth email sign-up / sign-in,
 * the session cookie on /api + the session WebSocket, cross-user isolation, and sign-out invalidation.
 */
const BASE = process.env.SERVER_URL ?? "http://localhost:3000";
const ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3001";
const WS_BASE = BASE.replace(/^http/, "ws");
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Minimal cookie jar (what the browser keeps for the API origin). */
class Jar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const [name, ...value] = pair!.split("=");
      const v = value.join("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(raw) || v === "") this.cookies.delete(name!.trim());
      else this.cookies.set(name!.trim(), v);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  get size() {
    return this.cookies.size;
  }
}

async function api(jar: Jar | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(jar?.size ? { cookie: jar.header() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  jar?.store(res);
  return res;
}

function socket(jar: Jar | null, sessionId: string): Promise<{ opened: boolean; first: string | null }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}/ws/sessions/${sessionId}`, {
      headers: { origin: ORIGIN, ...(jar?.size ? { cookie: jar.header() } : {}) },
    } as never);
    let opened = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve({ opened, first: null });
    }, 3000);
    ws.onopen = () => (opened = true);
    ws.onmessage = (e) => {
      clearTimeout(timer);
      resolve({ opened, first: JSON.parse(String(e.data)).type }); // resolve before close: close can fire synchronously
      ws.close();
    };
    ws.onclose = () => {
      clearTimeout(timer);
      resolve({ opened, first: null });
    };
  });
}

const stamp = Date.now();
const alice = { name: "Alice Student", email: `alice+${stamp}@sightline.dev`, password: "correct-horse-battery-1" };
const bob = { name: "Bob Student", email: `bob+${stamp}@sightline.dev`, password: "correct-horse-battery-2" };

// 1. CORS preflight from the web app
const preflight = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "OPTIONS",
  headers: { origin: ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
});
check(
  "CORS preflight allows the web origin with credentials",
  preflight.headers.get("access-control-allow-origin") === ORIGIN && preflight.headers.get("access-control-allow-credentials") === "true",
  `${preflight.status} ${preflight.headers.get("access-control-allow-origin")}`,
);

// 2. Sign up + session cookie
const aliceJar = new Jar();
const signUp = await api(aliceJar, "POST", "/api/auth/sign-up/email", alice);
check("sign-up (email + password) → 200 + session cookie", signUp.ok && aliceJar.size > 0, `${signUp.status}, ${aliceJar.size} cookie(s)`);
const cookieAttrs = signUp.headers.getSetCookie().join(" | ");
check("session cookie is HttpOnly", /httponly/i.test(cookieAttrs));
check(
  BASE.startsWith("https") ? "cookie is Secure + SameSite=None (https)" : "cookie is SameSite=Lax over http (local dev)",
  BASE.startsWith("https") ? /secure/i.test(cookieAttrs) && /samesite=none/i.test(cookieAttrs) : /samesite=lax/i.test(cookieAttrs),
);
const duplicate = await api(new Jar(), "POST", "/api/auth/sign-up/email", alice);
check("duplicate sign-up rejected", !duplicate.ok, String(duplicate.status));

// 3. Protected routes
check("/api/me without cookie → 401", (await api(null, "GET", "/api/me")).status === 401);
const me = await api(aliceJar, "GET", "/api/me");
const meBody = (await me.json()) as { email?: string; isMock?: boolean };
check("/api/me with cookie → real user", me.ok && meBody.email === alice.email && meBody.isMock === false, meBody.email);
const getSession = await api(aliceJar, "GET", "/api/auth/get-session");
check("better-auth get-session returns the user", getSession.ok && ((await getSession.json()) as { user?: { email?: string } })?.user?.email === alice.email);

// 4. Ownership + WebSocket
const created = await api(aliceJar, "POST", "/api/sessions", { title: "Alice's lecture" });
const session = (await created.json()) as { id: string };
check("create lecture session as Alice → 201", created.status === 201, session.id);
const started = await api(aliceJar, "POST", `/api/sessions/${session.id}/start`);
check("start Alice's session → 200", started.ok, String(started.status));
const list = (await (await api(aliceJar, "GET", "/api/sessions")).json()) as { data: { id: string }[] };
check("Alice lists her session", list.data.some((s) => s.id === session.id));

const bobJar = new Jar();
await api(bobJar, "POST", "/api/auth/sign-up/email", bob);
check("Bob cannot read Alice's session → 404", (await api(bobJar, "GET", `/api/sessions/${session.id}`)).status === 404);
check("Bob's list does not include Alice's session", !((await (await api(bobJar, "GET", "/api/sessions")).json()) as { data: { id: string }[] }).data.some((s) => s.id === session.id));

const aliceWs = await socket(aliceJar, session.id);
check("Alice's WebSocket opens and receives session.ready", aliceWs.first === "session.ready", `opened=${aliceWs.opened} first=${aliceWs.first}`);
const anonWs = await socket(null, session.id);
check("anonymous WebSocket is refused", anonWs.first !== "session.ready", `opened=${anonWs.opened} first=${anonWs.first}`);
const bobWs = await socket(bobJar, session.id);
check("Bob's WebSocket to Alice's session is refused", bobWs.first !== "session.ready", `opened=${bobWs.opened} first=${bobWs.first}`);

// 5. Sign out → cookie no longer valid; sign back in
const staleCookie = aliceJar.header();
const signOut = await api(aliceJar, "POST", "/api/auth/sign-out", {});
check("sign-out → 200", signOut.ok, String(signOut.status));
const afterSignOut = await fetch(`${BASE}/api/me`, { headers: { origin: ORIGIN, cookie: staleCookie } });
check("the old cookie is rejected after sign-out → 401", afterSignOut.status === 401, String(afterSignOut.status));
const wrongPassword = await api(new Jar(), "POST", "/api/auth/sign-in/email", { email: alice.email, password: "wrong-password-123" });
check("sign-in with a wrong password is rejected", !wrongPassword.ok, String(wrongPassword.status));
const againJar = new Jar();
const signIn = await api(againJar, "POST", "/api/auth/sign-in/email", { email: alice.email, password: alice.password });
check("sign-in → 200 + new cookie", signIn.ok && againJar.size > 0);
check("Alice still owns her session after re-login", (await api(againJar, "GET", `/api/sessions/${session.id}`)).ok);

console.log(failures === 0 ? "\nAUTH OK" : `\n${failures} AUTH CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
