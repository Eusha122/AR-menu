import * as THREE from "three";
import { buildBowl, type BowlSpec } from "./bowl";
import { buildDisc, discLights } from "./disc";

// Dev-only viewer for judging a dish before it goes into dishes.json, with the same materials
// and lighting as the AR view, on a table-coloured background.
//   /preview.html?src=/models/x.glb          3D model
//   /preview.html?disc=/discs/x.webp          disc dish (make-disc texture)
//   &angle=<deg>   freeze the turn at an angle    &elev=<deg>   camera height (default 40°)
const params = new URLSearchParams(location.search);
const src = params.get("src");
const disc = params.get("disc");
const fixedAngle = params.get("angle");
const elev = (Number(params.get("elev") ?? 40) * Math.PI) / 180;

document.getElementById("label")!.textContent = params.get("bowl") ?? disc ?? src ?? "";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xefe6d6);

// a diner's eye: `elev` above the table, looking at the dish
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
const dist = 2.1;
camera.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
camera.lookAt(0, 0.05, 0);

const spin = new THREE.Group();
scene.add(spin);
const ready = () => ((window as unknown as { ready: boolean }).ready = true);

const bowl = params.get("bowl"); // a dish slug from dishes.json whose entry has a "bowl" spec
if (bowl) {
  const zUp = new THREE.Group();
  zUp.rotation.x = -Math.PI / 2;
  scene.add(zUp);
  zUp.add(discLights());
  fetch("/dishes.json")
    .then((r) => r.json())
    .then(async (m: Record<string, { bowl?: BowlSpec }>) => {
      const spec = m[bowl].bowl!;
      const tex = await new THREE.TextureLoader().loadAsync(spec.texture);
      const bw = buildBowl(tex, spec, 1.0);
      zUp.add(bw.object);
      spinTarget = bw.spin;
      ready();
    });
} else if (disc) {
  // disc.ts builds Z-up (the AR anchor's convention); this scene is Y-up
  const zUp = new THREE.Group();
  zUp.rotation.x = -Math.PI / 2;
  scene.add(zUp);
  zUp.add(discLights());
  new THREE.TextureLoader().load(disc, (tex) => {
    const d = buildDisc(tex, 1.0);
    zUp.add(d.object);
    // spin the disc's own turn group so the preview matches AR exactly
    spinTarget = d.spin;
    ready();
  });
} else if (src) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a1e, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 1.4, 0.4);
  scene.add(key);
  import("./food-model").then(({ asFood, dishLoader, fitOnTable }) =>
    dishLoader().load(src, (gltf) => {
      asFood(gltf.scene);
      fitOnTable(gltf.scene, 0.9);
      spin.add(gltf.scene);
      ready();
    }),
  );
}

let spinTarget: THREE.Object3D = spin;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const axis = spinTarget === spin ? "y" : "z";
  if (fixedAngle !== null) spinTarget.rotation[axis] = (Number(fixedAngle) * Math.PI) / 180;
  else spinTarget.rotation[axis] += (clock.getDelta() * Math.PI * 2) / 20;
  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
