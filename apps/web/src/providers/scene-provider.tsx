"use client";
import dynamic from "next/dynamic";
import { useSession } from "@/hooks/use-auth";
const RuntimeProvider = dynamic(() => import("./scene/runtime"), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-svh place-items-center" role="status">
      Loading your workspace…
    </div>
  ),
});
export function SceneProvider({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  if (!data?.user) return null;
  return (
    <RuntimeProvider key={data.user.id} userId={data.user.id}>
      {children}
    </RuntimeProvider>
  );
}
