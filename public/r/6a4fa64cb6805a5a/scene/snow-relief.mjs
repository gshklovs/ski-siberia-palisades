const cache = new WeakMap();

const DEFAULTS = Object.freeze({ cellSize: 96, maximumHeight: .46, slopeFadeStart: .32, slopeFadeEnd: .78, boundaryFadeCells: 3 });

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function smoothstep(value) { value = clamp01(value); return value * value * (3 - 2 * value); }
function hash(column, row, salt = 0) {
  let value = Math.imul(column + 103 + salt, 374761393) ^ Math.imul(row + 197 - salt, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function bankAt(east, north, cellSize) {
  const baseColumn = Math.floor(east / cellSize);
  const baseRow = Math.floor(north / cellSize);
  let relief = 0;
  for (let row = baseRow - 1; row <= baseRow + 1; row++) for (let column = baseColumn - 1; column <= baseColumn + 1; column++) {
    const angle = hash(column, row, 7) * Math.PI * 2;
    const centerEast = (column + .18 + hash(column, row, 11) * .64) * cellSize;
    const centerNorth = (row + .18 + hash(column, row, 17) * .64) * cellSize;
    const deltaEast = east - centerEast;
    const deltaNorth = north - centerNorth;
    const across = Math.cos(angle) * deltaEast + Math.sin(angle) * deltaNorth;
    const along = -Math.sin(angle) * deltaEast + Math.cos(angle) * deltaNorth;
    const width = cellSize * (.13 + hash(column, row, 23) * .07);
    const length = cellSize * (.28 + hash(column, row, 29) * .14);
    const asymmetry = across < 0 ? 1.35 : .82;
    const bank = Math.exp(-Math.pow(across / (width * asymmetry), 2) - Math.pow(along / length, 2));
    relief += bank * (.48 + hash(column, row, 31) * .52);
  }
  return Math.min(1, relief);
}

function axisDerivative(axis, heights, width, row, column, horizontal) {
  const before = horizontal ? Math.max(0, column - 1) : Math.max(0, row - 1);
  const after = horizontal ? Math.min(axis.length - 1, column + 1) : Math.min(axis.length - 1, row + 1);
  const first = horizontal ? heights[row * width + before] : heights[before * width + column];
  const second = horizontal ? heights[row * width + after] : heights[after * width + column];
  return (second - first) / (axis[after] - axis[before]);
}

export function buildSnowReliefTerrain(terrain, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const columns = terrain.xs.length;
  const rows = terrain.ys.length;
  if (terrain.heights.length !== columns * rows) throw new Error('Canonical terrain height dimensions do not match its axes');
  const heights = new Float32Array(terrain.heights.length);
  let maximumDisplacement = 0;
  let displacedVertices = 0;
  let protectedSteepVertices = 0;
  let boundaryError = 0;
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const index = row * columns + column;
    const slope = Math.hypot(
      axisDerivative(terrain.xs, terrain.heights, columns, row, column, true),
      axisDerivative(terrain.ys, terrain.heights, columns, row, column, false)
    );
    const slopeMask = 1 - smoothstep((slope - settings.slopeFadeStart) / (settings.slopeFadeEnd - settings.slopeFadeStart));
    const edgeCells = Math.min(column, columns - 1 - column, row, rows - 1 - row);
    const boundaryMask = smoothstep(edgeCells / settings.boundaryFadeCells);
    const displacement = settings.maximumHeight * bankAt(terrain.xs[column], terrain.ys[row], settings.cellSize) * slopeMask * boundaryMask;
    const baseline = Math.fround(terrain.heights[index]);
    heights[index] = Math.fround(baseline + displacement);
    const applied = heights[index] - baseline;
    maximumDisplacement = Math.max(maximumDisplacement, applied);
    if (applied > 1e-5) displacedVertices++;
    if (slope >= settings.slopeFadeEnd) {
      protectedSteepVertices++;
      if (applied !== 0) throw new Error(`Snow relief changed protected steep vertex ${index}`);
    }
    if (edgeCells === 0) boundaryError = Math.max(boundaryError, Math.abs(applied));
  }
  return {
    ...terrain,
    heights,
    snowRelief: {
      enabled: true,
      source: 'Restored-v4 asymmetric Gaussian bank vocabulary, distributed deterministically on canonical terrain',
      settings,
      maximumDisplacementM: maximumDisplacement,
      displacedVertices,
      protectedSteepVertices,
      boundaryErrorM: boundaryError,
      addedTriangles: 0,
      addedDrawCalls: 0,
      addedHeightBytes: heights.byteLength
    }
  };
}

export function snowReliefTerrain(terrain) {
  if (!cache.has(terrain)) cache.set(terrain, buildSnowReliefTerrain(terrain));
  return cache.get(terrain);
}

function interval(axis, value) {
  let low = 0, high = axis.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (axis[middle] <= value) low = middle;
    else high = middle;
  }
  return low;
}

export function terrainSampler(terrain) {
  return (east, north) => {
    const column = interval(terrain.xs, east), row = interval(terrain.ys, north);
    const across = clamp01((east - terrain.xs[column]) / (terrain.xs[column + 1] - terrain.xs[column]));
    const along = clamp01((north - terrain.ys[row]) / (terrain.ys[row + 1] - terrain.ys[row]));
    const start = row * terrain.xs.length + column;
    const lowerLeft = terrain.heights[start], lowerRight = terrain.heights[start + 1];
    const upperLeft = terrain.heights[start + terrain.xs.length], upperRight = terrain.heights[start + terrain.xs.length + 1];
    return across + along <= 1
      ? lowerLeft + across * (lowerRight - lowerLeft) + along * (upperLeft - lowerLeft)
      : upperRight + (1 - across) * (upperLeft - upperRight) + (1 - along) * (lowerRight - upperRight);
  };
}
