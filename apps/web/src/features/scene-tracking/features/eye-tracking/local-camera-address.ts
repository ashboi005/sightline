export function isPrivateCameraAddress(hostname: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return false
  }
  const octets = hostname.split(".").map(Number)
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false
  }
  const first = octets[0]
  const second = octets[1]
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
export function isLocalCameraHost(hostname: string): boolean {
  return (
    hostname.toLowerCase().replace(/\.$/, "").endsWith(".local") ||
    isPrivateCameraAddress(hostname)
  )
}
