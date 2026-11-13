/** Shared UI/runtime limits, without loading boundary validation in the PWA. The last two are Galahad's own
 * allowance in a day: workers he makes for himself, and messages he sends into Team from your conversation. */
export const TEAM_LIMITS = { teammates: 32, rooms: 128, pending: 256, message: 20_000, memory: 12_000, output: 40_000, progress: 8_000, history: 100, recruitsPerDay: 8, saysPerDay: 40 } as const;
