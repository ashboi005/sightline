"use client";

import type { CreateSessionInput, Session, UpdateSessionInput } from "@sightline/contracts";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "@/lib/api";
import { keys } from "@/lib/query-keys";

/** Writes a fresh session into every cached place it appears (detail + lists). */
export function cacheSession(queryClient: QueryClient, session: Session) {
  queryClient.setQueryData(keys.sessions.one(session.id), session);
  void queryClient.invalidateQueries({ queryKey: keys.sessions.all, refetchType: "active" });
}

/** The student's lectures, newest first. */
export function useSessions(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: keys.sessions.list(page, pageSize),
    queryFn: () => api.listSessions(page, pageSize),
  });
}

export function useSession(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.sessions.one(sessionId ?? ""),
    queryFn: () => api.getSession(sessionId!),
    enabled: Boolean(sessionId),
    // Context, slides and notes progress show up on the session too; keep it fresh while anything is processing.
    refetchInterval: (query) => {
      const s = query.state.data;
      return s && [s.contextStatus, s.slidesStatus, s.notesStatus].includes("PROCESSING") ? 2000 : false;
    },
  });
}

/**
 * The session carries the status of its context, slides and notes. When one changes (e.g. slides finish and the
 * context starts re-learning), refresh that data so a page never shows a stale "processing" or "empty".
 */
export function useSyncLectureData(session: Session | undefined) {
  const queryClient = useQueryClient();
  const id = session?.id;
  useEffect(() => {
    if (id) void queryClient.invalidateQueries({ queryKey: keys.context(id) });
  }, [queryClient, id, session?.contextStatus]);
  useEffect(() => {
    if (id) void queryClient.invalidateQueries({ queryKey: keys.slides(id) });
  }, [queryClient, id, session?.slidesStatus]);
  useEffect(() => {
    if (id) void queryClient.invalidateQueries({ queryKey: keys.notes(id) });
  }, [queryClient, id, session?.notesStatus]);
}

/** Creates a DRAFT lecture. Callers should disable the submit button while `isPending` to avoid duplicates. */
export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSessionInput) => api.createSession(input),
    onSuccess: (session) => cacheSession(queryClient, session),
  });
}

export function useUpdateSession(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateSessionInput) => api.updateSession(sessionId, patch),
    onSuccess: (session) => cacheSession(queryClient, session),
  });
}

export function useStartSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.startSession(sessionId),
    onSuccess: (session) => cacheSession(queryClient, session),
  });
}

export function useEndSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.endSession(sessionId),
    onSuccess: (session) => {
      cacheSession(queryClient, session);
      void queryClient.invalidateQueries({ queryKey: keys.lecture(session.id) });
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.deleteSession(sessionId),
    onSuccess: (_, sessionId) => {
      queryClient.removeQueries({ queryKey: keys.sessions.one(sessionId) });
      queryClient.removeQueries({ queryKey: keys.lecture(sessionId) });
      void queryClient.invalidateQueries({ queryKey: keys.sessions.all });
    },
  });
}
