import { Usb, Wifi } from "lucide-react";
import {
  EyeButtonStyles,
  EyeSourceTypeStyles,
} from "../../tracking-ui/control-styles";
import type { CameraSourceTypeProps } from "./camera-source-type.types";
export function CameraSourceType({
  value,
  onChange,
  label = "Camera type",
}: CameraSourceTypeProps) {
  return (
    <>
      <div
        className={`eye-source-type ${EyeSourceTypeStyles}`}
        role="group"
        aria-label={label}
      >
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          aria-label="USB camera"
          title="USB camera"
          data-tooltip="USB camera"
          aria-pressed={value === "usb"}
          onClick={() => onChange("usb")}
        >
          <Usb size={19} aria-hidden="true" />
          <span>USB camera</span>
        </button>
        <button
          className={`eye-button ${EyeButtonStyles} secondary`}
          aria-label="Network stream"
          title="Network / IP / mDNS stream"
          data-tooltip="Network / IP / mDNS"
          aria-pressed={value === "network"}
          onClick={() => onChange("network")}
        >
          <Wifi size={19} aria-hidden="true" />
          <span>Network stream</span>
        </button>
      </div>
      {value === "network" && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          ESP32-CAM MJPEG and other browser-playable HTTP/HTTPS streams. Use an
          IP address or a .local hostname.
        </p>
      )}
    </>
  );
}
