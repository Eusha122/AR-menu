"""Assemble matted frames into the AR viewer's side-by-side video frames.

- Crops every frame to the UNION of the dish's footprint across the whole clip (padded a little),
  so the bottom of the frame is the bottom of the dish — the viewer stands the frame on the
  coaster by its bottom edge.
- Left half: edge-decontaminated colour. Right half: the cleaned matte as greyscale.
- Drops the last frame: the clip was generated with end frame = start frame, so keeping both
  would show the same pose twice at the loop point (a visible hitch).
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image

root = Path(sys.argv[1])
out = root / "sbs"
out.mkdir(exist_ok=True)
names = sorted(p.name for p in (root / "alpha_clean").glob("*.png"))

union = None
for n in names:
    m = np.asarray(Image.open(root / "alpha_clean" / n)) > 6
    union = m if union is None else (union | m)
ys, xs = np.where(union)
pad = 12
h, w = union.shape
x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, w - 1)
y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, h - 1)
# even dimensions for H.264
cw = (x1 - x0 + 1) // 2 * 2
ch = (y1 - y0 + 1) // 2 * 2
box = (x0, y0, x0 + cw, y0 + ch)
print("crop", box, f"{cw}x{ch}", flush=True)

for i, n in enumerate(names[:-1], start=1):
    rgb = Image.open(root / "rgb" / n).convert("RGB").crop(box)
    a = Image.open(root / "alpha_clean" / n).convert("L").crop(box).convert("RGB")
    frame = Image.new("RGB", (cw * 2, ch))
    frame.paste(rgb, (0, 0))
    frame.paste(a, (cw, 0))
    frame.save(out / f"{i:03d}.png")
print("frames", len(names) - 1)
