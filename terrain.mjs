// Terrain meshes and the winter surface read.
//
// RESOLUTION IS ALLOCATED BY COMPOSING RULE 17: the thing the player rides gets
// the budget, and here the hero is ROCK. The grids, finest first:
//   cliff  1.10 m  the Palisades escarpment + The Slot's gully walls
//   piste  2.20 m  every run corridor
//   core   4.40 m  the playable sector
//   mid   10.00 m  the rest of the dem-tight frame
//   wide  36.00 m  the dem-wide frame (Olympic Valley, the Sierra crest)
//   rim  100.00 m  the collidable end-of-data ring outside dem-wide
// plus a non-collidable polar `far` apron for the skyline.
// Adjacent grids share a one-cell overlap ring so a resolution change never
// opens a crack. Every one of them is in colliders[].
//
// COLOUR. No textures anywhere; the winter read is vertex colours.
//   * a baked SUN SHADE raster — cast shadow marched along the sun bearing plus
//     sky occlusion. On a NORTH-ASPECT face at 39 deg in late January this is
//     the whole palette: annotations.md asks for "brilliant white wind-textured
//     snow with HARD BLUE SHADOW under every rib because the face is
//     north-aspect", and that shadow is geometry, not a filter.
//   * ROCK, which here is a first-class surface, not a trim: near-black granite
//     streaked pale grey where it sheds snow, with snow lace caught on every
//     up-facing ledge (views 4, 19, 20).
//   * SCREE on the crest east of the Headwall top — bare brown-grey talus in
//     late January (view-27). Explicitly NOT snow-blanketed.

import { lin, mixc, clamp, lerp, smooth, fbm, vnoise } from './lib/core.mjs';
import { groundZ, demAt, masksAt, rockAt, cliffAt, eastAt, screeAt, demSlopeAt, RASTER } from './ground.mjs';
import { CORE, TIGHT, WIDE, RIM, FAR_R, CLIFF_BOX, EAST_BOX, inCoreBox } from './layout.mjs';

// ------------------------------------------------------------------- sun
// Late-January early afternoon at 39.18 N. Azimuth from north, clockwise.
export const SUN_AZ = 205, SUN_EL = 31;
const az = SUN_AZ * Math.PI / 180, el = SUN_EL * Math.PI / 180;
export const SUN_DIR = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];

// SNOW ALBEDO IS ~0.85 AND IT SCATTERS. The first cut used Red Dog's shadow
// values and the whole sector came out a dark blue-grey slab, because unlike
// Red Dog this face is NORTH-ASPECT and almost all of it is in the terrain's
// own cast shadow at a late-January sun. Physically that shadow is real — it is
// what view-20 and the anchor aerial both show — but shadowed snow is BLUER,
// not DARKER, and view-20's flat light still reads brilliant white. So the
// shadow end of the ramp was lifted a full step and the ambient with it.
const C = {
  snowHi:   lin(0xfdfeff),
  snowMid:  lin(0xeef4fd),
  snowLo:   lin(0xcbdaee),   // blue shadow — the north-aspect signature
  snowDeep: lin(0xa7bdd9),
  groom:    lin(0xfafcff),
  scourC:   lin(0xe6edf7),
  packed:   lin(0xdbe4ef),
  rock:     lin(0x3a382f),   // near-black granite (views 4 / 19 / 20)
  rockLit:  lin(0x6f6a5c),
  rockPale: lin(0x9c937f),   // the pale grey streaks where the rock sheds snow
  lichen:   lin(0x4a4c3a),
  scree:    lin(0x7b7263),   // view-27's brown-grey rubble spine
  screeLo:  lin(0x54503f),
  canopy:   lin(0x1a2820),
  canopyLo: lin(0x121d18),
  tan:      lin(0x9c8f75),   // the snow-free south-facing Washeshu plateau
};

// ------------------------------------------------------- baked shade raster
const SH_RES = 5.0;
const SH_X0 = TIGHT.x0 - 60, SH_Y0 = TIGHT.y0 - 60;
const SH_NX = Math.ceil((TIGHT.x1 - SH_X0 + 60) / SH_RES) + 1;
const SH_NY = Math.ceil((TIGHT.y1 - SH_Y0 + 60) / SH_RES) + 1;
const SHADE = new Float32Array(SH_NX * SH_NY);
const SKY = new Float32Array(SH_NX * SH_NY);

function bakeShade() {
  const s = SUN_DIR;
  const sl = Math.hypot(s[0], s[1]) || 1;
  const sx = s[0] / sl, sy = s[1] / sl, tanEl = s[2] / sl;
  for (let j = 0; j < SH_NY; j++) {
    const y = SH_Y0 + j * SH_RES;
    for (let i = 0; i < SH_NX; i++) {
      const x = SH_X0 + i * SH_RES;
      const z0 = demAt(x, y);
      let occ = 0;
      for (let m = 1; m <= 14; m++) {
        const d = m * m * 3.2 + 6;
        const h = demAt(x + sx * d, y + sy * d) - (z0 + tanEl * d);
        if (h > 0) { occ = Math.max(occ, smooth(0, 14, h)); if (occ > 0.97) break; }
      }
      SHADE[j * SH_NX + i] = 1 - occ;
      let sky = 0;
      for (let a = 0; a < 8; a++) {
        const th = (a / 8) * Math.PI * 2;
        const rx = Math.cos(th), ry = Math.sin(th);
        let hi = 0;
        for (let m = 1; m <= 4; m++) {
          const d = m * 22;
          hi = Math.max(hi, (demAt(x + rx * d, y + ry * d) - z0) / d);
        }
        sky += 1 - clamp(hi, 0, 1);
      }
      SKY[j * SH_NX + i] = sky / 8;
    }
  }
}
bakeShade();

function shBil(A, x, y) {
  let fx = (x - SH_X0) / SH_RES, fy = (y - SH_Y0) / SH_RES;
  if (fx < 0 || fy < 0 || fx > SH_NX - 1.002 || fy > SH_NY - 1.002) return 1;
  const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, k = j * SH_NX + i;
  return lerp(lerp(A[k], A[k + 1], tx), lerp(A[k + SH_NX], A[k + SH_NX + 1], tx), ty);
}

// ------------------------------------------------------------ ground colour
export function colorAt(x, y, z, nx, ny, nz, res = 2.2) {
  const coarse = res > 5;
  const m = masksAt(x, y);
  const cast = shBil(SHADE, x, y);
  const sky = shBil(SKY, x, y);
  // The vertex colour is ALBEDO — the scene light does the lambert term. What
  // the baked pass adds is what a real-time light cannot do over a kilometre of
  // mountain: the terrain's own cast shadow, and sky occlusion in the gullies.
  const light = clamp(0.70 + 0.26 * cast + 0.24 * (sky - 0.72), 0, 1.25);
  let c;
  if (light > 0.88) c = mixc(C.snowMid, C.snowHi, smooth(0.88, 1.05, light));
  else if (light > 0.70) c = mixc(C.snowLo, C.snowMid, smooth(0.70, 0.88, light));
  else c = mixc(C.snowDeep, C.snowLo, smooth(0.46, 0.70, light));

  const n1 = coarse ? 0.5 + 0.5 * fbm(x * 0.040, y * 0.040, 1, 2.2, 0.5, 13)
                    : 0.5 + 0.5 * fbm(x * 0.09, y * 0.09, 2, 2.2, 0.5, 13);
  const n2 = 0.5 + 0.5 * fbm(x * 0.013, y * 0.013, 3, 2.1, 0.5, 29);

  // open alpine snow: wind scour, stronger in the bowl (view-11's "open
  // wind-textured snow") than anywhere at Red Dog
  const open = clamp(1 - m.groom - m.pack - m.cat, 0, 1);
  if (open > 0.05) c = mixc(c, mixc(c, C.scourC, 0.42), open * smooth(0.40, 0.9, n1) * 0.55);

  if (m.groom > 0.08) {
    const band = 0.5 + 0.5 * Math.cos((m.v / 5.2) * Math.PI * 2);
    let g = mixc(c, C.groom, 0.40);
    g = [g[0] * (0.988 + 0.024 * band), g[1] * (0.988 + 0.024 * band), g[2] * (0.99 + 0.02 * band)];
    c = mixc(c, g, smooth(0.05, 0.55, m.groom));
  }
  // SKI TRACKS. view-20's apron under the cliff is "covered in tracks", view-11
  // and view-41 are tracked-out basins, and the anchor aerial shows the tracked
  // apron as a distinct texture. Tracks run down the fall line, which over this
  // whole sector is roughly north/north-east, so the noise that carries them is
  // anisotropic: short across, long along. +/-3 % of albedo — a trace, not stripes.
  if (!coarse && (m.bowl > 0.10 || m.chute > 0.10 || m.groom > 0.10 || m.cat > 0.10)) {
    const dens = clamp(m.bowl + m.chute * 0.8 + m.groom * 0.5 + m.cat * 0.5, 0, 1);
    const tr = fbm(x * 0.62, y * 0.055, 2, 2.3, 0.5, 151);
    const k2 = (1 - Math.abs(tr)) * dens;
    c = [c[0] * (1 - 0.035 * k2), c[1] * (1 - 0.030 * k2), c[2] * (1 - 0.018 * k2)];
  }
  if (m.cat > 0.08) c = mixc(c, C.packed, smooth(0.05, 0.6, m.cat) * 0.6);
  if (m.pack > 0.05) c = mixc(c, mixc(C.packed, C.snowMid, n1 * 0.5), smooth(0.05, 0.7, m.pack) * 0.8);

  // ------------------------------------------------------------------ ROCK
  // This is the hero surface, so it gets its own read rather than a "steep ->
  // grey" trim. Three terms:
  //   1. the escarpment itself (cliff-data.mjs), which is where the ribs are;
  //   2. any face steep enough to shed snow, anywhere;
  //   3. snow LACE on the up-facing ledges, which is what makes near-black rock
  //      read as banded rock instead of a black hole (views 4, 19, 20).
  const cw = cliffAt(x, y), ew = eastAt(x, y);
  const steep = smooth(0.55, 0.86, 1 - nz);                 // ~34 deg -> ~59 deg
  const chute = clamp(m.chute * 1.1, 0, 1);
  let bare = clamp(Math.max(cw * 1.15 + ew * 0.85, steep * smooth(0.30, 0.70, n2) * 0.9), 0, 1);
  bare *= (1 - chute) * (1 - m.groom * 0.9) * (1 - m.cat * 0.8);
  if (bare > 0.02) {
    // jointing: pale streaks along the rib crests, dark in the joints
    // "near-black granite streaked pale grey where it sheds snow" — the streaks
    // are the identity, and they run DOWN the face, so the noise that drives
    // them is anisotropic: long in y (the fall line here), short in x.
    const joint = 0.5 + 0.5 * fbm(x * 0.22, y * 0.055, 3, 2.2, 0.55, 5);
    let rk = mixc(C.rock, C.rockLit, 0.25 + 0.55 * cast * (0.4 + 0.6 * nz));
    rk = mixc(rk, C.rockPale, smooth(0.44, 0.90, joint) * 0.80);
    rk = mixc(rk, C.lichen, smooth(0.34, 0.02, joint) * 0.38);
    // snow lace: every ledge and up-facing shelf holds snow
    const lace = smooth(0.62, 0.93, nz) * (0.45 + 0.55 * smooth(0.35, 0.8, n1));
    rk = mixc(rk, mixc(C.snowLo, C.snowMid, cast), lace * 0.75);
    c = mixc(c, rk, clamp(bare * 1.2, 0, 0.94));
  }
  // The Slot's walls read as rock even where the DEM is not steep, because the
  // walls are lifted by the stamp, not by 3DEP (view-28).
  if (m.wall > 0.05) {
    const rk = mixc(mixc(C.rock, C.rockLit, 0.3 + 0.5 * cast), C.rockPale, n1 * 0.5);
    c = mixc(c, rk, smooth(0.05, 0.5, m.wall) * 0.8);
  }

  // ------------------------------------------------------------- SCREE
  // view-27: bare talus and scree on the crest east of the Headwall top, in
  // LATE JANUARY. Do not snow-blanket it — this is a stated fact, not a guess.
  // ...and it stops at the edge of anything skiable. view-40 drops into North
  // Bowl straight off this crest and the basin below is snow, not rubble; the
  // first cut let the scree run down the corridor because only groom/cat/chute
  // were excluded and an open bowl is none of those.
  const sc = screeAt(x, y) * (1 - m.groom) * (1 - m.cat) * (1 - m.chute) * (1 - m.bowl * 0.85);
  if (sc > 0.02) {
    const g = mixc(C.screeLo, C.scree, 0.35 + 0.65 * smooth(0.3, 0.8, n1));
    c = mixc(c, mixc(g, C.rockPale, n2 * 0.35), clamp(sc * 0.92, 0, 0.9));
  }

  // The Washeshu plateau's SOUTH side and Sun Bowl's lower flanks are the sunny
  // aspect: the anchor aerial (Oct 2025) shows them snow-free tan while the
  // north-facing bowl still holds snow. In the modelled late-January day they
  // are snow-covered but thin, so the tan reads through on the steepest,
  // most-lit ground only.
  const southy = clamp(-ny, 0, 1) * smooth(0.62, 0.98, cast) * smooth(26, 40, demSlopeAt(x, y))
                 * (1 - m.bowl) * (1 - m.groom) * (1 - m.chute);
  if (southy > 0.05) c = mixc(c, C.tan, southy * 0.14 * smooth(0.45, 0.9, n2));

  // beyond the sector the ground reads as canopy from a distance
  const r = Math.hypot(x - 120, y - 220);
  if (r > 1250) {
    const far = smooth(1250, 2600, r);
    c = mixc(c, mixc(C.canopyLo, C.canopy, n2), far * 0.45 * (0.30 + 0.70 * (1 - smooth(120, 300, z))));
  }
  const j = coarse ? 1 : 0.965 + 0.07 * vnoise(x * 0.31, y * 0.31, 47);
  return [c[0] * j, c[1] * j, c[2] * j];
}

// ------------------------------------------------------------- mesh helper
function normal(x, y, h) {
  const zx = (groundZ(x + h, y) - groundZ(x - h, y)) / (2 * h);
  const zy = (groundZ(x, y + h) - groundZ(x, y - h)) / (2 * h);
  const l = Math.hypot(zx, zy, 1);
  return [-zx / l, -zy / l, 1 / l];
}

function gridMesh(THREE, x0, x1, y0, y1, step, { keep = null, name = 'terrain', nh = 0 } = {}) {
  const nx = Math.round((x1 - x0) / step), ny = Math.round((y1 - y0) / step);
  const vx = nx + 1, vy = ny + 1;
  const pos = new Float32Array(vx * vy * 3);
  const col = new Float32Array(vx * vy * 3);
  const H = nh || step * 0.9;
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * step, y = y0 + j * step;
      const z = groundZ(x, y);
      const k = (j * vx + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const n = normal(x, y, H);
      const c = colorAt(x, y, z, n[0], n[1], n[2], step);
      col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (keep && !keep(x0 + (i + 0.5) * step, y0 + (j + 0.5) * step)) continue;
      const a = j * vx + i, b = a + 1, c2 = a + vx, d = c2 + 1;
      idx.push(a, b, d, a, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, null);
  mesh.name = name;
  return mesh;
}

// a subdivided mesh over a marked subset of the core lattice, vertices deduped
function detailMesh(THREE, R, step, sub, cells, nx, ny, name) {
  const fs = step / sub, vnx = nx * sub + 1;
  const vmap = new Map();
  const pos = [], col = [], idx = [];
  const H = fs * 0.85;
  const vert = (fi, fj) => {
    const key = fj * vnx + fi;
    let v = vmap.get(key);
    if (v !== undefined) return v;
    const x = R.x0 + fi * fs, y = R.y0 + fj * fs;
    const z = groundZ(x, y);
    const n = normal(x, y, H);
    const c = colorAt(x, y, z, n[0], n[1], n[2], fs);
    v = pos.length / 3;
    pos.push(x, y, z); col.push(c[0], c[1], c[2]);
    vmap.set(key, v);
    return v;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!cells[j * nx + i]) continue;
      for (let sj = 0; sj < sub; sj++) {
        for (let si = 0; si < sub; si++) {
          const fi = i * sub + si, fj = j * sub + sj;
          const a = vert(fi, fj), b = vert(fi + 1, fj), c2 = vert(fi, fj + 1), d = vert(fi + 1, fj + 1);
          idx.push(a, b, d, a, d, c2);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, null);
  mesh.name = name;
  return mesh;
}

const dilate = (src, nx, ny) => {
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (src[j * nx + i]) continue;
      let near = 0;
      for (let dj = -1; dj <= 1 && !near; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && src[jj * nx + ii]) { near = 1; break; }
        }
      }
      if (near) out[j * nx + i] = 1;
    }
  }
  return out;
};

export const CORE_STEP = 4.4;

export function buildTerrain(THREE, material, materialFar) {
  const R = CORE, step = CORE_STEP;
  const nx = Math.round((R.x1 - R.x0) / step), ny = Math.round((R.y1 - R.y0) / step);
  const isC = new Uint8Array(nx * ny), isP = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = R.x0 + (i + 0.5) * step, y = R.y0 + (j + 0.5) * step;
      const m = masksAt(x, y);
      // CLIFF CELLS: the escarpment, the east wall, every chute throat and every
      // gully wall. This is where the triangles go.
      const rock = cliffAt(x, y) + eastAt(x, y) * 0.8;
      if (rock > 0.14 || m.chute > 0.05 || m.wall > 0.06) isC[j * nx + i] = 1;
      // the corridor detail mesh follows MD — the sector's own runs, with an
      // open BOWL taking it only over its inner half (at 13.7 deg mean it is the
      // mountain, not a cut lane). The honest-sparse three and the context runs
      // outside the sector ride the core grid.
      else if (m.detail > 0.28 || m.pack > 0.05) isP[j * nx + i] = 1;
    }
  }
  const ringC = dilate(isC, nx, ny);
  const bothCP = new Uint8Array(nx * ny);
  for (let k = 0; k < bothCP.length; k++) bothCP[k] = isC[k] || isP[k] ? 1 : 0;
  const ringP = dilate(bothCP, nx, ny);

  const cCells = new Uint8Array(nx * ny), pCells = new Uint8Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) {
    cCells[k] = isC[k] || ringC[k] ? 1 : 0;
    pCells[k] = isP[k] || ringC[k] || ringP[k] ? 1 : 0;
  }
  // sub 3 -> 1.47 m over the rock; sub 2 -> 2.20 m over the corridors.
  // 1.47 m is finer than the 1.367 m DEM's own spacing is meaningful at, which
  // is the point: the extra resolution is carrying cliff.mjs's ribs and ledges,
  // not the DEM. sub 4 was tried and shipped 386 k collidable triangles on the
  // cliff alone, which blew the 600 k budget; 3 holds the read.
  const cliff = detailMesh(THREE, R, step, 3, cCells, nx, ny, 'terrain-cliff');
  const piste = detailMesh(THREE, R, step, 2, pCells, nx, ny, 'terrain-piste');

  const coreKeep = (x, y) => {
    const i = Math.floor((x - R.x0) / step), j = Math.floor((y - R.y0) / step);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return true;
    return !(isC[j * nx + i] || isP[j * nx + i]);
  };
  const core = gridMesh(THREE, R.x0, R.x1, R.y0, R.y1, step, { keep: coreKeep, name: 'terrain-core' });

  const inCore = (x, y) => x > R.x0 + 8 && x < R.x1 - 8 && y > R.y0 + 8 && y < R.y1 - 8;
  const mid = gridMesh(THREE, TIGHT.x0, TIGHT.x1, TIGHT.y0, TIGHT.y1, 11.2,
                       { keep: (x, y) => !inCore(x, y), name: 'terrain-mid', nh: 6 });
  const inMid = (x, y) => x > TIGHT.x0 + 16 && x < TIGHT.x1 - 16 && y > TIGHT.y0 + 16 && y < TIGHT.y1 - 16;
  const wide = gridMesh(THREE, WIDE.x0, WIDE.x1, WIDE.y0, WIDE.y1, 42.1,
                        { keep: (x, y) => !inMid(x, y), name: 'terrain-wide', nh: 22 });

  const rim = buildRim(THREE);

  for (const m of [cliff, piste, core, mid, wide, rim]) {
    m.material = material; m.receiveShadow = true;
  }
  // the cliff casts: its own shadow on the apron below is the read that makes
  // the band legible from the bowl floor (view-20's dark band over bright snow)
  cliff.castShadow = true; core.castShadow = true;
  piste.castShadow = false; mid.castShadow = false; wide.castShadow = false; rim.castShadow = false;
  return { cliff, piste, core, mid, wide, rim, far: buildFar(THREE, materialFar) };
}

// ------------------------------------------------------ end-of-data rim
function buildRim(THREE) {
  const P = RIM.pad, st = RIM.step;
  const x0 = WIDE.x0 - P, x1 = WIDE.x1 + P, y0 = WIDE.y0 - P, y1 = WIDE.y1 + P;
  const outside = (x, y) => Math.max(WIDE.x0 - x, x - WIDE.x1, WIDE.y0 - y, y - WIDE.y1);
  const zRim = (x, y) => {
    const d = Math.max(0, outside(x, y));
    return demAt(x, y) + smooth(RIM.holdM, P, d) * RIM.riseM;
  };
  const nx = Math.round((x1 - x0) / st), ny = Math.round((y1 - y0) / st);
  const vx = nx + 1, vy = ny + 1;
  const pos = new Float32Array(vx * vy * 3), col = new Float32Array(vx * vy * 3);
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = x0 + i * st, y = y0 + j * st, z = zRim(x, y);
      const k = (j * vx + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const h = st;
      const gx = (zRim(x + h, y) - zRim(x - h, y)) / (2 * h);
      const gy = (zRim(x, y + h) - zRim(x, y - h)) / (2 * h);
      const l = Math.hypot(gx, gy, 1);
      const c = colorAt(x, y, z, -gx / l, -gy / l, 1 / l, st);
      col[k] = c[0]; col[k + 1] = c[1]; col[k + 2] = c[2];
    }
  }
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * st, cy = y0 + (j + 0.5) * st;
      if (outside(cx, cy) < -st) continue;
      const a = j * vx + i, b = a + 1, c2 = a + vx, d = c2 + 1;
      idx.push(a, b, d, a, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, null);
  mesh.name = 'terrain-rim';
  return mesh;
}

// -------------------------------------------------------------- far apron
// The Sierra crest and Olympic Valley beyond the dem-wide frame. Not a
// collider: it is the skyline of views 27, 33, 36 and 38 — "the widest horizon
// in the bundle" — and LAKE TAHOE goes on it (view-12), which annotations.md
// calls "the single best orientation cue in the whole sector".
function buildFar(THREE, material) {
  const CXX = 120, CYY = 220;
  const r0 = (WIDE.x1 - WIDE.x0) / 2 + RIM.pad + 60, NR = 28, NA = 132;
  const pos = [], col = [], idx = [];
  const ring = (ri) => r0 * Math.pow(FAR_R / r0, ri / NR);
  // Lake Tahoe: ENE of the sector, ~11 km out. A flat pale-blue band, held at a
  // constant level so it reads as water, not as another ridge.
  const LAKE_AZ = 68 * Math.PI / 180;          // bearing from north -> ENE
  const lakeDir = [Math.sin(LAKE_AZ), Math.cos(LAKE_AZ)];
  for (let ri = 0; ri <= NR; ri++) {
    const r = ring(ri);
    for (let ai = 0; ai <= NA; ai++) {
      const a = (ai / NA) * Math.PI * 2;
      const x = CXX + Math.cos(a) * r, y = CYY + Math.sin(a) * r;
      const bear = (x - CXX) / r * lakeDir[0] + (y - CYY) / r * lakeDir[1];
      const lake = smooth(0.93, 0.995, bear) * smooth(6000, 9000, r) * (1 - smooth(12500, 14000, r));
      let z;
      if (ri === 0) z = demAt(x, y) + RIM.riseM;
      else {
        const t = ri / NR;
        const base = 300 - 250 * smooth(0.0, 0.92, t);
        const ridge = Math.pow(1 - Math.abs(fbm(x * 0.00068, y * 0.00068, 5, 2.05, 0.58, 5)), 1.4) * 500 * (0.95 - 0.42 * t);
        const roll = fbm(x * 0.00035, y * 0.00035, 3, 2.1, 0.5, 61) * 250;
        z = base + ridge * 0.80 + roll - 30;
        if (ri <= 2) z = lerp(demAt(x, y) + RIM.riseM, z, smooth(0, 2, ri));
        // Lake Tahoe's surface is 1897 m ASL = -469 m in this frame. It is
        // beyond the fog, so it is carried as a flat pale band at the horizon
        // rather than at its true depth, which would be under the far ridges.
        if (lake > 0.02) z = lerp(z, -40, lake);
      }
      pos.push(x, y, z);
      const t = ri / NR;
      const snowy = smooth(200, 430, z);
      let c = mixc(lin(0x2c4136), lin(0x7b91aa), snowy * 0.82);
      c = mixc(c, lin(0xdae5f2), smooth(270, 540, z) * 0.85);
      if (lake > 0.02) c = mixc(c, lin(0x8fb2cf), lake * 0.9);
      c = mixc(c, lin(0xcfdff0), smooth(0.06, 0.72, t) * 0.90);
      col.push(c[0], c[1], c[2]);
    }
  }
  const Wd = NA + 1;
  for (let ri = 0; ri < NR; ri++) {
    for (let ai = 0; ai < NA; ai++) {
      const a = ri * Wd + ai, b = a + 1, c2 = a + Wd, d = c2 + 1;
      idx.push(a, b, d, a, d, c2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'far-country';
  return mesh;
}

export { SHADE, SKY, shBil };
