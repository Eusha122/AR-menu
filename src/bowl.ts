import * as THREE from "three";

/*
 * "Bowl" dishes: a dish in a round bowl (ramen, pho, curry, rice bowls) rebuilt as real 3D from
 * ONE angled photo, using the measurements from scripts/make-bowl.mjs.
 *
 * The bowl is a lathe (a profile spun around the centre) with the measured outer shape, a
 * rounded rim, a short inner wall and the soup surface just below the rim. The photo is then
 * projected back onto it FROM THE CAMERA ANGLE IT WAS TAKEN AT, so every pixel lands on the part
 * of the bowl it came from — the soup and toppings on the soup surface, the glaze on the outside.
 * The half of the outside the camera never saw is filled by mirroring the front, which is
 * seamless on a plain-glazed bowl.
 *
 * Built Z-up, 1 unit = the rim radius, bottom at z = 0 (the AR anchor's own convention).
 */

export type BowlSpec = {
  texture: string;
  image: [number, number];
  /** rim centre in the photo, px */
  center: [number, number];
  /** rim radius in the photo, px */
  radiusPx: number;
  elevationDeg: number;
  /** bowl height (rim to foot), in rim radii */
  depth: number;
  /** outer profile, rim → foot: [radius, depth below rim] */
  outer: [number, number][];
  /** how far the soup sits below the rim, in rim radii (default 0.09) */
  fill?: number;
};

export function bowlGeometry(spec: BowlSpec, segments = 160) {
  const T = spec.depth;
  const fill = spec.fill ?? 0.09;
  const footR = spec.outer[spec.outer.length - 1][0];

  // profile, bottom centre → foot → up the outside → over the rim → down the inside → soup
  const outside: [number, number][] = [[0, 0], [footR, 0], ...[...spec.outer].reverse().map(([r, t]) => [r, T - t] as [number, number])];
  const inside: [number, number][] = [
    [0.986, T + 0.014], // rounded rim lip
    [0.966, T],
    [0.95, T - fill], // soup line
    [0.0, T - fill], // soup surface, centre
  ];
  const profile = [...outside, ...inside];
  const OUTSIDE_POINTS = outside.length;

  const geometry = new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), segments);
  geometry.rotateX(Math.PI / 2); // Y-up lathe → Z-up dish

  // Project the photo onto the bowl from the photo's own camera (orthographic, looking down at
  // `elevation`, toward +Y). A point at depth d (+Y = away from that camera) and height z lands
  // on image row  cy − a·d·sin(e) − a·(z − T)·cos(e).
  const [W, H] = spec.image;
  const [cx, cy] = spec.center;
  const a = spec.radiusPx;
  const e = (spec.elevationDeg * Math.PI) / 180;
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let d = pos.getY(i);
    const z = pos.getZ(i);
    if (i % profile.length < OUTSIDE_POINTS) {
      // The OUTSIDE is wrapped only from the middle of the front, where the photo sees the glaze
      // head-on. Projecting it straight (and mirroring the unseen back) looked right from the
      // front, but toward the sides the photo sees the wall edge-on — a lot of bowl stretched
      // from a few pixels — and turned the bowl showed smeared streaks and a bright oval there.
      // Here the angle around the bowl maps onto a front band (±55% of the radius) as a
      // triangle wave: continuous all the way round, mirrored — invisible on a plain glaze.
      const r = Math.hypot(x, d);
      const around = Math.atan2(x, -d); // 0 = facing the photo's camera
      const s = Math.asin(Math.sin(around)) / (Math.PI / 2); // triangle wave in [-1, 1]
      x = 0.55 * s * r;
      d = -Math.sqrt(Math.max(0, r * r - x * x)); // that point on the front of the same ring
    }
    const px = cx + a * x;
    const py = cy - a * d * Math.sin(e) - a * (z - T) * Math.cos(e);
    uv.setXY(i, px / W, 1 - py / H);
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export type Bowl = { object: THREE.Group; spin: THREE.Group; material: THREE.MeshStandardMaterial };

export function buildBowl(texture: THREE.Texture, spec: BowlSpec, diameter: number): Bowl {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(bowlGeometry(spec), material);
  mesh.scale.setScalar(diameter / 2);
  const spin = new THREE.Group();
  spin.add(mesh);
  const object = new THREE.Group();
  object.add(spin);
  return { object, spin, material };
}

export const BOWL_TURN_SECONDS = 24;
