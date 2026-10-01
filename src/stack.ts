import * as THREE from "three";

/*
 * "Stack" dishes: a round, stacked dish (burger, layered dessert) rebuilt as real 3D from ONE
 * side photo, using the measurements from scripts/make-stack.mjs.
 *
 * The shape is a lathe of the measured profile (radius at every height, bottom → top) closed
 * underneath. The photo is projected back onto it from the camera angle it was taken at. The
 * photo only shows the front, so the angle AROUND the dish is mapped onto a band across the
 * middle of the front as a triangle wave — continuous all the way round, mirrored — so every side
 * shows real bun, patty and cheese instead of edge-on streaks. Burgers look alike from every side,
 * which is what makes this convincing.
 *
 * Built Z-up, 1 unit = the dish's widest radius, bottom at z = 0 (the AR anchor's convention).
 */

export type StackSpec = {
  texture: string;
  image: [number, number];
  /** image position of the base's centre (x = the dish's centre column, y = base ring's row), px */
  base: [number, number];
  /** widest radius in the photo, px */
  radiusPx: number;
  elevationDeg: number;
  /** [radius, height] from the base up to the top, in widest radii */
  profile: [number, number][];
};

const FRONT_BAND = 0.55; // how much of the front's width the wrap samples (±55% of the radius)
const CAP_R = 0.45; // see the top-of-dish note in stackGeometry

export function stackGeometry(spec: StackSpec, segments = 128) {
  const pts = spec.profile;
  const zTop = pts[pts.length - 1][1];
  // bottom cap → up the side → closed at the top
  const profile: [number, number][] = [[0, 0], ...pts, [0, zTop]];
  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); // Y-up lathe → Z-up dish

  geometry.computeVertexNormals(); // needed below: the top is textured differently from the sides

  const [W, H] = spec.image;
  const [cx, yb] = spec.base;
  const a = spec.radiusPx;
  const e = (spec.elevationDeg * Math.PI) / 180;
  const sinE = Math.sin(e), cosE = Math.cos(e);

  // The top layer (bun): from its widest point up. Seen from above, the side wrap smears into
  // radial streaks there, and spreading the photo's bun across the whole top turned its glossy
  // highlights into wood-grain swirls. A real bun top is an even golden brown, so the up-facing
  // crown samples a SMALL patch of the bun's front face, enlarged: smooth bun colour, with the
  // 3D lighting supplying the shape.
  let iTop = pts.length - 1;
  for (let i = pts.length - 1; i >= 0 && pts[i][1] > zTop * 0.55; i--) if (pts[i][0] > pts[iTop][0]) iTop = i;
  const [R, z0] = pts[iTop];
  const hd = zTop - z0;
  // a point on the bun's lower front face (away from the highlights near its top)
  const faceRow = yb - a * (z0 + hd * 0.3) * cosE + a * R * 0.6 * sinE;
  const PATCH = 0.14; // the crown shows ±14% of a radius of photo around that point

  const pos = geometry.attributes.position;
  const nrm = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vd = pos.getY(i);
    const z = pos.getZ(i);
    const r = Math.hypot(vx, vd);

    // sides: wrap the front band all the way round
    const around = Math.atan2(vx, -vd); // 0 = facing the photo's camera
    const s = Math.asin(Math.sin(around)) / (Math.PI / 2); // triangle wave in [-1, 1]
    const x = FRONT_BAND * s * r;
    // the same ring's point on the front (small rings sample as if CAP_R wide, so the very top
    // never reaches the photo's edge pixels)
    const rr = Math.max(r, CAP_R);
    const d = -Math.sqrt(Math.max(0, rr * rr - x * x));
    // orthographic camera `e` above the table: higher = up the image, farther = up the image
    let px = cx + a * x;
    let py = yb - a * z * cosE - a * d * sinE;

    // top: blend into the flat decal as the surface turns to face up
    if (z > z0) {
      const up = nrm.getZ(i);
      const t = Math.min(1, Math.max(0, (up - 0.22) / 0.5));
      const w = t * t * (3 - 2 * t);
      const tx = cx + a * vx * PATCH;
      const ty = faceRow + a * vd * PATCH;
      px += (tx - px) * w;
      py += (ty - py) * w;
    }
    uv.setXY(i, px / W, 1 - py / H);
  }
  uv.needsUpdate = true;
  return geometry;
}

export type Stack = { object: THREE.Group; spin: THREE.Group; material: THREE.MeshStandardMaterial };

export function buildStack(texture: THREE.Texture, spec: StackSpec, diameter: number): Stack {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.55, metalness: 0 });
  const mesh = new THREE.Mesh(stackGeometry(spec), material);
  mesh.scale.setScalar(diameter / 2);
  const spin = new THREE.Group();
  spin.add(mesh);
  const object = new THREE.Group();
  object.add(spin);
  return { object, spin, material };
}

export const STACK_TURN_SECONDS = 20;
