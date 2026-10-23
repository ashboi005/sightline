import { requireCameraUser } from "@/features/esp-camera/server-auth"
import { handleEspCameraRequest } from "@/features/esp-camera/server/route-handler"
import { getEspCameraService } from "@/features/esp-camera/server/runtime"

export const runtime = "nodejs"

export function POST(request: Request) {
  return handleEspCameraRequest(request, { requireUser: requireCameraUser, getService: getEspCameraService })
}
