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

**2. Turn it into the transparent video** with the AI matte pipeline — see
[Professional transparent video](#professional-transparent-video-ai-matte--the-best-way-to-make-a-dish-video)
below. (`npm run prep-dish -- <dish>` is a quick ffmpeg-only fallback with softer edges.)
Also save a **poster**: one matted frame as a transparent `public/posters/<dish>.webp` (~720 px
wide) — it's shown on the start screen and the dish list.

**3. Make the coaster** (the QR code points at the live site by default; set `AR_SITE_URL` or
`--url=` for another deploy):
```
npm run make-coaster -- truffle-pizza --label="Truffle Pizza" \
  --photo=../biteme/public/menu/truffle-pizza.webp
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
  "poster": "/posters/truffle-pizza.webp",
  "target": "/targets/truffle-pizza.mind",
  "order": "https://biteme-blush.vercel.app/menu?dish=truffle-pizza"
}
```
It appears on the landing page (`/`) automatically.

**6. Test on a real phone** — Android Chrome and iPhone Safari if you can. Open
`https://<your-deploy>/dish/<dish>`, wait for "Start camera", tap it, point at the printed coaster.
Check the loop doesn't jump when it restarts, and the load time on real 4G, not office Wi-Fi.

**7. Print the coaster**, cut it to size, put it on the table with its QR code visible.

## Disc dishes — real 3D from ONE photo (best for pizza and other round, flat dishes)

For a round flat dish (pizza, thali, flatbread) you don't need a video at all. One transparent
menu photo becomes real 3D that turns on the coaster — no video, no AI generation, no looping:

```
npm run make-disc -- margherita --photo=../biteme/public/menu/margherita.webp
```

What happens (`scripts/make-disc.mjs` + `src/disc.ts`):
1. **Un-tilt.** A round dish shot from an angle is an ellipse whose height/width is the sine of the
   camera's elevation (the margherita was shot from ~47°). Stretching it back into a circle gives
   the dish seen from straight above. (Spinning the angled photo itself would just spin an oval
   like a sticker — the front crust swings to the top.)
2. **Even the crust.** The angled photo also shows the front crust's outer wall, so the bottom
   crust band comes out thicker; it's measured (median over many scan lines, crust vs toppings by
   colour) and matched to the left/right bands, which the tilt doesn't distort.
3. **Real shape.** In the viewer the texture is projected onto a lathe-built pizza: thin base,
   puffy rounded crust rim at real Neapolitan proportions (~2 cm on 30 cm), with the rim's outer
   wall wrapped in the photo's crust band so it shows blistered dough, not smeared edge pixels.
4. On the coaster it turns slowly (20 s a turn) like a display turntable; the phone's own viewing
   angle supplies the perspective, so it's correct from any seat.

Then add it to `dishes.json` with `"disc": "/discs/<dish>.webp"` (plus coaster, target, poster as
usual). Check it first at `/preview.html?disc=/discs/<dish>.webp&elev=40` (dev server; `elev` =
camera height in degrees, `angle` freezes the turn).

## Professional transparent video (AI matte) — the best way to make a dish video

`prep-dish`'s ffmpeg keying is the quick path; for a production-quality cut-out use the AI matte
pipeline in `scripts/ai-matte/` (free, runs locally — Python 3.11+):

```
python -m venv .venv && .venv/Scripts/python -m pip install -r scripts/ai-matte/requirements.txt
# 1. frames from the raw clip (dish rotating on PURE black, camera still)
ffmpeg -i raw/<dish>.mp4 -vsync 0 work/<dish>/src/%03d.png
# 2. precise per-frame matte (BiRefNet) + edge colour decontamination   (~20 s/frame on CPU)
.venv/Scripts/python scripts/ai-matte/matte.py work/<dish>
# 3. remove the blocky compression band AI video leaves around the edge, floating crumbs, pinholes
.venv/Scripts/python scripts/ai-matte/cleanup.py work/<dish>
# 4. crop tight to the dish, colour|matte side by side, drop the duplicate loop frame
.venv/Scripts/python scripts/ai-matte/compose.py work/<dish>
# 5. encode for phones
ffmpeg -framerate 24 -i work/<dish>/sbs/%03d.png -vf "scale='min(2048,iw)':-2" -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart public/videos/<dish>.mp4
```

Needs `mkdir work/<dish>/{src,rgb,alpha}` first. BiRefNet's model (~1 GB) downloads on first run.
It runs on CPU on purpose: at full resolution it doesn't fit in an 8 GB GPU through DirectML.

The viewer shows the video as a sprite — always square-on to the phone and upright on screen,
centred over the coaster, with a soft contact shadow underneath. (Lying flat on the coaster
double-counts the filmed perspective; turning it "toward the camera across the table" breaks when
the phone is held nearly overhead. See `videoContent` in `src/ar.ts`.)

## 3D models

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

The pizza currently uses the video (the AI 3D model wasn't photoreal enough); its optimized model
is kept in `raw/truffle-pizza.glb`. The 3D code is only downloaded for dishes that set `"model"`.

Materials are normalized on load (`src/food-model.ts`): AI exports often omit `metallicFactor`,
which glTF treats as fully metallic and renders nearly black.

## Running it

```
npm run dev       # local dev server
npm run build     # → dist/, static files, deploy anywhere
npm run preview   # serve the production build locally
```

Vercel settings: framework **Vite**, output directory **`dist`**, root directory = this folder.
[vercel.json](vercel.json) rewrites `/dish/:slug` to `index.html`, sets caching (hashed JS forever,
media for a day, `dishes.json` always revalidated) and security headers (camera allowed for this
site only). If you deploy elsewhere, replicate the rewrite and the `Permissions-Policy` header.

Dev-only pages (served by `npm run dev`, never deployed): `/tools/compile.html` (AR target
compiler) and `/preview.html` (3D model preview).

## How the page loads (why it's fast)

- `src/main.ts` + `src/ui.ts` are the whole first screen (~5 KB gzipped) — it appears instantly.
- The same moment, in parallel: the dish video and coaster data are downloaded into memory with a
  progress %, and the AR code (`src/ar.ts`, three.js ~126 KB gz) and tracker (mind-ar ~330 KB gz)
  load. "Start camera" enables only when all of it is on the phone, so AR starts with no stall.
- The camera is requested by our code first, so a blocked camera / missing camera / camera in use
  each get their own instructions (mind-ar alone hides the reason).
- The dish fades in when the coaster is found; the screen is kept awake while in AR; the video
  pauses when the tab is hidden.

## Known limits (be upfront about these before selling it)

- **Hold the phone above the coaster.** Image tracking can't lock on when the coaster is seen very
  flat (about 60° off straight-on) — the on-screen hint says so.
- **Image tracking in the browser always has slight jitter.** It's smoothed hard (see
  `filterMinCF`/`filterBeta` in `src/ar.ts`). Good light and a flat, matte coaster print help most.
- **The dish is a filmed view, not 3D** — it's upright and always faces the phone, so it looks
  right from a normal seated angle but doesn't reveal the underside if you look from very low.
- **AI video quality sets the ceiling.** Generate on a pure black background (check a frame's
  corners are exactly `0,0,0`) or the cut-out will need more cleanup.
- The tracker (mind-ar ~330 KB gz) only loads on dish pages, never on the main BiteME site.
