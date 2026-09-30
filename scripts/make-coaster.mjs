#!/usr/bin/env node
import sharp from "sharp";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * Builds the printable table coaster for one dish: the dish's own photo (not a plain QR code
 * or logo) as the AR tracking image, framed and branded, with a small scan-me QR badge.
 *
 * Why the dish photo, not an abstract logo or a bare QR: MindAR (like all image-tracking AR)
 * needs an image with lots of unique, asymmetric detail to lock onto — sharp corners, uneven
 * texture, no repetition. A real food photo has exactly that. A plain logo or solid-color QR
 * quiet zone does not, and tracks noticeably worse.
 *
 * Usage:
 *   npm run make-coaster -- truffle-pizza --label="Truffle Pizza" --photo=../biteme/public/menu/truffle-pizza.webp
 *
 * Output: public/coasters/<dish>.png — a 1200x1200px (4x4in @ 300dpi) print-ready file, and
 * public/coasters/<dish>-preview.png, a smaller version for emails/screens.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , dish, ...rest] = process.argv;

if (!dish) {
  console.error('Usage: npm run make-coaster -- <dish-slug> --label="Dish Name" --photo=<path> --url=<ar page url>');
  process.exit(1);
}

const flag = (name, fallback) => {
  const hit = rest.find((f) => f.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const label = flag("label", dish);
const photo = flag("photo", null);
// QR target. Defaults to the live site; override with --url= or AR_SITE_URL for another deploy.
const site = (process.env.AR_SITE_URL ?? "https://ar-menu-xi-kohl.vercel.app").replace(/\/+$/, "");
const url = flag("url", `${site}/dish/${dish}`);

if (!photo || !fs.existsSync(path.resolve(root, photo))) {
  console.error(`--photo is required and must exist. Got: ${photo ?? "(none)"}`);
  console.error(`Tip: point it at the real menu photo, e.g. ../biteme/public/menu/${dish}.webp`);
  process.exit(1);
}

const SIZE = 1200; // 4in coaster at 300dpi
const PHOTO_INSET = 60;
const photoSize = SIZE - PHOTO_INSET * 2;

const outDir = path.join(root, "public", "coasters");
fs.mkdirSync(outDir, { recursive: true });

async function build() {
  const qrBuffer = await QRCode.toBuffer(url, { margin: 1, width: 260, color: { dark: "#2a1a10", light: "#faf3e700" } });

  const dishPhoto = await sharp(path.resolve(root, photo))
    .resize(photoSize, photoSize, { fit: "cover" })
    .toBuffer();

  const label_svg = Buffer.from(`
    <svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="56" fill="#f0e4d2"/>
      <rect x="${PHOTO_INSET - 14}" y="${PHOTO_INSET - 14}" width="${photoSize + 28}" height="${photoSize + 28}"
            rx="28" fill="none" stroke="#2a1a10" stroke-width="10"/>
      <text x="${SIZE / 2}" y="${SIZE - 78}" text-anchor="middle"
            font-family="Arial, sans-serif" font-weight="900" font-size="46" fill="#2a1a10">
        ${escapeXml(label)}
      </text>
      <text x="${SIZE / 2}" y="${SIZE - 34}" text-anchor="middle"
            font-family="Arial, sans-serif" font-weight="700" font-size="24" fill="#6e5847">
        Scan to see it move
      </text>
    </svg>
  `);

  const full = await sharp(label_svg)
    .composite([
      { input: dishPhoto, left: PHOTO_INSET, top: PHOTO_INSET },
      { input: qrBuffer, left: SIZE - 260 - 36, top: SIZE - 260 - 36 },
    ])
    .png()
    .toBuffer();

  await sharp(full).toFile(path.join(outDir, `${dish}.png`));
  await sharp(full).resize(500, 500).toFile(path.join(outDir, `${dish}-preview.png`));

  console.log(`✓ public/coasters/${dish}.png (print at 4x4in / 300dpi)`);
  console.log(`✓ public/coasters/${dish}-preview.png`);
  console.log(`\nNext: compile THIS SAME PNG as the AR tracking target at /tools/compile.html (dev server) —`);
  console.log(`the printed coaster and the compiled target must be the exact same image.`);
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

build();
