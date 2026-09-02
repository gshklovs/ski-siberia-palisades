// Throwable snowballs. Pure fun — nothing here is load bearing.
//
// Self-contained, exactly like surprise.js: main.js imports it (the module
// attaches window.__playSnowball), calls init({ THREE, scene, camera, ctrl,
// hud, collision, poi, run }) once and update(dt) every frame. It reads the
// controller and the collision grid; it writes to neither, and it touches no
// other module's state. Every entry point is wrapped — a throw that fails is a
// missed snowball, never a broken frame.
//
// HOLD Q to charge (0–1 s, a small arc rings the crosshair), release to throw.
// Q is free in the world: the only other binding for it lives inside the
// locker's own key handler (inventory.js), which owns the whole keyboard while
// it is open — this module stands down for it, and for the pause panel, the
// gear menu and dev mode.
//
// Three pooled InstancedMeshes and nothing else in the scene graph:
//   snowballs (32)   spheres in flight, spinning
//   splats    (64)   flattened discs on whatever they landed on, ~20 s
//   puffs     (96)   the burst, and the dump out of a shaken tree
// Each is frustumCulled=false and hidden at count 0, so the whole feature is
// 0 draw calls at rest and 3 when everything is going off at once.
//
// A snowball never tests against the player, so a self-hit is not something
// that can be prevented — it is something that cannot happen. There is no
// damage, no knockback, no impulse, no gear interaction: impacts write to this
// module's own pools and to one tree instance's matrix, which is restored from
// a saved copy of its own 16 floats.

const MAX_BALL = 32;
const MAX_SPLAT = 64;
const MAX_PUFF = 96;

const CHARGE_MAX = 1.0;       // s — hold longer and it just stays at full
const SPEED_MIN = 8;          // m/s at a tap
const SPEED_MAX = 28;         // m/s at full charge
const GRAV = 16;              // m/s² — a touch heavy, so the arc reads
const BALL_R = 0.085;         // m
const FIRE_CD = 0.30;         // s between throws (~3/s rapid fire)
const LIFE = 6;               // s before a ball gives up
const RANGE = 400;            // m ditto
const SPLAT_LIFE = 20;        // s
const PUFF_LIFE = 0.6;        // s
const TRUNK_R = 0.55;         // m — how close counts as hitting a trunk
const WOBBLE = 0.85;          // s of tree shudder
const TOAST_MS = 2400;

const CELL = 8;               // m — tree-stem spatial hash, as in surprise.js
const MAX_STEMS = 60000;

const S = {
  ok: false, errors: 0,
  THREE: null, scene: null, camera: null, ctrl: null, hud: null, collision: null,
  u: 1, t: 0,
  // ---- pools
  ballMesh: null, splatMesh: null, puffMesh: null,
  balls: [], splats: [], puffs: [],
  nBall: 0, nSplat: 0, nPuff: 0,
  splatSeq: 0,
  // ---- input / charge
  down: false, chargeT: 0, cd: 0, thrown: 0, hits: 0, treeHits: 0,
  // ---- trees (measured, not trusted to names alone — see harvest())
  sx: null, sy: null, sz: null, sh: null, so: null, si: null,
  nStem: 0, grid: null, srcs: [], sources: [],
  wobbles: [],
  // ---- dom
  root: null, arc: null, arcPath: null, toastEl: null, toastT: -1, lastQuip: '',
  onKeyDown: null, onKeyUp: null, onBlur: null,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const pick = (a) => a[(Math.random() * a.length) | 0];
const rnd = (a, b) => a + Math.random() * (b - a);

// ===========================================================================
// the quip pool — our own toast, because surprise.js has no public hook for
// "say a line" (its forceTree() is a _test surface that also mutates its own
// streak and hit counters, so calling it would corrupt its stats). Nothing in
// surprise.js is edited or read.
// ===========================================================================

const TREE_QUIPS = [
  'the tree remembers.',
  'Direct hit. The tree files this under "Tuesday".',
  'The fir shakes off a decade of snow and stares at you.',
  'You have declared war on something that will outlive you.',
  'Snow dumped. Tree unbothered. Score unchanged.',
  'That is a felony in three counties and a bullseye in this one.',
  'The tree drops its load on principle.',
  'A squirrel has been displaced. It knows your face.',
  'Bullseye. The forest adds a line to your file.',
  'Bark received the message. Bark did not reply.',
];

// ===========================================================================
// DOM — our own overlay and our own stylesheet (.psnw__*)
// ===========================================================================

const CSS = `
.psnw { position: fixed; inset: 0; z-index: 22; pointer-events: none; }
.psnw__arc { position: absolute; left: 50%; top: 50%; width: 74px; height: 74px;
  margin: -37px 0 0 -37px; opacity: 0; transition: opacity .12s linear; }
.psnw__arc.is-on { opacity: 1; }
.psnw__arc circle { fill: none; stroke-linecap: round; transform: rotate(-90deg);
  transform-origin: 50% 50%; }
.psnw__trk { stroke: rgba(23,22,20,.42); stroke-width: 3; }
.psnw__bar { stroke: #eaf4ff; stroke-width: 3;
  filter: drop-shadow(0 0 3px rgba(0,0,0,.6)); }
.psnw__arc.is-full .psnw__bar { stroke: #9fd8ff; stroke-width: 4; }
/* Top centre, deliberately. The bottom of the screen is spoken for: surprise.js
   puts its quips at 82px and markers.js parks a station card just above that,
   and a snowball line landing in either lane came out stacked behind the card. */
.psnw__toast { position: absolute; left: 50%; top: 88px; transform: translateX(-50%);
  max-width: min(62vw, 640px); text-align: center;
  background: rgba(23,22,20,.88); color: #f4f1ea;
  border: 1px solid rgba(244,241,234,.22);   /* specs/0012 §C — no left stripe */
  border-radius: 3px; padding: 8px 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; font-weight: 650; letter-spacing: .045em; line-height: 1.45;
  text-shadow: 0 1px 6px rgba(0,0,0,.55); box-shadow: 0 6px 22px rgba(0,0,0,.34);
  animation: psnwIn .26s cubic-bezier(.18,1.5,.42,1) both; }
.psnw__toast .psnw__tag { display: block; margin-bottom: 3px;
  font-size: 9px; letter-spacing: .22em; color: #9fd8ff; text-transform: uppercase; }
.psnw__toast.is-out { animation: psnwOut .3s ease-in both; }
@keyframes psnwIn  { 0% { transform: translateX(-50%) translateY(-9px) scale(.94); opacity: 0 }
                   100% { transform: translateX(-50%); opacity: 1 } }
@keyframes psnwOut { 0% { opacity: 1 } 100% { transform: translateX(-50%) translateY(6px); opacity: 0 } }
@media (prefers-reduced-motion: reduce) { .psnw__toast, .psnw__toast.is-out { animation: none } }
`;

const ARC_R = 32;
const ARC_C = 2 * Math.PI * ARC_R;

function mountDom() {
  if (!document.getElementById('psnw-style')) {
    const st = document.createElement('style');
    st.id = 'psnw-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let root = document.querySelector('.psnw');
  if (!root) {
    root = document.createElement('div');
    root.className = 'psnw';
    document.body.appendChild(root);
  }
  root.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'psnw__arc');
  svg.setAttribute('viewBox', '0 0 74 74');
  const trk = document.createElementNS(NS, 'circle');
  trk.setAttribute('class', 'psnw__trk');
  trk.setAttribute('cx', '37'); trk.setAttribute('cy', '37'); trk.setAttribute('r', String(ARC_R));
  const bar = document.createElementNS(NS, 'circle');
  bar.setAttribute('class', 'psnw__bar');
  bar.setAttribute('cx', '37'); bar.setAttribute('cy', '37'); bar.setAttribute('r', String(ARC_R));
  bar.setAttribute('stroke-dasharray', String(ARC_C));
  bar.setAttribute('stroke-dashoffset', String(ARC_C));
  svg.appendChild(trk); svg.appendChild(bar);
  root.appendChild(svg);
  S.root = root; S.arc = svg; S.arcPath = bar;
}

function paintArc() {
  if (!S.arc) return;
  const on = S.down;
  S.arc.classList.toggle('is-on', on);
  if (!on) return;
  const k = clamp(S.chargeT / CHARGE_MAX, 0, 1);
  S.arc.classList.toggle('is-full', k >= 1);
  S.arcPath.setAttribute('stroke-dashoffset', String(ARC_C * (1 - k)));
}

function toast(text) {
  try {
    if (!S.root || !text) return;
    if (S.toastEl && S.toastEl.parentNode) S.toastEl.parentNode.removeChild(S.toastEl);
    const el = document.createElement('div');
    el.className = 'psnw__toast';
    const t = document.createElement('span');
    t.className = 'psnw__tag';
    t.textContent = 'SNOWBALL';
    el.appendChild(t);
    el.appendChild(document.createTextNode(text));
    S.root.appendChild(el);
    S.toastEl = el; S.toastT = 0; S.lastQuip = text;
  } catch { S.errors++; }
}

function tickToast(dt) {
  if (S.toastT < 0 || !S.toastEl) return;
  S.toastT += dt * 1000;
  if (S.toastT > TOAST_MS - 300) S.toastEl.classList.add('is-out');
  if (S.toastT > TOAST_MS) {
    if (S.toastEl.parentNode) S.toastEl.parentNode.removeChild(S.toastEl);
    S.toastEl = null; S.toastT = -1;
  }
}

// ===========================================================================
// pools
// ===========================================================================

// A note on how the splats fade. InstancedMesh carries a per-instance matrix
// and nothing else — no per-instance alpha — so a real fade would mean patching
// the fragment shader to spend instanceColor on opacity. Checked against the
// vendored r180: `color_pars_fragment` declares vColor only under USE_COLOR /
// USE_COLOR_ALPHA, NOT under USE_INSTANCING_COLOR, so the obvious patch
// compiles in the vertex stage and fails in the fragment one.
//
// Rather than carry a custom varying through both stages for a cosmetic
// snowball, each splat MELTS: it holds its size for the first 55% of its life
// and then eases down to nothing. That is per-instance, costs one scale, and
// is the honest behaviour of snow on snow anyway.
function splatFade(k) {                 // k = 1 at birth, 0 at death
  const f = clamp(k / 0.45, 0, 1);
  return f * f * (3 - 2 * f);
}

function buildPools(THREE, scene, u) {
  // ---- snowballs. Low segment count on purpose: the facets are what make the
  // spin legible at all, and 32 of them is under 1k triangles.
  const bg = new THREE.SphereGeometry(BALL_R * u, 7, 5);
  const bm = new THREE.MeshLambertMaterial({
    color: 0xf6fbff, emissive: 0x8fa4b8, flatShading: true,
  });
  const ball = new THREE.InstancedMesh(bg, bm, MAX_BALL);
  ball.name = 'psnw:balls';
  ball.frustumCulled = false;
  ball.count = 0;
  ball.visible = false;
  ball.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // ---- splats: a flat disc lying in the surface it hit, +Y in local space
  const sg = new THREE.CircleGeometry(1, 14);
  sg.rotateX(-Math.PI / 2);
  // forceSinglePass matters here: a transparent DoubleSide material is drawn
  // back faces then front faces in r180, so without it the splat pool alone
  // costs two draw calls instead of one. DoubleSide stays because a splat
  // lands on whatever normal the surface hands us.
  const sm = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.92,
    depthWrite: false, polygonOffset: true,
    polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    side: THREE.DoubleSide, forceSinglePass: true, fog: false,
  });
  const splat = new THREE.InstancedMesh(sg, sm, MAX_SPLAT);
  splat.name = 'psnw:splats';
  splat.frustumCulled = false;
  splat.renderOrder = 2;
  splat.count = 0;
  splat.visible = false;
  splat.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  // ---- puffs: 20-triangle blobs, scaled down to nothing as they die
  const pg = new THREE.IcosahedronGeometry(1, 0);
  const pm = new THREE.MeshLambertMaterial({
    color: 0xffffff, emissive: 0xa8c0d8, transparent: true, opacity: 0.82,
    depthWrite: false, flatShading: true, fog: false,
  });
  const puff = new THREE.InstancedMesh(pg, pm, MAX_PUFF);
  puff.name = 'psnw:puffs';
  puff.frustumCulled = false;
  puff.renderOrder = 3;
  puff.count = 0;
  puff.visible = false;
  puff.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  scene.add(ball, splat, puff);
  S.ballMesh = ball; S.splatMesh = splat; S.puffMesh = puff;

  for (let i = 0; i < MAX_BALL; i++) {
    S.balls.push({
      p: new THREE.Vector3(), v: new THREE.Vector3(),
      q: new THREE.Quaternion(), w: new THREE.Vector3(),
      t: 0, d: 0, r: BALL_R * u,
    });
  }
  for (let i = 0; i < MAX_SPLAT; i++) {
    S.splats.push({
      m: new THREE.Matrix4(), t: 0, life: SPLAT_LIFE, seq: 0,
      p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1),
    });
  }
  for (let i = 0; i < MAX_PUFF; i++) {
    S.puffs.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, life: PUFF_LIFE, r: 0.1 });
  }
}

// ===========================================================================
// tree harvest — the same measurement surprise.js uses (an instance is a tree
// if it stands 3–70 m, is taller than it is wide, and there are enough of them
// to be a forest), except that here each stem also remembers WHICH instance of
// WHICH mesh it came from, because a hit has to shake exactly one of them.
// ===========================================================================

const TREE_RE = /(^|[-_ ])(trees?|firs?|pines?|conifers?|spruces?|cedars?|snags?|forest|canopy|woods?|timber|birch|aspen|oaks?|poplar|larch|palms?)([-_ ]|\d|$)/i;

function named(o) {
  let q = o, n = 0;
  while (q && n++ < 6) {
    if (q.name && TREE_RE.test(q.name)) return true;
    q = q.parent;
  }
  return false;
}

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

function addStem(x, y, z, h, srcI, inst) {
  if (S.nStem >= MAX_STEMS) return;
  const i = S.nStem++;
  S.sx[i] = x; S.sy[i] = y; S.sz[i] = z; S.sh[i] = h;
  S.so[i] = srcI; S.si[i] = inst;
}

function harvest(THREE, scene) {
  S.sx = new Float32Array(MAX_STEMS);
  S.sy = new Float32Array(MAX_STEMS);
  S.sz = new Float32Array(MAX_STEMS);
  S.sh = new Float32Array(MAX_STEMS);
  S.so = new Int32Array(MAX_STEMS);
  S.si = new Int32Array(MAX_STEMS);
  const seen = new Set();
  const V = new THREE.Vector3();
  const M = new THREE.Matrix4();
  const P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();

  scene.updateMatrixWorld(true);

  scene.traverse((o) => {
    try {
      if (!o.geometry || (!o.isMesh && !o.isInstancedMesh)) return;
      if (o.name && /^(play:|fx:|psur|psnw)/.test(o.name)) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      const gx = bb.max.x - bb.min.x, gy = bb.max.y - bb.min.y, gz = bb.max.z - bb.min.z;
      const isNamed = named(o);

      if (o.isInstancedMesh) {
        if (!o.count) return;
        o.getMatrixAt(0, M);
        M.decompose(P, Q, SC);
        const e = worldExtent(o, gx * Math.abs(SC.x), gy * Math.abs(SC.y), gz * Math.abs(SC.z));
        const treeish = e.up >= 3 && e.up <= 70 && e.up >= e.flat * 1.15 && o.count >= 40;
        if (!isNamed && !treeish) return;
        if (isNamed && e.up < 1.5) return;
        const srcI = S.srcs.push(o) - 1;
        S.sources.push({ name: o.name || '(unnamed instanced)', kind: 'instanced', n: o.count, h: +e.up.toFixed(1) });
        for (let i = 0; i < o.count && S.nStem < MAX_STEMS; i++) {
          o.getMatrixAt(i, M);
          V.setFromMatrixPosition(M).applyMatrix4(o.matrixWorld);
          const k = ((V.x * 2) | 0) + ',' + ((V.z * 2) | 0);
          if (seen.has(k)) continue;
          seen.add(k);
          addStem(V.x, V.y, V.z, e.up, srcI, i);
        }
        return;
      }

      // merged forest baked into one buffer: cluster the vertex cloud. These
      // stems get the puff and the quip but no wobble — there is no single
      // transform that belongs to one of them.
      if (!isNamed) return;
      const pos = g.attributes && g.attributes.position;
      if (!pos || pos.count < 60) return;
      const e = worldExtent(o, gx, gy, gz);
      if (e.up < 2) return;
      const stride = Math.max(1, Math.floor(pos.count / 60000));
      const cells = new Map();
      for (let i = 0; i < pos.count; i += stride) {
        V.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        const k = Math.round(V.x / 3) + ',' + Math.round(V.z / 3);
        const c = cells.get(k);
        if (c) { c.n++; if (V.y < c.y0) c.y0 = V.y; if (V.y > c.y1) c.y1 = V.y; }
        else cells.set(k, { x: V.x, z: V.z, y0: V.y, y1: V.y, n: 1 });
      }
      const srcI = S.srcs.push(o) - 1;
      let added = 0;
      for (const c of cells.values()) {
        if (c.n < 2 || S.nStem >= MAX_STEMS) continue;
        addStem(c.x, c.y0, c.z, Math.max(4, c.y1 - c.y0), srcI, -1);
        added++;
      }
      if (added) S.sources.push({ name: o.name, kind: 'merged', n: added, h: +e.up.toFixed(1) });
      else S.srcs.pop();
    } catch { S.errors++; }
  });

  S.grid = new Map();
  for (let i = 0; i < S.nStem; i++) {
    const k = Math.floor(S.sx[i] / CELL) + ',' + Math.floor(S.sz[i] / CELL);
    let a = S.grid.get(k);
    if (!a) { a = []; S.grid.set(k, a); }
    a.push(i);
  }
}

// Nearest stem the segment (a -> b) passes through, as { i, t } with t the
// parameter along the segment. Height gated: the ball has to be somewhere on
// the trunk, not sailing over the canopy or tunnelling under the roots.
function sweepStem(ax, ay, az, bx, by, bz, r) {
  if (!S.grid || !S.nStem) return null;
  const r2 = r * r;
  const c0x = Math.floor(Math.min(ax, bx) / CELL) - 1, c1x = Math.floor(Math.max(ax, bx) / CELL) + 1;
  const c0z = Math.floor(Math.min(az, bz) / CELL) - 1, c1z = Math.floor(Math.max(az, bz) / CELL) + 1;
  if ((c1x - c0x) * (c1z - c0z) > 400) return null;
  const dx = bx - ax, dz = bz - az, dy = by - ay;
  const L2 = dx * dx + dz * dz;
  let best = -1, bestT = 2, bestD = r2;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      const arr = S.grid.get(cx + ',' + cz);
      if (!arr) continue;
      for (let n = 0; n < arr.length; n++) {
        const i = arr[n];
        let t = 0;
        if (L2 > 1e-9) t = clamp(((S.sx[i] - ax) * dx + (S.sz[i] - az) * dz) / L2, 0, 1);
        const qx = ax + dx * t - S.sx[i], qz = az + dz * t - S.sz[i];
        const d = qx * qx + qz * qz;
        if (d > bestD) continue;
        const y = ay + dy * t;
        if (y < S.sy[i] - 1.0 || y > S.sy[i] + S.sh[i] * 0.85) continue;
        if (t < bestT || (t === bestT && d < bestD)) { best = i; bestT = t; bestD = d; }
      }
    }
  }
  return best < 0 ? null : { i: best, t: bestT };
}

// ===========================================================================
// effects
// ===========================================================================

function addPuff(x, y, z, vx, vy, vz, r, life) {
  if (S.nPuff >= MAX_PUFF) {
    // oldest slot recycles — a burst is never worth dropping a frame over
    let old = 0, ot = -1;
    for (let i = 0; i < S.nPuff; i++) if (S.puffs[i].t > ot) { ot = S.puffs[i].t; old = i; }
    S.nPuff = Math.max(0, S.nPuff - 1);
    const tmp = S.puffs[old]; S.puffs[old] = S.puffs[S.nPuff]; S.puffs[S.nPuff] = tmp;
  }
  const p = S.puffs[S.nPuff++];
  p.p.set(x, y, z); p.v.set(vx, vy, vz);
  p.t = 0; p.life = life; p.r = r;
}

function burst(x, y, z, nx, ny, nz, n, spread, size) {
  const u = S.u;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = rnd(0.15, 1);
    const sx = Math.cos(a) * (1 - e * 0.6), sz = Math.sin(a) * (1 - e * 0.6);
    const sp = rnd(0.5, 1) * spread * u;
    addPuff(
      x + nx * 0.05 * u, y + ny * 0.05 * u, z + nz * 0.05 * u,
      (sx + nx * e) * sp, (e * 0.9 + ny * e) * sp, (sz + nz * e) * sp,
      rnd(0.5, 1.2) * size * u, rnd(0.7, 1.25) * PUFF_LIFE,
    );
  }
}

// A splat is not laid on the sky. The collision soup is already backdrop
// filtered by collision.js for auto-picked worlds; for a world that declares
// its own colliders[] the only thing that could still be up there is a lid, so
// a hit on the underside of something at the very ceiling of the world gets
// the puff and no decal.
function addSplat(x, y, z, nx, ny, nz, r) {
  try {
    const THREE = S.THREE, u = S.u;
    const b = S.collision && S.collision.bounds;
    if (b && ny < -0.3 && y > b.maxY - 1) return false;
    if (S.collision && S.collision.inBounds && !S.collision.inBounds(x, z)) return false;
    let slot;
    if (S.nSplat < MAX_SPLAT) slot = S.splats[S.nSplat++];
    else {
      // pool full: the oldest disc makes way, which is what a cap means
      let old = 0, os = Infinity;
      for (let i = 0; i < MAX_SPLAT; i++) if (S.splats[i].seq < os) { os = S.splats[i].seq; old = i; }
      slot = S.splats[old];
    }
    const n = new THREE.Vector3(nx, ny, nz);
    if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
    n.normalize();
    slot.q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    // a spin about the surface normal, so no two discs read as the same stamp
    const spin = new THREE.Quaternion().setFromAxisAngle(n, Math.random() * Math.PI * 2);
    slot.q.premultiply(spin);
    slot.p.set(x + nx * 0.025 * u, y + ny * 0.025 * u, z + nz * 0.025 * u);
    const w = r * rnd(0.85, 1.25);
    slot.s.set(w, 1, r * rnd(0.85, 1.25));
    slot.t = 0;
    slot.life = SPLAT_LIFE;
    slot.seq = ++S.splatSeq;
    return true;
  } catch { S.errors++; return false; }
}

function shakeTree(stem) {
  try {
    const THREE = S.THREE, u = S.u;
    const x = S.sx[stem], y = S.sy[stem], z = S.sz[stem], h = S.sh[stem];
    // the dump: a load of snow off the branches, falling
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, rr = rnd(0.15, 0.9) * Math.min(3.5, h * 0.28);
      addPuff(
        x + Math.cos(a) * rr * u, y + h * rnd(0.55, 0.9) * u, z + Math.sin(a) * rr * u,
        Math.cos(a) * rnd(0.1, 0.5) * u, rnd(-1.6, -0.4) * u, Math.sin(a) * rnd(0.1, 0.5) * u,
        rnd(0.9, 2.0) * u, rnd(1.4, 2.4),
      );
    }
    const obj = S.srcs[S.so[stem]];
    const inst = S.si[stem];
    if (!obj || !obj.isInstancedMesh || inst < 0) return false;
    for (const w of S.wobbles) if (w.obj === obj && w.inst === inst) return false;   // already shaking
    const M = new THREE.Matrix4();
    obj.getMatrixAt(inst, M);
    const saved = new Float32Array(16);
    saved.set(M.elements);
    S.wobbles.push({
      obj, inst, saved, t: 0,
      amp: 0.05 + Math.random() * 0.02,
      ph: Math.random() * Math.PI * 2,
      P: new THREE.Vector3(), Q: new THREE.Quaternion(), SC: new THREE.Vector3(),
      M: new THREE.Matrix4(), T: new THREE.Quaternion(), E: new THREE.Euler(),
    });
    return true;
  } catch { S.errors++; return false; }
}

// The wobble is a damped shudder about the instance origin — which for every
// tree instanced mesh in these worlds is the base of the trunk. When it ends
// the instance's own 16 floats go back verbatim, so the transform is restored
// bit for bit, not approximately.
function tickWobbles(dt) {
  for (let i = S.wobbles.length - 1; i >= 0; i--) {
    const w = S.wobbles[i];
    try {
      w.t += dt;
      const done = w.t >= WOBBLE;
      w.M.fromArray(w.saved);
      if (!done) {
        w.M.decompose(w.P, w.Q, w.SC);
        const k = 1 - w.t / WOBBLE;
        const a = Math.sin(w.t * 24 + w.ph) * w.amp * k * k;
        w.E.set(a, 0, a * 0.55);
        w.T.setFromEuler(w.E);
        w.Q.premultiply(w.T);
        w.M.compose(w.P, w.Q, w.SC);
      }
      w.obj.setMatrixAt(w.inst, w.M);
      w.obj.instanceMatrix.needsUpdate = true;
      if (done) S.wobbles.splice(i, 1);
    } catch { S.errors++; S.wobbles.splice(i, 1); }
  }
}

// ===========================================================================
// throwing
// ===========================================================================

// Spawn a ball. `dir` is a unit THREE.Vector3; omit it and the camera decides.
function launch(charge, dir) {
  const THREE = S.THREE, u = S.u;
  if (S.nBall >= MAX_BALL) {
    // the pool is the cap: recycle the oldest rather than refuse the throw
    let old = 0, ot = -1;
    for (let i = 0; i < S.nBall; i++) if (S.balls[i].t > ot) { ot = S.balls[i].t; old = i; }
    const tmp = S.balls[old]; S.balls[old] = S.balls[S.nBall - 1]; S.balls[S.nBall - 1] = tmp;
    S.nBall--;
  }
  const b = S.balls[S.nBall++];
  const cam = S.camera;
  cam.updateMatrixWorld();
  const f = dir ? dir.clone().normalize()
    : new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  // out past the lens, off to the throwing side and a touch low. The player is
  // not in the collision query at all, so this is framing, not safety.
  b.p.copy(cam.position)
    .addScaledVector(f, 0.55 * u)
    .addScaledVector(right, 0.16 * u)
    .addScaledVector(up, -0.14 * u);
  const sp = (SPEED_MIN + (SPEED_MAX - SPEED_MIN) * clamp(charge, 0, 1)) * u;
  b.v.copy(f).multiplyScalar(sp);
  // whatever is carrying you is carrying the snowball: lead your own line and
  // you can land one in your own landing zone
  const cv = S.ctrl && S.ctrl.velocity;
  if (cv) b.v.add(cv);
  b.q.identity();
  b.w.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(6, 14));
  b.t = 0; b.d = 0;
  S.thrown++;
  return b;
}

function killBall(i) {
  S.nBall--;
  if (i !== S.nBall) { const t = S.balls[i]; S.balls[i] = S.balls[S.nBall]; S.balls[S.nBall] = t; }
}

function stepBalls(dt) {
  const THREE = S.THREE, u = S.u;
  const g = GRAV * u;
  for (let i = S.nBall - 1; i >= 0; i--) {
    const b = S.balls[i];
    b.t += dt;
    b.v.y -= g * dt;
    const dx = b.v.x * dt, dy = b.v.y * dt, dz = b.v.z * dt;
    const len = Math.hypot(dx, dy, dz);
    const nx = b.p.x + dx, ny = b.p.y + dy, nz = b.p.z + dz;

    // whichever comes first along this step: a trunk, or a surface
    let tHit = 2, kind = '', stem = -1, hn = null;
    const sw = sweepStem(b.p.x, b.p.y, b.p.z, nx, ny, nz, (TRUNK_R + BALL_R) * u);
    if (sw) { tHit = sw.t; kind = 'tree'; stem = sw.i; }
    if (len > 1e-6 && S.collision) {
      const hit = S.collision.raycast(b.p.x, b.p.y, b.p.z, dx / len, dy / len, dz / len, len + b.r);
      if (hit) {
        const t = hit.dist / len;
        if (t < tHit) {
          tHit = t; kind = 'hit'; stem = -1;
          hn = { x: hit.nx, y: hit.ny, z: hit.nz, d: hit.dist };   // `best` is shared — copy now
        }
      }
    }

    if (kind === 'tree') {
      const px = b.p.x + dx * tHit, py = b.p.y + dy * tHit, pz = b.p.z + dz * tHit;
      S.hits++; S.treeHits++;
      burst(px, py, pz, 0, 0.4, 0, 8, 2.4, 0.16);
      shakeTree(stem);
      toast(pick(TREE_QUIPS));
      killBall(i);
      continue;
    }
    if (kind === 'hit') {
      const d = Math.max(0, hn.d - b.r * 0.5);
      const px = b.p.x + (dx / len) * d, py = b.p.y + (dy / len) * d, pz = b.p.z + (dz / len) * d;
      S.hits++;
      burst(px, py, pz, hn.x, hn.y, hn.z, 7, 2.0, 0.14);
      addSplat(px, py, pz, hn.x, hn.y, hn.z, rnd(0.30, 0.52) * u);
      killBall(i);
      continue;
    }

    b.d += len;
    b.p.set(nx, ny, nz);
    if (b.t > LIFE || b.d > RANGE * u) { killBall(i); continue; }
    // spin, integrated as a small rotation each frame
    const wl = b.w.length();
    if (wl > 1e-6) {
      const qd = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(b.w.x / wl, b.w.y / wl, b.w.z / wl), wl * dt,
      );
      b.q.premultiply(qd).normalize();
    }
  }
}

function stepPuffs(dt) {
  const g = GRAV * 0.35 * S.u;
  for (let i = S.nPuff - 1; i >= 0; i--) {
    const p = S.puffs[i];
    p.t += dt;
    if (p.t >= p.life) {
      S.nPuff--;
      if (i !== S.nPuff) { const t = S.puffs[i]; S.puffs[i] = S.puffs[S.nPuff]; S.puffs[S.nPuff] = t; }
      continue;
    }
    p.v.y -= g * dt;
    p.v.multiplyScalar(1 - Math.min(0.9, 2.4 * dt));
    p.p.addScaledVector(p.v, dt);
  }
}

function stepSplats(dt) {
  for (let i = S.nSplat - 1; i >= 0; i--) {
    const s = S.splats[i];
    s.t += dt;
    if (s.t >= s.life) {
      S.nSplat--;
      if (i !== S.nSplat) { const t = S.splats[i]; S.splats[i] = S.splats[S.nSplat]; S.splats[S.nSplat] = t; }
    }
  }
}

// ===========================================================================
// drawing the pools
// ===========================================================================

let _M = null, _Q = null, _S3 = null;

function drawPools() {
  const THREE = S.THREE;
  if (!_M) { _M = new THREE.Matrix4(); _Q = new THREE.Quaternion(); _S3 = new THREE.Vector3(); }

  // ---- balls
  const bm = S.ballMesh;
  for (let i = 0; i < S.nBall; i++) {
    const b = S.balls[i];
    _M.compose(b.p, b.q, _S3.set(1, 1, 1));
    bm.setMatrixAt(i, _M);
  }
  bm.count = S.nBall;
  bm.visible = S.nBall > 0;
  if (S.nBall > 0) bm.instanceMatrix.needsUpdate = true;

  // ---- splats: hold, then melt out (see splatFade)
  const sm = S.splatMesh;
  for (let i = 0; i < S.nSplat; i++) {
    const s = S.splats[i];
    const f = splatFade(clamp(1 - s.t / s.life, 0, 1));
    _S3.set(s.s.x * f, 1, s.s.z * f);
    _M.compose(s.p, s.q, _S3);
    sm.setMatrixAt(i, _M);
  }
  sm.count = S.nSplat;
  sm.visible = S.nSplat > 0;
  if (S.nSplat > 0) sm.instanceMatrix.needsUpdate = true;

  // ---- puffs: grow a little, then collapse to nothing
  const pm = S.puffMesh;
  for (let i = 0; i < S.nPuff; i++) {
    const p = S.puffs[i];
    const k = clamp(p.t / p.life, 0, 1);
    const r = p.r * (0.55 + 0.85 * Math.sin(Math.PI * Math.min(1, k * 1.6)) * (1 - k * 0.5)) * (1 - k * k);
    _M.compose(p.p, _Q.identity(), _S3.set(r, r, r));
    pm.setMatrixAt(i, _M);
  }
  pm.count = S.nPuff;
  pm.visible = S.nPuff > 0;
  if (S.nPuff > 0) pm.instanceMatrix.needsUpdate = true;
}

// ===========================================================================
// input
// ===========================================================================

const KEY = 'KeyQ';

function typingIn(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

// Every screen that owns the keyboard gets it: the pause panel, the gear menu,
// the locker (whose own Q switches tabs) and dev mode. This module never
// preventDefaults and never stops propagation, so nothing else changes shape.
function blocked() {
  try {
    if (S.hud && S.hud.isPaused && S.hud.isPaused()) return true;
    if (S.hud && S.hud.gearOpen && S.hud.gearOpen()) return true;
    const P = window.__player;
    if (P) {
      if (P.devMode && P.devMode()) return true;
      if (P.inventoryOpen && P.inventoryOpen()) return true;
    }
  } catch { S.errors++; }
  return false;
}

function bindKeys() {
  S.onKeyDown = (e) => {
    try {
      if (e.code !== KEY || e.repeat || typingIn(e.target)) return;
      if (blocked()) return;
      S.down = true; S.chargeT = 0;
    } catch { S.errors++; }
  };
  S.onKeyUp = (e) => {
    try {
      if (e.code !== KEY) return;
      if (!S.down) return;
      S.down = false;
      const charge = clamp(S.chargeT / CHARGE_MAX, 0, 1);
      S.chargeT = 0;
      paintArc();
      if (blocked() || S.cd > 0) return;
      launch(charge);
      S.cd = FIRE_CD;
    } catch { S.errors++; }
  };
  S.onBlur = () => { S.down = false; S.chargeT = 0; paintArc(); };
  addEventListener('keydown', S.onKeyDown);
  addEventListener('keyup', S.onKeyUp);
  addEventListener('blur', S.onBlur);
}

// ===========================================================================
// public
// ===========================================================================

export function init(ctx) {
  try {
    if (S.ok || !ctx) return;
    S.THREE = ctx.THREE; S.scene = ctx.scene; S.camera = ctx.camera;
    S.ctrl = ctx.ctrl; S.hud = ctx.hud; S.collision = ctx.collision || null;
    S.poi = ctx.poi || ''; S.run = ctx.run || '';
    if (!S.THREE || !S.scene || !S.camera) return;
    S.u = (S.ctrl && S.ctrl.T && S.ctrl.T.eyeHeight) ? S.ctrl.T.eyeHeight / 1.70 : 1;
    mountDom();
    buildPools(S.THREE, S.scene, S.u);
    harvest(S.THREE, S.scene);
    bindKeys();
    S.ok = true;
  } catch { S.errors++; }
}

export function update(dt) {
  if (!S.ok) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    tickToast(dt);
    const paused = blocked();
    if (paused && S.down) { S.down = false; S.chargeT = 0; }
    if (S.cd > 0) S.cd -= dt;
    if (!paused) {
      S.t += dt;
      if (S.down) S.chargeT = Math.min(CHARGE_MAX, S.chargeT + dt);
      stepBalls(dt);
      stepPuffs(dt);
      stepSplats(dt);
      tickWobbles(dt);
    }
    paintArc();
    drawPools();
  } catch { S.errors++; }
}

export function stats() {
  return {
    thrown: S.thrown, hits: S.hits, treeHits: S.treeHits,
    live: S.nBall, splats: S.nSplat, errors: S.errors,
    puffs: S.nPuff, wobbles: S.wobbles.length,
    charging: S.down, charge: +(S.chargeT / CHARGE_MAX).toFixed(3),
    stems: S.nStem, unit: S.u, ok: S.ok, key: KEY,
  };
}

// A throw the tests can aim. `chargeSec` 0..1 picks the speed exactly as the
// key does; `pitchDeg` (positive = up) aims off the controller's own yaw, and
// omitting it uses wherever the camera is actually looking.
export function throwBall(chargeSec, pitchDeg) {
  try {
    if (!S.ok) return null;
    const THREE = S.THREE;
    let dir = null;
    if (pitchDeg !== undefined && pitchDeg !== null) {
      const yaw = S.ctrl ? S.ctrl.yaw : 0;
      const p = (pitchDeg * Math.PI) / 180;
      dir = new THREE.Vector3(
        -Math.sin(yaw) * Math.cos(p), Math.sin(p), -Math.cos(yaw) * Math.cos(p),
      );
    }
    const b = launch(clamp((chargeSec || 0) / CHARGE_MAX, 0, 1), dir);
    return { p: b.p.toArray(), v: b.v.toArray(), live: S.nBall };
  } catch { S.errors++; return null; }
}

const _test = {
  stats,
  sources: () => S.sources.slice(),
  live: () => S.balls.slice(0, S.nBall).map((b) => ({ p: b.p.toArray(), v: b.v.toArray(), t: +b.t.toFixed(3), d: +b.d.toFixed(1) })),
  splatList: () => S.splats.slice(0, S.nSplat).map((s) => ({ p: s.p.toArray(), t: +s.t.toFixed(2), seq: s.seq })),
  drawn: () => ({
    balls: S.ballMesh ? (S.ballMesh.visible ? 1 : 0) : 0,
    splats: S.splatMesh ? (S.splatMesh.visible ? 1 : 0) : 0,
    puffs: S.puffMesh ? (S.puffMesh.visible ? 1 : 0) : 0,
  }),
  charge: (v) => { S.down = !!v; if (v) S.chargeT = 0; paintArc(); return S.down; },
  setCharge: (sec) => { S.chargeT = clamp(sec, 0, CHARGE_MAX); paintArc(); return S.chargeT; },
  cooldown: () => S.cd,
  clearCooldown: () => { S.cd = 0; },
  lastQuip: () => S.lastQuip,
  toastText: () => (S.toastEl ? S.toastEl.textContent : ''),
  arcOn: () => !!(S.arc && S.arc.classList.contains('is-on')),
  // ---- trees
  stems: () => S.nStem,
  nearestTree: (x, z, maxR) => {
    let best = -1, bd = (maxR || 500) * (maxR || 500);
    for (let i = 0; i < S.nStem; i++) {
      const dx = S.sx[i] - x, dz = S.sz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : {
      i: best, x: S.sx[best], y: S.sy[best], z: S.sz[best], h: S.sh[best],
      d: Math.sqrt(bd), instanced: S.si[best] >= 0,
    };
  },
  // the first stem at least `minD` away that belongs to an InstancedMesh, i.e.
  // one that can actually be wobbled and byte-compared
  pickInstancedTree: (x, z, minD, maxD) => {
    for (let i = 0; i < S.nStem; i++) {
      if (S.si[i] < 0) continue;
      const d = Math.hypot(S.sx[i] - x, S.sz[i] - z);
      if (d < (minD || 0) || d > (maxD || 1e9)) continue;
      return { i, x: S.sx[i], y: S.sy[i], z: S.sz[i], h: S.sh[i], d, inst: S.si[i], src: S.so[i] };
    }
    return null;
  },
  // the instance's own 16 floats, for an exact before/after compare
  stemMatrix: (i) => {
    if (i < 0 || i >= S.nStem) return null;
    const obj = S.srcs[S.so[i]];
    if (!obj || !obj.isInstancedMesh || S.si[i] < 0) return null;
    const M = new S.THREE.Matrix4();
    obj.getMatrixAt(S.si[i], M);
    return Array.from(M.elements);
  },
  wobbling: () => S.wobbles.length,
  // aim a ball at a world point and let ballistics pick the elevation, so a
  // test can hit a named tree instead of hoping
  throwAt: (x, y, z, speedMul) => {
    try {
      if (!S.ok) return null;
      const THREE = S.THREE, u = S.u, g = GRAV * u;
      const cam = S.camera;
      cam.updateMatrixWorld();
      const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
      const rx = x - ox, rz = z - oz, H = y - oy;
      const R = Math.hypot(rx, rz);
      for (const v of [SPEED_MAX * u * (speedMul || 1), SPEED_MAX * u * 1.6, SPEED_MAX * u * 2.4]) {
        const disc = v * v * v * v - g * (g * R * R + 2 * H * v * v);
        if (disc < 0) continue;
        const tan = (v * v - Math.sqrt(disc)) / (g * R);
        const dir = new THREE.Vector3(rx / R, tan, rz / R).normalize();
        const b = launch(0, dir);
        // launch() inherits the rider's velocity, which is right for a thrown
        // ball and wrong for an aimed test shot: here the aim IS the answer
        b.v.copy(dir).multiplyScalar(v);
        return { p: b.p.toArray(), v: b.v.toArray(), speed: v, tan };
      }
      return null;
    } catch { S.errors++; return null; }
  },
  clear: () => {
    S.nBall = 0; S.nSplat = 0; S.nPuff = 0;
    for (const w of S.wobbles.slice()) { try { w.M.fromArray(w.saved); w.obj.setMatrixAt(w.inst, w.M); w.obj.instanceMatrix.needsUpdate = true; } catch { S.errors++; } }
    S.wobbles.length = 0;
    S.thrown = 0; S.hits = 0; S.treeHits = 0; S.cd = 0; S.down = false; S.chargeT = 0;
    if (S.toastEl && S.toastEl.parentNode) S.toastEl.parentNode.removeChild(S.toastEl);
    S.toastEl = null; S.toastT = -1;
    drawPools();
  },
  destroy: () => {
    removeEventListener('keydown', S.onKeyDown);
    removeEventListener('keyup', S.onKeyUp);
    removeEventListener('blur', S.onBlur);
    for (const m of [S.ballMesh, S.splatMesh, S.puffMesh]) if (m && m.parent) m.parent.remove(m);
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    S.ok = false;
  },
};

window.__playSnowball = { init, update, stats, throw: throwBall, _test };
export default init;
