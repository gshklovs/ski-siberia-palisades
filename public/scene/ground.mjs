// The ground: real USGS 3DEP relief + the Palisades' sculpted rock + a piste
// stamp raster.
//
//   demAt(x,y)   dem-tight (1400 m @ FULL NATIVE 1.367 m/px) cross-faded into
//                dem-wide (3200 m @ 6.25 m/px) and then into a far apron.
//   rock         cliff.mjs adds the rib / ledge / jointing displacement inside
//                the escarpment, suppressed wherever a chute corridor runs.
//   the raster   2.0 m cells over the playable core. Carries the flatten
//                weight/target that turns a raw hillside into a skiable
//                corridor, the per-style masks the colour and forest read, the
//                gully wall term, and (BU,BV) = run-local coordinates.
//   groundZ      dem + rock, pulled toward the run profiles, + wind texture
//
// Everything is bilinear, so normals are continuous — which is what the ski
// physics reads. Nothing here is a heightfield the player cannot see: the
// terrain meshes sample exactly this function, and colliders[] lists them all.

import { clamp, lerp, smooth, fbm, vnoise } from './lib/core.mjs';
import { DEM_Z0, DEM_TIGHT, DEM_WIDE } from './dem-data.mjs';
import { RUNS, LIFTS, CORE, BUILDINGS, CLIFF_BOX, EAST_BOX } from './layout.mjs';
import { cliffAt, eastAt, rockDisp, screeAt, demSlopeAt } from './cliff.mjs';

// ------------------------------------------------------------------- DEM
function decode(g) {
  const s = atob(g.b64), n = g.n, out = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    let v = s.charCodeAt(2 * i) | (s.charCodeAt(2 * i + 1) << 8);
    if (v >= 32768) v -= 65536;
    out[i] = v / 10;
  }
  return { ...g, a: out };
}
const T = decode(DEM_TIGHT);
const W = decode(DEM_WIDE);

function grid(G, x, y) {
  const c = G.span / G.n;
  let fx = (x - G.ox + G.span / 2) / c - 0.5, fy = (y - G.oy + G.span / 2) / c - 0.5;
  fx = clamp(fx, 0, G.n - 1.001); fy = clamp(fy, 0, G.n - 1.001);
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * G.n + i;
  return lerp(lerp(G.a[k], G.a[k + 1], tx), lerp(G.a[k + G.n], G.a[k + G.n + 1], tx), ty);
}

const inset = (G, x, y) => Math.min(G.span / 2 - Math.abs(x - G.ox), G.span / 2 - Math.abs(y - G.oy));

/** raw 3DEP, no sculpting — this is what verify.py checks against the GeoTIFF. */
export function demAt(x, y) {
  const w = grid(W, x, y);
  const t = inset(T, x, y);
  if (t <= 0) {
    const iw = inset(W, x, y);
    if (iw > 40) return w;
    const e = grid(W, clamp(x, W.ox - W.span / 2 + 20, W.ox + W.span / 2 - 20),
                      clamp(y, W.oy - W.span / 2 + 20, W.oy + W.span / 2 - 20));
    const d = Math.max(0, -iw);
    return e - smooth(0, 900, d) * 130 + fbm(x * 0.0016, y * 0.0016, 3, 2.1, 0.5, 91) * 50 * smooth(0, 400, d);
  }
  const tz = grid(T, x, y);
  return lerp(w, tz, smooth(0, 70, t));      // 70 m cross-fade at the tight-frame edge
}

// ---------------------------------------------------------------- raster
const RES = 2.0;
const RX0 = CORE.x0 - 70, RY0 = CORE.y0 - 70;
const RNX = Math.ceil((CORE.x1 - CORE.x0 + 140) / RES) + 1;
const RNY = Math.ceil((CORE.y1 - CORE.y0 + 140) / RES) + 1;

const F = new Float32Array(RNX * RNY);      // flatten weight
const FZ = new Float32Array(RNX * RNY);     // flatten target z
const MG = new Float32Array(RNX * RNY);     // groomed piste
const MO = new Float32Array(RNX * RNY);     // open alpine bowl
const MC = new Float32Array(RNX * RNY);     // cat track / traverse bench
const ML = new Float32Array(RNX * RNY);     // glade
const MH = new Float32Array(RNX * RNY);     // chute / gully throat (snow in rock)
const MWALL = new Float32Array(RNX * RNY);  // gully wall lift (The Slot)
const MK = new Float32Array(RNX * RNY);     // packed base-area snow
const MS = new Float32Array(RNX * RNY);     // "sparse" — carried, not composed
const MD = new Float32Array(RNX * RNY);     // gets the corridor DETAIL mesh
const BU = new Float32Array(RNX * RNY);     // metres along the run
const BV = new Float32Array(RNX * RNY);     // metres across the run (signed)
const MW = new Float32Array(RNX * RNY);     // lift swath (forest clearing only)

const cix = (x) => clamp(Math.round((x - RX0) / RES), 0, RNX - 1);
const ciy = (y) => clamp(Math.round((y - RY0) / RES), 0, RNY - 1);
const maxTo = (A, k, v) => { if (v > A[k]) A[k] = v; };

function forCells(x0, y0, x1, y1, cb) {
  const i0 = cix(x0), i1 = cix(x1), j0 = ciy(y0), j1 = ciy(y1);
  for (let j = j0; j <= j1; j++) {
    const y = RY0 + j * RES;
    for (let i = i0; i <= i1; i++) cb(RX0 + i * RES, y, j * RNX + i);
  }
}

function addFlat(k, f, z0) {
  if (f <= 0.002) return;
  const nf = 1 - (1 - F[k]) * (1 - f);
  FZ[k] = (FZ[k] * F[k] + z0 * f) / (F[k] + f || 1);
  F[k] = nf;
}

// A CUT lane overrides whatever was stamped there; it does not average with it.
// addFlat's weighted mean is right for two corridors that merge, and wrong for a
// bench: the Reverse Traverse crosses the Main Chute runout at s = 350 m and
// passes inside Siberia Bowl's 120 m envelope at s = 80 m, and averaging with
// those two put 19 deg of cross-fall back into the middle of the bench at
// exactly the two places the headless skier slid out of it. A cut shelf wins
// where it is cut — that is what cutting means — so bench / cat / traverse use
// this instead.
// FZ is an ABSOLUTE height and it is only meaningful where F > 0 — an unstamped
// cell holds 0, not "the DEM". addFlat never notices because its weighted mean
// divides by F+f. A naive blend does: the first version of this function read
// FZ[k]*(1-f) + z0*f on virgin cells and wrote 0.18*250 = 45 m into them, which
// cut 40-60 m holes through the cliff foot wherever the bench's feather reached
// ground nothing else had stamped. Seed from z0 when the cell is virgin.
function cutFlat(k, f, z0) {
  if (f <= 0.002) return;
  const cur = F[k] > 0 ? FZ[k] : z0;
  FZ[k] = cur * (1 - f) + z0 * f;
  F[k] = 1 - (1 - F[k]) * (1 - f);
  if (F[k] < f) F[k] = f;
}

// ------------------------------------------------------------ run stamps
function prepRun(run) {
  const P = run.pts;
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const zs = P.map((p) => p[2]);
  const passes = run.style === 'bench' ? 4 : 2;
  for (let pass = 0; pass < passes; pass++)
    for (let i = 1; i < zs.length - 1; i++) zs[i] = (zs[i - 1] + zs[i] * 2 + zs[i + 1]) / 4;
  const seg = [];
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], ay = P[i][1], bx = P[i + 1][0], by = P[i + 1][1];
    seg.push({ ax, ay, dx: bx - ax, dy: by - ay, L2: (bx - ax) ** 2 + (by - ay) ** 2 || 1e-9,
               x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by),
               z0: zs[i], z1: zs[i + 1], s0: cum[i], sL: cum[i + 1] - cum[i] });
  }
  let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
  for (const p of P) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); }
  return { seg, cum, len: cum[cum.length - 1], bb: [bx0, by0, bx1, by1] };
}

const PREP = {};
export const RUN_PREP = PREP;

function nearest(pr, x, y, cutoff) {
  let bd = 1e9, bz = 0, bs = 0, bside = 1;
  for (const s of pr.seg) {
    if (x < s.x0 - cutoff || x > s.x1 + cutoff || y < s.y0 - cutoff || y > s.y1 + cutoff) continue;
    const px = x - s.ax, py = y - s.ay;
    const t = clamp((px * s.dx + py * s.dy) / s.L2, 0, 1);
    const qx = s.ax + s.dx * t, qy = s.ay + s.dy * t;
    const d = Math.hypot(x - qx, y - qy);
    if (d < bd) {
      bd = d; bz = lerp(s.z0, s.z1, t); bs = s.s0 + s.sL * t;
      bside = (px * s.dy - py * s.dx) < 0 ? -1 : 1;
    }
  }
  return [bd, bz, bs, bside];
}

// `pull` = how far the ground is dragged from raw 3DEP toward the run's own
// smoothed longitudinal profile AT THE CENTRELINE, decaying to 0 at the corridor
// edge. An open BOWL is barely pulled — it is the mountain, and pulling it would
// erase the rolls views 10/11/41 show. The BENCH is pulled hard and dug, because
// a bench that does not hold a traverse is not a bench (and holding a traverse
// under the cliffs is one of this build's three ski tests).
//
// `hold` is what makes a CUT lane different from a graded one, and it is the fix
// the headless ride forced. Without it the pull falls off as
// `1 - smooth(0, hw, d)**1.4`, i.e. it is already down to 25 % five metres off
// the centreline — so 75 % of the hillside's cross-fall survives inside the
// lane. Probing the built Reverse Traverse that way gave 18-30 deg of CROSS-slope
// across its middle 10 m, and the headless skier did exactly what that
// predicts: he left the bench at s = 80 m, slid 239 m out down the apron into
// Siberia Bowl, took the run's only respawn and never reached the Headwall.
// A bench, a cat track and a traverse are all CUT into the hillside — uphill
// side excavated, downhill side filled — so for those three the pull is held at
// full across the inner half of the lane and only released through the feather:
// `1 - smooth(hw*hold, hw+fe, d)`. That leaves ~2 deg of cross-fall at 5 m and
// ~5 deg at the lane edge, which is a bench you can traverse.
const STYLE = {
  groomed:  { flat: 0.95, pull: 0.52, fe: 16, dig: 0.0,  mask: MG },
  bowl:     { flat: 0.80, pull: 0.16, fe: 34, dig: 0.0,  mask: MO },
  traverse: { flat: 0.95, pull: 0.80, fe: 12, dig: 0.35, mask: MC, hold: 0.6 },
  // fe 18, not 8: a cut lane on a 30 deg flank is cut on its uphill side and
  // FILLED on its downhill side, and at fe 8 that fill terminated in a ~3 m lip.
  // Two things then went wrong at once: the lip read from the bowl floor as a
  // floating grey plate (work/iter13/match-view-20.png), because a 3 m step
  // inside the one-cell overlap ring between the 2.20 m piste mesh and the
  // 4.40 m core grid puts the coarse surface through the fine one; and a 3 m
  // lip is not what a bench looks like anyway. Eighteen metres of feather is
  // the batter slope a real cut-and-fill bench has, it is gentle enough for the
  // core grid to carry, and because the `hold` profile runs to hw+fe it also
  // makes the lane itself FLATTER, not less flat.
  bench:    { flat: 0.97, pull: 0.94, fe: 18, dig: 0.55, mask: MC, hold: 0.5 },
  cat:      { flat: 0.96, pull: 0.92, fe: 16, dig: 0.5,  mask: MC, hold: 0.5 },
  chute:    { flat: 0.95, pull: 0.72, fe: 9,  dig: 0.9,  mask: MH },
  gully:    { flat: 0.94, pull: 0.66, fe: 11, dig: 1.1,  mask: MH },
  glade:    { flat: 0.92, pull: 0.24, fe: 20, dig: 0.0,  mask: ML },
  runout:   { flat: 0.95, pull: 0.70, fe: 22, dig: 0.0,  mask: MK },
  // SPARSE: carried, not composed. The corridor is made skiable and nothing
  // else happens to it — no groom colour, no furniture, no sculpted rock.
  sparse:   { flat: 0.70, pull: 0.20, fe: 24, dig: 0.0,  mask: MS },
};

function stampRun(run) {
  const pr = prepRun(run);
  PREP[run.id] = pr;
  const st = STYLE[run.style] || STYLE.groomed;
  const hw = run.width / 2, fe = st.fe;
  // a gully carries rock walls OUTSIDE the corridor; the stamp has to reach them
  const wallOut = run.style === 'gully' ? 22 : 0;
  const m = hw + fe + wallOut;
  forCells(pr.bb[0] - m, pr.bb[1] - m, pr.bb[2] + m, pr.bb[3] + m, (x, y, k) => {
    const [d, z, s, side] = nearest(pr, x, y, m);
    if (d > m) return;
    if (d <= hw + fe) {
      const inner = 1 - smooth(hw, hw + fe, d);
      const pull = st.hold
        ? st.pull * (1 - smooth(hw * st.hold, hw + fe, d))
        : st.pull * (1 - smooth(0, hw, d) ** 1.4);
      (st.hold ? cutFlat : addFlat)(k, inner * st.flat, lerp(demAt(x, y), z - st.dig, pull));
      maxTo(st.mask, k, inner);
      if (run.style === 'groomed' || run.style === 'runout') maxTo(MG, k, inner);
      // DETAIL: which corridors earn the 2.20 m mesh. The sector's own runs do;
      // the honest-sparse three do not (there is nothing to resolve on them),
      // and neither do the context runs outside the sector. That is the same
      // rule-17 trade as the forest, applied to ground.
      // A CUT lane takes the detail mesh over its WHOLE footprint, not just the
      // part where `inner` is still above the 0.28 cell threshold. It has to:
      // the 4.40 m core grid cannot represent a 2 m cut edge, so wherever the
      // cut's batter runs out past the fine mesh the coarse grid spans it with
      // a flat quad and the bench renders as a row of boxes with vertical
      // faces (work/iter15/fp-under-cliff.png). Marking the full stamp keeps
      // every metre the cut touches on the 2.20 m mesh, for ~4 k triangles.
      if (!run.sparse && !run.context) {
        maxTo(MD, k, st.hold ? 1 : (run.style === 'bowl' ? inner * 0.6 : inner));
      }
      if (inner > 0.02 && (BU[k] === 0 || d < Math.abs(BV[k]))) { BU[k] = s; BV[k] = d * side; }
    }
    // THE SLOT's walls (view-28): two facing rock faces with a snow ribbon
    // between them. The corridor is dug; the flanks are lifted, so the line
    // reads as a gully from inside it instead of a groove on an open slope.
    if (wallOut) {
      const t = smooth(hw * 0.55, hw + 7, d) * (1 - smooth(hw + 7, hw + wallOut, d));
      maxTo(MWALL, k, t);
    }
  });
}

export function stampRect(cx, cy, sx, sy, yawDeg, { feather = 6, dig = 0.15, pack = 0, flat = 0.95 } = {}) {
  const yaw = yawDeg * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw);
  const z0 = demAt(cx, cy) - dig;
  const m = Math.hypot(sx, sy) / 2 + feather;
  forCells(cx - m, cy - m, cx + m, cy + m, (x, y, k) => {
    const dx = x - cx, dy = y - cy;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    const d = Math.max(Math.abs(u) - sx / 2, Math.abs(v) - sy / 2);
    if (d > feather) return;
    const f = 1 - smooth(0, feather, d);
    if (flat) addFlat(k, f * flat, z0);
    if (pack) maxTo(MK, k, f * pack);
  });
}

function stampLiftSwath(L) {
  const pr = prepRun({ pts: L.pts, style: 'groomed' });
  const hw = (L.swath || 26) / 2, fe = 9, m = hw + fe;
  forCells(pr.bb[0] - m, pr.bb[1] - m, pr.bb[2] + m, pr.bb[3] + m, (x, y, k) => {
    const [d] = nearest(pr, x, y, m);
    if (d > m) return;
    maxTo(MW, k, 1 - smooth(hw, m, d));
  });
}

// build the register. Widest first, so a narrow steep corridor wins the flatten
// target where two overlap — which is what keeps a 16 m chute from being eaten
// by the 120 m bowl it drains into.
let built = false;
export function buildGround() {
  if (built) return;
  built = true;
  // the terminal aprons and the Gold Coast base flat (views 8, 14, 31, 32)
  for (const b of BUILDINGS) stampRect(b[0], b[1], b[2] + 18, b[3] + 18, b[5], { pack: 0.9, dig: 0.3, feather: 14 });
  for (const r of [...RUNS].sort((a, b) => b.width - a.width)) stampRun(r);
  for (const L of LIFTS) stampLiftSwath(L);
}
buildGround();

// -------------------------------------------------------------- sampling
function bil(A, x, y) {
  let fx = (x - RX0) / RES, fy = (y - RY0) / RES;
  if (fx < 0 || fy < 0 || fx > RNX - 1.002 || fy > RNY - 1.002) return 0;
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * RNX + i;
  return lerp(lerp(A[k], A[k + 1], tx), lerp(A[k + RNX], A[k + RNX + 1], tx), ty);
}
const inRaster = (x, y) => x > RX0 + RES && y > RY0 + RES &&
  x < RX0 + (RNX - 2) * RES && y < RY0 + (RNY - 2) * RES;

const inCliffish = (x, y) =>
  (x > CLIFF_BOX.x0 - 40 && x < CLIFF_BOX.x1 + 40 && y > CLIFF_BOX.y0 - 40 && y < CLIFF_BOX.y1 + 40) ||
  (x > EAST_BOX.x0 - 40 && x < EAST_BOX.x1 + 40 && y > EAST_BOX.y0 - 40 && y < EAST_BOX.y1 + 40);

/** the rock displacement actually applied at (x,y), 0 outside the escarpment. */
export function rockAt(x, y) {
  if (!inCliffish(x, y)) return 0;
  const w = cliffAt(x, y), ew = eastAt(x, y);
  if (w + ew < 0.02) return 0;
  const cut = inRaster(x, y) ? bil(MH, x, y) : 0;
  return rockDisp(x, y, demAt(x, y), w, ew, cut);
}

export function groundZ(x, y) {
  const dem = demAt(x, y);
  let z = dem + rockAt(x, y);
  if (!inRaster(x, y)) return z;
  const f = bil(F, x, y) * smooth(0, 55, Math.min(x - CORE.x0, CORE.x1 - x,
                                                  y - CORE.y0, CORE.y1 - y));
  z = z * (1 - f) + bil(FZ, x, y) * f;
  // Everything the raster carries has to fade out before the raster does, or
  // the edge of the field IS a wall. `edge` is metres inside the CORE box.
  const edge = Math.min(x - CORE.x0, CORE.x1 - x, y - CORE.y0, CORE.y1 - y);
  const rf = smooth(0, 55, edge);
  // gully walls: The Slot's two facing rock faces (view-28)
  // THE SLOT is "a genuine rock-walled gully" (annotations.md) and view-28 is
  // the frame that defines it: two facing rock faces with a snow ribbon
  // between. 6 m of wall was invisible from inside the corridor against a
  // hillside that already rolls more than that; 11-16 m at 20 m out is what
  // the photograph shows.
  const wl = bil(MWALL, x, y) * rf;
  if (wl > 0.01) z += wl * (11.0 + 5.0 * fbm(x * 0.06, y * 0.06, 2, 2.1, 0.5, 77));
  // wind texture on the open snow away from the pistes. This bowl is
  // "open wind-textured snow" in view-11 and the crest is scoured in view-27.
  const g = bil(MG, x, y), k = bil(MK, x, y), o = bil(MO, x, y);
  // fade it out toward the core edge — the surround grids are 10 m and 36 m and
  // cannot resolve a 20 m wavelength, so a hard stop draws a visible rectangle
  // around the core in any top-down view (it did, in iter3's match-aerial)
  const open = clamp(1 - g - k, 0, 1) * smooth(0, 90, edge);
  if (open > 0.05) {
    z += open * (0.22 + 0.10 * o) * fbm(x * 0.052, y * 0.052, 3, 2.2, 0.5, 71);
    // SASTRUGI. The 19 m wind texture above is a massing term; at eye height on
    // a bowl floor it is invisible and the snow renders as a featureless grey
    // dome (iter8's match-view-32 and -40 were exactly that). This adds a ~3 m
    // wavelength at +/-6 cm, which is about 2 deg of normal wobble — enough to
    // break the lambert flat, small enough that the ski model never feels it.
    // annotations.md calls the bowl "open WIND-TEXTURED snow" (view-11).
    z += open * 0.055 * fbm(x * 0.33, y * 0.33, 2, 2.1, 0.5, 143);
  }
  return z;
}

export const masksAt = (x, y) => (inRaster(x, y) ? {
  groom: bil(MG, x, y), bowl: bil(MO, x, y), cat: bil(MC, x, y), glade: bil(ML, x, y),
  chute: bil(MH, x, y), wall: bil(MWALL, x, y), pack: bil(MK, x, y), sparse: bil(MS, x, y),
  detail: bil(MD, x, y), lift: bil(MW, x, y), u: bil(BU, x, y), v: bil(BV, x, y),
} : { groom: 0, bowl: 0, cat: 0, glade: 0, chute: 0, wall: 0, pack: 0, sparse: 0, detail: 0, lift: 0, u: 0, v: 0 });

export const RASTER = { RES, RX0, RY0, RNX, RNY };
export { DEM_Z0, cliffAt, eastAt, screeAt, demSlopeAt };

export function slopeAt(x, y, h = 3.0) {
  const zx = (groundZ(x + h, y) - groundZ(x - h, y)) / (2 * h);
  const zy = (groundZ(x, y + h) - groundZ(x, y - h)) / (2 * h);
  return Math.atan(Math.hypot(zx, zy)) * 180 / Math.PI;
}
export function normalAt(x, y, h = 3.0) {
  const zx = (groundZ(x + h, y) - groundZ(x - h, y)) / (2 * h);
  const zy = (groundZ(x, y + h) - groundZ(x, y - h)) / (2 * h);
  const l = Math.hypot(zx, zy, 1);
  return [-zx / l, -zy / l, 1 / l];
}
