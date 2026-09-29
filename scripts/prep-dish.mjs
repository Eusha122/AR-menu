#!/usr/bin/env node
import ffmpeg from "ffmpeg-static";
import sharp from "sharp";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Turns one raw AI-generated clip (a dish rotating in place, camera fixed) into the side-by-side
 * RGB+matte video the AR viewer expects (see src/main.ts's shader comment for why that format,
 * instead of a real alpha-channel video, is what makes this work on every phone).
 *
 * Usage:
 *   npm run prep-dish -- truffle-pizza                     (mask mode, the default — see below)
 *   npm run prep-dish -- truffle-pizza --cy=0.5 --ry=0.38   (nudge the mask to fit the framing)
 *   npm run prep-dish -- truffle-pizza --mode=key --sim=0.18 --blend=0.06
 *
 * Input:  raw/<dish>.mp4        (you put the AI-generated clip here)
 * Output: public/videos/<dish>.mp4
 *
 * TWO WAYS TO CUT OUT THE BACKGROUND — read this before tuning blindly:
 *
 * "mask" (the default): a fixed, feathered oval, applied identically to every frame, no per-pixel
 * color decision at all. This is what actually worked for the first real clip generated for this
 * project: the AI's "pure black background" turned out to be a soft vignette (brighter right
 * around the dish, fading to black only at the far corners), and ANY color/luma threshold wide
 * enough to key out that whole vignette was also wide enough to key out the dish's own dark
 * details (mushrooms, herb shadows) as holes. A shape-only mask sidesteps that entirely.
 * This assumes the dish's on-screen footprint stays roughly the same size/position through the
 * whole rotation — true for a turntable shot with a fixed camera on a round dish, since a circle
 * viewed at a fixed angle looks like the same ellipse no matter how it spins. It will need
 * per-dish --cx/--cy/--rx/--ry nudging (fractions of the frame, 0–1) to fit each clip's framing,
 * and won't fit a dish whose silhouette genuinely changes shape as it turns (e.g. an asymmetric
 * plate with garnish sticking out one side).
 *
 * "key": the more familiar approach — ffmpeg's colorkey filter plus a median-filter cleanup pass
 * for the holes it punches in dark food details. Use this if a clip's background really is flat
 * enough for it, or for a dish whose footprint changes too much across the rotation for a static
 * mask to fit. --sim/--blend tune the keying; --median tunes the hole cleanup. There's no
 * universal setting — always preview.
 *
 * --trim cuts the clip to an exact loop first, in case the AI generation has a second or two of
 * lead-in/lead-out that isn't part of the clean 360° rotation.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , dish, ...flags] = process.argv;

if (!dish) {
  console.error("Usage: npm run prep-dish -- <dish-slug> [--mode=mask|key] [--trim=start:end] ...(see file header)");
  process.exit(1);
}

const flag = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const mode = flag("mode", "mask");
const trim = flag("trim", null);

const inFile = path.join(root, "raw", `${dish}.mp4`);
const outFile = path.join(root, "public", "videos", `${dish}.mp4`);
const maskFile = path.join(root, ".cache", `${dish}-mask.png`);

if (!fs.existsSync(inFile)) {
  console.error(`Missing ${path.relative(root, inFile)}.`);
  console.error(`Put the raw AI-generated clip (dish rotating, camera fixed) there first.`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });

/** Probes the input's resolution — the mask has to be pixel-for-pixel the same size to hstack. */
function probeSize() {
  const r = spawnSync(ffmpeg, ["-i", inFile], { encoding: "utf8" });
  const m = r.stderr.match(/, (\d{2,5})x(\d{2,5})(?:\s|,)/);
  if (!m) throw new Error(`Couldn't read the video's resolution from ffmpeg's output for ${inFile}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * A feathered oval: fully opaque (255) inside `inner` (as a fraction of rx/ry), fully transparent
 * (0) outside `outer`, smoothly blended between. Plain pixel math, not an SVG gradient — SVG's
 * radialGradient + gradientTransform for a non-circular ellipse is easy to get subtly wrong (it
 * was, the first time this was tried here) and hard to eyeball-verify; this is straightforward
 * enough to trust by inspection.
 */
async function buildMask({ width, height }, { cx, cy, rx, ry, inner, outer }) {
  const CX = cx * width,
    CY = cy * height,
    RX = rx * width,
    RY = ry * height;
  const buf = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = (x - CX) / RX,
        ny = (y - CY) / RY;
      const d = Math.sqrt(nx * nx + ny * ny);
      let v;
      if (d <= inner) v = 255;
      else if (d >= outer) v = 0;
      else v = Math.round(255 * (1 - (d - inner) / (outer - inner)));
      buf[y * width + x] = v;
    }
  }
  fs.mkdirSync(path.dirname(maskFile), { recursive: true });
  // sharp writes a single-channel buffer as an RGB PNG (R=G=B) unless told otherwise — that's
  // fine, ffmpeg reads it back as yuv420p either way, but don't assume it round-trips as 1
  // channel elsewhere (this exact mismatch corrupted an earlier version of this script's test).
  await sharp(buf, { raw: { width, height, channels: 1 } }).png().toFile(maskFile);
}

const args = ["-y"];
if (trim) {
  const [start, end] = trim.split(":");
  args.push("-ss", start, "-to", end);
}

if (mode === "mask") {
  const size = probeSize();
  await buildMask(size, {
    cx: Number(flag("cx", "0.5")),
    cy: Number(flag("cy", "0.53")),
    rx: Number(flag("rx", "0.47")),
    ry: Number(flag("ry", "0.42")),
    inner: Number(flag("inner", "0.72")),
    outer: Number(flag("outer", "1.05")),
  });
  args.push(
    "-i",
    inFile,
    "-loop",
    "1",
    "-i",
    maskFile,
    "-filter_complex",
    [
      // both branches pinned to yuv420p so hstack doesn't downgrade the color side to gray too
      "[0:v]scale=iw:ih,format=yuv420p[rgb]",
      "[1:v]scale=iw:ih,format=yuv420p[matte_rgb]",
      // shortest=1 IS ON THE FILTER ITSELF, not a global "-shortest" flag — the mask is a static
      // image looped as an infinite-duration input (-loop 1), and once hstack has already merged
      // both branches into one [out] stream, ffmpeg's global -shortest (which only compares
      // independent OUTPUT streams at the muxer) has nothing left to compare and does nothing.
      // Without this, the encode never stops on its own — it filled a hard drive to 100% and
      // then hung a second time on this exact bug before it was caught here.
      "[rgb][matte_rgb]hstack=inputs=2:shortest=1[out]",
    ].join(";"),
    "-map",
    "[out]",
  );
} else {
  const sim = flag("sim", "0.18");
  const blend = flag("blend", "0.06");
  const medianRadius = flag("median", "6");
  args.push(
    "-i",
    inFile,
    "-filter_complex",
    [
      "[0:v]scale=iw:ih,format=yuv420p[rgb]",
      // colorkey's output pixel format is ambiguous to the filter graph unless pinned explicitly —
      // without this, alphaextract fails with "could not choose their formats"
      `[0:v]colorkey=0x000000:${sim}:${blend},format=yuva420p[keyed]`,
      "[keyed]alphaextract[matte0]",
      // a sim wide enough to key a soft background also keys small dark food details as holes; a
      // median filter erases speckles smaller than its radius without moving the real background
      // edge (a morphological close needed enough iterations to fill these holes that it started
      // eating the real silhouette edge instead)
      `[matte0]median=radius=${medianRadius}[matte]`,
      "[matte]format=yuv420p[matte_rgb]",
      "[rgb][matte_rgb]hstack=inputs=2[out]",
    ].join(";"),
    "-map",
    "[out]",
    "-shortest",
  );
}

args.push("-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", outFile);

const res = spawnSync(ffmpeg, args, { stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`\n✓ ${path.relative(root, outFile)} (mode: ${mode})`);
console.log(`  Preview it before going further — the left half should be the dish, the right half a clean`);
console.log(`  black-and-white silhouette of it, with NO holes in the dish and NO leftover background glow.`);
if (mode === "mask") {
  console.log(`  Doesn't fit? Nudge --cx/--cy/--rx/--ry/--inner/--outer (see the file header) and re-run.`);
} else {
  console.log(`  Ragged edges or holes? Re-run with different --sim/--blend/--median values.`);
}
console.log(`\n  Next: add "${dish}" to public/dishes.json (if not already), then compile its AR target —`);
console.log(`  see public/tools/compile.html — into public/targets/${dish}.mind.`);
