#!/usr/bin/env node
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inscribedRadius, opaqueTexture, outline } from "./lib/photo.mjs";

/*
 * Turns ONE background-free side photo of a round, stacked dish (burger, layered dessert) into the
 * data the viewer needs to rebuild it as real 3D (src/dish3d.ts, kind "stack"):
 *
 *   A round object is a stack of horizontal rings. Photographed from a camera `e` degrees above the
 *   table, each ring appears as an ellipse (semi-axes r·a and r·a·sin e) centred on its own row,
 *   and the photo's outline is the union of all of them. For each row, the ring that really sits
 *   there is the LARGEST one that still fits inside the outline (shared/inscribed-ring method).
 *
 *   The camera angle isn't visible directly (no rim). The outline alone can't settle it: a low
 *   angle explains the curved bottom of the bun just as well by tapering the bun to a narrow point.
 *   So it's solved with what a real bun looks like: the angle is chosen so the flat base the dish
 *   stands on is BASE_RATIO of the bottom layer's widest radius (a bun's rounded bottom).
 *
 * Usage:  npm run make-stack -- signature-smash --photo=../biteme/public/menu/signature-smash.webp
 * Output: public/stacks/<dish>.webp (texture) and prints the "stack" entry for dishes.json.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , dish, ...rest] = process.argv;
const flag = (name, fallback) => {
  const hit = rest.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const photo = flag("photo", null);
if (!dish || !photo) {
  console.error("Usage: npm run make-stack -- <dish> --photo=<transparent side photo of a round stacked dish>");
  process.exit(1);
}

const { data, info } = await sharp(path.resolve(root, photo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const { rows, cx, top, bottom } = outline(data, W, H, C);
const a = Math.max(...rows.filter(Boolean).map((r) => r.hw)); // 1 unit = the widest radius, in px

const BASE_RATIO = Number(flag("base", "0.7"));

function fitAt(eDeg) {
  const sinE = Math.sin((eDeg * Math.PI) / 180);
  const rings = [];
  for (let y = top; y <= bottom; y += 2) rings.push({ y, r: inscribedRadius(rows, a, sinE, y) });
  // base: the highest ring whose front edge reaches the photo's bottom (the bottom of the bun)
  const base = rings.find((g) => g.r > 0.25 && g.y + g.r * a * sinE >= bottom - 3) ?? rings[rings.length - 1];
  const used = rings.filter((g) => g.y <= base.y && g.r > 0.01);
  // redraw the union of those rings and compare with the photo's outline
  const half = new Float32Array(H);
  for (const g of used) {
    const A = g.r * a, B = Math.max(g.r * a * sinE, 0.5);
    for (let y = Math.ceil(g.y - B); y <= Math.floor(g.y + B); y++)
      if (y >= 0 && y < H) half[y] = Math.max(half[y], A * Math.sqrt(Math.max(0, 1 - ((y - g.y) / B) ** 2)));
  }
  let inter = 0, uni = 0;
  for (let y = 0; y < H; y++) {
    const p = rows[y] ? rows[y].hw : 0;
    inter += Math.min(p, half[y]);
    uni += Math.max(p, half[y]);
  }
  const height = (base.y - used[0].y) / (a * Math.cos((eDeg * Math.PI) / 180));
  const zOf = (g) => (base.y - g.y) / (a * Math.cos((eDeg * Math.PI) / 180));
  const bottomMax = Math.max(...used.filter((g) => zOf(g) < 0.3 * height).map((g) => g.r));
  return { eDeg, iou: inter / uni, base, used, ratio: base.r / bottomMax };
}

let best = null;
for (let e = 6; e <= 34; e += 1) {
  const f = fitAt(e);
  if (!best || Math.abs(f.ratio - BASE_RATIO) < Math.abs(best.ratio - BASE_RATIO)) best = f;
}
const e = (best.eDeg * Math.PI) / 180;
const yb = best.base.y; // image row of the base ring's centre (height 0)

// profile from the base up to the apex: [radius, height], heights in units of `a`
const pts = best.used
  .slice()
  .reverse() // bottom → top
  .map((g) => [g.r, (yb - g.y) / (a * Math.cos(e))]);
/*
 * The top: rings near the very top are fitted from the photo's top EDGE, which at this camera
 * angle is the back slope of the bun, not its crown — they taper to a point (an onion dome).
 * Every bun is a smooth dome, so above the top layer's widest point the profile is replaced by
 * a quarter-ellipse, tall enough that its projected outline reaches the photo's top row.
 */
const sinE = Math.sin(e), cosE = Math.cos(e);
const zMax = pts[pts.length - 1][1];
let iTop = pts.length - 1;
for (let i = pts.length - 1; i >= 0 && pts[i][1] > zMax * 0.55; i--) if (pts[i][0] > pts[iTop][0]) iTop = i;
const [R, z0] = pts[iTop];
const domeTopRow = (Hd) => {
  let row = Infinity;
  for (let k = 0; k <= 60; k++) {
    const z = z0 + (Hd * k) / 60;
    const r = R * Math.sqrt(Math.max(0, 1 - ((z - z0) / Hd) ** 2));
    row = Math.min(row, yb - a * z * cosE - a * r * sinE); // highest point of that ring on screen
  }
  return row;
};
let Hd = 0.05;
while (Hd < 3 && domeTopRow(Hd) > top) Hd += 0.005;
const dome = [];
for (let k = 1; k <= 16; k++) {
  const t = k / 16;
  dome.push([R * Math.sqrt(Math.max(0, 1 - t * t)), z0 + Hd * t]);
}
const shaped = [...pts.slice(0, iTop + 1), ...dome];

// thin to ~48 points, keep the ends
const STEP = Math.max(1, Math.floor(shaped.length / 48));
const profile = shaped.filter((_, i) => i % STEP === 0 || i >= shaped.length - 17).map(([r, z]) => [+r.toFixed(4), +z.toFixed(4)]);

fs.mkdirSync(path.join(root, "public", "stacks"), { recursive: true });
const out = path.join(root, "public", "stacks", `${dish}.webp`);
await sharp(opaqueTexture(data, W, H, C), { raw: { width: W, height: H, channels: C } }).webp({ quality: 90, effort: 6 }).toFile(out);

const entry = {
  texture: `/stacks/${dish}.webp`,
  image: [W, H],
  base: [+cx.toFixed(1), yb],
  radiusPx: +a.toFixed(1),
  elevationDeg: best.eDeg,
  profile,
};
const height = profile[profile.length - 1][1];
console.log(`✓ ${path.relative(root, out)}`);
console.log(`  camera ~${best.eDeg}° above the table · base ${(best.ratio * 100).toFixed(0)}% of the bottom layer · outline match ${(best.iou * 100).toFixed(1)}% · ${height.toFixed(2)}× as tall as its radius`);
console.log(`\n  "stack": ${JSON.stringify(entry)}`);
