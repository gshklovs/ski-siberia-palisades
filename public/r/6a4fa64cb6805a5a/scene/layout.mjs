import { features } from './features.mjs';
import { groundZ, terrain } from './ground.mjs';
import { widths } from './widths.mjs';

export const FRAME = { projection: 'EPSG:3857 scaled by cos(origin latitude)', origin: terrain.origin, datum: 2366, datumName: 'Siberia Express base', axes: 'ENU metres' };
const evidence = { 'Siberia Bowl': [8, 9, 10, 11, 12, 13, 14], 'National Chute': [1, 2, 3, 4, 5, 6], 'Main Chute': [16, 19, 20], 'Extra Chute': [16, 19, 20], Chimney: [16, 18, 20], 'The Slot': [26, 27, 28, 29, 30], 'Headwall Face': [31, 32, 33, 34, 35], 'North Bowl': [40, 41, 42], 'Sun Bowl': [36, 37, 38, 39], 'Reverse Traverse': [1, 15, 21, 31, 36] };
export const RUNS = features.filter(feature => feature.kind !== 'lift' && feature.fullyInFrame).map(feature => {
  const sparse = !evidence[feature.name];
  const chute = /Chute|Chimney/.test(feature.name);
  const traverse = /Traverse/.test(feature.name);
  return { ...feature, diff: feature.difficulty === 'intermediate' ? 'blue' : feature.difficulty === 'easy' ? 'green' : 'black', style: sparse ? 'sparse' : chute ? 'chute' : traverse ? 'bench' : feature.name === 'The Slot' ? 'gully' : 'bowl', width: widths[feature.id].width, widthSrc: widths[feature.id].widthSrc, views: evidence[feature.name] || [], sparse, context: !feature.in_core && !traverse, sign: ['Siberia Bowl','North Bowl','Sun Bowl','Headwall Face','Reverse Traverse'].includes(feature.name), probable: sparse || traverse || feature.name === 'National Chute', inferred: traverse, pts: feature.pts.map(point => [point[0], point[1], groundZ(point[0], point[1])]) };
});
export const LIFTS = features.filter(feature => feature.kind === 'lift' && /Siberia Express|Headwall Express/.test(feature.name)).map(feature => ({ ...feature, seats: 6, towers: feature.name === 'Siberia Express' ? 14 : 0, topOnly: feature.name !== 'Siberia Express', speed: 1000 * 0.3048 / 60, chairSpacing: 1000 * 0.3048 / 60 * (3600 * 6 / 2400), pts: feature.pts, source: 'OSM + annotations.md; liftblog April 2017, views 23–25. Tower positions inferred, count published.' }));
export const CORE = { x0: -700, x1: 950, y0: -700, y1: 750 };
export const RIM = { x0: terrain.xs[0], x1: terrain.xs.at(-1), y0: terrain.ys[0], y1: terrain.ys.at(-1) };
