import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Dish models are shipped optimized with gltf-transform (meshopt-compressed geometry + WebP
 * textures — see README), which cuts a 17 MB AI export to ~1.3 MB. Meshopt needs its decoder
 * registered on the loader; WebP textures load natively.
 */
export function dishLoader() {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/**
 * AI image-to-3D tools often export a material with no `metallicFactor`, and glTF's default for a
 * missing one is 1.0 — fully metallic. Without an environment map to reflect, a "metal" pizza
 * renders nearly black (this is exactly what the first generated model did). Food is never
 * metallic, so force it off and keep surfaces matte-ish, like baked dough and sauce.
 */
export function asFood(model: THREE.Object3D) {
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial) continue;
      mat.metalness = 0;
      mat.roughness = Math.min(mat.roughness, 0.8);
      if (mat.map) mat.map.anisotropy = 8; // keeps the texture crisp at the shallow table-top angle
    }
  });
}

/** Fits a dish to `width` (in the viewer's units) and rests it on y = 0, centered. */
export function fitOnTable(model: THREE.Object3D, width: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const scale = width / Math.max(size.x, size.z);
  model.scale.setScalar(scale);
  const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  model.position.set(-center.x, -box.min.y * scale, -center.z);
}
