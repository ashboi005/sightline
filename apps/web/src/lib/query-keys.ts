/** Every TanStack Query key in one place, so invalidation after a mutation can't miss a screen. */
export const keys = {
  health: ["health"] as const,
  sessions: {
    all: ["sessions"] as const,
    list: (page: number, pageSize: number) => ["sessions", "list", page, pageSize] as const,
    one: (id: string) => ["sessions", "one", id] as const,
  },
  lecture: (id: string) => ["lecture", id] as const,
  context: (id: string) => ["lecture", id, "context"] as const,
  slides: (id: string) => ["lecture", id, "slides"] as const,
  transcript: (id: string) => ["lecture", id, "transcript"] as const,
  notes: (id: string) => ["lecture", id, "notes"] as const,
  recordings: (id: string) => ["lecture", id, "recordings"] as const,
  snapshots: (id: string) => ["lecture", id, "snapshots"] as const,
  utterances: (id: string) => ["lecture", id, "utterances"] as const,
};
