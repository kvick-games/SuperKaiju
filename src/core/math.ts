import type { QuatTuple, Transform, TransformLike, TransformLimits, Vec3Tuple } from "./types.js";

export const EPSILON = 1e-6;
export const IDENTITY_QUAT: QuatTuple = [0, 0, 0, 1];
export const ZERO_VEC3: Vec3Tuple = [0, 0, 0];
export const ONE_VEC3: Vec3Tuple = [1, 1, 1];

export function vec3(x = 0, y = 0, z = 0): Vec3Tuple {
  return [x, y, z];
}

export function cloneVec3(value: Vec3Tuple): Vec3Tuple {
  return [value[0], value[1], value[2]];
}

export function addVec3(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec3(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function mulVec3(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function scaleVec3(a: Vec3Tuple, scale: number): Vec3Tuple {
  return [a[0] * scale, a[1] * scale, a[2] * scale];
}

export function dotVec3(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function crossVec3(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function lengthVec3(a: Vec3Tuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalizeVec3(a: Vec3Tuple, fallback: Vec3Tuple = [0, 1, 0]): Vec3Tuple {
  const len = lengthVec3(a);
  if (len < EPSILON) {
    return cloneVec3(fallback);
  }
  return scaleVec3(a, 1 / len);
}

export function distanceVec3(a: Vec3Tuple, b: Vec3Tuple): number {
  return lengthVec3(subVec3(a, b));
}

export function lerpVec3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function clamp(value: number, min = -Infinity, max = Infinity): number {
  return Math.min(Math.max(value, min), max);
}

export function clampVec3(value: Vec3Tuple, min?: Vec3Tuple, max?: Vec3Tuple): Vec3Tuple {
  return [
    clamp(value[0], min?.[0], max?.[0]),
    clamp(value[1], min?.[1], max?.[1]),
    clamp(value[2], min?.[2], max?.[2]),
  ];
}

export function quat(x = 0, y = 0, z = 0, w = 1): QuatTuple {
  return normalizeQuat([x, y, z, w]);
}

export function cloneQuat(value: QuatTuple): QuatTuple {
  return [value[0], value[1], value[2], value[3]];
}

export function normalizeQuat(q: QuatTuple): QuatTuple {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (len < EPSILON) {
    return cloneQuat(IDENTITY_QUAT);
  }
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

export function multiplyQuat(a: QuatTuple, b: QuatTuple): QuatTuple {
  return normalizeQuat([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}

export function slerpQuat(a: QuatTuple, b: QuatTuple, t: number): QuatTuple {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;

  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (1 - cos < EPSILON) {
    return normalizeQuat([
      a[0] + (bx - a[0]) * t,
      a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t,
      a[3] + (bw - a[3]) * t,
    ]);
  }

  const theta = Math.acos(cos);
  const sinTheta = Math.sin(theta);
  const scaleA = Math.sin((1 - t) * theta) / sinTheta;
  const scaleB = Math.sin(t * theta) / sinTheta;
  return normalizeQuat([
    a[0] * scaleA + bx * scaleB,
    a[1] * scaleA + by * scaleB,
    a[2] * scaleA + bz * scaleB,
    a[3] * scaleA + bw * scaleB,
  ]);
}

export function quatFromAxisAngle(axis: Vec3Tuple, radians: number): QuatTuple {
  const n = normalizeVec3(axis);
  const half = radians / 2;
  const s = Math.sin(half);
  return quat(n[0] * s, n[1] * s, n[2] * s, Math.cos(half));
}

export function quatFromUnitVectors(from: Vec3Tuple, to: Vec3Tuple): QuatTuple {
  const f = normalizeVec3(from);
  const t = normalizeVec3(to);
  const dot = dotVec3(f, t);

  if (dot < -1 + EPSILON) {
    const axis = Math.abs(f[0]) > 0.9 ? crossVec3([0, 1, 0], f) : crossVec3([1, 0, 0], f);
    return quatFromAxisAngle(axis, Math.PI);
  }

  const axis = crossVec3(f, t);
  return normalizeQuat([axis[0], axis[1], axis[2], 1 + dot]);
}

export function quatFromEuler(euler: Vec3Tuple): QuatTuple {
  const [x, y, z] = euler;
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);

  return quat(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  );
}

export function quatToEuler(q: QuatTuple): Vec3Tuple {
  const [x, y, z, w] = normalizeQuat(q);
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI * 0.5 : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);
  return [roll, pitch, yaw];
}

export function identityTransform(): Transform {
  return {
    position: cloneVec3(ZERO_VEC3),
    rotation: cloneQuat(IDENTITY_QUAT),
    scale: cloneVec3(ONE_VEC3),
  };
}

export function normalizeTransform(value: TransformLike | Transform = {}): Transform {
  const euler = (value as TransformLike).euler;
  return {
    position: value.position ? cloneVec3(value.position) : cloneVec3(ZERO_VEC3),
    rotation: value.rotation ? normalizeQuat(value.rotation) : euler ? quatFromEuler(euler) : cloneQuat(IDENTITY_QUAT),
    scale: value.scale ? cloneVec3(value.scale) : cloneVec3(ONE_VEC3),
  };
}

export function mergeTransform(base: Transform, update: TransformLike): Transform {
  return normalizeTransform({
    position: update.position ?? base.position,
    rotation: update.rotation ?? (update.euler ? quatFromEuler(update.euler) : base.rotation),
    scale: update.scale ?? base.scale,
  });
}

export function blendTransform(a: Transform, b: Transform, weight: number): Transform {
  const t = clamp(weight, 0, 1);
  return {
    position: lerpVec3(a.position, b.position, t),
    rotation: slerpQuat(a.rotation, b.rotation, t),
    scale: lerpVec3(a.scale, b.scale, t),
  };
}

export function clampTransform(value: Transform, limits?: TransformLimits): Transform {
  if (!limits) {
    return normalizeTransform(value);
  }

  const euler = limits.rotation ? clampVec3(quatToEuler(value.rotation), limits.rotation.min, limits.rotation.max) : undefined;
  return normalizeTransform({
    position: limits.position ? clampVec3(value.position, limits.position.min, limits.position.max) : value.position,
    rotation: euler ? quatFromEuler(euler) : value.rotation,
    scale: limits.scale ? clampVec3(value.scale, limits.scale.min, limits.scale.max) : value.scale,
  });
}

export function composeTransform(parent: Transform, child: Transform): Transform {
  return {
    position: addVec3(parent.position, child.position),
    rotation: multiplyQuat(parent.rotation, child.rotation),
    scale: mulVec3(parent.scale, child.scale),
  };
}

export function cloneTransform(value: Transform): Transform {
  return {
    position: cloneVec3(value.position),
    rotation: cloneQuat(value.rotation),
    scale: cloneVec3(value.scale),
  };
}
