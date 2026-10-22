"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/hooks/use-auth";
import { signedInDestination } from "@/lib/account-state";

/**
 * Where a signed-in student should land: the page they were sent here from (`?next=`), else the dashboard.
 * Auth pages also send anyone already signed in straight there.
 */
export function useSignedInDestination() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: session } = useSession();
  const destination = signedInDestination(params.get("next")) as Route;

  useEffect(() => {
    if (session?.user) router.replace(destination);
  }, [session, router, destination]);

  const next = params.get("next");
  /** Append to links between sign-in and sign-up so the return path survives the switch. */
  const carry = next ? `?next=${encodeURIComponent(next)}` : "";
  return { destination, carry };
}
