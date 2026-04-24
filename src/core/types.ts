export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface Transform {
  position: Vec3Tuple;
  rotation: QuatTuple;
  scale: Vec3Tuple;
}

export interface TransformLike {
  position?: Vec3Tuple;
  rotation?: QuatTuple;
  euler?: Vec3Tuple;
  scale?: Vec3Tuple;
}

export interface TransformRange {
  min?: Vec3Tuple;
  max?: Vec3Tuple;
}

export interface TransformLimits {
  position?: TransformRange;
  rotation?: TransformRange;
  scale?: TransformRange;
}

export type ControlShape = "sphere" | "cube" | "circle" | "locator";

export interface ControlDefinition {
  name: string;
  targetBone?: string;
  shape?: ControlShape;
  color?: string;
  initial?: TransformLike;
  limits?: TransformLimits;
  space?: string;
  metadata?: Record<string, unknown>;
}

export interface SpaceDefinition {
  name: string;
  parent: {
    type: "world" | "bone" | "control";
    name?: string;
  };
  offset?: TransformLike;
}

export interface TransformRef {
  type: "control" | "bone";
  name: string;
}

export interface BaseConstraintDefinition {
  id: string;
  enabled?: boolean;
  weight?: number;
}

export interface FKChainConstraintDefinition extends BaseConstraintDefinition {
  type: "fkChain";
  bones: string[];
  controls: string[];
  mode?: "local" | "world";
}

export interface TwoBoneIKConstraintDefinition extends BaseConstraintDefinition {
  type: "twoBoneIK";
  rootBone: string;
  midBone: string;
  endBone: string;
  targetControl: string;
  poleControl?: string;
  localAxis?: Vec3Tuple;
}

export interface AimConstraintDefinition extends BaseConstraintDefinition {
  type: "aim";
  bone: string;
  target: TransformRef;
  localAxis?: Vec3Tuple;
}

export interface ParentConstraintDefinition extends BaseConstraintDefinition {
  type: "parent";
  bone: string;
  source: TransformRef;
}

export interface OrientConstraintDefinition extends BaseConstraintDefinition {
  type: "orient";
  bone: string;
  source: TransformRef;
}

export interface PositionConstraintDefinition extends BaseConstraintDefinition {
  type: "position";
  bone: string;
  source: TransformRef;
}

export type ConstraintDefinition =
  | FKChainConstraintDefinition
  | TwoBoneIKConstraintDefinition
  | AimConstraintDefinition
  | ParentConstraintDefinition
  | OrientConstraintDefinition
  | PositionConstraintDefinition;

export interface RigGraphNode {
  id: string;
  type: "control" | "constraint" | "group" | "comment";
  label?: string;
  controlName?: string;
  constraintId?: string;
  position?: Vec3Tuple;
  metadata?: Record<string, unknown>;
}

export interface RigGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface RigGraphDefinition {
  nodes: RigGraphNode[];
  edges: RigGraphEdge[];
}

export interface RigDefinition {
  schemaVersion: "1.0";
  skeletonRef: {
    kind: "gltf" | "generated" | "external";
    uri?: string;
    rootBone?: string;
    boneMap?: Record<string, string>;
  };
  controls: ControlDefinition[];
  spaces: SpaceDefinition[];
  graph: RigGraphDefinition;
  constraints: ConstraintDefinition[];
  metadata?: Record<string, unknown>;
}

export interface LookAtOptions {
  localAxis?: Vec3Tuple;
}

export interface RigSkeletonAdapter {
  getBoneNames(): string[];
  getBoneParent(name: string): string | null;
  getBoneLocalTransform(name: string): Transform;
  setBoneLocalTransform(name: string, transform: Transform): void;
  getBoneWorldTransform(name: string): Transform;
  setBoneWorldTransform(name: string, transform: Transform): void;
  setBoneWorldPosition(name: string, position: Vec3Tuple): void;
  resetPose(): void;
  updateWorldMatrices?(): void;
  lookAtBone?(name: string, target: Vec3Tuple, options?: LookAtOptions): void;
}

export interface EvaluationResult {
  appliedConstraints: string[];
  skippedConstraints: string[];
}
