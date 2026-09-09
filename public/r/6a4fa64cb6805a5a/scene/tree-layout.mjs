import { groundZ, terrain } from './ground.mjs';
import { RUNS, RIM } from './layout.mjs';
import { canopy } from './canopy-data.mjs';

let cachedTrees;

export function canonicalTrees() {
  if (cachedTrees) return cachedTrees;
  const trees = [];
  const [left, bottom, right, top] = terrain.bounds;
  const occupied = new Set();
  for (const sample of canopy) {
    const east = left + sample[0] / 2048 * (right - left);
    const north = top - sample[1] / 2048 * (top - bottom);
    const height = groundZ(east, north);
    const cell = Math.floor(east / 32) + ':' + Math.floor(north / 32);
    if (occupied.has(cell)) continue;
    if (height > 234 || east < RIM.x0 + 20 || north < RIM.y0 + 20) continue;
    if (RUNS.some(run => run.pts.some(point => Math.hypot(point[0] - east, point[1] - north) < (run.style === 'bowl' ? 16 : 9)))) continue;
    occupied.add(cell);
    trees.push({ east, north, height, size: 5 + ((sample[0] * 71 + sample[1] * 13) % 100) / 100 * 8 });
  }
  cachedTrees = trees;
  return cachedTrees;
}
