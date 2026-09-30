"""Per-frame AI matte for a dish filmed on pure black.

For each frame: BiRefNet (via rembg) predicts a precise alpha matte. Then the edge colours are
"decontaminated": the clip's background is pure black, so every edge pixel is
    observed = alpha * dish_colour + (1 - alpha) * black  =>  dish_colour = observed / alpha
Dividing it back out removes the dark fringe that makes cut-outs look pasted on.
"""
import sys, time
from pathlib import Path
import numpy as np
from PIL import Image
from rembg import new_session, remove

root = Path(sys.argv[1])
only = sys.argv[2] if len(sys.argv) > 2 else None
model = sys.argv[3] if len(sys.argv) > 3 else "birefnet-general"

# CPU on purpose: BiRefNet at full resolution runs out of the RTX 5050's 8 GB through DirectML.
session = new_session(model, providers=["CPUExecutionProvider"])
frames = sorted((root / "src").glob("*.png"))
if only:
    frames = [f for f in frames if f.stem == only]
else:
    frames = [f for f in frames if not (root / "alpha" / f.name).exists()]  # resume-safe

for f in frames:
    t = time.time()
    img = Image.open(f).convert("RGB")
    mask = remove(img, session=session, only_mask=True)  # L-mode, 0..255
    a = np.asarray(mask, dtype=np.float32) / 255.0
    rgb = np.asarray(img, dtype=np.float32)

    # decontaminate edges (un-premultiply against the black background)
    safe = np.maximum(a, 1e-3)[..., None]
    fg = np.where(a[..., None] > 0.02, np.clip(rgb / safe, 0, 255), 0)

    Image.fromarray(fg.astype(np.uint8)).save(root / "rgb" / f.name)
    mask.save(root / "alpha" / f.name)
    print(f"{f.name} {time.time() - t:.1f}s", flush=True)
