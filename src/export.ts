import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { buildBowl, type BowlSpec } from "./bowl";
import { buildDisc } from "./disc";

/*
 * Dev tool: turns the coaster view's 3D dishes into .glb files for "View on your table" — the
 * phone's own AR (Android Scene Viewer / iPhone Quick Look via <model-viewer>).
 *
 * - Same geometry and projected photo as the AR view (disc.ts / bowl.ts), so they match exactly.
 * - Real-world size in METRES (glTF's unit): the phone places them at true size on the table.
 * - glTF is Y-up; our builders are Z-up, so each dish is tipped −90° about X.
 * - Plain glTF (JPEG textures, no mesh compression): the phones' native AR viewers don't all
 *   support compressed meshes or WebP, and these models are small anyway.
 */

type Table = { kind: "disc" | "bowl" | "model"; diameterM: number; texture?: string; model: string };
type Entry = { label: string; disc?: string; bowl?: BowlSpec; table?: Table };

const log = (s: string) => (document.getElementById("log")!.textContent += s + "\n");

async function build(entry: Entry): Promise<THREE.Object3D> {
  const t = entry.table!;
  const texUrl = t.kind === "bowl" ? entry.bowl!.texture : (t.texture ?? entry.disc!);
  const texture = await new THREE.TextureLoader().loadAsync(texUrl);
  texture.userData.mimeType = "image/jpeg"; // GLTFExporter writes PNG otherwise (several × larger)
  const dish = t.kind === "bowl" ? buildBowl(texture, entry.bowl!, 1) : buildDisc(texture, 1);
  // builders were given diameter 1, so scaling by the real diameter gives metres; tip Z-up → Y-up
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(t.diameterM);
  root.add(dish.object);
  const scene = new THREE.Scene();
  scene.add(root);
  scene.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  log(`${entry.label}: ${(size.x * 100).toFixed(1)} × ${(size.z * 100).toFixed(1)} cm, ${(size.y * 100).toFixed(1)} cm tall`);
  return scene;
}

export async function exportDish(slug: string): Promise<string> {
  const manifest = (await (await fetch("/dishes.json")).json()) as Record<string, Entry>;
  const entry = manifest[slug];
  if (!entry?.table) throw new Error(`${slug} has no "table" entry`);
  const scene = await build(entry);
  const glb = (await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 1024 })) as ArrayBuffer;
  // base64 so an automated browser (Playwright) can hand the bytes back to Node
  let bin = "";
  const bytes = new Uint8Array(glb);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

(window as unknown as { exportDish: typeof exportDish }).exportDish = exportDish;

document.getElementById("go")!.onclick = async () => {
  const manifest = (await (await fetch("/dishes.json")).json()) as Record<string, Entry>;
  // "model" dishes already HAVE their table file (scanned or modelled): never overwrite it
  for (const slug of Object.keys(manifest).filter((s) => manifest[s].table && manifest[s].table!.kind !== "model")) {
    const b64 = await exportDish(slug);
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: "model/gltf-binary" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.glb`;
    a.click();
    log(`✓ ${slug}.glb (${(blob.size / 1024).toFixed(0)} KB)`);
  }
};
