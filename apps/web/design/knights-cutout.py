"""
Cuts a drawing of a knight out of its paper, for the app (apps/web/src/knights/; ui/avatar.ts shows them).

The figure is everything the paper can't reach from the border without crossing the ink line, so the paper and the
ground shadow stay behind. Along the silhouette each anti-aliased pixel is un-blended from the paper: it takes the
ink's colour, with an alpha of how much ink it held, and resizing is premultiplied, so no paper-coloured fringe shows on
any background. Every drawing goes on the same square canvas (768 units), its feet on one baseline, so any two line up.
It writes <name>.webp at 288 px (and <name>@2x.webp at 576 with --large), and prints the line for ui/avatar.ts's ART:
where the eyes are on the canvas, the dark of the slit round them, and the box the figure fills.

    python3 apps/web/design/knights-cutout.py <drawing.png> <name> [--large]

A design tool, not part of the app or its tests: it needs numpy and opencv-python (in a throwaway venv), and the
drawing, which isn't kept here. A new knight is a drawing in the same style, cut out with this, its look added to
packages/core/src/avatar.ts (AVATAR_LOOKS) and its line to ART.
"""
import json, os, sys
import cv2
import numpy as np

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../src/knights")
SIDE, BASE = 768, 0.95  # the canvas, and the feet's baseline as a fraction of it


def luminance(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[:, :, 0].astype(np.float32) * 100 / 255


def solid_figure(L: np.ndarray) -> np.ndarray:
    """Everything inside the ink line: flood the paper in from the border, never across the line."""
    core = (L < 40).astype(np.uint8)
    barrier = cv2.dilate(core, np.ones((3, 3), np.uint8))
    n, lbl = cv2.connectedComponents((barrier == 0).astype(np.uint8), connectivity=4)
    border = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    solid = ~np.isin(lbl, list(border))
    n, lb, st, _ = cv2.connectedComponentsWithStats(solid.astype(np.uint8), 8)
    return lb == 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))


def eyes_of(L: np.ndarray, solid: np.ndarray) -> list[dict]:
    """The two eyes: a level pair of small bright blobs, each ringed by the dark slit."""
    bright = (L > 80) & solid
    n, lb, st, cen = cv2.connectedComponentsWithStats(bright.astype(np.uint8), 4)
    cands = []
    for i in range(1, n):
        a = st[i, cv2.CC_STAT_AREA]
        if a > solid.sum() * 0.004 or a < 60:
            continue
        blob = (lb == i).astype(np.uint8)
        ring = cv2.dilate(blob, np.ones((13, 13), np.uint8)).astype(bool) & ~cv2.dilate(blob, np.ones((4, 4), np.uint8)).astype(bool)
        cands.append({"x": float(cen[i][0]), "y": float(cen[i][1]), "r": float(np.sqrt(a / np.pi)), "inked": float((L[ring] < 34).mean())})
    best = None
    for a_ in cands:
        for b_ in cands:
            if a_["x"] >= b_["x"]:
                continue
            dy, dr, dx = abs(a_["y"] - b_["y"]), abs(a_["r"] - b_["r"]) / max(a_["r"], b_["r"]), b_["x"] - a_["x"]
            if dy > 2.2 * max(a_["r"], b_["r"]) or dr > 0.45 or dx < 3 * a_["r"]:
                continue
            score = a_["inked"] + b_["inked"] - dy / 50 - dr
            if best is None or score > best[0]:
                best = (score, a_, b_)
    return [{"x": e["x"], "y": e["y"], "r": e["r"]} for e in best[1:]] if best else []


def resize_premultiplied(rgba: np.ndarray, M: np.ndarray, side: int) -> np.ndarray:
    a = rgba[:, :, 3:4].astype(np.float32) / 255
    pm = np.dstack([rgba[:, :, :3].astype(np.float32) * a, a * 255])
    out = cv2.warpAffine(pm, M, (side, side), flags=cv2.INTER_AREA, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    alpha = out[:, :, 3:4] / 255
    rgb = np.where(alpha > 1e-4, out[:, :, :3] / np.maximum(alpha, 1e-4), 0)
    return np.dstack([np.clip(rgb, 0, 255), np.clip(out[:, :, 3:4], 0, 255)]).astype(np.uint8)


def main(path: str, name: str, large: bool) -> None:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    L = luminance(img)
    Lb = float(np.median(np.concatenate([L[:12].ravel(), L[:, :12].ravel(), L[:, -12:].ravel()])))
    solid = solid_figure(L)
    eyes = eyes_of(L, solid)
    if len(eyes) != 2:
        raise SystemExit(f"found {len(eyes)} eyes, not two: is this a drawing in the style?")
    din = cv2.distanceTransform(solid.astype(np.uint8), cv2.DIST_L2, 5)
    dout = cv2.distanceTransform((~solid).astype(np.uint8), cv2.DIST_L2, 5)
    line = solid & (din <= 3) & (L < 40)
    ink = np.median(img[line], axis=0) if line.any() else np.array([28, 29, 35], np.float32)
    Lf = float(np.median(L[line])) if line.any() else 15.0
    held = np.clip((Lb - L) / max(Lb - Lf, 1), 0, 1)
    inner, outer = solid & (din <= 1.5), ~solid & (dout <= 2.0)
    alpha = solid.astype(np.float32)
    alpha[inner] = held[inner]
    alpha[outer] = held[outer] * np.clip(1.3 - dout[outer] / 2.0, 0, 1)
    alpha[alpha < 0.06] = 0
    rgb = img.copy()
    rgb[inner | outer | ~solid] = ink.astype(np.uint8)
    rgba = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
    ys, xs = np.where(solid)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    scale = (SIDE * BASE - SIDE * 0.03) / (y1 - y0)
    M = np.float32([[scale, 0, SIDE / 2 - (x0 + x1) / 2 * scale], [0, scale, SIDE * BASE - y1 * scale]])
    canvas = resize_premultiplied(rgba, M, SIDE)
    for side, suffix in [(288, "")] + ([(576, "@2x")] if large else []):
        out = resize_premultiplied(canvas, np.float32([[side / SIDE, 0, 0], [0, side / SIDE, 0]]), side)
        cv2.imwrite(os.path.join(OUT, f"{name}{suffix}.webp"), out, [cv2.IMWRITE_WEBP_QUALITY, 90 if side == 288 else 88])
    at = lambda x, y: (x * scale + M[0, 2], y * scale + M[1, 2])
    drawn = []
    for e in sorted(eyes, key=lambda e: e["x"]):
        patch = img[int(e["y"] - e["r"] * 2.2):int(e["y"] + e["r"] * 2.2), int(e["x"] - e["r"] * 2.6):int(e["x"] + e["r"] * 2.6)].reshape(-1, 3)
        dark = patch[patch.sum(axis=1) < 200]
        b, g, r = dark.mean(axis=0) if len(dark) else (31, 26, 25)
        ex, ey = at(e["x"], e["y"])
        drawn.append(f'[{ex:.0f}, {ey:.0f}, {e["r"] * scale:.1f}, "#{int(r):02x}{int(g):02x}{int(b):02x}"]')
    fx0, fy0 = at(x0, y0)
    fx1, fy1 = at(x1, y1)
    key = f'"{name}"' if "-" in name else name
    print(f'  {key}: {{ eyes: [{", ".join(drawn)}], box: [{fx0:.0f}, {fy0:.0f}, {fx1:.0f}, {fy1:.0f}]{", large: true" if large else ""} }},')


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], "--large" in sys.argv)
