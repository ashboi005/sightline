type Dependencies = {
  fetch?: typeof fetch;
  serverUrl?: string;
  appOrigin?: string;
};

export function cameraError(message: string, status: number) {
  return Response.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** Use the same session authority as the rest of Sightline; never trust a client user ID. */
export async function requireCameraUser(
  request: Request,
  dependencies: Dependencies = {},
): Promise<string> {
  const url = new URL(request.url);
  const origin =
    dependencies.appOrigin ??
    process.env.SIGHTLINE_APP_ORIGIN ??
    `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw cameraError("Only same-origin camera requests are allowed.", 403);
  }
  const server =
    dependencies.serverUrl ??
    process.env.SIGHTLINE_SERVER_URL ??
    process.env.SERVER_URL ??
    process.env.NEXT_PUBLIC_SERVER_URL ??
    "http://localhost:3000";
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(new URL("/api/me", server), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
    });
  } catch {
    throw cameraError(
      "Cannot verify your session. Reconnect to Sightline and retry.",
      503,
    );
  }
  if (!response.ok)
    throw cameraError(
      "Sign in to configure cameras.",
      response.status === 401 ? 401 : 503,
    );
  const user = await response.json().catch(() => null);
  if (!user || typeof user.id !== "string" || !user.id)
    throw cameraError("Sign in to configure cameras.", 401);
  if (
    user.isMock &&
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
  ) {
    throw cameraError(
      "Sign in with a real account to use cameras on a hosted deployment.",
      403,
    );
  }
  return user.id;
}

export async function readCameraJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw cameraError("Expected JSON.", 415);
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes)
    throw cameraError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw cameraError("Request is empty.", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw cameraError("Request is too large.", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error("Invalid JSON");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Response) throw error;
    if (signal.aborted)
      throw cameraError(
        "Camera upload was cancelled or timed out.",
        request.signal.aborted ? 499 : 408,
      );
    throw cameraError("Invalid camera request.", 400);
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
