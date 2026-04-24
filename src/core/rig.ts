import { applyConstraint } from "./constraints.js";
import { getConstraintExecutionOrder } from "./graph.js";
import {
  clampTransform,
  cloneTransform,
  composeTransform,
  identityTransform,
  mergeTransform,
  normalizeTransform,
} from "./math.js";
import type {
  ControlDefinition,
  EvaluationResult,
  RigDefinition,
  RigSkeletonAdapter,
  SpaceDefinition,
  Transform,
  TransformLike,
} from "./types.js";

export class Rig {
  static fromJSON(definition: RigDefinition): Rig {
    return new Rig(definition);
  }

  readonly definition: RigDefinition;
  private adapter: RigSkeletonAdapter | null = null;
  private readonly controls = new Map<string, Transform>();
  private readonly controlsByName = new Map<string, ControlDefinition>();
  private readonly spacesByName = new Map<string, SpaceDefinition>();

  constructor(definition: RigDefinition) {
    this.definition = cloneDefinition(definition);
    this.validateDefinition();

    for (const control of this.definition.controls) {
      this.controlsByName.set(control.name, control);
      this.controls.set(control.name, clampTransform(normalizeTransform(control.initial), control.limits));
    }

    for (const space of this.definition.spaces) {
      this.spacesByName.set(space.name, space);
    }
  }

  bind(adapter: RigSkeletonAdapter): this {
    this.adapter = adapter;
    return this;
  }

  getAdapter(): RigSkeletonAdapter | null {
    return this.adapter;
  }

  setControl(name: string, transform: TransformLike): this {
    const definition = this.controlsByName.get(name);
    if (!definition) {
      throw new Error(`Unknown rig control: ${name}`);
    }

    const current = this.controls.get(name) ?? identityTransform();
    this.controls.set(name, clampTransform(mergeTransform(current, transform), definition.limits));
    return this;
  }

  getControl(name: string): Transform {
    const transform = this.controls.get(name);
    if (!transform) {
      throw new Error(`Unknown rig control: ${name}`);
    }
    return cloneTransform(transform);
  }

  getControlDefinitions(): ControlDefinition[] {
    return this.definition.controls.map((control) => ({ ...control }));
  }

  getControlWorldTransform(name: string): Transform {
    const control = this.controlsByName.get(name);
    const transform = this.getControl(name);

    if (!control?.space) {
      return transform;
    }

    const space = this.spacesByName.get(control.space);
    if (!space) {
      return transform;
    }

    return composeTransform(this.resolveSpaceTransform(space), transform);
  }

  evaluate(_deltaTime = 0): EvaluationResult {
    if (!this.adapter) {
      throw new Error("Rig must be bound to a skeleton adapter before evaluate()");
    }

    const appliedConstraints: string[] = [];
    const skippedConstraints: string[] = [];
    this.adapter.resetPose();
    this.adapter.updateWorldMatrices?.();

    for (const constraint of getConstraintExecutionOrder(this.definition)) {
      const applied = applyConstraint(constraint, {
        adapter: this.adapter,
        getControlTransform: (name) => this.getControl(name),
        getControlWorldTransform: (name) => this.getControlWorldTransform(name),
      });
      if (applied) {
        appliedConstraints.push(constraint.id);
        this.adapter.updateWorldMatrices?.();
      } else {
        skippedConstraints.push(constraint.id);
      }
    }

    return { appliedConstraints, skippedConstraints };
  }

  toJSON(): RigDefinition {
    const definition = cloneDefinition(this.definition);
    definition.controls = definition.controls.map((control) => ({
      ...control,
      initial: this.getControl(control.name),
    }));
    return definition;
  }

  private resolveSpaceTransform(space: SpaceDefinition): Transform {
    const offset = normalizeTransform(space.offset);
    if (!this.adapter || space.parent.type === "world") {
      return offset;
    }

    if (space.parent.type === "bone" && space.parent.name) {
      return composeTransform(this.adapter.getBoneWorldTransform(space.parent.name), offset);
    }

    if (space.parent.type === "control" && space.parent.name) {
      return composeTransform(this.getControlWorldTransform(space.parent.name), offset);
    }

    return offset;
  }

  private validateDefinition(): void {
    if (this.definition.schemaVersion !== "1.0") {
      throw new Error(`Unsupported rig schema version: ${this.definition.schemaVersion}`);
    }

    const seenControls = new Set<string>();
    for (const control of this.definition.controls) {
      if (seenControls.has(control.name)) {
        throw new Error(`Duplicate rig control: ${control.name}`);
      }
      seenControls.add(control.name);
    }

    const seenConstraints = new Set<string>();
    for (const constraint of this.definition.constraints) {
      if (seenConstraints.has(constraint.id)) {
        throw new Error(`Duplicate rig constraint: ${constraint.id}`);
      }
      seenConstraints.add(constraint.id);
    }
  }
}

function cloneDefinition(definition: RigDefinition): RigDefinition {
  return JSON.parse(JSON.stringify(definition)) as RigDefinition;
}
