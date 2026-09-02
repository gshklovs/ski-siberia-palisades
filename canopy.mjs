// Canopy density sampled from the anchor aerials (canopy-data.mjs).
// canopyAt(x,y) in 0..1 = the fraction of that patch of ground that is real
// conifer canopy in WorldView-2, 2025-10-21. The forest is placed against this,
// so where the sector goes bare above ~2600 m it goes bare because the
// photograph does, not because a rule said so.

import { clamp, lerp, smooth } from './lib/core.mjs';
import { CAN_TIGHT, CAN_WIDE } from './canopy-data.mjs';

function decode(g) {
  const s = atob(g.b64), n = g.n, out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = s.charCodeAt(i) / 255;
  return { ...g, a: out };
}
const T = decode(CAN_TIGHT);
const W = decode(CAN_WIDE);

function grid(G, x, y) {
  const c = G.span / G.n;
  let fx = (x - G.ox + G.span / 2) / c - 0.5, fy = (y - G.oy + G.span / 2) / c - 0.5;
  fx = clamp(fx, 0, G.n - 1.001); fy = clamp(fy, 0, G.n - 1.001);
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * G.n + i;
  return lerp(lerp(G.a[k], G.a[k + 1], tx), lerp(G.a[k + G.n], G.a[k + G.n + 1], tx), ty);
}
const inset = (G, x, y) => Math.min(G.span / 2 - Math.abs(x - G.ox), G.span / 2 - Math.abs(y - G.oy));

export function canopyAt(x, y) {
  const iw = inset(W, x, y);
  if (iw <= 2) return -1;                       // outside every aerial: caller decides
  const w = grid(W, x, y);
  const t = inset(T, x, y);
  if (t <= 0) return w;
  return lerp(w, grid(T, x, y), smooth(0, 40, t));
}

export const CANOPY_FRAMES = { tight: { ...T, a: null }, wide: { ...W, a: null } };
