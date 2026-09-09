import { RUNS, LIFTS } from './layout.mjs';
import { canonicalTrees } from './tree-layout.mjs';
import { resolveTerrainCollar, sampleCanonicalTerrain } from './terrain-patches.mjs';

const COLLISION_CELL_METRES = 6;
const MAX_COLLISION_CELLS_PER_TRIANGLE = 64;

export const SNOW_BANK_MAP_PRESETS = Object.freeze({
  lean: Object.freeze({ columns: 17, rows: 21, placementCap: 24, maxSlope: .58 }),
  balanced: Object.freeze({ columns: 25, rows: 31, placementCap: 30, maxSlope: .58 }),
  detail: Object.freeze({ columns: 33, rows: 41, placementCap: 24, maxSlope: .58 })
});

function hashText(text) {
  let value = 2166136261;
  for (const character of text) value = Math.imul(value ^ character.charCodeAt(0), 16777619);
  return value >>> 0;
}

function smoothstep(value) {
  value = Math.max(0, Math.min(1, value));
  return value * value * (3 - 2 * value);
}

function sampleGrid(values, columns, rows, u, v) {
  const across = Math.max(0, Math.min(columns - 1, u * (columns - 1)));
  const along = Math.max(0, Math.min(rows - 1, v * (rows - 1)));
  const column = Math.min(columns - 2, Math.floor(across));
  const row = Math.min(rows - 2, Math.floor(along));
  const fractionEast = across - column, fractionNorth = along - row;
  const start = row * columns + column;
  const south = values[start] * (1 - fractionEast) + values[start + 1] * fractionEast;
  const north = values[start + columns] * (1 - fractionEast) + values[start + columns + 1] * fractionEast;
  return south * (1 - fractionNorth) + north * fractionNorth;
}

function sourceResidualField(terrain, sourcePlacement) {
  const { geometry, grid, anchorEnu } = sourcePlacement;
  const raw = new Float64Array(grid.vertices);
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
    const vertex = row * grid.columns + column, offset = vertex * 3;
    const east = geometry.positions[offset] + anchorEnu[0];
    const north = -geometry.positions[offset + 2] + anchorEnu[1];
    raw[vertex] = geometry.positions[offset + 1] + anchorEnu[2] - sampleCanonicalTerrain(terrain, east, north);
  }
  const residuals = new Float64Array(raw.length);
  const southwest = raw[0], southeast = raw[grid.columns - 1];
  const northwest = raw[(grid.rows - 1) * grid.columns], northeast = raw[raw.length - 1];
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
    const u = column / (grid.columns - 1), v = row / (grid.rows - 1);
    const west = raw[row * grid.columns], east = raw[row * grid.columns + grid.columns - 1];
    const south = raw[column], north = raw[(grid.rows - 1) * grid.columns + column];
    const corners = southwest * (1 - u) * (1 - v) + southeast * u * (1 - v) + northwest * (1 - u) * v + northeast * u * v;
    residuals[row * grid.columns + column] = raw[row * grid.columns + column] - ((1 - u) * west + u * east + (1 - v) * south + v * north - corners);
  }
  return residuals;
}

function buildTemplate(field, sourceGrid, columns, rows, mirrorEast, mirrorNorth) {
  const positions = new Float32Array(columns * rows * 3);
  const indices = new Uint32Array((columns - 1) * (rows - 1) * 6);
  let indexOffset = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const u = column / (columns - 1), v = row / (rows - 1);
    const sampledU = mirrorEast ? 1 - u : u, sampledV = mirrorNorth ? 1 - v : v;
    const edgeFade = smoothstep(Math.min(u, 1 - u, v, 1 - v) / .12);
    const vertex = row * columns + column;
    positions.set([-16 + 32 * u, sampleGrid(field, sourceGrid.columns, sourceGrid.rows, sampledU, sampledV) * edgeFade, 20 - 40 * v], vertex * 3);
    if (column < columns - 1 && row < rows - 1) {
      const next = vertex + columns;
      indices.set([vertex, vertex + 1, next, vertex + 1, next + 1, next], indexOffset);
      indexOffset += 6;
    }
  }
  return { positions, indices };
}

function templateMetrics(field, sourceGrid, geometry, columns, rows) {
  let squaredError = 0, maximumError = 0, fullMaximum = -Infinity, fullMinimum = Infinity;
  const templateValues = Array.from({ length: columns * rows }, (_, vertex) => geometry.positions[vertex * 3 + 1]);
  for (let row = 0; row < sourceGrid.rows; row++) for (let column = 0; column < sourceGrid.columns; column++) {
    const u = column / (sourceGrid.columns - 1), v = row / (sourceGrid.rows - 1);
    const edgeFade = smoothstep(Math.min(u, 1 - u, v, 1 - v) / .12);
    const reconstructed = sampleGrid(templateValues, columns, rows, u, v);
    const expected = field[row * sourceGrid.columns + column] * edgeFade;
    const error = Math.abs(reconstructed - expected);
    squaredError += error * error;
    maximumError = Math.max(maximumError, error);
    fullMaximum = Math.max(fullMaximum, expected);
    fullMinimum = Math.min(fullMinimum, expected);
  }
  let templateMaximum = -Infinity, templateMinimum = Infinity;
  for (let offset = 1; offset < geometry.positions.length; offset += 3) {
    templateMaximum = Math.max(templateMaximum, geometry.positions[offset]);
    templateMinimum = Math.min(templateMinimum, geometry.positions[offset]);
  }
  return {
    triangles: geometry.indices.length / 3,
    rmsErrorM: Math.sqrt(squaredError / field.length),
    maximumErrorM: maximumError,
    fullCrestM: fullMaximum,
    templateCrestM: templateMaximum,
    crestRetention: templateMaximum / fullMaximum,
    fullTroughM: fullMinimum,
    templateTroughM: templateMinimum
  };
}

function pointAlong(run, distance) {
  let remaining = distance;
  for (let index = 0; index < run.pts.length - 1; index++) {
    const first = run.pts[index], second = run.pts[index + 1];
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
    if (remaining <= length) {
      const fraction = remaining / length;
      return {
        point: [first[0] + (second[0] - first[0]) * fraction, first[1] + (second[1] - first[1]) * fraction],
        tangent: [(second[0] - first[0]) / length, (second[1] - first[1]) / length]
      };
    }
    remaining -= length;
  }
  const last = run.pts.at(-1), previous = run.pts.at(-2);
  const length = Math.hypot(last[0] - previous[0], last[1] - previous[1]);
  return { point: last.slice(0, 2), tangent: [(last[0] - previous[0]) / length, (last[1] - previous[1]) / length] };
}

function distanceToPolyline(east, north, points) {
  let minimum = Infinity;
  for (let index = 0; index < points.length - 1; index++) {
    const first = points[index], second = points[index + 1];
    const deltaEast = second[0] - first[0], deltaNorth = second[1] - first[1];
    const length2 = deltaEast * deltaEast + deltaNorth * deltaNorth;
    const along = Math.max(0, Math.min(1, ((east - first[0]) * deltaEast + (north - first[1]) * deltaNorth) / (length2 || 1)));
    minimum = Math.min(minimum, Math.hypot(east - first[0] - deltaEast * along, north - first[1] - deltaNorth * along));
  }
  return minimum;
}

function terrainSlope(terrain, east, north) {
  const step = 4;
  return Math.hypot(
    sampleCanonicalTerrain(terrain, east + step, north) - sampleCanonicalTerrain(terrain, east - step, north),
    sampleCanonicalTerrain(terrain, east, north + step) - sampleCanonicalTerrain(terrain, east, north - step)
  ) / (step * 2);
}

function candidateList(terrain, sourcePlacement, settings) {
  const trees = canonicalTrees();
  const candidates = [];
  const sourceBounds = resolveTerrainCollar(terrain, [sourcePlacement.anchorEnu[0] - 16, sourcePlacement.anchorEnu[1] - 20, sourcePlacement.anchorEnu[0] + 16, sourcePlacement.anchorEnu[1] + 20], 2).outerBounds;
  for (const run of RUNS.filter(run => run.style !== 'chute' && run.style !== 'gully' && run.style !== 'bench')) {
    const length = run.pts.slice(1).reduce((total, point, index) => total + Math.hypot(point[0] - run.pts[index][0], point[1] - run.pts[index][1]), 0);
    const samples = Math.max(2, Math.floor(length / 90));
    for (let sample = 1; sample <= samples; sample++) {
      const along = pointAlong(run, length * sample / (samples + 1));
      const lateralDistance = Math.min(18, Math.max(8, run.width * .4));
      for (const lateral of [0, -lateralDistance, lateralDistance]) {
      const east = along.point[0] - along.tangent[1] * lateral, north = along.point[1] + along.tangent[0] * lateral;
      if (east - 24 <= terrain.xs[0] || east + 24 >= terrain.xs.at(-1) || north - 28 <= terrain.ys[0] || north + 28 >= terrain.ys.at(-1)) continue;
      const innerBounds = [east - 16, north - 20, east + 16, north + 20];
      const outerBounds = resolveTerrainCollar(terrain, innerBounds, 2).outerBounds;
      if (outerBounds[0] < sourceBounds[2] && outerBounds[2] > sourceBounds[0] && outerBounds[1] < sourceBounds[3] && outerBounds[3] > sourceBounds[1]) continue;
      const slopes = [[0, 0], [-16, -20], [16, -20], [-16, 20], [16, 20]].map(offset => terrainSlope(terrain, east + offset[0], north + offset[1]));
      const maximumSlope = Math.max(...slopes);
      if (maximumSlope > settings.maxSlope) continue;
      if (trees.some(tree => tree.east >= outerBounds[0] && tree.east <= outerBounds[2] && tree.north >= outerBounds[1] && tree.north <= outerBounds[3])) continue;
      if (LIFTS.some(lift => distanceToPolyline(east, north, lift.pts) < 30)) continue;
      const obstacle = RUNS.some(item => item.sign && Math.hypot(east - item.pts[0][0] - 8, north - item.pts[0][1] - 3) < 30)
        || Math.hypot(east - 102.7, north - 599.5) < 35;
      if (obstacle) continue;
      candidates.push({ run, east, north, maximumSlope, outerBounds, hash: hashText(`${run.id}:${sample}:${lateral}`) });
      }
    }
  }
  return candidates;
}

function selectCandidates(candidates, placementCap) {
  const selected = [];
  const remaining = [...candidates];
  const runIds = [...new Set(remaining.map(candidate => candidate.run.id))].sort();
  function available(candidate) {
    return selected.every(item => candidate.outerBounds[0] >= item.outerBounds[2] || candidate.outerBounds[2] <= item.outerBounds[0] || candidate.outerBounds[1] >= item.outerBounds[3] || candidate.outerBounds[3] <= item.outerBounds[1]);
  }
  for (const runId of runIds) {
    const options = remaining.filter(candidate => candidate.run.id === runId && available(candidate)).sort((first, second) => first.maximumSlope - second.maximumSlope || first.hash - second.hash);
    if (options[0]) selected.push(options[0]);
    if (selected.length >= placementCap) return selected;
  }
  while (selected.length < placementCap) {
    const options = remaining.filter(available).map(candidate => ({
      candidate,
      separation: selected.length ? Math.min(...selected.map(item => Math.hypot(item.east - candidate.east, item.north - candidate.north))) : Infinity
    })).sort((first, second) => second.separation - first.separation || first.candidate.maximumSlope - second.candidate.maximumSlope || first.candidate.hash - second.candidate.hash);
    if (!options[0]) break;
    selected.push(options[0].candidate);
  }
  return selected;
}

export function buildSnowBankMapPlacements(terrain, sourcePlacement, { preset = 'balanced' } = {}) {
  const settings = SNOW_BANK_MAP_PRESETS[preset];
  if (!settings) throw new Error(`Unknown snow bank map preset ${preset}`);
  const field = sourceResidualField(terrain, sourcePlacement);
  const variants = [
    buildTemplate(field, sourcePlacement.grid, settings.columns, settings.rows, false, false),
    buildTemplate(field, sourcePlacement.grid, settings.columns, settings.rows, true, false),
    buildTemplate(field, sourcePlacement.grid, settings.columns, settings.rows, false, true),
    buildTemplate(field, sourcePlacement.grid, settings.columns, settings.rows, true, true)
  ];
  const candidates = candidateList(terrain, sourcePlacement, settings);
  const selected = selectCandidates(candidates, settings.placementCap);
  const generated = selected.map((candidate, index) => {
    const horizontalCollar = Math.max(candidate.east - 16 - candidate.outerBounds[0], candidate.outerBounds[2] - candidate.east - 16);
    const verticalCollar = Math.max(candidate.north - 20 - candidate.outerBounds[1], candidate.outerBounds[3] - candidate.north - 20);
    const needsCollarRing = (Math.ceil(horizontalCollar / COLLISION_CELL_METRES) + 1) * (Math.ceil(verticalCollar / COLLISION_CELL_METRES) + 1) > MAX_COLLISION_CELLS_PER_TRIANGLE;
    return {
      id: `snow-map-${String(index + 1).padStart(2, '0')}-${candidate.run.id}`,
      lod: `${preset}-${settings.columns}x${settings.rows}`,
      anchorEnu: [candidate.east, candidate.north, 0],
      collarCells: 2,
      collarTaper: needsCollarRing ? { ringFraction: .5, derivativeScale: 0 } : undefined,
      geometry: variants[candidate.hash % variants.length],
      grid: { columns: settings.columns, rows: settings.rows, vertices: settings.columns * settings.rows, triangles: (settings.columns - 1) * (settings.rows - 1) * 2 },
      heightMode: 'terrain-residual',
      residualScale: .88 + (candidate.hash % 25) / 100,
      runId: candidate.run.id,
      runName: candidate.run.name,
      runStyle: candidate.run.style,
      maximumSlope: candidate.maximumSlope
    };
  });
  return {
    placements: [sourcePlacement, ...generated],
    stats: {
      preset,
      settings,
      candidateCount: candidates.length,
      selectedCount: generated.length,
      representedRuns: [...new Set(generated.map(placement => placement.runId))],
      subdividedCollars: generated.filter(placement => placement.collarTaper).length,
      template: templateMetrics(field, sourcePlacement.grid, variants[0], settings.columns, settings.rows),
      residualScaleRange: generated.length ? [Math.min(...generated.map(item => item.residualScale)), Math.max(...generated.map(item => item.residualScale))] : [0, 0]
    }
  };
}
