import { cameraError, readCameraJson } from "./server-auth";

type Owner = { userId: string; expires: number };
const lifetime = 30 * 60_000;
const registry = globalThis as typeof globalThis & {
  sightlineVisionOwners?: Map<string, Owner>;
};
const owners = (registry.sightlineVisionOwners ??= new Map<string, Owner>());

export async function proxyVision(
  request: Request,
  userId: string,
  configuration = {
    url: process.env.GAZE_VISION_URL ?? "",
    secret: process.env.GAZE_VISION_SECRET ?? "",
  },
  transport: typeof fetch = fetch,
) {
  if (
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(configuration.url) ||
    !configuration.secret
  ) {
    throw cameraError(
      "Object tracking is offline. Start Sightline with its vision service, then retry.",
      503,
    );
  }
  const body = await readCameraJson(request, 2 * 1024 * 1024);
  if (body.action === "select") body.kind = "person";
  if (
    !["status", "select", "track", "match", "clear"].includes(
      String(body.action),
    )
  )
    throw cameraError("Unknown vision action.", 400);
  const now = Date.now();
  for (const [token, owner] of owners)
    if (owner.expires < now) owners.delete(token);
  if (["track", "match", "clear"].includes(String(body.action))) {
    const owner =
      typeof body.token === "string" ? owners.get(body.token) : null;
    if (!owner || owner.userId !== userId)
      throw cameraError("Selection expired. Select the object again.", 410);
    owner.expires = now + lifetime;
  }
  if (body.action === "select" && owners.size >= 128)
    throw cameraError(
      "Tracking is busy. Clear an existing selection and retry.",
      429,
    );
  let response: Response;
  try {
    response = await transport(configuration.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${configuration.secret}`,
      },
      body: JSON.stringify(body),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
    });
    const result = await response.json();
    if (
      response.ok &&
      body.action === "select" &&
      typeof result.token === "string"
    ) {
      owners.set(result.token, { userId, expires: now + lifetime });
    }
    if (body.action === "clear" && typeof body.token === "string")
      owners.delete(body.token);
    return Response.json(result, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    throw cameraError(
      "The vision service could not process this frame. Retry when it is ready.",
      503,
    );
  }
}
