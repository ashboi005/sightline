import { z } from "zod"
import { readCameraJson } from "../server-auth"
import { CameraServiceError, type EspCameraService } from "./session-service"

const sessionId = z.string().min(1).max(128)
const positiveIntent = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const requestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("connect"),
      url: z.string().min(1).max(512),
      invertPan: z.boolean().optional(),
    })
    .strict(),
  z.object({ action: z.literal("status"), sessionId }).strict(),
  z
    .object({ action: z.literal("arm"), sessionId, intent: positiveIntent })
    .strict(),
  z
    .object({ action: z.literal("stop"), sessionId, intent: positiveIntent })
    .strict(),
  z.object({ action: z.literal("disconnect"), sessionId }).strict(),
  z
    .object({
      action: z.literal("observe"),
      sessionId,
      intent: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      observation: z
        .object({
          x: z.number().min(0).max(1),
          confidence: z.number().min(0).max(1),
          frameId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
          capturedAt: z.number().nonnegative().max(Number.MAX_SAFE_INTEGER),
          personEvidence: z
            .object({
              detectionConfidence: z.number().min(0).max(1),
              identityMargin: z.number().min(0).max(1),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
])

type Dependencies = {
  requireUser: (request: Request) => Promise<string>
  getService: () => EspCameraService
}

export async function handleEspCameraRequest(
  request: Request,
  dependencies: Dependencies
): Promise<Response> {
  try {
    const user = await dependencies.requireUser(request)
    const result = requestSchema.safeParse(await readCameraJson(request, 4_096))
    if (!result.success) throw new CameraServiceError("Invalid camera request.")
    request.signal.throwIfAborted()
    const service = dependencies.getService()
    const reply =
      result.data.action === "connect"
        ? await service.connect(user, result.data)
        : service.execute(user, result.data)
    return Response.json(reply, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof Response) return error
    const status = error instanceof CameraServiceError ? error.status : 400
    const message =
      error instanceof Error ? error.message : "Camera request failed."
    return Response.json(
      { status: "error", message, error: message },
      { status, headers: { "Cache-Control": "no-store" } }
    )
  }
}
