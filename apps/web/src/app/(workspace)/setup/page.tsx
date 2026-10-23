import type { Metadata } from "next";
import { SetupFlow } from "@/components/setup/setup-flow";
export const metadata: Metadata = { title: "Setup" };
export default function SetupPage() {
  return <SetupFlow />;
}
