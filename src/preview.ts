import * as THREE from "three";
import { asFood, dishLoader, fitOnTable } from "./food-model";

// Dev-only viewer for judging a dish model before it goes into dishes.json. Same lighting and
// tone mapping as the AR view (see modelContent in main.ts), viewed from a diner's seat angle.
const params = new URLSearchParams(location.search);
const src = params.get("src") ?? "/models/truffle-pizza.glb";
const fixedAngle = params.get("angle");

document.getElementById("label")!.textContent = src;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xefe6d6);
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a1e, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(0.6, 1.4, 0.4); // Y-up here, so "above the table" is +Y
scene.add(key);

// a diner's eye: ~40° above the table, looking at the dish
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 1.25, 1.5);
camera.lookAt(0, 0.05, 0);

const spin = new THREE.Group();
scene.add(spin);

dishLoader().load(src, (gltf) => {
  const model = gltf.scene;
  asFood(model);
  fitOnTable(model, 0.9);
  spin.add(model);
  (window as unknown as { ready: boolean }).ready = true;
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  if (fixedAngle !== null) spin.rotation.y = (Number(fixedAngle) * Math.PI) / 180;
  else spin.rotation.y += (clock.getDelta() * Math.PI * 2) / 14;
  renderer.render(scene, camera);
});

addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
