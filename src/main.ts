import * as THREE from "three";
import { asFood, dishLoader, fitOnTable } from "./food-model";
import { MindARThree } from "../vendor/mind-ar/mindar-image-three.prod.js";

/**
 * One dish, as listed in /public/dishes.json. Give it EITHER:
 *  - `model`: a .glb 3D model — real geometry, correct from every angle, sits on the coaster and
 *    turns slowly. Preferred when a good model exists: a solid object hides small tracking
 *    jitter far better than a flat plane does.
 *  - `video`: a side-by-side RGB+matte MP4 from `npm run prep-dish` — a flat "screen" showing a
 *    pre-rendered rotation. Photographically real, but it's a billboard, not an object.
 * If both are set, `model` wins.
 */
type DishEntry = { label: string; video?: string; model?: string; target: string; order: string };

/** What each render mode hands back to the shared AR loop. */
type Content = { object: THREE.Object3D; onFound?: () => void; tick?: (dt: number, camera: THREE.Camera) => void };

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
      if (msg.includes("Couldn't load")) fail(`${msg} — check the dish's video/model file in dishes.json.`, true);
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
    // MindAR's defaults (filterMinCF: 0.001, filterBeta: 1000) are tuned for responsiveness over
    // steadiness — the tracked pose visibly jitters even when the phone and coaster are both
    // still. This is a "One Euro Filter": lowering both trades a little responsiveness (slight
    // lag when you actually move the phone) for a lot less jitter when you don't. Try these
    // first; if it still shakes, go lower still (e.g. 0.00001 / 10) before assuming it's the
    // coaster's print quality or lighting instead.
    filterMinCF: 0.0001,
    filterBeta: 10,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const content = dish.model ? await modelContent(dish.model, renderer) : await videoContent(dish.video!);

  const anchor = mindar.addAnchor(0);
  anchor.group.add(content.object);
  anchor.onTargetFound = () => {
    hint.classList.add("hidden");
    orderBar.classList.add("shown");
    content.onFound?.();
  };
  anchor.onTargetLost = () => {
    hint.classList.remove("hidden");
    orderBar.classList.remove("shown");
  };

  await mindar.start();

  // No extra float/bob animation on purpose: MindAR's tracked pose already has some jitter, and
  // stacking a second, independent motion on top of it compounded into visibly worse shaking.
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    content.tick?.(Math.min(clock.getDelta(), 0.1), camera);
    renderer.render(scene, camera);
  });
}

/**
 * Mind-ar's anchor space: the coaster lies in the XY plane, 1 unit = the coaster's width, and +Z
 * points up out of the coaster toward the viewer. glTF models are Y-up, so the model is tipped
 * 90° about X to stand on the coaster, then spun about its own vertical axis.
 */
async function modelContent(url: string, renderer: THREE.WebGLRenderer): Promise<Content> {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const gltf = await dishLoader().loadAsync(url).catch(() => {
    throw new Error(`Couldn't load ${url}`);
  });
  const model = gltf.scene;
  asFood(model);
  fitOnTable(model, 0.9); // ~90% of the coaster's width, resting on its surface

  const spin = new THREE.Group(); // turns about the dish's own vertical axis
  spin.add(model);
  const upright = new THREE.Group(); // Y-up model → Z-up coaster
  upright.rotation.x = Math.PI / 2;
  upright.add(spin);

  // Soft studio lighting from above, so it reads like a plate on a lit table, not a flat render.
  // Every light is defined RELATIVE TO THE COASTER, not the world: mind-ar places the anchor far
  // out in front of the camera, which sits at the world origin. A DirectionalLight aims at its
  // `target`, which defaults to the world origin — i.e. the camera — so left alone it shone from
  // the pizza back toward the viewer and lit the underside; the top rendered almost black. Same
  // trap with HemisphereLight, whose "sky" direction comes from its world position. So: ambient
  // for the base (direction-free), and directional lights whose targets live on the coaster.
  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(0xfff4e6, 1.15));
  const aimAtCoaster = (light: THREE.DirectionalLight, x: number, y: number, z: number) => {
    light.position.set(x, y, z); // +Z is up out of the coaster
    light.target.position.set(0, 0, 0);
    lights.add(light, light.target);
  };
  aimAtCoaster(new THREE.DirectionalLight(0xffffff, 2.4), 0.6, -0.5, 1.4); // key, high and in front
  aimAtCoaster(new THREE.DirectionalLight(0xffe8d0, 0.7), -0.8, 0.6, 0.9); // warm fill from behind

  const root = new THREE.Group();
  root.add(contactShadow(), upright, lights);

  const TURN_SECONDS = 14; // one slow, full turn — calm, like a display turntable
  return {
    object: root,
    tick: (dt) => {
      spin.rotation.y += (dt * Math.PI * 2) / TURN_SECONDS;
    },
  };
}

/** A soft dark ellipse under the dish so it sits ON the table instead of hovering over it. */
function contactShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.05),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
  );
  mesh.position.z = 0.002;
  return mesh;
}

async function videoContent(src: string): Promise<Content> {
  const video = document.createElement("video");
  video.src = src;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(`Couldn't load ${src}`)), { once: true });
  });

  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;

  // the video is RGB|matte side by side, so the dish itself is only the left half as wide
  const dishAspect = video.videoWidth / 2 / video.videoHeight;
  const width = 1.05; // ~ the coaster's own width, in mind-ar's target-relative units
  const height = width / dishAspect;

  // The clip is a pre-filmed view of the dish, so it's shown as a SPRITE: always square-on to the
  // phone and upright on the screen, centred over the coaster. Two approaches that failed first:
  //  - lying flat on the coaster: stacked a second perspective on top of the filmed one;
  //  - standing up and turning toward the camera across the table: from a phone held nearly
  //    overhead, "the direction across the table" is ill-defined and the plane swung sideways.
  // Copying the camera's own orientation has neither problem, from any viewing angle.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), matteMaterial(texture));
  mesh.position.z = 0.03; // just above the coaster so the shadow reads underneath

  const root = new THREE.Group();
  root.add(contactShadow(), mesh);

  const camQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  return {
    object: root,
    onFound: () => void video.play().catch(() => {}),
    tick: (_dt, camera) => {
      // local rotation = inverse(parent's world rotation) × camera's world rotation
      camera.getWorldQuaternion(camQ);
      root.getWorldQuaternion(parentQ);
      mesh.quaternion.copy(parentQ.invert().multiply(camQ));
    },
  };
}

main();
