/*
 * The on-screen keyboard, as far as a page can tell. iOS (Safari and Home Screen
 * apps) keeps the page its full height and shrinks only the visual viewport, so
 * anything pinned to the bottom (the tab bar, the chat composer's place above it)
 * would sit behind the keyboard. Pure, so unit-tested.
 */

/** More than this much of the page hidden while typing is a keyboard, not a browser bar sliding away. */
const KEYBOARD_PX = 150;

export function keyboardOpen(view: { coarse: boolean; typing: boolean; fullHeight: number; visibleHeight: number }): boolean {
  return view.coarse && view.typing && view.fullHeight - view.visibleHeight > KEYBOARD_PX;
}
