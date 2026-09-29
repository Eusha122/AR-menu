import * as THREE from "three";
import { MindARThree } from "../vendor/mind-ar/mindar-image-three.prod.js";

/**
 * One dish, as listed in /public/dishes.json. `video` is a side-by-side RGB+matte MP4
 * produced by `npm run prep-dish` (see scripts/prep-dish.mjs) — plain H.264, so it plays on
 * every phone, unlike a real alpha-channel video which only Chrome/Android supports.
 */
type DishEntry = { label: string; video: string; target: string; order: string };

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;

const startScreen = $<HTMLDivElement>("#start");
const startTitle = $<HTMLHeadingElement>("#start-title");
const startCopy = $<HTMLParagraphElement>("#start-copy");
const startBtn = $<HTMLButtonElement>("#start-btn");
const hint = $<HTMLDivElement>("#hint");
const orderBar = $<HTMLDivElement>("#order");
const orderLink = $<HTMLAnchorElement>("#order-link");
const container = $<HTMLDivElement>("#ar-container");

/** /dish/truffle-pizza  →  "truffle-pizza"  (falls back to ?dish= for local file testing) */
function readSlug(): string | null {
  const m = location.pathname.match(/\/dish\/([a-z0-9-]+)/i);
  if (m) return m[1];
  return new URLSearchParams(location.search).get("dish");
}

function fail(message: string, retryable = false) {
  startCopy.textContent = message;
  startCopy.classList.add("err");
  startBtn.disabled = false;
  if (retryable) {
    startBtn.textContent = "Try again"; // startBtn.onclick is already wired to retry starting the camera
  } else {
    startBtn.textContent = "Reload";
    startBtn.onclick = () => location.reload();
  }
}

/**
 * The RGB+matte shader: the video is two frames side by side — the left half is the dish in
 * plain color, the right half is a black-and-white matte (white = visible, black = invisible).
 * Reading both from one ordinary video and combining them here is what makes "transparent
 * video" work on every phone — it never depends on a browser supporting an alpha video codec.
 */
function matteMaterial(texture: THREE.VideoTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texture } },
    transparent: true,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D map;
      void main() {
        vec2 rgbUv = vec2(vUv.x * 0.5, vUv.y);
        vec2 matteUv = vec2(vUv.x * 0.5 + 0.5, vUv.y);
        float alpha = texture2D(map, matteUv).r;
        if (alpha < 0.03) discard;
        vec3 color = texture2D(map, rgbUv).rgb;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

async function main() {
  const slug = readSlug();
  if (!slug) return fail("No dish was given in the link. Scan the coaster's QR code again.");

  const manifest = (await fetch("/dishes.json").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Record<string, DishEntry> | null;
  const dish = manifest?.[slug];
  if (!dish) return fail(`“${slug}” isn't set up yet. Run npm run prep-dish and add it to dishes.json.`);

  startTitle.textContent = dish.label;
  startCopy.textContent = "Point your camera at the coaster on your table to see this dish, life-size.";
  orderLink.href = dish.order;

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Starting…";
    try {
      await startAR(dish);
      startScreen.classList.add("hidden");
      hint.classList.remove("hidden");
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("Couldn't load")) fail(`${msg} — run npm run prep-dish for this dish first.`, true);
      else fail("Couldn't access the camera. Check camera permission for this site, then try again.", true);
    }
  };
}

async function startAR(dish: DishEntry) {
  const mindar = new MindARThree({
    container,
    imageTargetSrc: dish.target,
    maxTrack: 1,
    uiLoading: "no", // we show our own start screen instead
    uiScanning: "no", // we show our own "point at the coaster" hint instead
    uiError: "no",
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const video = document.createElement("video");
  video.src = dish.video;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(`Couldn't load ${dish.video}`)), { once: true });
  });

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;

  // the video is RGB|matte side by side, so the dish itself is only the left half as wide
  const dishAspect = video.videoWidth / 2 / video.videoHeight;
  const width = 1.1; // ~ the coaster's own width, in mind-ar's target-relative units
  const height = width / dishAspect;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), matteMaterial(texture));
  // Floats just above the coaster. NOTE: verify this on a real phone before shipping — if the
  // dish appears to lie flat/sideways instead of standing up facing the camera, this is the
  // line to change (try `mesh.rotation.x = -Math.PI / 2` and adjust position.z accordingly).
  mesh.position.z = height / 2 + 0.1;

  const anchor = mindar.addAnchor(0);
  anchor.group.add(mesh);
  anchor.onTargetFound = () => {
    hint.classList.add("hidden");
    orderBar.classList.add("shown");
    video.play().catch(() => {});
  };
  anchor.onTargetLost = () => {
    hint.classList.remove("hidden");
    orderBar.classList.remove("shown");
  };

  await mindar.start();

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    // a slow float on top of the video's own rotation, so it doesn't feel like a flat sticker
    mesh.position.y = Math.sin(clock.getElapsedTime() * 1.1) * 0.04;
    renderer.render(scene, camera);
  });
}

main();
