"use client";

import { use } from "react";

import { LectureRoute } from "@/components/lecture/lecture-route";

export default function LecturePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return <LectureRoute sessionId={sessionId} />;
}
