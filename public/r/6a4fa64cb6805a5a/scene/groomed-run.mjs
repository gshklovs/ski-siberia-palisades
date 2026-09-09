import { RUNS } from './layout.mjs';
import { canonicalTrees } from './tree-layout.mjs';
import { applyGroomedSnow, createGroomedV4Texture } from './snow-surface.mjs';

export const GROOMED_RUN_ID = 'siberia-bowl';
export const GROOMED_SPACING_M = .06;
export const GROOMED_RELIEF_M = .0075;
export const GROOMED_TINT = '#ccdfeb';
const EDGE_FADE_M = 4;
const ROUTE_CELL_M = 64;
const TREE_INNER_M = 2.5;
const TREE_OUTER_M = 6.5;
const SLOPE_ZERO_NORMAL_Z = Math.cos(52 * Math.PI / 180);
const SLOPE_FULL_NORMAL_Z = Math.cos(38 * Math.PI / 180);

function smoothstep(edge0, edge1, value) {
  const bounded = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return bounded * bounded * (3 - 2 * bounded);
}

function selectMainRun() {
  const run = RUNS.find(candidate => candidate.id === GROOMED_RUN_ID);
  if (!run || run.name !== 'Siberia Bowl' || run.kind !== 'piste') throw new Error('Canonical Siberia Bowl piste is unavailable');
  return run;
}

const run = selectMainRun();
const centerline = run.pts.map(point => point.slice());
const descentEast = centerline.at(-1)[0] - centerline[0][0];
const descentNorth = centerline.at(-1)[1] - centerline[0][1];
const descentLength = Math.hypot(descentEast, descentNorth);
export const GROOMED_DIRECTION = Object.freeze([descentEast / descentLength, descentNorth / descentLength]);
export function straightGroomedCoordinates(east, north) {
  const relativeEast = east - centerline[0][0];
  const relativeNorth = north - centerline[0][1];
  return [-relativeEast * GROOMED_DIRECTION[1] + relativeNorth * GROOMED_DIRECTION[0], relativeEast * GROOMED_DIRECTION[0] + relativeNorth * GROOMED_DIRECTION[1]];
}
const segments = [];
let horizontalLengthM = 0;
for (let index = 0; index < centerline.length - 1; index++) {
  const first = centerline[index];
  const second = centerline[index + 1];
  const deltaEast = second[0] - first[0];
  const deltaNorth = second[1] - first[1];
  const length = Math.hypot(deltaEast, deltaNorth);
  if (!length) continue;
  segments.push({
    index,
    first,
    second,
    deltaEast,
    deltaNorth,
    length,
    inverseSquareLength: 1 / (length * length),
    startDistanceM: horizontalLengthM,
    bounds: [Math.min(first[0], second[0]) - run.width - TREE_OUTER_M, Math.min(first[1], second[1]) - run.width - TREE_OUTER_M, Math.max(first[0], second[0]) + run.width + TREE_OUTER_M, Math.max(first[1], second[1]) + run.width + TREE_OUTER_M]
  });
  horizontalLengthM += length;
}

const centerlineExtent = [
  Math.min(...centerline.map(point => point[0])),
  Math.min(...centerline.map(point => point[1])),
  Math.max(...centerline.map(point => point[0])),
  Math.max(...centerline.map(point => point[1]))
];
const maskBounds = [centerlineExtent[0] - run.width, centerlineExtent[1] - run.width, centerlineExtent[2] + run.width, centerlineExtent[3] + run.width];
const routeCells = new Map();
const cellKey = (column, row) => `${column}:${row}`;
for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
  const bounds = segments[segmentIndex].bounds;
  for (let row = Math.floor(bounds[1] / ROUTE_CELL_M); row <= Math.floor(bounds[3] / ROUTE_CELL_M); row++) {
    for (let column = Math.floor(bounds[0] / ROUTE_CELL_M); column <= Math.floor(bounds[2] / ROUTE_CELL_M); column++) {
      const key = cellKey(column, row);
      if (!routeCells.has(key)) routeCells.set(key, []);
      routeCells.get(key).push(segmentIndex);
    }
  }
}

function pointAtDistance(distanceM) {
  const distance = Math.max(0, Math.min(horizontalLengthM, distanceM));
  const segment = segments.find(candidate => distance <= candidate.startDistanceM + candidate.length) ?? segments.at(-1);
  const fraction = (distance - segment.startDistanceM) / segment.length;
  return segment.first.map((value, axis) => value + (segment.second[axis] - value) * fraction);
}

export const GROOMED_RUN = Object.freeze({
  id: run.id,
  name: run.name,
  kind: run.kind,
  difficulty: run.diff,
  widthSource: run.widthSrc,
  outerHalfWidthM: run.width,
  innerHalfWidthM: run.width - EDGE_FADE_M,
  edgeFadeM: EDGE_FADE_M,
  horizontalLengthM,
  sourceLengthM: run.length_m,
  corridorAreaUpperBoundM2: 2 * run.width * horizontalLengthM + Math.PI * run.width * run.width,
  centerlineExtent,
  maskBounds,
  center: pointAtDistance(horizontalLengthM / 2),
  centerline,
  corduroyDirection: GROOMED_DIRECTION,
  corduroyAlignment: 'Straight parallel lines along overall summit-to-base descent; route mask follows trail bends'
});

function nearestGroomedRun(east, north, maximumDistanceM) {
  const bounds = [centerlineExtent[0] - maximumDistanceM, centerlineExtent[1] - maximumDistanceM, centerlineExtent[2] + maximumDistanceM, centerlineExtent[3] + maximumDistanceM];
  if (east < bounds[0] || east > bounds[2] || north < bounds[1] || north > bounds[3]) return null;
  const candidates = routeCells.get(cellKey(Math.floor(east / ROUTE_CELL_M), Math.floor(north / ROUTE_CELL_M)));
  if (!candidates) return null;
  let nearest;
  for (const segmentIndex of candidates) {
    const segment = segments[segmentIndex];
    const fraction = Math.max(0, Math.min(1, ((east - segment.first[0]) * segment.deltaEast + (north - segment.first[1]) * segment.deltaNorth) * segment.inverseSquareLength));
    const routeEast = segment.first[0] + segment.deltaEast * fraction;
    const routeNorth = segment.first[1] + segment.deltaNorth * fraction;
    const offsetEast = east - routeEast;
    const offsetNorth = north - routeNorth;
    const squareDistance = offsetEast * offsetEast + offsetNorth * offsetNorth;
    if (!nearest || squareDistance < nearest.squareDistance) {
      nearest = {
        squareDistance,
        distanceM: Math.sqrt(squareDistance),
        acrossM: (segment.deltaEast * offsetNorth - segment.deltaNorth * offsetEast) / segment.length,
        alongM: segment.startDistanceM + segment.length * fraction,
        segmentIndex,
        candidateCount: candidates.length
      };
    }
  }
  if (!nearest || nearest.distanceM >= maximumDistanceM) return null;
  return nearest;
}

export function sampleGroomedRun(east, north) {
  const nearest = nearestGroomedRun(east, north, run.width);
  if (!nearest) return null;
  nearest.mask = 1 - smoothstep(run.width - EDGE_FADE_M, run.width, nearest.distanceM);
  return nearest;
}

function relevantTrees() {
  return canonicalTrees().filter(tree => {
    return nearestGroomedRun(tree.east, tree.north, run.width + TREE_OUTER_M);
  });
}

function treeIndex(trees) {
  const cells = new Map();
  const cellSize = TREE_OUTER_M * 2;
  for (const tree of trees) {
    const column = Math.floor(tree.east / cellSize);
    const row = Math.floor(tree.north / cellSize);
    const key = cellKey(column, row);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(tree);
  }
  return { cells, cellSize };
}

function treeMask(index, east, north) {
  const column = Math.floor(east / index.cellSize);
  const row = Math.floor(north / index.cellSize);
  let nearest = Infinity;
  for (let offsetRow = -1; offsetRow <= 1; offsetRow++) for (let offsetColumn = -1; offsetColumn <= 1; offsetColumn++) {
    for (const tree of index.cells.get(cellKey(column + offsetColumn, row + offsetRow)) ?? []) nearest = Math.min(nearest, Math.hypot(east - tree.east, north - tree.north));
  }
  return smoothstep(TREE_INNER_M, TREE_OUTER_M, nearest);
}

export function applyGroomedRun(THREE, material, geometry) {
  const started = performance.now();
  const positions = geometry.attributes.position;
  const normals = geometry.attributes.normal;
  if (!positions || !normals) throw new Error('Groomed run requires terrain positions and normals');
  const coordinates = new Float32Array(positions.count * 2);
  const masks = new Float32Array(positions.count);
  const trees = relevantTrees();
  const treesByCell = treeIndex(trees);
  let maskedVertices = 0;
  let slopeFadedVertices = 0;
  let treeFadedVertices = 0;
  let segmentEvaluations = 0;
  let maximumCandidateSegments = 0;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const east = positions.getX(vertex);
    const north = positions.getY(vertex);
    const straight = straightGroomedCoordinates(east, north);
    coordinates[vertex * 2] = straight[0];
    coordinates[vertex * 2 + 1] = straight[1];
    const nearest = sampleGroomedRun(east, north);
    if (!nearest) continue;
    segmentEvaluations += nearest.candidateCount;
    maximumCandidateSegments = Math.max(maximumCandidateSegments, nearest.candidateCount);
    const slopeMask = smoothstep(SLOPE_ZERO_NORMAL_Z, SLOPE_FULL_NORMAL_Z, Math.abs(normals.getZ(vertex)));
    const obstacleMask = treeMask(treesByCell, east, north);
    if (slopeMask < .999) slopeFadedVertices++;
    if (obstacleMask < .999) treeFadedVertices++;
    masks[vertex] = nearest.mask * slopeMask * obstacleMask;
    if (masks[vertex] > .001) maskedVertices++;
  }
  geometry.setAttribute('groomedRoute', new THREE.BufferAttribute(coordinates, 2));
  geometry.setAttribute('groomedRunMask', new THREE.BufferAttribute(masks, 1));
  const texture = createGroomedV4Texture(THREE);
  const surface = applyGroomedSnow(THREE, material, texture, { routeCoordinates: true, mask: '1.0 - rock', spacing: GROOMED_SPACING_M, relief: GROOMED_RELIEF_M, tint: GROOMED_TINT });
  return {
    enabled: true,
    route: GROOMED_RUN,
    material: { tint: GROOMED_TINT, ridgeSpacingM: GROOMED_SPACING_M, nominalReliefM: GROOMED_RELIEF_M, ridgeStrength: surface.uniforms.groomedRidgeStrength.value, windPackedDetail: false, texture: texture.name, textureReference: texture.userData.referenceAsset, generation: texture.userData.generation },
    exclusions: { slopeFadeDegrees: [38, 52], rockMask: 'existing ground rock mask', treeInnerRadiusM: TREE_INNER_M, treeOuterRadiusM: TREE_OUTER_M, relevantTrees: trees.length },
    mask: { maskedVertices, slopeFadedVertices, treeFadedVertices, segmentEvaluations, maximumCandidateSegments, routeCellM: ROUTE_CELL_M },
    budget: { ...surface.budget, routeAttributeBytes: coordinates.byteLength + masks.byteLength, shaderCenterlineLoops: 0, sharedGroundMaterial: true, sharedTexture: true, cpuBuildMs: +(performance.now() - started).toFixed(2) }
  };
}
