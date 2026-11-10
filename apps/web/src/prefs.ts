/*
 * UI preferences, the only thing this app keeps in localStorage: theme, motion,
 * last page, sidebar state and the last chat role. Never secrets, never chat,
 * never anything from the server. boot.ts reads the same keys before paint.
 */

export type ThemePref = "system" | "light" | "dark";
export type MotionPref = "system" | "reduce" | "full";

const KEYS = {
  theme: "galahad:theme",
  motion: "galahad:motion",
  route: "galahad:last-route",
  sidebar: "galahad:sidebar",
  role: "galahad:chat-role",
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

export const lastRoute = (): string | null => read("route");
export const rememberRoute = (route: string): void => write("route", route);
export const lastRole = (): string | null => read("role");
export const rememberRole = (role: string): void => write("role", role);
