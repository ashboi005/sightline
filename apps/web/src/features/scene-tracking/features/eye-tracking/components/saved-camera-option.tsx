import type { SavedCameraOptionProps } from "./saved-camera-option.types"
/** Keep a saved choice visible before permission or device enumeration. */
export function SavedCameraOption({
  deviceId,
  devices,
}: SavedCameraOptionProps) {
  if (!deviceId || devices.some((device) => device.deviceId === deviceId)) {
    return null
  }
  return (
    <option value={deviceId}>Saved camera · reconnect or choose another</option>
  )
}
