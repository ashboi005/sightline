import type { Metadata } from "next";
import { Suspense } from "react";

import { SignWorkspace } from "@/components/sign/sign-workspace";

export const metadata: Metadata = { title: "Sign language" };

export default function SignPage() {
  return (
    <Suspense>
      <SignWorkspace />
    </Suspense>
  );
}
