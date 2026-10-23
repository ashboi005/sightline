import type { Metadata } from "next";
import { VoiceFocusWorkspace } from "@/components/lecture/live/voice-focus-workspace";

export const metadata: Metadata = { title: "Focus a person" };

export default function FocusPage() {
  return <VoiceFocusWorkspace />;
}
