// Collision for the first-person player.
//
// No physics library. At load we flatten the scene's collidable meshes into a
// flat world-space triangle soup and bin it into a uniform XZ grid; queries are
// then plain Möller–Trumbore against the handful of triangles in one cell.
// That is enough for "walk on a beach, climb a rock, bump into a tree", and it
// is fast enough to run three rays a frame against a 500k-triangle scene.
//
// Two things ride along with the soup, because every caller that wants them
// already holds a `collision`:
//
//   * SURFACE CLASS. One byte per triangle: 0 snow, 1 rock. `groundClass()`
//     reports the class of the last `groundAt()` hit, the way `groundNormal()`
//     reports its normal. It says what you are STANDING ON — fx.js strikes
//     sparks off it — and, on a `raycast()` hit (`best.cls`, `best.mesh`), what
//     you are about to run INTO, which is the half the controller wipes on
//     (specs/0020 §2b). See `meshRock()` for how a rock mesh is recognised.
//   * MESH NAME. Two bytes per triangle indexing a per-build name table, so a
//     hit can say `poulsen-cliff` and not just "class 1".
//   * TREE STEMS. Not triangles at all — solids.js hashes them separately and
//     this file just forwards the query (`stemHit`), so the controller needs one
//     object rather than two.

import { harvestStems } from './solids.js';
import { createCanopyFx } from './canopy.js';

const EPS = 1e-7;

// ---------------------------------------------------------------- surface class
export const CLASS_SNOW = 0;
export const CLASS_ROCK = 1;
// specs/0018 — the props that are solid AND have something to say about it.
// Greg, 2026-09-01: "queue towers buildings people and benches as collideable
// and give them all the funny chats when they induce wipeout." Sign posts join
// TOWER: a post is a thin tower, and it puts you down the same way.
export const CLASS_BUILDING = 2;
export const CLASS_TOWER = 3;
export const CLASS_PERSON = 4;
export const CLASS_BENCH = 5;

// dot(faceNormal, up) below which a rock face is ROCK. Above it the face is
// flat enough that the world's slope-gated snow (specs/0005 L4, and snowLace's
// baked vertex colours) has fully covered it — that is a snow cap sitting ON
// rock, and it skis like snow. 35 deg from horizontal, which is the covered end
// of L4's own ramp (ROCK_SNOW_SLOPE_EDGE 0.62, feather 0.20).
const ROCK_SLOPE_COS = Math.cos(35 * Math.PI / 180);   // 0.8192

// The name a rock mesh is likely to carry. Matched against the mesh and its
// parents, the same way surprise.js matches trees.
const ROCK_NAME_RE = /(^|[-_ ])(rocks?|granite|boulders?|outcrops?|cliffs?|talus|scree|stones?|spires?|reefs?|crags?|scramble)([-_ ]|\d|$)/i;
// ...and the tag a rock MATERIAL carries. `customProgramCacheKey` is three.js's
// own per-material shader identity hook, and a world that hand-writes a rock
// shader always pins one ('pal-granite-1', 'kt-volcanic-1' here). It is the only
// thing that tells `kt-eagles-nest` — a name with no rock word in it — apart
// from the terrain it sits on.
const ROCK_MAT_RE = /rock|granite|volcanic|boulder|scree|talus|cliff|stone/i;

function matTag(m) {
  let s = m.name || '';
  if (typeof m.customProgramCacheKey === 'function') {
    try { s += ' ' + m.customProgramCacheKey(); } catch { /* a material may refuse */ }
  }
  return s;
}

// Is this mesh made of rock? Name chain first (cheap and explicit), material
// tag second (catches the meshes whose name is a place, not a substance).
function meshRock(mesh) {
  let q = mesh, n = 0;
  while (q && n++ < 6) {
    if (q.name && ROCK_NAME_RE.test(q.name)) return true;
    q = q.parent;
  }
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m && ROCK_MAT_RE.test(matTag(m))) return true;
  }
  return false;
}

// ---- specs/0018: THE PROP CLASS TABLE, and why it is names and not materials.
//
// Rock gets two chances (name, then material) because a world that hand-writes
// a granite shader pins a material key, and `kt-eagles-nest` is a place name
// with no rock word in it. Props get exactly ONE chance — the scene-group name —
// because both worlds here draw every prop group with the SAME shared
// MeshLambertMaterial (`SHEET`), so a material tag would paint the buildings,
// the towers, the people and the terrain furniture all one class. The name is
// the only thing that actually distinguishes them, and the worlds already name
// them (`base-buildings`, `lift-structures`, `people-props`, `ridge-furniture`).
//
// Ordered, first match wins: a `deck-benches` group is seating before it is
// furniture, and `sign-posts` is a post before it is anything else. ROCK is
// tested ahead of all of them, so `poulsen-cliff` and `funitel-granite` keep the
// class — and the snow-cap slope gate — they already had.
const CLASS_NAME_RE = [
  [CLASS_PERSON, /(^|[-_ ])(people|person|persons|skier|skiers|rider|riders|crowd|pedestrians?|figures?|props)([-_ ]|\d|$)/i],
  [CLASS_BENCH, /(^|[-_ ])(bench|benches|seat|seats|table|tables|picnic)([-_ ]|\d|$)/i],
  [CLASS_TOWER, /(^|[-_ ])(tower|towers|pylons?|masts?|posts?|poles?|signposts?|structures?|furniture)([-_ ]|\d|$)/i],
  [CLASS_BUILDING, /(^|[-_ ])(buildings?|lodges?|houses?|huts?|sheds?|terminals?|stations?|chalets?|barns?|lifthouse)([-_ ]|\d|$)/i],
];

// The class this mesh contributes. Rock first (it owns the material fallback and
// the slope gate), then the prop table against the name chain, then snow.
function meshClass(mesh) {
  if (meshRock(mesh)) return CLASS_ROCK;
  let q = mesh, n = 0;
  while (q && n++ < 6) {
    if (q.name) {
      for (const [cls, re] of CLASS_NAME_RE) if (re.test(q.name)) return cls;
    }
    q = q.parent;
  }
  return CLASS_SNOW;
}

// A collider is anything a body could stand on or walk into. Backdrops are
// not: sky domes, distant ridge rings, clouds and water are geometry the
// author put there to be looked at, and standing on them is always a bug.
function isBackdrop(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    if (m.transparent && (m.opacity ?? 1) < 0.98) return true;   // water, clouds
    if (m.side === 1 /* THREE.BackSide */) return true;          // sky dome
    if (m.fog === false && (m.isMeshBasicMaterial || m.isShaderMaterial)) return true; // hazed ridges
    if (m.depthWrite === false) return true;
  }
  return /sky|cloud|ridge|haze|water|backdrop|fog|helper|grid/i.test(mesh.name || '');
}

// World-space bounds of everything a body could touch. Used to sanity check
// the scene's units before any tuning number is trusted.
export function collidableBox(THREE, root) {
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  root.updateMatrixWorld(true);
  let n = 0;
  root.traverse((o) => {
    if (!o.visible || !o.isMesh || isBackdrop(o)) return;
    one.setFromObject(o);
    if (one.isEmpty()) return;
    box.union(one); n++;
  });
  return { box, meshes: n };
}

function growF32(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Float32Array(n);
  out.set(buf);
  return out;
}
function growI32(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Int32Array(n);
  out.set(buf);
  return out;
}
function growU8(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Uint8Array(n);
  out.set(buf);
  return out;
}
function growU16(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Uint16Array(n);
  out.set(buf);
  return out;
}

export function buildCollision(THREE, root, opts = {}) {
  const cell = opts.cell || 6;
  const half = opts.halfExtent || 620;
  const center = opts.center || new THREE.Vector3();
  const maxCellsPerTri = opts.maxCellsPerTri || 64;   // rejects backdrop-sized triangles
  // specs/0051 §3.4 — THE BUCKET / REJECTION SPLIT. The router (collision-router.js)
  // wants ONE harvest of the scene binned into coarse buckets it can slice a tile
  // out of, not a whole-world 6 m CSR; but the oversize rejection above is
  // calibrated in CELLS, so widening `cell` would silently let backdrop-sized
  // triangles back into the soup and change what the player collides with.
  // `rejectCell` keeps that test on its original 6 m lattice while `cell` sizes
  // the bins. Defaulted to `cell`, so every existing call is unchanged.
  const rejectCell = opts.rejectCell || cell;
  // §3.5 / D-5 — the per-tile cap EXCLUDES terrain and THROWS rather than
  // silently truncating the way `skippedOutside` does. `isTerrain(mesh)` is the
  // declaration of which meshes are ground; `propCap` is the ceiling on
  // everything else in this instance. Both off by default.
  const isTerrain = typeof opts.isTerrain === 'function' ? opts.isTerrain : null;
  const propCap = opts.propCap || 0;
  const capLabel = opts.capLabel || 'tile';
  // THE SOUP'S CEILING, and specs/0018 is the reason it moved. `palisades-front`
  // was harvesting 895,689 triangles against a 900,000 cap — 4,311 of headroom —
  // so declaring five more prop groups as colliders would have silently
  // truncated whichever of them the traversal reached last, with no error and no
  // way to tell a missing bench from a bench you happened to miss. `pushTri`
  // fails CLOSED (it returns, it does not throw), which is exactly the failure a
  // gate cannot see. Raised to 1.2 M: `palisades-front` now harvests 906,535,
  // so there is 293 k of room. The cost is linear and paid only by triangles
  // that exist — the arrays double from 1 k, they are not sized to the cap —
  // 39 bytes each plus their grid entries, so an empty budget costs nothing.
  const triBudget = opts.triBudget || 1200000;

  const x0 = center.x - half, z0 = center.z - half;
  const nx = Math.max(1, Math.ceil((half * 2) / cell));
  const nz = nx;

  root.updateMatrixWorld(true);

  let V = new Float32Array(1 << 16);   // 9 floats per triangle, world space
  let B = new Int32Array(1 << 14);     // 4 ints per triangle: i0,j0,i1,j1
  let C = new Uint8Array(1 << 12);     // 1 byte per triangle: CLASS_SNOW | CLASS_ROCK
  // ...and specs/0020 §2b: WHICH MESH the triangle came off, as an index into
  // `meshNames`. Two bytes a triangle (about 5% on top of the soup) buys the
  // one thing "did I run INTO something" needs and the class byte cannot give:
  // a name to put in the report. 0018 wants it for towers and buildings; here
  // it is what lets a gate say WHICH rock face the wipe was against.
  let M = new Uint16Array(1 << 12);
  const meshNames = [''];              // 0 is "unknown", so an unfilled slot is honest
  // specs/0051 §3.5 — and whether that mesh was DECLARED TERRAIN, decided once
  // per mesh and read per triangle. The router's per-tile cap needs the answer
  // by triangle index; carrying it here is one byte per mesh, not per triangle.
  const meshIsTerrain = [0];
  let meshIdx = 0;
  // specs/0018 §1 — THE HARVEST LEDGER. One row per mesh the traversal saw,
  // whether it was eaten or dropped, with the class it contributed and how many
  // triangles actually landed in the soup. It is the only way to answer "is the
  // Funitel base in the soup, and as what?" without re-deriving the traversal in
  // a probe that would then be answering about its own rules and not these.
  // Build-time only; one small object per mesh, capped so a pathological scene
  // cannot turn the ledger into the memory story.
  const ledger = [];
  const LEDGER_CAP = 4000;
  let ledgerRow = null;
  let nTri = 0, nEntries = 0;
  let nTerrainTri = 0, nPropTri = 0;   // specs/0051 §3.5 — the two scopes of the cap
  let meshTerrain = false;
  let skippedOversize = 0, skippedOutside = 0, meshesUsed = 0, meshesSkipped = 0;
  let nRockTri = 0, nRockMesh = 0;
  const nClsTri = [0, 0, 0, 0, 0, 0];   // specs/0018 — triangles per class byte
  let minY = Infinity, maxY = -Infinity;
  // the class the mesh currently being eaten contributes, before the slope gate
  let meshCls = CLASS_SNOW;

  const m4 = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ipos = new THREE.Vector3();

  function pushTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if (nTri >= triBudget) return;
    const lox = Math.min(ax, bx, cx), hix = Math.max(ax, bx, cx);
    const loz = Math.min(az, bz, cz), hiz = Math.max(az, bz, cz);
    if (hix < x0 || lox > x0 + nx * cell || hiz < z0 || loz > z0 + nz * cell) { skippedOutside++; return; }
    const i0 = Math.max(0, Math.floor((lox - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((hix - x0) / cell));
    const j0 = Math.max(0, Math.floor((loz - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((hiz - z0) / cell));
    // ...the OVERSIZE test on its own lattice (specs/0051 §3.4). With
    // `rejectCell === cell` — every pre-0051 call — this is the same arithmetic
    // on the same numbers as the two lines above.
    const cells = (i1 - i0 + 1) * (j1 - j0 + 1);
    const rc = rejectCell === cell ? cells
      : (Math.floor((hix - x0) / rejectCell) - Math.floor((lox - x0) / rejectCell) + 1)
      * (Math.floor((hiz - z0) / rejectCell) - Math.floor((loz - z0) / rejectCell) + 1);
    if (rc > maxCellsPerTri) { skippedOversize++; return; }

    V = growF32(V, (nTri + 1) * 9);
    const o = nTri * 9;
    V[o] = ax; V[o + 1] = ay; V[o + 2] = az;
    V[o + 3] = bx; V[o + 4] = by; V[o + 5] = bz;
    V[o + 6] = cx; V[o + 7] = cy; V[o + 8] = cz;
    B = growI32(B, (nTri + 1) * 4);
    const p = nTri * 4;
    B[p] = i0; B[p + 1] = j0; B[p + 2] = i1; B[p + 3] = j1;
    // ---- surface class, with THE SNOW-CAP GATE.
    // A rock mesh is not rock all over: this world paints snow into the rock's
    // own vertex colours (snowLace) and lays more on in the shader, both gated
    // on how flat the face lies, so a bluff's plate tops are a snow cap on a
    // rock mesh and ski like snow. There is no second mesh to read the class
    // off, so the class comes off the FACE: steeper than 35 deg is stone,
    // flatter is the cap.
    C = growU8(C, nTri + 1);
    let cls = meshCls;
    if (cls === CLASS_ROCK) {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const ny = uz * vx - ux * vz;                       // Y of (u x v)
      const len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
      if (len > 1e-9 && Math.abs(ny / len) >= ROCK_SLOPE_COS) cls = CLASS_SNOW;
    }
    C[nTri] = cls;
    M = growU16(M, nTri + 1);
    M[nTri] = meshIdx;
    if (cls === CLASS_ROCK) nRockTri++;
    if (cls < nClsTri.length) nClsTri[cls]++;
    // specs/0051 §3.5 / D-5: terrain is FIXED and uncapped; the 4,000 ceiling is
    // trees/props/rocks per tile and it THROWS. `skippedOutside` fails closed and
    // that is exactly the failure a gate cannot see — this one cannot be missed.
    if (meshTerrain) nTerrainTri++;
    else if (++nPropTri > propCap && propCap > 0) {
      throw new Error(`collision: ${capLabel} exceeded its non-terrain triangle cap `
        + `(${nPropTri} > ${propCap}); specs/0051 §3.5 caps props/trees/rocks per tile and throws `
        + `rather than truncating. Thin the props in this tile or raise the cap with a measured note.`);
    }
    if (ledgerRow) { ledgerRow.tris++; ledgerRow.byClass[cls] = (ledgerRow.byClass[cls] || 0) + 1; }
    nEntries += cells;
    nTri++;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
  }

  function eatGeometry(geo, mat) {
    const pos = geo.getAttribute && geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      va.set(pos.getX(a), pos.getY(a), pos.getZ(a)).applyMatrix4(mat);
      vb.set(pos.getX(b), pos.getY(b), pos.getZ(b)).applyMatrix4(mat);
      vc.set(pos.getX(c), pos.getY(c), pos.getZ(c)).applyMatrix4(mat);
      pushTri(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
    }
  }

  const explicit = opts.colliders && opts.colliders.length ? opts.colliders : null;
  const roots = explicit || [root];
  for (const r of roots) {
    r.traverse((o) => {
      if (!o.visible || !o.isMesh) return;
      if (!explicit && isBackdrop(o)) {
        meshesSkipped++;
        if (ledger.length < LEDGER_CAP) ledger.push({ name: o.name || '(unnamed)', eaten: false, why: 'backdrop', cls: -1, tris: 0, byClass: {} });
        return;
      }
      const geo = o.geometry;
      if (!geo || !geo.getAttribute || !geo.getAttribute('position')) return;
      // specs/0051 §1.6 — a tile's skirt is extruded geometry that exists to
      // hide a residency seam; it is never collidable. The suffix is the
      // exclusion, matching this file's existing name-based rule above.
      if (/:skirt$/.test(o.name || '')) { meshesSkipped++; return; }
      meshesUsed++;
      meshTerrain = isTerrain ? !!isTerrain(o) : false;
      meshCls = meshClass(o);
      if (meshCls === CLASS_ROCK) nRockMesh++;
      ledgerRow = ledger.length < LEDGER_CAP
        ? { name: o.name || '(unnamed)', eaten: true, why: explicit ? 'declared' : 'auto',
            cls: meshCls, tris: 0, byClass: {}, instanced: !!o.isInstancedMesh }
        : null;
      if (ledgerRow) ledger.push(ledgerRow);
      // the name goes in the table once per mesh, not once per triangle; a
      // world with more than 65534 collidable meshes keeps 0 ('unknown')
      if (meshNames.length < 65535) {
        meshNames.push(o.name || '(unnamed)');
        meshIsTerrain.push(meshTerrain ? 1 : 0);
        meshIdx = meshNames.length - 1;
      } else meshIdx = 0;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, inst);
          ipos.setFromMatrixPosition(inst).applyMatrix4(o.matrixWorld);
          if (Math.abs(ipos.x - center.x) > half + 80 || Math.abs(ipos.z - center.z) > half + 80) continue;
          m4.multiplyMatrices(o.matrixWorld, inst);
          eatGeometry(geo, m4);
        }
      } else {
        eatGeometry(geo, o.matrixWorld);
      }
    });
  }

  // counting sort of triangles into cells
  const nCells = nx * nz;
  const start = new Int32Array(nCells + 1);
  for (let t = 0; t < nTri; t++) {
    const p = t * 4;
    for (let j = B[p + 1]; j <= B[p + 3]; j++) {
      const row = j * nx;
      for (let i = B[p]; i <= B[p + 2]; i++) start[row + i + 1]++;
    }
  }
  for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
  const items = new Int32Array(nEntries);
  const cursor = start.slice(0, nCells);
  for (let t = 0; t < nTri; t++) {
    const p = t * 4;
    for (let j = B[p + 1]; j <= B[p + 3]; j++) {
      const row = j * nx;
      for (let i = B[p]; i <= B[p + 2]; i++) items[cursor[row + i]++] = t;
    }
  }
  B = null;

  const tris = V.subarray(0, nTri * 9);
  const cls = C.subarray(0, nTri);
  const mid = M.subarray(0, nTri);
  const stamp = new Int32Array(nTri);
  let stampGen = 0;

  // Tree stems live outside the soup — see solids.js. The scan is cached on the
  // scene root, so surprise.js's init gets this same object for free.
  const stems = harvestStems(THREE, root);
  // ...and §E3's visible half. Built here, not in main.js, because this is the
  // one place that already holds BOTH the scene root (to hang the snow buffer
  // on) and the stem set (to find the instance a hit belongs to). It costs one
  // Points object with an empty draw range until something actually falls.
  //
  // The scene's unit is RECOVERED from the cell size rather than passed: main.js
  // hands this function `cell: 6 * unitScale`, so `cell / 6` is the scale, and
  // the seam stays where it already is instead of growing another argument
  // through a call site this spec has no business editing. (controller.js
  // recovers the same number from `T.walk` for the same reason.)
  let canopyFx = null;
  try { canopyFx = createCanopyFx(THREE, root, stems, { unit: (opts.cell || 6) / 6 }); }
  catch { canopyFx = null; }         // a host with no renderer is still playable

  // ---- queries -------------------------------------------------------------

  // Ray/triangle, double sided: geometry we walk on is authored with all sorts
  // of winding, and a one-sided test silently drops floors.
  function hitTri(t, ox, oy, oz, dx, dy, dz, maxDist, out) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
    const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) return false;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return false;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return false;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist < 0 || dist > maxDist) return false;
    out.dist = dist;
    // geometric normal, flipped to oppose the ray
    let nxv = e1y * e2z - e1z * e2y, nyv = e1z * e2x - e1x * e2z, nzv = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    nxv /= len; nyv /= len; nzv /= len;
    if (nxv * dx + nyv * dy + nzv * dz > 0) { nxv = -nxv; nyv = -nyv; nzv = -nzv; }
    out.nx = nxv; out.ny = nyv; out.nz = nzv;
    return true;
  }

  const scratch = { dist: 0, nx: 0, ny: 0, nz: 0 };
  // `cls` and `mesh` are specs/0020 §2b: the same two facts groundAt() has
  // always reported about the floor, reported about an ARBITRARY hit, so
  // "what did I just run into" is one query and not a second index.
  const best = { dist: 0, nx: 0, ny: 1, nz: 0, y: 0, hit: false, cls: CLASS_SNOW, mesh: '' };
  // ground normal from the last groundAt(), kept apart from `best` so a raycast
  // in between cannot overwrite it (skiing reads it a few lines later)
  const gn = { x: 0, y: 1, z: 0 };
  // ...and the surface CLASS of that same hit, kept for the same reason, plus
  // the mesh it came off (specs/0020).
  let gcls = CLASS_SNOW;
  let gmesh = 0;

  function cellOf(x, z) {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return -1;
    return j * nx + i;
  }

  // Highest surface strictly below `fromY` at (x,z). null = nothing under you.
  function groundAt(x, z, fromY) {
    const c = cellOf(x, z);
    if (c < 0) return null;
    const s = start[c], e = start[c + 1];
    let hitY = -Infinity, hnx = 0, hn = 1, hnz = 0, hc = CLASS_SNOW, hm = 0;
    for (let k = s; k < e; k++) {
      const t = items[k];
      if (hitTri(t, x, fromY, z, 0, -1, 0, 1e5, scratch)) {
        const y = fromY - scratch.dist;
        if (y > hitY) { hitY = y; hnx = scratch.nx; hn = scratch.ny; hnz = scratch.nz; hc = cls[t]; hm = mid[t]; }
      }
    }
    if (hitY === -Infinity) return null;
    best.y = hitY; best.ny = hn;
    gn.x = hnx; gn.y = hn; gn.z = hnz;   // always points up: the probe ray is -Y
    gcls = hc; gmesh = hm;
    return hitY;
  }
  function groundNormalY() { return best.ny; }
  // The surface you are standing on, as of the last groundAt() that hit. Live
  // object — copy it if you need to keep it.
  function groundNormal() { return gn; }
  // ...and what that surface is MADE OF: CLASS_SNOW | CLASS_ROCK. Same contract
  // as groundNormal() — it is the last groundAt() that HIT, so read it in the
  // same breath as the height you just took.
  function groundClass() { return gcls; }
  // ...and its NAME, on the same contract. Empty string when the host built the
  // soup before names were tracked or the world ran past the 65534-mesh table.
  function groundMesh() { return meshNames[gmesh] || ''; }

  // Short arbitrary ray. Distances here are sub-metre, so sampling the cells
  // along the segment beats a full grid DDA and cannot miss at this length.
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const steps = Math.max(1, Math.ceil(maxDist / (cell * 0.5)));
    stampGen++;
    let found = false, bd = maxDist, bt = -1;
    for (let s = 0; s <= steps; s++) {
      const f = (s / steps) * maxDist;
      const c = cellOf(ox + dx * f, oz + dz * f);
      if (c < 0) continue;
      const a = start[c], b = start[c + 1];
      for (let k = a; k < b; k++) {
        const t = items[k];
        if (stamp[t] === stampGen) continue;
        stamp[t] = stampGen;
        if (hitTri(t, ox, oy, oz, dx, dy, dz, bd, scratch) && scratch.dist < bd) {
          bd = scratch.dist; found = true; bt = t;
          best.dist = scratch.dist; best.nx = scratch.nx; best.ny = scratch.ny; best.nz = scratch.nz;
        }
      }
    }
    if (!found) return null;
    best.hit = true;
    // one array read on the WINNING triangle, not on every candidate
    best.cls = cls[bt]; best.mesh = meshNames[mid[bt]] || '';
    return best;
  }

  // ------------------------------------------------- physics/no-snag §2a
  // NEAREST FACE, and why a ray cannot answer it.
  //
  // Every query above this line is a RAY: "what does the world put in front of
  // me". That is the right question for a body OUTSIDE the geometry and the
  // wrong one for a body inside it — Möller–Trumbore is double sided and flips
  // the normal to oppose the ray, so a probe fired forward from inside a rib
  // reports the FAR wall with a normal pointing back the way you came. The wall
  // slide then dutifully projects the move onto that plane and slides you along
  // the inside of the mountain, forever, which is exactly the trap
  // req-20260905-174625 measured on the box chute's 83 deg slot wall ("a body
  // driven straight into it from the apron still ends up inside it — slide() has
  // no depenetration").
  //
  // The question depenetration actually needs is unsigned and directionless:
  // WHERE IS THE NEAREST PIECE OF SURFACE, and which way is out. That is a
  // point-triangle closest-point test (Ericson, Real-Time Collision Detection
  // §5.1.5) over the cells the search sphere touches, and the way out is
  // `normalize(p - closestPoint)` — the minimum translation that separates them,
  // which is correct whether the body is pressed against the face or buried
  // behind it, and needs no winding convention to be right.
  //
  //   `maxAbsNy` restricts the answer to WALL-ish faces (|ny| below it). The
  //   floor is the ground snap's business and pushing a body up off the slope it
  //   is standing on would fight it; the caller passes controller.js's own
  //   WALL_NY so "what stops the move", "what the move ran into" and "what I am
  //   inside of" are one set of faces and not three.
  //
  // Cost is the cells the sphere touches: at r = 0.4 and cell 6 that is one or
  // two, i.e. the same handful of triangles a ray already reads. A deep-burial
  // caller passing r = 4 pays four cells, and only on the frames it is buried.
  const nf = { dist: 0, nx: 0, ny: 1, nz: 0, cx: 0, cy: 0, cz: 0, fnx: 0, fny: 1, fnz: 0, cls: CLASS_SNOW, mesh: '', tri: -1 };
  const cp = { x: 0, y: 0, z: 0 };
  function closestOnTri(t, px, py, pz) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const bx = tris[o + 3], by = tris[o + 4], bz = tris[o + 5];
    const cx = tris[o + 6], cy = tris[o + 7], cz = tris[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz;
    const d2 = acx * apx + acy * apy + acz * apz;
    if (d1 <= 0 && d2 <= 0) { cp.x = ax; cp.y = ay; cp.z = az; return; }
    const bpx = px - bx, bpy = py - by, bpz = pz - bz;
    const d3 = abx * bpx + aby * bpy + abz * bpz;
    const d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { cp.x = bx; cp.y = by; cp.z = bz; return; }
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      const v = d1 / (d1 - d3);
      cp.x = ax + abx * v; cp.y = ay + aby * v; cp.z = az + abz * v; return;
    }
    const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
    const d5 = abx * cpx + aby * cpy + abz * cpz;
    const d6 = acx * cpx + acy * cpy + acz * cpz;
    if (d6 >= 0 && d5 <= d6) { cp.x = cx; cp.y = cy; cp.z = cz; return; }
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      const w = d2 / (d2 - d6);
      cp.x = ax + acx * w; cp.y = ay + acy * w; cp.z = az + acz * w; return;
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      cp.x = bx + (cx - bx) * w; cp.y = by + (cy - by) * w; cp.z = bz + (cz - bz) * w; return;
    }
    const den = 1 / (va + vb + vc);
    const v = vb * den, w = vc * den;
    cp.x = ax + abx * v + acx * w; cp.y = ay + aby * v + acy * w; cp.z = az + abz * v + acz * w;
  }

  // Geometric normal of triangle t, unit length, in the winding's own sense.
  function triNormal(t, out) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const ux = tris[o + 3] - ax, uy = tris[o + 4] - ay, uz = tris[o + 5] - az;
    const vx = tris[o + 6] - ax, vy = tris[o + 7] - ay, vz = tris[o + 8] - az;
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    if (l < 1e-12) { out.x = 0; out.y = 1; out.z = 0; return false; }
    out.x = x / l; out.y = y / l; out.z = z / l;
    return true;
  }
  const tn = { x: 0, y: 1, z: 0 };

  // The nearest collidable face within `r` of (x, y, z), restricted to faces
  // whose |ny| is below `maxAbsNy`. Returns the shared record or null:
  //
  //   dist            distance to the surface
  //   nx, ny, nz      THE WAY OUT — unit, from the surface towards the point
  //   fnx, fny, fnz   the face's own geometric normal (unsigned by position)
  //   cx, cy, cz      the closest point on the face
  //   cls, mesh, tri  what it is made of, what it is called, which triangle
  //
  // Live object, exactly like `raycast`'s: copy what you need to keep.
  function nearestFace(x, y, z, r, maxAbsNy = 1) {
    const i0 = Math.max(0, Math.floor((x - r - x0) / cell));
    const i1 = Math.min(nx - 1, Math.floor((x + r - x0) / cell));
    const j0 = Math.max(0, Math.floor((z - r - z0) / cell));
    const j1 = Math.min(nz - 1, Math.floor((z + r - z0) / cell));
    if (i1 < i0 || j1 < j0) return null;
    stampGen++;
    const r2 = r * r;
    let bd2 = r2, bt = -1, bx = 0, by = 0, bz = 0;
    for (let j = j0; j <= j1; j++) {
      const row = j * nx;
      for (let i = i0; i <= i1; i++) {
        const c = row + i;
        const a = start[c], b = start[c + 1];
        for (let k = a; k < b; k++) {
          const t = items[k];
          if (stamp[t] === stampGen) continue;
          stamp[t] = stampGen;
          if (maxAbsNy < 1) {
            if (!triNormal(t, tn)) continue;
            if (Math.abs(tn.y) >= maxAbsNy) continue;
          }
          closestOnTri(t, x, y, z);
          const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd2) { bd2 = d2; bt = t; bx = cp.x; by = cp.y; bz = cp.z; }
        }
      }
    }
    if (bt < 0) return null;
    const d = Math.sqrt(bd2);
    nf.dist = d; nf.cx = bx; nf.cy = by; nf.cz = bz;
    nf.tri = bt; nf.cls = cls[bt]; nf.mesh = meshNames[mid[bt]] || '';
    triNormal(bt, tn);
    nf.fnx = tn.x; nf.fny = tn.y; nf.fnz = tn.z;
    if (d > 1e-6) { nf.nx = (x - bx) / d; nf.ny = (y - by) / d; nf.nz = (z - bz) / d; }
    else {
      // dead on the plane: no separating direction exists, so fall back to the
      // face's own normal. Either sign is as good as the other here.
      nf.nx = tn.x; nf.ny = tn.y; nf.nz = tn.z;
    }
    return nf;
  }

  const api = {
    groundAt, groundNormalY, groundNormal, groundClass, groundMesh, raycast,
    // physics/no-snag §2a — the unsigned half of the same soup. See the comment
    // at the definition: this is the query depenetration needs and a ray cannot
    // answer, and it is the only thing in this file that can tell a body it is
    // INSIDE something rather than looking at it.
    nearestFace,
    // specs/0018 §1 — the harvest ledger: what the traversal saw, what it ate,
    // and as what. Tooling only; the player never reads it.
    meshTable: () => ledger.map((r) => ({ ...r, byClass: { ...r.byClass } })),
    // the class of any triangle, by index — for tooling that wants to audit the
    // soup rather than stand on it
    classOf: (t) => (t >= 0 && t < nTri ? cls[t] : -1),
    meshOf: (t) => (t >= 0 && t < nTri ? (meshNames[mid[t]] || '') : ''),
    // ---- tree stems (solids.js). Forwarded, not reimplemented: the controller
    // already holds a `collision`, and handing it a second object to carry would
    // buy nothing. `unit` is main.js's unitScale.
    stemHit: (x, y, z, bodyR, unit) => stems.stemHit(x, y, z, bodyR, unit),
    // specs/0051 D-20 — the whole stand, for the multi-trunk resolver. Same
    // walk as `stemHit`, every overlap instead of the deepest; `out` is the
    // caller's reused array so the hot path allocates nothing.
    stemContacts: (x, y, z, bodyR, unit, out, max) => stems.stemContacts(x, y, z, bodyR, unit, out, max),
    stemProbe: (i, x, y, z, bodyR, unit, out) => stems.stemProbe(i, x, y, z, bodyR, unit, out),
    stemClear: (x, y, z, bodyR, unit) => stems.stemClear(x, y, z, bodyR, unit),
    stemSegment: (ax, ay, az, bx, by, bz, r) => stems.hitSegment(ax, ay, az, bx, by, bz, r),
    stemAt: (i) => stems.stemAt(i),
    // specs/0012 §E2 — the soft half of the same hash. Returns the stem index
    // of the foliage the point is inside, or -1.
    canopyIn: (x, y, z, unit) => stems.canopyIn(x, y, z, unit),
    // ...and §E3's rustle + snow fall (canopy.js). The controller calls
    // `.hit(i, x, y, z)` on entry and `.update(dt)` once a step.
    canopyFx,
    stems,
    inBounds: (x, z) => cellOf(x, z) >= 0,
    bounds: { x0, z0, x1: x0 + nx * cell, z1: z0 + nz * cell, minY, maxY },
    // specs/0051 §3.4 — THE SOUP, for the router and for tooling. One harvest of
    // the scene, shared by reference: every per-tile CSR the router builds
    // indexes INTO these arrays and copies none of them, which is why per-tile
    // collision costs a prefix array per tile and not a second triangle soup.
    // Read-only by convention. `hitTri` is exported with it so a tile grid does
    // not reimplement Möller–Trumbore against the same vertices.
    soup: {
      tris, cls, mid, meshNames, meshIsTerrain, start, items, nx, nz, cell, x0, z0, nTri,
      isTerrainTri: (t) => meshIsTerrain[mid[t]] === 1,
      terrainTriangles: nTerrainTri, propTriangles: nPropTri,
      hitTri, scratch,
    },
    stats: {
      triangles: nTri, cellEntries: nEntries, cells: nCells, cell,
      terrainTriangles: nTerrainTri, propTriangles: nPropTri,
      meshesUsed, meshesSkipped, skippedOversize, skippedOutside,
      rockMeshes: nRockMesh, rockTriangles: nRockTri,
      // specs/0018 — [snow, rock, building, tower, person, bench]
      classTriangles: nClsTri.slice(),
      // specs/0051 D-19 — the LIVE count, not the slot high-water: streamed
      // tile trunks come and go through `addLive`/`removeAt`, so `n` is the
      // arrays' watermark and `live` is how many trees are solid right now.
      get stems() { return stems.live; },
      stemSlots: stems.n, stemMs: Math.round(stems.ms),
      meshNames: meshNames.length - 1,
      bytes: nTri * 39 + nEntries * 4,   // +2/tri for the mesh index (specs/0020)
    },
  };
  // Lab handle. The player's own test surface (`window.__player`) is built in
  // main.js and cannot reach in here; a gate that wants to ask "what is the
  // ground made of at (x, z)" — or to price the soup — needs the object itself.
  // Read-only by convention, exactly like window.__playerDebug.
  try { if (typeof window !== 'undefined') window.__playCollision = api; } catch { /* not a browser */ }
  return api;
}
