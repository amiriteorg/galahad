import type { StatusColors } from "./plots.ts";

/*
 * What the world takes from the app's theme: the accent (Galahad's cape, the
 * selection ring) and the status tones (each plot's lamp). The sky and the light
 * follow the time of day instead (./daynight.ts). Tokens are read as the browser
 * resolves them through a hidden probe, so light-dark() and a forced theme apply.
 */

const FALLBACK = { accent: 0x0a0a0b, ok: 0x137a43, warn: 0x965a00, danger: 0xc4281c, neutral: 0x52525a };

/** "rgb(1, 2, 3)", "rgba(…)" or "color(srgb 0.1 0.2 0.3)" → 0xrrggbb. */
export function parseCssColor(text: string): number | null {
  const rgb = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/);
  if (rgb) return (clamp255(+rgb[1]!) << 16) | (clamp255(+rgb[2]!) << 8) | clamp255(+rgb[3]!);
  const srgb = text.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (srgb) return (clamp255(+srgb[1]! * 255) << 16) | (clamp255(+srgb[2]! * 255) << 8) | clamp255(+srgb[3]! * 255);
  const hex = text.trim().match(/^#([0-9a-f]{6})$/i);
  return hex ? parseInt(hex[1]!, 16) : null;
}

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

export function readThemeColors(): StatusColors {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const token = (name: keyof typeof FALLBACK): number => {
    probe.style.color = `var(--${name})`;
    return parseCssColor(getComputedStyle(probe).color) ?? FALLBACK[name];
  };
  const colors = { accent: token("accent"), ok: token("ok"), warn: token("warn"), danger: token("danger"), neutral: token("neutral") };
  probe.remove();
  return colors;
}
