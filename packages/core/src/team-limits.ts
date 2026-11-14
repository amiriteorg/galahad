/** Shared UI/runtime limits, without loading boundary validation in the PWA. The last three are Galahad's own
 * allowance in a day, from your conversation: knights he seats, messages he sends them, and tasks he gives the Roundtable. */
export const TEAM_LIMITS = { teammates: 32, rooms: 128, pending: 256, message: 20_000, memory: 12_000, output: 40_000, progress: 8_000, history: 100, recruitsPerDay: 8, saysPerDay: 40, givesPerDay: 12 } as const;
