#!/usr/bin/env node
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Turns an ANGLED, background-free photo of a round flat dish (pizza, thali, flatbread…) into a
 * straight-down "top view" texture for the AR viewer's disc mode.
 *
 * A round dish photographed from an angle appears as an ellipse: its height/width ratio is the
 * sine of the camera's elevation. Stretching it back vertically by width/height turns the ellipse
 * into a circle — the dish seen from directly above. The viewer maps that onto a 3D pizza shape
 * lying on the table and turns it; the phone's real viewing angle then supplies the perspective,
 * so it looks right from any angle. (Spinning the angled photo itself would just spin an oval
 * like a sticker — the front crust would swing to the top.)
 *
 * Usage:  npm run make-disc -- margherita --photo=../biteme/public/menu/margherita.webp
 * Output: public/discs/<dish>.webp  (1024×1024, dish filling a centred circle, transparent outside)
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , dish, ...rest] = process.argv;
const flag = (name, fallback) => {
  const hit = rest.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const photo = flag("photo", null);
if (!dish || !photo) {
  console.error("Usage: npm run make-disc -- <dish> --photo=<transparent angled photo of a round dish>");
  process.exit(1);
}

const SIZE = 1024; // output texture
const MARGIN = 6; // px of transparent border so mipmaps don't bleed the edge

const src = sharp(path.resolve(root, photo)).ensureAlpha();
const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
const { width: w, height: h, channels: c } = info;

// the dish's footprint: bounding box of clearly-opaque pixels
let x0 = w, x1 = 0, y0 = h, y1 = 0;
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++)
    if (data[(y * w + x) * c + 3] > 128) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
const bw = x1 - x0 + 1;
const bh = y1 - y0 + 1;
const elevation = (Math.asin(Math.min(1, bh / bw)) * 180) / Math.PI;

// crop to the dish, stretch the ellipse into a circle, fit it into the texture
const d = SIZE - MARGIN * 2;
const circle = await src
  .extract({ left: x0, top: y0, width: bw, height: bh })
  .resize(d, d, { fit: "fill", kernel: "lanczos3" })
  .raw()
  .toBuffer();

/*
 * Even out the crust. The angled photo shows the FRONT crust's outer wall too, so after the
 * un-tilt the crust band is thicker at the bottom than at the top — and as the dish turns, that
 * thick band would visibly swing around. Measure the crust depth on each side (median over many
 * scan lines, classifying pixels as crust = tan/brown/charred vs topping = sauce/cheese/basil),
 * then remap rows so the top and bottom bands are equal. Left/right are already symmetric: the
 * tilt is only vertical.
 */
const isTopping = (i) => {
  const [R, G, B, A] = [circle[i], circle[i + 1], circle[i + 2], circle[i + 3]];
  if (A < 200) return false;
  const red = R > 150 && R - G > 80; // tomato sauce
  const cheese = R > 205 && G > 195 && B > 170 && R - B < 45; // mozzarella / cream
  const green = G > R + 8 && G > B; // basil / herbs
  return red || cheese || green;
};
function crustDepth(side) {
  const depths = [];
  for (let k = -40; k <= 40; k += 4) {
    const line = Math.round(d / 2 + (k / 100) * d * 0.5); // scan lines across the middle 40%
    let edge = -1;
    let run = 0;
    for (let s = 0; s < d / 2; s++) {
      const [x, y] =
        side === "top" ? [line, s] : side === "bottom" ? [line, d - 1 - s] : side === "left" ? [s, line] : [d - 1 - s, line];
      const i = (y * d + x) * 4;
      if (edge < 0) {
        if (circle[i + 3] > 128) edge = s;
        continue;
      }
      if (isTopping(i)) {
        if (++run >= 6) {
          depths.push(s - 5 - edge);
          break;
        }
      } else run = 0;
    }
  }
  depths.sort((a, b) => a - b);
  return depths[Math.floor(depths.length / 2)] ?? 0;
}
const crust = { top: crustDepth("top"), bottom: crustDepth("bottom"), left: crustDepth("left"), right: crustDepth("right") };
// The reference is the LEFT/RIGHT crust: the tilt is vertical, so the sides are undistorted
// (and they agree with each other). Only the BOTTOM is corrected — it's the side the camera saw
// the crust's outer wall on. The top isn't touched: pale crust there can read as cheese and make
// its measurement unreliable, and stretching it on a bad reading pulled char spots into points.
const target = Math.round((crust.left + crust.right) / 2);
if (crust.bottom - target > 6) {
  // piecewise-linear row remap: [0, d-bottom] → [0, d-target], [d-bottom, d] → [d-target, d]
  const knotsOut = [0, d - target, d];
  const knotsIn = [0, d - crust.bottom, d];
  const srcRowFor = (yo) => {
    for (let k = 0; k < 2; k++)
      if (yo <= knotsOut[k + 1]) return knotsIn[k] + ((yo - knotsOut[k]) / (knotsOut[k + 1] - knotsOut[k])) * (knotsIn[k + 1] - knotsIn[k]);
    return d - 1;
  };
  const copy = Buffer.from(circle);
  for (let yo = 0; yo < d; yo++) {
    const ys = Math.min(d - 1, Math.max(0, srcRowFor(yo + 0.5) - 0.5));
    const a = Math.floor(ys);
    const b = Math.min(d - 1, a + 1);
    const t = ys - a;
    for (let x = 0; x < d; x++)
      for (let ch = 0; ch < 4; ch++) {
        const o = (yo * d + x) * 4 + ch;
        circle[o] = Math.round(copy[(a * d + x) * 4 + ch] * (1 - t) + copy[(b * d + x) * 4 + ch] * t);
      }
  }
}
console.log(`  crust depth (px of ${d}): ${JSON.stringify(crust)} → bottom crust matched to the sides (${target})`);

// clean circular edge: whatever the stretch left just outside the circle is removed, with a
// 1.5 px soft falloff so the rim isn't stair-stepped
const r = d / 2;
for (let y = 0; y < d; y++)
  for (let x = 0; x < d; x++) {
    const dist = Math.hypot(x + 0.5 - r, y + 0.5 - r);
    const edge = Math.min(1, Math.max(0, (r - dist) / 1.5));
    const i = (y * d + x) * 4 + 3;
    circle[i] = Math.round(circle[i] * edge);
  }

fs.mkdirSync(path.join(root, "public", "discs"), { recursive: true });
const out = path.join(root, "public", "discs", `${dish}.webp`);
await sharp(circle, { raw: { width: d, height: d, channels: 4 } })
  .extend({ top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(out);

console.log(`✓ ${path.relative(root, out)} — photo was taken from ~${elevation.toFixed(0)}° above the table; un-tilted to top-down`);
