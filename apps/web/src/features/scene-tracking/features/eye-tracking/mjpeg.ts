const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const HEADER_SEPARATOR = textEncoder.encode("\r\n\r\n")
const MAX_FRAME_BYTES = 8 * 1024 * 1024
const MAX_HEADER_BYTES = 16 * 1024
function findBytes(haystack: Uint8Array, needle: Uint8Array, start = 0) {
  outer: for (
    let index = start;
    index <= haystack.length - needle.length;
    index++
  ) {
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        continue outer
      }
    }
    return index
  }
  return -1
}
function startsWithBytes(value: Uint8Array, prefix: number[]) {
  return prefix.every((byte, index) => value[index] === byte)
}
function joinBytes(left: Uint8Array, right: Uint8Array) {
  const joined = new Uint8Array(left.length + right.length)
  joined.set(left)
  joined.set(right, left.length)
  return joined
}
export async function* readMjpegFrames(
  stream: ReadableStream<Uint8Array>,
  boundary: string,
  signal?: AbortSignal
): AsyncGenerator<Uint8Array> {
  if (!boundary || boundary.length > 200) {
    throw new Error("The camera returned an invalid MJPEG boundary.")
  }
  const reader = stream.getReader()
  const marker = textEncoder.encode(`--${boundary}`)
  const cancelReader = () => void reader.cancel()
  signal?.addEventListener("abort", cancelReader, { once: true })
  let buffer = new Uint8Array(0)
  let ended = false
  const readMore = async () => {
    if (signal?.aborted) {
      throw new DOMException("Stream stopped.", "AbortError")
    }
    if (ended) {
      return false
    }
    const chunk = await reader.read()
    ended = chunk.done
    if (!chunk.done) {
      buffer = joinBytes(buffer, chunk.value)
    }
    if (buffer.length > MAX_FRAME_BYTES + MAX_HEADER_BYTES) {
      throw new Error("A camera frame exceeded the 8 MB limit.")
    }
    return !ended
  }
  try {
    while (true) {
      let markerIndex = findBytes(buffer, marker)
      while (markerIndex < 0) {
        if (!(await readMore())) {
          return
        }
        markerIndex = findBytes(buffer, marker)
        if (markerIndex < 0 && buffer.length > marker.length) {
          buffer = buffer.slice(buffer.length - marker.length + 1)
        }
      }
      buffer = buffer.slice(markerIndex + marker.length)
      while (buffer.length < 2) {
        if (!(await readMore())) {
          return
        }
      }
      if (startsWithBytes(buffer, [45, 45])) {
        return
      }
      if (startsWithBytes(buffer, [13, 10])) {
        buffer = buffer.slice(2)
      }
      let headerEnd = findBytes(buffer, HEADER_SEPARATOR)
      while (headerEnd < 0) {
        if (buffer.length > MAX_HEADER_BYTES) {
          throw new Error("The camera returned oversized MJPEG headers.")
        }
        if (!(await readMore())) {
          return
        }
        headerEnd = findBytes(buffer, HEADER_SEPARATOR)
      }
      const headers = textDecoder.decode(buffer.slice(0, headerEnd))
      const contentLength = Number(
        headers.match(/(?:^|\r\n)content-length:\s*(\d+)/i)?.[1]
      )
      const isJpeg = /(?:^|\r\n)content-type:\s*image\/jpeg(?:\s|;|$)/i.test(
        headers
      )
      buffer = buffer.slice(headerEnd + HEADER_SEPARATOR.length)
      let frame: Uint8Array
      if (Number.isSafeInteger(contentLength) && contentLength > 0) {
        if (contentLength > MAX_FRAME_BYTES) {
          throw new Error("A camera frame exceeded the 8 MB limit.")
        }
        while (buffer.length < contentLength) {
          if (!(await readMore())) {
            return
          }
        }
        frame = buffer.slice(0, contentLength)
        buffer = buffer.slice(contentLength)
      } else {
        let nextMarker = findBytes(buffer, marker)
        while (nextMarker < 0) {
          if (buffer.length > MAX_FRAME_BYTES) {
            throw new Error("A camera frame exceeded the 8 MB limit.")
          }
          if (!(await readMore())) {
            return
          }
          nextMarker = findBytes(buffer, marker)
        }
        let frameEnd = nextMarker
        if (
          frameEnd >= 2 &&
          buffer[frameEnd - 2] === 13 &&
          buffer[frameEnd - 1] === 10
        ) {
          frameEnd -= 2
        }
        frame = buffer.slice(0, frameEnd)
        buffer = buffer.slice(frameEnd)
      }
      if (isJpeg && frame.length > 0) {
        yield frame
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export function getMjpegBoundary(contentType: string) {
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i)
  return match?.[1] ?? match?.[2] ?? ""
}
