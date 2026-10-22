"use client";

import type { SignSource, SignToken } from "@sightline/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiRequestError, api } from "@/lib/api";
import { keys } from "@/lib/query-keys";

// Everything attached to one lecture: context, slides, transcript, notes, recordings, snapshots, sign history.

const pollWhileProcessing = (status: string | undefined) => (status === "PROCESSING" ? 1500 : false);

export function useLectureContext(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.context(sessionId ?? ""),
    queryFn: () => api.getContext(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: (q) => pollWhileProcessing(q.state.data?.status),
  });
}

export function useSetContextText(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.setContextText(sessionId, text),
    onSuccess: (context) => {
      queryClient.setQueryData(keys.context(sessionId), context);
      void queryClient.invalidateQueries({ queryKey: keys.sessions.one(sessionId) });
    },
  });
}

/** The slide deck, or null when none was uploaded (the API answers 404). */
export function useSlides(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.slides(sessionId ?? ""),
    queryFn: async () => {
      try {
        return await api.getSlides(sessionId!);
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: Boolean(sessionId),
    refetchInterval: (q) => pollWhileProcessing(q.state.data?.status),
  });
}

export function useUploadSlides(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadSlides(sessionId, file),
    onSuccess: (deck) => {
      queryClient.setQueryData(keys.slides(sessionId), deck);
      void queryClient.invalidateQueries({ queryKey: keys.sessions.one(sessionId) });
      void queryClient.invalidateQueries({ queryKey: keys.context(sessionId) });
    },
  });
}

export function useTranscript(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.transcript(sessionId ?? ""),
    queryFn: async () => (await api.getTranscript(sessionId!)).data,
    enabled: Boolean(sessionId),
  });
}

export function useNotes(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.notes(sessionId ?? ""),
    queryFn: () => api.getNotes(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: (q) => pollWhileProcessing(q.state.data?.status),
  });
}

/** Regenerates notes for an ENDED lecture. Existing notes stay readable while it runs or if it fails. */
export function useRegenerateNotes(sessionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.regenerateNotes(sessionId),
    onSuccess: (notes) => {
      queryClient.setQueryData(keys.notes(sessionId), notes);
      void queryClient.invalidateQueries({ queryKey: keys.sessions.all });
    },
  });
}

/** Recordings with fresh playback URLs. Refetch when a URL expires (they last about an hour). */
export function useRecordings(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.recordings(sessionId ?? ""),
    queryFn: async () => (await api.listRecordings(sessionId!)).data,
    enabled: Boolean(sessionId),
    staleTime: 10 * 60_000,
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "RECORDING") ? 5000 : false),
  });
}

export function useSnapshots(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.snapshots(sessionId ?? ""),
    queryFn: async () => (await api.listSnapshots(sessionId!)).data,
    enabled: Boolean(sessionId),
  });
}

export function useSignUtterances(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: keys.utterances(sessionId ?? ""),
    queryFn: async () => (await api.listSignUtterances(sessionId!)).data,
    enabled: Boolean(sessionId),
  });
}

/** Committed gloss tokens → a sentence (+ speech when `speak`). Also arrives as `sign.utterance` on the socket. */
export function useCreateSignUtterance(sessionId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: { tokens: SignToken[]; source: SignSource; speak: boolean }) => {
      if (!sessionId) throw new Error("Choose a lecture first: sign messages are saved with a lecture.");
      return api.createSignUtterance(sessionId, input);
    },
  });
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: () => api.health(), staleTime: 60_000, retry: 0 });
}
