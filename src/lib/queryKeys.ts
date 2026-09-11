export const qk = {
  profile: (userId: string) => ["profile", userId] as const,
  board: (filters: unknown) => ["board", filters] as const,
  order: (id: string) => ["order", id] as const,
  record: (id: string) => ["record", id] as const,
  lines: (id: string) => ["lines", id] as const,
  payments: (id: string) => ["payments", id] as const,
  dispatches: (id: string) => ["dispatches", id] as const,
  activity: (id: string) => ["activity", id] as const,
  syncHealth: ["sync-health"] as const,
};
