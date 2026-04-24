import type { ConstraintDefinition, RigDefinition, RigGraphDefinition, RigGraphNode } from "./types.js";

export function sortGraphNodes(graph: RigGraphDefinition): RigGraphNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      continue;
    }
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = graph.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0);
  const result: RigGraphNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      break;
    }
    result.push(node);

    for (const target of outgoing.get(node.id) ?? []) {
      const nextValue = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextValue);
      if (nextValue === 0) {
        const targetNode = nodes.get(target);
        if (targetNode) {
          queue.push(targetNode);
        }
      }
    }
  }

  if (result.length !== graph.nodes.length) {
    throw new Error("Rig graph contains a cycle");
  }

  return result;
}

export function getConstraintExecutionOrder(definition: RigDefinition): ConstraintDefinition[] {
  const constraintsById = new Map(definition.constraints.map((constraint) => [constraint.id, constraint]));
  const orderedIds: string[] = [];

  for (const node of sortGraphNodes(definition.graph)) {
    if (node.type === "constraint" && node.constraintId && constraintsById.has(node.constraintId)) {
      orderedIds.push(node.constraintId);
    }
  }

  const ordered = orderedIds
    .map((id) => constraintsById.get(id))
    .filter((constraint): constraint is ConstraintDefinition => Boolean(constraint));
  const visited = new Set(ordered.map((constraint) => constraint.id));

  for (const constraint of definition.constraints) {
    if (!visited.has(constraint.id)) {
      ordered.push(constraint);
    }
  }

  return ordered;
}
