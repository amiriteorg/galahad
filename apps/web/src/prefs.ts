/*
 * UI preferences, the only thing this app keeps in localStorage: theme, motion,
 * sidebar state, the last chat role, what Enter does while Galahad is working, and
 * which kept chat you had open (its id only). Never secrets, never a word of a chat,
 * never anything else from the server. boot.ts reads the same keys before paint.
 */

export type ThemePref = "system" | "light" | "dark";
export type MotionPref = "system" | "reduce" | "full";

const KEYS = {
  theme: "galahad:theme",
  motion: "galahad:motion",
  sidebar: "galahad:sidebar",
  role: "galahad:chat-role",
  enter: "galahad:chat-enter",
  chat: "galahad:open-chat",
} as const;

type PrefKey = keyof typeof KEYS;

function read(key: PrefKey): string | null {
  try {
    return localStorage.getItem(KEYS[key]);
  } catch {
    return null;
  }
}

function write(key: PrefKey, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(KEYS[key]);
    else localStorage.setItem(KEYS[key], value);
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}

const root = () => document.documentElement;

// The app opens on Chat, so the page you were last on is no longer kept: what an earlier version wrote goes.
try {
  localStorage.removeItem("galahad:last-route");
} catch {
  /* storage unavailable: there is nothing to remove */
}

export function themePref(): ThemePref {
  const value = read("theme");
  return value === "light" || value === "dark" ? value : "system";
}

export function resolvedTheme(): "light" | "dark" {
  const pref = themePref();
  if (pref !== "system") return pref;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function setTheme(pref: ThemePref): void {
  write("theme", pref === "system" ? null : pref);
  if (pref === "system") delete root().dataset.theme;
  else root().dataset.theme = pref;
  syncThemeColor();
}

/** Keeps the browser chrome (status bar, title bar) in step with the canvas: exactly --bg. */
export function syncThemeColor(): void {
  const color = resolvedTheme() === "dark" ? "#08080a" : "#fafafa";
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = color;
}

export function motionPref(): MotionPref {
  const value = read("motion");
  return value === "reduce" || value === "full" ? value : "system";
}

export function setMotion(pref: MotionPref): void {
  write("motion", pref === "system" ? null : pref);
  if (pref === "system") delete root().dataset.motion;
  else root().dataset.motion = pref;
}

export function sidebarCollapsed(): boolean {
  return read("sidebar") === "collapsed";
}

export function setSidebarCollapsed(collapsed: boolean): void {
  write("sidebar", collapsed ? "collapsed" : null);
  if (collapsed) root().dataset.sidebar = "collapsed";
  else delete root().dataset.sidebar;
}

export const lastRole = (): string | null => read("role");
export const rememberRole = (role: string): void => write("role", role);

/** What Enter does while he's working, on this device: steer (the default: he's told now) or queue (sent when he's done). */
export type ChatEnterPref = "steer" | "queue";
export const chatEnter = (): ChatEnterPref => (read("enter") === "queue" ? "queue" : "steer");
export const setChatEnter = (pref: ChatEnterPref): void => write("enter", pref === "steer" ? null : pref);

/**
 * The kept chat you had open (its id, never a word of it), so the app comes back to it, and to the turn he's
 * working on in it, after a reload: where you were, like the last page.
 */
export const openChatId = (): string | null => {
  const id = read("chat");
  return id && /^cv_[A-Za-z0-9_-]{22}$/.test(id) ? id : null;
};
export const rememberOpenChat = (id: string | null): void => write("chat", id);
