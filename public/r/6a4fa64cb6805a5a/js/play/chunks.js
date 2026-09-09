// ---------------------------------------------------------------------------
// specs/0051 §2 — THE SCHEDULER. Wave 2a (§9.1 row 2a).
//
// Wave 1b built the tile (§1): two vertex shapes, analytic normals, the skirt,
// morphZ, the per-tile forest, and a WHOLE-WORLD EAGER loop to gate the shape
// with. This file is the other half — what is resident, when, in which slot,
// and what happens when the answer changes sixty times a second.
//
// THE FIVE THINGS §2 ASKS FOR, and where each one is below:
//   §2.2  two pools, 144 FINE + 160 COARSE, allocated ONCE at boot and swapped
//         IN PLACE (`attr.array.set(src)`), so the steady loop constructs no
//         BufferGeometry and disposes none — check 10's tripwire is the gate,
//         and since D-14 (wave 4c) it counts geometry THIS FILE tagged at
//         construction (`POOL_TAG`, below) rather than every geometry on the
//         page, so guide.js's stage props cannot redden it
//   §2.4  byte-cap semantics: the required set is never evicted, eviction is
//         prefetch -> farthest coarse -> NOTHING, and a refusal to refine is
//         counted rather than being an allocation (`__chunks.refusals`)
//   §2.7  a 2.0 ms/frame main-thread budget, a banded builder that yields
//         inside a tile, velocity prefetch at p + v x 2.5 s (glider x 6 s) and
//         a 2.0 s / 30-tile grace list
//   §2.8  `pinSync(dest)`, resolving in <= 5 frames, for ALL FIVE re-home paths
//   §2.9  `drain()` / `freeze()`, drain at a DETERMINISTIC centre and with
//         `uMorph` NOT snapped (D-7)
//
// WHERE IT IS TICKED. `main.js` `frame()`, before `playerSystems()` and outside
// every swallowing catch — NEVER `world.update` (§2.1): `main.js:2341-2343`
// reads `if (world.update) { try { … } catch { world.update = null } }`, so one
// throw would silently and permanently disable the scheduler, and it only runs
// on the `world.ownLoop` branch at all.
//
// WHAT THIS WAVE DOES NOT DO. The pooled meshes are NOT RENDERED: they hang
// under one `chunks:pool` group with `visible = false` and the legacy terrain
// keeps drawing. §7.2b authorises exactly two C15/C16 re-records in the whole
// program (1b's normals, 3a's forest) and says "no third re-record is
// authorised"; swapping the rendered floor to the lattice is a third, and it is
// not in this row's done-when (checks 4 and 10, refusals, check 1). The swap is
// one line — `chunks.setVisible(true)` — for the wave that owns it.
//
// UNTIL WAVE 2b LANDS the tile is built HERE, on the main thread, banded to
// §2.7's 2.0 ms — behind exactly the interface the worker will implement
// (`request(job)` -> `job.done`), so 2b replaces the body of `buildBand` and
// nothing else moves.
// ---------------------------------------------------------------------------

// specs/0051 D-19 — the trunks. `solids.js` owns what a tree IS for collision
// (the tapered stem cone, the foliage line, the 8 m hash); this file owns WHEN
// one exists, because after wave 3a it is this file that places every fir in
// the world. A static import, not a dynamic one: `solids.js` is a sibling in
// `js/play/` that the export ships beside this module (`red-dog.json`'s player
// allowlist), and collision.js already imports it, so this adds no fetch.
import * as SOLIDS from './solids.js';

// ============================================================== the constants
// §2.3's table, and it is a CONTRACT, not a tuning knob: 144 x 143,392 +
// 160 x 38,944 = 26,879,488 B, permanent and constant, which is the number that
// makes flat RAM a promise rather than a hope (§10.7).
export const SLOTS = { FINE: 144, COARSE: 160 };

export const BUDGET_MS = 2.0;        // §2.7 main thread, per frame
export const PIN_BUDGET_MS = 64.0;   // §2.8 floor while a pin is pending
export const PIN_FRAMES = 5;         // §2.8 "resolves in <= 5 frames"
export const PIN_BUDGET_CAP_MS = 400;
export const BAND_ROWS = 8;          // §2.5 "yielding after each 8-row band"
export const LEAD_S = 2.5;           // §2.7 p + v x 2.5 s
export const LEAD_GLIDER_S = 6.0;    // §2.7 the glider raises the lead
export const LEAD_CLAMP_TILES = 1.5; // §2.7 clamped to 1.5 L0 tiles of lead
export const GRACE_MS = 2000;        // §2.7 2.0 s ...
export const GRACE_MAX = 30;         // §2.7 ... / 30 tiles
export const SOFT_LOG_MAX = 256;

// ===================================================== D-19, the DISCONTINUITY
// specs/0051 §2.7's grace list, the lead and the 2.0 ms budget are all written
// for a body that MOVES: "a 2.0 s / 30-tile grace list to absorb boundary
// ping-pong", "residency centre is p + v x 2.5 s". A fast travel is none of
// those things — the position jumps kilometres between two frames — and the
// three of them together are what Greg saw:
//
//   * the lead extrapolates the velocity the body had BEFORE the jump from the
//     position it has AFTER it, so the first post-teleport centre is wrong by
//     `v x 2.5 s` in the old direction;
//   * every tile of the source falls out of `want` at once and goes on the
//     GRACE list, which holds 30 of them resident for 2.0 s — with their
//     forest, because a tile's trunks and firs live and die with the tile;
//   * the destination's 243 tiles then stream in at 2.0 ms a frame.
//
// A JUMP OF MORE THAN ONE L0 TILE IN ONE FRAME IS NOT MOVEMENT. 64 m at 60 Hz
// is 3,840 m/s and nothing in the player goes a tenth that fast (the rocket
// tops out near 60 m/s), so the test has no false positive worth the name and
// the one it would have — a single frame of 1 s+ on a stalled tab — wants
// exactly this treatment anyway.
export const JUMP_TILES = 1;         // L0 tiles of centre movement in one frame
// How long the raised budget lasts after a re-home. Not a fade timer: the
// settle ENDS the moment the core required set is resident (`requiredResident`),
// and this is only the ceiling that stops a refusal-bound scheduler holding the
// frame budget for ever. 0055's teleport flash is 0.8 s; at 60 Hz that is 48
// frames, and the measured settle is well inside it.
export const SETTLE_FRAMES = 90;
// Check 15's staleness rule, and it is GEOMETRIC rather than a set difference,
// so it cannot be satisfied by the scheduler agreeing with itself. A level's
// resident block is 8 x 8 tiles anchored on RX0/RY0 (§1.4) and the player is
// somewhere inside one of them, so no tile of a block the player is IN can have
// its centre further than 8 spans away. A tile beyond that came from another
// block — which, after a fast travel, means the place we left. LF is exempt: it
// is static and world-anchored by §1.5, so a far LF tile is the design.
export const STALE_SPANS = 8;

// The frame map main.js:87 applies to a z-up contract world:
//   (x, y, z)_ENU -> (x, z, -y)_three,  so  ENU x = three x,  ENU y = -three z.
export const enuOf = (p) => {
  if (!p) return null;
  if (typeof p.ex === 'number') return { x: p.ex, y: p.ey };
  if (Array.isArray(p)) return { x: p[0], y: -p[2] };
  return { x: p.x, y: -p.z };
};

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());

// ===========================================================================
// POOL GEOMETRY TAGGING — specs/0051-DECISIONS D-14, §7.4.10.
//
// §7.4.10 asks for "zero `new BufferGeometry` and zero `geometry.dispose()`
// during a 60 s traverse". It was implemented page-wide, and page-wide is not
// what the sentence is FOR: §10.7 states the claim as "the pools never grow".
// guide.js's race-course stage builds a prop set when a stage opens and
// disposes it when the stage closes (`guide.js:472,496,555,573,577,593,601,
// 616,618,679`) — legitimate, unrelated to streaming, and it read 11/0 on
// siberia once. A tripwire that reddens on the guide is a tripwire people
// learn to ignore.
//
// So the scope is made explicit AT CONSTRUCTION rather than inferred at
// measurement time. Every geometry this file constructs — the terrain pool's
// per-slot `BufferGeometry`, the `BatchedMesh` set's prototype and each
// batch's own internal geometry, and `POOL_INST`'s meshes — is stamped with
// `POOL_TAG` and counted here. Check 10 reads the counters either side of its
// bracket and asserts on THOSE, and prints the page-wide reading beside them
// as information.
//
// A `Symbol.for` key, not a private symbol and not a `userData` flag:
//   * `Symbol.for` is registry-global, so the harness can ask any geometry
//     `g[Symbol.for('poi:0051:poolGeometry')]` without a handle to this
//     module — check 10's page-wide sweep uses exactly that to tell a pool
//     geometry from a guide prop.
//   * a symbol cannot collide with a three.js property or with anything a
//     world module writes into `userData`, and it is not enumerable, so it
//     cannot leak into a scene hash (check 3) or a JSON dump.
//
// `dispose` is shadowed PER TAGGED GEOMETRY rather than on the prototype, so
// the disposal counter is scoped by construction too and the harness's own
// prototype wrap (its page-wide reading) still sees every call.
// ===========================================================================
export const POOL_TAG = Symbol.for('poi:0051:poolGeometry');

const POOL_ALLOC = { constructed: 0, adopted: 0, disposed: 0, byOwner: {}, disposedBy: {} };

/** Stamp `g` as pool-owned by `owner` and count it. Idempotent: a geometry is
 *  counted the first time it is tagged and never again, so a second tag call
 *  on the same object (a re-entered init, a shared prototype) cannot inflate
 *  the number check 10 asserts on. Returns `g` so it can wrap a `new`.
 *
 *  `adopt` tags without counting a construction: POOL_INST is handed baked
 *  prototype geometry it did not build, and calling that an allocation of the
 *  pool's would be a false number in the row that exists to hold true ones.
 *  Adopted geometry still counts its DISPOSALS, which is the half that would
 *  actually be a pool defect. */
function tagPoolGeometry(g, owner, adopt) {
  if (!g || typeof g !== 'object' || g[POOL_TAG]) return g;
  try {
    Object.defineProperty(g, POOL_TAG, { value: owner || 'pool', enumerable: false, configurable: true });
  } catch { return g; }
  if (adopt) { POOL_ALLOC.adopted++; POOL_ALLOC.byOwner[owner] = POOL_ALLOC.byOwner[owner] || 0; }
  else { POOL_ALLOC.constructed++; POOL_ALLOC.byOwner[owner] = (POOL_ALLOC.byOwner[owner] || 0) + 1; }
  const real = typeof g.dispose === 'function' ? g.dispose : null;
  if (real) {
    try {
      Object.defineProperty(g, 'dispose', {
        // The own property shadows the prototype, so it is what a caller
        // reaches — and it therefore has to RE-READ the prototype at call
        // time rather than close over the function that was there when the
        // tag went on. Check 10 wraps `BufferGeometry.prototype.dispose` to
        // take its page-wide reading; closing over `real` would make every
        // pool disposal invisible to that reading, which is precisely the
        // number that has to agree with this one.
        value: function poolDispose(...a) {
          POOL_ALLOC.disposed++;
          POOL_ALLOC.disposedBy[owner] = (POOL_ALLOC.disposedBy[owner] || 0) + 1;
          const cur = Object.getPrototypeOf(this) && Object.getPrototypeOf(this).dispose;
          return (typeof cur === 'function' && cur !== poolDispose ? cur : real).apply(this, a);
        },
        enumerable: false, configurable: true, writable: true,
      });
    } catch { /* frozen geometry — the count stands, the dispose hook does not */ }
  }
  return g;
}

/** The snapshot check 10 brackets. Plain numbers and plain objects, so the
 *  harness can diff two of them across a traverse without holding a
 *  reference to anything in the scene. */
function poolAllocSnapshot() {
  return {
    constructed: POOL_ALLOC.constructed,
    adopted: POOL_ALLOC.adopted,
    disposed: POOL_ALLOC.disposed,
    byOwner: { ...POOL_ALLOC.byOwner },
    disposedBy: { ...POOL_ALLOC.disposedBy },
    tag: 'poi:0051:poolGeometry',
  };
}

// ===========================================================================
// The inert handle. A world with no tile lattice (the gltf and page adapters,
// or a contract world older than wave 1b) still gets every name this module
// promises, so `main.js` never branches and `window.__chunks` is never
// undefined. Everything reads zero, which is the truth for a world with no
// tiles rather than a lie about one.
// ===========================================================================
function inertChunks(reason) {
  const h = {
    ok: false, reason,
    tick() {}, freeze() { return false; }, setVisible() { return false; },
    setDrawMode() { return 'mesh'; }, drawMode: () => 'mesh',
    batchStats() { return { enabled: false, reason, batches: 0, meshDraws: 0 }; },
    features() { return { nodes: 0, resident: 0, byKind: {}, applied: false }; },
    featureResident() { return false; }, setFeatureVisible() { return false; },
    async drain() { return true; },
    async pinSync() { return { ok: false, reason, frames: 0, ms: 0, tiles: 0 }; },
    unpin() { return false; }, pinnedAt() { return false; },
    softHit() { return 0; }, resetSoftHits() {},
    levelAt() { return null; }, residentTile() { return null; },
    subscribe() { return () => {}; },
    residency() { return null; }, reachProof() { return null; },
    traverseProof() { return null; }, parityProof() { return null; },
    residencyHash() { return '00000000'; },
    stats() { return null; }, levels() { return []; }, crop() { return null; },
    bytes() { return 0; },
    instances() { return null; }, instCensus() { return null; },
    stemCensus() { return null; }, stemsOf() { return []; },
    requiredAt() { return { centre: null, ids: [], byLevel: {}, n: 0 }; },
    residentIds() { return []; }, residentRows() { return []; },
    wouldForest() { return null; },
    teleportCensus() { return null; },
    reHome() { return { n: 0, last: null, byPath: {}, evicted: 0, settling: false }; },
    instVisible() { return false; }, instDeterminism() { return null; },
    // D-14 / §7.4.10. An inert scheduler owns no pool, so its ledger is empty
    // rather than absent: check 10 reads the same shape on every world and
    // says "no pools in this build" from `ok`, not from a missing method.
    alloc: () => poolAllocSnapshot(),
    dispose() {},
  };
  Object.defineProperties(h, {
    refusals: { get: () => 0 }, softHits: { get: () => 0 },
    residentBytes: { get: () => 0 },
    resident: { get: () => ({ total: 0, FINE: 0, COARSE: 0, byLevel: {} }) },
  });
  return h;
}

// ===========================================================================
// AN INERT SCHEDULER IS A FALLBACK OR A BUG, AND THE TWO MUST NOT READ ALIKE.
//
// "scene/tiles.mjs is not in this build" is the truth for a gltf world, a page
// world and any contract world older than wave 1b. It was ALSO what the bench
// said for three waves while red-dog's tiles.mjs sat right there in the scene
// dir and the loader's `new URL(spec, relativeBase)` threw on it — no trees, no
// rocks, no per-tile props, and `__chunks.reason` reassuring everyone that this
// build simply did not have tiles. §2.1: "a scheduler exception must be a
// visible failure."
//
// loader.js hands over `sideErrors`, keyed by module specifier, with `.loud` set
// when the failure was NOT "the file is not there" — a specifier that would not
// resolve, or a module that answered a fetch and still would not import. A loud
// error names itself; genuinely absent keeps the calm fallback wording.
// ===========================================================================
function sideReason(errs, spec, absent) {
  const e = errs && errs[spec];
  if (!e || !e.loud) return absent;
  const msg = e.present === false || e.present === null
    ? `${spec} did not RESOLVE against the world entry: ${e.message || e}`
    : `${spec} IS in this build and FAILED to import: ${e.message || e}`;
  console.error(`[chunks] the tile scheduler is INERT because ${msg}`, e);
  return msg;
}

// ===========================================================================
// createChunks
//
//   THREE      the three namespace main.js already holds
//   scene      the scene the pool group is added to (the `play:zup` wrapper
//              when there is one, so a tile's ENU coordinates land where the
//              rest of the world's do)
//   tiles      the `scene/tiles.mjs` module namespace (wave 1b)
//   ground     the `scene/ground.mjs` namespace — groundZ / normalAt / RASTER
//   terrain    the `scene/terrain.mjs` namespace — colorAt
//   source     the handle `tiles.mjs` publishes (drain/seam/morph/LOD probes),
//              delegated through so checks 3, 5 and 12 read what they read at 1b
//   colliders  the world's declared collider list — the LF box is its AABB
//              (§1.5: "the rim box"), NOT `collision.bounds`, which main.js
//              grows by 60 m and squares off (§3.7) and which 2c deletes
// ===========================================================================
export function createChunks(opts = {}) {
  const THREE = opts.THREE || null;
  const scene = opts.scene || null;
  const T = opts.tiles || null;
  const G = opts.ground || null;
  const TR = opts.terrain || null;
  const source = opts.source || null;
  const errs = opts.sideErrors || null;
  if (!THREE || !scene) return inertChunks('no THREE/scene');
  if (!T || !T.LEVELS || !T.tileTerrain) return inertChunks(sideReason(errs, './tiles.mjs', 'scene/tiles.mjs is not in this build (wave 1b)'));
  if (!G || !G.groundZ || !G.normalAt) return inertChunks(sideReason(errs, './ground.mjs', 'scene/ground.mjs exposes no groundZ/normalAt'));
  if (!TR || !TR.colorAt) return inertChunks(sideReason(errs, './terrain.mjs', 'scene/terrain.mjs exposes no colorAt'));

  const { groundZ, normalAt } = G;
  const { colorAt } = TR;
  const LEVELS = T.LEVELS;
  const LF = LEVELS[LEVELS.length - 1].level;
  const SHAPES = T.SHAPES;

  // ----------------------------------------------------------- the LF box
  // §1.5: "every 1,024 m tile intersecting the rim box". The rim is a declared
  // collider and the FAR_R polar apron is not (§3.7), so the collider AABB IS
  // the rim box: red-dog x [-4467.26, 1848] z [-2080.70, 2519.30] -> 7 x 5 = 35
  // LF tiles, exactly §1.5's count, derived rather than transcribed.
  const worldBox = boxOf(THREE, opts.colliders, T);

  // =========================================================== the two pools
  // §7.4 check 9, wave 3b: the batch is built FIRST, because the pool's typed
  // arrays are views into it (see `makeBatchSet`). `THREE.BatchedMesh` missing
  // from a host's three build is not a reason to fail — the pool falls back to
  // owning its own arrays, exactly as 2a shipped it, and the batch count reads
  // zero with a reason.
  const canBatch = typeof THREE.BatchedMesh === 'function' && opts.batch !== false;
  const batchSets = canBatch
    ? { FINE: makeBatchSet(THREE, T, SHAPES.FINE, SLOTS.FINE, opts.material),
        COARSE: makeBatchSet(THREE, T, SHAPES.COARSE, SLOTS.COARSE, opts.material) }
    : null;
  const pools = { FINE: makePool(THREE, T, SHAPES.FINE, SLOTS.FINE, opts.material, batchSets && batchSets.FINE),
                  COARSE: makePool(THREE, T, SHAPES.COARSE, SLOTS.COARSE, opts.material, batchSets && batchSets.COARSE) };
  // §5.3 / §5.4 wave 3a — the forest and rock instance pools. Unlike the terrain
  // pools these DRAW: world.mjs no longer instances the firs or the boulder
  // scatter whole-world, so this is the forest the player sees.
  // D-19 — the stem set the collision router harvested at boot, handed in so
  // the pool can keep it honest as tiles come and go. A host that passes none
  // (the gltf/page adapters, a world with no router) streams trees that are
  // drawn and not solid, which is exactly what they were before this wave.
  const instPool = makeInstPool(THREE, scene, opts.protos || null, T, opts.stems || null);
  const FEAT = instPool ? new Float32Array(T.instCap(LF) * T.INST_STRIDE) : null;
  let instOverflow = 0;
  const poolGroup = new THREE.Group();
  poolGroup.name = 'chunks:pool';
  poolGroup.visible = false;          // until the floor swap below — see `trySwapFloor`
  for (const k of ['FINE', 'COARSE']) for (const s of pools[k].slots) poolGroup.add(s.mesh);
  if (batchSets) for (const k of ['FINE', 'COARSE']) for (const b of batchSets[k].batches) poolGroup.add(b.mesh);
  scene.add(poolGroup);

  // ------------------------------------------------------- §5.1, wave 4a
  // THE LADDER'S SHADOW FLAGS, CARRIED OVER. `terrain.mjs:1100-1110` gives every
  // ladder mesh `receiveShadow = true` and gives the CAST to `terrain-core`
  // alone (siberia `terrain.mjs:389-394`: `cliff` and `core`). The lattice
  // inherits both halves: every tile receives, and the FINE shapes — L0 and L1,
  // the only levels inside the sun's 430 m ortho box (`world.mjs:206`) — cast.
  // A COARSE tile is never nearer than 384 m and would only add shadow draws.
  for (const k of ['FINE', 'COARSE']) {
    for (const s of pools[k].slots) { s.mesh.receiveShadow = true; s.mesh.castShadow = k === 'FINE'; }
    if (batchSets) for (const b of batchSets[k].batches) { b.mesh.receiveShadow = true; b.mesh.castShadow = k === 'FINE'; }
  }

  // =============================================================== the state
  const resident = new Map();     // id -> tile
  const pending = new Map();      // id -> job
  const grace = new Map();        // id -> { tile, until }
  const pins = new Map();         // pin key -> { ids:Set, center }
  let job = null;                 // the tile being built right now, band by band
  let centre = null;              // ENU residency centre (prefetch-led)
  let coreCentre = null;          // ENU player centre (no lead) — what "required" means
  let requiredIds = new Set();    // ids of the CORE required set (never evicted)
  let coreIds = new Set();        // D-19: §1.3's whole set at the player, all levels
  let wantIds = new Set();        // core + prefetch: everything we would like
  let want = new Map();           // id -> descriptor
  let frameNo = 0, refusals = 0, softHits = 0, frozen = false;
  // §5.1, wave 4a. The DEFAULT is now the batch when this three build has one:
  // the pool draws, and 227 pooled Meshes do not fit in check 9's 250 however
  // the frustum falls (3b's own argument, `makeBatchSet`'s header). 'mesh' is
  // still reachable through `setDrawMode` and is what the probes compare against.
  let drawMode = batchSets ? 'batch' : 'mesh';
  let dirty = true, lastKey = '';
  let pinPending = null;
  const softLog = [];
  const softByTag = Object.create(null);
  const subs = new Set();
  const stat = { lastRecomputeMs: 0, lastBuildMs: 0, builtTiles: 0, builtBands: 0, evicted: 0, graceHits: 0, buildMs: 0, tickMs: 0, lastTickMs: 0 };

  // ======================================================== the required set
  // §1.4, made executable. Level L's GUARANTEE CORE is the odd 7 x 7 block of
  // L-tiles centred on the player's L-tile; the RESIDENT BLOCK is that core
  // grown by exactly one tile on the axis side whose boundary is not already an
  // L+1 boundary, which is the same thing as "start at the nearest even index
  // at or below core-start" — an odd run needs exactly one tile to become even
  // and L+1 aligned, so the block is always 8 x 8 and never shrinks the
  // guarantee. Then L+1 subtracts the 4 x 4 footprint of L's block EXACTLY,
  // because 8 L-tiles are 4 L+1 tiles: no partially covered coarse tile can
  // exist, so nothing is drawn twice and no hole can open.
  const blockStart = (ci) => 2 * Math.floor((ci - 3) / 2);

  function residencyFor(cx, cy) {
    const out = new Map();
    let childStart = null;
    for (let L = 0; L < LF; L++) {
      const D = T.levelDef(L);
      const idx = T.tileIndexAt(L, cx, cy);
      const si = blockStart(idx[0]), sj = blockStart(idx[1]);
      // the finer level's footprint expressed in THIS level's indices
      const hx = childStart ? childStart[0] / 2 : null;
      const hy = childStart ? childStart[1] / 2 : null;
      for (let dj = 0; dj < 8; dj++) {
        for (let di = 0; di < 8; di++) {
          const tx = si + di, ty = sj + dj;
          if (hx !== null && tx >= hx && tx < hx + 4 && ty >= hy && ty < hy + 4) continue;
          out.set(T.tileId(L, tx, ty), mkWant(L, tx, ty, D, cx, cy));
        }
      }
      childStart = [si, sj];
    }
    // ------------------------------------------------------------------ LF
    // §1.5. Static and world-anchored: every LF tile meeting the rim box, minus
    // L3's LF footprint when the player is interior. The grid comes from
    // lfGrid(), which is also what check 4 asserts against — see there for why
    // the old hard-coded 35 was wrong after the 2026-09-05 crop widen.
    const D = T.levelDef(LF);
    const { i0, i1, j0, j1 } = lfGrid();
    const hx = childStart[0] / 2, hy = childStart[1] / 2;
    for (let ty = j0; ty <= j1; ty++) {
      for (let tx = i0; tx <= i1; tx++) {
        if (tx >= hx && tx < hx + 4 && ty >= hy && ty < hy + 4) continue;
        out.set(T.tileId(LF, tx, ty), mkWant(LF, tx, ty, D, cx, cy));
      }
    }
    return out;
  }

  // §1.5's LF grid, DERIVED and not copied. LF is static and world-anchored:
  // every 1,024 m tile on the RX0/RY0-anchored lattice that meets the rim box.
  // Both the want-set above and check 4's budget below read it from here, so
  // the assertion cannot drift from the thing it asserts.
  //
  // W4FIX1, 2026-09-05 — WHY THIS EXISTS. §1.5 and the old `byLevel[LF] <= 35`
  // both quoted 7 x 5 = 35, measured on the pre-widen lattice anchored at
  // RX0 -660 / RY0 -770.5. The export crop widened west on 2026-09-05 and the
  // ANCHOR moved with it (RX0 -1360, RY0 -1170.5) under an unmoved rim box
  // (x [-4467.26, 1832.74], y [-2519.30, 2088.70], from the world's own
  // colliders). A 1,024 m lattice re-phased by 700 m in x and 400 m in y spans
  // one more column and one more row of the same box: 8 x 6 = 48, not 35. The
  // count is a property of the lattice phase, not of the world, so it is
  // computed and reported rather than transcribed. Nothing physical moved and
  // no pool grew: LF is COARSE, worst case L2 48 + L3 48 + LF 48 = 144 of the
  // 160 COARSE slots, and the measured traverse peak is 136.
  function lfGrid() {
    const span = T.levelDef(LF).span, R = G.RASTER;
    const i0 = Math.floor((worldBox.x0 - R.RX0) / span), i1 = Math.floor((worldBox.x1 - R.RX0) / span);
    const j0 = Math.floor((worldBox.y0 - R.RY0) / span), j1 = Math.floor((worldBox.y1 - R.RY0) / span);
    const nx = i1 - i0 + 1, ny = j1 - j0 + 1;
    return { i0, i1, j0, j1, nx, ny, count: nx * ny };
  }

  function mkWant(level, tx, ty, D, cx, cy) {
    const rect = T.tileRect(level, tx, ty);
    const mx = (rect.x0 + rect.x1) / 2, my = (rect.y0 + rect.y1) / 2;
    return { level, tx, ty, rect, shape: D.shape, spacing: D.spacing,
             dist: Math.hypot(mx - cx, my - cy), mx, my };
  }

  // =================================================== §5.1 — the floor swap
  // "Today's ladder is 1.13 / 1.70 / 3.40 / 9 / 15 / 34 / 38 / 42.1 / 90 m
  // (`terrain.mjs:939,940,947,1039,1053,1067,1102`) … The classify/dilate/
  // overlap-ring apparatus and `detailMesh` are deleted, not ported." Waves 1b
  // and 2a built the replacement and left it `visible = false`; this is where
  // the picture actually changes hands.
  //
  // IT IS ONE-SHOT AND IT IS LATE ON PURPOSE. The ladder keeps drawing until the
  // WHOLE required set (§1.4) is resident, so there is never a frame with a hole
  // in the floor — §4.6's "the outer rings fill over ~40 frames" would otherwise
  // be 40 frames of missing mountain. After the swap the ladder meshes stay in
  // the scene graph, invisible: they are still `world.colliders`, which is the
  // declaration the collision harvest reads (§3.5), and moving terrain collision
  // onto the streamed lattice is §9.1 row 2c's, not this row's. Stated in
  // PROGRESS-0051-4a as a deviation rather than left to be discovered.
  // ORDERING, AND IT IS LOAD-BEARING. `collision.js:140` skips an invisible mesh
  // in the harvest — "an invisible mesh IS SILENTLY NOT A COLLIDER, declared in
  // `colliders` or not" (world.mjs:1293's own words) — so the ladder must still
  // be visible when `createCollisionRouter` runs. It is, by construction:
  // main.js harvests at :181 and builds this scheduler at :227, and the swap
  // below happens no earlier than the first tick after that. Anything that ever
  // re-harvests collision must re-harvest BEFORE the swap or restore the ladder
  // around it.
  const legacyFloor = (Array.isArray(opts.legacy) ? opts.legacy : []).filter((m) => m && m.isObject3D);
  let floorSwapped = false;
  let rigHidden = null;              // check 12's rig — see `lodProbe` on the handle

  function requiredResident() {
    if (!requiredIds.size) return false;
    for (const id of requiredIds) if (!resident.has(id)) return false;
    return true;
  }

  /** D-19 — §1.3's whole set under the player, which is what "the required set
   *  is resident" means for a teleport and for the 0055 flash. `missing` is the
   *  count, so the settle can be reported as a curve and not just a boolean. */
  function coreMissing() {
    let n = 0;
    for (const id of coreIds) if (!resident.has(id)) n++;
    return n;
  }
  const coreResident = () => coreIds.size > 0 && coreMissing() === 0;

  function trySwapFloor(force) {
    if (floorSwapped || !legacyFloor.length) return floorSwapped;
    if (!force && !requiredResident()) return false;
    for (const m of legacyFloor) m.visible = false;
    if (batchSets) for (const k of ['FINE', 'COARSE']) for (const b of batchSets[k].batches) b.mesh.visible = drawMode === 'batch';
    poolGroup.visible = true;
    floorSwapped = true;
    return true;
  }

  // ===================================================== the banded builder
  // §2.5's payload, §2.7's band. This is the ONLY place a tile's bytes are
  // produced in wave 2a, and it writes STRAIGHT INTO THE POOLED ARRAYS — no
  // intermediate allocation at all, which is the strict reading of §2.2's "the
  // pooled arrays are the only CPU copy". Wave 2b replaces the body with a
  // worker hand-off across the ping-pong transfer; the job object, the band
  // and `job.done` are the interface it inherits.
  //
  // It is a faithful port of `tiles.mjs tileTerrain`'s vertex loop, and that is
  // asserted rather than asserted-by-comment: `parityProof()` builds one tile
  // both ways and compares all four arrays byte for byte.
  function startJob(w) {
    const S = SHAPES[w.shape];
    return { id: T.tileId(w.level, w.tx, w.ty), level: w.level, tx: w.tx, ty: w.ty,
             rect: w.rect, spacing: w.spacing, shape: w.shape, S, dist: w.dist,
             row: 0, phase: 'rows', zmin: Infinity, zmax: -Infinity, slot: null,
             prio: w.level * 1e7 + w.dist, done: false, pin: false };
  }

  function acquireFor(j) {
    if (j.slot) return true;
    const s = acquireSlot(j.shape, j);
    if (!s) { refusals++; return false; }
    j.slot = s;
    return true;
  }

  // §2.5: "the builder is a generator yielding after each 8-row band; wave 1a's
  // measured per-tile time sets band count and NOTHING ELSE." So the band is 8
  // rows when 8 rows fit inside §2.7's 2.0 ms and fewer when they do not — the
  // measurement is taken here, live, as an EMA of the per-row cost, because the
  // number that matters is this box's, not a quiet box's. Measured on the
  // export build with the rider agents running: an 8-row FINE band is 1.15 ms
  // (L0) / 1.36 ms (L1), a COARSE one 0.52-0.71 ms.
  let rowMs = 0;
  const bandRows = () => (rowMs > 0 ? Math.max(1, Math.min(BAND_ROWS, Math.floor((BUDGET_MS * 0.4) / rowMs))) : BAND_ROWS);

  /** one band. Returns true when the tile is finished. */
  function buildBand(j, rows) {
    if (!acquireFor(j)) return false;
    const S = j.S, n = S.n, vx = S.vx, V = S.verts;
    const a = j.slot.arrays, pos = a.position, nrm = a.normal, col = a.color, mor = a.morphZ;
    const rect = j.rect, sp = j.spacing;
    const parent = T.levelDef(Math.min(LF, j.level + 1));
    const pSpacing = parent.level === j.level ? sp : parent.spacing;
    const h = T.TILE_NORMAL_H;

    if (j.phase === 'rows') {
      const nrows = Math.max(1, rows || BAND_ROWS);
      const end = Math.min(n, j.row + nrows - 1);
      const tB = nowMs();
      for (let jr = j.row; jr <= end; jr++) {
        const y = rect.y0 + jr * sp;
        for (let i = 0; i <= n; i++) {
          const x = rect.x0 + i * sp;
          const z = groundZ(x, y);
          const v = jr * vx + i, k3 = v * 3, k4 = v * 4;
          pos[k3] = x; pos[k3 + 1] = y; pos[k3 + 2] = z;
          const nv = normalAt(x, y, h);
          nrm[k3] = nv[0]; nrm[k3 + 1] = nv[1]; nrm[k3 + 2] = nv[2];
          const c = colorAt(x, y, z, nv[0], nv[1], nv[2], sp);
          col[k4] = u8(c[0]); col[k4 + 1] = u8(c[1]); col[k4 + 2] = u8(c[2]); col[k4 + 3] = 255;
          mor[v] = parent.level === j.level ? z : T.parentZ(x, y, pSpacing);
          if (z < j.zmin) j.zmin = z;
          if (z > j.zmax) j.zmax = z;
        }
      }
      stat.builtBands++;
      const per = (nowMs() - tB) / (end - j.row + 1);
      rowMs = rowMs > 0 ? rowMs * 0.8 + per * 0.2 : per;
      j.row = end + 1;
      if (j.row > n) j.phase = 'skirt';
      return false;
    }

    // §1.6 — the skirt, colour and normal inherited from the parent vertex, and
    // never collidable (the `:skirt` name suffix collision.js:305 already skips).
    if (j.phase === 'skirt') {
      const drop = T.SKIRT_DEPTH * sp;
      const ring = T.skirtRing(S);
      for (let e = 0; e < ring.length; e++) {
        const p = ring[e], b = V + e, p3 = p * 3, b3 = b * 3, p4 = p * 4, b4 = b * 4;
        pos[b3] = pos[p3]; pos[b3 + 1] = pos[p3 + 1]; pos[b3 + 2] = pos[p3 + 2] - drop;
        nrm[b3] = nrm[p3]; nrm[b3 + 1] = nrm[p3 + 1]; nrm[b3 + 2] = nrm[p3 + 2];
        col[b4] = col[p4]; col[b4 + 1] = col[p4 + 1]; col[b4 + 2] = col[p4 + 2]; col[b4 + 3] = 255;
        mor[b] = mor[p] - drop;
      }
      if (!instPool) { j.done = true; return true; }
      j.phase = 'features'; j.sub = 0; j.instN = 0; j.over = 0;
      return false;
    }

  // ------------------------------------------------------ §5.3's third phase
  // The tile's forest and rock, built in the SAME banded builder as its
  // terrain and inside the same §2.7 slice. The unit of work is one L0
  // sub-tile (`tiles.mjs:subTiles`) — at most FOREST_CANDIDATES density
  // evaluations, 0.3-2.0 ms measured — so a 1 km^2 level-4 tile is 256 band
  // steps and never one 66 ms stall. Nothing here allocates a buffer: the
  // instances land in one module-scope scratch and are copied into the pool's
  // own `instanceMatrix` on land.
    const ST = T.subTiles(j.level, j.tx, j.ty);
    const cap = T.instCap(j.level);
    const t0 = nowMs();
    do {
      const di = j.sub % ST.step, dj = (j.sub / ST.step) | 0;
      SUBLIST.length = 0;
      T.l0Candidates(ST.bx + di, ST.by + dj, undefined, j.level, SUBLIST);
      if (j.instN < cap) {
        const room = Math.min(SUBLIST.length, cap - j.instN);
        if (room < SUBLIST.length) { j.over += SUBLIST.length - room; SUBLIST.length = room; }
        j.instN += T.writeInstances(SUBLIST, FEAT, j.instN * T.INST_STRIDE);
      } else { j.over += SUBLIST.length; }
      j.sub++;
    } while (j.sub < ST.n && nowMs() - t0 < BUDGET_MS * 0.5);
    if (j.sub < ST.n) return false;
    j.done = true;
    return true;
  }

  const u8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
  const SUBLIST = [];   // one L0 sub-tile's candidates, reused every band

  // ============================================================ slot economy
  // §2.4, the whole of it. (1) the required set is NEVER evicted; (2) eviction
  // order is prefetch first, then the FARTHEST COARSE level, then NOTHING —
  // there is no third tier; (3) over the cap the scheduler does not allocate,
  // it REFUSES TO REFINE and leaves the coarser level rendering; (4) a refusal
  // increments `__chunks.refusals`, which every harness leg asserts at 0.
  function acquireSlot(shapeId, j) {
    const P = pools[shapeId];
    if (P.free.length) return takeSlot(P, P.free.pop());
    // tier 1 — the grace list: tiles nothing wants any more, oldest first.
    let best = null, bestKey = null;
    for (const g of grace.values()) {
      if (g.tile.shape !== shapeId) continue;
      if (!best || g.until < bestKey) { best = g.tile; bestKey = g.until; }
    }
    if (best) { stat.graceHits++; freeTile(best, 'grace'); return takeSlot(P, P.free.pop()); }
    // tier 2 — prefetch, then the farthest coarse level. Ordered (not-required
    // first, then level DESC = coarsest, then distance DESC, then LRU).
    let cand = null, ck = null;
    for (const t of resident.values()) {
      if (t.shape !== shapeId) continue;
      if (requiredIds.has(t.id)) continue;                 // §2.4.1 — never
      if (j && t.level < j.level) continue;                // never rob a finer level to feed a coarser one
      const k = [wantIds.has(t.id) ? 1 : 0, -t.level, -t.dist, t.lastUsed];
      if (!cand || lessThan(k, ck)) { cand = t; ck = k; }
    }
    if (cand) { stat.evicted++; freeTile(cand, 'evict'); return takeSlot(P, P.free.pop()); }
    return null;                                            // §2.4.3 — refuse
  }

  const lessThan = (a, b) => {
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
    return false;
  };

  function takeSlot(P, s) { s.used = true; return s; }

  // Teardown is IMMEDIATE and the slot goes STRAIGHT BACK ON THE FREE LIST
  // (§2.7). The free list plus the used count must always equal the slot count,
  // which is what check 4's "pool free-lists intact" means and what
  // `residency().freeOk` asserts — a slot dropped on the floor here is a pool
  // that shrinks under traversal, which is the exact failure the pools exist to
  // rule out.
  function freeTile(t, why) {
    if (instPool && t.instN) instPool.removeTile(t.id, t.level, t.instN);
    resident.delete(t.id);
    residentVersion++;
    grace.delete(t.id);
    const s = t.slot;
    s.used = false; s.tileId = null;
    s.mesh.visible = false;
    if (s.batch) s.batch.setVisibleAt(s.batchId, false);
    pools[s.shape].free.push(s);
    dirty = true;
    for (const cb of subs) { try { if (cb.onRemove) cb.onRemove(t, why); } catch (e) { console.warn('[chunks] onRemove', e); } }
    return s;
  }

  // The finished job takes its slot public: name it, bound it, show it. No
  // geometry is constructed and none disposed — the arrays were written in
  // place, so this is four `needsUpdate` flags and a sphere (§2.2).
  function landJob(j) {
    const s = j.slot;
    markSlot(s);
    const r = j.rect, sph = s.geom.boundingSphere;
    sph.center.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (j.zmin + j.zmax) / 2);
    sph.radius = Math.hypot(r.span, r.span, Math.max(1, j.zmax - j.zmin)) * 0.75;
    s.mesh.name = T.tileName(j.level, j.tx, j.ty);
    // §5.1: only ONE of the two draw paths may show the same triangles, so the
    // per-slot Mesh is shown iff we are in 'mesh' mode (`setDrawMode`).
    s.mesh.visible = drawMode === 'mesh';
    if (s.batch) s.batch.setVisibleAt(s.batchId, true);
    s.tileId = j.id;
    const D = T.levelDef(j.level);
    const tile = { id: j.id, level: j.level, tx: j.tx, ty: j.ty, rect: j.rect,
                   shape: j.shape, spacing: j.spacing, dist: j.dist, slot: s,
                   mesh: s.mesh, arrays: s.arrays, bytes: s.bytes,
                   zmin: j.zmin, zmax: j.zmax, lastUsed: frameNo,
                   collidableTris: D.collide === 'full' ? 8192 : D.collide === 'decimated' ? 2048 : 0,
                   instN: j.instN || 0 };
    if (instPool && j.instN) instPool.addTile(j.id, j.level, FEAT, j.instN);
    if (j.over) instOverflow += j.over;
    resident.set(j.id, tile);
    residentVersion++;
    stat.builtTiles++;
    for (const cb of subs) { try { if (cb.onAdd) cb.onAdd(tile); } catch (e) { console.warn('[chunks] onAdd', e); } }
    return tile;
  }

  // ================================================================= prefetch
  // §2.7: "residency centre is p + v x 2.5 s, clamped to 1.5 L0 tiles of lead.
  // Glider raises lead to v x 6 s". The clamp is what stops a 40 m/s straight
  // line from dragging the whole ring off the player.
  // ======================================================= D-19, the re-home
  // A jump is "the centre's L0 tile index moved by more than JUMP_TILES on
  // either axis since the last tick".  The L0 index, not the metres, because
  // the resident set is a step function of exactly that index (see `recompute`)
  // — so this fires on precisely the moves that invalidate the whole set and on
  // no others.
  function isJump(a, b) {
    const i = T.tileIndexAt(0, a.x, a.y), j = T.tileIndexAt(0, b.x, b.y);
    return Math.abs(i[0] - j[0]) > JUMP_TILES || Math.abs(i[1] - j[1]) > JUMP_TILES;
  }

  const rehome = { n: 0, last: null, frames: 0, evicted: 0, byPath: Object.create(null) };
  let settleUntil = 0;

  /** Re-centre on `p` as a DISCONTINUITY: no lead, no grace, and the frame
   *  budget raised until the core required set is resident.
   *
   *  THE GRACE LIST IS FLUSHED RATHER THAN AGED. §2.7 gives it to "absorb
   *  boundary ping-pong" — a body oscillating across one tile border, where
   *  re-building the tile it just left is the waste. A teleport is the opposite
   *  case: NOTHING that was resident will be wanted again, so every one of the
   *  30 tiles the cap leaves behind is a kilometre of stale terrain and stale
   *  forest drawn at the destination's expense, and the trunks that came with
   *  them are stale collision. Held for the full GRACE_MS that is 2.0 s of a
   *  world that is not there.
   *
   *  Called from `tick` (the detector, which covers every path) and from
   *  `pinSync` (which knows a re-home is happening before the body moves). Both
   *  are idempotent: a second call on the same L0 block is a no-op. */
  function reHome(p, path) {
    coreCentre = { x: p.x, y: p.y };
    centre = { x: p.x, y: p.y };
    headX = 0; headY = 0;
    dirty = true;
    recompute();                       // `want` is now the destination's
    // evict, this frame, everything the destination does not want — terrain
    // slot, forest instances and trunks together, which is what `freeTile` is
    let n = 0;
    for (const [id, g] of [...grace]) { grace.delete(id); freeTile(g.tile, 'rehome'); n++; }
    for (const [id, t] of [...resident]) if (!want.has(id)) { freeTile(t, 'rehome'); n++; }
    // a job whose tile the destination does not want is cancelled here too, so
    // the first frames of the settle are not spent finishing the old world.
    //
    // INCLUDING THE ONE IN FLIGHT. §2.7 checks cancellation "between tiles"
    // because mid-tile cancellation costs the bands already spent — a fair
    // trade while the body is moving and the tile might be wanted again in a
    // second. It is not a fair trade across a teleport: the tile is kilometres
    // behind, it will land into `resident` a frame later, and it will be drawn
    // there — measured, before this line, as the one surviving stale tile and
    // its 189 stale instances on hop 1.
    if (job && !want.has(job.id)) {
      if (job.slot) { job.slot.used = false; pools[job.shape].free.push(job.slot); }
      pending.delete(job.id);
      job = null;
    }
    for (const id of [...pending.keys()]) {
      if (want.has(id) || (job && job.id === id)) continue;
      const q = pending.get(id);
      if (q.slot) { q.slot.used = false; pools[q.shape].free.push(q.slot); }
      pending.delete(id);
    }
    settleUntil = frameNo + SETTLE_FRAMES;
    rehome.n++; rehome.evicted += n;
    rehome.byPath[path || 'tick'] = (rehome.byPath[path || 'tick'] || 0) + 1;
    rehome.last = { path: path || 'tick', frame: frameNo, at: { x: p.x, y: p.y },
                    evicted: n, t0: nowMs(), ms: null, frames: null };
    return n;
  }

  /** The frame's build budget. §2.7's 2.0 ms in the steady loop; §2.8's pin
   *  floor while a pin is in flight; and — D-19 — the same raised floor while a
   *  re-home settles, because the alternative is 243 tiles at 2.0 ms a frame
   *  and a second of the wrong world under the flash. The settle ENDS on
   *  `requiredResident()`, never on a clock. */
  function budgetNow() {
    if (pinPending) return pinBudget(pinPending, PIN_FRAMES - pinPending.frames);
    return frameNo < settleUntil ? PIN_BUDGET_MS : BUDGET_MS;
  }

  /** end of tick: has the settle finished? The answer is READ OFF THE REQUIRED
   *  SET, never off a clock — `requiredResident()` is the same predicate the
   *  floor swap uses at boot (§5.1's `trySwapFloor`), which is what "use the
   *  required-set readiness the way boot does" means. `settleMs` is what the
   *  0055 flash and the harness both quote as time-to-required-set. */
  function settleCheck() {
    if (!settleUntil) return;
    if (coreResident()) {
      if (rehome.last && rehome.last.ms === null) {
        rehome.last.ms = +(nowMs() - rehome.last.t0).toFixed(1);
        rehome.last.frames = frameNo - rehome.last.frame;
      }
      settleUntil = 0;
      rehome.frames = rehome.last && rehome.last.frames != null ? rehome.last.frames : rehome.frames;
    } else if (frameNo >= settleUntil) {
      // the ceiling, and it is REPORTED rather than silent: a settle that ran
      // out of frames is a tile the scheduler could not build, which is the one
      // thing check 15 must not be allowed to pass through.
      if (rehome.last && rehome.last.ms === null) {
        rehome.last.ms = +(nowMs() - rehome.last.t0).toFixed(1);
        rehome.last.frames = frameNo - rehome.last.frame;
        rehome.last.timedOut = true;
      }
      settleUntil = 0;
    }
  }

  function centreOf(focus) {
    const p = enuOf(focus);
    if (!p) return coreCentre || { x: 0, y: 0 };
    const lead = (focus.mode === 'glider' || focus.mode === 'rocket') ? LEAD_GLIDER_S : LEAD_S;
    let dx = (focus.vx || 0) * lead, dy = -(focus.vz || 0) * lead;   // ENU y = -three z, velocity too
    const cap = LEAD_CLAMP_TILES * T.levelDef(0).span;
    const d = Math.hypot(dx, dy);
    if (d > cap) { dx = dx * cap / d; dy = dy * cap / d; }
    return { x: p.x + dx, y: p.y + dy };
  }

  // ===================================================================== tick
  // §2.1's site, §2.7's budget. Everything that can throw is left to throw: a
  // scheduler exception must be a VISIBLE failure, and main.js calls this
  // outside every catch precisely so that it is.
  function tick(dt, focus) {
    if (frozen) return;
    const t0 = nowMs();
    frameNo++;
    const prev = coreCentre;
    coreCentre = enuOf(focus) || coreCentre || { x: 0, y: 0 };
    // D-19 — THE DISCONTINUITY TEST, and it is here rather than on the five
    // re-home paths because it catches all of them plus the ones nobody has
    // written yet: `__player.teleport`, a URL spawn, a lift unload, a void-drop
    // respawn and anything a later wave adds all arrive as one thing — a
    // position that moved further in a frame than a body can move.
    const jumped = prev && isJump(prev, coreCentre);
    if (jumped) reHome(coreCentre, 'tick');
    // ...and the lead is DROPPED on the jump frame (§2.7's prefetch is `p + v x
    // 2.5 s`, and the v belongs to the place we just left), then earns itself
    // back from the destination's own motion on the next frame.
    centre = jumped ? { x: coreCentre.x, y: coreCentre.y } : centreOf(focus);
    if (jumped) { headX = 0; headY = 0; } else setHeading(focus);
    recompute();
    const tR = nowMs();
    const b0 = stat.buildMs;
    work(t0 + budgetNow());
    stat.lastRecomputeMs = tR - t0;
    stat.lastBuildMs = stat.buildMs - b0;
    expireGrace(nowMs());
    // §9.1 3b — the feature index's residency follows the tile set, and it is a
    // no-op on every frame the tile set did not change (`residentVersion`).
    if (featureVisible) updateFeatures(false);
    if (pinPending) settlePin();
    settleCheck();                  // D-19 — time-to-required-set, off the set
    trySwapFloor(false);            // §5.1 — one-shot, see `trySwapFloor`
    stat.lastTickMs = nowMs() - t0;
    stat.tickMs += stat.lastTickMs;
  }

  // The diff: what is wanted, what is required, what has fallen out.
  //
  // THE RESIDENT SET IS A STEP FUNCTION OF THE CENTRE'S L0 TILE, so it is
  // recomputed when the centre crosses an L0 boundary and not once a frame.
  // Every coarser level's boundaries are a subset of L0's — the lattice is
  // anchored on RX0/RY0 at every level and the span doubles (§1.1) — so the L0
  // index of the lead centre and of the player's own centre is a complete key.
  // Measured: rebuilding the 243-entry set costs ~1.5 ms, which spent every
  // frame would eat three quarters of §2.7's 2.0 ms before a single vertex was
  // written. Spent on a boundary cross it is one frame in ~190 at 20 m/s.
  const keyOf = (p) => { const i = T.tileIndexAt(0, p.x, p.y); return i[0] + ':' + i[1]; };
  function recompute() {
    const k = keyOf(centre) + '|' + keyOf(coreCentre);
    if (k === lastKey && !dirty) return;
    lastKey = k; dirty = false;
    want = residencyFor(centre.x, centre.y);
    // the CORE required set is the residency at the player's OWN position, with
    // no lead: the set §2.4.1 says may never be evicted. Everything the lead
    // adds on top is prefetch, and prefetch is eviction tier 1.
    const same = coreCentre.x === centre.x && coreCentre.y === centre.y;
    const core = same ? want : residencyFor(coreCentre.x, coreCentre.y);
    // §2.3's rule, and the arithmetic that makes the FINE pool 144 rather than
    // 176: WHILE A PIN IS IN FLIGHT the source keeps only its L0 block as
    // never-evictable, and its L1..LF sets are evictable — "so worst-case FINE
    // concurrency is 64 + 64 = 128, not 112 + 64". They are still WANTED, so
    // they come back the moment the pin lands and nothing else needs the slot;
    // they are simply no longer protected by §2.4.1.
    requiredIds = new Set();
    for (const [id, w] of core) if (!pinPending || w.level === 0) requiredIds.add(id);
    // D-19 — §1.3's WHOLE required set at the player's own position, every
    // level, kept apart from `requiredIds` because the two answer different
    // questions. `requiredIds` is "what may never be evicted", and §2.3 shrinks
    // it to L0 while a pin is in flight so the pool arithmetic holds.
    // `coreIds` is "what §1.3 says has to be under the player", which is what a
    // teleport has to have finished building and what check 15 counts against.
    coreIds = new Set(core.keys());
    if (!same) for (const [id, w] of core) if (!want.has(id)) want.set(id, w);
    // §2.8's pins are required by definition, and stay required until released.
    for (const pin of pins.values()) for (const [pid, pw] of pin.want) {
      requiredIds.add(pid);
      if (!want.has(pid)) want.set(pid, pw);
    }
    wantIds = new Set(want.keys());
    for (const [id, w] of want) {
      const t = resident.get(id);
      if (t) { t.lastUsed = frameNo; t.dist = w.dist; grace.delete(id); continue; }
      const p = pending.get(id);
      if (!p) pending.set(id, startJob(w));
      else p.dist = w.dist;
    }
    for (const [id, t] of resident) {
      if (want.has(id)) continue;
      if (!grace.has(id)) grace.set(id, { tile: t, until: nowMs() + GRACE_MS });
    }
    for (const id of [...pending.keys()]) {
      if (want.has(id)) continue;
      if (job && job.id === id) continue;          // cancellation is between tiles (§2.7)
      const p = pending.get(id);
      if (p.slot) { p.slot.used = false; pools[p.shape].free.push(p.slot); }
      pending.delete(id);
    }
  }

  // spend the frame's budget, band by band, one tile at a time (§2.7).
  function work(deadline) {
    let guard = 0, bands = 0;
    while (guard++ < 8192) {
      if (!job) { job = nextJob(); if (!job) return; }
      const rows = bandRows();
      // ONE band always runs — a frame that can afford nothing still has to
      // make progress or a slow box never finishes a tile. After that the
      // MEASURED band cost decides, so the budget is missed by at most the band
      // that was already running and never by a band we could see would not fit.
      if (bands && nowMs() + rows * rowMs > deadline) return;
      const t1 = nowMs();
      const fin = buildBand(job, rows);
      stat.buildMs += nowMs() - t1;
      bands++;
      if (!job.slot) { pending.delete(job.id); job = null; return; }   // refused
      if (fin) { pending.delete(job.id); landJob(job); job = null; }
      if (nowMs() >= deadline) return;
    }
  }

  // §2.7's priority: (level asc, distance-to-lead asc, in-frustum first). "In
  // frustum" without a camera matrix is the heading half-plane: a tile the
  // player is moving towards outranks one behind it at the same level.
  function nextJob() {
    let best = null, bk = Infinity;
    for (const j of pending.values()) {
      const w = want.get(j.id);
      const d = w ? w.dist : j.dist;
      const k = j.level * 1e7 + d * (frontOf(w || j) ? 0.5 : 1) - (j.pin ? 5e6 : 0);
      if (k < bk) { bk = k; best = j; }
    }
    return best;
  }

  let headX = 0, headY = 0;
  function setHeading(focus) {
    const vx = (focus && focus.vx) || 0, vz = (focus && focus.vz) || 0;
    const l = Math.hypot(vx, vz);
    if (l < 0.5) { headX = 0; headY = 0; return; }   // standing still has no front
    headX = vx / l; headY = -vz / l;
  }
  const frontOf = (w) => (headX || headY) && ((w.mx - coreCentre.x) * headX + (w.my - coreCentre.y) * headY) > 0;

  function expireGrace(now) {
    if (!grace.size) return;
    if (grace.size > GRACE_MAX) {
      const rows = [...grace.values()].sort((a, b) => a.until - b.until);
      for (let i = 0; i < rows.length - GRACE_MAX; i++) freeTile(rows[i].tile, 'grace-cap');
    }
    for (const [id, g] of [...grace]) if (g.until <= now) { grace.delete(id); freeTile(g.tile, 'grace-expire'); }
  }

  // ============================================================ §2.8 pinSync
  // ALL FIVE re-home paths, not one. `main.js:1790-1800`'s teleport wrapper is
  // the documented seam; `controller.js:333-336`'s respawn does NOT go through
  // it (main.js:1788-1789 says so verbatim); the two void-drop respawns at
  // `controller.js:773` and `:1009` are two more; `ctrl.setHome` at `:1100`
  // moves the destination of the other three. 2c wires all five to this one
  // call — see PROGRESS-0051-2a.md.
  //
  // §2.3's rule, and the reason worst-case FINE concurrency is 64 + 64 = 128
  // and not 112 + 64: the source's L1..LF sets are marked evictable BEFORE the
  // destination's L0 block is built. Dropping the old pin does exactly that —
  // everything that is not the player's own required set becomes tier-2
  // eviction fodder the moment the pin goes.
  const pinKey = (p) => T.tileId(0, ...T.tileIndexAt(0, p.x, p.y)).replace('/0/', '/pin/');

  function pinWant(p) {
    const idx = T.tileIndexAt(0, p.x, p.y);
    const si = blockStart(idx[0]), sj = blockStart(idx[1]);
    const D = T.levelDef(0), m = new Map();
    for (let dj = 0; dj < 8; dj++) for (let di = 0; di < 8; di++) {
      const tx = si + di, ty = sj + dj;
      m.set(T.tileId(0, tx, ty), mkWant(0, tx, ty, D, p.x, p.y));
    }
    return m;
  }

  function pinSync(dest, path) {
    const p = enuOf(dest);
    const t0 = nowMs();
    if (!p) return Promise.resolve({ ok: false, reason: 'no destination', frames: 0, ms: 0, tiles: 0 });
    const key = pinKey(p);
    // D-19 — A RE-HOME IS A DISCONTINUITY AND IT IS KNOWN HERE FIRST. The five
    // §2.8 paths call this BEFORE the body is moved (main.js:1991 pins, then
    // `rawTeleport`), so re-centring here evicts the source and starts the
    // destination's L0 block one whole frame before `tick`'s own detector would
    // see the jump — which is what puts the required set under the first
    // rendered frame at the destination instead of one frame after it.
    if (coreCentre && isJump(coreCentre, p)) reHome(p, path || 'pin');
    // already standing on it: a re-home path may call this on every respawn and
    // most respawns do not move the player's L0 block at all.
    if (pinnedAt(p)) return Promise.resolve({ ok: true, frames: 0, ms: 0, tiles: 64, already: true, center: p });
    pins.clear();                       // the source's rings become evictable FIRST
    dirty = true;
    const w = pinWant(p);
    pins.set(key, { want: w, center: p });
    for (const [id, ww] of w) {
      if (resident.has(id)) continue;
      const j = pending.get(id) || startJob(ww);
      j.pin = true;
      pending.set(id, j);
    }
    // §2.3, in one line: the source keeps its L0 block protected and DEMOTES
    // its L1..LF sets to evictable before the destination's block is built.
    // 64 protected + 64 pinned = 128 of the 144 FINE slots, which is where the
    // pool size came from.
    const req = new Set(w.keys());
    for (const [id, ww] of want) if (ww.level === 0) req.add(id);
    requiredIds = req;
    for (const [id, ww] of w) if (!want.has(id)) want.set(id, ww);
    wantIds = new Set(want.keys());
    const st = { key, center: p, frames: 1, t0, resolve: null };
    const pr = new Promise((res) => { st.resolve = res; });
    pinPending = st;
    // the first pass is SYNCHRONOUS — a re-home path that cannot await still
    // gets ground under the destination before it returns.
    work(nowMs() + pinBudget(st, PIN_FRAMES));
    if (pinResident(w)) settle(st, w.size);
    return pr;
  }

  // §2.8 says FIVE FRAMES, not "64 ms a frame for as long as it takes", so the
  // budget is whatever five frames of it costs on THIS box: tiles still to
  // build x the measured per-tile time, divided by the frames left. 1a's quiet
  // box builds a FINE tile in 3.95 ms (red-dog) / 5.07 ms (siberia), which is
  // 64 ms a frame for a 64-tile block — the floor below. Under agent load the
  // same tile measures 9-11 ms here, and a fixed 64 ms floor took SIX frames on
  // siberia. A teleport hitch is the price of the guarantee; the guarantee is
  // the thing §2.8 states.
  function pinBudget(st, framesLeftIn) {
    const pin = pins.get(st.key);
    if (!pin) return PIN_BUDGET_MS;
    const left = pin.want.size - countResident(pin.want);
    const framesLeft = Math.max(1, framesLeftIn);
    const tileMs = Math.max(0.5, rowMs * (SHAPES.FINE.n + 1));
    return Math.min(PIN_BUDGET_CAP_MS, Math.max(PIN_BUDGET_MS, (left * tileMs) / framesLeft));
  }

  const pinResident = (w) => { for (const id of w.keys()) if (!resident.has(id)) return false; return true; };

  // called at the end of every tick while a pin is in flight (§2.8: "resolves
  // in <= 5 frames"). The frame budget is PIN_BUDGET_MS while it is, which is
  // what buys the 64 tiles: 1a measured a FINE tile at 3.95 ms red-dog /
  // 5.07 ms siberia, so 64 ms of budget is 12-16 tiles a frame.
  function settlePin() {
    const st = pinPending;
    const pin = pins.get(st.key);
    if (!pin) { pinPending = null; return; }
    st.frames++;
    if (pinResident(pin.want)) { settle(st, pin.want.size); return; }
    if (st.frames >= 24) {              // a hard stop, so a promise can never hang
      pinPending = null;
      pins.delete(st.key); dirty = true;
      st.resolve({ ok: false, reason: 'pin did not resolve', frames: st.frames,
                   ms: +(nowMs() - st.t0).toFixed(1), tiles: countResident(pin.want), center: st.center });
    }
  }

  // A PIN IS TRANSIENT, and §2.3's slot arithmetic is why. The pool holds the
  // player's 112 FINE plus a 64-tile pin only as a CONCURRENCY (128 of 144);
  // holding a pin forever would make 176 the steady state and the pool would
  // thrash. So the pin is released the moment it has resolved: its tiles stay
  // resident, fall out of the wanted set, and are reclaimed through the 2.0 s
  // grace list if nothing has arrived to want them — which, on all five paths,
  // is exactly when the player did not end up there.
  function settle(st, tiles) {
    pinPending = null;
    pins.delete(st.key);
    dirty = true;
    st.resolve({ ok: true, frames: st.frames, ms: +(nowMs() - st.t0).toFixed(1), tiles, center: st.center });
  }

  const countResident = (w) => { let n = 0; for (const id of w.keys()) if (resident.has(id)) n++; return n; };

  function pinnedAt(dest) {
    const p = enuOf(dest);
    if (!p) return false;
    const w = pinWant(p);
    return pinResident(w);
  }

  function unpin(dest) {
    if (dest === undefined) { const n = pins.size; pins.clear(); return n > 0; }
    const p = enuOf(dest);
    return p ? pins.delete(pinKey(p)) : false;
  }

  // ================================================== §2.9 drain() / freeze()
  // "resolves when the pending queue is empty, the grace list is flushed, every
  // in-flight transfer has landed, and the residency centre equals a
  // caller-supplied deterministic point. It DOES NOT SNAP uMorph — the drained
  // state is the steady state the player actually sees, so C15 gates a real
  // frame" (D-7). The determinism is bought by dropping the velocity lead:
  // during a drain the centre IS the given point, so two drains from the same
  // point ask for the same 243 tiles in the same order.
  async function drain(at) {
    const p = at ? enuOf(at) : (coreCentre || { x: 0, y: 0 });
    coreCentre = p; centre = p;
    headX = 0; headY = 0;
    dirty = true;
    recompute();
    let guard = 0;
    while (pending.size && guard++ < 4000) work(nowMs() + 1e9);
    for (const [id, g] of [...grace]) { grace.delete(id); freeTile(g.tile, 'drain'); }
    trySwapFloor(false);            // §5.1 — a drained scene is a swapped scene
    if (source && source.drain) await source.drain();   // 1b's determinism set + probes
    return true;
  }

  // ==================================================== the harness surfaces
  // check 4 (§7.4.4): "after a drained boot, exactly 64 L0 + 48 L1 + 48 L2 +
  // 48 L3 + <= 35 LF slots occupied, BY NAME (`tile:L0:i:j`); after a 2 km
  // traverse and return, the same counts, pool free-lists intact,
  // `__chunks.refusals === 0`. Guaranteed reach asserted from 64 worst-case
  // player positions per level."
  const EXPECT = { 0: 64, 1: 48, 2: 48, 3: 48 };

  function residency() {
    const byLevel = {}, names = {};
    for (const L of LEVELS) { byLevel[L.level] = 0; names[L.level] = []; }
    let named = 0;
    for (const t of resident.values()) {
      byLevel[t.level]++;
      if (names[t.level].length < 4) names[t.level].push(t.mesh.name);
      if (t.mesh.name === T.tileName(t.level, t.tx, t.ty)) named++;
    }
    const usedF = pools.FINE.slots.filter((s) => s.used).length;
    const usedC = pools.COARSE.slots.filter((s) => s.used).length;
    // The LF ceiling is lfGrid().count — the whole anchored grid over the rim
    // box — because L3's 4 x 4 LF footprint only subtracts while the player is
    // interior, and subtracts less the nearer the world edge he is. 35 was that
    // count on the pre-widen anchor; it is 48 on this one. See lfGrid().
    const lf = lfGrid();
    const countsOk = byLevel[0] === EXPECT[0] && byLevel[1] === EXPECT[1]
                  && byLevel[2] === EXPECT[2] && byLevel[3] === EXPECT[3] && byLevel[LF] <= lf.count;
    const freeOk = pools.FINE.free.length + usedF === SLOTS.FINE
                && pools.COARSE.free.length + usedC === SLOTS.COARSE
                && pools.FINE.slots.length === SLOTS.FINE
                && pools.COARSE.slots.length === SLOTS.COARSE;
    const reach = reachProof();
    // The §1.3 counts are a statement about a DRAINED state at a settled
    // centre. While the player is moving, the wanted set is the union of the
    // player's own residency and the lead's (§2.7's prefetch), so L0 legitimately
    // runs to 8 x 10 and the grace list adds up to 30 more — every one of them
    // inside the pool, which is what `freeOk` and `refusals` prove. Check 4
    // drains first, so it reads the exact counts; a moving read reports them
    // and does not assert them.
    const drained = pending.size === 0 && grace.size === 0
                 && centre.x === coreCentre.x && centre.y === coreCentre.y;
    return {
      drained,
      ok: (drained ? countsOk : true) && freeOk && reach.ok && refusals === 0 && named === resident.size,
      byLevel, expect: { ...EXPECT, [LF]: `<=${lf.count} (${lf.nx}x${lf.ny} on the RX0/RY0 lattice)` },
      lfGrid: lf, namedOk: named === resident.size, names,
      pools: { FINE: { slots: SLOTS.FINE, used: usedF, free: pools.FINE.free.length, alloc: pools.FINE.slots.length },
               COARSE: { slots: SLOTS.COARSE, used: usedC, free: pools.COARSE.free.length, alloc: pools.COARSE.slots.length } },
      countsOk, freeOk, reachOk: reach.ok, reach: reach.rows,
      bytes: bytesNow(), poolBytes: pools.FINE.bytes + pools.COARSE.bytes,
      refusals, softHits, pending: pending.size, grace: grace.size,
      pins: pins.size, frames: frameNo, worldBox, stat: { ...stat },
    };
  }

  // §10.8 / §1.4's guarantee, proved rather than quoted: for 64 worst-case
  // positions per level — an 8 x 8 phase grid across one tile, corners
  // included — the distance from the player to the nearest EDGE of the resident
  // block at that level is >= the level's min reach. L0 >= 192 m, L1 >= 384 m.
  function reachProof(n = 8) {
    const rows = [];
    for (const L of LEVELS) {
      if (!L.core) continue;
      const span = L.span, R = G.RASTER;
      let worst = Infinity, worstAt = null;
      // any tile of the level will do — the lattice is uniform and the phase is
      // fixed on RX0/RY0 (§1.1), so the guarantee is a property of the level,
      // not of where the player happens to be. The crop centre keeps it
      // deterministic across runs and across worlds.
      const c = coreCentre || { x: (T.CROP.x0 + T.CROP.x1) / 2, y: (T.CROP.y0 + T.CROP.y1) / 2 };
      const ci = T.tileIndexAt(L.level, c.x, c.y);
      const base = T.tileRect(L.level, ci[0], ci[1]);
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const x = base.x0 + (a / (n - 1)) * span * 0.999999;
          const y = base.y0 + (b / (n - 1)) * span * 0.999999;
          const idx = T.tileIndexAt(L.level, x, y);
          const si = blockStart(idx[0]), sj = blockStart(idx[1]);
          const bx0 = R.RX0 + si * span, bx1 = bx0 + 8 * span;
          const by0 = R.RY0 + sj * span, by1 = by0 + 8 * span;
          const d = Math.min(x - bx0, bx1 - x, y - by0, by1 - y);
          if (d < worst) { worst = d; worstAt = [+x.toFixed(2), +y.toFixed(2)]; }
        }
      }
      rows.push({ level: L.level, span, samples: n * n, minReach: L.minReach,
                  guaranteed: +worst.toFixed(3), worstAt, ok: worst >= L.minReach - 1e-6 });
    }
    return { ok: rows.every((r) => r.ok), rows };
  }

  // "after a 2 km traverse and return, the same counts, free lists intact".
  // The traverse is of the RESIDENCY CENTRE, which is the thing under test —
  // it needs no player, no physics and no frame loop, so it measures the
  // scheduler rather than the ride.
  async function traverseProof(metres = 2000, steps = 8) {
    const home = { ...(coreCentre || { x: 0, y: 0 }) };
    const before = residency();
    const r0 = refusals;
    let peakF = 0, peakC = 0, worst = null;
    const at = async (x, y) => {
      await drain({ ex: x, ey: y });
      const r = residency();
      peakF = Math.max(peakF, r.pools.FINE.used); peakC = Math.max(peakC, r.pools.COARSE.used);
      if (!r.ok && !worst) worst = r;
    };
    for (let i = 1; i <= steps; i++) await at(home.x + (metres * i) / steps, home.y);
    for (let i = steps - 1; i >= 0; i--) await at(home.x + (metres * i) / steps, home.y);
    const after = residency();
    return {
      metres, steps, ok: before.ok && after.ok && refusals === r0 && !worst,
      before: before.byLevel, after: after.byLevel,
      sameCounts: JSON.stringify(before.byLevel) === JSON.stringify(after.byLevel),
      freeOk: after.freeOk, refusalsBefore: r0, refusalsAfter: refusals,
      peakUsed: { FINE: peakF, COARSE: peakC, slots: SLOTS },
      worst: worst ? { byLevel: worst.byLevel, countsOk: worst.countsOk, freeOk: worst.freeOk } : null,
    };
  }

  // The banded builder above is a PORT of tiles.mjs's `tileTerrain` loop. This
  // is the assertion that it is a faithful one: build a tile both ways and
  // compare all four arrays byte for byte. A port that drifts fails here rather
  // than in a seam nobody looks at.
  function parityProof(level = 0) {
    const idx = T.tileIndexAt(level, (coreCentre || { x: 0 }).x, (coreCentre || { y: 0 }).y);
    const w = mkWant(level, idx[0], idx[1], T.levelDef(level), 0, 0);
    const j = startJob(w);
    j.id = 'parity:' + j.id;
    let guard = 0;
    while (!buildBand(j, BAND_ROWS) && guard++ < 512) { /* bands */ }
    if (!j.slot) return { ok: false, reason: 'no slot for the parity tile' };
    const ref = T.tileTerrain(null, w.rect, w.spacing).arrays;
    const cmp = (a, b) => {
      const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
      if (x.length !== y.length) return -1;
      let n = 0;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++;
      return n;
    };
    const a = j.slot.arrays;
    const out = { level, tile: T.tileName(level, idx[0], idx[1]),
                  position: cmp(a.position, ref.position), normal: cmp(a.normal, ref.normal),
                  color: cmp(a.color, ref.color), morphZ: cmp(a.morphZ, ref.morphZ) };
    j.slot.used = false; pools[j.shape].free.push(j.slot);
    out.ok = out.position === 0 && out.normal === 0 && out.color === 0 && out.morphZ === 0;
    return out;
  }

  const bytesNow = () => { let b = 0; for (const t of resident.values()) b += t.bytes; return b; };

  function residencyHash() {
    let h = 0x811c9dc5;
    for (const id of [...resident.keys()].sort()) {
      for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // ================================================== §3.6's soft-hit counter
  // "`__chunks.softHits`, tagged by caller, must be 0 during the ride+ski,
  // glider and snowmobile probes (check 6); non-zero elsewhere is allowed and
  // logged with (x, z) and the missing level." 2c calls this once per soft
  // answer; nothing else in the program does.
  function softHit(tag, x, z, level) {
    softHits++;
    softByTag[tag || 'untagged'] = (softByTag[tag || 'untagged'] || 0) + 1;
    softLog.push({ tag: tag || 'untagged', x: +(+x).toFixed(2), z: +(+z).toFixed(2),
                   level: level === undefined ? null : level, t: frameNo });
    if (softLog.length > SOFT_LOG_MAX) softLog.shift();
    return softHits;
  }

  // ================================================ what the router asks for
  function residentTile(level, x, z) {
    const p = enuOf({ x, y: 0, z });
    const idx = T.tileIndexAt(level, p.x, p.y);
    return resident.get(T.tileId(level, idx[0], idx[1])) || null;
  }

  /** the finest resident COLLIDABLE level over (x, z), or null (§3.4's L0 -> L1
   *  -> soft dispatch, expressed once so 2c does not re-derive it). */
  function levelAt(x, z) {
    for (const L of LEVELS) {
      if (!L.collide) break;
      if (residentTile(L.level, x, z)) return L.level;
    }
    return null;
  }

  // ===================================== §9.1 3b — props, village, signs, lift bays
  //
  // §4.2 item 4's `feature-index.mjs` ships in both worlds and, until this row,
  // was read by nobody. `tagFeatureNodes(scene)` stamps every prop / village /
  // lift-bay / sign node with `{ id, kind, minLevel, aabb }`; this is the other
  // end of it — the scheduler deciding, tile by tile, which of them the resident
  // set covers.
  //
  // THE RULE. A feature is RESIDENT iff its footprint meets a resident tile of
  // a level at or below its `minLevel` (§1.3: L0 is the 192 m guarantee, L1 the
  // 384 m one). That is the same containment §1.4 proves for the lattice, so a
  // feature can never be resident at a coarse level and missing at a fine one.
  //
  // WHAT IT DOES NOT DO, AND WHY. `setFeatureVisible(false)` is the default:
  // residency is COMPUTED and REPORTED, and nothing is hidden. §7.2b authorises
  // exactly two C15/C16 re-records in the whole program and neither is this one,
  // and hiding a distant sign or the far half of the village is a pixel change
  // by definition — `markers.js:1028-1036` draws boards out to
  // `collision.bounds`' 6,420 m, twenty times the L1 guarantee. This is 2a's
  // `poolGroup.visible = false` decision applied to the second half of the
  // world: build the machinery, prove it, leave the switch for the wave that
  // owns the pixels.
  const features = [];
  let featureVisible = false, featureVersion = -1, residentVersion = 0;
  const featureResident = new Set();

  function collectFeatures() {
    scene.traverse((o) => {
      const f = o.userData && o.userData.chunkFeature;
      if (!f || !Array.isArray(f.aabb)) return;
      features.push({ id: f.id, kind: f.kind, minLevel: f.minLevel | 0, aabb: f.aabb,
                      tris: f.tris | 0, bytes: f.bytes | 0, name: o.name || '', node: o });
    });
    features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  collectFeatures();

  /** does any resident tile of `level` meet this box? */
  function boxHasResident(a, level) {
    const span = T.levelDef(level).span;
    const [i0, j0] = T.tileIndexAt(level, a[0], a[1]);
    const [i1, j1] = T.tileIndexAt(level, a[2], a[3]);
    // a feature wider than the level's whole resident block cannot be answered
    // by walking its own range cheaply, so walk the resident set instead
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 512) {
      for (const t of resident.values()) {
        if (t.level !== level) continue;
        const r = t.rect;
        if (r.x1 < a[0] || r.x0 > a[2] || r.y1 < a[1] || r.y0 > a[3]) continue;
        return true;
      }
      return false;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (resident.has(T.tileId(level, i, j))) return true;
    }
    return false;
  }

  function updateFeatures(force) {
    if (!features.length) return;
    if (!force && featureVersion === residentVersion) return;
    featureVersion = residentVersion;
    featureResident.clear();
    for (const f of features) {
      let on = false;
      for (let L = 0; L <= f.minLevel && !on; L++) on = boxHasResident(f.aabb, L);
      f.resident = on;
      if (on) featureResident.add(f.id);
      if (featureVisible) f.node.visible = on;
    }
  }

  /** the census §9.1's done-when asks to see: how much of the world's prop,
   *  village, lift-bay and sign geometry the resident set covers right now. */
  function featureStats() {
    updateFeatures(true);
    const byKind = {};
    let resTris = 0, totTris = 0, resBytes = 0, totBytes = 0, res = 0;
    for (const f of features) {
      const k = byKind[f.kind] || (byKind[f.kind] = { total: 0, resident: 0, tris: 0, residentTris: 0 });
      k.total++; k.tris += f.tris; totTris += f.tris; totBytes += f.bytes;
      if (f.resident) { k.resident++; k.residentTris += f.tris; res++; resTris += f.tris; resBytes += f.bytes; }
    }
    return {
      nodes: features.length, resident: res, byKind,
      tris: totTris, residentTris: resTris, bytes: totBytes, residentBytes: resBytes,
      applied: featureVisible,
      // the one number that says how far node granularity gets us: a node whose
      // own footprint is wider than the L1 guarantee is resident wherever the
      // player stands, and splitting it is wave 4a's business, not this row's.
      worldSpanning: features.filter((f) => {
        const a = f.aabb, span = T.levelDef(f.minLevel).span;
        return Math.max(a[2] - a[0], a[3] - a[1]) > span * 8;
      }).map((f) => ({ name: f.name, kind: f.kind, tris: f.tris,
                       span: +Math.max(f.aabb[2] - f.aabb[0], f.aabb[3] - f.aabb[1]).toFixed(1) })),
    };
  }

  // ============================================ §7.4 check 9 — what batching buys
  // Printed rather than asserted-by-comment: how many draws the pool costs on
  // each path, what the batch's index cost is against §6.2's shared-index line,
  // and the vertex bytes both paths share (which is §2.3's number, unmoved).
  function batchStats() {
    if (!batchSets) {
      return { enabled: false, reason: typeof THREE.BatchedMesh === 'function'
        ? 'opts.batch === false' : 'this three build has no BatchedMesh',
        batches: 0, meshDraws: resident.size };
    }
    const rows = [];
    let batches = 0, indexBytes = 0, vertexBytes = 0, instances = 0;
    for (const k of ['FINE', 'COARSE']) {
      const B = batchSets[k];
      batches += B.batches.length;
      indexBytes += B.indexBytes;
      vertexBytes += pools[k].bytes;
      instances += SLOTS[k];
      rows.push({ shape: k, batches: B.batches.length, slotsPerBatch: B.per,
                  slots: SLOTS[k], indexBytes: B.indexBytes, indexType: B.indexType });
    }
    const sharedIdx = T.sharedIndex(SHAPES.FINE).byteLength + T.sharedIndex(SHAPES.COARSE).byteLength;
    return {
      enabled: true, drawMode, rows, batches, instances,
      vertexBytes,                       // §2.3 — 26,879,488, unmoved: the slots VIEW these
      indexBytes,                        // the price of the batch
      sharedIndexBytes: sharedIdx,       // §6.2's line, still there for the Mesh path
      indexDelta: indexBytes,            // what 3b adds to §6.2
      meshDraws: resident.size,          // what the Mesh path would cost right now
      batchDraws: batches,               // what the batch path costs, resident or not
    };
  }

  // ================================================================= the handle
  // One object, published by main.js as BOTH `window.__player.chunks` and
  // `window.__chunks` — the harness reads the first for `drain()` and the
  // second for `refusals`/`softHits`/`residency()`, and they must not be able
  // to disagree, so they are the same reference.
  //
  // Everything wave 1b published is DELEGATED THROUGH unchanged, so checks 3
  // (drain determinism), 5 (seam continuity) and 12 (LOD pop / morph band) read
  // exactly the numbers they read at 1b and this wave cannot quietly move them.
  const dele = (k) => (...a) => (source && typeof source[k] === 'function' ? source[k](...a) : null);

  const handle = {
    ok: true, reason: '',
    tick, drain, pinSync, unpin, pinnedAt, softHit, residency, reachProof,
    bytes: bytesNow,          // §7.4.8 / §2.9 write it as a call: `chunks.bytes()`
    traverseProof, parityProof, residencyHash, residentTile, levelAt,
    freeze(v = true) { frozen = v !== false; return frozen; },
    frozen: () => frozen,
    setVisible(v) { poolGroup.visible = v !== false; return poolGroup.visible; },
    visible: () => poolGroup.visible,
    // ------------------------------------------------------ §5.1, wave 4a
    // The floor swap, readable and forceable. `swapFloor()` is what a probe
    // that wants the lattice on screen NOW calls; `floor()` is what the sheet
    // and PROGRESS print.
    swapFloor: () => trySwapFloor(true),
    floor: () => ({ swapped: floorSwapped, legacy: legacyFloor.length,
                    hidden: legacyFloor.filter((m) => !m.visible).length,
                    drawMode, names: legacyFloor.map((m) => m.name) }),
    // ------------------------------------------------ §7.4 check 9, wave 3b
    // Which of the two draw paths the pool group would use if it were drawn.
    // 'mesh' is 2a's — one Mesh per slot, up to 227 draws at a drained boot.
    // 'batch' is the BatchedMesh set — `batchStats().batches` draws for the
    // whole pool. Both cover the same bytes; only one may be visible at a time
    // or the same triangles are submitted twice.
    setDrawMode(m) {
      drawMode = m === 'batch' ? 'batch' : 'mesh';
      for (const k of ['FINE', 'COARSE']) {
        for (const s of pools[k].slots) s.mesh.visible = drawMode === 'mesh' && s.used;
        if (batchSets) for (const b of batchSets[k].batches) b.mesh.visible = drawMode === 'batch';
      }
      return drawMode;
    },
    drawMode: () => drawMode,
    batchStats,
    // ----------------------------------------- §9.1 3b — the feature index's consumer
    features: featureStats,
    featureResident: (id) => featureResident.has(id),
    setFeatureVisible(v) {
      featureVisible = v !== false;
      updateFeatures(true);
      if (!featureVisible) for (const f of features) f.node.visible = true;
      return featureVisible;
    },
    // ------------------------------------------------- §5.3 / §5.4, wave 3a
    // `instances()` is what "print resident instance counts per level" means:
    // the per-level totals, the per-mesh occupancy against its capacity, the
    // instance triangles and the pool's permanent byte cost. `instCensus()` is
    // check 7's read of the same pool by (species, tier).
    instances: () => (instPool ? { ...instPool.counts(), overflow: instOverflow } : null),
    instCensus: () => (instPool ? instPool.census() : null),
    // ------------------------------------------------------ D-19, check 16
    // The trunks. `stemCensus()` is the pool's ledger; `stemsOf(tileId)` is one
    // tile's slice of it. Both read zero on a world with no stem set, which is
    // the truth for that world rather than a lie about one.
    stemCensus: () => (instPool ? instPool.stemStats() : null),
    stemsOf: (id) => (instPool ? instPool.stemsOf(id) : []),
    // ------------------------------------------------------ D-19, check 15
    // The three reads a teleport has to be judged on, and they are the
    // lattice's OWN answers rather than the probe's re-derivation of them:
    //   `requiredAt(p)`  what §1.3 says must be resident with the player at p
    //   `residentIds()`  what actually is
    //   `wouldForest()`  what the world DATA says a tile carries, sampled
    //                    straight out of tiles.mjs, so "a required tile that is
    //                    forested and empty" is a fact about the world and not
    //                    about what happens to be in the pool.
    requiredAt(p) {
      const q = enuOf(p) || coreCentre || { x: 0, y: 0 };
      const m = residencyFor(q.x, q.y);
      const byLevel = {};
      for (const w of m.values()) byLevel[w.level] = (byLevel[w.level] || 0) + 1;
      return { centre: q, ids: [...m.keys()], byLevel, n: m.size };
    },
    residentIds: () => [...resident.keys()],
    residentRows: () => [...resident.values()].map((t) => ({ id: t.id, level: t.level, tx: t.tx, ty: t.ty,
                                                             instN: t.instN, dist: t.dist,
                                                             // a PLAIN copy: `t.rect` is the tile's own object and
                                                             // handing it across an evaluate boundary would hand a
                                                             // probe a live reference into the scheduler's state
                                                             rect: { x0: t.rect.x0, y0: t.rect.y0, x1: t.rect.x1, y1: t.rect.y1 } })),
    wouldForest(level, tx, ty) {
      if (!T.tileFeatures) return null;
      const f = T.tileFeatures(level, tx, ty);
      let trees = 0;
      for (const c of f) if (c.kind !== 1) trees++;
      return { total: f.length, trees };
    },
    /** D-19 / check 15 — the one read a fast travel is judged on, computed by
     *  the lattice about itself so the harness cannot drift from it.
     *
     *  `stale` is geometric (STALE_SPANS above) and NOT "resident minus want":
     *  a set difference would be the scheduler grading its own bookkeeping,
     *  and the bug being gated is precisely bookkeeping that was wrong.
     *  `staleInst` is the forest that came with those tiles — the trees Greg
     *  saw standing where the world has none.
     *
     *  `missingForested` is counted over L0 and L1 ONLY. Those are the levels
     *  the player sees an individual tree at and the two the router collides
     *  (§1.3, ROUTER_LEVELS); an L3 tile is 512 m of ground drawn as impostors
     *  from 768 m away, and sampling 256 sub-tiles of it per missing tile would
     *  put seconds into a check to answer a question about a smudge on the
     *  horizon. The full `missing` count is reported for every level. */
    teleportCensus(p) {
      const q = enuOf(p) || coreCentre || { x: 0, y: 0 };
      const need = residencyFor(q.x, q.y);
      let stale = 0, staleInst = 0; const staleRows = [];
      for (const t of resident.values()) {
        if (t.level === LF) continue;
        const span = T.levelDef(t.level).span;
        const r = t.rect, cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        const d = Math.hypot(cx - q.x, cy - q.y);
        if (d <= STALE_SPANS * span) continue;
        stale++; staleInst += t.instN || 0;
        if (staleRows.length < 6) staleRows.push({ id: t.id, d: +d.toFixed(1), limit: STALE_SPANS * span, instN: t.instN || 0 });
      }
      const missing = [], missByLevel = {};
      for (const [id, w] of need) {
        if (resident.has(id)) continue;
        missing.push(id);
        missByLevel[w.level] = (missByLevel[w.level] || 0) + 1;
      }
      let missingForested = 0; const mfRows = [];
      for (const id of missing) {
        const w = need.get(id);
        if (!w || w.level > 1 || !T.tileFeatures) continue;
        let trees = 0;
        for (const c of T.tileFeatures(w.level, w.tx, w.ty)) if (c.kind !== 1) trees++;
        if (trees > 0) { missingForested++; if (mfRows.length < 6) mfRows.push({ id, trees }); }
      }
      return { centre: q, required: need.size, resident: resident.size,
               stale, staleInst, staleRows,
               missing: missing.length, missByLevel, missingForested, mfRows,
               refusals, grace: grace.size, pending: pending.size,
               settling: settleUntil > 0, coreMissing: coreMissing(),
               reHome: rehome.last ? { ...rehome.last } : null,
               stems: instPool ? instPool.stemStats() : null };
    },
    reHome: () => ({ ...rehome, byPath: { ...rehome.byPath },
                     last: rehome.last ? { ...rehome.last } : null,
                     settling: settleUntil > 0, settleFrames: SETTLE_FRAMES,
                     coreSize: coreIds.size, coreMissing: coreMissing(),
                     coreResident: coreResident() }),
    instHighWater: () => (instPool ? instPool.highWater() : null),
    instVisible(v) { return instPool ? instPool.setVisible(v) : false; },
    /** check 7's per-tile RNG half: build one tile's instances twice and diff
     *  the two matrices bit-exactly. Nothing is added to the pool — this reads
     *  the sampler, which is the thing §7.4.7 asks to be deterministic. */
    instDeterminism(level = 0, tx = null, ty = null) {
      if (!instPool) return null;
      const c = coreCentre || { x: 0, y: 0 };
      const at = tx == null ? T.tileIndexAt(level, c.x, c.y) : [tx, ty];
      const one = () => {
        const a = new Float32Array(T.instCap(level) * T.INST_STRIDE);
        const ST = T.subTiles(level, at[0], at[1]);
        let n = 0;
        for (let k = 0; k < ST.n; k++) {
          const list = [];
          T.l0Candidates(ST.bx + (k % ST.step), ST.by + ((k / ST.step) | 0), undefined, level, list);
          n += T.writeInstances(list, a, n * T.INST_STRIDE);
        }
        return { a, n };
      };
      const A = one(), B = one();
      let diff = 0, first = -1;
      for (let i = 0; i < A.n * T.INST_STRIDE; i++) {
        if (A.a[i] !== B.a[i]) { diff++; if (first < 0) first = i; }
      }
      return { level, tx: at[0], ty: at[1], instances: A.n, second: B.n,
               diff: A.n !== B.n ? Infinity : diff, first,
               ok: A.n === B.n && diff === 0 };
    },
    // ---------------------------------------------- §7.4.10 / D-14, wave 4c
    // The pool's own allocation ledger. Check 10 brackets a traverse with two
    // of these and asserts the DELTA is 0 constructed / 0 disposed; the
    // page-wide `BufferGeometry` count it also prints is information, because
    // guide.js's stage props are a legitimate page-wide construct/dispose and
    // §10.7's claim was only ever about the pools.
    alloc: () => poolAllocSnapshot(),
    /** Is this geometry one of ours? The harness uses the registry symbol
     *  directly on the objects it sweeps; this is the same question asked
     *  through the handle, for anything that has one. */
    isPoolGeometry: (g) => !!(g && g[POOL_TAG]),
    resetSoftHits() { softHits = 0; softLog.length = 0; for (const k of Object.keys(softByTag)) delete softByTag[k]; },
    resetRefusals() { refusals = 0; },
    subscribe(cb) { subs.add(cb); return () => subs.delete(cb); },
    tiles: () => [...resident.values()],
    stats: () => ({
      slots: { ...SLOTS }, poolBytes: pools.FINE.bytes + pools.COARSE.bytes,
      resident: resident.size, bytes: bytesNow(), refusals, softHits,
      pending: pending.size, grace: grace.size, frames: frameNo,
      budgetMs: BUDGET_MS, bandRows: bandRows(), rowMs: +rowMs.toFixed(4), worldBox, ...stat,
      batch: batchStats(),
      features: featureStats(),
      lattice: source && source.stats ? source.stats() : null,
    }),
    levels: () => (source && source.levels ? source.levels() : LEVELS.map((L) => ({ ...L }))),
    crop: dele('crop'),
    // --------------------------------------------------- wave 1b, delegated
    sceneHash: dele('sceneHash'), seamProbe: dele('seamProbe'), morphBand: dele('morphBand'),
    forestProof: dele('forestProof'), buildAll: dele('buildAll'),
    // --------------------------------------------------- §7.4 check 12, wave 4a
    // THE RIG HAS TO HIDE THE FLOOR, AND THE FLOOR MOVED. `tiles.mjs lodProbe`
    // blanks the world by walking `scene.children` of the scene IT was handed —
    // world.mjs's — and hiding every visible mesh, so that "every pixel that
    // changes between two frames is geometry changing level rather than the view
    // changing" (chunkgate's own words). The scheduler's pool and its forest hang
    // off main.js's `play:zup` scene, which that walk does not reach; while the
    // pool was `visible = false` (waves 2a-3c) that cost nothing, and the moment
    // §5.1 turned it on it put a second, unchanging floor UNDER the rig — one the
    // rig's L0 tiles z-fight with as they pop in, which is per-frame pixel change
    // that is not the LOD step. Measured on the export build: 0.1775 % with the
    // pool left drawn, against a 0.15 % cap and 0.0597 % at gate W3.
    // So the pool blanks itself, here, where it is owned — and puts itself back.
    lodProbe(...a) {
      if (!source || typeof source.lodProbe !== 'function') return null;
      rigHidden = { pool: poolGroup.visible, inst: instPool ? instPool.group.visible : null };
      poolGroup.visible = false;
      if (instPool) instPool.setVisible(false);
      return source.lodProbe(...a);
    },
    lodStep: dele('lodStep'),
    lodEnd(...a) {
      const r = source && typeof source.lodEnd === 'function' ? source.lodEnd(...a) : false;
      if (rigHidden) {
        poolGroup.visible = rigHidden.pool;
        if (instPool && rigHidden.inst != null) instPool.setVisible(rigHidden.inst);
        rigHidden = null;
      }
      return r;
    },
    source: () => source,
    dispose() {
      scene.remove(poolGroup);
      for (const k of ['FINE', 'COARSE']) for (const s of pools[k].slots) s.geom.dispose();
      if (batchSets) for (const k of ['FINE', 'COARSE']) for (const b of batchSets[k].batches) b.mesh.dispose();
      resident.clear(); pending.clear(); grace.clear(); pins.clear();
    },
  };
  Object.defineProperties(handle, {
    refusals: { get: () => refusals, enumerable: true },
    instOverflow: { get: () => instOverflow, enumerable: true },
    softHits: { get: () => softHits, enumerable: true },
    softHitLog: { get: () => softLog.slice(), enumerable: true },
    softHitsByTag: { get: () => ({ ...softByTag }), enumerable: true },
    residentBytes: { get: () => bytesNow(), enumerable: true },
    resident: { get: () => {
      const byLevel = {};
      for (const L of LEVELS) byLevel[L.level] = 0;
      let f = 0, c = 0;
      for (const t of resident.values()) { byLevel[t.level]++; if (t.shape === 'FINE') f++; else c++; }
      return { total: resident.size, FINE: f, COARSE: c, byLevel };
    }, enumerable: true },
  });
  return handle;
}

// ===========================================================================
// THE BATCH — specs/0051 §7.4 check 9, wave 3b.
//
// WHY IT EXISTS. Check 9 gates `drawCalls` against an unchanged 250. A drained
// boot holds 227 tiles (64 L0 + 48 L1 + 48 L2 + 48 L3 + 19 LF, measured, gate
// W2 check 4) and today's world already spends 147 of the 250, leaving 103 of
// headroom. 227 pooled Meshes do not fit in 103 however the frustum falls, and
// per-object culling is a best case, not a guarantee — the same distinction
// §1.4 makes about reach. So the lattice needs ONE draw for many tiles, which
// is what `THREE.BatchedMesh` is (present in this build, r180; 1a #4 measured
// `setGeometryAt` at 0.32 ms/swap).
//
// WHY IT COSTS WHAT IT COSTS, AND WHY THE VERTICES ARE NOT PAID FOR TWICE.
// `BatchedMesh._initializeGeometry` (three.core.js:27241) allocates its own
// attribute arrays over `maxVertexCount`, and `setGeometryAt` (:27574) copies
// each slot's vertices in and writes each slot's indices with the slot's vertex
// offset BAKED IN — a batch cannot share §1.2's one-index-per-shape the way 144
// separate Meshes can. Two consequences, both taken deliberately:
//   * VERTICES: the pool does not allocate its own arrays at all any more. Every
//     slot's four typed arrays are `subarray` VIEWS into the batch's attribute
//     arrays, so §2.3's 26,879,488 B is exactly what it was and §10.7's "the
//     pools never grow" is untouched. The banded builder writes straight into
//     the batch's memory; there is no copy and no `setGeometryAt` in the steady
//     loop.
//   * INDEX: the batch pays for one expanded index per slot. Batches are cut so
//     that no batch exceeds 65,535 vertices, which is the line three.js uses to
//     pick Uint16 over Uint32 (three.core.js:27264) — that halves the bill.
//     FINE 144 x 26,112 x 2 = 7,520,256 B, COARSE 160 x 6,912 x 2 = 2,211,840 B,
//     TOTAL 9,732,096 B, against §6.2's 66,048 B shared-index line. That is a
//     real regression and it is declared, not averaged away (PROGRESS-0051-3b).
//
// WHAT IT DOES NOT DO YET. The batch is built and is NOT DRAWN — it hangs under
// the same `chunks:pool` group 2a left `visible = false`, because §7.2b
// authorises exactly two C15/C16 re-records in the program and neither of them
// is this one. It is the draw path the pixel-swap wave inherits, and check 9
// counts it. One thing that wave must add: §1.8's per-tile `uMorph` is a
// per-slot material uniform today and a batch has ONE material, so morph has to
// move to a per-instance lookup (`getIndirectIndex(gl_DrawID)` into a small
// DataTexture) before the batch can be the thing on screen.
// ===========================================================================
export const BATCH_MAX_VERTS = 65535;   // three.core.js:27264 — u16 above this becomes u32

function makeBatchSet(THREE, T, S, n, baseMaterial) {
  const idx = T.sharedIndex(S);
  const VT = S.verts + S.skirt;
  const per = Math.max(1, Math.min(n, Math.floor(BATCH_MAX_VERTS / VT)));
  // one prototype geometry, handed to `addGeometry` n times and thrown away:
  // every tile of a shape has identical topology (§1.2), so the batch's index
  // for slot k is this index plus k's vertex offset and nothing else.
  // D-14: the prototype is ours, is constructed at boot and IS disposed at the
  // bottom of this function — tagged so that construct/dispose pair lands in
  // the pool's own ledger (before check 10's bracket opens) instead of in the
  // page-wide reading where it would look like a stray.
  const proto = tagPoolGeometry(new THREE.BufferGeometry(), `POOL:batch-proto:${S.id}`);
  proto.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VT * 3), 3));
  proto.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(VT * 3), 3));
  proto.setAttribute('color', new THREE.Uint8BufferAttribute(new Uint8Array(VT * 4), 4, true));
  proto.setAttribute('morphZ', new THREE.BufferAttribute(new Float32Array(VT), 1));
  proto.setIndex(new THREE.BufferAttribute(idx, 1));
  const batches = [];
  let indexBytes = 0;
  for (let start = 0; start < n; start += per) {
    const count = Math.min(per, n - start);
    const mat = T.morphMaterial ? T.morphMaterial(THREE, baseMaterial || null)
                                : new THREE.MeshLambertMaterial({ vertexColors: true });
    const bm = new THREE.BatchedMesh(count, count * VT, count * idx.length, mat);
    // D-14: `BatchedMesh._initializeGeometry` (three.core.js:27241) constructs
    // a BufferGeometry of its own inside that `new`. It is ours by every
    // meaning of §10.7 — it holds the pool's vertices — so it is tagged here
    // rather than being left to the page-wide bucket.
    tagPoolGeometry(bm.geometry, `POOL:batch:${S.id}`);
    bm.name = `chunks:batch:${S.id}:${batches.length}`;
    bm.visible = false;
    bm.frustumCulled = false;
    bm.perObjectFrustumCulled = false;   // the slot spheres are rewritten every swap
    bm.sortObjects = false;
    bm.matrixAutoUpdate = false;         // tile vertices are already world-space
    // `addGeometry` reserves the storage and returns a GEOMETRY id;
    // `addInstance` is what actually draws one, and `setVisibleAt` keys off
    // that INSTANCE id (three.core.js:27421, :28006). One instance per slot.
    const ids = [], geoIds = [], ranges = [];
    for (let k = 0; k < count; k++) {
      const g = bm.addGeometry(proto, VT, idx.length);
      const id = bm.addInstance(g);
      bm.setVisibleAt(id, false);
      geoIds.push(g); ids.push(id);
      ranges.push(bm.getGeometryRangeAt(g));
    }
    const bi = bm.geometry.getIndex();
    indexBytes += bi ? bi.array.byteLength : 0;
    batches.push({ mesh: bm, material: mat, start, count, ids, geoIds, ranges, verts: count * VT });
  }
  proto.dispose();
  return { shape: S.id, per, batches, indexBytes, indexType: (per * VT) > BATCH_MAX_VERTS ? 'u32' : 'u16' };
}

// ===========================================================================
// POOL_INST — specs/0051 §2.2, §5.3, §5.4. Wave 3a.
//
// "`POOL_INST` does the same for forest: rewrite `instanceMatrix.array`, set
// `.count`, never reallocate." Read literally that is a per-tile InstancedMesh,
// which would put 250 draw calls of trees on top of 250 tiles and lose check 9
// on the first frame. So the pool is per PROTOTYPE, not per tile: one
// InstancedMesh for each (class, silhouette) the world bakes, one for the
// impostor and one per rock population — 11 meshes on red dog, 6 on siberia,
// CONSTANT in the number of resident tiles.
//
// A tile owns a contiguous BLOCK of instances inside each mesh it contributes
// to. Allocation is bump; free is SWAP-REMOVE — the last block is copied over
// the hole with `copyWithin` and its own record is re-pointed. No array is ever
// grown, no `InstancedMesh` is constructed after boot, and nothing is disposed:
// the same three properties check 10 asserts for the terrain pools, for the
// same reason and by the same means.
//
// Uploads are RANGED (`addUpdateRange`), because a whole-buffer upload of the
// impostor mesh is 3.1 MB and a tile swap touches a few kilobytes of it.
//
// The per-tile INSTANCE CAP lives in `tiles.mjs` (`instCap`), one per level,
// and a tile that reached it reports through `__chunks.instOverflow` instead of
// silently drawing a thinner stand.
// ===========================================================================
function makeInstPool(THREE, scene, protos, T, stems) {
  if (!protos || !THREE) return null;
  const meshes = [];
  const group = new THREE.Group();
  group.name = 'chunks:forest';
  const mk = (name, geo, capacity, castShadow, h) => {
    const mat = protos.material || new THREE.MeshLambertMaterial({ vertexColors: true });
    const im = new THREE.InstancedMesh(geo, mat, capacity);
    // D-14: the prototype geometry was baked by the world (tiles.mjs / the
    // forest protos) and handed in — POOL_INST does not construct it, it
    // adopts it. Tag it anyway: from the tripwire's point of view it is pool
    // memory, and a tag is what makes a later `dispose()` of it count against
    // the pool row instead of vanishing into the page-wide line. If it was
    // already tagged (two meshes sharing one seed geometry) the tag is a
    // no-op and the counter does not double.
    tagPoolGeometry(geo, `POOL_INST:${name}`, true);
    im.name = name;
    im.castShadow = !!castShadow; im.receiveShadow = false;
    im.frustumCulled = false;          // instances span the whole resident ring
    im.count = 0;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // `hi` is §9.1 row 4a's "POOL_INST capacities re-sized FROM MEASUREMENT":
    // the high-water mark this mesh actually reached, so a capacity is a
    // measured peak plus a stated margin rather than a round number.
    const e = { name, im, arr: im.instanceMatrix.array, cap: capacity, used: 0, hi: 0,
                h: h || 1, blocks: new Map(), tris: (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3 };
    meshes.push(e); group.add(im);
    return meshes.length - 1;
  };
  // trees: [class][seed]
  const treeIdx = (protos.trees || []).map((t, cls) =>
    t.seeds.map((g, k) => mk(`tile-firs-${['big', 'mid', 'far'][cls]}-${k}`, g,
      t.capacity, t.castShadow, t.h)));
  const impIdx = protos.impostor
    ? mk('tile-firs-impostor', protos.impostor.geo, protos.impostor.capacity, false, protos.impostor.h)
    : -1;
  const rockIdx = (protos.rocks || []).map((r, i) =>
    mk(`tile-rocks-${i}`, r.geo, r.capacity, r.castShadow, 1));
  scene.add(group);

  const classH = protos.classH || [1, 1, 1];
  const farCls = Math.max(0, treeIdx.length - 1);

  /** which mesh draws this instance, and what its geometry's own height asks
   *  the scale to be multiplied by. §5.3's ladder: L0 the class's own
   *  silhouette, L1 the cheap one, L2+ the impostor. The scale compensation is
   *  what keeps the ladder a DETAIL change rather than a SIZE change — a 31 m
   *  fir drawn on the 22 m prototype is scaled 31/22, so nothing shrinks when
   *  the player crosses a tier boundary and check 12 sees a detail step, not a
   *  forest that ducks. */
  function pick(kind, cls, level, variant) {
    if (kind === 1) {
      const i = rockIdx[Math.min(cls | 0, rockIdx.length - 1)];
      return i === undefined ? -1 : (POOL_PICK[0] = i, POOL_PICK[1] = 1, POOL_PICK);
    }
    const c = Math.min(cls | 0, treeIdx.length - 1);
    if (level >= 2 && impIdx >= 0) { POOL_PICK[0] = impIdx; POOL_PICK[1] = classH[c]; return POOL_PICK; }
    const row = treeIdx[level >= 1 ? farCls : c];
    if (!row || !row.length) return -1;
    POOL_PICK[0] = row[(variant | 0) % row.length];
    POOL_PICK[1] = level >= 1 ? classH[c] / classH[farCls] : 1;
    return POOL_PICK;
  }
  const POOL_PICK = [0, 1];

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
        _v = new THREE.Vector3(), _s = new THREE.Vector3();

  /** write one instance into mesh `mi` at instance index `at`. */
  function put(mi, at, x, y, z, yaw, sc, zst, hmul) {
    const e = meshes[mi];
    _v.set(x, y, z);
    _e.set(0, 0, yaw, 'XYZ'); _q.setFromEuler(_e);
    const k = sc * hmul;
    _s.set(k, k, k * zst);
    _m.compose(_v, _q, _s);
    _m.toArray(e.arr, at * 16);
  }

  const stats = { instances: 0, overflow: 0, byLevel: [0, 0, 0, 0, 0], allocFail: 0 };
  const dirty = new Set();

  // ======================================================= §5.3 / D-19 — TRUNKS
  // "i can phase through trees in deployed version" (Greg, 2026-09-06). A fir
  // is not solid through the triangle soup — it never was, in either build:
  // `world.colliders` is an allowlist and no fir was ever on it. It is solid
  // through the STEM SET (solids.js), which `collision.js:411` harvests in ONE
  // traverse of the scene, cached per scene root in a WeakMap.
  //
  // Wave 3a moved the firs out of `world.mjs`'s whole-world instancing
  // (`world.mjs:1375`, `if (!TILE_FOREST)`) and in here. This pool's meshes are
  // built AFTER the router, hold `count = 0` until a tile lands, and are
  // rewritten on every swap — so that one traverse found nothing but the 70
  // `snags` world.mjs still instances itself, and 24,400 fir trunks stopped
  // existing for collision. Measured, 2026-09-06, same probe on both benches:
  // unchunked main 24,470 stems / chunked chunk/w0 **70**.
  //
  // So the trunks are registered HERE, on the same two calls that own a tile's
  // instances: `addTile` puts them in, `removeTile` takes them out. A teleport
  // needs no special case — the destination's tiles land through `addTile` like
  // any other tile, and the source's leave through `removeTile`.
  //
  // ONLY L0 AND L1. `ROUTER_LEVELS` collides exactly those two (L2+ is
  // `collide: false`, min reach 384 m), the pool draws an IMPOSTOR from L2 out
  // (`pick()`), and hanging trunks off impostors would put ~74,000 stems in a
  // 60,000-slot set to make trees solid a kilometre away that the player cannot
  // reach without bringing L0 with him.
  //
  // ONLY TREES. `KIND_ROCK` instances draw `tile-rocks-*`, which is wave 3a's
  // home for `boulders` — and `boulders` was never a stem source in the
  // unchunked build either (it fails TREE_RE and it is not `treeish`: a boulder
  // is wider than it is tall). Registering them would be a NEW solid, not a
  // restored one.
  const STEM_MAX_LEVEL = 1;
  // ================================================ D-19, THE COLLIDABLE FOREST
  // §5.3 spends x4 trees at L0 and x2 at L1 (D-4) and calls the extra ones
  // DETAIL: "density per level is a strict-subset thinning of the finest
  // level's stream", with today's density from L2 out and `TILE_FOREST_GAIN`
  // fitted so "the level-2 census == placeForest's own count". So the level-2
  // subset IS the forest the whole game was tuned against, and the x4 is the
  // picture getting thicker, not the mountain growing trees.
  //
  // MAKING ALL OF IT SOLID BREAKS THE RIDE, measured. At the gold-coast-funitel
  // unload the stand reads (40 x 40 m box around three [-2716.8, 301.5]):
  //     unchunked main   23 stems = 144 /ha, mean spacing 8.34 m, 2 within 6 m
  //     chunked, all x4  64 stems = 400 /ha, mean spacing 5.00 m, 14 within 6 m
  // `controller.js:1186`'s push-out is three passes of "the deepest single
  // trunk", which cannot leave a pocket ringed by fourteen of them: the rider
  // skied 195 m at 18 m/s, was dragged to 2.7 m/s by overlapping canopies and
  // then sat at EXACTLY 0.00 m/s against a trunk for the last ten seconds of a
  // thirty-second run. verify.mjs's own "[2d-b] lifts that unload OUTSIDE the
  // old fence ride and ski" row caught it (84.9 m of a 100 m floor). The same
  // lane on unchunked main crawls through the same flat spot and comes out the
  // far side at 4.77 m/s over 234 m.
  //
  // So the COLLIDABLE forest is the level-2 subset and the DRAWN forest is the
  // spend — which is what §5.3 already says those two things are. It also buys
  // a property worth having on its own: the collision density stops moving when
  // the detail knob moves, so wave 4a can re-tune what you see without
  // re-tuning what stops you.
  //
  // The subset is a HASH OF THE POSITION, not a draw: `tiles.mjs`'s own
  // `treeVariant` picks silhouettes the same way, "no rng draw, nothing moves".
  // ONE THRESHOLD AT BOTH LEVELS, so a tree keeps its answer wherever it is
  // met — a per-level fraction would make the same fir solid at 300 m and
  // hollow at 100 m, which is the worst of both schemes.
  //
  // 0.40 IS MEASURED, not §5.3's 0.25 read off the ladder. Five 40 x 40 m boxes
  // at fixed coordinates, the same five in both builds, counting stems:
  //     stand                unchunked main   chunked @ 0.25
  //     (-2716.8,  301.5)        144 /ha           88 /ha
  //     (  -560,     300)          0                0
  //     ( -1150,     700)         13               13
  //     ( -2500,     100)        156               94
  //     (  -800,     800)          0                0
  //     TOTAL over 8,000 m2       63 /ha           39 /ha
  // 0.25 x (63/39) = 0.404. At 0.40 the reference stand reads ~160 /ha against
  // main's 144 and a mean spacing of ~7.9 m against main's 8.34 — the density
  // every rider constant in specs/0012 and 0030-0032 was tuned on, which is the
  // whole point of pinning the collidable forest to it.
  // ---- specs/0051 D-20, 2026-09-06. Greg: "Sure on ... forest density."
  //
  // FULL COLLISION DENSITY. `COLLIDE_KEEP` is 1.0: every streamed fir that is
  // DRAWN has a trunk, at every level the router collides. The 0.40 above was
  // never a claim about what a forest should be — it was the largest subset
  // `controller.js`'s three-pass "deepest single trunk" push-out could survive,
  // and D-20 replaced that with a resolver that solves the whole stand at once.
  // The measured wedge it was avoiding (14 trunks inside 6 m, 0.00 m/s for ten
  // seconds) is now the case the solver is written for.
  //
  // THE CANOPY DOES NOT FOLLOW IT, and that is the one thing to read twice.
  // `canopyIn()` reads the same StemSet, so a keep of 1.0 would also multiply
  // specs/0012 §E2's SOFT tax by 2.8x — and D-19's pin was as much the canopy
  // drag (195 m at 18 m/s down to 2.7 m/s before the trunk ever held it) as the
  // push-out. `canopyEntry` 0.625 and `canopyDrag` 3.45 are Greg's own numbers,
  // fitted twice on the bench (specs/0031 §1, 0032 §1) against placeForest's
  // 144 stems/ha. Full COLLISION density is what was signed off; needles 2.8x
  // thicker is a different ride nobody asked for.
  //
  // So there are two keeps off the ONE position hash — a tree keeps both of its
  // answers wherever it is met, at L0 and at L1 alike:
  //   COLLIDE_KEEP 1.0   every drawn tree has a trunk
  //   CANOPY_KEEP  0.40  the level-2 subset keeps its foliage cone; the rest
  //                      register with cr = 0, which canopyIn() already skips
  // 0.40 is D-19's measured number, unchanged: five fixed 40 x 40 m boxes read
  // 61 /ha against unchunked main's 63 /ha at that threshold.
  const COLLIDE_KEEP = 1.0;
  const CANOPY_KEEP = 0.40;
  function stemHash01(x, y) {
    // quantized to a millimetre-ish grid so the float that reaches here at L0
    // and the float that reaches here at L1 hash the same; trees are metres
    // apart, so the quantization cannot merge two of them.
    const bx = Math.round(x * 1024) | 0, by = Math.round(y * 1024) | 0;
    let h = Math.imul(bx ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by ^ 0x165667b1, 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2545f491); h ^= h >>> 13; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  const stemTiles = stems ? new Map() : null;      // tileId -> [stem index, ...]
  const stemProto = [];                            // per pool mesh, memoised
  const _cm = new THREE.Matrix4();
  const stemStat = { added: 0, removed: 0, refused: 0, tiles: 0 };

  const protoFor = (mi) => {
    if (stemProto[mi] === undefined) stemProto[mi] = SOLIDS ? SOLIDS.stemProtoOf(THREE, meshes[mi].im) : null;
    return stemProto[mi];
  };

  /** one instance's trunk, from the matrix `put()` just composed. `_m` is the
   *  INSTANCE matrix; the stem wants it in world space, so the mesh's own
   *  matrixWorld goes on the left exactly as solids.js's scan does. */
  function stemPut(tileId, mi, m, canopy) {
    if (!stems || !SOLIDS) return;
    const p = protoFor(mi);
    if (!p) return;
    const im = meshes[mi].im;
    _cm.multiplyMatrices(im.matrixWorld, m);
    const i = SOLIDS.addStemFrom(stems, p, _cm, canopy);
    if (i < 0) { stemStat.refused++; return; }
    let a = stemTiles.get(tileId);
    if (!a) { a = []; stemTiles.set(tileId, a); stemStat.tiles++; }
    a.push(i);
    stemStat.added++;
  }

  function stemDrop(tileId) {
    if (!stems || !stemTiles) return;
    const a = stemTiles.get(tileId);
    if (!a) return;
    for (let k = 0; k < a.length; k++) if (stems.removeAt(a[k])) stemStat.removed++;
    stemTiles.delete(tileId);
    stemStat.tiles--;
  }

  /** take a tile's flat instance list and give it its blocks. One pass to
   *  count per mesh, one to write — so every block is contiguous and no mesh is
   *  touched twice. */
  function addTile(tileId, level, arr, n) {
    const S = T.INST_STRIDE;
    const counts = COUNTS;
    counts.fill(0, 0, meshes.length);
    for (let i = 0; i < n; i++) {
      const p = pick(arr[i * S], arr[i * S + 1], level, arr[i * S + 8]);
      if (p === -1) continue;
      counts[p[0]]++;
    }
    for (let m = 0; m < meshes.length; m++) {
      const c = counts[m];
      if (!c) continue;
      const e = meshes[m];
      if (e.used + c > e.cap) { stats.allocFail += c; counts[m] = 0; continue; }
      e.blocks.set(tileId, { start: e.used, n: c, w: 0 });
      e.used += c;
      dirty.add(m);
    }
    // D-19: a trunk goes in on the same pass that draws the tree, off the same
    // composed matrix, so a drawn fir and a solid fir cannot disagree.
    const wantStems = !!stems && level <= STEM_MAX_LEVEL;
    for (let i = 0; i < n; i++) {
      const o = i * S;
      const p = pick(arr[o], arr[o + 1], level, arr[o + 8]);
      if (p === -1) continue;
      const e = meshes[p[0]], b = e.blocks.get(tileId);
      if (!b || b.w >= b.n) continue;
      put(p[0], b.start + b.w, arr[o + 2], arr[o + 3], arr[o + 4],
          arr[o + 5], arr[o + 6], arr[o + 7], p[1]);
      // `put` left the instance matrix in `_m`; KIND_ROCK is not a stem source
      // in either build, so it is skipped by kind and not merely by name. The
      // level-2 subset test reads the tree's OWN ENU position out of the
      // instance record, which is the one thing about it that is the same at
      // every level it survives to.
      if (wantStems && arr[o] !== 1) {
        // ONE hash, TWO thresholds (D-20). The trunk is collision and goes to
        // full density; the foliage cone is the soft tax and stays the level-2
        // subset Greg's canopy numbers were fitted on.
        const q = stemHash01(arr[o + 2], arr[o + 3]);
        if (q < COLLIDE_KEEP) stemPut(tileId, p[0], _m, q < CANOPY_KEEP);
      }
      b.w++;
    }
    stats.instances += n;
    stats.byLevel[Math.min(level, 4)] += n;
    flush();
  }

  /** swap-remove: the LAST block is copied over the hole and re-pointed. O(the
   *  last block), no allocation, and the array never moves. */
  function removeTile(tileId, level, n) {
    stemDrop(tileId);                          // D-19 — before the blocks move
    for (let m = 0; m < meshes.length; m++) {
      const e = meshes[m], b = e.blocks.get(tileId);
      if (!b) continue;
      e.blocks.delete(tileId);
      const end = b.start + b.n;
      let last = null, lastKey = null;
      for (const [k, q] of e.blocks) if (q.start >= end && (!last || q.start > last.start)) { last = q; lastKey = k; }
      // move every block that sits above the hole down by b.n — done as one
      // copyWithin of the whole tail, which is what keeps this O(bytes moved)
      // rather than O(blocks) matrix composes
      if (e.used > end) {
        e.arr.copyWithin(b.start * 16, end * 16, e.used * 16);
        for (const q of e.blocks.values()) if (q.start >= end) q.start -= b.n;
      }
      e.used -= b.n;
      dirty.add(m);
      void last; void lastKey;
    }
    stats.instances -= n;
    stats.byLevel[Math.min(level, 4)] -= n;
    flush();
  }

  function flush() {
    for (const m of dirty) {
      const e = meshes[m];
      e.im.count = e.used;
      if (e.used > e.hi) e.hi = e.used;
      e.im.instanceMatrix.needsUpdate = true;
    }
    dirty.clear();
  }

  const COUNTS = new Int32Array(64);

  return {
    group, meshes, addTile, removeTile, stats,
    /** D-19's read: how many streamed trunks are solid right now, over how
     *  many tiles, and whether the stem set ever refused one (which would mean
     *  MAX_STEMS was reached and some trees near the player are not solid). */
    stemStats: () => ({ ...stemStat, wired: !!stems, maxLevel: STEM_MAX_LEVEL,
                        keep: COLLIDE_KEEP, canopyKeep: CANOPY_KEEP,
                        tilesWithStems: stemTiles ? stemTiles.size : 0,
                        live: stems ? stems.live : 0, slots: stems ? stems.n : 0,
                        free: stems ? stems.free.length : 0 }),
    /** every stem index this tile owns — check 16 reads it to prove the router
     *  and the pool agree tile for tile. */
    stemsOf: (tileId) => ((stemTiles && stemTiles.get(tileId)) || []).slice(),
    setVisible(v) { group.visible = v !== false; return group.visible; },
    bytes() { let b = 0; for (const e of meshes) b += e.cap * 64; return b; },
    triangles() { let t = 0; for (const e of meshes) t += e.used * e.tris; return t; },
    census() {
      const rows = {};
      for (const e of meshes) rows[e.name] = e.used;
      return { meshes: meshes.length, rows, total: meshes.reduce((a, e) => a + e.used, 0) };
    },
    /** §9.1 row 4a — every mesh's measured high-water mark against its capacity,
     *  and the byte cost of the difference. This is the read a capacity is
     *  re-sized from; `allocFail` non-zero anywhere means a capacity is already
     *  too small and a stand somewhere is drawing thin. */
    highWater() {
      return { rows: meshes.map((e) => ({ name: e.name, hi: e.hi, cap: e.cap, tris: e.tris,
                                          headroom: e.cap - e.hi, bytes: e.cap * 64, hiBytes: e.hi * 64 })),
               capacity: meshes.reduce((a, e) => a + e.cap, 0),
               peak: meshes.reduce((a, e) => a + e.hi, 0),
               bytes: meshes.reduce((a, e) => a + e.cap * 64, 0),
               allocFail: stats.allocFail };
    },
    counts() {
      return { instances: stats.instances, byLevel: stats.byLevel.slice(),
               overflow: stats.overflow, allocFail: stats.allocFail,
               capacity: meshes.reduce((a, e) => a + e.cap, 0),
               used: meshes.reduce((a, e) => a + e.used, 0),
               bytes: meshes.reduce((a, e) => a + e.cap * 64, 0),
               triangles: meshes.reduce((a, e) => a + e.used * e.tris, 0),
               perMesh: meshes.map((e) => ({ name: e.name, used: e.used, cap: e.cap, tris: e.tris })) };
    },
  };
}

// ===========================================================================
// The pool. §2.2: allocated ONCE, swapped IN PLACE, never disposed. Every slot
// owns its four typed arrays, one BufferGeometry over them, and one Mesh; the
// INDEX is taken by reference from `tiles.mjs sharedIndex(S)`, so 144 FINE
// slots share one 52,224 B Uint16Array between them (§1.2) rather than paying
// for 144 of it.
//
// Each slot gets its own material INSTANCE because §1.8 gives every tile its
// own `uMorph`; `tiles.mjs morphMaterial` makes `customProgramCacheKey`
// constant, so three.js compiles the program once however many slots exist.
//
// WAVE 3b: the four typed arrays are now `subarray` views into the batch that
// owns the slot (above), so the same bytes serve both draw paths and neither
// pays for the other. `arrays.position.buffer` is the batch's buffer; nothing
// downstream can tell, because a subarray of a Float32Array IS a Float32Array.
// ===========================================================================
function makePool(THREE, T, S, n, baseMaterial, batchSet) {
  const idx = T.sharedIndex(S);
  const VT = S.verts + S.skirt;
  const slots = [], free = [];
  for (let i = 0; i < n; i++) {
    const B = batchSet ? batchSet.batches[Math.floor(i / batchSet.per)] : null;
    const local = batchSet ? i - B.start : -1;
    const ba = B ? B.mesh.geometry.attributes : null;
    // the batch's own answer for where this slot's vertices live, not an
    // assumption about how `addGeometry` packs them (three.core.js:28081).
    const v0 = B ? B.ranges[local].vertexStart : 0;
    if (B && B.ranges[local].reservedVertexCount !== VT) {
      throw new Error(`chunks.js: batch reserved ${B.ranges[local].reservedVertexCount} vertices for a ${VT}-vertex ${S.id} slot`);
    }
    const arrays = B ? {
      position: ba.position.array.subarray(v0 * 3, (v0 + VT) * 3),
      normal: ba.normal.array.subarray(v0 * 3, (v0 + VT) * 3),
      color: ba.color.array.subarray(v0 * 4, (v0 + VT) * 4),
      morphZ: ba.morphZ.array.subarray(v0, v0 + VT),
    } : {
      position: new Float32Array(VT * 3), normal: new Float32Array(VT * 3),
      color: new Uint8Array(VT * 4), morphZ: new Float32Array(VT),
    };
    // D-14: tagged at construction, so check 10 counts THIS and not the guide's
    // props. `POOL:<shape>` is the owner string the row prints.
    const geom = tagPoolGeometry(new THREE.BufferGeometry(), `POOL:${S.id}`);
    const attrs = {
      position: new THREE.BufferAttribute(arrays.position, 3),
      normal: new THREE.BufferAttribute(arrays.normal, 3),
      color: new THREE.Uint8BufferAttribute(arrays.color, 4, true),
      morphZ: new THREE.BufferAttribute(arrays.morphZ, 1),
    };
    for (const k of Object.keys(attrs)) { attrs[k].setUsage(THREE.DynamicDrawUsage); geom.setAttribute(k, attrs[k]); }
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const mat = T.morphMaterial ? T.morphMaterial(THREE, baseMaterial || null)
                                : new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `chunks:slot:${S.id}:${i}`;
    mesh.visible = false;
    mesh.frustumCulled = false;      // the sphere is rewritten on every swap
    mesh.matrixAutoUpdate = false;   // tile vertices are already world-space
    const slot = { i, shape: S.id, arrays, attrs, geom, mesh, material: mat,
                   used: false, tileId: null, bytes: VT * 32,
                   batch: B ? B.mesh : null, batchId: B ? B.ids[local] : -1,
                   batchAttrs: ba, v0, VT };
    slots.push(slot); free.push(slot);
  }
  return { shape: S.id, slots, free, bytes: n * VT * 32, verts: VT,
           batchSet: batchSet || null,
           indexBytes: batchSet ? batchSet.indexBytes : idx.byteLength };
}

// A slot's vertices changed. The Mesh path re-uploads its own four attributes;
// the batch path re-uploads only THIS SLOT'S RANGE of the shared attribute
// (`addUpdateRange`, which three clears after each upload), so a swap costs one
// tile's bytes on the wire and never the whole 20 MB batch.
function markSlot(s) {
  s.attrs.position.needsUpdate = true; s.attrs.normal.needsUpdate = true;
  s.attrs.color.needsUpdate = true; s.attrs.morphZ.needsUpdate = true;
  const ba = s.batchAttrs;
  if (!ba) return;
  const V = s.v0, N = s.VT;
  ba.position.addUpdateRange(V * 3, N * 3); ba.position.needsUpdate = true;
  ba.normal.addUpdateRange(V * 3, N * 3); ba.normal.needsUpdate = true;
  ba.color.addUpdateRange(V * 4, N * 4); ba.color.needsUpdate = true;
  ba.morphZ.addUpdateRange(V, N); ba.morphZ.needsUpdate = true;
}

// ===========================================================================
// §1.5's rim box, from the world's own declared colliders. The rim IS a
// declared collider and the FAR_R polar apron is NOT (§3.7), so this AABB is
// the rim box and nothing wider: red-dog gives x [-4467.26, 1848] and
// z [-2080.70, 2519.30], which is 7 x 5 = 35 LF tiles on a 1,024 m lattice
// anchored at RX0/RY0 — §1.5's own count, derived here rather than copied.
//
// It is deliberately NOT `collision.bounds`: main.js:156-179 grows that by 60 m
// and squares it off the longer axis (§3.7), which on siberia reaches a
// kilometre past any collider, and §3.5 deletes that sizing in wave 2c anyway.
// ===========================================================================
function boxOf(THREE, colliders, T) {
  const crop = T.CROP || null;
  const fallback = crop
    ? { x0: crop.x0, y0: crop.y0, x1: crop.x1, y1: crop.y1, from: 'crop' }
    : { x0: -2048, y0: -2048, x1: 2048, y1: 2048, from: 'default' };
  if (!Array.isArray(colliders) || !colliders.length) return fallback;
  const box = new THREE.Box3(), one = new THREE.Box3();
  for (const m of colliders) {
    if (!m || !m.isObject3D) continue;
    one.setFromObject(m);
    if (!one.isEmpty()) box.union(one);
  }
  if (box.isEmpty()) return fallback;
  // three -> ENU: x is x, and ENU y = -three z, so the z interval flips.
  const out = { x0: box.min.x, x1: box.max.x, y0: -box.max.z, y1: -box.min.z, from: 'colliders' };
  if (crop) {
    out.x0 = Math.min(out.x0, crop.x0); out.x1 = Math.max(out.x1, crop.x1);
    out.y0 = Math.min(out.y0, crop.y0); out.y1 = Math.max(out.y1, crop.y1);
  }
  out.spanX = +(out.x1 - out.x0).toFixed(2);
  out.spanY = +(out.y1 - out.y0).toFixed(2);
  return out;
}

export default createChunks;
