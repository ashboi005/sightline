"use client";

import { Button } from "@sightline/ui/components/button";
import { LoaderCircle, ServerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "@/hooks/use-auth";

/** Workspace pages need a signed-in student (or a server running MOCK_AUTH). */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.isSuccess && !session.data) router.replace("/sign-in");
  }, [session.isSuccess, session.data, router]);

  if (session.isError) {
    return (
      <div className="grid min-h-svh place-items-center px-4">
        <div className="max-w-sm text-center">
          <ServerOff aria-hidden="true" className="mx-auto size-8 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-bold">Can&apos;t reach the Sightline server</h1>
          <p className="mt-2 text-muted-foreground">
            Check that it&apos;s running (for development: <code className="font-mono text-sm">bun run dev:demo</code>), then try again.
          </p>
          <Button variant="clay" size="lg" className="mt-6" onClick={() => session.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!session.data) {
    return (
      <div className="grid min-h-svh place-items-center" role="status">
        <LoaderCircle aria-hidden="true" className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
        <span className="sr-only">Loading your workspace</span>
      </div>
    );
  }

  return children;
}
