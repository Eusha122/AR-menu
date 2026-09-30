"""Clean a matte: remove the blocky dark compression band Kling leaves around the crust.

The band is a continuous ring hugging the silhouette, so shape-only filters (opening) keep it — it
IS the outline to them. What distinguishes it is colour: the blocks are dark grey, the real crust
edge is bright baked dough. So peel the silhouette from the outside in, one pixel layer at a time,
removing only DARK boundary pixels, and stop the moment the boundary is bright crust everywhere.
Interior dark details (charred spots, mushrooms) are never touched — they aren't on the boundary.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

root = Path(sys.argv[1])
dark = int(sys.argv[2]) if len(sys.argv) > 2 else 110  # brightest channel below this = "dark"
max_layers = int(sys.argv[3]) if len(sys.argv) > 3 else 40
only = sys.argv[4] if len(sys.argv) > 4 else None
(root / "alpha_clean").mkdir(exist_ok=True)


def erode4(m):
    e = m.copy()
    e[1:, :] &= m[:-1, :]
    e[:-1, :] &= m[1:, :]
    e[:, 1:] &= m[:, :-1]
    e[:, :-1] &= m[:, 1:]
    return e


files = sorted((root / "alpha").glob("*.png"))
if only:
    files = [f for f in files if f.stem == only]
for f in files:
    alpha = np.asarray(Image.open(f).convert("L"), dtype=np.float32)
    src = np.asarray(Image.open(root / "src" / f.name).convert("RGB")).astype(np.float32)
    mx, mn = src.max(axis=2), src.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    # "block" pixels: dark, OR greyish (baked dough is warm tan — clearly saturated)
    is_dark = (mx < dark) | ((sat < 0.22) & (mx < 190))
    keep = alpha > 127
    peeled = 0
    for _ in range(max_layers):
        boundary = keep & ~erode4(keep)
        drop = boundary & is_dark
        if not drop.any():
            break
        keep &= ~drop
        peeled += int(drop.sum())
    # the dish is one piece: drop every floating crumb of leftover block
    labels, n = ndimage.label(keep)
    if n > 1:
        sizes = ndimage.sum(keep, labels, range(1, n + 1))
        keep = labels == (int(np.argmax(sizes)) + 1)
    # snip the last thin block fingers still attached to the edge, then fill any pinholes
    keep = ndimage.binary_opening(keep, structure=np.ones((13, 13)))
    keep = ndimage.binary_fill_holes(keep)
    # soft edge on the peel line so it doesn't look cut with scissors; never adds alpha
    soft = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.2)), dtype=np.float32)
    out = np.minimum(alpha, soft)
    Image.fromarray(out.astype(np.uint8)).save(root / "alpha_clean" / f.name)
    print(f.name, "peeled", peeled, flush=True)
