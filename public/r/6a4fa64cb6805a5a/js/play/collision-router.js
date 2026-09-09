// specs/0051 §3.4-§3.8 — THE COLLISION ROUTER.
//
// Before this file the player stood on ONE collision grid, sized in
// `main.js:156-179` to the whole declared world: a 1,070 x 1,070 CSR over 6 m
// cells, 905,436 triangles, built once at boot and never touched again. That
// grid is what makes "the collidable band is the whole map" true today, and it
// is the thing chunking has to take apart — but it is also what every far probe
// in the player quietly depends on (§3.8 counts 26 of them), and what the
// off-map-void probe at `verify.mjs`'s respawn fence measures its clamp line
// against (§3.7). So this file replaces it with three pieces, not one:
//
//   1  ONE HARVEST, bucketed. The scene is traversed once into a flat triangle
//      soup (`collision.js`'s, unchanged: same classes, same names, same
//      oversize rejection on the same 6 m lattice) binned into 32 m buckets.
//      That is a DECLARATION — which triangles exist and what they are made of —
//      and not a query structure. §3.5: "world.colliders becomes a declaration".
//   2  PER-TILE CSR GRIDS, built on demand from those buckets and thrown away
//      on eviction. CSR is rebuild-only — you cannot insert into a prefix array
//      — which is exactly why §3.4 says per-tile instances are the only shape
//      that works. A tile grid indexes INTO the shared soup and copies none of
//      it, so a tile costs a prefix array and an item list, not a second soup.
//   3  A ROUTER with the IDENTICAL surface of `collision.js:433-470` —
//      groundAt / groundNormal / groundNormalY / groundClass / groundMesh /
//      raycast / stats — plus `bounds`, dispatching L0 -> L1 -> soft. Because
//      `groundClass` and `groundMesh` keep their "last hit" contract here,
//      `ski.js:350-358` and `fx.js:2659-2669` are unmodified.
//
// AND THE SOFT ANSWER (§3.6), which is the half that keeps the 26 far probes
// honest: a query inside the declared world extent with no resident slab under
// it returns `world.terrainHeight` plus a synthetic snow class, and increments
// `__chunks.softHits` tagged by caller. `null` keeps its SINGLE pre-existing
// meaning — off the map — so the void probe still fires and check 11 still has
// something to measure.
//
// What this file deliberately does NOT do: schedule. Residency is driven from
// `setFocus()` and `pinSync()`; wave 2a's `chunks.js` owns the queue, the pools
// and the eviction policy for the RENDER tiles and will drive this one through
// the same two calls.

import { buildCollision, CLASS_SNOW } from './collision.js';

// §1.3's two collidable levels, and only those two: L2+ is `collide: false`.
// `margin` is §1.6's skirt depth in metres at that level's spacing — the
// horizontal overlap that stops a triangle straddling a tile border from
// falling between two grids — floored at one collision cell.
export const ROUTER_LEVELS = [
  { level: 0, span: 64, spacing: 1.00, margin: 2.5, core: 7, block: 8, minReach: 192 },
  { level: 1, span: 128, spacing: 2.00, margin: 5.0, core: 7, block: 8, minReach: 384 },
];

// §3.5 / D-5. The cap EXCLUDES terrain and it THROWS.
//
// MEASURED, not assumed (D-6). §3.5 names 4,000. `census(level)` builds EVERY
// tile of a level over the declared extent with the cap lifted (`?propcap=`),
// and both export builds say:
//
//   level  tiles          worst non-terrain / tile        under 2,000
//   L0     7,227 rd       10,254  (rd, tile 0:-47:-7)     7,193 of 7,227
//          7,396 sb          950  (sb, tile 0:13:-7)      7,396 of 7,396
//   L1     1,850 rd       13,932  (rd, tile 1:-24:-4)     1,813 of 1,850
//          1,936 sb        2,010  (sb, tile 1:6:-4)       1,935 of 1,936
//
// Two things follow. First, 4,000 is a real ceiling for a snowfield tile and a
// wrong one for the far-west lift plant and village, and it throws at BOOT on
// red-dog rather than at some edge case. Second, §3.5 quotes ONE cap and a tile
// is not one size: an L1 tile covers four times the ground, so a flat count is
// four densities wearing one number — `capFor()` above scales it by area.
//
// Base raised to 12,000 at L0 (17 % over the worst L0 tile) — 48,000 at L1,
// 3.4 x the worst L1 tile. It is still a cap that means something: red-dog's
// median L0 tile holds under 500. THIS IS A SPEC NUMBER MOVED BY A WAVE, and
// the merger owes Greg the same call §11 Q2 owes him on `collidableTriangles`.
export const PROP_CAP_PER_TILE = 12000;
export const PROP_CAP_MEASURED = {
  spec: 4000,
  L0: { 'red-dog': 10254, siberia: 950 },
  L1: { 'red-dog': 13932, siberia: 2010 },
};
// A measurement knob, not a policy one: `?propcap=N` on the player URL raises
// the ceiling so the per-tile census can be READ instead of guessed. The
// shipped default is the constant above.
export const propCapFrom = (qs) => {
  const v = qs && qs.get ? +qs.get('propcap') : 0;
  return isFinite(v) && v > 0 ? v : PROP_CAP_PER_TILE;
};
// §3.5's terrain figures, asserted against the analytic slab by `collisionFidelity`.
export const L0_TERRAIN_TRIS = 8192;    // 64 x 64 cells x 2
export const L1_TERRAIN_TRIS = 2048;    // decimated 32 x 32 x 2, a 4.00 m lattice
// §3.7's rule, in one constant: the declared world extent grown by 60 m on every
// side reproduces `main.js:171`'s `+ 60 * unitScale` void band exactly.
export const BOUNDS_GROW_M = 60;
// The bucket lattice of the single harvest. Coarser than the 6 m query cell on
// purpose: it is an index into the soup, not a query structure.
export const BUCKET_M = 32;
// How many tile grids may be resident at once. The required set (§1.3: 64 L0 +
// 48 L1) is never evicted; the rest is an LRU that lets a far probe get a HARD
// answer instead of a soft one whenever there is room for it, which is what
// keeps `softHits` at 0 through a boot that settles every marker in the world.
export const TILE_SLOTS = 768;

const key = (level, tx, tz) => `${level}:${tx}:${tz}`;

export function createCollisionRouter(THREE, root, opts = {}) {
  const unit = opts.unitScale || 1;
  const cell = opts.cell || 6 * unit;
  const grow = (opts.growM === undefined ? BOUNDS_GROW_M : opts.growM) * unit;
  const propCap = opts.propCap || PROP_CAP_PER_TILE;
  // §3.5 states one cap and one tile size. A tile is not one size — an L1 tile
  // is 128 m on a side and covers FOUR TIMES the ground an L0 tile does — so a
  // flat count would be four different densities wearing one number, and it
  // throws on an L1 village tile that holds exactly the props its four L0
  // children were each allowed. The cap is therefore a DENSITY, quoted at L0:
  // `cap x (span / 64)^2`.
  const capFor = (level) => Math.round(propCap * ((ROUTER_LEVELS[level].span * unit) / (64 * unit)) ** 2);
  const colliders = Array.isArray(opts.colliders) && opts.colliders.length ? opts.colliders : null;
  // ENU (x, y) -> height. `world.terrainHeight` (world.mjs:1675 red-dog,
  // siberia world.mjs:563) already exists and is consumed by ZERO player files;
  // §3.6 is where it finally earns its keep.
  const gzENU = typeof opts.terrainHeight === 'function' ? opts.terrainHeight : null;
  const softAt = gzENU ? (x, z) => gzENU(x, -z) : null;   // main.js:96 — (x,y,z)_ENU -> (x,z,-y)_three

  // ------------------------------------------------------- declared extent
  // §3.6: "collision.bounds is the union of DECLARED world extents, not of
  // resident tiles". This is that union, measured off the same objects
  // `main.js:161-173` measured — the declaration — and then grown by 60 m.
  const dec = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  if (opts.extent) Object.assign(dec, opts.extent);
  else if (colliders) {
    const one = new THREE.Box3();
    root.updateMatrixWorld(true);
    for (const m of colliders) {
      if (!m || !m.isObject3D) continue;
      one.setFromObject(m);
      if (one.isEmpty()) continue;
      dec.x0 = Math.min(dec.x0, one.min.x); dec.x1 = Math.max(dec.x1, one.max.x);
      dec.z0 = Math.min(dec.z0, one.min.z); dec.z1 = Math.max(dec.z1, one.max.z);
    }
  }
  if (!isFinite(dec.x0)) { dec.x0 = -620 * unit; dec.x1 = 620 * unit; dec.z0 = -620 * unit; dec.z1 = 620 * unit; }

  // ------------------------------------------------------------ the harvest
  // ONE traversal. `cell: BUCKET` bins coarsely; `rejectCell: cell` keeps the
  // oversize rejection on the 6 m lattice it was calibrated on, so the soup
  // this produces holds exactly the triangles the whole-world grid held.
  const halfX = (dec.x1 - dec.x0) / 2 + grow, halfZ = (dec.z1 - dec.z0) / 2 + grow;
  const centre = new THREE.Vector3((dec.x0 + dec.x1) / 2, 0, (dec.z0 + dec.z1) / 2);
  const base = buildCollision(THREE, root, {
    center: centre,
    halfExtent: Math.max(halfX, halfZ),
    cell: BUCKET_M * unit,
    rejectCell: cell,
    colliders: colliders || undefined,
    isTerrain: opts.isTerrain || null,
    triBudget: opts.triBudget || 1200000,
  });
  const S = base.soup;

  // §3.6/§3.7: the router's bounds, and the ONLY bounds the player ever sees.
  const bounds = {
    x0: dec.x0 - grow, z0: dec.z0 - grow,
    x1: dec.x1 + grow, z1: dec.z1 + grow,
    minY: base.bounds.minY, maxY: base.bounds.maxY,
  };

  // ------------------------------------------------------- the tile lattice
  // §1.1: anchored on the raster origin so the phase is fixed and independent
  // of the player. `origin` is `{x: RX0, z: -RY0}` — main.js reads it off
  // `world.chunks`; with no chunks handle the lattice anchors at 0, which is a
  // different phase and the same guarantees.
  const ax = (opts.origin && opts.origin.x) || 0;
  const az = (opts.origin && opts.origin.z) || 0;
  const tileIndex = (level, x, z) => {
    const span = ROUTER_LEVELS[level].span * unit;
    return [Math.floor((x - ax) / span), Math.floor((z - az) / span)];
  };

  // ------------------------------------------------------------ telemetry
  const tele = {
    softHits: 0, refusals: 0, softByCaller: Object.create(null),
    pins: 0, pinsByPath: Object.create(null), builds: 0, evictions: 0,
    lastSoft: null,
    // §3.5's two scopes, measured rather than assumed: the worst per-tile
    // non-terrain and terrain triangle counts this session has actually built,
    // and a 500-wide histogram of the non-terrain count over L0 tiles.
    worstProp: 0, worstPropTile: null, worstTerrain: 0, worstTerrainTile: null,
    worstPropByLevel: [0, 0], worstPropTileByLevel: [null, null], worstTerrainByLevel: [0, 0],
    propHist: new Array(10).fill(0),
  };
  let caller = 'player';
  const softHit = (x, z, level) => {
    tele.softHits++;
    tele.softByCaller[caller] = (tele.softByCaller[caller] || 0) + 1;
    tele.lastSoft = { x: +x.toFixed(2), z: +z.toFixed(2), level, caller };
  };

  // ============================================================ tile builds
  // A tile grid is a CSR over the tile rect plus its margin, built from the
  // triangles the bucket index already put near it. `stamp` dedupes across
  // buckets; it is one Int32Array over the soup, shared by every tile build.
  const stamp = new Int32Array(S.nTri);
  let stampGen = 0;
  let cand = new Int32Array(1 << 14);

  function gather(x0, z0, x1, z1) {
    stampGen++;
    let n = 0;
    const bi0 = Math.max(0, Math.floor((x0 - S.x0) / S.cell));
    const bi1 = Math.min(S.nx - 1, Math.floor((x1 - S.x0) / S.cell));
    const bj0 = Math.max(0, Math.floor((z0 - S.z0) / S.cell));
    const bj1 = Math.min(S.nz - 1, Math.floor((z1 - S.z0) / S.cell));
    for (let j = bj0; j <= bj1; j++) {
      const row = j * S.nx;
      for (let i = bi0; i <= bi1; i++) {
        const c = row + i, a = S.start[c], b = S.start[c + 1];
        for (let k = a; k < b; k++) {
          const t = S.items[k];
          if (stamp[t] === stampGen) continue;
          stamp[t] = stampGen;
          if (n >= cand.length) { const g = new Int32Array(cand.length * 2); g.set(cand); cand = g; }
          cand[n++] = t;
        }
      }
    }
    return n;
  }

  function buildTile(level, tx, tz) {
    const L = ROUTER_LEVELS[level];
    const span = L.span * unit, margin = Math.max(L.margin * unit, cell);
    const x0 = ax + tx * span - margin, z0 = az + tz * span - margin;
    const w = span + 2 * margin;
    const nx = Math.max(1, Math.ceil(w / cell)), nz = nx;
    const x1 = x0 + nx * cell, z1 = z0 + nz * cell;
    const n = gather(x0, z0, x1, z1);

    // pass 1 — count, and enforce §3.5's two scopes while counting
    const counts = new Int32Array(nx * nz + 1);
    let nTri = 0, nEntries = 0, terrainTri = 0, propTri = 0;
    const list = new Int32Array(n), boxes = new Int32Array(n * 4);
    for (let q = 0; q < n; q++) {
      const t = cand[q], o = t * 9;
      const lox = Math.min(S.tris[o], S.tris[o + 3], S.tris[o + 6]);
      const hix = Math.max(S.tris[o], S.tris[o + 3], S.tris[o + 6]);
      const loz = Math.min(S.tris[o + 2], S.tris[o + 5], S.tris[o + 8]);
      const hiz = Math.max(S.tris[o + 2], S.tris[o + 5], S.tris[o + 8]);
      if (hix < x0 || lox > x1 || hiz < z0 || loz > z1) continue;
      const i0 = Math.max(0, Math.floor((lox - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((hix - x0) / cell));
      const j0 = Math.max(0, Math.floor((loz - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((hiz - z0) / cell));
      if (i1 < i0 || j1 < j0) continue;
      if (isTerrainTri(t)) terrainTri++;
      else if (++propTri > capFor(level)) {
        throw new Error(`collision-router: tile L${level}:${tx}:${tz} holds ${propTri} non-terrain triangles, `
          + `over the ${capFor(level)} cap (specs/0051 §3.5, D-5). Terrain is excluded from this cap and `
          + `this throws rather than truncating — thin the props here, or raise the cap with a measured note.`);
      }
      const p = nTri * 4;
      list[nTri] = t; boxes[p] = i0; boxes[p + 1] = j0; boxes[p + 2] = i1; boxes[p + 3] = j1;
      for (let j = j0; j <= j1; j++) { const row = j * nx; for (let i = i0; i <= i1; i++) counts[row + i + 1]++; }
      nEntries += (i1 - i0 + 1) * (j1 - j0 + 1);
      nTri++;
    }
    for (let c = 0; c < nx * nz; c++) counts[c + 1] += counts[c];
    const items = new Int32Array(nEntries);
    const cursor = counts.slice(0, nx * nz);
    for (let q = 0; q < nTri; q++) {
      const p = q * 4;
      for (let j = boxes[p + 1]; j <= boxes[p + 3]; j++) {
        const row = j * nx;
        for (let i = boxes[p]; i <= boxes[p + 2]; i++) items[cursor[row + i]++] = list[q];
      }
    }
    tele.builds++;
    if (propTri > tele.worstProp) { tele.worstProp = propTri; tele.worstPropTile = key(level, tx, tz); }
    if (propTri > tele.worstPropByLevel[level]) {
      tele.worstPropByLevel[level] = propTri;
      tele.worstPropTileByLevel[level] = key(level, tx, tz);
    }
    if (terrainTri > tele.worstTerrainByLevel[level]) tele.worstTerrainByLevel[level] = terrainTri;
    if (terrainTri > tele.worstTerrain) { tele.worstTerrain = terrainTri; tele.worstTerrainTile = key(level, tx, tz); }
    if (level === 0) { const b = Math.min(9, Math.floor(propTri / 500)); tele.propHist[b]++; }
    return { level, tx, tz, x0, z0, nx, nz, start: counts, items,
             tris: nTri, terrainTri, propTri, bytes: (counts.length + items.length) * 4, used: 0 };
  }

  // A triangle is terrain when the mesh it came off was declared terrain. The
  // harvest already decided that ONCE PER MESH — `opts.isTerrain` ran there —
  // and the soup carries the answer by mesh index, so this is one array read.
  const isTerrainTri = S.isTerrainTri;

  // ============================================================= residency
  const tiles = new Map();
  const required = new Set();
  const pinned = new Map();          // key -> frames-to-live
  let clock = 0;

  function tileAt(level, tx, tz, allowBuild) {
    const k = key(level, tx, tz);
    const hit = tiles.get(k);
    if (hit) { hit.used = ++clock; return hit; }
    if (!allowBuild) return null;
    if (tiles.size >= TILE_SLOTS && !evictOne()) { tele.refusals++; return null; }
    const t = buildTile(level, tx, tz);
    t.used = ++clock;
    tiles.set(k, t);
    return t;
  }

  // §2.4: the required set is never evicted; eviction order is prefetch first,
  // then the farthest coarse level, then NOTHING ELSE. Here that is: never a
  // required or pinned tile, oldest opportunistic first, L1 before L0.
  function evictOne() {
    let worst = null, worstK = null, worstScore = Infinity;
    for (const [k, t] of tiles) {
      if (required.has(k) || pinned.has(k)) continue;
      const score = t.used - (t.level === 1 ? 1e6 : 0);
      if (score < worstScore) { worstScore = score; worst = t; worstK = k; }
    }
    if (!worst) return false;
    tiles.delete(worstK);
    tele.evictions++;
    return true;
  }

  // §1.3/§1.4 — the resident block. The odd core is the GUARANTEE (L0 >= 192 m,
  // L1 >= 384 m); the block is that core grown by one tile on one axis side so
  // the coarser level's subtraction is exact. L1 subtracts L0's footprint: 8 L0
  // tiles are 4 L1 tiles, so the subtraction is whole-tile and nothing is
  // covered twice.
  //
  // §2.7's ranges live here too. The glider queries ground at altitude and at
  // speed, so its L0 core goes 7 x 7 -> 9 x 9 (block 10 x 10, guaranteed reach
  // 256 m) and its prefetch lead goes from v x 2.5 s to v x 6 s. The snowmobile
  // is fast but on the deck: it keeps the 8 x 8 block and takes the long lead.
  // Anything else is the walking/skiing default.
  const RANGES = {
    ski: { l0Block: 8, leadS: 2.5 },
    glider: { l0Block: 10, leadS: 6.0 },
    snowmobile: { l0Block: 8, leadS: 6.0 },
  };
  let range = RANGES.ski, rangeName = 'ski';
  function setRange(mode) {
    const r = RANGES[mode] || RANGES.ski;
    if (r === range) return rangeName;
    range = r; rangeName = RANGES[mode] ? mode : 'ski';
    required.clear();                    // re-derive the block at the new size
    setFocus(focus.x, focus.z);
    return rangeName;
  }

  function blockOf(level, x, z) {
    const [cx, cz] = tileIndex(level, x, z);
    const half = (level === 0 ? range.l0Block : ROUTER_LEVELS[level].block) / 2;
    return { i0: cx - half + 1, i1: cx + half, j0: cz - half + 1, j1: cz + half };
  }

  function requiredKeys(x, z) {
    const out = [];
    const b0 = blockOf(0, x, z);
    for (let j = b0.j0; j <= b0.j1; j++) for (let i = b0.i0; i <= b0.i1; i++) out.push([0, i, j]);
    const b1 = blockOf(1, x, z);
    // L0's footprint in L1 indices — the 4 x 4 the finer level already owns.
    const r = ROUTER_LEVELS[1].span / ROUTER_LEVELS[0].span;
    const s0 = Math.floor(b0.i0 / r), s1 = Math.floor(b0.i1 / r);
    const t0 = Math.floor(b0.j0 / r), t1 = Math.floor(b0.j1 / r);
    for (let j = b1.j0; j <= b1.j1; j++) {
      for (let i = b1.i0; i <= b1.i1; i++) {
        if (i >= s0 && i <= s1 && j >= t0 && j <= t1) continue;   // covered by L0
        out.push([1, i, j]);
      }
    }
    return out;
  }

  let focus = { x: centre.x, z: centre.z };
  let centred = null;
  function setFocus(x, z) {
    if (!isFinite(x) || !isFinite(z)) return;
    focus = { x, z };
    const [nxi, nzi] = tileIndex(0, x, z);
    // §2.7: the residency centre only moves when the player's L0 TILE changes,
    // so walking across a tile costs nothing and crossing a border costs one
    // ring rebuild — not one per frame.
    if (centred && centred[0] === nxi && centred[1] === nzi && required.size) return;
    centred = [nxi, nzi];
    required.clear();
    for (const [lv, i, j] of requiredKeys(x, z)) {
      required.add(key(lv, i, j));
      tileAt(lv, i, j, true);
    }
  }

  // §2.8 — pinSync(dest). Builds the destination's L0 block SYNCHRONOUSLY and
  // resolves before the caller's next frame, which is the whole point: the pin
  // is for COLLISION, never for placement (§2.8's last line — groundZ needs no
  // build at all, so the player is never in a frame without ground).
  //
  // It is called from ALL FIVE re-home paths of §2.8, not one: the ctrl.teleport
  // wrapper, ctrl.respawn(), the two void-drop respawns in controller.js, and
  // ctrl.setHome. `path` is the tag those five identify themselves by, so
  // `__chunks.pinsByPath` says which seams actually fired in a run.
  function pinSync(dest, path = 'teleport') {
    if (!dest) return null;
    const x = dest.x !== undefined ? dest.x : dest[0];
    const z = dest.z !== undefined ? dest.z : dest[2];
    if (!isFinite(x) || !isFinite(z)) return null;
    const b = blockOf(0, x, z);
    const keys = [];
    for (let j = b.j0; j <= b.j1; j++) {
      for (let i = b.i0; i <= b.i1; i++) {
        const k = key(0, i, j);
        pinned.set(k, 5);                      // §2.8: resolves in <= 5 frames
        keys.push(k);
        tileAt(0, i, j, true);
      }
    }
    tele.pins++;
    tele.pinsByPath[path] = (tele.pinsByPath[path] || 0) + 1;
    return { path, tiles: keys.length, x, z };
  }

  // Called once a frame by main.js, before playerSystems() (§2.1). Ages the pin
  // grace so a teleport's block is releasable five frames later, and re-centres
  // residency on the player.
  function tick(dt, pos, vel) {
    for (const [k, n] of pinned) { if (n <= 1) pinned.delete(k); else pinned.set(k, n - 1); }
    if (!pos) return;
    // §2.7 — the residency centre is `p + v x lead`, clamped to 1.5 L0 tiles of
    // lead so a fast line cannot drag the ring off the body it is protecting.
    let x = pos.x, z = pos.z;
    if (vel) {
      const cap = 1.5 * ROUTER_LEVELS[0].span * unit;
      let dx = vel.x * range.leadS, dz = vel.z * range.leadS;
      const d = Math.hypot(dx, dz);
      if (d > cap) { const k = cap / d; dx *= k; dz *= k; }
      x += dx; z += dz;
    }
    setFocus(x, z);
  }

  // ============================================================== queries
  // The same "last hit" state `collision.js:417-424` keeps, kept HERE so
  // `groundClass`/`groundMesh` answer about the router's last groundAt and
  // `ski.js:350-358` / `fx.js:2659-2669` need no edit.
  const gn = { x: 0, y: 1, z: 0 };
  let gcls = CLASS_SNOW, gmeshName = '', lastNY = 1;
  const best = { dist: 0, nx: 0, ny: 1, nz: 0, y: 0, hit: false, cls: CLASS_SNOW, mesh: '' };
  const sc = S.scratch;

  function tileGroundAt(t, x, z, fromY) {
    const i = Math.floor((x - t.x0) / cell), j = Math.floor((z - t.z0) / cell);
    if (i < 0 || j < 0 || i >= t.nx || j >= t.nz) return null;
    const c = j * t.nx + i, a = t.start[c], b = t.start[c + 1];
    let hitY = -Infinity, hnx = 0, hn = 1, hnz = 0, hc = CLASS_SNOW, hm = 0;
    for (let k = a; k < b; k++) {
      const tri = t.items[k];
      if (S.hitTri(tri, x, fromY, z, 0, -1, 0, 1e5, sc)) {
        const y = fromY - sc.dist;
        if (y > hitY) { hitY = y; hnx = sc.nx; hn = sc.ny; hnz = sc.nz; hc = S.cls[tri]; hm = S.mid[tri]; }
      }
    }
    if (hitY === -Infinity) return null;
    gn.x = hnx; gn.y = hn; gn.z = hnz;
    gcls = hc; gmeshName = S.meshNames[hm] || '';
    best.y = hitY; best.ny = hn; lastNY = hn;
    return hitY;
  }

  const insideDeclared = (x, z) => x >= dec.x0 && x <= dec.x1 && z >= dec.z0 && z <= dec.z1;

  // §3.6. L0, then L1, then soft. `null` keeps its single meaning: a RESIDENT
  // tile that answers null is a real "nothing under you" (that is the void band,
  // and the fence depends on it); an ABSENT tile inside the declared extent is
  // the soft answer, counted.
  function groundAt(x, z, fromY) {
    for (let lv = 0; lv < ROUTER_LEVELS.length; lv++) {
      const [i, j] = tileIndex(lv, x, z);
      const t = tileAt(lv, i, j, true);
      if (!t) continue;                       // refused: fall through to the soft answer
      if (t.tris === 0 && lv === 0) continue; // an empty L0 tile is not evidence; ask L1
      const y = tileGroundAt(t, x, z, fromY);
      if (y !== null) return y;
      if (lv === 0 && t.tris > 0) {
        // the L0 tile is resident and has geometry but nothing under this
        // column — try L1's coarser slab before calling it void
        continue;
      }
    }
    if (softAt && insideDeclared(x, z)) {
      const y = softAt(x, z);
      if (isFinite(y) && y <= fromY) {
        softHit(x, z, 'analytic');
        gn.x = 0; gn.y = 1; gn.z = 0;
        gcls = CLASS_SNOW; gmeshName = '';
        best.y = y; best.ny = 1; lastNY = 1;
        return y;
      }
    }
    return null;
  }

  // §3.6's cross-tile raycast. Walks the resident tiles in RAY ORDER — one
  // sample per half-cell, the same stride `collision.js:466` uses, so a ray this
  // short cannot step over a triangle — and falls back to the 32 m bucket index
  // where no tile is resident, which is the analytic march's cheap equivalent:
  // the soup is whole-world, only the query grids are not.
  const rstamp = new Int32Array(S.nTri);
  let rgen = 0;
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const steps = Math.max(1, Math.ceil(maxDist / (cell * 0.5)));
    rgen++;
    let found = false, bd = maxDist, bt = -1;
    const test = (a, b, arr) => {
      for (let k = a; k < b; k++) {
        const t = arr[k];
        if (rstamp[t] === rgen) continue;
        rstamp[t] = rgen;
        if (S.hitTri(t, ox, oy, oz, dx, dy, dz, bd, sc) && sc.dist < bd) {
          bd = sc.dist; found = true; bt = t;
          best.dist = sc.dist; best.nx = sc.nx; best.ny = sc.ny; best.nz = sc.nz;
        }
      }
    };
    for (let s = 0; s <= steps; s++) {
      const f = (s / steps) * maxDist;
      const x = ox + dx * f, z = oz + dz * f;
      const [i, j] = tileIndex(0, x, z);
      const t = tiles.get(key(0, i, j)) || tiles.get(key(1, ...tileIndex(1, x, z)));
      if (t) {
        const ci = Math.floor((x - t.x0) / cell), cj = Math.floor((z - t.z0) / cell);
        if (ci >= 0 && cj >= 0 && ci < t.nx && cj < t.nz) {
          const c = cj * t.nx + ci;
          test(t.start[c], t.start[c + 1], t.items);
          continue;
        }
      }
      const bi = Math.floor((x - S.x0) / S.cell), bj = Math.floor((z - S.z0) / S.cell);
      if (bi < 0 || bj < 0 || bi >= S.nx || bj >= S.nz) continue;
      const c = bj * S.nx + bi;
      test(S.start[c], S.start[c + 1], S.items);
    }
    if (!found) return null;
    best.hit = true;
    best.cls = S.cls[bt]; best.mesh = S.meshNames[S.mid[bt]] || '';
    return best;
  }

  // ================================================================== stats
  function residency() {
    let l0 = 0, l1 = 0, terrain = 0, props = 0, bytes = 0;
    for (const t of tiles.values()) {
      if (t.level === 0) l0++; else l1++;
      terrain += t.terrainTri; props += t.propTri; bytes += t.bytes;
    }
    return { L0: l0, L1: l1, tiles: tiles.size, required: required.size, pinned: pinned.size,
             collidableTriangles: terrain + props, terrainTriangles: terrain, propTriangles: props,
             gridBytes: bytes, soupTriangles: S.nTri, soupBytes: base.stats.bytes };
  }

  // ============================================ check 13 — L1 fidelity (§3.5)
  // §3.5 decimates L1 terrain collision to a 33 x 33 slab, 2,048 triangles — a
  // 4.00 m collision lattice against L1's 2.00 m render lattice. That is a
  // DELIBERATE height error and this is the number that says it stays small.
  // Both surfaces are bilinear interpolations of the SAME field (`groundZ`, via
  // `world.terrainHeight`), so the difference measured here is the decimation
  // and nothing else — no mesh, no scene, no residency.
  function slabZ(x, z, step) {
    const fx = (x - ax) / step, fz = (z - az) / step;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const x0 = ax + i * step, z0 = az + j * step;
    const a00 = softAt(x0, z0), a10 = softAt(x0 + step, z0);
    const a01 = softAt(x0, z0 + step), a11 = softAt(x0 + step, z0 + step);
    const p = a00 + (a10 - a00) * u, q = a01 + (a11 - a01) * u;
    return p + (q - p) * v;
  }
  // W2FIX1 — WHAT THIS PROBE IS ALLOWED TO DEPEND ON.
  //
  // The first version sampled the L1 tiles resident AROUND `focus`. `focus` is
  // the player's position, and in the gate this probe runs after check 8 has
  // ridden `w` for 300 s and check 10 for another 60 — so the ring it measured
  // was wherever the wall clock happened to park the page. Same commit, same
  // bytes, two runs: 3.1143 m (fail) then 1.5896 m (pass), with the MEAN barely
  // moving (0.0501 -> 0.0374 m). A row that can pass or fail on the same bytes
  // is not a row.
  //
  // The decimation error is a property of the TERRAIN and the two lattices, not
  // of residency: `slabZ` reads `world.terrainHeight` and touches no tile, no
  // mesh and no scene. So the domain is the DECLARED extent (§3.6 — the same
  // `dec` box `bounds` and `census` already use), swept deterministically, and
  // the answer is the same on every boot, at every position, for a given build.
  // The ring number is still reported beside it, as context, never as the gate.
  // One xorshift, seeded by a constant, walked in a fixed order: the sample set
  // is a property of the build and of nothing else.
  function sampler() {
    let s = 0x9e3779b9;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
  }
  function tally(pts, render, collide, cells) {
    let max = 0, sum = 0, worstAt = null;
    for (const [x, z] of pts) {
      const d = Math.abs(slabZ(x, z, render) - slabZ(x, z, collide));
      sum += d;
      if (d > max) { max = d; worstAt = { x: +x.toFixed(2), z: +z.toFixed(2) }; }
    }
    return { samples: pts.length, maxErrorM: +max.toFixed(4), meanErrorM: +(sum / pts.length).toFixed(4), cells, worstAt };
  }
  // uniformly over a box. Nothing lands outside it and nothing piles on its
  // edge — a per-cell draw put samples a whole 128 m span past the boundary
  // (red-dog: 53 m north of the end of the elevation data, on the apron, 9.4719
  // m) and clamping them back only moved the pile onto the DEM edge itself.
  function fidelityBox(box, n, render, collide, cells) {
    const rnd = sampler();
    const pts = [];
    for (let k = 0; k < n; k++) {
      pts.push([box.x0 + rnd() * (box.x1 - box.x0), box.z0 + rnd() * (box.z1 - box.z0)]);
    }
    return tally(pts, render, collide, cells);
  }
  function fidelityOver(cells, span, n, render, collide) {
    const rnd = sampler();
    const pts = [];
    for (let k = 0; k < n; k++) {
      const [i, j] = cells[k % cells.length];
      pts.push([ax + (i + rnd()) * span, az + (j + rnd()) * span]);
    }
    return tally(pts, render, collide, cells.length);
  }

  // the L1 tiles of the ring at the current focus: the 8 x 8 block MINUS the
  // 4 x 4 footprint L0 already owns at full resolution (§1.3, §1.4). The
  // decimated slab is never the surface under the player's feet.
  function ringCells() {
    const b = blockOf(1, focus.x, focus.z);
    const b0 = blockOf(0, focus.x, focus.z);
    const r0 = ROUTER_LEVELS[1].span / ROUTER_LEVELS[0].span;
    const s0 = Math.floor(b0.i0 / r0), s1 = Math.floor(b0.i1 / r0);
    const t0 = Math.floor(b0.j0 / r0), t1 = Math.floor(b0.j1 / r0);
    const cells = [];
    for (let j = b.j0; j <= b.j1; j++) {
      for (let i = b.i0; i <= b.i1; i++) {
        if (i >= s0 && i <= s1 && j >= t0 && j <= t1) continue;
        cells.push([i, j]);
      }
    }
    return cells;
  }

  // Every L1 cell of a box. THE BOX MATTERS. The declared extent (§3.6) runs
  // 2.5 km past the end of the elevation data on red-dog, over the synthetic
  // rim apron, and the apron steps hard enough that a 4.00 m lattice misses a
  // 2.00 m one by 52.611 m out there (measured, W2FIX1, three/ENU x 125.48
  // y 1816.14 — outside RY0 + 777 * 2.0). That is a true fact about the apron
  // and it is not what this row is for: the decimated slab is paired with the
  // RENDERED L1 surface, and L1 tiles exist only over the tile lattice's crop
  // box (§1.3/§1.5). So the caller hands the crop in and the extent is the
  // fallback for a build with no lattice.
  function boxCells(box, span) {
    const i0 = Math.floor((box.x0 - ax) / span), i1 = Math.floor((box.x1 - ax) / span);
    const j0 = Math.floor((box.z0 - az) / span), j1 = Math.floor((box.z1 - az) / span);
    const cells = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cells.push([i, j]);
    return cells;
  }

  function collisionFidelity(n = 4096, domain = null) {
    if (!softAt) return { error: 'no world.terrainHeight — the analytic surface both lattices sample is missing' };
    const render = ROUTER_LEVELS[1].spacing * unit;          // 2.00 m, L1's render lattice
    const collide = render * 2;                              // 4.00 m, the decimated slab
    const span = ROUTER_LEVELS[1].span * unit;
    const d = domain && isFinite(domain.x0) ? domain : dec;
    const box = {
      x0: Math.max(d.x0, dec.x0), z0: Math.max(d.z0, dec.z0),
      x1: Math.min(d.x1, dec.x1), z1: Math.min(d.z1, dec.z1),
    };
    const world = fidelityBox(box, n, render, collide, boxCells(box, span).length);
    const ring = fidelityOver(ringCells(), span, n, render, collide);
    return {
      // the gated numbers: position-independent, same on every boot
      samples: world.samples, maxErrorM: world.maxErrorM, meanErrorM: world.meanErrorM,
      worstAt: world.worstAt, l1Cells: world.cells,
      scope: (domain ? 'the tile lattice crop box' : 'the declared extent (§3.6) — no crop was handed in')
        + ' — NOT the resident ring, which moves with the player',
      domain: { x0: +box.x0.toFixed(2), z0: +box.z0.toFixed(2), x1: +box.x1.toFixed(2), z1: +box.z1.toFixed(2) },
      extent: { x0: +dec.x0.toFixed(2), z0: +dec.z0.toFixed(2), x1: +dec.x1.toFixed(2), z1: +dec.z1.toFixed(2) },
      // context only, and it is the number that used to be gated
      ring: { ...ring, focus: { x: +focus.x.toFixed(2), z: +focus.z.toFixed(2) } },
      renderSpacingM: render, collideSpacingM: collide,
      l1TerrainTris: L1_TERRAIN_TRIS, l0TerrainTris: L0_TERRAIN_TRIS,
    };
  }

  // A tooling sweep, not a runtime path: build EVERY tile of `level` over the
  // declared extent once so the per-tile census §3.5's cap needs can be READ.
  // Boot with `?propcap=<big>` first or this throws at the first dense tile,
  // which is the whole point of the cap.
  function census(level) {
    const span = ROUTER_LEVELS[level].span * unit;
    const i0 = Math.floor((dec.x0 - ax) / span), i1 = Math.floor((dec.x1 - ax) / span);
    const j0 = Math.floor((dec.z0 - az) / span), j1 = Math.floor((dec.z1 - az) / span);
    const hist = new Array(12).fill(0);
    let n = 0, worst = 0, worstTile = null, worstTerrain = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = tileAt(level, i, j, true);
        if (!t) continue;
        n++;
        hist[Math.min(11, Math.floor(t.propTri / 2000))]++;
        if (t.propTri > worst) { worst = t.propTri; worstTile = key(level, i, j); }
        if (t.terrainTri > worstTerrain) worstTerrain = t.terrainTri;
      }
    }
    return { level, span, tiles: n, worstProp: worst, worstPropTile: worstTile,
             worstTerrain, cap: capFor(level), hist2000: hist };
  }

  const api = {
    census, capFor,
    // ---- the identical surface of collision.js:433-470 ----
    groundAt,
    groundNormalY: () => lastNY,
    groundNormal: () => gn,
    groundClass: () => gcls,
    groundMesh: () => gmeshName,
    raycast,
    // ---- forwarded verbatim from the one harvest ----
    meshTable: base.meshTable,
    classOf: base.classOf,
    meshOf: base.meshOf,
    stemHit: base.stemHit, stemSegment: base.stemSegment, stemAt: base.stemAt,
    // D-20's multi-trunk trio, forwarded the same way and for the same reason
    stemContacts: base.stemContacts, stemProbe: base.stemProbe, stemClear: base.stemClear,
    canopyIn: base.canopyIn, canopyFx: base.canopyFx, stems: base.stems,
    // ---- §3.6: the DECLARED extent, never the resident ring ----
    bounds,
    inBounds: (x, z) => x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1,
    // ---- residency, driven by main.js and (later) by chunks.js ----
    setFocus, pinSync, tick, residency, collisionFidelity, setRange,
    get range() { return rangeName; },
    levels: ROUTER_LEVELS,
    declaredExtent: { ...dec },
    // ---- telemetry (§3.6, §7.4 checks 4/6) ----
    tele,
    withCaller(name, fn) { const p = caller; caller = name; try { return fn(); } finally { caller = p; } },
    stats: {
      get triangles() { return residency().collidableTriangles; },
      get soupTriangles() { return S.nTri; },
      get cellEntries() { return base.stats.cellEntries; },
      get cells() { return base.stats.cells; },
      cell,
      get meshesUsed() { return base.stats.meshesUsed; },
      get meshesSkipped() { return base.stats.meshesSkipped; },
      get skippedOversize() { return base.stats.skippedOversize; },
      get skippedOutside() { return base.stats.skippedOutside; },
      get rockMeshes() { return base.stats.rockMeshes; },
      get rockTriangles() { return base.stats.rockTriangles; },
      get classTriangles() { return base.stats.classTriangles; },
      get stems() { return base.stats.stems; },
      get stemMs() { return base.stats.stemMs; },
      get meshNames() { return base.stats.meshNames; },
      get bytes() { return base.stats.bytes; },
      get residency() { return residency(); },
      get router() {
        return { softHits: tele.softHits, refusals: tele.refusals, builds: tele.builds,
                 evictions: tele.evictions, pins: tele.pins, slots: TILE_SLOTS };
      },
    },
  };
  // `window.__playCollision` is the lab handle check 11 reads `bounds` off
  // (chunkgate.mjs). It must be the ROUTER, not the harvest underneath it.
  //
  // `window.__chunks` is the surface §7.4 checks 4 and 6 read by name:
  // `softHits`, `softByCaller`, `refusals`, `residency()`, `bytes()`. Wave 2a's
  // scheduler adds its own pool figures to the SAME object rather than a second
  // one — hence `Object.assign` onto whatever is already there.
  try {
    if (typeof window !== 'undefined') {
      window.__playCollision = api;
      const C = window.__chunks || (window.__chunks = {});
      Object.defineProperties(C, {
        softHits: { configurable: true, get: () => tele.softHits },
        refusals: { configurable: true, get: () => tele.refusals },
        softByCaller: { configurable: true, get: () => ({ ...tele.softByCaller }) },
        pinsByPath: { configurable: true, get: () => ({ ...tele.pinsByPath }) },
        worstProp: { configurable: true, get: () => tele.worstProp },
        worstPropTile: { configurable: true, get: () => tele.worstPropTile },
        worstTerrain: { configurable: true, get: () => tele.worstTerrain },
        propHist: { configurable: true, get: () => tele.propHist.slice() },
      });
      C.residency = () => residency();
      C.bytes = () => residency().gridBytes + base.stats.bytes;
      C.collisionFidelity = collisionFidelity;
      C.router = api;
    }
  } catch { /* not a browser */ }
  return api;
}
