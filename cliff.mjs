// THE PALISADES — the rock. This is the module the whole build exists for.
//
// COMPOSING rule 17 says the thing the player rides gets the fidelity budget.
// At Red Dog that was a groomed face; here it is ROCK: a 621 m east-west
// escarpment across the north face of Washeshu Peak, 14-51 m of near-vertical
// granite (main wall under the summit 33-51 m at 52-63 deg), cut by a comb of
// narrow chutes and separated by blocky ribs. It is the feature the resort is
// named after, and from the bowl floor it is THE silhouette: a flat plateau,
// then the ground simply stops.
//
// ---------------------------------------------------------------------------
// WHERE THE ROCK IS  — 3DEP, not invention
// ---------------------------------------------------------------------------
// OSM carries no cliff geometry anywhere in this frame, so the band is a SLOPE
// read: cliff-data.mjs is `inside the annotations.md band AND slope 33->47 deg`,
// baked at native 1.367 m/px and carried at 5.47 m. Measured inside the strict
// band: >45 deg = 1.51 ha, >60 deg = 0.41 ha, against the bundle's own 1.65 and
// 0.44 ha — the same escarpment, measured twice.
//
// ---------------------------------------------------------------------------
// WHAT THE ROCK LOOKS LIKE — and exactly how much of it is measured
// ---------------------------------------------------------------------------
// annotations.md states the problem plainly: "at 1.37 m/px the DEM resolves the
// band's ENVELOPE, not the individual chute walls. Views 19, 20 and 16 all show
// near-vertical rock ribs where the DEM smooths to ~60 deg. Build the massing
// from the DEM and the rock texture from the photographs."
//
// work/ribs.py went and measured what could be measured (numbers in
// work/ribs.json):
//   * AMPLITUDE — measured. High-passing z(x) across the band gives 3.4 m rms
//     of cross-band relief (max 5.9 m). 3DEP already carries ribs; they are
//     just too soft.
//   * SPACING — NOT resolved by the DEM. The autocorrelation decays
//     monotonically over 14-90 m on all 20 profiles: there is no periodicity at
//     1.367 m/px. Two independent non-DEM reads agree instead: the anchor
//     aerial's own luminance comb across the same lines reads 52-77 m (median
//     66 m), and view-19 names 19 features across the 621 m band = 32.7 m per
//     feature. So the comb here is TWO HARMONICS, 66 m major / 33 m minor,
//     and both numbers are sourced.
//   * LEDGES — no DEM and no aerial support at all. The 7.2 m stepping below is
//     an INFERENCE from views 4, 20 and 28 (blocky ribs, snow lace on every
//     ledge, the two facing walls of The Slot). It is declared as such in
//     REPORT.md and it is the only invented dimension in this module.
//
// Displacement is vertical because the ground is a heightfield — but on a
// 55-60 deg wall a +5.5 m rib crest is a ~3.4 m horizontal protrusion, which is
// what the eye reads. Chutes are carved by the corridor stamp in ground.mjs and
// suppress the ribs where they run, so the throats stay skiable snow between
// walls exactly as view-5 and view-28 show.

import { clamp, lerp, smooth, fbm, vnoise } from './lib/core.mjs';
import { CLIFF, EASTWALL, SLOPE, CLIFF_STATS } from './cliff-data.mjs';
import { SCREE_RIDGE } from './ridge-data.mjs';

function decode(g) {
  const s = atob(g.b64), n = g.n, out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) out[i] = s.charCodeAt(i) / 255;
  return { ...g, a: out };
}
const C = decode(CLIFF), E = decode(EASTWALL), S = decode(SLOPE);

function grid(G, x, y) {
  const c = G.span / G.n;
  let fx = (x - G.ox + G.span / 2) / c - 0.5, fy = (y - G.oy + G.span / 2) / c - 0.5;
  if (fx < 0 || fy < 0 || fx > G.n - 1.002 || fy > G.n - 1.002) return 0;
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * G.n + i;
  return lerp(lerp(G.a[k], G.a[k + 1], tx), lerp(G.a[k + G.n], G.a[k + G.n + 1], tx), ty);
}

/** 0..1 — how much of this ground is Palisades escarpment. */
export const cliffAt = (x, y) => grid(C, x, y);
/** 0..1 — the east wall under the Headwall top (The Slot / Headwall Face rock). */
export const eastAt = (x, y) => grid(E, x, y);
/** 3DEP slope in degrees, straight off the source raster (no scene feedback). */
export const demSlopeAt = (x, y) => grid(S, x, y) * 90;

export { CLIFF_STATS };

// ---------------------------------------------------------------- the comb
// `u` is the cross-slope parameter: easting, warped by a slow noise so the ribs
// wander the way rock does instead of ruling parallel lines down the face. The
// band runs east-west and faces north, so easting IS the cross-slope axis.
const RIB_MAJOR = 66.0;    // aerial luminance comb, median of 20 profiles
const RIB_MINOR = 33.0;    // view-19: 19 named features across 621 m
// 3DEP's own cross-band relief is 3.4 m rms / 5.9 m max — that is the SMOOTHED
// envelope, and annotations.md is explicit that the photographs show more:
// "views 19, 20 and 16 all show near-vertical rock ribs where the DEM smooths
// to ~60 deg". The comb therefore carries about twice the DEM's amplitude, which
// on a 55-60 deg wall is a 4-5 m horizontal protrusion — the rib depth view-20
// shows between the snow ramps.
const A_MAJOR = 7.5;
const A_MINOR = 3.0;
const LEDGE_H = 7.2;       // INFERRED from views 4 / 20 / 28 — no DEM support
const A_LEDGE = 1.55;

// ridged profile: 1 on a rib crest, 0 in a throat
function ridge(u, lam) {
  const t = Math.abs(Math.cos((u / lam) * Math.PI));
  return Math.pow(t, 0.62);
}

/** metres of vertical displacement to add to 3DEP inside the rock.
 *  w = cliff weight, ew = east-wall weight, z = the DEM height (for ledges),
 *  cut = how much of this cell is a carved chute/gully corridor (0..1). */
export function rockDisp(x, y, z, w, ew, cut = 0) {
  const k = clamp(w + ew * 0.62, 0, 1) * (1 - clamp(cut * 1.35, 0, 1));
  if (k < 0.02) return 0;
  const warp = fbm(x * 0.0042, y * 0.0042, 3, 2.1, 0.5, 23) * 11.0;
  const u = x + warp;
  // two-harmonic comb, minor ribs phase-shifted off the majors
  const maj = ridge(u, RIB_MAJOR) - 0.55;
  const min1 = ridge(u + RIB_MINOR * 0.5, RIB_MINOR) - 0.55;
  let d = maj * A_MAJOR + min1 * A_MINOR;
  // horizontal ledges: a soft stair in ELEVATION, so they band the wall the way
  // bedding does and hold the snow lace views 4 and 20 show on every shelf
  const zz = z / LEDGE_H + 0.22 * fbm(x * 0.021, y * 0.021, 2, 2.1, 0.5, 57);
  const f = zz - Math.floor(zz);
  d += (smooth(0.10, 0.44, f) - smooth(0.62, 0.96, f)) * A_LEDGE;
  // blocky granite roughness — the jointing of view-4's ribs
  d += fbm(x * 0.20, y * 0.20, 3, 2.15, 0.52, 91) * 0.85;
  d += vnoise(x * 0.46, y * 0.46, 13) * 0.30;
  return d * k;
}

// ------------------------------------------------------------- scree ridge
// view-27: the crest walked east from the Headwall top terminal is bare talus
// and scree in LATE JANUARY. Do not snow-blanket it. The polyline is a 3DEP
// highest-path walk between two known nodes (work/bake.py), 247 m, 2578-2637 m.
const RSEG = [];
for (let i = 0; i < SCREE_RIDGE.length - 1; i++) {
  const a = SCREE_RIDGE[i], b = SCREE_RIDGE[i + 1];
  RSEG.push({ ax: a[0], ay: a[1], dx: b[0] - a[0], dy: b[1] - a[1],
              L2: (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1e-9 });
}
export function screeAt(x, y) {
  if (x < -80 || x > 340 || y < -240 || y > 20) return 0;
  let bd = 1e9, bs = 0, run = 0;
  for (const s of RSEG) {
    const px = x - s.ax, py = y - s.ay;
    const t = clamp((px * s.dx + py * s.dy) / s.L2, 0, 1);
    const d = Math.hypot(px - s.dx * t, py - s.dy * t);
    if (d < bd) { bd = d; bs = run + Math.sqrt(s.L2) * t; }
    run += Math.sqrt(s.L2);
  }
  // The terminal apron itself is snow — views 31, 32 and 36 all show packed
  // snow right up to the shed, with the rock starting on the knoll above it.
  // So the scree fades IN over the first 45 m of the ridge walk.
  const start = smooth(10, 55, bs);
  // Wind strips the crest and its immediate lee shoulder; snow returns
  // downslope. The edge is broken by noise rather than a clean offset — a hard
  // ribbon of scree following a DEM path would read as a drawn line from the
  // air, and the crest in view-27 is a broken spine with snow in every hollow.
  const wob = fbm(x * 0.021, y * 0.021, 3, 2.1, 0.5, 33) * 20;
  return clamp(start * (1 - smooth(26, 74, bd + wob)) *
               (0.70 + 0.35 * fbm(x * 0.07, y * 0.07, 2, 2.1, 0.5, 61)), 0, 1);
}

export { SCREE_RIDGE };
