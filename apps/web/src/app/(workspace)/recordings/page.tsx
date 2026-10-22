import type { Metadata } from "next";

import { RecordingsLibrary } from "@/components/recordings/recordings-library";

export const metadata: Metadata = { title: "Recorded lectures" };

export default function RecordingsPage() {
  return <RecordingsLibrary />;
}
