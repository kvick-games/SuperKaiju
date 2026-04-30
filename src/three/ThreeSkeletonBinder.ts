import * as THREE from "three";
import type { LookAtOptions, RigSkeletonAdapter, Transform, Vec3Tuple } from "../core/index.js";

export class ThreeSkeletonBinder implements RigSkeletonAdapter {
  static fromSkinnedMesh(mesh: THREE.SkinnedMesh): ThreeSkeletonBinder {
    return new ThreeSkeletonBinder(mesh.skeleton, findRootBone(mesh.skeleton.bones), mesh);
  }

  static fromBones(bones: THREE.Bone[], root?: THREE.Object3D): ThreeSkeletonBinder {
    return new ThreeSkeletonBinder(new THREE.Skeleton(bones), root ?? findRootBone(bones));
  }

  readonly skeleton: THREE.Skeleton;
  readonly root: THREE.Object3D;
  readonly skinnedMesh?: THREE.SkinnedMesh;
  private readonly bonesByName = new Map<string, THREE.Bone>();
  private readonly restPose = new Map<string, Transform>();

  constructor(skeleton: THREE.Skeleton, root?: THREE.Object3D, skinnedMesh?: THREE.SkinnedMesh) {
    this.skeleton = skeleton;
    this.root = root ?? findRootBone(skeleton.bones);
    this.skinnedMesh = skinnedMesh;

    for (const bone of skeleton.bones) {
      this.bonesByName.set(bone.name, bone);
      this.restPose.set(bone.name, transformFromObject(bone));
    }
  }

  getBoneNames(): string[] {
    return this.skeleton.bones.map((bone) => bone.name);
  }

  getBoneParent(name: string): string | null {
    const bone = this.getBone(name);
    return bone.parent instanceof THREE.Bone && this.bonesByName.has(bone.parent.name) ? bone.parent.name : null;
  }

  getBoneLocalTransform(name: string): Transform {
    return transformFromObject(this.getBone(name));
  }

  setBoneLocalTransform(name: string, transform: Transform): void {
    applyTransformToObject(this.getBone(name), transform);
  }

  getBoneWorldTransform(name: string): Transform {
    const bone = this.getBone(name);
    bone.updateWorldMatrix(true, false);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    bone.matrixWorld.decompose(position, rotation, scale);
    return transformFromThree(position, rotation, scale);
  }

  setBoneWorldTransform(name: string, transform: Transform): void {
    const bone = this.getBone(name);
    const worldMatrix = new THREE.Matrix4().compose(
      vectorFromTuple(transform.position),
      quatFromTuple(transform.rotation),
      vectorFromTuple(transform.scale),
    );

    if (bone.parent) {
      bone.parent.updateWorldMatrix(true, false);
      const parentInverse = bone.parent.matrixWorld.clone().invert();
      worldMatrix.premultiply(parentInverse);
    }

    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    worldMatrix.decompose(position, rotation, scale);
    bone.position.copy(position);
    bone.quaternion.copy(rotation);
    bone.scale.copy(scale);
  }

  setBoneWorldPosition(name: string, position: Vec3Tuple): void {
    const bone = this.getBone(name);
    const worldPosition = vectorFromTuple(position);

    if (bone.parent) {
      bone.parent.updateWorldMatrix(true, false);
      bone.position.copy(bone.parent.worldToLocal(worldPosition));
      return;
    }

    bone.position.copy(worldPosition);
  }

  resetPose(): void {
    for (const [name, transform] of this.restPose) {
      applyTransformToObject(this.getBone(name), transform);
    }
    this.updateWorldMatrices();
  }

  updateWorldMatrices(): void {
    this.root.updateMatrixWorld(true);
    this.skinnedMesh?.skeleton.update();
  }

  lookAtBone(name: string, target: Vec3Tuple, options: LookAtOptions = {}): void {
    const bone = this.getBone(name);
    bone.updateWorldMatrix(true, false);

    const origin = new THREE.Vector3();
    bone.matrixWorld.decompose(origin, new THREE.Quaternion(), new THREE.Vector3());
    const direction = vectorFromTuple(target).sub(origin).normalize();
    if (direction.lengthSq() === 0) {
      return;
    }

    const localAxis = vectorFromTuple(options.localAxis ?? [0, 1, 0]).normalize();
    const worldRotation = new THREE.Quaternion().setFromUnitVectors(localAxis, direction);

    if (bone.parent) {
      const parentWorldRotation = new THREE.Quaternion();
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.matrixWorld.decompose(new THREE.Vector3(), parentWorldRotation, new THREE.Vector3());
      bone.quaternion.copy(parentWorldRotation.invert().multiply(worldRotation));
    } else {
      bone.quaternion.copy(worldRotation);
    }
  }

  getBone(name: string): THREE.Bone {
    const bone = this.bonesByName.get(name);
    if (!bone) {
      throw new Error(`Unknown Three.js bone: ${name}`);
    }
    return bone;
  }
}

function findRootBone(bones: THREE.Bone[]): THREE.Object3D {
  const boneSet = new Set(bones);
  return bones.find((bone) => !(bone.parent instanceof THREE.Bone) || !boneSet.has(bone.parent)) ?? bones[0];
}

function transformFromObject(object: THREE.Object3D): Transform {
  return transformFromThree(object.position, object.quaternion, object.scale);
}

function transformFromThree(position: THREE.Vector3, rotation: THREE.Quaternion, scale: THREE.Vector3): Transform {
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    scale: [scale.x, scale.y, scale.z],
  };
}

function applyTransformToObject(object: THREE.Object3D, transform: Transform): void {
  object.position.fromArray(transform.position);
  object.quaternion.fromArray(transform.rotation);
  object.scale.fromArray(transform.scale);
}

function vectorFromTuple(value: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function quatFromTuple(value: Transform["rotation"]): THREE.Quaternion {
  return new THREE.Quaternion(value[0], value[1], value[2], value[3]);
}
