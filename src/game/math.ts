import * as THREE from "three";

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

export function damp(start: number, end: number, smoothing: number, delta: number): number {
  return lerp(start, end, 1 - Math.exp(-smoothing * delta));
}

export function directionFromYawPitch(yaw: number, pitch: number, target = new THREE.Vector3()): THREE.Vector3 {
  const cosPitch = Math.cos(pitch);
  return target.set(Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch).normalize();
}

export function rightFromYaw(yaw: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(Math.cos(yaw), 0, Math.sin(yaw)).normalize();
}

export function horizontalDistance(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function pointToRayDistance(
  point: THREE.Vector3,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
): { distance: number; along: number } {
  const toPoint = point.clone().sub(origin);
  const along = clamp(toPoint.dot(direction), 0, maxDistance);
  const closest = origin.clone().addScaledVector(direction, along);
  return { distance: point.distanceTo(closest), along };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function randomRange(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}
