import { requireCameraUser } from "@/features/esp-camera/server-auth";
import { proxyCameraStream } from "@/features/scene-tracking/features/eye-tracking/camera-stream-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireCameraUser(request);
    return await proxyCameraStream(request, { appOrigin: process.env.SIGHTLINE_APP_ORIGIN });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
