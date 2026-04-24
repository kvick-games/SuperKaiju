import {
  blendTransform,
  cloneVec3,
  distanceVec3,
  dotVec3,
  identityTransform,
  lengthVec3,
  lerpVec3,
  normalizeTransform,
  normalizeVec3,
  scaleVec3,
  subVec3,
  addVec3,
  clamp,
} from "./math.js";
import type {
  ConstraintDefinition,
  RigSkeletonAdapter,
  Transform,
  TransformRef,
  Vec3Tuple,
} from "./types.js";

export interface ConstraintContext {
  adapter: RigSkeletonAdapter;
  getControlTransform(name: string): Transform;
  getControlWorldTransform(name: string): Transform;
}

export function applyConstraint(constraint: ConstraintDefinition, context: ConstraintContext): boolean {
  if (constraint.enabled === false) {
    return false;
  }

  const weight = clamp(constraint.weight ?? 1, 0, 1);
  if (weight <= 0) {
    return false;
  }

  switch (constraint.type) {
    case "fkChain":
      applyFKChain(constraint.bones, constraint.controls, context, weight, constraint.mode ?? "local");
      return true;
    case "twoBoneIK":
      applyTwoBoneIK(constraint, context, weight);
      return true;
    case "aim":
      applyAim(constraint.bone, constraint.target, context, weight, constraint.localAxis);
      return true;
    case "parent":
      applyParent(constraint.bone, constraint.source, context, weight);
      return true;
    case "orient":
      applyOrient(constraint.bone, constraint.source, context, weight);
      return true;
    case "position":
      applyPosition(constraint.bone, constraint.source, context, weight);
      return true;
    default:
      return false;
  }
}

function getSourceWorld(ref: TransformRef, context: ConstraintContext): Transform {
  if (ref.type === "bone") {
    return context.adapter.getBoneWorldTransform(ref.name);
  }
  return context.getControlWorldTransform(ref.name);
}

function applyFKChain(
  bones: string[],
  controls: string[],
  context: ConstraintContext,
  weight: number,
  mode: "local" | "world",
): void {
  const count = Math.min(bones.length, controls.length);
  for (let index = 0; index < count; index += 1) {
    const controlTransform = context.getControlTransform(controls[index]);
    if (mode === "world") {
      const current = context.adapter.getBoneWorldTransform(bones[index]);
      context.adapter.setBoneWorldTransform(bones[index], blendTransform(current, controlTransform, weight));
    } else {
      const current = context.adapter.getBoneLocalTransform(bones[index]);
      context.adapter.setBoneLocalTransform(bones[index], blendTransform(current, controlTransform, weight));
    }
  }
}

function applyParent(bone: string, source: TransformRef, context: ConstraintContext, weight: number): void {
  const current = context.adapter.getBoneWorldTransform(bone);
  context.adapter.setBoneWorldTransform(bone, blendTransform(current, getSourceWorld(source, context), weight));
}

function applyOrient(bone: string, source: TransformRef, context: ConstraintContext, weight: number): void {
  const current = context.adapter.getBoneWorldTransform(bone);
  const sourceTransform = getSourceWorld(source, context);
  context.adapter.setBoneWorldTransform(
    bone,
    blendTransform(current, { ...current, rotation: sourceTransform.rotation }, weight),
  );
}

function applyPosition(bone: string, source: TransformRef, context: ConstraintContext, weight: number): void {
  const current = context.adapter.getBoneWorldTransform(bone);
  const sourceTransform = getSourceWorld(source, context);
  context.adapter.setBoneWorldTransform(
    bone,
    blendTransform(current, { ...current, position: sourceTransform.position }, weight),
  );
}

function applyAim(
  bone: string,
  target: TransformRef,
  context: ConstraintContext,
  weight: number,
  localAxis?: Vec3Tuple,
): void {
  const source = getSourceWorld(target, context);
  if (context.adapter.lookAtBone && weight >= 1) {
    context.adapter.lookAtBone(bone, source.position, { localAxis });
    return;
  }

  const current = context.adapter.getBoneWorldTransform(bone);
  const targetTransform = normalizeTransform({ ...current, position: current.position });
  targetTransform.position = current.position;
  context.adapter.setBoneWorldTransform(bone, blendTransform(current, targetTransform, weight));
}

function applyTwoBoneIK(
  constraint: Extract<ConstraintDefinition, { type: "twoBoneIK" }>,
  context: ConstraintContext,
  weight: number,
): void {
  const root = context.adapter.getBoneWorldTransform(constraint.rootBone);
  const mid = context.adapter.getBoneWorldTransform(constraint.midBone);
  const end = context.adapter.getBoneWorldTransform(constraint.endBone);
  const target = context.getControlWorldTransform(constraint.targetControl);
  const pole = constraint.poleControl ? context.getControlWorldTransform(constraint.poleControl) : undefined;

  const upperLength = Math.max(distanceVec3(root.position, mid.position), 0.0001);
  const lowerLength = Math.max(distanceVec3(mid.position, end.position), 0.0001);
  const rootToTarget = subVec3(target.position, root.position);
  const targetDistance = clamp(lengthVec3(rootToTarget), 0.0001, upperLength + lowerLength - 0.0001);
  const direction = normalizeVec3(rootToTarget, [0, 1, 0]);
  const poleDirection = solvePoleDirection(root.position, target.position, pole?.position, direction);
  const along = (upperLength ** 2 - lowerLength ** 2 + targetDistance ** 2) / (2 * targetDistance);
  const height = Math.sqrt(Math.max(upperLength ** 2 - along ** 2, 0));
  const solvedMid = addVec3(addVec3(root.position, scaleVec3(direction, along)), scaleVec3(poleDirection, height));
  const solvedEnd = addVec3(root.position, scaleVec3(direction, targetDistance));

  const blendedMid = lerpVec3(mid.position, solvedMid, weight);
  const blendedEnd = lerpVec3(end.position, solvedEnd, weight);

  if (context.adapter.lookAtBone) {
    context.adapter.lookAtBone(constraint.rootBone, blendedMid, { localAxis: constraint.localAxis });
    context.adapter.lookAtBone(constraint.midBone, blendedEnd, { localAxis: constraint.localAxis });
  }

  context.adapter.setBoneWorldPosition(constraint.midBone, blendedMid);
  context.adapter.setBoneWorldPosition(constraint.endBone, blendedEnd);
}

function solvePoleDirection(
  root: Vec3Tuple,
  target: Vec3Tuple,
  pole: Vec3Tuple | undefined,
  chainDirection: Vec3Tuple,
): Vec3Tuple {
  const poleVector = pole ? subVec3(pole, root) : [0, 0, 1] satisfies Vec3Tuple;
  const projected = subVec3(poleVector, scaleVec3(chainDirection, dotVec3(poleVector, chainDirection)));
  if (lengthVec3(projected) > 0.0001) {
    return normalizeVec3(projected);
  }

  const fallback: Vec3Tuple = Math.abs(chainDirection[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const fallbackProjected = subVec3(fallback, scaleVec3(chainDirection, dotVec3(fallback, chainDirection)));
  const towardTarget = subVec3(target, root);
  return lengthVec3(towardTarget) > 0 ? normalizeVec3(fallbackProjected) : cloneVec3(fallback);
}

export function createEmptyContext(adapter: RigSkeletonAdapter): ConstraintContext {
  return {
    adapter,
    getControlTransform: () => identityTransform(),
    getControlWorldTransform: () => identityTransform(),
  };
}
