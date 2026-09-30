#!/usr/bin/env node
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Turns ONE angled, background-free photo of a dish in a round bowl (ramen, pho, curry, rice
 * bowls) into the data the viewer needs to rebuild it as real 3D (src/bowl.ts):
 *
 *   1. Camera angle — the round rim shows up as an ellipse; its height/width is the sine of the
 *      camera's elevation. The rim's centre and size come from fitting that ellipse to the
 *      bowl's outline, row by row, in the upper half (where the outline IS the rim).
 *   2. Bowl shape — below the rim, the outline's half-width on each row is the bowl's radius at
 *      that depth (a turned shape's widest point on each ring sits on its left/right edge). The
 *      bowl's depth is solved so the foot's front edge lands exactly on the photo's bottom.
 *   3. Texture — the photo itself. The viewer projects it back onto the 3D bowl from this same
 *      camera angle, so every pixel lands on the part of the bowl it came from.
 *
 * Usage:  npm run make-bowl -- tonkotsu-ramen --photo=../biteme/public/menu/tonkotsu-ramen.webp
 * Output: public/bowls/<dish>.webp (the texture) and prints the "bowl" entry for dishes.json.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , dish, ...rest] = process.argv;
const flag = (name, fallback) => {
  const hit = rest.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const photo = flag("photo", null);
if (!dish || !photo) {
  console.error("Usage: npm run make-bowl -- <dish> --photo=<transparent angled photo of a bowl dish>");
  process.exit(1);
}

const { data, info } = await sharp(path.resolve(root, photo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const opaque = (x, y) => data[(y * W + x) * C + 3] > 128;

// outline: left/right edge of the dish on every row
const rows = [];
let top = H, bottom = 0;
for (let y = 0; y < H; y++) {
  let l = -1, r = -1;
  for (let x = 0; x < W; x++) if (opaque(x, y)) { if (l < 0) l = x; r = x; }
  rows.push(l < 0 ? null : { l, r, hw: (r - l + 1) / 2, mid: (l + r) / 2 });
  if (l >= 0) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
}
const valid = rows.map((r, y) => (r ? { ...r, y } : null)).filter(Boolean);
const widest = valid.reduce((a, b) => (b.hw > a.hw ? b : a));
const a = widest.hw; // rim radius in px
const cx = widest.mid;

// Fit the rim ellipse on the upper outline: a row y above the centre has half-width
// hw = a·sqrt(1 − ((cy − y)/b)²)  ⇒  y = cy − b·q  with  q = sqrt(1 − (hw/a)²).
// Linear least squares in (cy, b), using rows well clear of the very top (garnish sticking up
// above the rim, like nori, would bend the fit) and of the widest row (q ≈ 0 is noise).
const pts = valid.filter((r) => r.y < widest.y && r.hw / a > 0.55 && r.hw / a < 0.97).map((r) => [Math.sqrt(1 - (r.hw / a) ** 2), r.y]);
const n = pts.length;
const sq = pts.reduce((s, [q]) => s + q, 0), sy = pts.reduce((s, [, y]) => s + y, 0);
const sqq = pts.reduce((s, [q]) => s + q * q, 0), sqy = pts.reduce((s, [q, y]) => s + q * y, 0);
const slope = (n * sqy - sq * sy) / (n * sqq - sq * sq); // = −b
const cy = (sy - slope * sq) / n;
const b = -slope;
const elevation = Math.asin(Math.min(0.999, b / a));
const cosE = Math.cos(elevation), sinE = Math.sin(elevation);

// Bowl shape below the rim. Each horizontal ring of the bowl (depth t below the rim, radius r)
// appears as an ellipse centred on row y(t) = cy + a·t·cosE, with semi-axes r·a and r·a·sinE.
// The outline is the UNION of all those ellipses, so reading the radius straight off the outline
// at y(t) overestimates it near the bottom (there the outline is the front curve of wider rings
// above). Instead: the true radius is the LARGEST ring that still fits inside the outline —
// every ring of a real bowl touches the outline somewhere.
const hwAt = (y) => (y >= 0 && y < H && rows[y] ? rows[y].hw : 0);
const fits = (t, r) => {
  const yc = cy + a * t * cosE, A = r * a, B = r * a * sinE;
  for (let y = Math.ceil(yc - B); y <= Math.floor(yc + B); y++) {
    const half = A * Math.sqrt(Math.max(0, 1 - ((y - yc) / B) ** 2));
    if (half > hwAt(y) + 2) return false; // 2 px tolerance for anti-aliased edges
  }
  return true;
};
const radiusAt = (t) => {
  let lo = 0, hi = 1;
  for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (fits(t, mid)) lo = mid; else hi = mid; }
  return lo;
};
// the bowl's depth T: the SHALLOWEST ring whose front edge reaches the photo's bottom row — the
// foot. (A tiny ring much deeper also touches that row; that "cone" solution is not a bowl.)
let T = 0.2;
for (let t = 0.2; t < 2.5; t += 0.004) {
  const r = radiusAt(t);
  if (r < 0.05) break;
  if (cy + a * (t * cosE + r * sinE) >= bottom - 2) { T = t; break; }
}
const STEPS = 9;
const outer = [];
for (let i = 0; i <= STEPS; i++) {
  const t = (T * i) / STEPS;
  outer.push([+Math.min(1, radiusAt(t) || radiusAt(t - 0.01)).toFixed(4), +t.toFixed(4)]); // [radius, depth below rim]
}

// Texture: the photo, made fully opaque by bleeding the bowl's edge colours outward into the
// transparent background. The 3D bowl's silhouette never matches the photo's to the pixel, and
// wherever it overshoots it would otherwise sample empty background and show a hole.
const px = Buffer.from(data);
const isSet = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) isSet[i] = px[i * C + 3] > 200 ? 1 : 0;
for (let pass = 0; pass < 24; pass++) {
  const next = isSet.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (isSet[i]) continue;
      let r = 0, g = 0, bl = 0, k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!isSet[j]) continue;
        r += px[j * C]; g += px[j * C + 1]; bl += px[j * C + 2]; k++;
      }
      if (k) { px[i * C] = r / k; px[i * C + 1] = g / k; px[i * C + 2] = bl / k; next[i] = 1; }
    }
  isSet.set(next);
}
for (let i = 0; i < W * H; i++) px[i * C + 3] = 255;

fs.mkdirSync(path.join(root, "public", "bowls"), { recursive: true });
const out = path.join(root, "public", "bowls", `${dish}.webp`);
await sharp(px, { raw: { width: W, height: H, channels: C } }).webp({ quality: 90, effort: 6 }).toFile(out);

const entry = {
  texture: `/bowls/${dish}.webp`,
  image: [W, H],
  center: [+cx.toFixed(1), +cy.toFixed(1)],
  radiusPx: +a.toFixed(1),
  elevationDeg: +((elevation * 180) / Math.PI).toFixed(2),
  depth: +T.toFixed(3),
  outer,
};
console.log(`✓ ${path.relative(root, out)}`);
console.log(`  camera ~${entry.elevationDeg}° above the table · rim centre (${entry.center}) radius ${entry.radiusPx}px · bowl depth ${entry.depth} × rim radius · fit on ${n} rows`);
console.log(`\n  "bowl": ${JSON.stringify(entry)}`);
