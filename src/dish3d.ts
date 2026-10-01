import * as THREE from "three";
import { buildBowl, BOWL_TURN_SECONDS, type BowlSpec } from "./bowl";
import { buildDisc, DISC_TURN_SECONDS } from "./disc";
import { buildStack, STACK_TURN_SECONDS, type StackSpec } from "./stack";

/**
 * Every dish that's real 3D, rebuilt from its ONE menu photo, by shape:
 *  - `disc`  round & flat (pizza) — scripts/make-disc.mjs
 *  - `bowl`  in a round bowl, plate, pot, cup or glass — scripts/make-bowl.mjs
 *  - `stack` round & stacked (burger) — scripts/make-stack.mjs
 * The coaster view, the dev preview and the table-AR exporter all build dishes through here.
 */
export type Shape3D = { disc?: string; bowl?: BowlSpec; stack?: StackSpec };

export const has3D = (d: Shape3D) => Boolean(d.disc || d.bowl || d.stack);
export const textureOf = (d: Shape3D) => d.bowl?.texture ?? d.stack?.texture ?? d.disc!;

export type Dish3D = {
  object: THREE.Group;
  spin: THREE.Group;
  material: THREE.MeshStandardMaterial;
  turnSeconds: number;
};

/** Builds the dish Z-up, `diameter` wide, resting on z = 0. `textureUrl` overrides the photo URL. */
export async function build3D(d: Shape3D, diameter: number, textureUrl = textureOf(d)): Promise<Dish3D> {
  const texture = await new THREE.TextureLoader().loadAsync(textureUrl);
  if (d.bowl) return { ...buildBowl(texture, d.bowl, diameter), turnSeconds: BOWL_TURN_SECONDS };
  if (d.stack) return { ...buildStack(texture, d.stack, diameter), turnSeconds: STACK_TURN_SECONDS };
  return { ...buildDisc(texture, diameter), turnSeconds: DISC_TURN_SECONDS };
}
