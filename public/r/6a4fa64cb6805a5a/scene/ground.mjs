import { terrain } from './terrain-data.mjs';

export { terrain };
function interval(axis, value) {
  let low = 0, high = axis.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (axis[middle] <= value) low = middle;
    else high = middle;
  }
  return low;
}
export function groundZ(east, north) {
  const column = interval(terrain.xs, east), row = interval(terrain.ys, north);
  const across = Math.max(0, Math.min(1, (east - terrain.xs[column]) / (terrain.xs[column + 1] - terrain.xs[column])));
  const along = Math.max(0, Math.min(1, (north - terrain.ys[row]) / (terrain.ys[row + 1] - terrain.ys[row])));
  const start = row * terrain.xs.length + column;
  const lowerLeft = terrain.heights[start], lowerRight = terrain.heights[start + 1];
  const upperLeft = terrain.heights[start + terrain.xs.length], upperRight = terrain.heights[start + terrain.xs.length + 1];
  return across + along <= 1 ? lowerLeft + across * (lowerRight - lowerLeft) + along * (upperLeft - lowerLeft) : upperRight + (1 - across) * (upperLeft - upperRight) + (1 - along) * (lowerRight - upperRight);
}
export const terrainHeight = groundZ;
