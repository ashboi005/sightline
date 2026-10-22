"use client";

import { Suspense, use } from "react";

import { RecordingDetail } from "@/components/recordings/recording-detail";

export default function RecordingPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return (
    <Suspense>
      <RecordingDetail sessionId={sessionId} />
    </Suspense>
  );
}
