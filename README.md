# ar-menu

Scan a coaster on the table → the dish appears floating above it, rotating, on your phone. No app
to install — it's a website (WebAR).

This is a **separate project from `biteme/`**, on purpose: it needs a heavy camera-tracking
library that the main ordering site shouldn't have to load, it deploys and updates on its own
schedule, and it's meant to be sellable on its own — a restaurant could buy BiteME without this,
or (eventually) this without BiteME.

## How it actually works (read this before touching anything)

A real transparent-background video only plays with transparency in Chrome/Android — Safari/iOS
ignores it and shows a black box. So the "rotating dish with no background" video is stored as one
ordinary video, twice: the left half is the dish in color, the right half is the same footage as a
black-and-white silhouette (white = show it, black = don't). A small WebGL shader
([src/main.ts](src/main.ts)) reads both halves live and combines them. This works identically on
every phone because it never depends on a browser supporting alpha-channel video — it's just two
plain videos and a multiply.

```
[ dish in color  |  white-on-black silhouette of the same frame ]
                    ↓ shader combines them every frame
         dish floats with clean edges, on any phone
```

The coaster on the table is **the dish's own photo**, framed and branded — not a plain logo or a
bare QR code. Image-tracking AR (MindAR, used here) needs an image with lots of unique, uneven
detail to lock onto; a food photo has that naturally, a logo or empty QR quiet-zone doesn't.

## One-time setup

```
npm install
```

That's it — no `mind-ar` npm install. It's **vendored** in [vendor/mind-ar/](vendor/mind-ar)
instead, for two reasons:
1. The published `mind-ar` package pulls in TensorFlow.js, MediaPipe, and `canvas` (a native
   module) just to get its two browser bundles. `canvas` fails to build on plenty of machines
   (no C++ build tools) for no benefit here — we never use the Node-side of that package.
2. `three` is pinned to **exactly `0.161.0`** in [package.json](package.json), not a `^` range.
   Mind-ar's bundle uses `sRGBEncoding` / `renderer.outputEncoding`, which three.js removed in
   r162. A `^0.161.0` range would happily upgrade past that and silently break the AR view.
   **Do not loosen this pin** without checking `vendor/mind-ar/mindar-image-three.prod.js` still
   imports things that exist in whatever newer three you'd move to.

## Adding one dish, start to finish

**1. Generate the raw clip with AI** (e.g. Higgsfield/MiniMax, whatever you already use for
BiteME's films). Prompt for: the dish rotating a full 360°, slow, on a **pure black background**,
studio lighting, first and last frame matching (a clean loop). Save it as `raw/<dish>.mp4`.

**2. Turn it into the shader-ready video:**
```
npm run prep-dish -- truffle-pizza
```
This keys out the black background and writes `public/videos/truffle-pizza.mp4`. **Open that file
and look at it** before continuing — a black background is never perfectly pure, so the default
keying settings are a starting point, not a guarantee. If edges look ragged or part of the dish
vanished, retune and re-run:
```
npm run prep-dish -- truffle-pizza --sim=0.22 --blend=0.08
```
`--trim=start:end` (seconds) cuts the clip first, if the AI generation added lead-in/out that isn't
part of the clean rotation.

**3. Make the coaster:**
```
npm run make-coaster -- truffle-pizza --label="Truffle Pizza" \
  --photo=../biteme/public/menu/truffle-pizza.webp \
  --url=https://<wherever-this-deploys>/dish/truffle-pizza
```
Writes `public/coasters/truffle-pizza.png` (print-ready, 4×4in @ 300dpi) and a `-preview.png` for
emails. **Use the real dish photo already on the BiteME menu** — same photo the guest already
trusts, and the best possible tracking image in one move.

**4. Compile that same PNG into an AR target.** Run the dev server (`npm run dev`) and open
`/tools/compile.html` in a browser — this runs entirely locally, nothing uploads anywhere. Upload
`public/coasters/truffle-pizza.png`, click Compile, and save the downloaded file as
`public/targets/truffle-pizza.mind`.

> The printed coaster and the compiled target **must be the exact same image file** — MindAR is
> matching what the camera sees against exactly that image.

**5. Register the dish** in [public/dishes.json](public/dishes.json):
```json
"truffle-pizza": {
  "label": "Truffle Pizza",
  "video": "/videos/truffle-pizza.mp4",
  "target": "/targets/truffle-pizza.mind",
  "order": "https://biteme-blush.vercel.app/menu?dish=truffle-pizza"
}
```

**6. Test on a real phone**, both an Android (Chrome) and an iPhone (Safari) if you can — these are
the two rendering engines and both need to look right, not just work. Open
`https://<your-deploy>/dish/truffle-pizza`, tap Start, point at the printed coaster.

Check specifically:
- **Does the dish stand up facing you, or does it look like it's lying on its side/flat?** This
  depends on MindAR's anchor axis convention, which is genuinely something you have to see on a
  device to get right — if it looks wrong, open [src/main.ts](src/main.ts) and look at the comment
  next to `mesh.position.z`; the one-line fix is noted right there.
- The loop shouldn't flash or jump when it restarts.
- Load time on real 4G, not just your office wifi.

**7. Print the coaster**, cut it to size, put it on the table with its QR code visible.

## 3D models (preferred over video)

A dish can use a `.glb` 3D model instead of (or as well as) a video — set `"model"` in
`dishes.json`; if both are set, the model wins. A real 3D object is correct from every angle and
hides small tracking jitter far better than a flat video plane.

1. Generate it from the menu photo (PNG, not WebP) with Higgsfield's **Image to 3D** (Meshy),
   textured + PBR, ~60k polygons. The cheaper SAM 3D model was noticeably blurrier.
2. Shrink it for phones — the raw export is ~17 MB:
   ```
   npx @gltf-transform/cli optimize raw/<dish>-meshy.glb public/models/<dish>.glb --compress meshopt --texture-compress webp --texture-size 1024
   ```
   (17 MB → 1.3 MB for the pizza, visually identical.)
3. Check it at `/preview.html?src=/models/<dish>.glb` (dev server) before shipping.

Materials are normalized on load (`src/food-model.ts`): AI exports often omit `metallicFactor`,
which glTF treats as fully metallic and renders nearly black.

## Running it

```
npm run dev       # local dev server
npm run build     # → dist/, static files, deploy anywhere
npm run preview   # serve the production build locally
```

Deploying `dist/` to Vercel: [vercel.json](vercel.json) rewrites `/dish/:slug` to `index.html`
(needed since this is a single static page that reads the slug from the URL client-side). If you
deploy elsewhere, replicate that one rewrite rule.

## Known rough edges (v1, be upfront about these before selling it)

- **Background keying is per-clip.** A different lighting setup or sauce color can need different
  `--sim`/`--blend` values. There's no universal setting — always preview.
- **Anchor orientation** (dish standing up vs. lying flat) is noted above and needs a real-device
  check on the first dish; every dish after that reuses the same fix.
- The vendored mind-ar bundle is ~450KB gzipped (it bundles a small ML model for tracking). That's
  normal for image-tracking AR and only loads on the AR page itself, never on the main BiteME site.
