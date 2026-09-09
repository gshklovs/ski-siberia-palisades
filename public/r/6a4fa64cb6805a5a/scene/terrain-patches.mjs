function interval(axis, value) {
  let low = 0, high = axis.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (axis[middle] <= value) low = middle;
    else high = middle;
  }
  return low;
}

function firstAtOrAbove(axis, value) {
  const below = interval(axis, value);
  return axis[below] >= value ? below : below + 1;
}

export function sampleCanonicalTerrain(terrain, east, north) {
  const column = interval(terrain.xs, east), row = interval(terrain.ys, north);
  const across = Math.max(0, Math.min(1, (east - terrain.xs[column]) / (terrain.xs[column + 1] - terrain.xs[column])));
  const along = Math.max(0, Math.min(1, (north - terrain.ys[row]) / (terrain.ys[row + 1] - terrain.ys[row])));
  const start = row * terrain.xs.length + column;
  const lowerLeft = terrain.heights[start], lowerRight = terrain.heights[start + 1];
  const upperLeft = terrain.heights[start + terrain.xs.length], upperRight = terrain.heights[start + terrain.xs.length + 1];
  return across + along <= 1
    ? lowerLeft + across * (lowerRight - lowerLeft) + along * (upperLeft - lowerLeft)
    : upperRight + (1 - across) * (upperLeft - upperRight) + (1 - along) * (lowerRight - upperRight);
}

function triangleArea2(positions, first, second, third) {
  const a = first * 3, b = second * 3, c = third * 3;
  return (positions[b] - positions[a]) * (positions[c + 1] - positions[a + 1])
    - (positions[b + 1] - positions[a + 1]) * (positions[c] - positions[a]);
}

function appendUpwardTriangle(target, positions, first, second, third) {
  const area = triangleArea2(positions, first, second, third);
  if (Math.abs(area) < 1e-10) throw new Error(`Degenerate terrain triangle ${first},${second},${third}`);
  if (area > 0) target.push(first, second, third);
  else target.push(first, third, second);
}

function stitchChains(target, positions, firstChain, secondChain) {
  let first = 0, second = 0;
  const firstLast = firstChain.length - 1, secondLast = secondChain.length - 1;
  while (first < firstLast || second < secondLast) {
    const nextFirst = first < firstLast ? (first + 1) / firstLast : Infinity;
    const nextSecond = second < secondLast ? (second + 1) / secondLast : Infinity;
    if (nextFirst <= nextSecond) {
      appendUpwardTriangle(target, positions, firstChain[first], firstChain[first + 1], secondChain[second]);
      first++;
    } else {
      appendUpwardTriangle(target, positions, firstChain[first], secondChain[second + 1], secondChain[second]);
      second++;
    }
  }
}

function sourceBounds(positions, anchorEnu) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    const east = positions[offset] + anchorEnu[0];
    const north = -positions[offset + 2] + anchorEnu[1];
    bounds[0] = Math.min(bounds[0], east);
    bounds[1] = Math.min(bounds[1], north);
    bounds[2] = Math.max(bounds[2], east);
    bounds[3] = Math.max(bounds[3], north);
  }
  return bounds;
}

function boundsOverlap(first, second) {
  return first[0] < second[2] && first[2] > second[0] && first[1] < second[3] && first[3] > second[1];
}

export function resolveTerrainCollar(terrain, innerBounds, collarCells = 2) {
  const leftIndex = interval(terrain.xs, innerBounds[0]) - collarCells;
  const rightIndex = firstAtOrAbove(terrain.xs, innerBounds[2]) + collarCells;
  const bottomIndex = interval(terrain.ys, innerBounds[1]) - collarCells;
  const topIndex = firstAtOrAbove(terrain.ys, innerBounds[3]) + collarCells;
  if (leftIndex < 0 || bottomIndex < 0 || rightIndex >= terrain.xs.length || topIndex >= terrain.ys.length) throw new Error('Terrain patch collar exceeds canonical terrain');
  return { leftIndex, rightIndex, bottomIndex, topIndex, outerBounds: [terrain.xs[leftIndex], terrain.ys[bottomIndex], terrain.xs[rightIndex], terrain.ys[topIndex]] };
}

function makeTriangleIndex(positions, sourceIndices, collarIndices, bounds, cellSize = 1) {
  const columns = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cellSize));
  const buckets = Array.from({ length: columns * rows }, () => []);
  const triangles = [];
  function add(indices, priority) {
    for (let offset = 0; offset < indices.length; offset += 3) {
      const triangle = triangles.length;
      const item = { first: indices[offset], second: indices[offset + 1], third: indices[offset + 2], priority };
      triangles.push(item);
      const vertices = [item.first * 3, item.second * 3, item.third * 3];
      const minimumEast = Math.min(...vertices.map(vertex => positions[vertex]));
      const maximumEast = Math.max(...vertices.map(vertex => positions[vertex]));
      const minimumNorth = Math.min(...vertices.map(vertex => positions[vertex + 1]));
      const maximumNorth = Math.max(...vertices.map(vertex => positions[vertex + 1]));
      const firstColumn = Math.max(0, Math.min(columns - 1, Math.floor((minimumEast - bounds[0]) / cellSize)));
      const lastColumn = Math.max(0, Math.min(columns - 1, Math.floor((maximumEast - bounds[0]) / cellSize)));
      const firstRow = Math.max(0, Math.min(rows - 1, Math.floor((minimumNorth - bounds[1]) / cellSize)));
      const lastRow = Math.max(0, Math.min(rows - 1, Math.floor((maximumNorth - bounds[1]) / cellSize)));
      for (let row = firstRow; row <= lastRow; row++) for (let column = firstColumn; column <= lastColumn; column++) buckets[row * columns + column].push(triangle);
    }
  }
  add(sourceIndices, 0);
  add(collarIndices, 1);

  function sampleTriangle(item, east, north) {
    const first = item.first * 3, second = item.second * 3, third = item.third * 3;
    const ax = positions[first], ay = positions[first + 1];
    const bx = positions[second], by = positions[second + 1];
    const cx = positions[third], cy = positions[third + 1];
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) < 1e-12) return undefined;
    const firstWeight = ((by - cy) * (east - cx) + (cx - bx) * (north - cy)) / denominator;
    const secondWeight = ((cy - ay) * (east - cx) + (ax - cx) * (north - cy)) / denominator;
    const thirdWeight = 1 - firstWeight - secondWeight;
    const tolerance = 2e-6;
    if (firstWeight < -tolerance || secondWeight < -tolerance || thirdWeight < -tolerance) return undefined;
    return firstWeight * positions[first + 2] + secondWeight * positions[second + 2] + thirdWeight * positions[third + 2];
  }

  return {
    bytes: buckets.reduce((total, bucket) => total + bucket.length * 4, triangles.length * 16),
    sample(east, north) {
      if (east < bounds[0] || east > bounds[2] || north < bounds[1] || north > bounds[3]) return undefined;
      const column = Math.max(0, Math.min(columns - 1, Math.floor((east - bounds[0]) / cellSize)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor((north - bounds[1]) / cellSize)));
      const candidates = buckets[row * columns + column];
      for (let priority = 0; priority <= 1; priority++) for (const triangle of candidates) {
        const item = triangles[triangle];
        if (item.priority !== priority) continue;
        const height = sampleTriangle(item, east, north);
        if (height !== undefined) return height;
      }
      return undefined;
    }
  };
}

export function buildTerrainPatchReplacement(terrain, placements, { spatialCellSize = 1 } = {}) {
  if (!Array.isArray(placements) || placements.length === 0) throw new Error('At least one terrain patch placement is required');
  const started = performance.now();
  const canonicalColumns = terrain.xs.length, canonicalRows = terrain.ys.length;
  if (terrain.heights.length !== canonicalColumns * canonicalRows) throw new Error('Canonical terrain dimensions do not match its axes');
  const prepared = placements.map((placement, order) => {
    const collarCells = placement.collarCells ?? 2;
    if (!Number.isInteger(collarCells) || collarCells < 2) throw new Error(`${placement.id ?? order} collarCells must be at least 2`);
    const { geometry, grid, anchorEnu } = placement;
    if (!geometry?.positions || !geometry?.indices || !grid?.columns || !grid?.rows || !anchorEnu) throw new Error(`${placement.id ?? order} is missing geometry, grid or anchorEnu`);
    if (geometry.positions.length / 3 !== grid.columns * grid.rows) throw new Error(`${placement.id ?? order} grid dimensions do not match source positions`);
    const innerBounds = sourceBounds(geometry.positions, anchorEnu);
    let collar;
    try { collar = resolveTerrainCollar(terrain, innerBounds, collarCells); }
    catch { throw new Error(`${placement.id ?? order} collar exceeds canonical terrain`); }
    return { ...placement, order, collarCells, innerBounds, ...collar };
  });
  for (let first = 0; first < prepared.length; first++) for (let second = first + 1; second < prepared.length; second++) {
    if (boundsOverlap(prepared[first].outerBounds, prepared[second].outerBounds)) throw new Error(`Terrain patch collars overlap: ${prepared[first].id} and ${prepared[second].id}`);
  }

  const canonicalVertexCount = terrain.heights.length;
  const totalSourceVertices = prepared.reduce((total, placement) => total + placement.geometry.positions.length / 3, 0);
  const totalTaperVertices = prepared.reduce((total, placement) => total + (placement.collarTaper ? placement.grid.columns * 2 + placement.grid.rows * 2 : 0), 0);
  const positions = new Float32Array((canonicalVertexCount + totalSourceVertices + totalTaperVertices) * 3);
  for (let row = 0; row < canonicalRows; row++) for (let column = 0; column < canonicalColumns; column++) {
    const vertex = row * canonicalColumns + column;
    positions.set([terrain.xs[column], terrain.ys[row], terrain.heights[vertex]], vertex * 3);
  }

  let sourceVertexOffset = canonicalVertexCount;
  const regions = [];
  for (const placement of prepared) {
    const sourceVertexCount = placement.geometry.positions.length / 3;
    for (let vertex = 0; vertex < sourceVertexCount; vertex++) {
      const offset = vertex * 3;
      positions.set([
        placement.geometry.positions[offset] + placement.anchorEnu[0],
        -placement.geometry.positions[offset + 2] + placement.anchorEnu[1],
        placement.heightMode === 'terrain-residual'
          ? sampleCanonicalTerrain(terrain, placement.geometry.positions[offset] + placement.anchorEnu[0], -placement.geometry.positions[offset + 2] + placement.anchorEnu[1]) + placement.geometry.positions[offset + 1] * (placement.residualScale ?? 1)
          : placement.geometry.positions[offset + 1] + placement.anchorEnu[2]
      ], (sourceVertexOffset + vertex) * 3);
    }
    regions.push({ ...placement, sourceVertexOffset, sourceVertexCount });
    sourceVertexOffset += sourceVertexCount;
  }
  let taperVertexOffset = canonicalVertexCount + totalSourceVertices;

  const retainedIndices = [];
  let removedCanonicalTriangles = 0;
  for (let row = 0; row < canonicalRows - 1; row++) for (let column = 0; column < canonicalColumns - 1; column++) {
    const removed = regions.some(region => column >= region.leftIndex && column < region.rightIndex && row >= region.bottomIndex && row < region.topIndex);
    if (removed) { removedCanonicalTriangles += 2; continue; }
    const vertex = row * canonicalColumns + column, next = vertex + canonicalColumns;
    retainedIndices.push(vertex, vertex + 1, next, vertex + 1, next + 1, next);
  }

  const sourceIndices = [];
  const collarIndices = [];
  for (const region of regions) {
    const regionSourceIndices = [];
    for (const index of region.geometry.indices) regionSourceIndices.push(region.sourceVertexOffset + index);
    for (let offset = 0; offset < regionSourceIndices.length; offset += 3) appendUpwardTriangle(sourceIndices, positions, regionSourceIndices[offset], regionSourceIndices[offset + 1], regionSourceIndices[offset + 2]);
    const canonicalVertex = (column, row) => row * canonicalColumns + column;
    const sourceVertex = (column, row) => region.sourceVertexOffset + row * region.grid.columns + column;
    const outerSouth = Array.from({ length: region.rightIndex - region.leftIndex + 1 }, (_, index) => canonicalVertex(region.leftIndex + index, region.bottomIndex));
    const outerNorth = Array.from({ length: region.rightIndex - region.leftIndex + 1 }, (_, index) => canonicalVertex(region.leftIndex + index, region.topIndex));
    const outerWest = Array.from({ length: region.topIndex - region.bottomIndex + 1 }, (_, index) => canonicalVertex(region.leftIndex, region.bottomIndex + index));
    const outerEast = Array.from({ length: region.topIndex - region.bottomIndex + 1 }, (_, index) => canonicalVertex(region.rightIndex, region.bottomIndex + index));
    const innerSouth = Array.from({ length: region.grid.columns }, (_, column) => sourceVertex(column, 0));
    const innerNorth = Array.from({ length: region.grid.columns }, (_, column) => sourceVertex(column, region.grid.rows - 1));
    const innerWest = Array.from({ length: region.grid.rows }, (_, row) => sourceVertex(0, row));
    const innerEast = Array.from({ length: region.grid.rows }, (_, row) => sourceVertex(region.grid.columns - 1, row));
    const regionCollarStart = collarIndices.length;
    if (region.collarTaper) {
      const insetSouth = Array.from({ length: region.grid.columns }, (_, column) => sourceVertex(column, 1));
      const insetNorth = Array.from({ length: region.grid.columns }, (_, column) => sourceVertex(column, region.grid.rows - 2));
      const insetWest = Array.from({ length: region.grid.rows }, (_, row) => sourceVertex(1, row));
      const insetEast = Array.from({ length: region.grid.rows }, (_, row) => sourceVertex(region.grid.columns - 2, row));
      const taperChain = (inner, inset, outer) => inner.map((vertex, index) => {
        const fraction = index / (inner.length - 1);
        const edge = vertex * 3, inside = inset[index] * 3;
        const outerFirst = outer[0] * 3, outerLast = outer.at(-1) * 3;
        const targetEast = positions[outerFirst] * (1 - fraction) + positions[outerLast] * fraction;
        const targetNorth = positions[outerFirst + 1] * (1 - fraction) + positions[outerLast + 1] * fraction;
        const ringFraction = region.collarTaper.ringFraction;
        const east = positions[edge] * (1 - ringFraction) + targetEast * ringFraction;
        const north = positions[edge + 1] * (1 - ringFraction) + targetNorth * ringFraction;
        const edgeResidual = positions[edge + 2] - sampleCanonicalTerrain(terrain, positions[edge], positions[edge + 1]);
        const insetResidual = positions[inside + 2] - sampleCanonicalTerrain(terrain, positions[inside], positions[inside + 1]);
        const derivative = index === 0 || index === inner.length - 1 ? 0 : edgeResidual - insetResidual;
        const residual = edgeResidual * (1 - ringFraction) + derivative * region.collarTaper.derivativeScale;
        const result = taperVertexOffset++;
        positions.set([east, north, sampleCanonicalTerrain(terrain, east, north) + residual], result * 3);
        return result;
      });
      const taperSouth = taperChain(innerSouth, insetSouth, outerSouth);
      const taperNorth = taperChain(innerNorth, insetNorth, outerNorth);
      const taperWest = taperChain(innerWest, insetWest, outerWest);
      const taperEast = taperChain(innerEast, insetEast, outerEast);
      stitchChains(collarIndices, positions, innerSouth, taperSouth);
      stitchChains(collarIndices, positions, taperSouth, outerSouth);
      stitchChains(collarIndices, positions, innerNorth, taperNorth);
      stitchChains(collarIndices, positions, taperNorth, outerNorth);
      stitchChains(collarIndices, positions, innerWest, taperWest);
      stitchChains(collarIndices, positions, taperWest, outerWest);
      stitchChains(collarIndices, positions, innerEast, taperEast);
      stitchChains(collarIndices, positions, taperEast, outerEast);
    } else {
      stitchChains(collarIndices, positions, outerSouth, innerSouth);
      stitchChains(collarIndices, positions, innerNorth, outerNorth);
      stitchChains(collarIndices, positions, outerWest, innerWest);
      stitchChains(collarIndices, positions, innerEast, outerEast);
    }
    region.boundaries = { outerSouth, outerNorth, outerWest, outerEast, innerSouth, innerNorth, innerWest, innerEast };
    region.sourceIndices = Uint32Array.from(regionSourceIndices);
    region.collarIndices = Uint32Array.from(collarIndices.slice(regionCollarStart));
  }

  const indices = new Uint32Array(retainedIndices.length + sourceIndices.length + collarIndices.length);
  indices.set(retainedIndices);
  indices.set(sourceIndices, retainedIndices.length);
  indices.set(collarIndices, retainedIndices.length + sourceIndices.length);
  let spatialIndexBytes = 0;
  for (const region of regions) {
    region.index = makeTriangleIndex(positions, region.sourceIndices, region.collarIndices, region.outerBounds, spatialCellSize);
    spatialIndexBytes += region.index.bytes;
  }
  const sample = (east, north) => {
    for (const region of regions) {
      const height = region.index.sample(east, north);
      if (height !== undefined) return height;
    }
    return sampleCanonicalTerrain(terrain, east, north);
  };
  const collarTriangles = collarIndices.length / 3;
  const sourceTriangles = sourceIndices.length / 3;
  const addedTriangles = sourceTriangles + collarTriangles - removedCanonicalTriangles;
  return {
    positions,
    indices,
    sample,
    regions,
    stats: {
      placements: regions.map(region => ({ id: region.id, lod: region.lod, anchorEnu: region.anchorEnu, sourceBounds: region.innerBounds, outerBounds: region.outerBounds })),
      sourceTriangles,
      collarTriangles,
      removedCanonicalTriangles,
      addedTriangles,
      geometryBytes: positions.byteLength + indices.byteLength,
      localGeometryBytes: (totalSourceVertices + totalTaperVertices) * 3 * 4 + (sourceTriangles + collarTriangles) * 3 * 4,
      collarTaperVertices: totalTaperVertices,
      spatialIndexEstimatedBytes: spatialIndexBytes,
      buildMs: performance.now() - started
    }
  };
}
