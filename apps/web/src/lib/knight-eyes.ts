import type { AvatarExpression, AvatarLook } from "@galahad/core/avatar";

/*
 * Where each knight drawing's eyes are, and how each state shows them: the data the PWA's live eyes are drawn from
 * (ui/avatar.ts), and the Apple app's too (apps/apple: held to these by its vectors). Pure: no DOM.
 */

export type Art = AvatarLook | "galahad" | "black-knight";
/** An eye on the drawing's 768-unit canvas: its centre, its radius, and the dark of the slit round it. */
export type Eye = readonly [x: number, y: number, r: number, slit: string];
/** The canvas every drawing is on, in the units its eyes are given in. */
export const CANVAS = 768;
/** Where each drawing's eyes are, and the box its figure fills (for what is drawn beside it): design/knights-cutout.py
 * prints a drawing's line when it cuts it out. The two the app shows big (Galahad's own) come at twice the size too. */
export const ART: Record<Art, { eyes: readonly [Eye, Eye]; box: readonly [number, number, number, number]; large?: true }> = {
  galahad: { eyes: [[281, 293, 13.7, "#342015"], [483, 294, 13.6, "#331e13"]], box: [123, 23, 645, 730], large: true },
  "black-knight": { eyes: [[230, 282, 12.8, "#271b12"], [428, 282, 13.6, "#251a11"]], box: [140, 23, 628, 730], large: true },
  kay: { eyes: [[271, 304, 12.8, "#24170c"], [444, 304, 12.8, "#25170c"]], box: [137, 23, 631, 730] },
  gaheris: { eyes: [[278, 291, 13.7, "#2a1e17"], [484, 290, 13.7, "#2b1e17"]], box: [122, 23, 646, 730] },
  percival: { eyes: [[222, 303, 12.3, "#33261d"], [360, 300, 12.9, "#2a1f17"]], box: [130, 23, 638, 730] },
  palamedes: { eyes: [[300, 325, 10.9, "#2b1e15"], [467, 325, 11.0, "#2b1e15"]], box: [152, 23, 616, 730] },
  gawain: { eyes: [[228, 377, 18.2, "#2c2114"], [401, 377, 18.8, "#2a1f13"]], box: [47, 23, 721, 730] },
  tristan: { eyes: [[243, 300, 15.3, "#2a2018"], [415, 300, 15.4, "#2a2019"]], box: [137, 23, 631, 730] },
  lancelot: { eyes: [[239, 300, 12.3, "#231a14"], [375, 300, 12.4, "#221913"]], box: [142, 23, 626, 730] },
  bedivere: { eyes: [[236, 295, 12.2, "#211b12"], [376, 293, 12.2, "#211a12"]], box: [137, 23, 631, 730] },
  bors: { eyes: [[296, 258, 11.9, "#2b1f16"], [455, 258, 12.0, "#291e15"]], box: [33, 23, 735, 730] },
  gareth: { eyes: [[236, 350, 18.6, "#2f1f14"], [429, 350, 18.7, "#2d1e13"]], box: [14, 23, 754, 730] },
};

export type Eyes = "open" | "wide" | "low" | "happy" | "shut" | "ember";
/** How each state shows: its eyes, and where they look (in eye radii, x then y; the page's motion moves some). */
export const SHOWN: Record<AvatarExpression, { eyes: Eyes; gaze: readonly [number, number] }> = {
  idle: { eyes: "open", gaze: [0, 0] },
  thinking: { eyes: "open", gaze: [0.4, -0.32] },
  working: { eyes: "open", gaze: [-0.1, 0.34] },
  reading: { eyes: "open", gaze: [0, 0.22] },
  browsing: { eyes: "open", gaze: [0, 0.22] },
  checking: { eyes: "open", gaze: [0, 0.28] },
  waiting: { eyes: "open", gaze: [-0.38, -0.3] },
  asking: { eyes: "wide", gaze: [0, 0] },
  pleased: { eyes: "happy", gaze: [0, 0] },
  concerned: { eyes: "low", gaze: [0, 0.3] },
  resting: { eyes: "shut", gaze: [0, 0] },
};
