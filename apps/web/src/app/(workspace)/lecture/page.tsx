import type { Metadata } from "next";

import { NewLectureForm } from "@/components/lecture/prep/new-lecture-form";

export const metadata: Metadata = { title: "New lecture" };

export default function NewLecturePage() {
  return <NewLectureForm />;
}
