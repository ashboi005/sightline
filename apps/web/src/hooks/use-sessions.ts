"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Paginated, Session } from "@/types";

export const sessionKeys = {
  all: ["sessions"] as const,
  list: (page: number) => ["sessions", "list", page] as const,
};

/** The signed-in student's lectures, newest first. */
export function useSessions(page = 1) {
  return useQuery({
    queryKey: sessionKeys.list(page),
    queryFn: () => api<Paginated<Session>>(`/api/sessions?page=${page}&pageSize=20`),
  });
}
