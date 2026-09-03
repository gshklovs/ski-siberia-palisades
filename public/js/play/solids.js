// Solids — the parts of a scene a body HITS rather than stands on.
//
// The triangle soup in collision.js answers "what is under my feet" and "is
// there a wall in front of me". Neither question finds a TREE: a fir is 30 m of
// needles around a 60 cm trunk, and putting a hundred thousand canopy triangles
// into the soup to make one trunk solid is a bad trade — the canopy would also
// become a floor you could stand on.
//
// So trees get their own representation: a STEM, a tapered vertical cone at the
// instance position, running the tree's whole height (specs/0012 §E1 — it used
// to stop 2.5 m up, which meant a fir you met in the air was not there). One
// 8 m spatial hash answers the controller's point query (`stemHit`, O(cell)) and
// surprise.js's swept-segment query (`hitSegment`), so neither module owns a
// copy of the scan.
//
// The scan itself was surprise.js's, moved here verbatim in behaviour: named
// InstancedMeshes ('firs-big', 'pines-alpine', 'snags'…), *unnamed*
// InstancedMeshes that MEASURE like trees (eastnor and joyride ship theirs with
// no name at all), and merged tree meshes whose vertex cloud gets clustered into
// stems (sand-harbor bakes 4000 pines into one buffer). The one thing it grew is
// a per-stem RADIUS, taken from the instance's own xz scale — collision.js needs
// a number to push a rider out of, and "0.28 m times however big this particular
// fir is" is that number.
//
// The scan is cached per scene root (WeakMap), because two callers want it —
// buildCollision() at boot and surprise.js at init — and it costs a full scene
// traverse. Whoever asks first pays; the second gets the same object.

export const STEM_R = 0.28;        // m — trunk radius at 1x instance scale
// specs/0012 §E1 — the trunk is solid at ANY height. There is no STEM_H any
// more: the cylinder became a CONE running from the instance's base to its
// apex, and the apex is read off the instance's own geometry bounds rather
// than assumed. `STEM_R_TOP` is the radius at that apex — a real 10 cm of
// wood, NOT scaled by the instance, because the tip of a 40 m fir and the tip
// of a 12 m one are both about a wrist thick.
export const STEM_R_TOP = 0.10;    // m — trunk radius at the apex
export const STEM_BASE_TOL = 1.5;  // m — instances are SUNK into the ground (world.mjs
                                   // buries a trunk 0.6-1.2 m so no daylight shows
                                   // under it), so the recorded base sits below the
                                   // floor you actually stand on. This is the slack.

// specs/0012 §E2 — the FOLIAGE, which is not a solid at all. A cone from the
// height the needles start (`CANOPY_START_FRAC` of the geometry's own widest
// band) up to the apex, where it closes to a point. Crashing into it is a soft
// hit: it eats your speed and lets you through.
const CANOPY_BANDS = 24;           // height bands the geometry's radius profile is read in
const CANOPY_START_FRAC = 0.45;    // a band counts as foliage once it is this
                                   // fraction of the tree's widest band — below
                                   // that you are looking at bare trunk. Not a
                                   // small number by accident: kit.mjs's red fir
                                   // gives its trunk a ROOT FLARE, and the flare
                                   // alone already measures 0.30 of the widest
                                   // skirt. Anything under ~0.4 calls the bottom
                                   // of the trunk foliage and hangs a drag cone
                                   // around the ankles of every tree in the world.
const CANOPY_FALLBACK_Y0 = 0.35;   // where the foliage starts on a stem with no
                                   // geometry to measure (a merged forest's
                                   // clustered vertex cloud), as a fraction of height
const CANOPY_FALLBACK_R = 0.30;    // ...and how wide it is, as a fraction of height
const CANOPY_R_SCALE = 0.64;       // the measured skirt is the OUTERMOST needle tip;
                                   // the part that actually grabs a body is well
                                   // inside it. Greg on the bench, 2026-09-01:
                                   // "green hitbox is too big (by 40%)" -> 0.60;
                                   // 2026-09-02, halfway back: "expand hitbox by
                                   // a bit" -> 0.80 (specs/0031), which STALLED
                                   // the rider: 12 m/s came out of the reference
                                   // fir at 0.21 m/s after 0.98 s in the needles.
                                   //
                                   // specs/0032 §1 makes the drag the fixed
                                   // number (3.45, Greg's +15 %) and the skirt
                                   // the knob, and the knob is sharp. On the
                                   // §E5.2 line the flight passes 1.5 m off the
                                   // axis, so the CHORD through the cone is a
                                   // square root away from zero and a 0.02 step
                                   // in the skirt moves it 0.2 m:
                                   //   0.70 -> 1.79 m cone, 1.97 m chord, STALL
                                   //   0.66 -> 1.69 m cone, 1.56 m chord, STALL
                                   //   0.64 -> 1.64 m cone, 1.33 m chord, 1.85 m/s
                                   //   0.62 -> 1.59 m cone, 1.05 m chord, 3.20 m/s
                                   // 0.64 is the first step down from the spec's
                                   // 0.70 that does not stall, which is what
                                   // §1 asks be taken. Cone at head height on
                                   // the reference fir: 1.54 -> 1.64 m (the
                                   // original, unscaled, was 2.56).
                                   // Measured: skirt-0032-sweep.json.

const CELL = 8;                    // m — spatial-hash cell
const MAX_STEMS = 60000;           // hard cap on harvested stems

const TREE_RE = /(^|[-_ ])(trees?|firs?|pines?|conifers?|spruces?|cedars?|snags?|forest|canopy|woods?|timber|birch|aspen|oaks?|poplar|larch|palms?)([-_ ]|\d|$)/i;

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

function named(o) {
  let q = o, n = 0;
  while (q && n++ < 6) {
    if (q.name && TREE_RE.test(q.name)) return true;
    q = q.parent;
  }
  return false;
}

// world-space extents of one instance: how tall, how wide. Handles the
// play:zup wrapper (a z-up world's tree geometry is tall along local Z).
function worldExtent(obj, sizeX, sizeY, sizeZ) {
  const m = obj.matrixWorld.elements;
  const ax = [
    [m[0] * sizeX, m[1] * sizeX, m[2] * sizeX],
    [m[4] * sizeY, m[5] * sizeY, m[6] * sizeY],
    [m[8] * sizeZ, m[9] * sizeZ, m[10] * sizeZ],
  ];
  let up = 0, flat = 0;
  for (const a of ax) {
    const vert = Math.abs(a[1]);
    const horiz = Math.hypot(a[0], a[2]);
    if (vert > up) up = vert;
    if (horiz > flat) flat = horiz;
  }
  return { up, flat };
}

// The instance's own horizontal size multiplier, straight off its matrix: the
// length of the transformed local X axis. world.mjs composes tree instances as
// scale (k, k, k * stretch) with the STRETCH on the world-up axis, so the X
// column is the honest xz scale whichever way the world is tipped.
function xzScaleOf(M) {
  const e = M.elements;
  const s = Math.hypot(e[0], e[1], e[2]);
  return s > 1e-4 ? s : 1;
}

// Which LOCAL axis of `M` points at world up. A z-up world's fir geometry is
// tall along local Z; a y-up world's along local Y. The matrix's Y ROW says so
// directly — it is the world-Y contribution of one local unit on each axis.
function upAxisOf(M) {
  const e = M.elements;
  const ax = Math.abs(e[1]), ay = Math.abs(e[5]), az = Math.abs(e[9]);
  return ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
}

// §E2 — the RADIUS PROFILE of one tree geometry, in local units: where the
// foliage starts and how wide it gets. Measured once per geometry (an
// InstancedMesh shares one buffer across every fir it draws) and cached on it,
// so ten thousand instances cost one scan.
//
// The bounding box alone cannot answer this: it says "3.1 m wide, 38 m tall"
// and not "the needles begin 9 m up". Bucketing the vertex cloud into height
// bands and taking the max radius in each does, and it is the same one-pass
// scan the merged-mesh clusterer below already runs on far bigger buffers.
const PROFILE = new WeakMap();
function treeProfile(geom, upIdx) {
  let byAxis = PROFILE.get(geom);
  if (!byAxis) { byAxis = [null, null, null]; PROFILE.set(geom, byAxis); }
  if (byAxis[upIdx]) return byAxis[upIdx];

  const bb = geom.boundingBox;
  const lo = [bb.min.x, bb.min.y, bb.min.z], hi = [bb.max.x, bb.max.y, bb.max.z];
  const a = (upIdx + 1) % 3, b = (upIdx + 2) % 3;
  const ca = (lo[a] + hi[a]) / 2, cb = (lo[b] + hi[b]) / 2;
  const u0 = lo[upIdx], u1 = hi[upIdx], span = u1 - u0;
  const out = {
    u0, u1,
    rMax: Math.max(hi[a] - ca, hi[b] - cb),
    uCan: u0 + span * CANOPY_FALLBACK_Y0,
  };
  const pos = geom.attributes && geom.attributes.position;
  if (pos && pos.count > 8 && span > 1e-6) {
    const band = new Float32Array(CANOPY_BANDS);
    const stride = Math.max(1, Math.floor(pos.count / 20000));
    for (let i = 0; i < pos.count; i += stride) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const P = upIdx === 0 ? px : (upIdx === 1 ? py : pz);
      const A = a === 0 ? px : (a === 1 ? py : pz);
      const B = b === 0 ? px : (b === 1 ? py : pz);
      let k = Math.floor(((P - u0) / span) * CANOPY_BANDS);
      if (k < 0) k = 0; else if (k >= CANOPY_BANDS) k = CANOPY_BANDS - 1;
      const r = Math.hypot(A - ca, B - cb);
      if (r > band[k]) band[k] = r;
    }
    let rMax = 0;
    for (let k = 0; k < CANOPY_BANDS; k++) if (band[k] > rMax) rMax = band[k];
    if (rMax > 1e-6) {
      out.rMax = rMax;
      const thr = rMax * CANOPY_START_FRAC;
      let k0 = 0;
      while (k0 < CANOPY_BANDS - 1 && band[k0] < thr) k0++;
      out.uCan = u0 + span * (k0 / CANOPY_BANDS);
    }
  }
  byAxis[upIdx] = out;
  return out;
}

class StemSet {
  constructor() {
    this.sx = new Float32Array(MAX_STEMS);
    this.sy = new Float32Array(MAX_STEMS);
    this.sz = new Float32Array(MAX_STEMS);
    this.sh = new Float32Array(MAX_STEMS);
    this.sr = new Float32Array(MAX_STEMS);   // trunk radius at the base, METRES x scale
    this.st = new Float32Array(MAX_STEMS);   // §E1 apex, world Y. Per INSTANCE, not
                                             // per mesh: the world stretches every
                                             // fir by its own factor, so one number
                                             // for the whole InstancedMesh would put
                                             // a third of them short and a third long.
    // §E2 — the foliage cone. `cy` is where it starts (world Y), `cr` its
    // radius THERE, in SCENE units already (it comes off the geometry, not out
    // of a metre constant, so nothing multiplies it by `unit` at query time).
    this.cy = new Float32Array(MAX_STEMS);
    this.cr = new Float32Array(MAX_STEMS);
    // §E3 — the way BACK to the drawn tree: which InstancedMesh (`sm`, an index
    // into `meshes`) and which instance in it (`si`). A stem clustered out of a
    // merged forest has no instance to point at and stores -1, which is what
    // stops canopy.js trying to sway a vertex cloud.
    this.sm = new Int16Array(MAX_STEMS).fill(-1);
    this.si = new Int32Array(MAX_STEMS).fill(-1);
    this.meshes = [];
    this.n = 0;
    this.maxR = 0;                           // widest trunk base in the set (metres x scale)
    this.maxCR = 0;                          // widest canopy in the set (scene units)
    this.grid = new Map();
    this.sources = [];
    this.errors = 0;
    this.cell = CELL;
    this.ms = 0;
  }

  add(x, y, z, h, r, top, cy = 0, cr = 0, sm = -1, si = -1) {
    if (this.n >= MAX_STEMS) return -1;
    const i = this.n++;
    this.sm[i] = sm; this.si[i] = si;
    this.sx[i] = x; this.sy[i] = y; this.sz[i] = z; this.sh[i] = h; this.sr[i] = r;
    // a degenerate apex (no bounds, a flat instance) falls back to the mesh's
    // measured height — a stem with top <= base would collide with nothing
    this.st[i] = (top > y + 0.05) ? top : (y + Math.max(0.5, h));
    // a cone with no room to be a cone is no canopy at all
    this.cy[i] = cy;
    cr *= CANOPY_R_SCALE;
    this.cr[i] = (cr > 0.05 && this.st[i] > cy + 0.5) ? cr : 0;
    if (r > this.maxR) this.maxR = r;
    if (this.cr[i] > this.maxCR) this.maxCR = this.cr[i];
    return i;
  }

  index() {
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = Math.floor(this.sx[i] / CELL) + ',' + Math.floor(this.sz[i] / CELL);
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(i);
    }
  }

  stemAt(i) {
    return (i >= 0 && i < this.n)
      ? { x: this.sx[i], y: this.sy[i], z: this.sz[i], h: this.sh[i], r: this.sr[i],
          top: this.st[i], canopyY: this.cy[i], canopyR: this.cr[i] }
      : null;
  }

  // §E1 — the trunk's radius at world height `y`, in SCENE units, tapering
  // linearly from `sr` at the base to STEM_R_TOP at the apex. Below the base
  // (inside the sink slack) it is the base radius; there is no flare.
  trunkRadiusAt(i, y, unit = 1) {
    const base = this.sy[i], top = this.st[i];
    const r0 = this.sr[i] * unit;
    const r1 = Math.min(r0, STEM_R_TOP * unit);
    const span = top - base;
    if (!(span > 1e-6)) return r0;
    const t = clamp((y - base) / span, 0, 1);
    return r0 + (r1 - r0) * t;
  }

  // squared distance from stem i to the segment (ax,az)->(bx,bz)
  segDist2(i, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let t = 0;
    if (L2 > 1e-9) t = clamp(((this.sx[i] - ax) * dx + (this.sz[i] - az) * dz) / L2, 0, 1);
    const qx = ax + dx * t - this.sx[i];
    const qz = az + dz * t - this.sz[i];
    return qx * qx + qz * qz;
  }

  // Nearest stem to the swept segment, within `r`, at a height the body
  // occupies. surprise.js's detector — a generous corridor, not a contact test.
  hitSegment(ax, ay, az, bx, by, bz, r) {
    if (!this.n) return -1;
    const r2 = r * r;
    const c0x = Math.floor(Math.min(ax, bx) / CELL) - 1, c1x = Math.floor(Math.max(ax, bx) / CELL) + 1;
    const c0z = Math.floor(Math.min(az, bz) / CELL) - 1, c1z = Math.floor(Math.max(az, bz) / CELL) + 1;
    if ((c1x - c0x) * (c1z - c0z) > 400) return -1;      // absurd sweep: bail
    let best = -1, bestD = r2;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const a = this.grid.get(cx + ',' + cz);
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          const y = Math.min(ay, by);
          if (y < this.sy[i] - 2.5 || y > this.sy[i] + this.sh[i] * 0.95) continue;
          const d = this.segDist2(i, ax, az, bx, bz);
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return best;
  }

  // THE CONTACT TEST. A body of radius `bodyR` with its FEET at (x, y, z):
  // does it overlap a trunk, and if so which way is out?
  //
  // O(cell), not O(trees): a trunk is under a metre across and the hash cell is
  // eight, so the query reads at most four cells however big the forest is.
  //
  // `unit` is the scene's metres-per-unit scale (main.js's unitScale). STEM_R
  // and STEM_R_TOP are real-world metres; everything else here is scene units.
  //
  // §E1: the vertical gate is the WHOLE trunk — base to apex — and the radius
  // tapers over that span. Hitting the centre of a fir six metres up is the
  // same event as hitting it at the ankles, which is what a tree is.
  //
  // Returns { i, nx, nz, pen, r, dist } — the normal points AWAY from the trunk,
  // so pos += n * pen puts the body exactly on the surface. Null = no contact.
  stemHit(x, y, z, bodyR, unit = 1) {
    if (!this.n) return null;
    const TOL = STEM_BASE_TOL * unit;
    const reach = bodyR + this.maxR * unit;   // widest trunk we could touch
    const i0 = Math.floor((x - reach) / CELL), i1 = Math.floor((x + reach) / CELL);
    const j0 = Math.floor((z - reach) / CELL), j1 = Math.floor((z + reach) / CELL);
    let best = -1, bestPen = 0, bnx = 0, bnz = 0, bd = 0, br = 0;
    for (let cx = i0; cx <= i1; cx++) {
      for (let cz = j0; cz <= j1; cz++) {
        const a = this.grid.get(cx + ',' + cz);
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          // vertical gate: base (with the sink slack under it) to apex
          if (y < this.sy[i] - TOL || y > this.st[i]) continue;
          const r = this.trunkRadiusAt(i, y, unit) + bodyR;
          const dx = x - this.sx[i], dz = z - this.sz[i];
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          const pen = r - d;
          if (pen <= bestPen) continue;
          bestPen = pen; best = i; bd = d; br = r;
          // dead centre has no normal; push along +X rather than divide by zero
          if (d > 1e-6) { bnx = dx / d; bnz = dz / d; } else { bnx = 1; bnz = 0; }
        }
      }
    }
    if (best < 0) return null;
    return { i: best, nx: bnx, nz: bnz, pen: bestPen, r: br, dist: bd };
  }

  // ---- specs/0012 §E2: AM I IN THE FOLIAGE?
  //
  // The soft twin of stemHit, and the same shape of query — same 8 m hash, same
  // handful of cells, O(cell). A point test, not a capsule one: the head is
  // what goes through the needles, and the caller passes the head.
  //
  // Returns the stem INDEX of the deepest canopy the point is inside, or -1.
  // The index matters as much as the boolean: §E3 rustles that one instance.
  //
  // Inside the TRUNK is not inside the canopy. A body at the centre of a fir is
  // stemHit's event — a wipe and a push-out — and letting this fire there too
  // would drag a tumbling rider's speed on top of the wipe's own scrub.
  canopyIn(x, y, z, unit = 1) {
    if (!this.n || this.maxCR <= 0) return -1;
    const reach = this.maxCR;
    const i0 = Math.floor((x - reach) / CELL), i1 = Math.floor((x + reach) / CELL);
    const j0 = Math.floor((z - reach) / CELL), j1 = Math.floor((z + reach) / CELL);
    let best = -1, bestDepth = 0;
    for (let cx = i0; cx <= i1; cx++) {
      for (let cz = j0; cz <= j1; cz++) {
        const a = this.grid.get(cx + ',' + cz);
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          const cr = this.cr[i];
          if (cr <= 0) continue;
          const y0 = this.cy[i], top = this.st[i];
          if (y < y0 || y > top) continue;
          const dx = x - this.sx[i], dz = z - this.sz[i];
          const d2 = dx * dx + dz * dz;
          // radius of the cone at this height: full at y0, a point at the apex
          const r = cr * ((top - y) / (top - y0));
          if (d2 >= r * r) continue;
          const tr = this.trunkRadiusAt(i, y, unit);
          if (d2 < tr * tr) continue;                 // that is wood, not needles
          const depth = 1 - Math.sqrt(d2) / r;
          if (depth > bestDepth) { bestDepth = depth; best = i; }
        }
      }
    }
    return best;
  }

  stats() {
    return { stems: this.n, sources: this.sources.slice(), errors: this.errors, ms: this.ms };
  }
}

const CACHE = new WeakMap();

/**
 * Every tree stem in `scene`, hashed. Cached on the scene root: the second
 * caller gets the first caller's scan.
 */
export function harvestStems(THREE, scene, opts = {}) {
  if (!THREE || !scene) return new StemSet();
  const hit = CACHE.get(scene);
  if (hit && !opts.force) return hit;
  const set = scan(THREE, scene);
  CACHE.set(scene, set);
  return set;
}

function scan(THREE, scene) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  const S = new StemSet();
  const seen = new Set();          // dedupe trunk+canopy pairs (joyride ships both)
  const V = new THREE.Vector3();
  const M = new THREE.Matrix4();
  const CM = new THREE.Matrix4();   // matrixWorld * instanceMatrix, for the apex
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const SC = new THREE.Vector3();

  scene.updateMatrixWorld(true);

  scene.traverse((o) => {
    try {
      if (!o.geometry || (!o.isMesh && !o.isInstancedMesh)) return;
      if (o.name && /^(play:|fx:|psur)/.test(o.name)) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      const gx = bb.max.x - bb.min.x, gy = bb.max.y - bb.min.y, gz = bb.max.z - bb.min.z;
      const isNamed = named(o);

      if (o.isInstancedMesh) {
        // sample instance 0 to measure what one of these actually is
        o.getMatrixAt(0, M);
        M.decompose(P, Q, SC);
        const e = worldExtent(o, gx * Math.abs(SC.x), gy * Math.abs(SC.y), gz * Math.abs(SC.z));
        const treeish = e.up >= 3 && e.up <= 70 && e.up >= e.flat * 1.15 && o.count >= 40;
        if (!isNamed && !treeish) return;
        if (isNamed && e.up < 1.5) return;           // named but tiny: not a trunk
        // the mesh's own world scale, which the instance matrix sits inside
        const wsc = xzScaleOf(o.matrixWorld);
        // §E1 — the geometry's own box, so the apex can be read per instance
        const bcx = (bb.min.x + bb.max.x) / 2, bcy = (bb.min.y + bb.max.y) / 2, bcz = (bb.min.z + bb.max.z) / 2;
        const bhx = gx / 2, bhy = gy / 2, bhz = gz / 2;
        // §E2 — where this class of tree keeps its needles, measured once off
        // the shared geometry. `upIdx` comes from instance 0's world matrix, so
        // a z-up world reads its trunks along local Z without being told.
        o.getMatrixAt(0, M);
        CM.multiplyMatrices(o.matrixWorld, M);
        const prof = treeProfile(g, upAxisOf(CM));
        const profSpan = prof.u1 - prof.u0;
        const profFrac = profSpan > 1e-6 ? (prof.uCan - prof.u0) / profSpan : CANOPY_FALLBACK_Y0;
        S.sources.push({ name: o.name || '(unnamed instanced)', kind: 'instanced', n: o.count, h: +e.up.toFixed(1) });
        // §E3 — remember the mesh so a canopy hit can sway the instance it drew
        const meshIdx = S.meshes.length < 32767 ? (S.meshes.push(o) - 1) : -1;
        for (let i = 0; i < o.count && S.n < MAX_STEMS; i++) {
          o.getMatrixAt(i, M);
          CM.multiplyMatrices(o.matrixWorld, M);
          V.setFromMatrixPosition(CM);
          const k = ((V.x * 2) | 0) + ',' + ((V.z * 2) | 0);
          if (seen.has(k)) continue;
          seen.add(k);
          // world Y of the transformed box, exactly: an affine map sends the box
          // centre to `cy` and the extent to the L1 norm of the matrix's Y ROW
          // against the half-sizes. Eight corner transforms would give the same
          // two numbers for eight times the arithmetic, per instance, per boot.
          const m = CM.elements;
          const cy = m[1] * bcx + m[5] * bcy + m[9] * bcz + m[13];
          const hy = Math.abs(m[1]) * bhx + Math.abs(m[5]) * bhy + Math.abs(m[9]) * bhz;
          const apex = cy + hy, foot = cy - hy;
          const scl = xzScaleOf(M) * wsc;
          S.add(V.x, V.y, V.z, e.up, STEM_R * scl, apex,
                // the foliage line, carried across on the same span the box was
                // measured on, so an instance stretched 1.15x lifts its needles
                // by 1.15x too
                foot + (apex - foot) * profFrac, prof.rMax * scl, meshIdx, i);
        }
        return;
      }

      // merged tree mesh (sand-harbor bakes its forest into one buffer): cluster
      // the vertex cloud on a 3 m XZ grid and call each populated cell a stem.
      if (!isNamed) return;
      const pos = g.attributes && g.attributes.position;
      if (!pos || pos.count < 60) return;
      const e = worldExtent(o, gx, gy, gz);
      if (e.up < 2) return;
      const wsc = xzScaleOf(o.matrixWorld);
      const stride = Math.max(1, Math.floor(pos.count / 60000));
      const cells = new Map();
      for (let i = 0; i < pos.count; i += stride) {
        V.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const k = Math.round(V.x / 3) + ',' + Math.round(V.z / 3);
        const c = cells.get(k);
        if (c) { c.n++; if (V.y < c.y0) c.y0 = V.y; if (V.y > c.y1) c.y1 = V.y; }
        else cells.set(k, { x: V.x, z: V.z, y0: V.y, y1: V.y, n: 1 });
      }
      let added = 0;
      for (const c of cells.values()) {
        if (c.n < 2 || S.n >= MAX_STEMS) continue;
        // a clustered stem has no instance scale to read; take the class default.
        // Its apex is the top of its own vertex cloud, which is the one honest
        // height a merged forest hands us — and its canopy is the class default
        // too, because a 3 m cell of a baked forest has no profile to measure.
        const ch = Math.max(0.5, c.y1 - c.y0);
        S.add(c.x, c.y0, c.z, Math.max(4, ch), STEM_R * wsc, c.y1,
              c.y0 + ch * CANOPY_FALLBACK_Y0, ch * CANOPY_FALLBACK_R);
        added++;
      }
      if (added) S.sources.push({ name: o.name, kind: 'merged', n: added, h: +e.up.toFixed(1) });
    } catch { S.errors++; }
  });

  S.index();
  S.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
  return S;
}

export default harvestStems;
