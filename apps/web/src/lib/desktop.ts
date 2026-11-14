/*
 * A knight's desktop: whether its VM has one (a display, a window manager and a browser, for work that needs a
 * screen). Pure (no DOM).
 */

/** A VM made from the desktop image has a display, a window manager and a browser. */
export const hasDesktop = (workspace: { image: string } | null | undefined): boolean => Boolean(workspace?.image.includes("desktop"));
