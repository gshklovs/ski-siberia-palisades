// The forest — placed against the real canopy, and this is an ALPINE sector, so
// most of what this module does is decide where trees STOP.
//
// Base density = canopyAt(x,y), the per-cell conifer fraction measured off the
// anchor aerial (WorldView-2, 2025-10-21). annotations.md: "widely-spaced
// conifers in bands down the bowl flanks and scattered singles on the open
// floor — the aerial shows them thinning out completely above ~2600 m, so the
// top third of the bowl and the whole cliff band are bare." The measured raster
// says exactly that on its own: 3.1 % canopy above 2650 m, 2.8 % at 2600-2650,
// 21 % at 2450-2550, 31 % below 2420. Nothing had to be told to it.
//
// Three corrections are applied on top, and only three:
//   * the piste raster punches the corridors out (GPS centrelines are hard
//     edges; the aerial's are soft with shadow)
//   * the CLIFF punches an absolute hole. The escarpment is bare granite in
//     views 4, 16, 18, 19 and 20, and a canopy classifier reading an October
//     north-face shadow cannot be trusted on it.
//   * the SCREE crest of view-27 punches a hole for the same reason.
// Everything else is the photograph.

import { clamp, lerp, smooth, fbm, makeRng, rr, ri } from './lib/core.mjs';
import { groundZ, masksAt, slopeAt, demAt, cliffAt, eastAt, screeAt, RUN_PREP } from './ground.mjs';
import { canopyAt } from './canopy.mjs';
import { RUNS, LIFTS, CORE, TIGHT, BUILDINGS, Z_DATUM } from './layout.mjs';

export function distToRuns(x, y) {
  let best = 1e9;
  for (const r of RUNS) {
    const pr = RUN_PREP[r.id];
    if (!pr) continue;
    if (x < pr.bb[0] - 160 || x > pr.bb[2] + 160 || y < pr.bb[1] - 160 || y > pr.bb[3] + 160) continue;
    for (const s of pr.seg) {
      if (x < s.x0 - best || x > s.x1 + best || y < s.y0 - best || y > s.y1 + best) continue;
      const px = x - s.ax, py = y - s.ay;
      const t = clamp((px * s.dx + py * s.dy) / s.L2, 0, 1);
      const d = Math.hypot(px - s.dx * t, py - s.dy * t);
      if (d < best) best = d;
    }
  }
  return best;
}

export const STATIONS = LIFTS.flatMap((L) => [L.pts[0], L.pts[L.pts.length - 1]]);
export function nearStation(x, y, r) {
  for (const s of STATIONS) if (Math.hypot(x - s[0], y - s[1]) < r) return true;
  return false;
}

const inBoxYaw = (x, y, cx, cy, sx, sy, yawDeg, pad = 0) => {
  const a = yawDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = x - cx, dy = y - cy;
  return Math.abs(dx * c + dy * s) < sx / 2 + pad && Math.abs(-dx * s + dy * c) < sy / 2 + pad;
};

export function forestDensity(x, y) {
  const m = masksAt(x, y);
  const cut = clamp(m.groom * 1.2 + m.pack * 1.25 + m.cat * 1.2 + m.lift * 1.15 +
                    m.chute * 1.6 + m.wall * 1.6, 0, 1);
  if (cut > 0.26) return 0;
  // the rock, absolutely: no tree grows on the Palisades
  if (cliffAt(x, y) > 0.08 || eastAt(x, y) > 0.14 || screeAt(x, y) > 0.25) return 0;
  let can = canopyAt(x, y);
  if (can < 0) can = clamp(1 - smooth(60, 200, demAt(x, y)), 0, 1) * 0.55;
  let d = smooth(0.06, 0.50, can);
  d *= 1 - smooth(0.05, 0.26, cut);
  // THE TREELINE, stated rather than inferred. annotations.md: the aerial shows
  // conifers "thinning out completely above ~2600 m, so the top third of the
  // bowl and the whole cliff band are bare", and views 19, 20 and 25 all show
  // the Washeshu plateau as unbroken snow. The measured raster still leaves a
  // 3.1 % residual above 2650 m, which is October shadow on rock read as
  // canopy, not trees — so the treeline is applied on top of it: full density
  // to 2560 m, none above 2620 m. (Z_DATUM = 2366 m, so 194 m and 254 m here.)
  d *= 1 - smooth(194, 254, demAt(x, y));
  // an open BOWL keeps its scattered singles but loses the stands (view-11)
  if (m.bowl > 0.08) d *= lerp(1, 0.22, smooth(0.08, 0.6, m.bowl));
  if (m.glade > 0.08) d *= lerp(1, 0.36, smooth(0.08, 0.55, m.glade));
  d *= 1 - smooth(40, 55, slopeAt(x, y, 6));
  if (nearStation(x, y, 34)) return 0;
  for (const b of BUILDINGS) if (inBoxYaw(x, y, b[0], b[1], b[2], b[3], b[5], 12)) return 0;
  return clamp(d, 0, 1);
}

export function placeForest(opts = {}) {
  const rng = makeRng('siberia-forest');
  const big = [], mid = [], small = [];
  // COMPOSING rule 17: when the budget pinches, background dressing loses
  // before anything the player rides. Here that is the forest — this is an
  // alpine sector where the trees are all BELOW the ground you ski, and the
  // triangles they were spending went to the escarpment.
  const NB = opts.big || 1700, NM = opts.mid || 4400, NS = opts.small || 4200;
  const X0 = CORE.x0 - 40, X1 = CORE.x1 + 40, Y0 = CORE.y0 - 40, Y1 = CORE.y1 + 40;

  // pass 1: the tree WALLS — big firs within 110 m of a run centreline. In this
  // sector that is the lower bowl flanks and the Gold Coast bench; up top the
  // density field returns zero and the loop simply finds nothing, which is the
  // correct answer and is why the ridge is bare.
  for (let i = 0; i < 320000 && big.length < NB; i++) {
    const x = rr(rng, X0, X1), y = rr(rng, Y0, Y1);
    const dr = distToRuns(x, y);
    if (dr > 110) continue;
    const dn = forestDensity(x, y);
    if (dn <= 0 || rng() > dn * (0.5 + 0.5 * (1 - smooth(6, 110, dr)))) continue;
    big.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.70, 1.24)]);
  }
  for (let i = 0; i < 360000 && mid.length < NM; i++) {
    const x = rr(rng, X0, X1), y = rr(rng, Y0, Y1);
    const dn = forestDensity(x, y);
    if (dn <= 0 || rng() > dn * 0.9) continue;
    mid.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.58, 1.10)]);
  }
  // pass 3: the surrounding country, straight off aerial-2 — the treed valley
  // walls that close every long view out of the sector
  for (let i = 0; i < 420000 && small.length < NS; i++) {
    const x = rr(rng, TIGHT.x0 - 900, TIGHT.x1 + 900), y = rr(rng, TIGHT.y0 - 900, TIGHT.y1 + 900);
    if (x > X0 && x < X1 && y > Y0 && y < Y1) continue;
    let can = canopyAt(x, y);
    if (can < 0) can = clamp(1 - smooth(60, 220, demAt(x, y)), 0, 1) * 0.5;
    const d = smooth(0.12, 0.62, can);
    if (rng() > d * 0.7) continue;
    small.push([x, y, demAt(x, y), rr(rng, 0, 6.283), rr(rng, 0.75, 1.4)]);
  }

  const snags = [];
  for (let i = 0; i < 40000 && snags.length < 70; i++) {
    const x = rr(rng, X0, X1), y = rr(rng, Y0, Y1);
    if (forestDensity(x, y) < 0.45 || distToRuns(x, y) > 130 || rng() > 0.25) continue;
    snags.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.6, 1.2)]);
  }

  // ------------------------------------------------------------- the rock
  // ROCK IS A MAJOR MATERIAL HERE, unlike Red Dog. Three populations, each
  // sourced: OUTCROPS on the cliff crest and the ribs (views 4, 20 — "blocky
  // light-grey granite ribs"); TALUS on the wind-stripped crest east of the
  // Headwall top (view-27, "bare talus and scree ... a brown-grey rubble
  // spine"); and scattered BOULDERS through the bowl's steeper ground
  // (views 34, 41 — "rolling snow over rock outcrops").
  // OUTCROPS go on the escarpment and nowhere else. The first cut let a plain
  // slope term (smooth(38,55,slope)) seed them, and they came out sprinkled
  // along every ridge in the frame like scenery — which is exactly the "rock as
  // decoration" reading annotations.md warns against ("the ribs are the
  // identity, not the snow between them"). They now require the DEM-derived
  // cliff/east-wall weight, or genuinely cliff-grade slope (>46 deg).
  const rocks = [], talus = [], boulders = [];
  for (let i = 0; i < 260000 && rocks.length < 300; i++) {
    const x = rr(rng, X0, X1), y = rr(rng, Y0, Y1);
    const m = masksAt(x, y);
    if (m.groom > 0.25 || m.pack > 0.2 || m.cat > 0.3 || m.chute > 0.25) continue;
    if (nearStation(x, y, 34)) continue;
    const cw = cliffAt(x, y) + eastAt(x, y) * 0.7;
    const sl = slopeAt(x, y, 6);
    if (cw < 0.12 && sl < 46) continue;
    if (rng() > clamp(cw * 1.05 + smooth(46, 60, sl) * 0.45, 0, 1)) continue;
    rocks.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.55, 1.5)]);
  }
  for (let i = 0; i < 120000 && talus.length < 620; i++) {
    const x = rr(rng, -60, 320), y = rr(rng, -230, 10);
    const s = screeAt(x, y);
    if (s < 0.2 || masksAt(x, y).groom > 0.2 || rng() > s * 0.85) continue;
    talus.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.16, 0.52)]);
  }
  for (let i = 0; i < 120000 && boulders.length < 300; i++) {
    const x = rr(rng, X0, X1), y = rr(rng, Y0, Y1);
    const m = masksAt(x, y);
    if (m.groom > 0.35 || m.pack > 0.2 || nearStation(x, y, 34)) continue;
    if (rng() > smooth(24, 46, slopeAt(x, y, 5)) * 0.35 + 0.02) continue;
    boulders.push([x, y, groundZ(x, y), rr(rng, 0, 6.283), rr(rng, 0.3, 0.85)]);
  }
  return { big, mid, small, snags, rocks, talus, boulders };
}
