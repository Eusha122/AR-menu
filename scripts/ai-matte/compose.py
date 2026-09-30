"""Assemble matted frames into the AR viewer's side-by-side video frames.

    python compose.py <workdir> [--alpha alpha_clean] [--start N --end N --xfade K]

- Crops every frame to the UNION of the dish's footprint across the clip (padded a little), so
  the bottom of the frame is the bottom of the dish.
- Left half: edge-decontaminated colour. Right half: the matte as greyscale.

Looping:
- Default (no --start/--end): all frames except the last. Use this when the clip was generated
  with end frame = start frame: keeping both would show the same pose twice at the loop point.
- --start/--end: keep only frames START..END (their file numbers). For clips whose beginning
  must go — e.g. an AI "ease-in" where the turn starts slowly, which stutters on every loop.
  --xfade K then hides the leftover seam: the last K frames blend progressively into the K frames
  just BEFORE the start (START-K..START-1), so the final frame flows straight into frame START.
  Those K lead-in frames must have been matted too.
"""
import argparse
from pathlib import Path
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("root", type=Path)
ap.add_argument("--alpha", default="alpha_clean", help="matte folder: alpha_clean (after cleanup.py) or alpha")
ap.add_argument("--start", type=int)
ap.add_argument("--end", type=int)
ap.add_argument("--xfade", type=int, default=0)
args = ap.parse_args()
root = args.root
alpha_dir = root / args.alpha
out = root / "sbs"
out.mkdir(exist_ok=True)
for old in out.glob("*.png"):
    old.unlink()

def name(n: int) -> str:
    return f"{n:03d}.png"

available = sorted(int(p.stem) for p in alpha_dir.glob("*.png"))
if args.start is None:
    keep = available[:-1]
else:
    keep = [n for n in available if args.start <= n <= (args.end if args.end is not None else available[-1])]
lead = [args.start - args.xfade + i for i in range(args.xfade)] if args.start is not None and args.xfade else []
missing = [n for n in keep + lead if n not in available]
if missing:
    raise SystemExit(f"missing matted frames: {missing[:8]}…")

# crop box: union of the dish over every frame that will be shown (incl. crossfade lead-ins)
union = None
for n in keep + lead:
    m = np.asarray(Image.open(alpha_dir / name(n))) > 6
    union = m if union is None else (union | m)
ys, xs = np.where(union)
pad = 12
h, w = union.shape
x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad, w - 1)
y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad, h - 1)
cw = (x1 - x0 + 1) // 2 * 2  # even dimensions for H.264
ch = (y1 - y0 + 1) // 2 * 2
box = (x0, y0, x0 + cw, y0 + ch)
print("crop", box, f"{cw}x{ch}", flush=True)


def load(n: int):
    rgb = np.asarray(Image.open(root / "rgb" / name(n)).convert("RGB").crop(box), dtype=np.float32)
    a = np.asarray(Image.open(alpha_dir / name(n)).convert("L").crop(box), dtype=np.float32)
    return rgb, a


K = len(lead)
for i, n in enumerate(keep, start=1):
    rgb, a = load(n)
    tail = len(keep) - i  # frames left after this one
    if tail < K:
        # blend weight ramps up to K/(K+1) on the final frame; frame START follows with weight 1
        wgt = (K - tail) / (K + 1)
        rgb2, a2 = load(lead[K - 1 - tail])
        # blend premultiplied colour so edges don't halo, then un-premultiply
        pa = a * (1 - wgt) + a2 * wgt
        prem = rgb * (a[..., None] / 255) * (1 - wgt) + rgb2 * (a2[..., None] / 255) * wgt
        rgb = np.where(pa[..., None] > 1, prem / np.maximum(pa[..., None] / 255, 1e-3), 0)
        a = pa
    frame = np.concatenate([np.clip(rgb, 0, 255), np.repeat(np.clip(a, 0, 255)[..., None], 3, axis=2)], axis=1)
    Image.fromarray(frame.astype(np.uint8)).save(out / f"{i:03d}.png")
print("frames", len(keep), "| crossfade", K)
