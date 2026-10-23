export type CameraSourceTypeProps = {
  value: "usb" | "network"
  onChange: (value: "usb" | "network") => void
  label?: string
}
