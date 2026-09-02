// Comedy + surprise layer for the first-person player.
//
// Self-contained — touches no other module, edits no world file. main.js wires
// it exactly the way it wires fx.js and audio.js:
//   import './surprise.js'          (module attaches window.__playSurprise)
//   window.__playSurprise.init({ THREE, scene, camera, ctrl, poi, run, hud })
//   window.__playSurprise.update(dt)        // once per frame
//
// Two features, both hardened no-ops on failure:
//
//   1. TREE QUIPS (every map). At init the scene graph is scanned for tree-ish
//      meshes — named InstancedMeshes ('firs-big', 'pines-alpine', 'snags'…),
//      *unnamed* InstancedMeshes that measure like trees (eastnor and joyride
//      ship theirs with no name at all), and merged tree meshes whose vertices
//      get clustered into stems (sand-harbor bakes 4000 pines into one buffer).
//      Every stem lands in an 8 m spatial hash. Each frame the swept segment
//      from last position to this one is tested against it: brush a trunk at
//      speed, or decelerate hard / wipe out next to one, and you get a line.
//      Trees are decor in every one of these worlds — nothing collides with
//      them — so "you went through it" is the honest event to detect.
//
//   2. SURPRISES (five per finished world). A per-poi registry of one-shot
//      proximity/condition triggers, defined here in world coordinates, each
//      with a line of text and usually a tiny prop this module adds to the
//      scene itself. Nothing in runs/ is touched.
//
// Budget: one DOM overlay + one <style>, a few Float32Arrays for the stem hash
// (~0.6 MB at the 60k cap), and under 4k triangles of props per map. The
// per-frame cost is one segment/hash query and one loop over ≤5 registry rows.
//
// The camera belongs to main.js — this module never writes to it.

const CELL = 8;             // m — spatial-hash cell for tree stems
const MAX_STEMS = 60000;    // hard cap on harvested stems
const QUIP_CD = 2.6;        // s — one crash, one line
const TOAST_MS = 2500;      // toast lifetime
const JUMP_GUARD = 25;      // m — a bigger step than this is a teleport, not a run

const S = {
  ok: false,
  THREE: null, scene: null, camera: null, ctrl: null, hud: null,
  poi: '', run: '', u: 1,
  // ---- tree hash
  sx: null, sy: null, sz: null, sh: null,     // stem x / base y / z / height
  nStem: 0, grid: null, sources: [],
  // ---- per-frame state
  px: 0, py: 0, pz: 0, havePrev: false,
  prevSpeed: 0, prevGrounded: true, prevVy: 0, prevWipe: 0,
  airT: 0, t: 0, runT: 0,
  // ---- comedy state
  quipCd: 0, streak: 0, treeHits: 0, recent: [], lastQuip: '',
  // ---- surprises
  regs: [], props: [], fired: 0,
  // ---- dom
  root: null, live: [],
  dbg: { speed: 0, step: 0, decel: 0, crashed: false, cd: 0, dt: 0, r: 0, hit: -1 },
  errors: 0,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

// ===========================================================================
// the quip pool
// ===========================================================================

const QUIPS_GENERIC = [
  'The tree was there first.',
  'Branch manager says no.',
  "That one's been standing since 1957. Still is.",
  'Tree: 1. You: still counting.',
  'You have been served. By a conifer.',
  "It didn't move. It never moves.",
  'Photosynthesis 1, ambition 0.',
  'Somewhere a forest ranger felt that.',
  'New personal best: shortest line.',
  "That's a trunk call.",
  'You found the one tree in the whole bowl. Congratulations.',
  'Bark worse than the bite? No. Same.',
  "The tree filed no complaint. It doesn't need to.",
  'Timber. Except the tree is fine.',
  'Direct deposit into the woods.',
  'You may not park here.',
  'Nature says: skill issue.',
  'Rooted in tradition. And in the ground.',
  "It's a tree. That's the whole feature list.",
  'Glades are 90% glade and 10% skiing. You found the 90.',
  'The trail was over there. Just so you know.',
  "That'll buff out. The tree will.",
  'You have made contact with the local flora.',
  'Sap tax collected.',
  'Consider this your annual ring.',
  'Hard reset, courtesy of a fir.',
  'Line choice: bold. Outcome: wooden.',
  'The forest keeps a list. You are on it.',
  'You were doing so well.',
  'Tree hugging, but at speed.',
  'Full send, half tree.',
  'Deciduous? No. Decisive.',
];

const QUIPS_GEAR = {
  skis: [
    'The skis wanted the gap. You wanted the tree.',
    'Edges are for snow. That was not snow.',
    'Two planks, one fir, no survivors. Metaphorically.',
    'Your P-tex is now part of the ecosystem.',
    'Powder day ruined by a Douglas fir. Classic.',
  ],
  bike: [
    "That's a warranty conversation.",
    'Bar ends versus tree. Tree undefeated.',
    'The tree did not yield the trail.',
    'You just trued that wheel. In the wrong direction.',
    'Rubber side down, wooden side everywhere.',
  ],
  boots: [
    'You walked into a tree. On purpose, presumably.',
    'Pedestrians yield to timber.',
    'Sprinting into a tree is a choice, and you made it.',
    'This is why the trail has a trail.',
  ],
  glider: [
    'The wing found a tree. The tree found the wing.',
    "That is not thermal lift, that's a fir.",
    'Aviation rule one: trees are terrain.',
    'You have landed. In a tree. Technically a landing.',
  ],
};

const QUIPS_RARE = [
  'The tree would like you to know it identifies as load-bearing.',
  'A squirrel witnessed that and has told everyone.',
  'Local legend says this tree has taken 400 skiers. 401.',
  'Somewhere a lumberjack just felt a disturbance in the Force.',
  'The tree has requested your incident report in triplicate.',
  'This fir was planted the year the lift opened. It remembers.',
  'Ent activity detected. Please do not provoke.',
  'You have unlocked: WOODWORK.',
  'The tree is fine. Thank you for asking.',
  'That tree has a name. It is Gary. Gary is fine.',
];

// streak escalation — first entry whose n is <= the streak count, searched down
const QUIPS_STREAK = [
  [15, 'Fifteen. You have been formally adopted by the woods.'],
  [10, 'TEN TREES. The forest has opened a file.'],
  [7, 'Seven. At this point it is a relationship.'],
  [5, 'Five trees. You are not skiing, you are pruning.'],
  [4, 'Four. The forest is taking notes.'],
  [3, '3rd tree this run — they are recruiting you.'],
  [2, 'Second tree. Coincidence.'],
];

function quipFor(mode, streak) {
  // streak lines take over on the milestones, so escalation reads clearly
  for (const [n, line] of QUIPS_STREAK) if (streak === n) return line;
  if (Math.random() < 0.05) return notRecent(QUIPS_RARE);
  const gear = QUIPS_GEAR[mode] || QUIPS_GEAR.boots;
  const pool = Math.random() < 0.28 ? gear : QUIPS_GENERIC;
  return notRecent(pool);
}

// no immediate repeats — remember the last 8 lines shown
function notRecent(pool) {
  for (let i = 0; i < 12; i++) {
    const q = pick(pool);
    if (S.recent.indexOf(q) < 0) { remember(q); return q; }
  }
  const q = pick(pool); remember(q); return q;
}
function remember(q) {
  S.recent.push(q);
  if (S.recent.length > 8) S.recent.shift();
}

// ===========================================================================
// DOM: our own overlay + our own stylesheet (.psur__*)
// ===========================================================================

const CSS = `
.psur { position: fixed; left: 0; right: 0; bottom: 82px; z-index: 21;
  display: flex; flex-direction: column-reverse; align-items: center; gap: 6px;
  pointer-events: none; }
.psur__toast {
  max-width: min(62vw, 640px); text-align: center;
  background: rgba(23, 22, 20, .88); color: #f4f1ea;
  border: 1px solid rgba(244, 241, 234, .22); border-left: 3px solid #f0641e;
  border-radius: 3px; padding: 8px 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px; font-weight: 650; letter-spacing: .045em; line-height: 1.45;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .55);
  box-shadow: 0 6px 22px rgba(0, 0, 0, .34);
  animation: psurIn .28s cubic-bezier(.18, 1.5, .42, 1) both;
}
.psur__toast.is-out { animation: psurOut .3s ease-in both; }
.psur__toast .psur__tag {
  display: block; margin-bottom: 3px;
  font-size: 9px; letter-spacing: .22em; color: #f0641e; text-transform: uppercase;
}
.psur__toast.is-rare { border-left-color: #ffd166; }
.psur__toast.is-rare .psur__tag { color: #ffd166; }
@keyframes psurIn  { 0% { transform: translateY(9px) scale(.94); opacity: 0 } 100% { transform: none; opacity: 1 } }
@keyframes psurOut { 0% { opacity: 1 } 100% { transform: translateY(-6px); opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  .psur__toast, .psur__toast.is-out { animation: none; }
}
`;

function mountDom() {
  if (!document.getElementById('psur-style')) {
    const st = document.createElement('style');
    st.id = 'psur-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  let root = document.querySelector('.psur');
  if (!root) {
    root = document.createElement('div');
    root.className = 'psur';
    document.body.appendChild(root);
  }
  S.root = root;
}

// A toast is its own element and removes itself — nothing accumulates.
function toast(text, tag, rare) {
  try {
    if (!S.root || !text) return;
    while (S.live.length >= 2) killToast(S.live[0]);
    const el = document.createElement('div');
    el.className = 'psur__toast' + (rare ? ' is-rare' : '');
    if (tag) {
      const t = document.createElement('span');
      t.className = 'psur__tag';
      t.textContent = tag;
      el.appendChild(t);
    }
    el.appendChild(document.createTextNode(text));
    S.root.appendChild(el);
    const rec = { el, t: 0 };
    S.live.push(rec);
    S.lastQuip = text;
  } catch { S.errors++; }
}

function killToast(rec) {
  const i = S.live.indexOf(rec);
  if (i >= 0) S.live.splice(i, 1);
  if (rec.el && rec.el.parentNode) rec.el.parentNode.removeChild(rec.el);
}

function tickToasts(dt) {
  for (let i = S.live.length - 1; i >= 0; i--) {
    const r = S.live[i];
    r.t += dt * 1000;
    if (r.t > TOAST_MS - 300 && !r.out) { r.out = true; r.el.classList.add('is-out'); }
    if (r.t > TOAST_MS) killToast(r);
  }
}

// ===========================================================================
// tree harvest
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

// world-space extents of one instance: how tall, how wide. Handles the
// play:zup wrapper (a z-up world's tree geometry is tall along local Z).
function worldExtent(THREE, obj, sizeX, sizeY, sizeZ) {
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

function addStem(x, y, z, h) {
  if (S.nStem >= MAX_STEMS) return;
  const i = S.nStem++;
  S.sx[i] = x; S.sy[i] = y; S.sz[i] = z; S.sh[i] = h;
}

function harvest(THREE, scene) {
  S.sx = new Float32Array(MAX_STEMS);
  S.sy = new Float32Array(MAX_STEMS);
  S.sz = new Float32Array(MAX_STEMS);
  S.sh = new Float32Array(MAX_STEMS);
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
        const e = worldExtent(THREE, o, gx * Math.abs(SC.x), gy * Math.abs(SC.y), gz * Math.abs(SC.z));
        const treeish = e.up >= 3 && e.up <= 70 && e.up >= e.flat * 1.15 && o.count >= 40;
        if (!isNamed && !treeish) return;
        if (isNamed && e.up < 1.5) return;           // named but tiny: not a trunk
        S.sources.push({ name: o.name || '(unnamed instanced)', kind: 'instanced', n: o.count, h: +e.up.toFixed(1) });
        for (let i = 0; i < o.count && S.nStem < MAX_STEMS; i++) {
          o.getMatrixAt(i, M);
          V.setFromMatrixPosition(M).applyMatrix4(o.matrixWorld);
          const k = ((V.x * 2) | 0) + ',' + ((V.z * 2) | 0);
          if (seen.has(k)) continue;
          seen.add(k);
          addStem(V.x, V.y, V.z, e.up);
        }
        return;
      }

      // merged tree mesh (sand-harbor bakes its forest into one buffer): cluster
      // the vertex cloud on a 3 m XZ grid and call each populated cell a stem.
      if (!isNamed) return;
      const pos = g.attributes && g.attributes.position;
      if (!pos || pos.count < 60) return;
      const e = worldExtent(THREE, o, gx, gy, gz);
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
      let added = 0;
      for (const c of cells.values()) {
        if (c.n < 2 || S.nStem >= MAX_STEMS) continue;
        addStem(c.x, c.y0, c.z, Math.max(4, c.y1 - c.y0));
        added++;
      }
      if (added) S.sources.push({ name: o.name, kind: 'merged', n: added, h: +e.up.toFixed(1) });
    } catch { S.errors++; }
  });

  // ---- spatial hash
  S.grid = new Map();
  for (let i = 0; i < S.nStem; i++) {
    const k = Math.floor(S.sx[i] / CELL) + ',' + Math.floor(S.sz[i] / CELL);
    let a = S.grid.get(k);
    if (!a) { a = []; S.grid.set(k, a); }
    a.push(i);
  }
}

// squared distance from point i's stem to the segment (ax,az)->(bx,bz)
function segDist2(i, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = 0;
  if (L2 > 1e-9) t = clamp(((S.sx[i] - ax) * dx + (S.sz[i] - az) * dz) / L2, 0, 1);
  const qx = ax + dx * t - S.sx[i];
  const qz = az + dz * t - S.sz[i];
  return qx * qx + qz * qz;
}

// nearest stem to the swept segment, within `r`, at a height the body occupies
function hitStem(ax, ay, az, bx, by, bz, r) {
  if (!S.grid) return -1;
  const r2 = r * r;
  const c0x = Math.floor(Math.min(ax, bx) / CELL) - 1, c1x = Math.floor(Math.max(ax, bx) / CELL) + 1;
  const c0z = Math.floor(Math.min(az, bz) / CELL) - 1, c1z = Math.floor(Math.max(az, bz) / CELL) + 1;
  if ((c1x - c0x) * (c1z - c0z) > 400) return -1;      // absurd sweep: bail
  let best = -1, bestD = r2;
  for (let cx = c0x; cx <= c1x; cx++) {
    for (let cz = c0z; cz <= c1z; cz++) {
      const a = S.grid.get(cx + ',' + cz);
      if (!a) continue;
      for (let n = 0; n < a.length; n++) {
        const i = a[n];
        const y = Math.min(ay, by);
        if (y < S.sy[i] - 2.5 || y > S.sy[i] + S.sh[i] * 0.95) continue;
        const d = segDist2(i, ax, az, bx, bz);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
  }
  return best;
}

// ===========================================================================
// props — tiny procedural creatures and signs, added by THIS module
// ===========================================================================

const KIT = {};
function geo(THREE, key, make) {
  if (!KIT[key]) KIT[key] = make();
  return KIT[key];
}
function mat(THREE, key, color, opts) {
  const k = 'm' + key;
  if (!KIT[k]) KIT[k] = new THREE.MeshLambertMaterial({ color, ...(opts || {}) });
  return KIT[k];
}

function mkMarmot(THREE) {
  const g = new THREE.Group();
  const fur = mat(THREE, 'fur', 0x8a6a44);
  const body = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), fur);
  body.scale.set(0.24, 0.30, 0.24); body.position.y = 0.30;
  const head = new THREE.Mesh(KIT.sph8, fur);
  head.scale.set(0.15, 0.15, 0.16); head.position.set(0, 0.62, 0.04);
  const nose = new THREE.Mesh(geo(THREE, 'cone5', () => new THREE.ConeGeometry(1, 1, 5)), mat(THREE, 'dark', 0x2b2119));
  nose.scale.set(0.06, 0.12, 0.06); nose.rotation.x = Math.PI / 2; nose.position.set(0, 0.60, 0.19);
  g.add(body, head, nose);
  return g;
}

function mkDuck(THREE, color) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), mat(THREE, 'duck' + color, color));
  b.scale.set(0.26, 0.17, 0.36);
  const h = new THREE.Mesh(KIT.sph8, mat(THREE, 'duckh', 0x1e5b3a));
  h.scale.set(0.12, 0.13, 0.12); h.position.set(0, 0.26, -0.24);
  const beak = new THREE.Mesh(geo(THREE, 'cone5', () => new THREE.ConeGeometry(1, 1, 5)), mat(THREE, 'beak', 0xe8a021));
  beak.scale.set(0.05, 0.13, 0.05); beak.rotation.x = -Math.PI / 2; beak.position.set(0, 0.25, -0.38);
  g.add(b, h, beak);
  return g;
}

function mkSwan(THREE) {
  const g = new THREE.Group();
  const w = mat(THREE, 'swan', 0xf2f0ea);
  const b = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), w);
  b.scale.set(0.42, 0.30, 0.62);
  const neck = new THREE.Mesh(geo(THREE, 'cyl6', () => new THREE.CylinderGeometry(1, 1, 1, 6)), w);
  neck.scale.set(0.07, 0.72, 0.07); neck.position.set(0, 0.50, -0.38); neck.rotation.x = 0.18;
  const h = new THREE.Mesh(KIT.sph8, w);
  h.scale.set(0.11, 0.11, 0.15); h.position.set(0, 0.88, -0.46);
  const beak = new THREE.Mesh(geo(THREE, 'cone5', () => new THREE.ConeGeometry(1, 1, 5)), mat(THREE, 'sbeak', 0xd8541e));
  beak.scale.set(0.05, 0.14, 0.05); beak.rotation.x = -Math.PI / 2; beak.position.set(0, 0.87, -0.60);
  g.add(b, neck, h, beak);
  return g;
}

function mkGull(THREE) {
  const g = new THREE.Group();
  const w = mat(THREE, 'gull', 0xeef1f4);
  const b = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), w);
  b.scale.set(0.16, 0.15, 0.30);
  const h = new THREE.Mesh(KIT.sph8, w);
  h.scale.set(0.10, 0.10, 0.11); h.position.set(0, 0.20, -0.22);
  const beak = new THREE.Mesh(geo(THREE, 'cone5', () => new THREE.ConeGeometry(1, 1, 5)), mat(THREE, 'beak', 0xe8a021));
  beak.scale.set(0.04, 0.11, 0.04); beak.rotation.x = -Math.PI / 2; beak.position.set(0, 0.19, -0.33);
  g.add(b, h, beak);
  return g;
}

function mkPerson(THREE, coat) {
  const g = new THREE.Group();
  const box = geo(THREE, 'box', () => new THREE.BoxGeometry(1, 1, 1));
  const legs = new THREE.Mesh(box, mat(THREE, 'trous', 0x3b4250));
  legs.scale.set(0.34, 0.85, 0.26); legs.position.y = 0.43;
  const torso = new THREE.Mesh(box, mat(THREE, 'coat' + coat, coat));
  torso.scale.set(0.46, 0.68, 0.30); torso.position.y = 1.18;
  const head = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), mat(THREE, 'skin', 0xc99a72));
  head.scale.setScalar(0.13); head.position.y = 1.63;
  g.add(legs, torso, head);
  return g;
}

function mkKayak(THREE) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(geo(THREE, 'cyl6', () => new THREE.CylinderGeometry(1, 1, 1, 6)), mat(THREE, 'kayak', 0xe2c23a));
  hull.scale.set(0.34, 3.9, 0.30); hull.rotation.x = Math.PI / 2; hull.position.y = 0.12;
  const torso = new THREE.Mesh(geo(THREE, 'box', () => new THREE.BoxGeometry(1, 1, 1)), mat(THREE, 'vest', 0xd8452a));
  torso.scale.set(0.40, 0.55, 0.28); torso.position.y = 0.50;
  const head = new THREE.Mesh(geo(THREE, 'sph8', () => new THREE.SphereGeometry(1, 8, 6)), mat(THREE, 'skin', 0xc99a72));
  head.scale.setScalar(0.13); head.position.y = 0.88;
  const paddle = new THREE.Mesh(KIT.box, mat(THREE, 'padd', 0x2b2b2b));
  paddle.scale.set(2.3, 0.05, 0.05); paddle.position.y = 0.66; paddle.rotation.z = 0.35;
  g.add(hull, torso, head, paddle);
  return g;
}

// a small trail-sign: post + panel. `accent` tints the panel.
function mkSign(THREE, accent, h) {
  const g = new THREE.Group();
  const box = geo(THREE, 'box', () => new THREE.BoxGeometry(1, 1, 1));
  const post = new THREE.Mesh(box, mat(THREE, 'post', 0x4a4038));
  const H = h || 2.2;
  post.scale.set(0.10, H, 0.10); post.position.y = H / 2;
  const panel = new THREE.Mesh(box, mat(THREE, 'panel' + accent, accent));
  panel.scale.set(1.5, 0.78, 0.07); panel.position.y = H + 0.20;
  const rim = new THREE.Mesh(box, mat(THREE, 'rim', 0x171614));
  rim.scale.set(1.62, 0.90, 0.04); rim.position.y = H + 0.20; rim.position.z = -0.04;
  g.add(post, rim, panel);
  return g;
}

// ===========================================================================
// the surprise registry — world coordinates, PLAYER frame (Y-up, metres).
// Z-up worlds are tipped into Y-up by main.js before anything here runs, so
// these are ENU (x, y_enu, z_enu) read back as (x, z_enu, -y_enu).
// ===========================================================================

const kmh = (v) => Math.round(v * 3.6);

const REG = {
  // ------------------------------------------------------- EAGLE'S NEST / KT-22
  'eagles-nest-kt22': [
    {
      id: 'marmot-spires',
      at: [-60.7, 568.0, 370.5], r: 20, dy: 45,
      tag: 'EAGLE’S NEST',
      text: () => pick([
        'A marmot whistles at you from the spires. It is not a compliment.',
        'MARMOT: *whistle* — loosely translated: "that line was fine, I guess."',
        'The summit marmot has seen every skier since 1971 and remains unimpressed.',
      ]),
      prop: (T) => mkMarmot(T), lift: 0.9,
      anim: (o, t) => { o.position.y = o.userData.y0 + Math.min(0.55, t * 2.4) + Math.sin(t * 9) * 0.03; },
    },
    {
      id: 'cornice-not-open',
      at: [-36, 500, 341], r: 34, dy: 40,
      tag: 'GS CORNICE',
      text: () => pick([
        'The cornice would like it noted that it is not technically open.',
        'CORNICE: "Open" is a strong word. I prefer "unroped".',
        'Not technically open. Not technically closed. Technically a cornice.',
      ]),
      prop: (T) => mkSign(T, 0xf0641e, 1.9), lift: 0.0, yaw: 2.2,
    },
    {
      id: 'patrol-radar',
      at: [-134, 532, 314], r: 24, dy: 35,
      tag: 'PATROL RADAR',
      text: (c) => (c.speedKmh > 45
        ? 'PATROL RADAR: ' + c.speedKmh + ' km/h. Slow down. We know where the shack is, and so do you.'
        : 'PATROL RADAR: ' + c.speedKmh + ' km/h. Cheer up, it is a bowl, not a car park.'),
      prop: (T) => mkSign(T, 0xffd166, 2.4), lift: 0.0, yaw: 1.0,
    },
    {
      id: 'olympic-lady',
      at: [170.8, 515, 407.2], r: 24, dy: 40,
      tag: 'OLYMPIC LADY',
      text: () => pick([
        'OLYMPIC LADY, unload: the chair has carried better skiers. It has also carried worse.',
        'The lift op does not look up. The lift op has never looked up.',
        'OLYMPIC LADY: named for an Olympian. Currently carrying you.',
      ]),
      prop: (T) => mkPerson(T, 0x1f4e79), lift: 0.0,
    },
    {
      id: 'fingers-danger',
      at: [43.2, 309.3, -256.7], r: 26, dy: 40,
      tag: 'THE FINGERS',
      text: () => pick([
        'DANGER: CLIFF AREA. The sign is doing its best. The Fingers are not.',
        'The Fingers count to five and then stop counting entirely.',
        'That sign has been read by thousands and heeded by dozens.',
      ]),
      prop: (T) => mkSign(T, 0xd8452a, 2.0), lift: 0.0, yaw: 0.6,
    },
  ],

  // ------------------------------------------------------------ RED DOG / PALISADES
  'red-dog-palisades': [
    {
      id: 'race-arena',
      at: [-309.5, 13.0, -384.7], r: 26, dy: 30,
      need: { speed: 20 },
      tag: 'FINISH ARENA',
      text: (c) => 'THE CROWD GOES ABSOLUTELY BERSERK. ' + c.speedKmh + ' km/h through the arch — somebody get this person a bib.',
      prop: (T) => mkPerson(T, 0xd8452a), lift: 0.0,
      anim: (o, t) => { o.position.y = o.userData.y0 + Math.abs(Math.sin(t * 7)) * 0.35; },
    },
    {
      id: 'slow-sign',
      at: [348.3, 404, 416.7], r: 20, dy: 28,
      need: { speed: 13 },
      tag: 'SLOW',
      text: () => pick([
        'The SLOW sign sighs audibly as you pass.',
        'SLOW. (The sign has stopped believing in itself.)',
        'The SLOW sign has been here nineteen seasons and has changed exactly nobody.',
      ]),
      prop: (T) => mkSign(T, 0xffd166, 1.7), lift: 0.0, yaw: 0.9,
    },
    {
      id: 'far-east-chair',
      at: [39.5, 0.9, -461.4], r: 26, dy: 25,
      tag: 'FAR EAST EXPRESS',
      text: () => pick([
        'FAR EAST EXPRESS: "...and where exactly do you think you are going?"',
        'The chair swings past empty and somehow judgmentally.',
        'FAR EAST EXPRESS. It is not far, and it is not east. Two out of three.',
      ]),
      prop: (T) => mkPerson(T, 0x2f7d55), lift: 0.0,
    },
    {
      id: 'face-bumps',
      at: [-190, 124, -74], r: 34, dy: 40,
      tag: 'RED DOG FACE',
      text: () => pick([
        'Your knees have filed a formal complaint about these bumps.',
        'Every mogul on this face was built by someone braking. Probably you.',
        'The Face: 600 metres of moguls and one very optimistic fall line.',
      ]),
    },
    {
      id: 'secret-garden',
      at: [-123.7, 150, -36.2], r: 22, dy: 35,
      tag: 'SECRET GARDEN',
      text: () => pick([
        'SECRET GARDEN. You have now told everyone. Nice work.',
        'It stopped being secret in 1994. The sign is the giveaway.',
        'A garden gnome watches you enter the secret garden and says nothing. Gnomes never do.',
      ]),
      prop: (T) => mkPerson(T, 0xc23a3a), lift: 0.0, scale: 0.45,
    },
  ],

  // -------------------------------------------------------------------- SAND HARBOR
  'sand-harbor': [
    {
      id: 'duck-flotilla',
      at: [34, 0.15, -6], r: 14, dy: 14,
      tag: 'FLOTILLA',
      text: () => pick([
        'The duck flotilla scatters in six directions, none of them dignified.',
        'You have dispersed a formation of ducks. They will regroup. They always regroup.',
        'Ducks: gone. Reputation among ducks: also gone.',
      ]),
      prop: (T) => {
        const g = new T.Group();
        const cols = [0x6b7b52, 0x7d6a4e, 0x5d6b7a, 0x8a7a56, 0x6b7b52];
        for (let i = 0; i < 5; i++) {
          const d = mkDuck(T, cols[i]);
          const a = i * 1.27;
          d.position.set(Math.cos(a) * (1.4 + i * 0.7), 0, Math.sin(a) * (1.4 + i * 0.7));
          d.rotation.y = a;
          d.userData.dir = [Math.cos(a), Math.sin(a)];
          g.add(d);
        }
        return g;
      },
      lift: 0.02,
      anim: (o, t) => {
        for (const d of o.children) {
          const k = Math.min(1, t * 0.75);
          d.position.x += d.userData.dir[0] * 0.06 * (1 - k);
          d.position.z += d.userData.dir[1] * 0.06 * (1 - k);
          d.position.y = Math.sin(t * 6 + d.position.x) * 0.04;
        }
      },
    },
    {
      id: 'divers-rock-score',
      at: [48.5, 3.2, -205], r: 26, dy: 30,
      need: { air: 0.45 },
      tag: 'DIVER’S ROCK',
      text: (c) => {
        const n = clamp(Math.round(3 + c.air * 4 + c.impact * 0.22), 1, 10);
        return 'THE ROCK RATES THAT SPLASH: ' + n + '/10. ' + (n >= 8
          ? 'The Russian judge is weeping.'
          : n >= 5 ? 'Points off for the arms.' : 'Points off for everything.');
      },
      prop: (T) => mkSign(T, 0xffd166, 1.4), lift: 0.0, yaw: 2.6,
    },
    {
      id: 'kayaker',
      at: [-62, 0.1, -30], r: 22, dy: 18,
      tag: 'KAYAKER',
      text: () => pick([
        'A kayaker drifts past: "NICE LINE!" You are on foot. He does not care.',
        'KAYAKER: "nice line!" — he says that to everyone. It still works.',
        'The kayaker gives you a paddle-salute and keeps drifting toward Nevada.',
      ]),
      prop: (T) => mkKayak(T), lift: 0.0, yaw: 1.2,
      anim: (o, t) => { o.position.x += 0.03; o.rotation.z = Math.sin(t * 2.2) * 0.06; },
    },
    {
      id: 'amphitheater',
      at: [45.3, 2.9, -22.5], r: 18, dy: 20,
      tag: 'TREPP AMPHITHEATER',
      text: () => pick([
        'You step into the amphitheatre. Nine rows of granite say nothing, loudly.',
        'THE AMPHITHEATRE AWAITS YOUR MONOLOGUE. The lake is a tough room.',
        'Perfect acoustics. Zero audience. Classic Tuesday.',
      ]),
    },
    {
      id: 'pier-gull',
      at: [197.6, 0.2, -312.3], r: 24, dy: 20,
      tag: 'BOAT LAUNCH',
      text: () => pick([
        'A gull holds the end of the pier and will not be negotiating.',
        'The gull has held this post for four summers. You are a tourist.',
        'GULL: this is a toll pier. The toll is your sandwich.',
      ]),
      prop: (T) => mkGull(T), lift: 0.0,
      anim: (o, t) => { o.rotation.y = Math.sin(t * 3) * 0.9; },
    },
  ],

  // ------------------------------------------------- EASTNOR FLOATING BIKE COURSE
  'eastnor-floating-bike-course': [
    {
      id: 'cheese-creak',
      at: [88, 1.7, -8], r: 9, dy: 12,
      arm: 3,
      tag: 'THE CHEESE',
      text: () => pick([
        'Third crossing. The cheese wheel creaks in a way cheese should not.',
        'The cheese has now been ridden three times and is making noises about it.',
        'CREEEEAK. That is the sound of a 4-metre wheel reconsidering its career.',
      ]),
    },
    {
      id: 'castle-groundskeeper',
      at: [-248, 11.0, -58], r: 55, dy: 45,
      tag: 'EASTNOR CASTLE',
      text: () => pick([
        'The groundskeeper would like a word about the tyre marks on the lawn.',
        'GROUNDSKEEPER: "That lawn is from 1812. Your tyres are from Taiwan."',
        'Eight hundred years of deer park, and you have left a skid in it.',
      ]),
      prop: (T) => mkPerson(T, 0x4a5b32), lift: 0.0,
    },
    {
      id: 'swan-judge',
      at: [50, 0.05, -15], r: 16, dy: 12,
      tag: 'THE LAKE',
      text: () => pick([
        'The swan is judging you.',
        'The swan has not blinked. The swan will not blink.',
        'A swan glides past at exactly your speed, doing none of the work.',
      ]),
      prop: (T) => mkSwan(T), lift: 0.0, yaw: 1.9,
      anim: (o, t) => { o.rotation.y = 1.9 + Math.sin(t * 0.9) * 0.35; o.position.y = o.userData.y0 + Math.sin(t * 2) * 0.02; },
    },
    {
      id: 'teeter-ducks',
      at: [112, 0.5, -8.8], r: 11, dy: 10,
      tag: 'THE TEETER',
      text: () => pick([
        'Three ducks abandon the teeter deck at once. Nobody looks good doing this.',
        'The teeter ducks scatter. They have been here longer than the course.',
        'You have displaced the resident ducks. They will remember this.',
      ]),
      prop: (T) => {
        const g = new T.Group();
        for (let i = 0; i < 3; i++) {
          const d = mkDuck(T, [0x6b7b52, 0x7d6a4e, 0x8a7a56][i]);
          d.position.set(i * 0.8 - 0.8, 0, 0);
          d.rotation.y = 1.6 + i * 0.3;
          d.userData.dir = [0.2 + i * 0.3, 0.9 - i * 0.4];
          g.add(d);
        }
        return g;
      },
      lift: 0.0,
      anim: (o, t) => {
        for (const d of o.children) {
          const k = Math.min(1, t * 0.9);
          d.position.x += d.userData.dir[0] * 0.05 * (1 - k);
          d.position.z += d.userData.dir[1] * 0.05 * (1 - k);
          d.position.y = 0.25 * Math.sin(Math.min(Math.PI, t * 3));
        }
      },
    },
    {
      id: 'finish-line',
      at: [-92.7, 0.4, -43.3], r: 18, dy: 14,
      tag: 'FINISH',
      text: (c) => 'FINISH. ' + fmtTime(c.runT) + ' from the arch, and the plank is still floating. Both of those are results.',
      prop: (T) => mkSign(T, 0xf0641e, 2.6), lift: 0.0, yaw: 2.2,
    },
  ],

  // -------------------------------------------------------- RED BULL JOYRIDE (WHISTLER)
  'redbull-joyride-whistler': [
    {
      id: 'boner-log',
      at: [6.0, 66.5, 238.4], r: 20, dy: 22,
      tag: 'FEATURE 3',
      text: () => pick([
        'Feature name: "boner log". We did not name it. We only built it.',
        'THE BONER LOG. Crankworx commentary has been dealing with this since 2011.',
        'You are approaching the boner log. Please conduct yourself accordingly.',
      ]),
      prop: (T) => mkSign(T, 0xffd166, 1.8), lift: 0.0,
    },
    {
      id: 'lip-14ft',
      at: [-16.1, 53.7, 115.6], r: 28, dy: 30,
      need: { air: 0.5 },
      tag: 'COMMENTARY',
      text: (c) => 'OH HE IS DEEP! ' + c.air.toFixed(1) + ' seconds off the 14-footer and the crowd is on its feet.',
    },
    {
      id: 'whale-tail',
      at: [-12.6, 26.6, 10.5], r: 30, dy: 34,
      need: { air: 0.55 },
      tag: 'COMMENTARY',
      text: (c) => 'HUGE off the whale-tail! ' + c.air.toFixed(1) + ' s of hangtime and a step-down still to come — that is a scorecard moment.',
    },
    {
      id: 'crowd-oooh',
      at: [-12.9, 1.3, -141.5], r: 30, dy: 26,
      need: { impact: 9 },
      tag: 'THE CROWD',
      text: () => pick([
        'OOOOOOH. Twelve thousand people just made the same noise. You cased it.',
        'The whole venue goes "OOOOOH" in one voice. That is the sound of a flat landing.',
        'OOOOOH — that landing was heard in the village.',
      ]),
    },
    {
      id: 'finish-corral',
      at: [-13.5, -2.8, -197.5], r: 22, dy: 22,
      tag: 'FINISH CORRAL',
      text: (c) => 'THE LEGENDARY FINISH CORRAL. Run time ' + fmtTime(c.runT) + '. The judges have scored you: "present".',
      prop: (T) => mkSign(T, 0xf0641e, 2.8), lift: 0.0,
    },
  ],
};

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return m + ':' + (r < 10 ? '0' : '') + r;
}

// ===========================================================================
// registry wiring
// ===========================================================================

function poiKey(ctx) {
  const p = (ctx.poi || '').trim();
  if (REG[p]) return p;
  const r = (ctx.run || '').trim();
  for (const k of Object.keys(REG)) if (r.indexOf(k) === 0) return k;
  return '';
}

function buildRegistry(THREE, scene, key) {
  const rows = REG[key] || [];
  for (const row of rows) {
    const e = {
      def: row, id: row.id, at: row.at, r: row.r, dy: row.dy === undefined ? 40 : row.dy,
      fired: false, inside: false, enters: 0, obj: null, ft: -1,
    };
    if (row.prop) {
      try {
        const o = row.prop(THREE);
        // props sit on the ground when the world can tell us where that is;
        // otherwise the registry's y is already the surface.
        o.position.set(row.at[0], row.at[1] + (row.lift || 0), row.at[2]);
        if (row.yaw !== undefined) o.rotation.y = row.yaw;
        if (row.scale) o.scale.setScalar(row.scale);
        o.userData.y0 = o.position.y;
        o.name = 'psur:' + row.id;
        o.frustumCulled = true;
        scene.add(o);
        e.obj = o;
      } catch { S.errors++; }
    }
    S.regs.push(e);
  }
}

// ===========================================================================
// per-frame
// ===========================================================================

// Props are authored at the coordinate the registry names, then settled onto
// the real floor on the first frame that can tell us where it is. A reading
// more than 12 m off is a roof, a deck or the lake bed — leave those alone.
function settleProps() {
  if (S.settled) return;
  const at = (S.collision && S.collision.groundAt && S.collision.bounds)
    ? (x, z) => S.collision.groundAt(x, z, S.collision.bounds.maxY + 5)
    : (window.__player && window.__player.groundAt) || null;
  if (!at) return;
  S.settled = true;
  for (const e of S.regs) {
    if (!e.obj || e.def.snap === false) continue;
    try {
      const g = at(e.at[0], e.at[2]);
      if (g === null || g === undefined || Math.abs(g - e.at[1]) > 12) continue;
      e.obj.position.y = g + (e.def.lift || 0);
      e.obj.userData.y0 = e.obj.position.y;
    } catch { S.errors++; }
  }
}

function ctxFor(extra) {
  const c = S.ctrl;
  const sp = c ? c.speed() / S.u : 0;
  return {
    speed: sp, speedKmh: kmh(sp), mode: c ? c.mode : 'boots',
    air: S.airT, impact: 0, runT: S.runT, streak: S.streak,
    ...(extra || {}),
  };
}

function fire(e, extra) {
  e.fired = true; e.ft = 0;
  S.fired++;
  const c = ctxFor(extra);
  let text = '';
  try { text = typeof e.def.text === 'function' ? e.def.text(c) : e.def.text; } catch { S.errors++; }
  toast(text, e.def.tag || 'SURPRISE', false);
  try { if (window.__playAudio && window.__playAudio.trick) window.__playAudio.trick(); } catch { S.errors++; }
}

function checkSurprises(dt, land) {
  const c = S.ctrl;
  if (!c) return;
  const p = c.position;
  for (const e of S.regs) {
    if (e.fired) continue;
    const dx = p.x - e.at[0], dz = p.z - e.at[2];
    const near = (dx * dx + dz * dz) <= e.r * e.r && Math.abs(p.y - e.at[1]) <= e.dy;
    if (!near) {
      // hysteresis: leave properly before the next entry counts
      if (e.inside && (dx * dx + dz * dz) > (e.r * 1.6) * (e.r * 1.6)) e.inside = false;
      continue;
    }
    if (!e.inside) { e.inside = true; e.enters++; }
    const need = e.def.need || {};
    if (e.def.arm && e.enters < e.def.arm) continue;
    if (need.speed !== undefined && c.speed() / S.u < need.speed) continue;
    if (need.air !== undefined) {
      // the airtime that counts is the air you just finished, judged on landing
      if (!(land.landed && land.air >= need.air)) continue;
      fire(e, { air: land.air, impact: land.impact });
      continue;
    }
    if (need.impact !== undefined) {
      if (!(land.landed && land.impact >= need.impact)) continue;
      fire(e, { air: land.air, impact: land.impact });
      continue;
    }
    fire(e, {});
  }
  // prop animations run for 6 s after their trigger
  for (const e of S.regs) {
    if (e.ft < 0 || !e.obj || !e.def.anim) continue;
    e.ft += dt;
    if (e.ft > 6) { e.ft = -1; continue; }
    try { e.def.anim(e.obj, e.ft, dt); } catch { e.ft = -1; S.errors++; }
  }
}

function checkTrees(dt) {
  const c = S.ctrl;
  if (!c || !S.grid || S.nStem === 0) return;
  const p = c.position;
  const speed = c.speed() / S.u;

  if (!S.havePrev) { S.px = p.x; S.py = p.y; S.pz = p.z; S.havePrev = true; return; }
  const step = Math.hypot(p.x - S.px, p.z - S.pz);

  // teleports (respawn, chairlift, tests) must never read as a run through a forest
  if (step > JUMP_GUARD) { S.px = p.x; S.py = p.y; S.pz = p.z; S.prevSpeed = speed; return; }

  const wipe = c.wipeT || 0;
  const decel = dt > 1e-4 ? (S.prevSpeed - speed) / dt : 0;
  const crashed = (wipe > 0 && S.prevWipe <= 0) || (S.prevSpeed > 5 && decel > 45);

  if (S.quipCd > 0) S.quipCd -= dt;

  const D = S.dbg;                    // reused, not reallocated, every frame
  D.speed = speed; D.step = step; D.decel = decel; D.crashed = crashed;
  D.cd = S.quipCd; D.dt = dt; D.r = 0; D.hit = -1;

  if (S.quipCd <= 0 && (speed > 5.5 || crashed)) {
    // trunks are ~0.8 m; a body at speed sweeps a wider corridor, and a crash
    // gets the generous 2.5 m radius the brief asks for
    const r = crashed ? 2.5 : 1.15 + Math.min(1.15, speed * 0.028);
    const i = hitStem(S.px, S.py, S.pz, p.x, p.y, p.z, r * S.u);
    D.r = r; D.hit = i;
    if (i >= 0) {
      S.treeHits++; S.streak++;
      S.quipCd = QUIP_CD;
      const line = quipFor(c.mode, S.streak);
      const rare = QUIPS_RARE.indexOf(line) >= 0;
      toast(line, S.streak > 1 ? 'TREE × ' + S.streak : 'TREE', rare);
    }
  }

  S.px = p.x; S.py = p.y; S.pz = p.z;
  S.prevSpeed = speed;
  S.prevWipe = wipe;
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
    if (!S.THREE || !S.scene) return;
    S.u = (S.ctrl && S.ctrl.T && S.ctrl.T.eyeHeight) ? S.ctrl.T.eyeHeight / 1.70 : 1;
    mountDom();
    harvest(S.THREE, S.scene);
    const key = poiKey(ctx);
    S.key = key;
    if (key) buildRegistry(S.THREE, S.scene, key);
    if (S.ctrl) { S.prevGrounded = S.ctrl.grounded; }
    S.ok = true;
  } catch { S.errors++; }
}

export function update(dt) {
  if (!S.ok) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    const paused = S.hud && S.hud.isPaused && S.hud.isPaused();
    tickToasts(dt);
    if (paused) return;
    S.t += dt; S.runT += dt;
    settleProps();

    const c = S.ctrl;
    if (!c) return;

    // ---- airtime + landing edge (the controller only counts air on ride gears)
    const land = { landed: false, air: 0, impact: 0 };
    if (!c.grounded) S.airT += dt;
    if (c.grounded && !S.prevGrounded) {
      land.landed = true;
      land.air = S.airT;
      land.impact = Math.max(0, -S.prevVy) / S.u;
      S.airT = 0;
    }
    if (c.grounded) S.airT = 0;
    S.prevGrounded = c.grounded;
    S.prevVy = c.velocity ? c.velocity.y : 0;

    checkTrees(dt);
    checkSurprises(dt, land);
  } catch { S.errors++; }
}

export function stats() {
  return {
    ok: S.ok, poi: S.key || '', errors: S.errors,
    stems: S.nStem, sources: S.sources.slice(),
    surprises: S.regs.length, fired: S.fired,
    treeHits: S.treeHits, streak: S.streak, unit: S.u,
  };
}

// ---------------------------------------------------------------- test hooks
const _test = {
  stats,
  // what the registry holds and what has gone off
  list: () => S.regs.map((e) => ({
    id: e.id, at: e.at.slice(), r: e.r, dy: e.dy,
    need: e.def.need || null, arm: e.def.arm || 0,
    fired: e.fired, enters: e.enters, prop: !!e.obj,
  })),
  fired: (id) => { const e = S.regs.find((q) => q.id === id); return !!(e && e.fired); },
  entry: (id) => S.regs.find((q) => q.id === id) || null,
  reset: () => {
    for (const e of S.regs) { e.fired = false; e.inside = false; e.enters = 0; e.ft = -1; }
    S.fired = 0; S.streak = 0; S.treeHits = 0; S.quipCd = 0; S.recent.length = 0;
    S.havePrev = false;
    for (const r of S.live.slice()) killToast(r);
  },
  // toast surface
  toasts: () => S.live.map((r) => r.el.textContent),
  lastQuip: () => S.lastQuip,
  domCount: () => (S.root ? S.root.children.length : -1),
  // tree hash
  stems: () => S.nStem,
  nearestTree: (x, z, maxR) => {
    let best = -1, bd = (maxR || 400) * (maxR || 400);
    for (let i = 0; i < S.nStem; i++) {
      const dx = S.sx[i] - x, dz = S.sz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { x: S.sx[best], y: S.sy[best], z: S.sz[best], h: S.sh[best], d: Math.sqrt(bd) };
  },
  treeHits: () => S.treeHits,
  debug: () => ({ ...(S.dbg || {}), prev: [S.px, S.py, S.pz], have: S.havePrev }),
  // distance from a world point to the nearest stem, height gate included
  probe: (x, y, z, r) => {
    const i = hitStem(x, y, z, x, y, z, r || 3);
    return i < 0 ? null : { i, x: S.sx[i], y: S.sy[i], z: S.sz[i], h: S.sh[i] };
  },
  // the detector's own segment test against the real harvested stems
  sweep: (ax, ay, az, bx, by, bz, r) => {
    const i = hitStem(ax, ay, az, bx, by, bz, r === undefined ? 1.4 : r);
    return i < 0 ? null : { i, x: S.sx[i], y: S.sy[i], z: S.sz[i], h: S.sh[i] };
  },
  stemAt: (i) => (i >= 0 && i < S.nStem ? { x: S.sx[i], y: S.sy[i], z: S.sz[i], h: S.sh[i] } : null),
  // pick a stem that sits on open ground: base y within `tol` of what the
  // collision floor reports, and at least `minD` from the given point
  pickStem: (x, z, minD, maxD, groundAt, tol, approach) => {
    const T2 = tol || 2.5, A = approach || 18;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, -0.707], [0.707, -0.707], [-0.707, 0.707]];
    for (let i = 0; i < S.nStem; i++) {
      const d = Math.hypot(S.sx[i] - x, S.sz[i] - z);
      if (d < minD || d > maxD) continue;
      const g = groundAt(S.sx[i], S.sz[i]);
      if (g === null || Math.abs(g - S.sy[i]) > T2) continue;
      // the run-in must be walkable ground at roughly the trunk's own level
      for (const [ux, uz] of dirs) {
        const ax = S.sx[i] - ux * A, az = S.sz[i] - uz * A;
        const ga = groundAt(ax, az);
        if (ga === null || Math.abs(ga - S.sy[i]) > T2) continue;
        const gm = groundAt(S.sx[i] - ux * A * 0.5, S.sz[i] - uz * A * 0.5);
        if (gm === null || Math.abs(gm - S.sy[i]) > T2) continue;
        return { i, x: S.sx[i], y: S.sy[i], z: S.sz[i], h: S.sh[i], ground: g, d, ux, uz, start: [ax, ga, az] };
      }
    }
    return null;
  },
  // pool inspection (Greg reads these)
  pool: () => ({ generic: QUIPS_GENERIC, gear: QUIPS_GEAR, rare: QUIPS_RARE, streak: QUIPS_STREAK }),
  poolSize: () => QUIPS_GENERIC.length + QUIPS_RARE.length + QUIPS_STREAK.length +
    Object.values(QUIPS_GEAR).reduce((a, b) => a + b.length, 0),
  // drive one hit / one surprise directly (DOM + no-repeat checks)
  forceTree: () => {
    S.streak++; S.treeHits++;
    const line = quipFor(S.ctrl ? S.ctrl.mode : 'boots', S.streak);
    toast(line, 'TREE', QUIPS_RARE.indexOf(line) >= 0);
    return line;
  },
  forceFire: (id) => { const e = S.regs.find((q) => q.id === id); if (e && !e.fired) fire(e, { air: 1, impact: 12 }); return !!e; },
  destroy: () => {
    for (const r of S.live.slice()) killToast(r);
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    const st = document.getElementById('psur-style');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    for (const e of S.regs) if (e.obj && e.obj.parent) e.obj.parent.remove(e.obj);
    S.regs.length = 0; S.root = null; S.ok = false;
  },
};

window.__playSurprise = { init, update, stats, _test };
export default init;
