import * as THREE from "three";
import {
  createRoadNodes,
  createCityLayoutBoundsFromPoints,
  expandCityLayoutBounds,
  type CityLayoutBuildingSite,
  type CityLayoutPlan,
  type CityLayoutSurface,
  type CityRoadSegment,
} from "./CityLayout";
import { clamp } from "./math";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const DEFAULT_TARGET_SIZE = 360;
const MAX_ROAD_SEGMENTS = 420;
const MAX_BUILDING_SITES = 150;
const MAX_SURFACES = 18;
const METERS_PER_LATITUDE_DEGREE = 111_320;

interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OpenStreetMapLocation {
  label: string;
  bbox: BoundingBox;
}

interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}

interface OverpassWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay;

interface OverpassResponse {
  elements?: OverpassElement[];
}

interface ProjectedNode {
  id: number;
  lat: number;
  lon: number;
  position: THREE.Vector2;
}

interface Projection {
  project(lat: number, lon: number): THREE.Vector2;
  scale: number;
}

export const OPEN_STREET_MAP_LOCATIONS: Record<string, OpenStreetMapLocation> = {
  seattle: {
    label: "Downtown Seattle",
    bbox: {
      south: 47.6037,
      west: -122.3387,
      north: 47.6153,
      east: -122.3237,
    },
  },
  manhattan: {
    label: "Lower Manhattan",
    bbox: {
      south: 40.7052,
      west: -74.0158,
      north: 40.7166,
      east: -73.9996,
    },
  },
  sf: {
    label: "Downtown San Francisco",
    bbox: {
      south: 37.7842,
      west: -122.4097,
      north: 37.795,
      east: -122.3948,
    },
  },
};

export interface OpenStreetMapLayoutRequest {
  locationKey: string;
  location: OpenStreetMapLocation;
  targetSize?: number;
}

export function createOpenStreetMapLayoutRequest(params: URLSearchParams): OpenStreetMapLayoutRequest | null {
  if (!params.has("osm")) {
    return null;
  }

  const value = (params.get("osm") || "seattle").trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off") {
    return null;
  }

  const bbox = parseBoundingBox(params.get("osmBbox") ?? value);
  if (bbox) {
    return {
      locationKey: "custom",
      location: { label: "Custom OSM bbox", bbox },
      targetSize: parseTargetSize(params.get("osmSize")),
    };
  }

  const locationKey = OPEN_STREET_MAP_LOCATIONS[value] ? value : "seattle";
  return {
    locationKey,
    location: OPEN_STREET_MAP_LOCATIONS[locationKey],
    targetSize: parseTargetSize(params.get("osmSize")),
  };
}

export async function fetchOpenStreetMapLayout(
  request: OpenStreetMapLayoutRequest,
  signal?: AbortSignal,
): Promise<CityLayoutPlan | null> {
  const query = createOverpassQuery(request.location.bbox);
  const response = await fetch(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed with HTTP ${response.status}`);
  }

  const data = (await response.json()) as OverpassResponse;
  const layout = convertOverpassToCityLayout(data, request);
  return layout.roads.length > 0 && layout.buildingSites && layout.buildingSites.length > 0 ? layout : null;
}

export async function fetchOpenStreetMapLayoutWithTimeout(
  request: OpenStreetMapLayoutRequest,
  timeoutMs = 7500,
): Promise<CityLayoutPlan | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchOpenStreetMapLayout(request, controller.signal);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function convertOverpassToCityLayout(data: OverpassResponse, request: OpenStreetMapLayoutRequest): CityLayoutPlan {
  const elements = data.elements ?? [];
  const projection = createProjection(request.location.bbox, request.targetSize ?? DEFAULT_TARGET_SIZE);
  const nodes = new Map<number, ProjectedNode>();
  const ways: OverpassWay[] = [];

  for (const element of elements) {
    if (element.type === "node") {
      nodes.set(element.id, {
        id: element.id,
        lat: element.lat,
        lon: element.lon,
        position: projection.project(element.lat, element.lon),
      });
    } else if (element.type === "way") {
      ways.push(element);
    }
  }

  const roads = createRoadSegments(ways, nodes);
  const roadNodes = createRoadNodes(roads);
  const buildingSites = createBuildingSites(ways, nodes);
  const surfaces = createSurfaces(ways, nodes);

  return {
    kind: "osm",
    bounds: expandCityLayoutBounds(createOpenStreetMapBounds(projection, request.location.bbox), 22),
    sourceName: `${request.location.label} from OpenStreetMap`,
    cells: [],
    roads,
    nodes: roadNodes,
    buildingSites,
    surfaces,
  };
}

function createOpenStreetMapBounds(projection: Projection, bbox: BoundingBox) {
  return createCityLayoutBoundsFromPoints([
    projection.project(bbox.south, bbox.west),
    projection.project(bbox.south, bbox.east),
    projection.project(bbox.north, bbox.east),
    projection.project(bbox.north, bbox.west),
  ]);
}

function createOverpassQuery(bbox: BoundingBox): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `
[out:json][timeout:12];
(
  way["highway"]["highway"!~"^(footway|path|cycleway|steps|pedestrian|track|bridleway|corridor|elevator|platform)$"](${box});
  way["building"](${box});
  way["leisure"~"^(park|garden)$"](${box});
  way["natural"="water"](${box});
  way["waterway"="riverbank"](${box});
);
out body;
>;
out skel qt;
`;
}

function createProjection(bbox: BoundingBox, targetSize: number): Projection {
  const centerLat = (bbox.south + bbox.north) / 2;
  const centerLon = (bbox.west + bbox.east) / 2;
  const metersPerLongitudeDegree = Math.cos((centerLat * Math.PI) / 180) * METERS_PER_LATITUDE_DEGREE;
  const rawWidth = Math.max(1, (bbox.east - bbox.west) * metersPerLongitudeDegree);
  const rawDepth = Math.max(1, (bbox.north - bbox.south) * METERS_PER_LATITUDE_DEGREE);
  const scale = targetSize / Math.max(rawWidth, rawDepth);

  return {
    scale,
    project(lat, lon) {
      return new THREE.Vector2(
        (lon - centerLon) * metersPerLongitudeDegree * scale,
        -(lat - centerLat) * METERS_PER_LATITUDE_DEGREE * scale,
      );
    },
  };
}

function createRoadSegments(ways: OverpassWay[], nodes: Map<number, ProjectedNode>): CityRoadSegment[] {
  const roads: CityRoadSegment[] = [];
  const seen = new Set<string>();

  for (const way of ways) {
    const highway = way.tags?.highway;
    if (!highway) {
      continue;
    }

    const width = getRoadWidth(highway);
    for (let index = 0; index < way.nodes.length - 1; index += 1) {
      const start = nodes.get(way.nodes[index])?.position;
      const end = nodes.get(way.nodes[index + 1])?.position;
      if (!start || !end || start.distanceToSquared(end) < 4) {
        continue;
      }

      const key = createSegmentKey(start, end);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const road: CityRoadSegment = {
        id: roads.length,
        start: start.clone(),
        end: end.clone(),
        startNodeId: -1,
        endNodeId: -1,
        adjacentCellIds: [],
        width,
        length: start.distanceTo(end),
      };
      roads.push(road);
    }
  }

  roads.sort((a, b) => b.width - a.width || b.length - a.length);
  return roads.slice(0, MAX_ROAD_SEGMENTS).map((road, id) => ({ ...road, id }));
}

function createBuildingSites(ways: OverpassWay[], nodes: Map<number, ProjectedNode>): CityLayoutBuildingSite[] {
  const sites: CityLayoutBuildingSite[] = [];

  for (const way of ways) {
    if (!way.tags?.building) {
      continue;
    }

    const footprint = getClosedWayPoints(way, nodes);
    if (footprint.length < 3) {
      continue;
    }

    const bounds = getBounds(footprint);
    const width = clamp(bounds.maxX - bounds.minX, 5.5, 32);
    const depth = clamp(bounds.maxY - bounds.minY, 5.5, 32);
    if (width < 5.5 || depth < 5.5) {
      continue;
    }

    sites.push({
      id: `osm-building-${way.id}`,
      center: new THREE.Vector2((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2),
      width,
      depth,
      height: parseBuildingHeight(way.tags),
      footprint,
    });
  }

  return sites.slice(0, MAX_BUILDING_SITES);
}

function createSurfaces(ways: OverpassWay[], nodes: Map<number, ProjectedNode>): CityLayoutSurface[] {
  const surfaces: CityLayoutSurface[] = [];

  for (const way of ways) {
    const tags = way.tags ?? {};
    const kind = tags.natural === "water" || tags.waterway === "riverbank" ? "water" : tags.leisure ? "park" : null;
    if (!kind) {
      continue;
    }

    const vertices = getClosedWayPoints(way, nodes);
    if (vertices.length < 3 || polygonArea(vertices) < 18) {
      continue;
    }

    surfaces.push({
      id: `osm-surface-${way.id}`,
      kind,
      vertices,
    });
  }

  return surfaces.slice(0, MAX_SURFACES);
}

function getClosedWayPoints(way: OverpassWay, nodes: Map<number, ProjectedNode>): THREE.Vector2[] {
  const points = way.nodes
    .map((nodeId) => nodes.get(nodeId)?.position)
    .filter((point): point is THREE.Vector2 => Boolean(point))
    .map((point) => point.clone());

  if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 0.001) {
    points.pop();
  }

  return points;
}

function getRoadWidth(highway: string): number {
  switch (highway) {
    case "motorway":
    case "trunk":
    case "primary":
      return 22;
    case "secondary":
      return 19;
    case "tertiary":
    case "unclassified":
      return 16;
    case "service":
      return 10;
    default:
      return 14;
  }
}

function parseBuildingHeight(tags: Record<string, string>): number | undefined {
  const meters = parseMeters(tags.height ?? tags["building:height"]);
  if (meters !== null) {
    return clamp(meters * 0.95, 14, 96);
  }

  const levels = Number.parseFloat(tags["building:levels"] ?? "");
  if (Number.isFinite(levels) && levels > 0) {
    return clamp(levels * 3.2, 14, 96);
  }

  return undefined;
}

function parseMeters(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const feetMatch = value.match(/^([\d.]+)\s*(?:ft|feet)'?$/i);
  if (feetMatch) {
    return Number.parseFloat(feetMatch[1]) * 0.3048;
  }

  const meters = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(meters) && meters > 0 ? meters : null;
}

function parseBoundingBox(value: string | null): BoundingBox | null {
  if (!value) {
    return null;
  }

  const parts = value
    .split(",")
    .map((part) => Number.parseFloat(part.trim()))
    .filter(Number.isFinite);

  if (parts.length !== 4) {
    return null;
  }

  const [south, west, north, east] = parts;
  if (south >= north || west >= east) {
    return null;
  }

  return { south, west, north, east };
}

function parseTargetSize(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const size = Number.parseFloat(value);
  return Number.isFinite(size) ? clamp(size, 180, 620) : undefined;
}

function getBounds(points: THREE.Vector2[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

function polygonArea(points: THREE.Vector2[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }

  return Math.abs(sum) * 0.5;
}

function createSegmentKey(a: THREE.Vector2, b: THREE.Vector2): string {
  const keyA = `${a.x.toFixed(2)}:${a.y.toFixed(2)}`;
  const keyB = `${b.x.toFixed(2)}:${b.y.toFixed(2)}`;
  return keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
}
