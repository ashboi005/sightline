"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/hooks/use-auth";

/** Auth pages send people who are already signed in straight to their dashboard. */
export function useRedirectIfSignedIn() {
  const router = useRouter();
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user) router.replace("/dashboard");
  }, [session, router]);
}
