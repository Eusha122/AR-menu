// npm run fit-model -- <in.glb> <out.glb> <widthMetres> [simplifyRatio=1] [textureSize=2048]
// For a scanned or AI-generated dish model (e.g. raw/signature-smash-meshy.glb → public/models/).
// Scales a dish model to real size (widest horizontal extent = width), centres it, rests it on
// y = 0, makes materials non-metallic (food), then optimizes it for phones.
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, weld, textureCompress, resample, simplify } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const [inFile, outFile, widthArg, ratioArg = "1", texArg = "2048"] = process.argv.slice(2);
const ratio = Number(ratioArg), texSize = Number(texArg);
const width = Number(widthArg);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });
const doc = await io.read(inFile);
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];

// wrap everything in one root node we can scale/move
const wrapper = doc.createNode("dish");
for (const child of scene.listChildren()) {
  scene.removeChild(child);
  wrapper.addChild(child);
}
scene.addChild(wrapper);

const b = getBounds(scene);
const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
const s = width / Math.max(sx, sz);
const cx = (b.max[0] + b.min[0]) / 2, cz = (b.max[2] + b.min[2]) / 2;
wrapper.setScale([s, s, s]);
wrapper.setTranslation([-cx * s, -b.min[1] * s, -cz * s]);
console.log(`source ${sx.toFixed(3)} × ${sz.toFixed(3)} × ${sy.toFixed(3)} tall → ${(sx * s * 100).toFixed(1)} × ${(sz * s * 100).toFixed(1)} cm, ${(sy * s * 100).toFixed(1)} cm tall`);

for (const m of doc.getRoot().listMaterials()) {
  m.setMetallicFactor(0);
  m.setRoughnessFactor(Math.min(m.getRoughnessFactor(), 0.8));
}

await MeshoptSimplifier.ready;
const steps = [dedup(), prune(), weld(), resample()];
if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }));
steps.push(textureCompress({ targetFormat: "jpeg", resize: [texSize, texSize], quality: 88 }));
await doc.transform(...steps);
await io.write(outFile, doc);
