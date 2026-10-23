export type SavedCameraOptionProps = {
  deviceId: string
  devices: readonly Pick<MediaDeviceInfo, "deviceId">[]
}
