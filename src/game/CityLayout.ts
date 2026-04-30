import * as THREE from "three";

export type CityLayoutKind = "grid" | "voronoi" | "osm";

export interface CityLayoutCell {
  id: number;
  center: THREE.Vector2;
  vertices: THREE.Vector2[];
}

export interface CityRoadNode {
  id: number;
  position: THREE.Vector2;
  roadIds: number[];
}

export interface CityRoadSegment {
  id: number;
  start: THREE.Vector2;
  end: THREE.Vector2;
  startNodeId: number;
  endNodeId: number;
  adjacentCellIds: number[];
  width: number;
  length: number;
}

export interface CityLayoutBuildingSite {
  id: string;
  center: THREE.Vector2;
  width: number;
  depth: number;
  height?: number;
  footprint?: THREE.Vector2[];
}

export type CityLayoutSurfaceKind = "park" | "water";

export interface CityLayoutSurface {
  id: string;
  kind: CityLayoutSurfaceKind;
  vertices: THREE.Vector2[];
}

export interface CityLayoutBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CityLayoutPlan {
  kind: CityLayoutKind;
  bounds: CityLayoutBounds;
  cells: CityLayoutCell[];
  roads: CityRoadSegment[];
  nodes: CityRoadNode[];
  sourceName?: string;
  buildingSites?: CityLayoutBuildingSite[];
  surfaces?: CityLayoutSurface[];
}

export interface CityLayoutOptions {
  gridRadius: number;
  cellSize: number;
  roadWidth: number;
}

export interface CityLayoutStrategy {
  readonly kind: CityLayoutKind;
  generate(options: CityLayoutOptions): CityLayoutPlan;
}

interface EdgeDraft {
  start: THREE.Vector2;
  end: THREE.Vector2;
  adjacentCellIds: number[];
}

export class GridCityLayoutStrategy implements CityLayoutStrategy {
  readonly kind = "grid" as const;

  generate(options: CityLayoutOptions): CityLayoutPlan {
    const cells = this.createCells(options);
    const roads = this.createRoads(cells, options.roadWidth);
    const nodes = createRoadNodes(roads);

    return {
      kind: this.kind,
      bounds: expandCityLayoutBounds(createCityLayoutBoundsFromPoints(getCellVertices(cells)), options.roadWidth * 1.5),
      cells,
      roads,
      nodes,
    };
  }

  private createCells(options: CityLayoutOptions): CityLayoutCell[] {
    const cells: CityLayoutCell[] = [];
    const half = options.cellSize / 2;
    let id = 0;

    for (let gx = -options.gridRadius; gx <= options.gridRadius; gx += 1) {
      for (let gz = -options.gridRadius; gz <= options.gridRadius; gz += 1) {
        const center = new THREE.Vector2(gx * options.cellSize, gz * options.cellSize);
        cells.push({
          id,
          center,
          vertices: [
            new THREE.Vector2(center.x - half, center.y - half),
            new THREE.Vector2(center.x + half, center.y - half),
            new THREE.Vector2(center.x + half, center.y + half),
            new THREE.Vector2(center.x - half, center.y + half),
          ],
        });
        id += 1;
      }
    }

    return cells;
  }

  private createRoads(cells: CityLayoutCell[], roadWidth: number): CityRoadSegment[] {
    const edges = new Map<string, EdgeDraft>();

    for (const cell of cells) {
      for (let index = 0; index < cell.vertices.length; index += 1) {
        const start = cell.vertices[index];
        const end = cell.vertices[(index + 1) % cell.vertices.length];
        const key = createEdgeKey(start, end);
        const edge = edges.get(key);

        if (edge) {
          edge.adjacentCellIds.push(cell.id);
        } else {
          edges.set(key, {
            start: start.clone(),
            end: end.clone(),
            adjacentCellIds: [cell.id],
          });
        }
      }
    }

    return [...edges.values()].map((edge, id) => ({
      id,
      start: edge.start,
      end: edge.end,
      startNodeId: -1,
      endNodeId: -1,
      adjacentCellIds: edge.adjacentCellIds,
      width: roadWidth,
      length: edge.start.distanceTo(edge.end),
    }));
  }

}

export function createCityLayoutBoundsFromPoints(points: Iterable<THREE.Vector2>): CityLayoutBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.y);
    maxZ = Math.max(maxZ, point.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
  }

  return { minX, maxX, minZ, maxZ };
}

export function expandCityLayoutBounds(bounds: CityLayoutBounds, padding: number): CityLayoutBounds {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minZ: bounds.minZ - padding,
    maxZ: bounds.maxZ + padding,
  };
}

function* getCellVertices(cells: CityLayoutCell[]): Iterable<THREE.Vector2> {
  for (const cell of cells) {
    yield* cell.vertices;
  }
}

export function createRoadNodes(roads: CityRoadSegment[]): CityRoadNode[] {
  const nodeKeys = new Map<string, CityRoadNode>();

  for (const road of roads) {
    const startNode = getOrCreateRoadNode(nodeKeys, road.start);
    const endNode = getOrCreateRoadNode(nodeKeys, road.end);

    road.startNodeId = startNode.id;
    road.endNodeId = endNode.id;
    startNode.roadIds.push(road.id);
    endNode.roadIds.push(road.id);
  }

  return [...nodeKeys.values()];
}

function getOrCreateRoadNode(nodes: Map<string, CityRoadNode>, position: THREE.Vector2): CityRoadNode {
  const key = createVertexKey(position);
  const existing = nodes.get(key);
  if (existing) {
    return existing;
  }

  const node: CityRoadNode = {
    id: nodes.size,
    position: position.clone(),
    roadIds: [],
  };
  nodes.set(key, node);
  return node;
}

function createEdgeKey(a: THREE.Vector2, b: THREE.Vector2): string {
  const keyA = createVertexKey(a);
  const keyB = createVertexKey(b);
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}

function createVertexKey(point: THREE.Vector2): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}
