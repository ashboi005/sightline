/** Grabs frames from a playing <video> as base64 JPEG (unmirrored) at `fps`, for the sign service. Returns stop. */
export function startWebcamFrames(
  video: HTMLVideoElement,
  options: { fps: number; width: number; height: number },
  onFrame: (base64Jpeg: string) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const ctx = canvas.getContext("2d");
  const timer = setInterval(() => {
    if (!ctx || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, options.width, options.height);
    onFrame(canvas.toDataURL("image/jpeg", 0.7).slice("data:image/jpeg;base64,".length));
  }, 1000 / options.fps);
  return () => clearInterval(timer);
}
