"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import Loader from "@/components/loader";
import { useSession } from "@/hooks/use-auth";
import { useSessions } from "@/hooks/use-sessions";

// Placeholder until the dashboard design is decided. Shows the session + sessions queries working end to end.
export default function DashboardPage() {
  const router = useRouter();
  const session = useSession();
  const sessions = useSessions();

  useEffect(() => {
    if (session.isSuccess && !session.data) router.replace("/sign-in");
  }, [session.isSuccess, session.data, router]);

  if (session.isPending || !session.data) return <Loader />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Welcome, {session.data.user.name}</h1>

      <h2 className="mt-10 text-lg font-semibold">Your lectures</h2>
      {sessions.isPending && <p className="mt-3 text-muted-foreground">Loading lectures…</p>}
      {sessions.isError && <p className="mt-3 text-destructive">{sessions.error.message}</p>}
      {sessions.data && (
        <ul className="mt-3 divide-y rounded-xl border bg-card">
          {sessions.data.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="font-medium">{s.title}</span>
              <span className="text-sm text-muted-foreground">{s.status.toLowerCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
