import type { BowlSpec } from "./bowl";

/**
 * Shared page UI: the DOM, status text, and error messages. Kept free of three.js so the start
 * screen can render before the heavy AR code has downloaded.
 */

/**
 * One dish, as listed in /public/dishes.json.
 *  - `video`: side-by-side colour|matte MP4 (scripts/ai-matte — see README). Shown as a sprite.
 *  - `disc`: top-down texture of a round flat dish (scripts/make-disc.mjs) — rebuilt as real 3D
 *    and turned on the coaster. Best for pizza, thali, flatbreads. Preferred over `video`.
 *  - `bowl`: a dish in a round bowl (ramen) — measurements from scripts/make-bowl.mjs; rebuilt as
 *    real 3D with the photo projected back onto it.
 *  - `sprite`: still background-free photo of a TALL dish (burger) — stands on the coaster facing
 *    the phone. Placeholder until a turntable `video` of the dish exists.
 *  - `model`: optional .glb 3D model; if set it's used instead of the others.
 *  - `price`: base (medium) price in taka; the Order sheet derives Small / Large from it.
 *  - `poster`: transparent image of the dish for the start screen and the dish list.
 */
export type DishEntry = { label: string; video?: string; disc?: string; bowl?: BowlSpec; sprite?: string; model?: string; table?: TableEntry; poster?: string; target: string; price: number };
/** "View on your table" — a real-size .glb for the phone's own AR (made by /tools/export.html). */
export type TableEntry = { kind: "disc" | "bowl" | "model"; diameterM: number; texture?: string; model: string };
export type Manifest = Record<string, DishEntry>;

const $ = <T extends Element>(sel: string) => document.querySelector(sel) as T;
export const startScreen = $<HTMLElement>("#start");
export const startTitle = $<HTMLHeadingElement>("#start-title");
export const startCopy = $<HTMLParagraphElement>("#start-copy");
export const startBtn = $<HTMLButtonElement>("#start-btn");
export const tableBtn = $<HTMLButtonElement>("#table-btn");
export const poster = $<HTMLImageElement>("#start-poster");
export const dishList = $<HTMLUListElement>("#dish-list");
export const fine = $<HTMLParagraphElement>("#fine");
export const hint = $<HTMLDivElement>("#hint");
export const reticle = $<HTMLDivElement>("#reticle");
export const orderBar = $<HTMLDivElement>("#order");
export const orderAr = $<HTMLButtonElement>("#order-ar");
export const orderOpen = $<HTMLButtonElement>("#order-open");
export const container = $<HTMLDivElement>("#ar-container");

export function say(message: string, isError = false) {
  startCopy.textContent = message;
  startCopy.classList.toggle("err", isError);
}

export function setButton(label: string, enabled: boolean, onClick?: () => void) {
  startBtn.textContent = label;
  startBtn.disabled = !enabled;
  if (onClick) startBtn.onclick = onClick;
}

/** Scanning frame + "point at the coaster" hint, shown until the coaster is found. */
export function scanning(on: boolean) {
  hint.classList.toggle("hidden", !on);
  reticle.classList.toggle("hidden", !on);
}

export function cameraFailed(err: unknown) {
  console.error(err);
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    say(
      "Camera access is blocked. Tap the lock or ⓘ icon next to the address bar, allow the camera for this site, then tap Try again.",
      true,
    );
  } else if (name === "NotFoundError" || name === "OverconstrainedError") {
    say("No camera was found on this device. Open this page on your phone instead.", true);
  } else if (name === "NotReadableError") {
    say("Your camera is being used by another app. Close it, then tap Try again.", true);
  } else {
    say("The camera couldn't start. Close other camera apps and tap Try again.", true);
  }
  setButton("Try again", true, () => location.reload());
}
