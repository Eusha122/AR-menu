/*
 * Shared helpers for turning ONE background-free dish photo into a 3D-ready texture and outline.
 * Used by make-bowl.mjs (bowls, plates, glasses, cups) and make-stack.mjs (burgers).
 */

/**
 * The dish's outline, one entry per image row: the left/right edge of the run of opaque pixels
 * that contains the dish's centre column, measured SYMMETRICALLY around that centre (the nearer
 * edge wins). A round dish is symmetric, so anything sticking out on one side only — a side bowl
 * of raita, a spoon, chopsticks, a nori sheet, a pot handle — is ignored instead of making the dish
 * look wider. Rows the centre column doesn't cross are null.
 */
export function outline(data, W, H, C) {
  const opaque = (x, y) => data[(y * W + x) * C + 3] > 128;
  // centre column: median midpoint of the widest-half rows (robust to one-sided clutter)
  const raw = [];
  for (let y = 0; y < H; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < W; x++) if (opaque(x, y)) { if (l < 0) l = x; r = x; }
    raw.push(l < 0 ? null : { l, r });
  }
  const widths = raw.filter(Boolean).map((v) => v.r - v.l);
  const wMax = Math.max(...widths);
  const mids = raw.filter((v) => v && v.r - v.l > wMax * 0.6).map((v) => (v.l + v.r) / 2).sort((a, b) => a - b);
  const cx = mids[Math.floor(mids.length / 2)];
  const c = Math.round(cx);

  const rows = [];
  let top = H, bottom = 0;
  for (let y = 0; y < H; y++) {
    if (!opaque(c, y)) { rows.push(null); continue; }
    let l = c, r = c;
    while (l > 0 && opaque(l - 1, y)) l--;
    while (r < W - 1 && opaque(r + 1, y)) r++;
    const hw = Math.min(cx - l, r - cx) + 0.5;
    rows.push({ l, r, hw });
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  // thin protrusions that DO cross the centre line on both sides (pot handles) are trimmed by
  // smoothing: a row can't be much wider than the median of its neighbourhood
  const hws = rows.map((v) => (v ? v.hw : 0));
  for (let y = top; y <= bottom; y++) {
    if (!rows[y]) continue;
    const win = [];
    for (let k = -6; k <= 6; k++) if (hws[y + k] !== undefined) win.push(hws[y + k]);
    win.sort((a, b) => a - b);
    rows[y].hw = Math.min(rows[y].hw, win[Math.floor(win.length / 2)] * 1.04);
  }
  return { rows, cx, top, bottom };
}

/**
 * The photo as a fully opaque texture: the dish's edge colours are bled outward into the
 * transparent background. The 3D shape's silhouette never matches the photo's to the pixel, and
 * wherever it overshoots it would otherwise sample empty background and show a hole.
 */
export function opaqueTexture(data, W, H, C) {
  const px = Buffer.from(data);
  const isSet = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) isSet[i] = px[i * C + 3] > 200 ? 1 : 0;
  for (let pass = 0; pass < 24; pass++) {
    const next = isSet.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (isSet[i]) continue;
        let r = 0, g = 0, b = 0, k = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (!isSet[j]) continue;
          r += px[j * C]; g += px[j * C + 1]; b += px[j * C + 2]; k++;
        }
        if (k) { px[i * C] = r / k; px[i * C + 1] = g / k; px[i * C + 2] = b / k; next[i] = 1; }
      }
    isSet.set(next);
  }
  for (let i = 0; i < W * H; i++) px[i * C + 3] = 255;
  return px;
}

/**
 * Largest ring (horizontal circle of the dish) centred on image row `yc` that fits inside the
 * outline, seen from `elevation`: it appears as an ellipse with semi-axes r·a and r·a·sin(e).
 * The outline is the UNION of all the dish's rings, so the inscribed ring is the true radius.
 */
export function inscribedRadius(rows, a, sinE, yc) {
  const H = rows.length;
  const hwAt = (y) => (y >= 0 && y < H && rows[y] ? rows[y].hw : 0);
  const fits = (r) => {
    const A = r * a, B = Math.max(r * a * sinE, 0.5);
    for (let y = Math.ceil(yc - B); y <= Math.floor(yc + B); y++) {
      const half = A * Math.sqrt(Math.max(0, 1 - ((y - yc) / B) ** 2));
      if (half > hwAt(y) + 2) return false; // 2 px tolerance for anti-aliased edges
    }
    return true;
  };
  let lo = 0, hi = 1.05;
  for (let k = 0; k < 22; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
  return lo;
}
