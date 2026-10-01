import * as THREE from "three";
import type { MindARThree as MindARThreeInstance } from "../vendor/mind-ar/mindar-image-three.prod.js";

type MindARThreeClass = typeof MindARThreeInstance;
import { discLights } from "./disc";
import { build3D, has3D, type Shape3D } from "./dish3d";
import { cameraFailed, container, orderBar, say, scanning, setButton, startScreen, type DishEntry } from "./ui";

/**
 * Everything that needs three.js / mind-ar. Loaded lazily by main.ts (in parallel with the dish
 * media) so the start screen appears instantly and this ~450 KB streams in behind it.
 */

/** What each render mode hands back to the shared AR loop. */
type Content = {
  object: THREE.Object3D;
  onFound?: () => void;
  onLost?: () => void;
  tick?: (dt: number, camera: THREE.Camera) => void;
};

let running: { stop: () => void } | null = null;

export async function begin(dish: DishEntry, mediaUrl: string, targetUrl: string, MindARThree: MindARThreeClass) {
  setButton("Starting camera…", false);

  // Create (and, for video, START) the dish content inside this tap: iOS only lets a video
  // begin playback from a user gesture, so it has to be kicked off here, not when the coaster
  // is found later.
  let content: Content;
  try {
    content = dish.model
      ? await modelContent(mediaUrl)
      : has3D(dish)
        ? await shapeContent(mediaUrl, dish)
        : dish.sprite
          ? await spriteContent(mediaUrl)
          : await videoContent(mediaUrl);
  } catch (err) {
    console.error(err);
    say("This dish couldn't be prepared on your phone. Try reloading the page.", true);
    return setButton("Reload", true, () => location.reload());
  }

  // Ask for the camera ourselves first. mind-ar swallows the reason when getUserMedia fails, so
  // without this "you blocked the camera" and "this phone has no camera" look identical.
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    probe.getTracks().forEach((t) => t.stop());
  } catch (err) {
    return cameraFailed(err);
  }

  container.replaceChildren(); // clean slate if this is a retry
  const mindar = new MindARThree({
    container,
    imageTargetSrc: targetUrl,
    maxTrack: 1,
    uiLoading: "no", // our own start screen instead
    uiScanning: "no", // our own scanning frame + hint instead
    uiError: "no",
    // MindAR's defaults (filterMinCF 0.001, filterBeta 1000) favour responsiveness, and the
    // tracked pose visibly jitters even when phone and coaster are still. This One Euro Filter
    // setting trades a little lag when you move the phone for far less jitter when you don't.
    filterMinCF: 0.0001,
    filterBeta: 10,
  });
  const { renderer, scene, camera } = mindar;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  // Every dish type sits inside this group, which does the entrance: pop up from a dot.
  const pop = popIn();
  pop.object.add(content.object);

  const anchor = mindar.addAnchor(0);
  anchor.group.add(pop.object);
  anchor.onTargetFound = () => {
    scanning(false);
    orderBar.classList.add("shown");
    pop.found();
    content.onFound?.();
  };
  anchor.onTargetLost = () => {
    scanning(true);
    orderBar.classList.remove("shown");
    pop.lost();
    content.onLost?.();
  };

  try {
    await mindar.start();
  } catch (err) {
    return cameraFailed(err);
  }

  startScreen.classList.add("hidden");
  scanning(true);
  keepAwake();

  // No extra float/bob: the tracked pose already has some jitter, and stacking a second
  // independent motion on top of it compounded into visibly worse shaking.
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    pop.tick(dt);
    content.tick?.(dt, camera);
    renderer.render(scene, camera);
  });
  running = { stop: () => mindar.stop() };
}

/**
 * The entrance: when the coaster is found, the dish grows out of a dot at the coaster's centre
 * and springs up to full size — overshooting a touch, then settling — as it fades in.
 *
 * Tracking drops for a few frames all the time (hand shake, a glare), and re-popping on each of
 * those would look glitchy: the pop only replays after the coaster has really been out of view
 * for REPOP_AFTER_MS. Honours the phone's "reduce motion" setting (appears instantly).
 */
const POP_SECONDS = 0.8;
const REPOP_AFTER_MS = 1000;

function popIn() {
  const object = new THREE.Group();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MIN = 0.001; // "a dot" — never exactly 0, which makes a degenerate matrix
  let t = -1; // seconds into the animation; -1 = not animating
  let everShown = false;
  let lostAt = 0;

  // easeOutBack: accelerates out of the dot, overshoots ~6%, settles back to exactly 1
  const easeOutBack = (x: number) => {
    const c1 = 1.25;
    const c3 = c1 + 1;
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  };

  object.scale.setScalar(MIN);
  return {
    object,
    found() {
      const brief = everShown && performance.now() - lostAt < REPOP_AFTER_MS;
      everShown = true;
      if (brief || reduced) {
        t = -1;
        object.scale.setScalar(1);
      } else {
        t = 0;
        object.scale.setScalar(MIN);
      }
    },
    lost() {
      lostAt = performance.now();
    },
    tick(dt: number) {
      if (t < 0) return;
      t += dt;
      const k = Math.min(1, t / POP_SECONDS);
      object.scale.setScalar(Math.max(MIN, easeOutBack(k)));
      if (k >= 1) t = -1;
    },
  };
}

/** Keep the screen on while the guest is looking at the table (it dims mid-look otherwise). */
function keepAwake() {
  type WakeLock = { request: (t: "screen") => Promise<unknown> };
  const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
  if (!wl) return;
  const request = () => wl.request("screen").catch(() => {});
  request();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && running && request());
}

/* ------------------------------------------------------------------------------------------ */
/* Dish content                                                                                 */
/* ------------------------------------------------------------------------------------------ */

const FADE_SECONDS = 0.25; // quick: the pop-in (popIn) carries the entrance; this just softens the first frames

/**
 * The colour|matte shader: the video is two frames side by side — left the dish in plain
 * colour, right a black-and-white matte (white = visible). Combining them here is what makes
 * "transparent video" work on every phone, with no dependency on alpha video codecs.
 */
function matteMaterial(texture: THREE.VideoTexture) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: texture }, opacity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D map;
      uniform float opacity;
      void main() {
        float alpha = texture2D(map, vec2(vUv.x * 0.5 + 0.5, vUv.y)).r * opacity;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(texture2D(map, vec2(vUv.x * 0.5, vUv.y)).rgb, alpha);
      }
    `,
  });
}

/** A soft dark ellipse under the dish so it sits ON the table instead of hovering over it. */
function contactShadow(size = 1.05) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  grad.addColorStop(0, "rgba(0,0,0,0.5)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const material = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.position.z = 0.002;
  return mesh;
}

/** Fades the dish in when the coaster is found (instead of popping), out when it's lost. */
function fader(apply: (o: number) => void) {
  let value = 0;
  let target = 0;
  return {
    show: () => void (target = 1),
    hide: () => void ((target = 0), (value = 0), apply(0)),
    tick: (dt: number) => {
      if (value === target) return;
      value = Math.min(target, value + dt / FADE_SECONDS);
      apply(value * value * (3 - 2 * value)); // smoothstep
    },
  };
}

/**
 * 3D mode: a dish rebuilt as real 3D from its one menu photo (see dish3d.ts) — a pizza, a bowl
 * (ramen, curry, drinks) or a stack (burger). It sits ON the coaster and turns slowly, like a
 * dish on a display turntable, so it looks right from any seat.
 */
async function shapeContent(src: string, dish: Shape3D): Promise<Content> {
  // about the coaster (1 = coaster width), like the printed dish. A burger is as tall as it is
  // wide, so it's smaller — full size it towered over the coaster and filled the screen.
  const DIAMETER = dish.stack ? 0.7 : 0.95;
  const d3 = await build3D(dish, DIAMETER, src);
  // a pizza's shadow is as wide as the pizza; a bowl's or burger's foot is narrower
  const shadow = contactShadow(DIAMETER * (dish.disc ? 1.12 : 0.9));
  const root = new THREE.Group();
  root.add(shadow, d3.object, discLights());

  // A 3D dish overlaps itself (bowl walls, burger layers), which transparent rendering can sort
  // wrongly — so it's only transparent while fading in, and a plain opaque object once shown.
  const fade = fader((o) => {
    const see = o < 1;
    if (d3.material.transparent !== see) {
      d3.material.transparent = see;
      d3.material.needsUpdate = true;
    }
    d3.material.opacity = o;
    (shadow.material as THREE.MeshBasicMaterial).opacity = o;
  });
  fade.hide();
  return {
    object: root,
    onFound: fade.show,
    onLost: fade.hide,
    tick: (dt) => {
      fade.tick(dt);
      d3.spin.rotation.z += (dt * Math.PI * 2) / d3.turnSeconds;
    },
  };
}

/**
 * Sprite mode: a still, background-free photo of a TALL dish (burger, layered cake, drink),
 * standing on the coaster by its bottom edge and always turned square-on to the phone — how you
 * look at a burger on a plate. Used until a turntable video of the dish exists (then switch the
 * dish to `video`). Tall food can't use disc mode, and a 3D shape spun from a single side photo
 * smears its edges and bun top as it turns.
 */
async function spriteContent(src: string): Promise<Content> {
  const texture = await new THREE.TextureLoader().loadAsync(src);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const { width: iw, height: ih } = texture.image as { width: number; height: number };

  const WIDTH = 1.0; // about the coaster (1 = coaster width); a burger is ~12 cm on a 10 cm coaster
  const height = (WIDTH * ih) / iw;
  // bottom edge at the origin, so the dish stands ON the coaster rather than floating through it
  const geometry = new THREE.PlaneGeometry(WIDTH, height).translate(0, height / 2, 0);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  // Stand it where the printed dish's BOTTOM is (a little toward the coaster's lower, label edge —
  // the edge that faces the diner), not at the centre: standing at the centre, the dish rose up
  // from mid-coaster and the lower half of the printed photo peeked out underneath — two burgers.
  const BASE_Y = -0.4; // just below the printed dish's bottom on make-coaster's layout (~-0.33), so none of it peeks out
  mesh.position.set(0, BASE_Y, 0.01);
  const shadow = contactShadow(WIDTH * 1.05);
  shadow.position.y = BASE_Y;

  const root = new THREE.Group();
  root.add(shadow, mesh);
  const fade = fader((o) => {
    material.opacity = o;
    (shadow.material as THREE.MeshBasicMaterial).opacity = o;
  });
  const face = faceCamera(mesh, root);
  return {
    object: root,
    onFound: fade.show,
    onLost: fade.hide,
    tick: (dt, camera) => {
      fade.tick(dt);
      face(camera);
    },
  };
}

/**
 * Keeps a flat picture square-on to the phone and upright on screen (a sprite): its local
 * rotation = inverse(parent's world rotation) × the camera's world rotation. Works from any
 * viewing angle — unlike turning it "toward the camera across the table", which swung sideways
 * when the phone was held nearly overhead.
 */
function faceCamera(mesh: THREE.Object3D, parent: THREE.Object3D) {
  const camQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  return (camera: THREE.Camera) => {
    camera.getWorldQuaternion(camQ);
    parent.getWorldQuaternion(parentQ);
    mesh.quaternion.copy(parentQ.invert().multiply(camQ));
  };
}

async function videoContent(src: string): Promise<Content> {
  const video = document.createElement("video");
  video.src = src;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  await new Promise<void>((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener("error", () => reject(new Error(`Couldn't decode ${src}`)), { once: true });
  });
  await video.play(); // inside the tap — see begin()

  const texture = new THREE.VideoTexture(video);
  // Plain passthrough of the video's pixels: no colour-space conversion either way, so the dish
  // looks exactly like the source (a converted texture through this raw shader came out darker).
  texture.colorSpace = THREE.NoColorSpace;

  // the video is colour|matte side by side, so the dish itself is only the left half as wide
  const width = 1.05; // ~ the coaster's width, in mind-ar's target-relative units
  const height = width / (video.videoWidth / 2 / video.videoHeight);

  // Shown as a SPRITE: square-on to the phone and upright on screen, centred over the coaster.
  // Lying flat on the coaster stacked a second perspective on the filmed one, and turning it
  // "toward the camera across the table" broke when the phone was held nearly overhead.
  const material = matteMaterial(texture);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.z = 0.03;
  const shadow = contactShadow();

  const root = new THREE.Group();
  root.add(shadow, mesh);

  const fade = fader((o) => {
    material.uniforms.opacity.value = o;
    (shadow.material as THREE.MeshBasicMaterial).opacity = o;
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? video.pause() : void video.play().catch(() => {})));

  const face = faceCamera(mesh, root);
  return {
    object: root,
    onFound: fade.show,
    onLost: fade.hide,
    tick: (dt, camera) => {
      fade.tick(dt);
      face(camera);
    },
  };
}

/**
 * 3D model mode. mind-ar's anchor space: the coaster lies in the XY plane, 1 unit = its width,
 * +Z up. glTF is Y-up, so the model is tipped 90° about X, then spun about its own vertical axis.
 * Loaded lazily so the video-only menu never downloads the 3D loader.
 */
async function modelContent(url: string): Promise<Content> {
  const { asFood, dishLoader, fitOnTable } = await import("./food-model");
  const gltf = await dishLoader().loadAsync(url);
  const model = gltf.scene;
  asFood(model);
  fitOnTable(model, 0.9);

  const spin = new THREE.Group();
  spin.add(model);
  const upright = new THREE.Group();
  upright.rotation.x = Math.PI / 2;
  upright.add(spin);

  // Lights are placed relative to the COASTER: mind-ar puts the anchor far in front of the
  // camera at the world origin, and a DirectionalLight aims at its target (default: the world
  // origin, i.e. the camera) — left alone it lit the dish's underside and the top went black.
  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(0xfff4e6, 1.15));
  const aim = (light: THREE.DirectionalLight, x: number, y: number, z: number) => {
    light.position.set(x, y, z);
    light.target.position.set(0, 0, 0);
    lights.add(light, light.target);
  };
  aim(new THREE.DirectionalLight(0xffffff, 2.4), 0.6, -0.5, 1.4);
  aim(new THREE.DirectionalLight(0xffe8d0, 0.7), -0.8, 0.6, 0.9);

  const shadow = contactShadow();
  (shadow.material as THREE.MeshBasicMaterial).opacity = 1;
  const root = new THREE.Group();
  root.add(shadow, upright, lights);

  const TURN_SECONDS = 14;
  return {
    object: root,
    tick: (dt) => void (spin.rotation.y += (dt * Math.PI * 2) / TURN_SECONDS),
  };
}
