import {
  cameraError,
  requireCameraUser,
} from "@/features/esp-camera/server-auth";
import { proxyVision } from "@/features/esp-camera/vision-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    return await proxyVision(request, await requireCameraUser(request));
  } catch (error) {
    return error instanceof Response
      ? error
      : cameraError("Tracking is unavailable.", 503);
  }
}
