// Solids — the parts of a scene a body HITS rather than stands on.
//
// The triangle soup in collision.js answers "what is under my feet" and "is
// there a wall in front of me". Neither question finds a TREE: a fir is 30 m of
// needles around a 60 cm trunk, and putting a hundred thousand canopy triangles
// into the soup to make one trunk solid is a bad trade — the canopy would also
// become a floor you could stand on.
//
// So trees get their own representation: a STEM, a vertical cylinder at the
// instance position. That is the whole model. Brushing the canopy is nothing;
// hitting the stem is everything. One 8 m spatial hash answers both the
// controller's point query (`stemHit`, O(cell)) and surprise.js's swept-segment
// query (`hitSegment`), so neither module owns a copy of the scan.
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
export const STEM_H = 2.5;         // m — how far up the trunk collides
export const STEM_BASE_TOL = 1.5;  // m — instances are SUNK into the ground (world.mjs
                                   // buries a trunk 0.6-1.2 m so no daylight shows
                                   // under it), so the recorded base sits below the
                                   // floor you actually stand on. This is the slack.

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

class StemSet {
  constructor() {
    this.sx = new Float32Array(MAX_STEMS);
    this.sy = new Float32Array(MAX_STEMS);
    this.sz = new Float32Array(MAX_STEMS);
    this.sh = new Float32Array(MAX_STEMS);
    this.sr = new Float32Array(MAX_STEMS);   // trunk radius, world units
    this.n = 0;
    this.grid = new Map();
    this.sources = [];
    this.errors = 0;
    this.cell = CELL;
    this.ms = 0;
  }

  add(x, y, z, h, r) {
    if (this.n >= MAX_STEMS) return;
    const i = this.n++;
    this.sx[i] = x; this.sy[i] = y; this.sz[i] = z; this.sh[i] = h; this.sr[i] = r;
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
      ? { x: this.sx[i], y: this.sy[i], z: this.sz[i], h: this.sh[i], r: this.sr[i] }
      : null;
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
  // and STEM_H are real-world metres; everything else here is scene units.
  //
  // Returns { i, nx, nz, pen, r, dist } — the normal points AWAY from the trunk,
  // so pos += n * pen puts the body exactly on the surface. Null = no contact.
  stemHit(x, y, z, bodyR, unit = 1) {
    if (!this.n) return null;
    const H = STEM_H * unit, TOL = STEM_BASE_TOL * unit;
    const reach = bodyR + STEM_R * unit * 2.5;   // widest trunk we could touch
    const i0 = Math.floor((x - reach) / CELL), i1 = Math.floor((x + reach) / CELL);
    const j0 = Math.floor((z - reach) / CELL), j1 = Math.floor((z + reach) / CELL);
    let best = -1, bestPen = 0, bnx = 0, bnz = 0, bd = 0, br = 0;
    for (let cx = i0; cx <= i1; cx++) {
      for (let cz = j0; cz <= j1; cz++) {
        const a = this.grid.get(cx + ',' + cz);
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          // vertical gate: only the first STEM_H of trunk collides, and the
          // recorded base is sunk, so allow slack under it too
          if (y < this.sy[i] - TOL || y > this.sy[i] + TOL + H) continue;
          const r = this.sr[i] * unit + bodyR;
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
        S.sources.push({ name: o.name || '(unnamed instanced)', kind: 'instanced', n: o.count, h: +e.up.toFixed(1) });
        for (let i = 0; i < o.count && S.n < MAX_STEMS; i++) {
          o.getMatrixAt(i, M);
          V.setFromMatrixPosition(M).applyMatrix4(o.matrixWorld);
          const k = ((V.x * 2) | 0) + ',' + ((V.z * 2) | 0);
          if (seen.has(k)) continue;
          seen.add(k);
          S.add(V.x, V.y, V.z, e.up, STEM_R * xzScaleOf(M) * wsc);
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
        // a clustered stem has no instance scale to read; take the class default
        S.add(c.x, c.y0, c.z, Math.max(4, c.y1 - c.y0), STEM_R * wsc);
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
