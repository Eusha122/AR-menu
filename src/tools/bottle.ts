import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

/*
 * Test object for the AR pipeline: a 50 ml glass perfume bottle (blue, square, black cap),
 * modelled to the size measured from 48 photos. It's MODELLED, not scanned: photogrammetry of the
 * same photos produced only a scrap of floor — transparent, refractive glass gives the software
 * no stable surface to match between photos.
 *
 * Built in centimetres, exported in metres (glTF's unit), standing on y = 0.
 *
 * Glass uses KHR_materials_transmission/volume/ior (real see-through glass in model-viewer and
 * Scene Viewer) AND a blended opacity, so viewers that don't support transmission (iPhone Quick
 * Look) still show see-through tinted glass instead of an opaque white block.
 */

export function buildBottle() {
  const W = 6.4, H = 6.4, D = 3.4; // body, cm
  const CAP_R = 1.25, CAP_H = 2.8;
  const root = new THREE.Group();

  // glass body
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xb8dcff,
    roughness: 0.04,
    metalness: 0,
    transmission: 1,
    thickness: 0.6,
    ior: 1.5,
    attenuationColor: new THREE.Color(0x6fb6ff),
    attenuationDistance: 3,
    transparent: true,
    opacity: 0.45,
    side: THREE.FrontSide,
  });
  const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 6, 0.95), glass);
  body.position.y = H / 2;
  body.name = "glass";
  root.add(body);

  // the perfume inside: thick glass base, filled to ~85%
  const liquid = new THREE.MeshPhysicalMaterial({
    color: 0x1f8fff,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.85,
    thickness: 2.6,
    ior: 1.36,
    attenuationColor: new THREE.Color(0x0a64d8),
    attenuationDistance: 1.4,
    transparent: true,
    opacity: 0.88,
  });
  const LH = 5.35; // nearly full, like the real bottle
  const juice = new THREE.Mesh(new RoundedBoxGeometry(W - 0.5, LH, D - 0.5, 5, 0.75), liquid);
  juice.position.y = 0.42 + LH / 2;
  juice.name = "perfume";
  root.add(juice);

  // dip tube
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, H - 0.7, 8),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, roughness: 0.1, transparent: true, opacity: 0.4 }),
  );
  tube.position.set(0, 0.45 + (H - 0.7) / 2, 0);
  root.add(tube);

  // neck collar (dark metal) + matte black cap with softly rounded top edge
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 0.95, 0.35, 48),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2e, metalness: 0.8, roughness: 0.35 }),
  );
  collar.position.y = H + 0.17;
  root.add(collar);

  const r = 0.18; // top edge rounding
  const capProfile: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(CAP_R, 0)];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    capProfile.push(new THREE.Vector2(CAP_R - r + Math.cos(a) * r, CAP_H - r + Math.sin(a) * r));
  }
  capProfile.push(new THREE.Vector2(0, CAP_H));
  const cap = new THREE.Mesh(
    new THREE.LatheGeometry(capProfile, 64),
    new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.55 }),
  );
  cap.position.y = H + 0.3;
  cap.name = "cap";
  root.add(cap);

  // front label: drawn crisp (the photographed one is blurred through curved glass)
  const label = labelTexture();
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 2.88),
    new THREE.MeshStandardMaterial({ map: label, transparent: true, metalness: 0.55, roughness: 0.3, color: 0xffffff }),
  );
  decal.position.set(0.1, H * 0.62, D / 2 + 0.012);
  decal.name = "label";
  root.add(decal);

  // cm → m, shown 2.5× real size: at true size (9 cm tall) it looked tiny on the table
  root.scale.setScalar(0.025);
  return root;
}

function labelTexture() {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 640;
  const g = c.getContext("2d")!;
  g.fillStyle = "#eef3f7";
  g.textBaseline = "alphabetic";
  g.font = "900 168px Arial Black, Arial, sans-serif";
  g.fillText("WILD", 40, 190);
  g.fillText("STONE", 40, 360);
  g.font = "700 48px Arial, sans-serif";
  g.fillText("E A U   D E   P A R F U M", 46, 440);
  // "HYDRA ENERGY" runs up the left edge, reading bottom-to-top
  g.save();
  g.translate(84, 630);
  g.rotate(-Math.PI / 2);
  g.font = "700 34px Arial, sans-serif";
  g.fillText("H Y D R A", 0, 0);
  g.fillText("E N E R G Y", 0, 44);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData.mimeType = "image/png"; // keep transparency
  return t;
}

export async function exportBottle(): Promise<string> {
  const scene = new THREE.Scene();
  scene.add(buildBottle());
  scene.updateMatrixWorld(true);
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true })) as ArrayBuffer;
  let bin = "";
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

(window as unknown as { exportBottle: typeof exportBottle }).exportBottle = exportBottle;

document.getElementById("go")?.addEventListener("click", async () => {
  const b64 = await exportBottle();
  const blob = new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "model/gltf-binary" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "test-bottle.glb";
  a.click();
  document.getElementById("log")!.textContent = `✓ test-bottle.glb (${(blob.size / 1024).toFixed(0)} KB)`;
});
