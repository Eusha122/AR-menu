// Hand-written ambient types for the vendored mind-ar-js browser bundle (see ../../README.md
// for why this is vendored instead of installed from npm). Loosely typed on purpose — this
// only needs to type-check our own usage, not describe the whole library.
import type { Camera, Group, Scene, WebGLRenderer } from "three";

export interface MindARAnchor {
  group: Group;
  onTargetFound?: () => void;
  onTargetLost?: () => void;
}

export interface MindARThreeOptions {
  container: HTMLElement;
  imageTargetSrc: string;
  maxTrack?: number;
  filterMinCF?: number;
  filterBeta?: number;
  uiLoading?: "yes" | "no";
  uiScanning?: "yes" | "no";
  uiError?: "yes" | "no";
}

export declare class MindARThree {
  constructor(options: MindARThreeOptions);
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera;
  addAnchor(targetIndex: number): MindARAnchor;
  start(): Promise<void>;
  stop(): void;
}
