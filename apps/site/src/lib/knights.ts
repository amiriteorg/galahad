/*
 * The owner's drawings of the knights, read from the app's own folder at build time (apps/web/src/knights): the site
 * never holds a copy, so it can never show one redrawn or out of date.
 */
import bedivere from "../../../web/src/knights/bedivere.webp";
import bors from "../../../web/src/knights/bors.webp";
import gaheris from "../../../web/src/knights/gaheris.webp";
import galahad from "../../../web/src/knights/galahad.webp";
import galahadLarge from "../../../web/src/knights/galahad@2x.webp";
import gareth from "../../../web/src/knights/gareth.webp";
import gawain from "../../../web/src/knights/gawain.webp";
import kay from "../../../web/src/knights/kay.webp";
import lancelot from "../../../web/src/knights/lancelot.webp";
import palamedes from "../../../web/src/knights/palamedes.webp";
import percival from "../../../web/src/knights/percival.webp";
import tristan from "../../../web/src/knights/tristan.webp";

export const DRAWINGS = { bedivere, bors, gaheris, galahad, gareth, gawain, kay, lancelot, palamedes, percival, tristan } as const;
/** The drawings the app also has at twice the size, for a figure drawn big on a dense screen. */
export const LARGE: Partial<Record<keyof typeof DRAWINGS, typeof galahad>> = { galahad: galahadLarge };
