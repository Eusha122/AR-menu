import * as THREE from "three";

/*
 * "Disc" dishes: a round, flat dish (pizza, thali, flatbread) built as real 3D from ONE
 * top-down photo — the texture made by scripts/make-disc.mjs.
 *
 * The shape is a lathe (a profile spun around the centre, like a pot on a wheel): a thin base
 * with the sauce/cheese surface, rising to a puffy rounded crust rim. The photo is projected
 * straight down onto it (planar UVs), so the crust in the picture lands on the raised rim. On
 * the table it turns slowly like a display turntable; the phone's own viewing angle supplies the
 * perspective, so it's correct from any seat — unlike spinning the original angled photo, which
 * would just spin an oval like a sticker.
 *
 * Built Z-up, 1 unit = the dish's radius, bottom at z = 0 (the AR anchor's own convention).
 */

/**
 * Pizza cross-section, from the centre outward: [radius, height, texture radius], radius 1 = dish
 * edge. Proportions of a real Neapolitan pizza: ~2 cm crust on a 30 cm base (crown ≈ 0.13 R).
 *
 * The third number is where on the top-down photo each ring samples. On the top surface it's just
 * the radius (a straight-down projection). On the outer wall a straight-down projection would
 * smear the photo's last few edge pixels into vertical streaks, so the wall instead folds back
 * over the crust band of the photo — charred, blistered dough, which is what that wall looks like.
 */
const PROFILE: [number, number, number][] = [
  [0.0, 0.04, 0.0], // sauce/cheese surface, centre
  [0.78, 0.042, 0.78],
  [0.83, 0.062, 0.83], // crust starts rising (the texture's crust band begins ~0.83)
  [0.88, 0.108, 0.88],
  [0.93, 0.128, 0.93], // crust crown
  [0.97, 0.112, 0.965],
  [0.993, 0.075, 0.935], // outer wall: folds back over the crust band
  [1.0, 0.035, 0.9],
  [0.985, 0.005, 0.87], // tucked under, so the silhouette reads as a real rim, not a cut edge
  [0.0, 0.0, 0.0],
];

/** Radius of the dish circle inside the texture (make-disc: 1012 px circle in 1024, minus the 1.5 px soft edge). */
const UV_RADIUS = 0.49;

export function discGeometry(segments = 160) {
  // LatheGeometry spins points (x = radius, y = height) around Y; we then rotate it Z-up.
  const geometry = new THREE.LatheGeometry(
    PROFILE.map(([r, h]) => new THREE.Vector2(r, h)),
    segments,
  );
  geometry.rotateX(Math.PI / 2); // Y-up lathe → Z-up dish

  // Project the top-down photo onto the dish: each vertex samples the photo in its own direction
  // from the centre, at its ring's texture radius. LatheGeometry lays vertices out segment by
  // segment, PROFILE.length points each, so the ring is (vertex index % PROFILE.length).
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const len = Math.hypot(x, y);
    const texR = PROFILE[i % PROFILE.length][2];
    const [dx, dy] = len > 1e-6 ? [x / len, y / len] : [0, 0];
    uv.setXY(i, 0.5 + dx * texR * UV_RADIUS, 0.5 + dy * texR * UV_RADIUS);
  }
  uv.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export type Disc = {
  /** The dish, Z-up, sized to `diameter`, resting on z = 0. Add this to the scene/anchor. */
  object: THREE.Group;
  /** The part that turns. */
  spin: THREE.Group;
  material: THREE.MeshStandardMaterial;
};

export function buildDisc(texture: THREE.Texture, diameter: number): Disc {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; // keeps the pizza crisp at the shallow angle you view a table from
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(discGeometry(), material);
  mesh.scale.setScalar(diameter / 2);

  const spin = new THREE.Group();
  spin.add(mesh);
  const object = new THREE.Group();
  object.add(spin);
  return { object, spin, material };
}

/**
 * Lighting for a disc dish. The photo already carries its own studio lighting, so these lights
 * are gentle: mostly even ambient (keeps the photo's colours true), plus a soft key from above
 * so the crust rim gets real form shading as it turns. Lights target the dish's own origin —
 * see the note in ar.ts on why world-origin targets fail inside a mind-ar anchor.
 */
export function discLights() {
  const lights = new THREE.Group();
  lights.add(new THREE.AmbientLight(0xffffff, 1.9));
  const key = new THREE.DirectionalLight(0xfff6ea, 1.1);
  key.position.set(0.5, -0.7, 1.6);
  key.target.position.set(0, 0, 0);
  lights.add(key, key.target);
  return lights;
}

export const DISC_TURN_SECONDS = 20; // one slow, calm turn — like a display turntable
