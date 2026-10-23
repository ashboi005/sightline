import { useEffect, useState } from "react"
export async function hashCameraIdentity(sourceKey: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceKey)
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
/** Avoid storing camera URLs, credentials or device IDs in model profiles. */
export function useCameraIdentity(sourceKey: string): string {
  const [identity, setIdentity] = useState({ key: "", value: "" })
  useEffect(() => {
    let active = true
    if (!sourceKey || !globalThis.crypto?.subtle) {
      return
    }
    void hashCameraIdentity(sourceKey)
      .then((value) => {
        if (!active) {
          return
        }
        setIdentity({ key: sourceKey, value })
      })
      .catch(() => {
        if (active) {
          setIdentity({ key: sourceKey, value: "" })
        }
      })
    return () => {
      active = false
    }
  }, [sourceKey])
  return identity.key === sourceKey ? identity.value : ""
}
