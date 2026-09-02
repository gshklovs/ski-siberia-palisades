// "Enter the world" — first person player for a run's scene/.
// Boot (play.html, classic script) has already set <base> + the importmap.

import { loadWorld } from './loader.js';
import { buildCollision, collidableBox } from './collision.js';
import { createController, TUNING } from './controller.js';
import {
  skiTuningFor, resolveSkiId, rememberSkiId,
  makeSkiRig, styleSkiRig, getSkiModel, skiState, rollSkiRigs, SKI_MODELS,
  takeSkiLaunch, skiPopPreview,
} from './ski.js';
import * as tricks from './tricks.js';
import { createInventory } from './inventory.js';
import {
  bikeTuningFor, resolveBikeId, rememberBikeId, bikeRider,
  makeBikeRig, styleBikeRig, getBikeModel, BIKE_MODELS,
} from './bike.js';
import {
  scaleGliderTuning, gliderState,
  GLIDER_MODELS, getGliderModel, resolveGliderId, rememberGliderId,
} from './glider.js';
import { scaleRocketTuning, rocketState, makeRocketPack, makeRocketFP } from './rocket.js';
import {
  sledTuningFor, resolveSledId, rememberSledId, sledState,
  makeSledRig, makeSledFP, styleSledRig, rollSledRig, getSledModel, SLED_MODELS,
} from './sled.js';
import {
  snowmobileTuningFor, resolveSnowmobileId, rememberSnowmobileId, snowmobileState,
  makeSnowmobileRig, makeSnowmobileFP, styleSnowmobileRig, poseSnowmobileRig,
  getSnowmobileModel, SNOWMOBILE_MODELS,
} from './snowmobile.js';
import {
  pickSpawn, waypointIndex,
  namedSpawn as namedSpawnFor, ALIASES as SPAWN_ALIASES,
} from './spawn.js';
import { createHud } from './hud.js';
import { createLifts } from './lift.js';
import { createBoost } from './boost.js';
import { createDev } from './dev.js';
import { tracks } from './tracks.js';
import './fx.js';
import './surprise.js';
import './snowball.js';
import './markers.js';
import './audio.js';
import { BIKE_GEAR, FULL_GEAR_MENU, DEBUG_HUD, LABEL, pickBrand } from './flags.js';

const cfg = window.__PLAY;
const say = cfg.say || (() => {});
const consoleErrors = [];
addEventListener('error', (e) => consoleErrors.push(String(e.message || e)));

const THREE = await import('three');

// ---------------------------------------------------------------- the world
let world;
try {
  world = await loadWorld(THREE, cfg, say);
} catch (e) {
  console.error(e);
  window.__playFailed = true;      // stop the boot from overwriting the reason
  window.__playFail('scene could not be adapted', String(e && e.message || e));
  throw e;
}

// ------------------------------------------------------------------ up axis
// Everything below is Y-up. A scene authored Z-up (the ENU frame layout.json
// uses) gets tipped once, here, into a wrapper group — its lights, spawn and
// colliders all come along, and the rest of the player never has to care.
say('checking frame…');
let upAxis = world.upAxis || 'y';
let upFrom = world.declaredUp ? 'declared' : 'default';
if (!world.declaredUp) {
  const c = world.camera;
  if (world.adapter === 'page') {
    // the page brought a working camera rig; its up vector IS the frame
    if (c && c.up && Math.abs(c.up.z) > 0.9) { upAxis = 'z'; upFrom = 'camera.up'; }
  } else if (guessUp(THREE, world.scene) === 'z') {
    upAxis = 'z'; upFrom = 'bbox flatness';
  }
}
if (upAxis === 'z') {
  const wrap = new THREE.Group();
  wrap.name = 'play:zup';
  wrap.rotation.x = -Math.PI / 2;          // (x, y, z)_ENU -> (x, z, -y)_three
  while (world.scene.children.length) wrap.add(world.scene.children[0]);
  world.scene.add(wrap);
  world.scene.up.set(0, 1, 0);
  if (world.camera) world.camera.up.set(0, 1, 0);
  const conv = (a) => a && [a[0], a[2], -a[1]];
  if (world.spawnHint) {
    world.spawnHint = {
      position: conv(toArr(world.spawnHint.position)),
      lookAt: conv(toArr(world.spawnHint.lookAt)),
      eyeHeight: world.spawnHint.eyeHeight,
    };
  }
  if (Array.isArray(world.lifts)) {
    world.lifts = world.lifts.map((l) => (l && l.base && l.top
      ? { ...l, base: conv(toArr(l.base)), top: conv(toArr(l.top)) }
      : l));
  }
  // ...and the run polylines the same way. Into FRESH arrays: `world.runs[].pts`
  // is the scene's own array by reference, and the scene is read-only here.
  if (Array.isArray(world.runs)) {
    world.runs = world.runs.map((r) => (r && Array.isArray(r.pts)
      ? { ...r, pts: r.pts.map((p) => conv(toArr(p))) }
      : r));
  }
}
function toArr(v) { return !v ? null : (v.isVector3 ? [v.x, v.y, v.z] : v); }

// smallest extent wins, but only when it is decisively flatter than the other
// two and those two are roughly comparable — i.e. it looks like a landscape
function guessUp(THREE, root) {
  const b = collidableBox(THREE, root).box;
  if (b.isEmpty()) return null;
  const s = b.getSize(new THREE.Vector3());
  const a = [['x', s.x], ['y', s.y], ['z', s.z]].sort((p, q) => p[1] - q[1]);
  const [flat, mid, big] = a;
  if (flat[1] < 0.5 * mid[1] && big[1] < 4 * mid[1]) return flat[0];
  return null;
}

// ------------------------------------------------------------- units check
// Tuning below is in metres. Scenes here are built from layouts in real metres,
// but never trust that: measure the collidable world and rescale if it is
// plainly not metric (a 6-unit-wide "world" is not a beach).
say('measuring the world…');
const { box, meshes } = collidableBox(THREE, world.scene);
const size = box.isEmpty() ? new THREE.Vector3(400, 40, 400) : box.getSize(new THREE.Vector3());
const span = Math.max(size.x, size.z);
let unitScale = 1, unitNote = 'metres (span ' + span.toFixed(0) + ' u)';
if (!isFinite(span) || span <= 0) { unitNote = 'degenerate bbox — assuming metres'; }
else if (span < 60) { unitScale = span / 300; unitNote = `span ${span.toFixed(1)} u is too small for metres — 1 u treated as ${(1 / unitScale).toFixed(1)} m`; }
else if (span > 40000) { unitScale = span / 4000; unitNote = `span ${span.toFixed(0)} u is too large for metres — 1 u treated as ${(1 / unitScale).toFixed(3)} m`; }

// ----------------------------------------------------------- collision grid
// Centre the grid where the default camera is looking, not on the bbox centre:
// backdrops like a 5 km coastline drag the centroid off the playable part.
const groundGuess = box.isEmpty() ? 0 : box.min.y + 0.15 * size.y;
let cx = box.isEmpty() ? 0 : box.getCenter(new THREE.Vector3()).x;
let cz = box.isEmpty() ? 0 : box.getCenter(new THREE.Vector3()).z;
if (world.camera) {
  const o = world.camera.position, d = world.camera.getWorldDirection(new THREE.Vector3());
  if (d.y < -0.02) {
    const t = Math.min((groundGuess - o.y) / d.y, 1500 * unitScale);
    if (t > 0) { cx = o.x + d.x * t; cz = o.z + d.z * t; }
  } else { cx = o.x; cz = o.z; }
}

say('building collision…');
const tCol = performance.now();
// A declared colliders[] list defines the true playable extent — size the grid
// to it rather than the camera/centroid guess. Contract worlds have no camera,
// which used to leave the grid centred at the origin with a fixed 620 m half
// extent, silently dropping collision on anything beyond it.
let colHalf = 620 * unitScale;
if (Array.isArray(world.colliders) && world.colliders.length) {
  const cb = new THREE.Box3(), one = new THREE.Box3();
  for (const m of world.colliders) {
    if (!m || !m.isObject3D) continue;
    one.setFromObject(m);
    if (!one.isEmpty()) cb.union(one);
  }
  if (!cb.isEmpty()) {
    const c = cb.getCenter(new THREE.Vector3());
    cx = c.x; cz = c.z;
    const span = Math.max(cb.max.x - cb.min.x, cb.max.z - cb.min.z) / 2 + 60 * unitScale;
    colHalf = Math.min(4200 * unitScale, Math.max(colHalf, span));
  }
}
const colOpts = {
  center: new THREE.Vector3(cx, 0, cz),
  halfExtent: colHalf,
  cell: 6 * unitScale,
};
let collision = buildCollision(THREE, world.scene, { ...colOpts, colliders: world.colliders });

// A declared colliders[] list is trusted, but not blindly: a scene that keeps
// its ground as an analytic heightfield and only lists rocks would leave us
// with nothing to stand on. If the declared set has no floor anywhere near
// where we intend to spawn, fall back to picking colliders ourselves.
let colliderNote = world.colliders ? 'declared colliders[]' : 'auto (backdrop-filtered)';
if (world.colliders && !hasFloor(collision)) {
  collision = buildCollision(THREE, world.scene, colOpts);
  colliderNote = 'declared colliders[] had no floor — fell back to auto';
  console.warn('[play] declared colliders[] contained no walkable floor; using every non-backdrop mesh instead');
}
const colMs = Math.round(performance.now() - tCol);

function hasFloor(col) {
  const top = col.bounds.maxY + 5;
  const pts = [[cx, cz]];
  const hint = world.spawnHint && world.spawnHint.position;
  if (hint) pts.push(hint.isVector3 ? [hint.x, hint.z] : [hint[0], hint[2]]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, r = (30 + (i % 3) * 60) * unitScale;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
  }
  return pts.some(([x, z]) => col.groundAt(x, z, top) !== null);
}
if (collision.stats.triangles === 0) {
  window.__playFailed = true;
  window.__playFail('nothing to stand on', 'the scene has no collidable geometry inside the play region — every mesh read as backdrop or was out of range');
  throw new Error('no colliders');
}

// ------------------------------------------------------------------ spawn
const layout = (cfg.info && cfg.info.layout && cfg.info.layout.data) || null;
// `upAxis` and `pathname` are what make NAMED spawns work: the first lets
// spawn.js tip the world's raw contract markers into the three frame the same
// way this file tips spawnHint/lifts/runs, and the second is the shareable
// pretty URL — /kt22 — read as a waypoint slug. `?spawn=` still wins over the
// path, and an unknown slug is not an error: it falls through to the default.
const spawn = pickSpawn(THREE, {
  collision, world, layout, qs: cfg.qs, unitScale, upAxis,
  pathname: (typeof location !== 'undefined' ? location.pathname : null),
});
// TRUE when the URL asked for a specific waypoint and the world had one. The
// guided run reads it below.
const namedSpawn = !!(spawn && spawn.slug);

// lengths and speeds scale with the scene's unit; accel/friction are rates (1/s)
const tuning = {};
for (const k of ['eyeHeight', 'radius', 'walk', 'sprint', 'jump', 'gravity', 'stepUp', 'maxFall', 'voidDrop', 'snapDown']) {
  tuning[k] = TUNING[k] * unitScale;
}
// which ski is in the bindings: ?ski=<id> > the remembered pick > lab-standard,
// whose overrides are empty, so an untouched session is the old numbers exactly
let skiId = resolveSkiId(cfg.qs);
tuning.ski = skiTuningFor(skiId, unitScale);
// and which bike is under you: ?bike=<id> > the remembered pick > lab-standard,
// whose overrides are likewise empty, so an untouched session pedals, pumps and
// pops exactly as it did before bike.js grew a rack
let bikeId = resolveBikeId(cfg.qs);
tuning.bike = bikeTuningFor(bikeId, unitScale);
tuning.glider = scaleGliderTuning(unitScale);
tuning.rocket = scaleRocketTuning(unitScale);
// the two vehicles: a toboggan (sled.js) and a machine with an engine in it
// (snowmobile.js). Same rack shape as the skis — ?sled=/?snowmobile=<id> > the
// remembered pick > the house model, whose overrides are empty.
let sledId = resolveSledId(cfg.qs);
tuning.sled = sledTuningFor(sledId, unitScale);
let snowmobileId = resolveSnowmobileId(cfg.qs);
tuning.snowmobile = snowmobileTuningFor(snowmobileId, unitScale);

// ---- the glider rack. GLIDER is one equipment type with two flight models —
// the wing (glider.js) and the rocket pack (rocket.js + the motor in boost.js) —
// so there is one `glider` row in the gear menu and one `glider` tab in the
// locker, and the model you picked decides which controller gear actually flies.
// ?glider=<id> > the remembered pick > the wing, exactly like ?ski=.
let gliderId = resolveGliderId(cfg.qs);
// `rocket` is the shorthand a URL or a world may use for "glider, wearing the
// pack". It is not an equipment type — it just picks the model for you.
const qGear = (cfg.qs && cfg.qs.get('gear')) || null;
if (qGear === 'rocket' || (!qGear && world.gear === 'rocket')) gliderId = 'rocket-pack';
// the controller gear a public gear name currently maps to
const realGear = (g) => (g === 'glider' ? getGliderModel(gliderId).gear : g);
// ...and back: 'rocket' is not an equipment type the player ever sees
const pubGear = (g) => (g === 'rocket' ? 'glider' : g);

// ---- default gear: ?gear= > the world's declared gear (PLAYABLE.md) > a
// small poi map > boots. You spawn wearing it; tap-E toggles boots ↔ it.
// specs/0003 — `gearSet`. On the ski set there is no bike gear at all, so the
// per-poi map (which keys off BENCH run names and means nothing to a standalone
// build) is empty and 'bike' is not a name the player can reach.
// The glider is deliberately in no POI map: it belongs to any world with air,
// and on both sets it stays reachable only through the locker.
const POI_GEAR = FULL_GEAR_MENU ? { 'eagles-nest-kt22': 'skis', 'truckee-bike-park': 'bike' } : {};
const GEAR_NAMES = BIKE_GEAR
  ? ['boots', 'skis', 'bike', 'glider', 'sled', 'snowmobile']
  : ['boots', 'skis', 'glider', 'sled', 'snowmobile'];
const defaultGear = (() => {
  const q = pubGear(qGear);
  if (GEAR_NAMES.includes(q)) return q;
  if (GEAR_NAMES.includes(pubGear(world.gear))) return pubGear(world.gear);
  return POI_GEAR[cfg.poi] || 'boots';
})();
tuning.defaultGear = realGear(defaultGear === 'boots' ? 'skis' : defaultGear);

const ctrl = createController(THREE, collision, spawn, tuning);
ctrl.setMode(realGear(defaultGear));   // the world says what is on your feet
const camera = world.camera;
camera.near = Math.max(0.05, 0.12 * unitScale);
camera.far = Math.max(camera.far, 4000 * unitScale);
camera.fov = 72;
camera.updateProjectionMatrix();

// ------------------------------------------------------- skier & 3D skis
// Low-poly, built from the three we already have. Lambert + emissive so it
// reads in any scene's lighting and is never a black silhouette.
const u = unitScale;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lamb = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
const MATS = {
  // (the ski deck material moved to ski.js — it is per-model now)
  hard: lamb(0x17161a, 0x0b0a09),      // bindings, poles
  jacket: lamb(0xff4d00, 0x7a2500),
  dark: lamb(0x26231f, 0x12110f),      // pants, arms
  cream: lamb(0xf4f1ea, 0x6b675f),     // helmet
  // glider, from _ref/aang-glider.jpg: orange-red fabric, dark wooden spine and
  // ribs, and the pilot in Air Nomad orange with a blue arrow
  wing: new THREE.MeshLambertMaterial({ color: 0xdd6a2a, emissive: 0x6d2c08, side: THREE.DoubleSide }),
  staff: lamb(0x6b4a2a, 0x2f2013),
  arrow: lamb(0x3f86d8, 0x16334f),
};

// one ski; origin at the binding, tip pointing -Z and curling up. The geometry
// and the topsheet both live in ski.js now, because both are per-model — see
// makeSkiRig / styleSkiRig there and the rack the inventory picks from.
const makeSki = () => makeSkiRig(THREE, u);

// first-person skis: follow the camera, mounted where a racing game mounts the
// hood — high enough to be in frame, long enough to read as skis
const fpRig = new THREE.Group();
fpRig.name = 'play:fp-skis';
const fpSkiL = makeSki(), fpSkiR = makeSki();
fpSkiL.position.set(-0.17 * u, -0.88 * u, -0.62 * u);
fpSkiR.position.set(0.17 * u, -0.88 * u, -0.62 * u);
fpSkiL.rotation.y = 0.02; fpSkiR.rotation.y = -0.02;
fpRig.add(fpSkiL, fpSkiR);
fpRig.visible = false;
world.scene.add(fpRig);

// third-person skier: capsule-ish body + head + arms/poles + the same skis.
// Cheap subgroup transforms do all the animation — no skeleton.
const model = new THREE.Group();
model.name = 'play:skier';
model.rotation.order = 'YXZ';
const mBody = new THREE.Group();
{
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.40 * u, 0.54 * u, 0.26 * u), MATS.jacket);
  torso.position.y = 1.08 * u;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14 * u, 10, 8), MATS.cream);
  head.position.y = 1.52 * u;
  mBody.add(torso, head);
}
const mkArm = (side) => {
  const a = new THREE.Group();
  a.position.set(side * 0.26 * u, 1.3 * u, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09 * u, 0.44 * u, 0.09 * u), MATS.dark);
  arm.position.y = -0.2 * u;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * u, 0.012 * u, 1.05 * u, 5), MATS.hard);
  pole.position.set(0, -0.62 * u, 0.12 * u);
  pole.rotation.x = -0.3;
  a.add(arm, pole);
  a.rotation.z = -side * 0.22;
  return a;
};
const mArmL = mkArm(-1), mArmR = mkArm(1);
const mkLeg = (side) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.13 * u, 0.52 * u, 0.15 * u), MATS.dark);
  m.position.set(side * 0.11 * u, 0.56 * u, 0);
  return m;
};
mBody.add(mArmL, mArmR, mkLeg(-1), mkLeg(1));
const mSkiL = makeSki(), mSkiR = makeSki();
mSkiL.position.set(-0.15 * u, 0.02 * u, 0);
mSkiR.position.set(0.15 * u, 0.02 * u, 0);
// named so the inventory's preview can clone this rig and dress it (inventory.js)
mBody.name = 'play:body'; mSkiL.name = 'play:ski-l'; mSkiR.name = 'play:ski-r';
model.add(mBody, mSkiL, mSkiR);
model.visible = false;
world.scene.add(model);

// ------------------------------------------------------------ Aang's glider
// Built from _ref/aang-glider.jpg: a wooden staff spine with ribs fanning out
// and back from a hub, orange-red fabric stretched between them, and the
// trailing edge scalloped between rib tips the way a bat's wing is. That
// scallop is the whole silhouette — a plain swept triangle reads as a hang
// glider, not as this. Origin is the hub, nose at -Z like everything else here.
const RIBS = 6;                    // per side
const RIB_A0 = 0.62, RIB_A1 = 2.30;   // rad off the nose: forward-most → rear-most
const HUB_Z = -0.55;

// where rib i of this side ends, in glider-local metres
function ribTip(side, i) {
  const a = RIB_A0 + (RIB_A1 - RIB_A0) * (i / (RIBS - 1));
  const L = 1.15 + 0.45 * Math.sin(a);            // widest across the middle
  return [side * L * Math.sin(a), 0.04 + 0.16 * Math.sin(a), HUB_Z - L * Math.cos(a)];
}

// point the box's -Z down `d` — used for every rib, so they all splay from one rule
function aimAlong(mesh, d) {
  const h = Math.hypot(d[0], d[2]) || 1e-6;
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = Math.atan2(-d[0], -d[2]);
  mesh.rotation.x = Math.asin(Math.max(-1, Math.min(1, d[1] / (Math.hypot(d[0], d[1], d[2]) || 1))));
  return h;
}

function makeGliderSide(side) {
  const g = new THREE.Group();
  const H = [0, 0, HUB_Z];
  const tips = [];
  for (let i = 0; i < RIBS; i++) tips.push(ribTip(side, i));

  // ---- fabric: one fan of panels, each bowed in at the trailing edge
  const v = [];
  const push = (...pts) => { for (const q of pts) v.push(q[0] * u, q[1] * u, q[2] * u); };
  for (let i = 0; i < RIBS - 1; i++) {
    const a = tips[i], b = tips[i + 1];
    const mid = [0, 1, 2].map((k) => H[k] + 0.86 * ((a[k] + b[k]) / 2 - H[k]));   // the scallop
    if (side > 0) { push(H, a, mid); push(H, mid, b); }
    else { push(H, mid, a); push(H, b, mid); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo, MATS.wing));

  // ---- the ribs themselves, laid on top of the fabric
  for (const t of tips) {
    const d = [t[0] - H[0], t[1] - H[1], t[2] - H[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.035 * u, 0.035 * u, len * u), MATS.staff);
    rib.position.set((H[0] + t[0]) / 2 * u, (H[1] + t[1]) / 2 * u + 0.012 * u, (H[2] + t[2]) / 2 * u);
    aimAlong(rib, d);
    g.add(rib);
  }
  return g;
}

function makeGlider() {
  const g = new THREE.Group();
  // the staff: it is a staff first and a glider second, so it runs the whole
  // length and pokes out fore and aft of the fabric
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * u, 0.045 * u, 2.45 * u, 6), MATS.staff);
  staff.rotation.x = Math.PI / 2;
  staff.position.z = -0.05 * u;
  // The bar you actually hang from: two struts down off the hub to a cross
  // bar. In the show the hands are on the front struts, not on the spine, and
  // in first person that difference is the whole reason the hands have
  // something to touch instead of floating under the fabric.
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.032 * u, 0.032 * u, 0.94 * u, 5), MATS.staff);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, -0.60 * u, -0.55 * u);
  const strut = (side) => {
    const S = [0, -0.02, HUB_Z], E = [side * 0.44, -0.60, -0.55];
    const d = [E[0] - S[0], E[1] - S[1], E[2] - S[2]];
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.028 * u, 0.028 * u, Math.hypot(...d) * u), MATS.staff);
    m.position.set((S[0] + E[0]) / 2 * u, (S[1] + E[1]) / 2 * u, (S[2] + E[2]) / 2 * u);
    aimAlong(m, d);
    return m;
  };
  const L = makeGliderSide(-1), R = makeGliderSide(1);
  g.add(staff, L, R, bar, strut(-1), strut(1));
  return { group: g, L, R };
}

// ------------------------------------------------------------- the pilot
// Prone, superman, hanging under the wing with both hands forward on the spine
// and the legs trailing together — the pose in the reference. Lies along -Z so
// it drops straight into the same yaw/pitch frame as everything else.
function makePilot() {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.36 * u, 0.24 * u, 0.80 * u), MATS.jacket);
  torso.position.set(0, 0, 0.06 * u);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145 * u, 10, 8), MATS.cream);
  head.position.set(0, 0.10 * u, -0.52 * u);
  // the arrow — small, but it is the one mark that says who this is
  const arrow = new THREE.Mesh(new THREE.BoxGeometry(0.07 * u, 0.02 * u, 0.20 * u), MATS.arrow);
  arrow.position.set(0, 0.22 * u, -0.55 * u);
  arrow.rotation.x = -0.35;
  const arm = (side) => {
    const a = new THREE.Group();
    a.position.set(side * 0.21 * u, 0.05 * u, -0.26 * u);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.10 * u, 0.52 * u), MATS.jacket);
    upper.position.z = -0.26 * u;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.10 * u, 0.10 * u, 0.13 * u), MATS.cream);
    hand.position.set(0, 0, -0.56 * u);
    a.add(upper, hand);
    a.rotation.x = -0.16;                 // reaching forward onto the control bar
    a.rotation.y = side * -0.13;
    return a;
  };
  const leg = (side) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.14 * u, 0.15 * u, 0.80 * u), MATS.dark);
    m.position.set(side * 0.10 * u, -0.02 * u, 0.82 * u);
    m.rotation.x = 0.06;                  // trailing, just short of straight
    return m;
  };
  // the robe's tail, streaming back — cheap, and it sells the airspeed
  const robe = new THREE.Mesh(new THREE.BoxGeometry(0.34 * u, 0.03 * u, 0.62 * u), MATS.jacket);
  robe.position.set(0, -0.08 * u, 0.72 * u);
  robe.rotation.x = -0.10;
  g.add(torso, head, arrow, arm(-1), arm(1), leg(-1), leg(1), robe);
  return g;
}

// First person: you are prone under the wing, so the frame gets your own
// forearms reaching forward onto the spine and the fabric overhead. The wing
// sits 0.80 m above the eye, which puts its far edge just inside a 36° half-fov
// — present across the top, not a windscreen. Mounted to the camera like the
// fp skis, so it banks and rolls with the view as one piece.
const fpGlide = new THREE.Group();
fpGlide.name = 'play:fp-glider';
const fpWing = makeGlider();
fpWing.group.position.set(0, 0.80 * u, -0.30 * u);
fpWing.group.rotation.x = -0.12;                 // tip the underside into view
// Only the FOREARMS are drawn, running from the lower corners up to the hands
// on the spine ahead. The upper arm and shoulder belong behind the lens for a
// prone pilot, and anything nearer than half a metre reads as a beam across the
// screen rather than a limb — the first two attempts at this both did.
const fpArms = new THREE.Group();
for (const s of [-1, 1]) {
  // the hand lands ON the control bar: wing at y 0.80 z -0.30, bar at -0.60/-0.55
  const elbow = [s * 0.31, -0.20, -0.44], Hd = [s * 0.20, 0.20, -0.85];
  const d = [Hd[0] - elbow[0], Hd[1] - elbow[1], Hd[2] - elbow[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.055 * u, 0.055 * u, len * u), MATS.jacket);
  sleeve.position.set((elbow[0] + Hd[0]) / 2 * u, (elbow[1] + Hd[1]) / 2 * u, (elbow[2] + Hd[2]) / 2 * u);
  aimAlong(sleeve, d);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.07 * u, 0.07 * u, 0.10 * u), MATS.cream);
  hand.position.set(Hd[0] * u, Hd[1] * u, Hd[2] * u);
  fpArms.add(sleeve, hand);
}
fpGlide.add(fpWing.group, fpArms);
fpGlide.visible = false;
world.scene.add(fpGlide);

// Third person: the money shot. The prone pilot and the wing are one rig, so
// the bank tilts both together and the rig pitches with the flight path — a
// standing skier hung under a glider would read as a bug.
const tpGlide = new THREE.Group();
const tpWing = makeGlider();
tpWing.group.position.set(0, 1.62 * u, 0);      // spine, right where the hands are
const tpPilot = makePilot();
tpPilot.position.set(0, 1.05 * u, 0);           // slung just under it
tpGlide.add(tpWing.group, tpPilot);
tpGlide.visible = false;
tpGlide.name = 'play:tp-glider';
model.add(tpGlide);

// ------------------------------------------------------------------- the bike
// Until now the bike gear had NO model at all: third person was the standing
// skier with the skis switched off, and first person was an empty screen. Both
// rigs below come out of bike.js — geometry, paint and the rider's pose all
// derived from the equipped model's real head angle, wheelbase and bar height,
// so the hands land on the grips of whichever bike is actually under you.
//
// Third person: the bike carries its own rider (bikeRider's attack position),
// so the standing skier body steps aside exactly the way it does for the glider.
const tpBike = makeBikeRig(THREE, u);
tpBike.name = 'play:tp-bike';
tpBike.visible = false;
model.add(tpBike);

// First person: the same rig, minus the torso and head, hung off the camera and
// anchored BY THE GRIPS, not by the ground. Anchoring at the ground is the
// honest thing and it puts the entire bike below a level 72° gaze — which is
// also true of a real bike, and is why the fp skis are mounted "where a racing
// game mounts the hood" rather than where boots are. So: the grips sit at a
// fixed spot just inside the bottom of the frame on every bike in the rack, and
// each model's own bar height and reach decide where the rest of it hangs off
// them. A 20" BMX therefore shows more fork and less frame, which is correct.
const fpBike = new THREE.Group();
fpBike.name = 'play:fp-bike';
const fpBikeInner = makeBikeRig(THREE, u);
fpBike.add(fpBikeInner);
fpBike.visible = false;
world.scene.add(fpBike);
const FP_GRIP = { y: -0.32, z: -0.76 };     // where the grips live, metres off the eye
let fpBikeSeatY = 0;
function seatFpBike(id) {
  const R = bikeRider(getBikeModel(id));
  fpBikeSeatY = (FP_GRIP.y - R.hand[0]) * u;
  fpBikeInner.position.set(0, fpBikeSeatY, (FP_GRIP.z - R.hand[1]) * u);
}

// ------------------------------------------------------------ the rocket pack
// Third person it hangs off the standing body, so it crouches, tucks and banks
// with it and the plume (boost.js) comes out of the bells rather than out of a
// point behind your shoulders. First person you get the two bells at the bottom
// edge of the frame and their light — faint at idle, lit under thrust.
const tpPack = makeRocketPack(THREE, u);
tpPack.name = 'play:rocket-pack';            // the locker clones the rig by name
tpPack.visible = false;
mBody.add(tpPack);

const fpPack = makeRocketFP(THREE, u);
fpPack.group.name = 'play:fp-rocket';
fpPack.group.visible = false;
world.scene.add(fpPack.group);

// ------------------------------------------------------------- the toboggan
// Both rigs come out of sled.js. Third person the sled carries its own SEATED
// rider — legs forward, hands on the rope — so the standing skier body steps
// aside exactly the way it does for the bike and the glider. First person you
// get the deck running away from you and the curl standing up at the end of it,
// mounted on the camera like the fp skis.
const tpSled = makeSledRig(THREE, u);
tpSled.name = 'play:tp-sled';
tpSled.visible = false;
model.add(tpSled);

const fpSled = makeSledFP(THREE, u, sledId);
fpSled.name = 'play:fp-sled';
fpSled.visible = false;
world.scene.add(fpSled);

// ------------------------------------------------------------ the snowmobile
// Same shape as the sled: a rig with its own rider (kneeling on the running
// boards, hands on the bars) for third person, and the bars, hood, windshield
// and ski tips hung off the camera for first.
const tpSnow = makeSnowmobileRig(THREE, u, { model: snowmobileId });
tpSnow.name = 'play:tp-snowmobile';
tpSnow.visible = false;
model.add(tpSnow);

const fpSnow = makeSnowmobileFP(THREE, u, snowmobileId);
fpSnow.name = 'play:fp-snowmobile';
fpSnow.visible = false;
world.scene.add(fpSnow);

// ----------------------------------------------------- specs/0015 the tumble
// THE POSED TUMBLE. The controller already spends the event — `wipeout(why)`
// scrubs the velocity and puts 2.0 s on `wipeT` — and until 0015 the only thing
// on screen was a lens wobble under a body that kept standing in its riding
// tuck. This is the body going DOWN and getting back up inside that same 2.0 s,
// and the eye going down with it, both read off ONE solver so first and third
// person can never disagree about where the head is.
//
// The clock is `tw = TUM_LEN - wipeT`, which makes every pose a pure function of
// the controller's own countdown. That is not a stylistic choice: it is the only
// reason the acceptance strips can be shot at all, because `wipeT` freezes when
// the game is paused and the rig keeps drawing, so "the frame at t = 0.3 s" is a
// frame anybody can take twice and get the same pixels.
//
// ---- specs/0030: TWO SECONDS, AND HARDER.
//
// 0.9 s was a hit and a get-up with no fall in between: the body folded, was
// prone for a third of a second, and stood back up. 0030 keeps the HIT exactly
// as snappy as it was — authority is on in three frames at 60, the fold is still
// 0.15 s, the kick-back is still gone by 0.16 — puts the body DOWN faster than
// before, and spends the extra 1.1 s SLIDING. The tracks below are RE-TIMED, not
// stretched: nothing about the impact is slower, the prone hold runs to 1.55 s,
// and the get-up owns the last 0.40 s and lands on the riding pose at 2.0
// exactly, because every track still ends on its riding value.
//
// Nothing here writes to the controller. Every number below is a picture.
const TUM_LEN = 2.0;                    // s — wipeT's span; not ours to change
// A CONTACT, as opposed to a landing you fluffed: something solid stopped the
// body, so the first 0.15 s is a fold against it rather than a pitch over the
// tips. specs/0018 put four more names on the same event — a tower, a building,
// a person and a bench are all "you hit a thing" — so this is a SET and not an
// `=== 'tree'` that the next solid thing would have to be threaded through.
const TUM_SOLID = new Set(['tree', 'rock', 'building', 'tower', 'person', 'bench']);
const TUM = {
  FOLD: 0.15,        // s — the stop, on a contact
  BACK: 0.45,        // m — how far a contact folds the body back along -v
  KICK_PITCH: 0.25,  // rad — 14 deg of nose-down that goes with it
  ROLL: 0.50,        // rad — the prone roll's CHATTER, ±0.50 at 7 Hz, decaying
  ROLL_HZ: 7.0,      // Hz
  // ...over 0.8 s, not 0.34. At 0.34 the body was shuddering for half a second
  // and lying dead for the other 1.5 of a 2 s slide, which is a corpse with a
  // twitch at the start rather than something being dragged across snow.
  ROLL_DAMP: 0.80,   // s — its envelope
  FOLD_ROLL: 0.35,   // rad — ...and the lean the fold itself puts on
  // ...plus a roll the body HOLDS through the slide. The chatter alone is a sine
  // through zero, so whichever instant the shutter falls on is as likely to be
  // flat as not, and a prone body photographed flat is a plank. 15 deg onto the
  // shoulder it was thrown over is where a body that fell actually lies, and it
  // gives the chatter something to chatter around.
  PRONE_ROLL: 0.40,  // rad
  SPIN: 2.40,        // rad — peak yaw a contact throws you through
  SPIN_ROT: 3.10,    // rad — ...and a rotation wipe, which keeps turning
  EYE: 0.38,         // m — how low the eye gets (0015 §3's 0.45, knocked lower)
  EYE_FLOOR: 0.25,   // m — ...and how close to the snow it may ever come
  // §3's floor is 0.6 m off the trunk AXIS. This is 0.95, and the extra 0.35 m
  // is not decoration: a 0.24 m trunk with the lens 0.36 m off its bark is a
  // black rectangle filling the frame, not a tree. Measured on the first strips,
  // which came back unreadable. Still a floor, never a target — the eye is only
  // ever pushed OUT to it.
  STEM_R: 0.95,      // m — how far the eye is kept off a trunk axis
  STEM_PROBE: 2.20,  // m — how wide a net the eye casts looking for that trunk
  SPLAY: 0.50,       // rad — the skis fan out
  LIFT: 0.10,        // m — ...and come off the snow, because they are on a body
  CHASE_IN: 1.30,    // m — the chase steps in and down so the fold fills the frame
  CHASE_DOWN: 0.85,  // m
  // ...and SWINGS OFF THE AXIS, which is the single biggest thing in the frame.
  // From dead astern a body folding against a trunk is a body with a trunk
  // behind it: the fold happens along the view axis, so the one motion the shot
  // exists to show is the one motion the camera cannot see, and the fir fills the
  // middle of the picture as a flat dark slab. 49 deg round puts the fold across
  // the frame and the tree beside it against open snow. Same medicine, same
  // reason, as BIKE_SWING two dozen lines below.
  CHASE_SWING: 0.85, // rad
};

// ---- the keyframe tracks. `[t, v]` in TUMBLE seconds, smoothstepped across
// each segment so no joint in the animation is a corner. Every track starts and
// ends at the riding value, which is what makes the entry and the exit pop-free
// without anybody having to remember to fade them.
const TUM_KF = {
  // pitch of the whole body. Two tracks and the whole difference between them is
  // §2's last paragraph: a fluffed landing pitches over the tips in one motion;
  // a contact STOPS at 0.6 rad, holds there for the fold, and goes down second.
  //
  // 0030 §3: DOWN FASTER, AND FURTHER OVER. The peak arrives by 0.10 s instead
  // of 0.15 and OVERSHOOTS to 1.55 rad before settling back to the 1.32 the
  // slide holds — a body that is thrown past flat and then lands on itself,
  // rather than one that eases down to horizontal and stops there.
  pitchAir:   [[0, 0], [0.10, 1.55], [0.24, 1.32], [1.60, 1.32], [1.84, 0.42], [1.95, -0.14], [2.00, 0]],
  // ...and the same past the fold: the 0.15 s stop against the trunk is exactly
  // the stop it was, and then the body goes over hard.
  pitchSolid: [[0, 0], [0.035, 0.60], [0.15, 0.68], [0.25, 1.55], [0.40, 1.32], [1.60, 1.32], [1.84, 0.42], [1.95, -0.14], [2.00, 0]],
  // authority: how much of the pose above is on screen. Three frames in (the
  // fold IS a snap) — UNCHANGED, because 0030 is a longer fall and not a slower
  // hit — held all the way through the slide, and handed back over the last
  // 0.40 s so the get-up lands exactly on the riding pose at 2.0.
  auth:  [[0, 0], [0.045, 1], [1.60, 1], [2.00, 0]],
  // the hips pressing into the snow. 0030 §3 doubles it to 0.10 m and puts a
  // BOUNCE in it: the body lands on its hip, comes back up 0.04 m as the slide
  // takes over, and settles for the rest of it. Without the bounce a 2 s slide
  // is a body pressed into the snow at a constant depth for a second and a half.
  sink:  [[0, 0], [0.13, 0.10], [0.30, 0.06], [0.48, 0.085], [1.60, 0.08], [1.88, 0.015], [2.00, 0]],
  // yaw: out through the slide, and back as the body re-aims downhill getting up
  spin:  [[0, 0], [0.12, 0.30], [0.55, 0.86], [0.95, 1.0], [1.60, 1.0], [1.84, 0.52], [2.00, 0]],
  // the roll the slide HOLDS, under the chatter
  rollHold: [[0, 0], [0.14, 1], [1.60, 1], [1.88, 0.25], [2.00, 0]],
  // how far the prone body has swung onto the velocity vector (§2's "lies along
  // the velocity vector"). Body only — see the note at the yaw write below.
  align: [[0, 0], [0.18, 1], [1.60, 1], [2.00, 0]],
  // the eye's own drop, 0 = riding height, 1 = TUM.EYE. Down in 0.12 s, held for
  // the whole slide, and the last 0.40 s to come back.
  eye:   [[0, 0], [0.12, 1], [1.60, 1], [2.00, 0]],
  // ...and where the lens points while it is down there. -0.42 rad, not the
  // -0.60 the first pass used: at 34 deg of nose-down from an eye 45 cm off the
  // snow the horizon leaves the top of the frame and every prone frame is a
  // featureless white field. At 24 deg the skyline stays in shot, and then the
  // roll below has something to roll.
  camP:  [[0, 0], [0.12, -0.42], [1.60, -0.40], [1.84, -0.13], [1.95, 0.07], [2.00, 0]],
  // the contact's kick-back, in 3 frames at 60 and gone by the time the fold is.
  // 0030 leaves this timing ALONE — §1 is explicit that the hit stays as snappy
  // as it is — and only makes it bigger, via TUM.KICK_PITCH.
  kick:  [[0, 0], [0.008, 1], [0.05, 1], [0.16, 0], [2.00, 0]],
  // the backward displacement the same contact folds the body by. It is the SAME
  // 0.45 m the camera took above, held through the slide and released with the
  // get-up, so the eye and the body never disagree about where the impact put you.
  back:  [[0, 0], [0.008, 1], [0.35, 1], [1.60, 0.62], [2.00, 0]],
  // the arms: up and forward at the hit, splayed through the slide, down as you
  // stand. Negative x is forward/up here — `c * 0.9` sweeps them back into a tuck.
  arm:   [[0, 0], [0.065, -1.60], [0.32, -0.42], [1.60, -0.32], [1.90, -0.04], [2.00, 0]],
  // the skis: fanned and off the snow while the body is on it
  ski:   [[0, 0], [0.14, 1], [1.60, 1], [1.88, 0.15], [2.00, 0]],
};

// the short way round from `b` to `a`, in radians. Without it a body whose
// velocity heading is 179° from its look would take the long way through the
// whole tumble, which reads as a helicopter rather than a fall.
function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// linear-in-t, smoothstep-in-v sampling of one track
function tumAt(track, t) {
  const n = track.length;
  if (t <= track[0][0]) return track[0][1];
  if (t >= track[n - 1][0]) return track[n - 1][1];
  for (let i = 1; i < n; i++) {
    const [t1, v1] = track[i];
    if (t > t1) continue;
    const [t0, v0] = track[i - 1];
    const s = (t - t0) / (t1 - t0 || 1);
    return v0 + (v1 - v0) * s * s * (3 - 2 * s);
  }
  return track[n - 1][1];
}

// The solver's whole output, in one object both views read. Written once a frame
// in camRig.update(); read by applyTo() (the eye) and updateVisuals() (the body).
const tum = {
  on: false, t: 0, w: 0, why: null, solid: false, sign: 1, auth: 0,
  pitch: 0, roll: 0, spin: 0, align: 0, sink: 0, arm: 0, ski: 0,
  bx: 0, bz: 0, back: 0,               // the fold's displacement, in world x/z
  eye: 0, eyeDrop: 0, camP: 0, camR: 0, camY: 0,
  yawVel: 0,                           // heading of the velocity at the hit
  // measured, for the gate: how close the eye came to the snow and to a trunk
  eyeGround: 0, eyeStem: -1, stemDist: -1, clampedGround: 0, clampedStem: 0,
  n: 0,                                // wipes this rig has posed
};
let tumPrevWipe = 0;

// The SIGN of the spin. specs/0015 §2: a rotation wipe keeps turning the way it
// was turning, and a contact spins you AWAY from what you hit. `lastTrick.deg`
// carries the first (the controller records the air spin it failed to close);
// for a contact it is 0, because `wipeout('tree')` takes no angle — so the sign
// comes off the geometry instead. `collision.stemHit` and `ctrl.lastBlock` are
// the two contact normals the player already has; failing both, it is the side
// the body is sliding out on.
//
// HEADS-UP, deliberate: the controller does not publish WHICH stem the wipe was
// against (`canopyStem` is cleared for the duration of a tumble by design, and
// `wipeout()` takes no index). specs/0015 §3 allows `solids.nearest`, which does
// not exist; the equivalent that does is a wide `stemHit` probe, which answers
// with the deepest trunk inside `STEM_PROBE` of the body. In a glade tight enough
// for two trunks to be in that net it can pick the neighbour. Nothing downstream
// is wrong when it does — the eye is pushed off A trunk rather than THE trunk.
function tumContactNormal() {
  const p = ctrl.position;
  if (collision.stemHit) {
    const h = collision.stemHit(p.x, p.y, p.z, TUM.STEM_PROBE * unitScale, unitScale);
    if (h) return { nx: h.nx, nz: h.nz, stem: h.i };
  }
  const b = ctrl.lastBlock;
  if (b && Number.isFinite(b.nx)) return { nx: b.nx, nz: b.nz, stem: -1 };
  return null;
}

// WHICH WAY IT THROWS YOU. specs/0015 §2: a rotation wipe keeps turning the way
// it was turning, and a contact spins you away from what you hit.
//
// The first half is now a read, not a reconstruction. The rig used to watch
// `ctrl.airSpinDeg` frame by frame and keep the last sign it saw over 5°,
// because `lastTrick.deg` is a magnitude and `wipeout()` zeroed `airSpin` in the
// same breath — a latch that survived across accidents and only saw the frames
// the rig was posed on. controller.js reads the sign itself now and puts it on
// the wipe event as `spinDir` (specs/0028 §1), so there is one source and it is
// exact: ±1 for a rotation left open, 0 when there was no air.
//
// 0 falls through to the geometry below, which is every contact wipe.
function tumSign(lt) {
  if (lt && lt.spinDir) return lt.spinDir;
  const v = ctrl.velocity;
  const c = tumContactNormal();
  // away from the contact: the cross product of where you were going and where
  // the surface points is which way the body gets thrown round
  if (c) {
    const s = v.x * c.nz - v.z * c.nx;
    if (Math.abs(s) > 1e-3) return Math.sign(s);
  }
  // ...or the side you were already sliding out on. right = (cos yaw, -sin yaw).
  const lat = v.x * Math.cos(ctrl.yaw) - v.z * Math.sin(ctrl.yaw);
  return lat < 0 ? -1 : 1;
}

// ONE SOLVE A FRAME, and the only place any tumble number is decided. Called
// from camRig.update() before anything reads `tum`.
function tumbleStep() {
  const u = unitScale;
  const wt = ctrl.wipeT;
  // THE EDGE. Everything that depends on the moment of the hit rather than on
  // the clock — which way it throws you, whether it was a contact, where the
  // body was going — is latched here and held for the whole 2.0 s. Re-deriving
  // the spin sign every frame from a velocity the scrub is still rotating would
  // let the body change its mind about which way it is falling.
  // `wipeT` only ever counts DOWN, so a value that went up is a fresh wipeout
  // even if the rig never saw the zero in between — which is what happens
  // whenever the controller is stepped faster than the rig is posed (a
  // deterministic test ride does exactly that, and so does a dropped frame).
  if (wt > 0 && (tumPrevWipe <= 0 || wt > tumPrevWipe + 1e-6)) {
    const lt = ctrl.lastTrick;
    tum.why = lt && lt.name === 'wipeout' ? (lt.why || null) : null;
    tum.solid = TUM_SOLID.has(tum.why);
    tum.sign = tumSign(lt);
    const v = ctrl.velocity;
    const vm = Math.hypot(v.x, v.z);
    tum.yawVel = vm > 0.5 * u ? Math.atan2(-v.x, -v.z) : ctrl.yaw;
    const c = tum.solid ? tumContactNormal() : null;
    tum.eyeStem = c ? c.stem : -1;
    tum.n++;
  }
  tumPrevWipe = wt;

  const riding = ctrl.mode !== 'boots' && !ctrl.footedNow;
  if (!(wt > 0) || !riding) {
    tum.on = false; tum.auth = 0; tum.t = 0; tum.w = 0;
    tum.pitch = tum.roll = tum.spin = tum.align = tum.sink = tum.arm = tum.ski = 0;
    tum.bx = tum.bz = tum.back = 0;
    tum.eyeDrop = 0; tum.eye = ctrl.T.eyeHeight;
    tum.camP = tum.camR = tum.camY = 0;
    tum.stemDist = -1; tum.clampedGround = 0; tum.clampedStem = 0;
    tum.eyeGround = 0;
    return;
  }

  const t = tum.t = TUM_LEN - wt;              // 0 -> 2.0, the tumble's own clock
  tum.on = true;
  tum.w = wt / TUM_LEN;
  const a = tum.auth = tumAt(TUM_KF.auth, t);
  const K = TUM_KF;

  tum.pitch = tumAt(tum.solid ? K.pitchSolid : K.pitchAir, t);
  tum.sink = tumAt(K.sink, t) * u;
  tum.arm = tumAt(K.arm, t);
  tum.ski = tumAt(K.ski, t);
  tum.align = tumAt(K.align, t);

  // ---- the roll. A lean onto the spin side while the body folds, then the
  // ±0.3 rad 6 Hz chatter of a body actually sliding on snow, decaying. One
  // expression, so fp and tp cannot drift apart by a frame.
  const fold = Math.min(1, t / TUM.FOLD);
  const st = Math.max(0, t - TUM.FOLD);
  const osc = Math.sin(st * Math.PI * 2 * TUM.ROLL_HZ) * Math.exp(-st / TUM.ROLL_DAMP);
  const prone = t > TUM.FOLD ? 1 : 0;
  tum.roll = tum.sign * (TUM.FOLD_ROLL * fold * fold
    + TUM.PRONE_ROLL * tumAt(TUM_KF.rollHold, t)
    + TUM.ROLL * osc * prone);

  // ---- the spin
  tum.spin = tum.sign * tumAt(K.spin, t) * (tum.solid ? TUM.SPIN : TUM.SPIN_ROT);

  // ---- the fold's displacement, along -v. A contact only: nothing pushes you
  // back off a landing you simply fluffed.
  const bk = tum.solid ? tumAt(K.back, t) * TUM.BACK * u : 0;
  tum.back = bk;
  if (bk > 1e-6) {
    const yv = tum.yawVel;
    // forward is (-sin yaw, -cos yaw), so backward is its negation
    tum.bx = Math.sin(yv) * bk; tum.bz = Math.cos(yv) * bk;
  } else { tum.bx = 0; tum.bz = 0; }

  // ---- the eye, and the lens
  const eye0 = ctrl.T.eyeHeight;
  tum.eyeDrop = tumAt(K.eye, t) * a;
  tum.eye = eye0 + (TUM.EYE * u - eye0) * tum.eyeDrop;
  const kick = tum.solid ? tumAt(K.kick, t) : 0;
  tum.camP = (tumAt(K.camP, t) - TUM.KICK_PITCH * kick) * a;
  tum.camR = tum.roll * a;
  tum.camY = tum.spin * a;

  // ---- EYE RADIUS (§3). While the eye is this low it can be inside the snow or
  // inside the wood, and both are the same bug with different textures. Probed
  // and clamped HERE rather than in applyTo() because applyTo() is also called
  // from the boot and from a respawn, and the clamp has to be a fact about the
  // frame the solver produced and not about how many times somebody asked for a
  // camera matrix.
  const p = ctrl.position;
  let ex = p.x + tum.bx, ez = p.z + tum.bz, ey = p.y + tum.eye;
  tum.clampedGround = 0; tum.clampedStem = 0;
  const floor = TUM.EYE_FLOOR * u;
  const clampGround = () => {
    const g = collision.groundAt(ex, ez, ey + 2 * u);
    if (g === null) { tum.eyeGround = -1; return; }
    if (ey < g + floor) { tum.clampedGround += g + floor - ey; ey = g + floor; }
    tum.eyeGround = +(ey - g).toFixed(4);
  };
  clampGround();
  // ...and off the trunk. Pushed back along -v̂, which is the direction the body
  // arrived from and therefore the one direction guaranteed to be clear of it.
  tum.stemDist = -1;
  if (tum.solid && collision.stemHit && collision.stemAt) {
    const h = collision.stemHit(ex, ey, ez, TUM.STEM_PROBE * u, u);
    const s = h ? collision.stemAt(h.i) : null;
    if (s) {
      // scaled by `auth` for the same reason every other value here is: on the
      // frame of the hit the eye is still the riding eye, and a lens that jumped
      // 0.4 m backwards in one frame — before the kick-back had even started —
      // read as a cut rather than as an impact. At auth 0 the push is 0, and the
      // eye at riding height is well outside the bark anyway.
      const want = TUM.STEM_R * u * a;
      let d = Math.hypot(ex - s.x, ez - s.z);
      // march back along -v̂ until the axis is `want` away. Bounded on purpose:
      // a body that hit the trunk dead centre has no -v̂ that helps, and 24 steps
      // of 0.05 m is 1.2 m, wider than any trunk in the hash.
      const bxu = Math.sin(tum.yawVel) * 0.05 * u, bzu = Math.cos(tum.yawVel) * 0.05 * u;
      for (let k = 0; k < 24 && d < want; k++) {
        ex += bxu; ez += bzu;
        d = Math.hypot(ex - s.x, ez - s.z);
        tum.clampedStem += 0.05 * u;
      }
      tum.stemDist = +d.toFixed(4);
      // the push moved the eye over new ground, so the floor is re-asked. Both
      // clamps only ever raise the eye, so the second pass cannot undo the first.
      if (tum.clampedStem > 0) clampGround();
    }
  }
  tum.clampedGround = +tum.clampedGround.toFixed(4);
  tum.clampedStem = +tum.clampedStem.toFixed(4);
  tum.bx = ex - p.x; tum.bz = ez - p.z;
  tum.eye = ey - p.y;
}

// The tumble's test surface, in the shape `__speedlines` and `__sparks` already
// use. A pose is a matrix and a matrix cannot be interrogated from a gate, so
// the two numbers §5 actually asserts on — how high the head is and how high the
// eye is, frame by frame — are published rather than measured off a screenshot.
// Read-only: nothing here writes to the picture.
window.__tumble = {
  on: () => tum.on,
  n: () => tum.n,
  // the tumble's own clock and the controller's countdown it is derived from
  t: () => +tum.t.toFixed(4),
  wipeT: () => +ctrl.wipeT.toFixed(4),
  why: () => tum.why,
  solid: () => tum.solid,
  sign: () => tum.sign,
  auth: () => +tum.auth.toFixed(4),
  // WHERE THE HEAD IS, in metres above the body's own ground point. The head
  // mesh sits at 1.52 u on a rig that pivots at the feet, so this is that height
  // swung through the tumble's pitch and roll — the same arithmetic three.js is
  // about to do, rather than a second guess at it.
  headY: () => {
    const h = 1.52 * unitScale;
    const a = tum.on ? tum.auth : 0;
    const c = camRig.state.crouch;
    const pitch = 0.55 * c * (1 - a) + tum.pitch * a;
    const roll = tum.roll * a;
    // the same two writes updateVisuals makes, in the same order
    const base = -0.34 * unitScale * c;
    const y = base + (-tum.sink - base) * a;
    return +(h * Math.cos(pitch) * Math.cos(roll) + y).toFixed(4);
  },
  // ...and where the eye is, on the same datum
  eyeY: () => +(tum.on ? tum.eye : ctrl.T.eyeHeight).toFixed(4),
  // §3's two floors, measured on the frame that was just solved
  eyeToGround: () => +tum.eyeGround.toFixed(4),
  eyeToStem: () => +tum.stemDist.toFixed(4),
  stem: () => tum.eyeStem,
  clamped: () => ({ ground: tum.clampedGround, stem: tum.clampedStem }),
  // TOTAL displacement of the eye from the body, and the FOLD's own half of it.
  // They differ by whatever the trunk push-out added, and a gate asserting §2's
  // 0.15 m has to be able to see the fold on its own.
  back: () => +Math.hypot(tum.bx, tum.bz).toFixed(4),
  fold: () => +tum.back.toFixed(4),
  pose: () => ({
    t: +tum.t.toFixed(4), auth: +tum.auth.toFixed(4), pitch: +tum.pitch.toFixed(4),
    roll: +tum.roll.toFixed(4), spin: +tum.spin.toFixed(4), sink: +tum.sink.toFixed(4),
    camP: +tum.camP.toFixed(4), camR: +tum.camR.toFixed(4), camY: +tum.camY.toFixed(4),
  }),
  tuning: TUM,
  keyframes: TUM_KF,
  // THE HARNESS DOOR, in the shape `__sparks.step` and `__impact.step` opened.
  // It used to have work to do: the rig is posed off the requestAnimationFrame
  // line and `__player.stepFixed` does not run it, so the air-spin watcher had
  // to be pumped by hand once per stepped frame or it never saw the spin that
  // the landing was about to erase. specs/0028 §1 moved that sign onto the wipe
  // event itself, so there is nothing left to sample — the door stays open, and
  // reports the sign the rig latched, so 0015's harness reads the same shape.
  tick: () => tum.sign,
  spinSign: () => tum.sign,
  // ...and whether the rig would treat the NEXT wipeout as a new one. It latches
  // off `wipeT` coming up from zero, and it can only look on the frames it is
  // posed on — so a harness that teleports and wipes without an animation frame
  // in between hands it the same 2.0 twice and gets the previous accident's
  // answers. This is how a test waits for the rig to have seen the reset, rather
  // than sleeping and hoping there was a frame in there somewhere.
  armed: () => tumPrevWipe <= 0,
};

// ------------------------------------------------------------ camera rig
// Owns everything between the controller's pose and the camera: fp/tp modes,
// the speed-FOV, shake, landing kick, wipe tumble, and the chase follow.
let boost = null;        // boost.js, built below — the rig only reads its fov kick
const camRig = (() => {
  const FOV_BASE = 72, FOV_SPAN = 22;          // 72° at rest → ~94° flat out
  const BIKE_SWING = 0.45;                     // rad the chase sits off a bike's tail
  const KICK_LEN = 0.38;                       // s — landing dip + recover
  let mode = 'fp';
  let fov = FOV_BASE;
  let prevSp = 0, accelSm = 0;                 // smoothed dSpeed/dt — the G's
  let kickT = -1, kickAmp = 0;
  let t = 0;
  const state = { spN: 0, bob: 0, walkBob: 0, tipRise: 0, crouch: 0 };
  const shake = { x: 0, y: 0, z: 0, r: 0 };
  let dip = 0, wobP = 0, wobR = 0, wobY = 0;
  let bodyYaw = 0;                             // where the body points: the track when flying, else the look
  let preDip = 0;                              // preload compression — eye sinks with the charge
  const tpPos = new THREE.Vector3();
  let tpReady = false;

  function update(dt, ev) {
    t += dt;
    const sp = ctrl.speed();
    if (dt > 1e-4) {
      const a = (sp - prevSp) / dt;
      accelSm += (a - accelSm) * Math.min(1, 4 * dt);
    }
    prevSp = sp;
    // `geared` = wearing something; `riding` = that something is currently
    // driving you. They differ for footed gears: a glider pilot on the ground is
    // walking, and should get none of the ride dressing (fov, bank, rumble).
    const geared = ctrl.mode !== 'boots';
    const riding = geared && !ctrl.footedNow;
    const spN = state.spN = clamp01(sp / ctrl.S.maxSpeed);

    if (ev && ev.land > 3 * u && geared) {
      kickAmp = Math.min(0.30 * u, ev.land * 0.016);
      kickT = 0;
    }

    // ---- fov: speed opens it up, positive acceleration pushes it further
    let want = FOV_BASE;
    if (riding) {
      want += FOV_SPAN * Math.pow(spN, 1.35);
      want += Math.min(7, Math.max(0, accelSm / u)) * 0.7;
      if (ctrl.wipeT > 0) want -= 6;
    }
    // the rocket opens the lens in every gear, boots included — it is the one
    // thing on screen that says "this speed is not yours, it is the motor's"
    if (boost) want += boost.fovKick();
    fov += (want - fov) * Math.min(1, 5.5 * dt);

    // ---- landing kick: dip then recover on a half-sine
    dip = 0;
    if (kickT >= 0) {
      kickT += dt;
      if (kickT >= KICK_LEN) kickT = -1;
      else dip = kickAmp * Math.sin(Math.PI * kickT / KICK_LEN);
    }

    // ---- preload compression (bike): the eye sinks with the charge, and the
    // release reads as the pop because the dip springs back while you launch
    preDip += ((ctrl.crouch || 0) * 0.30 * u - preDip) * Math.min(1, 10 * dt);

    // ---- rumble: grows with speed², rougher on steeper ground
    shake.x = shake.y = shake.z = shake.r = 0;
    if (riding && ctrl.grounded && spN > 0.15) {
      const n = ctrl.groundNormal();
      const steep = Math.hypot(n.x, n.z);
      const amp = u * spN * spN * (0.006 + 0.028 * steep);
      shake.x = (Math.sin(t * 41.3) + Math.sin(t * 23.7)) * 0.5 * amp;
      shake.y = (Math.sin(t * 36.1) + Math.sin(t * 17.3)) * 0.5 * amp;
      shake.z = Math.sin(t * 29.9) * 0.4 * amp;
      shake.r = Math.sin(t * 27.1) * 0.0035 * spN * (0.4 + steep);
    }

    // ---- wipeout tumble (specs/0015). The 0.55 rad lens sine that used to live
    // here is gone: the eye now rides the SAME keyframes the body does, because a
    // wobble the third-person body knows nothing about is exactly how the two
    // views came to disagree about whether anything had happened at all.
    tumbleStep();
    wobP = tum.camP; wobR = tum.camR; wobY = tum.camY;

    // ---- shared animation state for the visuals
    state.bob += dt * (2 + 9 * spN);
    state.walkBob += dt * sp / u * 2.2;
    state.tipRise += ((ctrl.grounded ? 0 : 0.3) - state.tipRise) * Math.min(1, 6 * dt);
    const wantCrouch = riding ? (ctrl.grounded ? Math.min(1, 0.15 + 0.6 * spN + 0.7 * (ctrl.crouch || 0)) : 0.9) : 0;
    state.crouch += (wantCrouch - state.crouch) * Math.min(1, 5 * dt);

    // ---- chase follow (kept warm even in fp so C never snaps from stale state)
    //
    // Flying, three things change. The camera sits BEHIND THE TRACK rather than
    // behind the look, so a hard turn does not swing it off the tail. It backs
    // off and comes down near the wing's own plane. And it swings ~29° off the
    // axis, which is the whole trick: from dead astern a flat wing is edge-on
    // and a prone body is a rectangle, and you can read neither. Off to one
    // side both the planform and the length of the pilot come back.
    const pos = ctrl.position, eye = ctrl.T.eyeHeight;
    const vel = ctrl.velocity;
    const flying = ctrl.mode === 'glider' && !ctrl.grounded;
    bodyYaw = flying && Math.hypot(vel.x, vel.z) > 0.5 * u
      ? Math.atan2(-vel.x, -vel.z) : ctrl.yaw;
    // ...and the bike gets a smaller dose of the same medicine. From dead
    // astern a bike is a vertical line behind a rider: the frame, which is the
    // only thing that distinguishes one model in the rack from another, is
    // entirely hidden by the rider's back and legs (measured — see the roster
    // notes). BIKE_SWING rad off-axis brings the down tube, the front triangle
    // and the fork back into view without moving the aim point, which still
    // tracks the body's own axis in applyTo(). Set it to 0 for the old dead-
    // astern chase; nothing else depends on it.
    // The two vehicles want the same treatment for the same reason — a sled is
    // a plank and a snowmobile is a box, and dead astern both are hidden behind
    // the rider — so they take the bike's swing. Nothing else changes: skis,
    // boots and the wing are on their original zero.
    const RIDE_SWING = ctrl.mode === 'bike' || ctrl.mode === 'sled' || ctrl.mode === 'snowmobile';
    // specs/0015 — and a tumble swings it further still, onto the side the body
    // is being thrown, so the lens is the outside of the spin
    const camYaw = bodyYaw + (flying ? 0.58 : (RIDE_SWING ? BIKE_SWING : 0))
      + TUM.CHASE_SWING * tum.auth * tum.sign;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    // specs/0015 — the chase steps in and comes down through a tumble. From the
    // ordinary 4.3 m / 2.1 m the fold is a small figure at the bottom of a big
    // hillside; a metre closer and three quarters of a metre lower it is a body
    // hitting a tree, which is what the frame is about.
    const dist = (flying ? 4.6 + 2.0 * spN : 4.3 + 2.2 * spN) * u - TUM.CHASE_IN * u * tum.auth;
    const height = (flying ? 2.05 + 0.50 * spN : 2.1 + 0.6 * spN) * u
      - Math.sin(ctrl.pitch) * (flying ? 1.7 : 2.4) * u - TUM.CHASE_DOWN * u * tum.auth;
    // ...and it aims at the HEAD rather than at a standing rider's chest, so the
    // subject does not slide out of the bottom of the frame as the body goes down
    const aimY = eye * (flying ? 0.78 : 0.9);
    const hx = pos.x, hy = pos.y + aimY + (tum.eye * 0.85 - aimY) * tum.auth, hz = pos.z;
    let dx = -fx * dist, dy = height, dz = -fz * dist;
    const len = Math.hypot(dx, dy, dz);
    // keep the chase camera out of the hillside
    const hit = collision.raycast(hx, hy, hz, dx / len, dy / len, dz / len, len + 0.4 * u);
    const k = (hit ? Math.max(0.6 * u, hit.dist - 0.5 * u) : len) / len;
    const wx = hx + dx * k, wy = hy + dy * k, wz = hz + dz * k;
    if (!tpReady) { tpPos.set(wx, wy, wz); tpReady = true; }
    else {
      const s = 1 - Math.exp(-9 * dt);
      tpPos.x += (wx - tpPos.x) * s;
      tpPos.y += (wy - tpPos.y) * s;
      tpPos.z += (wz - tpPos.z) * s;
    }
  }

  function applyTo(cam) {
    const pos = ctrl.position, eye = ctrl.T.eyeHeight;
    const riding = ctrl.mode !== 'boots' && !ctrl.footedNow;
    // skis/bike report an edge load and the camera exaggerates it; the glider
    // reports an actual bank angle (plus any barrel roll), so it goes through 1:1
    const leanMul = ctrl.mode === 'glider' ? 1 : 1.35;
    if (mode === 'fp') {
      // specs/0015 — the eye is ON the body, so through a tumble it takes the
      // body's height and the fold's backward displacement, both already probed
      // and clamped by tumbleStep(). `wobY` is the spin: a wipeout turns you, and
      // first person that did not turn with it was the tell that nothing was
      // really happening.
      // `tum.on` is the guard and not a nicety: applyTo() is also called at boot
      // and from a respawn, before update() has ever solved a frame.
      cam.position.set(
        pos.x + tum.bx + shake.x,
        pos.y + (tum.on ? tum.eye : eye) - dip - preDip + shake.y,
        pos.z + tum.bz + shake.z,
      );
      cam.rotation.order = 'YXZ';
      cam.rotation.set(
        ctrl.pitch - (dip / u) * 0.5 + wobP,
        ctrl.yaw + wobY,
        (riding ? ctrl.lean * leanMul : 0) + shake.r + wobR,
      );
    } else {
      const flying = ctrl.mode === 'glider' && !ctrl.grounded;
      // aim at the rig, along the body's own axis (not the swung camera's)
      const fx = -Math.sin(bodyYaw), fz = -Math.cos(bodyYaw);
      cam.position.set(tpPos.x, tpPos.y - dip * 0.6, tpPos.z);
      cam.up.set(0, 1, 0);
      // specs/0015 — through a tumble the aim point rides down with the head, or
      // the body slides out of the bottom of the frame exactly when it becomes
      // the subject. `wobR` is now the tumble's own roll, so the chase gets half
      // of it: enough to feel the body go over, not enough to roll the hillside.
      const aim = eye * 0.8;
      cam.lookAt(
        pos.x + fx * 1.4 * u,
        pos.y + (flying ? 1.30 * u : aim + (tum.eye * 0.8 - aim) * tum.auth),
        pos.z + fz * 1.4 * u,
      );
      cam.rotateZ((riding ? ctrl.lean * (ctrl.mode === 'glider' ? 0.8 : 0.55) : 0) + wobR * 0.5);
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  return {
    update, applyTo, state,
    get mode() { return mode; },
    get fov() { return fov; },
    toggle() { mode = mode === 'fp' ? 'tp' : 'fp'; return mode; },
    setMode(m) { mode = m === 'tp' ? 'tp' : 'fp'; return mode; },
  };
})();

// visuals: posed every frame AFTER the camera, so the fp skis track it exactly
function updateVisuals() {
  const ski = ctrl.mode === 'skis';
  const glide = ctrl.mode === 'glider';
  const rock = ctrl.mode === 'rocket';
  const onSled = ctrl.mode === 'sled';
  const onSnow = ctrl.mode === 'snowmobile';
  const riding = ctrl.mode !== 'boots' && !ctrl.footedNow;
  const tp = camRig.mode === 'tp';
  const st = camRig.state;

  // ---- the two vehicles, first person. Mounted on the camera like the fp skis
  // and the fp bike, and banked a touch past the head so the thing you are
  // sitting on rolls into a turn slightly ahead of the view.
  fpSled.visible = !tp && onSled;
  if (fpSled.visible) {
    fpSled.position.copy(camera.position);
    fpSled.quaternion.copy(camera.quaternion);
    fpSled.rotateZ(ctrl.lean * 0.30 + sledState().deckRoll * 0.35);
    // the deck chatters on the snow with speed and goes quiet in the air
    const amp = ctrl.grounded ? 0.012 * u * st.spN : 0.003 * u;
    fpSled.position.y += Math.sin(st.bob * 1.6) * amp;
  }

  fpSnow.visible = !tp && onSnow;
  if (fpSnow.visible) {
    fpSnow.position.copy(camera.position);
    fpSnow.quaternion.copy(camera.quaternion);
    fpSnow.rotateZ(ctrl.lean * 0.40);
    const s = snowmobileState();
    // engine feel: the bars buzz with the throttle, and the whole machine sinks
    // on the suspension when it lands
    const amp = ctrl.grounded ? (0.004 + 0.010 * st.spN + 0.004 * s.throttle) * u : 0.002 * u;
    fpSnow.position.y += Math.sin(st.bob * 2.1) * amp - 0.10 * u * s.squash;
  }

  // ---- the rocket pack. Unlike the wing it is worn on the ground too: you walk
  // around wearing a motor, which is the whole reason it reads as a vehicle you
  // got into rather than a button you pressed.
  fpPack.group.visible = !tp && rock;
  if (fpPack.group.visible) {
    fpPack.group.position.copy(camera.position);
    fpPack.group.quaternion.copy(camera.quaternion);
    const g = 0.10 + 0.75 * boost.throttle();
    for (const q of fpPack.glows) q.material.opacity = g;
  }

  // ---- the glider. Out only while you are actually flying, so unfurling it is
  // the moment your feet leave the ground.
  const glideAir = glide && !ctrl.grounded;
  fpGlide.visible = !tp && glideAir;
  if (glideAir) {
    const g = gliderState();
    // the fabric flexes under load — cl is the honest measure of how hard the
    // ribs are being pulled
    const flex = clamp01((g.cl - 0.4) / 2.0) * 0.30;
    for (const w of [fpWing, tpWing]) { w.L.rotation.z = -flex; w.R.rotation.z = flex; }
    const aoa = clamp01((g.alpha + 0.4) / 0.82) * 0.5 - 0.25;
    fpWing.group.rotation.x = -0.12 + aoa * 0.6;
    // Third person rides the FLIGHT PATH, not the look: the whole rig pitches
    // with gamma, so a dive shows a nose-down pilot and a zoom shows his back.
    // The wing then takes the angle of attack on top of that, and the body lags
    // it slightly — the pilot swings a beat behind the wing he is hanging from.
    tpGlide.rotation.x = clamp01((g.gamma + 1.2) / 2.4) * 1.8 - 0.9;
    tpWing.group.rotation.x = aoa * 0.5;
    tpPilot.rotation.x = aoa * 0.25;
  }
  if (fpGlide.visible) {
    fpGlide.position.copy(camera.position);
    fpGlide.quaternion.copy(camera.quaternion);
  }

  // ---- the bike, first person. Mounted on the camera like the fp skis, and
  // leaned a touch past the head so the bars roll into a turn ahead of the view.
  // The preload crouch drops it with you — the eye already sinks (camRig's
  // preDip), and a bike that stayed put while you compressed would float.
  fpBike.visible = !tp && ctrl.mode === 'bike';
  if (fpBike.visible) {
    fpBike.position.copy(camera.position);
    fpBike.quaternion.copy(camera.quaternion);
    fpBike.rotateZ(ctrl.lean * 0.45);
    const amp = ctrl.grounded ? 0.010 * u * st.spN : 0.003 * u;
    fpBikeInner.position.y = fpBikeSeatY + Math.sin(st.bob) * amp - 0.10 * u * ctrl.crouch;
  }

  fpRig.visible = !tp && ski;
  if (fpRig.visible) {
    fpRig.position.copy(camera.position);
    fpRig.quaternion.copy(camera.quaternion);
    fpRig.rotateZ(ctrl.lean * 0.35);           // skis bank a touch past the head
    const amp = ctrl.grounded ? 0.014 * u * st.spN : 0.005 * u;
    fpSkiL.position.y = -0.88 * u + Math.sin(st.bob) * amp;
    fpSkiR.position.y = -0.88 * u + Math.sin(st.bob + 1.7) * amp;
    fpSkiL.rotation.x = st.tipRise;            // tips rise off a jump
    fpSkiR.rotation.x = st.tipRise * 0.92;
    rollSkiRigs([fpSkiL, fpSkiR], 0.9);        // ...and go up on edge in a turn
    // ...and pitch about the blended trick axis while a flip is being thrown.
    // The spin half is already on screen — spinTorque writes yaw — so only the
    // flip needs adding, and it goes on the rig rather than the camera: pitching
    // the lens through a Double Rodeo is a way to make somebody put the mouse down.
    const tpose = tricks.trickPose();
    if (tpose && tpose.flip) fpRig.rotateX(-tpose.flip);
    // specs/0015 — ...and they come off the rails in a tumble, exactly as the
    // third-person pair do. The fp skis hang off the CAMERA, so left alone they
    // are the one thing on screen that carries on riding perfectly while the eye
    // is face down in the snow — which was visible in the first strips as two
    // tidy red tips pinned to the bottom of every frame of a crash.
    if (tum.on) {
      const k = tum.ski * tum.auth;
      // No `else` and nothing to restore: every one of these four properties is
      // written unconditionally a few lines above (position.y and rotation.x
      // here, rotation.y by rollSkiRigs, which re-writes it whenever either the
      // carve splay or the current value is non-zero). The frame after a tumble
      // ends is the frame the ordinary pose comes back on its own.
      // Half the drop the first pass used. At 0.34 m, with the lens already 24
      // deg nose-down, both skis left the bottom of the frame entirely and first
      // person during a wipeout became an empty white field — "your skis are
      // somewhere up there at a stupid angle" is a better read than "you appear
      // to have no legs".
      fpSkiL.rotation.y -= TUM.SPLAY * 0.75 * k;
      fpSkiR.rotation.y += TUM.SPLAY * 0.75 * k;
      fpSkiL.rotation.x += 0.55 * k;
      fpSkiR.rotation.x += 0.40 * k;
      fpSkiL.position.y -= 0.17 * u * k;
      fpSkiR.position.y -= 0.10 * u * k;
    }
  }

  model.visible = tp;
  if (tp) {
    const pos = ctrl.position;
    const v = ctrl.velocity;
    model.position.set(pos.x, pos.y, pos.z);
    // Flying, the body points down the TRACK, not down the look — in a hard
    // turn the two differ by tens of degrees and it is the track the wing is
    // actually flying. Everywhere else the look is the body, exactly as before.
    // specs/0015 — and through a tumble the body swings onto the VELOCITY vector
    // (§2: "the body lies along the velocity vector") and then takes the spin on
    // top. This alignment is on the body and NOT on the lens: where the mass is
    // lying is a fact about the body, whereas first person is somebody's head,
    // and hijacking a player's heading to a velocity he is no longer steering is
    // how a wipeout becomes a motion-sickness feature. Both views take the spin.
    const yawRide = glideAir && Math.hypot(v.x, v.z) > 0.5 * u
      ? Math.atan2(-v.x, -v.z) : ctrl.yaw;
    model.rotation.y = tum.on
      ? yawRide + angDiff(tum.yawVel, yawRide) * tum.align * tum.auth + tum.spin * tum.auth
      : yawRide;
    model.rotation.z = riding ? ctrl.lean * (glide ? 1 : 1.25) : 0;
    // the standing body steps aside for the prone one, and vice versa — and now
    // also for the seated one: the bike rig brings its own rider, posed to ITS
    // grips and pedals, so the skier body would only ever be a second person
    // standing inside the frame.
    const onBike = ctrl.mode === 'bike';
    tpGlide.visible = glideAir;
    tpBike.visible = onBike;
    tpSled.visible = onSled;
    tpSnow.visible = onSnow;
    mBody.visible = !glideAir && !onBike && !onSled && !onSnow;
    tpPack.visible = rock;
    if (onSled) {
      // the deck rocks onto its inside runner (sled.js owns the number), and a
      // wipeout cartwheels the whole thing — the controller's 2.0 s of tumble,
      // spent on the sled rather than only on the lens
      rollSledRig(tpSled);
      const w = ctrl.wipeT / TUM_LEN;   // 0030: the span is a constant, not a literal
      tpSled.rotation.x = w * w * Math.sin(st.bob * 3.1) * 1.9;
      tpSled.rotation.y = w * w * Math.sin(st.bob * 2.3) * 1.4;
      tpSled.position.y = w * w * 0.35 * u;
    }
    if (onSnow) {
      // front skis follow the bars and the chassis squats on the suspension —
      // both from snowmobile.js, so the pose cannot disagree with the physics
      poseSnowmobileRig(tpSnow);
      const w = ctrl.wipeT / TUM_LEN;   // 0030: the span is a constant, not a literal
      tpSnow.rotation.z = w * w * Math.sin(st.bob * 2.7) * 1.1;
    }
    if (onBike) {
      // the whole bike-and-rider compresses into the preload and squats under
      // the landing kick, which is the only animation a rigid rig needs
      tpBike.position.y = -0.13 * u * st.crouch;
      tpBike.rotation.x = 0.10 * st.crouch;
    }
    const c = riding && !glide ? st.crouch : 0;
    let bobY = 0;
    if (!riding && ctrl.grounded && ctrl.speed() > 0.5 * u) bobY = Math.sin(st.walkBob) * 0.03 * u;
    mBody.position.y = -0.34 * u * c + bobY;
    mBody.rotation.x = 0.55 * c;               // tuck forward with speed / in air
    mArmL.rotation.x = c * 0.9;                // arms sweep back into the tuck
    mArmR.rotation.x = c * 0.9;
    mArmL.rotation.z = 0.22; mArmR.rotation.z = -0.22;
    mSkiL.visible = mSkiR.visible = ski;       // (bike riders get no skis; the
    if (ski) {                                 // bike model is the bike agent's)
      mSkiL.rotation.x = st.tipRise * 0.8;
      mSkiR.rotation.x = st.tipRise * 0.72;
      mSkiL.rotation.y = 0; mSkiR.rotation.y = 0;
      mSkiL.position.y = 0.02 * u; mSkiR.position.y = 0.02 * u;
      rollSkiRigs([mSkiL, mSkiR]);             // the edges, from ski.js
    }
    // the legs and hips follow the edges a little — the body is one piece here,
    // so a third of the edge angle is as much lower body as this rig can spend
    mBody.rotation.z = ski ? skiState().roll * 0.30 : 0;

    // ---- specs/0015: THE TUMBLE, written OVER the riding pose above.
    //
    // Every value is `mix(riding, tumble, tum.auth)`, and `auth` is 0 at both
    // ends of the 2.0 s, so the body enters and leaves the animation on exactly
    // the pose it would have been holding anyway. That is the whole reason there
    // are no pops here: nothing is switched, everything is blended, and the
    // blend's own weight is what starts and finishes.
    //
    // The rig pivots at the FEET (mBody's origin sits on the snow), so pitching
    // it 1.32 rad is a body falling forward over its own tips and the head
    // arrives at ~0.4 m, which is where a head on snow is. The skis are posed by
    // hand rather than reparented into an `mFall` group: they are children of
    // `model` and inventory.js clones this rig to dress it, so a parent that
    // exists for 2.0 s a run is a parent the locker would have to know about.
    // Their binding IS the pivot, so pitching them with the body keeps them at
    // the feet for free — all that is left is the fan and the lift.
    if (tum.on && mBody.visible) {
      const a = tum.auth;
      mBody.rotation.x = mBody.rotation.x + (tum.pitch - mBody.rotation.x) * a;
      mBody.rotation.z = mBody.rotation.z + (tum.roll - mBody.rotation.z) * a;
      // ABSOLUTE, not `-= sink`: the riding height is `-0.34 u * crouch`, and
      // crouch keeps easing all the way through a tumble because the scrub took
      // the speed that was holding it up. A body whose hips rose 0.1 m over the
      // 2.0 s it spent lying in the snow is a body floating off it.
      mBody.position.y += (-tum.sink - mBody.position.y) * a;
      // arms: up and forward on the hit, then splayed out through the slide
      const ax = tum.arm * a, az = Math.abs(tum.arm) * 0.55 * a;
      mArmL.rotation.x += ax; mArmR.rotation.x += ax;
      mArmL.rotation.z += az; mArmR.rotation.z -= az;
      if (ski) {
        const k = tum.ski * a;
        // HALF the body's pitch, not all of it: a ski carries the body's rotation
        // about its own binding, and at the full 1.32 rad both of them stood
        // straight up over the rider like a salute. Half lays them back along the
        // slide, which is where skis go when a body lands on them.
        mSkiL.rotation.x += tum.pitch * a * 0.52;
        mSkiR.rotation.x += tum.pitch * a * 0.44;
        mSkiL.rotation.y = -TUM.SPLAY * k;     // fanned: they are not on rails
        mSkiR.rotation.y = TUM.SPLAY * k;
        mSkiL.position.y += TUM.LIFT * u * k;  // ...and off the snow, because
        mSkiR.position.y += TUM.LIFT * u * k * 0.72;   // they are on a body
      }
    }
    // third person sees the whole flip, which is the point of third person
    const tposeTp = ski ? tricks.trickPose() : null;
    model.rotation.x = tposeTp ? -tposeTp.flip : 0;
  }
}

camRig.applyTo(camera);

// -------------------------------------------------------------------- hud
const hud = createHud({
  poi: cfg.poi, run: cfg.run, adapter: world.adapter,
  onResume: () => enter(),
  onRespawn: () => { ctrl.respawn(); camRig.applyTo(camera); },
});
// specs/0003 — `brand`, with the bench's own `label` (the name the LAB lists a
// world/mode under) winning when it is set. The public build never sets `label`.
document.title = LABEL
  ? 'POI LAB / ' + LABEL
  : pickBrand({
    lab: 'WORLD · ' + cfg.run,
    'RED DOG': 'Red Dog Chair — Palisades Tahoe',
    SIBERIA: 'Siberia Express — Palisades Tahoe',
  });

// ------------------------------------------------------------- the ski rack
// One ski model is one set of overrides on SKI_TUNING plus one topsheet. Both
// are swapped here and nowhere else: the tuning object the controller's gear
// registry holds is written IN PLACE (replacing it would not take), and the
// four ski meshes — two on the camera, two on the third-person body — are
// restyled from the same model. `lab-standard` overrides nothing, so a session
// that never opens the locker is numerically the session that always was.
const liveSkis = [fpSkiL, fpSkiR, mSkiL, mSkiR];
function applySki(id, { remember = true, flash = false } = {}) {
  skiId = getSkiModel(id).id;
  Object.assign(ctrl.gearTuning('skis'), skiTuningFor(skiId, unitScale));
  for (const s of liveSkis) styleSkiRig(THREE, s, skiId);
  if (remember) rememberSkiId(skiId);
  if (flash) hud.flash('ski · ' + getSkiModel(skiId).name);
  return skiId;
}
applySki(skiId, { remember: false });

// ------------------------------------------------------------ the bike rack
// Exactly the ski rack's shape: the gear registry's tuning object is written IN
// PLACE, and both bike rigs — the one on the camera and the one under the
// third-person rider — are rebuilt from the same model. `lab-standard` overrides
// nothing, so a session that never opens the locker pedals to 11.0, pops to the
// same numbers and clears the same jumps it always did.
function applyBike(id, { remember = true, flash = false } = {}) {
  bikeId = getBikeModel(id).id;
  // specs/0003 — on the ski set there is no bike GEAR, so there is no tuning
  // object to write into and an unguarded Object.assign throws at module scope,
  // before the first frame. The rigs below are still styled either way: main.js
  // builds them whether or not anything can ride them, and leaving them intact
  // costs nothing.
  Object.assign(ctrl.gearTuning('bike') || {}, bikeTuningFor(bikeId, unitScale));
  styleBikeRig(THREE, tpBike, bikeId, { rider: 'tp' });
  styleBikeRig(THREE, fpBikeInner, bikeId, { rider: 'fp' });
  seatFpBike(bikeId);
  if (remember) rememberBikeId(bikeId);
  if (flash) hud.flash('bike · ' + getBikeModel(bikeId).name);
  return bikeId;
}
applyBike(bikeId, { remember: false });

// -------------------------------------------------- the sled & snowmobile racks
// Same shape again, and for the same reason: the gear registry's tuning object
// is written IN PLACE (replacing it would not take) and both rigs are restyled
// from the same model. Each rack's house model overrides nothing, so the numbers
// documented in sled.js / snowmobile.js are the numbers that run.
function applySled(id, { remember = true, flash = false } = {}) {
  sledId = getSledModel(id).id;
  Object.assign(ctrl.gearTuning('sled'), sledTuningFor(sledId, unitScale));
  styleSledRig(THREE, tpSled, sledId);
  styleSledRig(THREE, fpSled, sledId);       // the one on the camera, too
  if (remember) rememberSledId(sledId);
  if (flash) hud.flash('sled · ' + getSledModel(sledId).name);
  return sledId;
}
applySled(sledId, { remember: false });

function applySnowmobile(id, { remember = true, flash = false } = {}) {
  snowmobileId = getSnowmobileModel(id).id;
  Object.assign(ctrl.gearTuning('snowmobile'), snowmobileTuningFor(snowmobileId, unitScale));
  styleSnowmobileRig(THREE, tpSnow, snowmobileId);
  styleSnowmobileRig(THREE, fpSnow, snowmobileId);
  if (remember) rememberSnowmobileId(snowmobileId);
  if (flash) hud.flash('snowmobile · ' + getSnowmobileModel(snowmobileId).name);
  return snowmobileId;
}
applySnowmobile(snowmobileId, { remember: false });

// ---------------------------------------------------------- the glider rack
// One equipment type, two flight models, and the swap is a gear swap: the wing
// and the pack are separate physics modules (glider.js / rocket.js), so picking
// one is `setMode` on the gear that flies it. Everything the player sees still
// says "glider" — this is the only place the difference exists.
function applyGlider(id, { remember = true, flash = false, equip = false } = {}) {
  gliderId = getGliderModel(id).id;
  const g = getGliderModel(gliderId).gear;
  // tap-E has to hand back the model you chose, not the one the world booted with
  if (pubGear(ctrl.defaultGear) === 'glider') ctrl.setDefaultGear(g);
  if (equip || pubGear(ctrl.mode) === 'glider') ctrl.setMode(g);
  if (remember) rememberGliderId(gliderId);
  if (flash) hud.flash('glider · ' + getGliderModel(gliderId).name);
  return gliderId;
}

// ------------------------------------------------------------- the locker
// I. Full-screen equipment screen: a tab per gear type, a grid of models, and a
// live preview of the body wearing the highlighted one. It equips through this
// callback and touches nothing else — see inventory.js.
const inv = createInventory({
  THREE, model, unitScale, ctrl, initial: { skis: skiId, glider: gliderId, bike: bikeId },
  onEquip: ({ gear, kind, id, name }) => {
    if (kind === 'ski') applySki(id);
    if (kind === 'bike') applyBike(id);
    // the glider tab's two cards are two gears; applyGlider owns that mapping
    if (kind === 'glider') applyGlider(id, { equip: true });
    else if (ctrl.mode !== gear) ctrl.setMode(gear);
    hud.flash('equipped · ' + name);
  },
});
inv.noteEquipped('skis', skiId);
inv.noteEquipped('glider', gliderId);
inv.noteEquipped('bike', bikeId);

// ------------------------------------------------------------- fast travel
// R used to be "go back to the very first frame of the session", which on a
// 900 m lift-served mountain means the run you just rode up for is 900 m below
// you. It is now "go back to WHERE YOU LAST ARRIVED": the last lift unload, the
// last T fast-travel, the last teleport. Before any of those it is the world
// spawn, exactly as it always was.
//
// The seam is ctrl.teleport itself rather than a call at each site, because
// every fast travel in the player is already a teleport and nothing else is:
// lift.js's unload, markers.js's T, and the __player.teleport() test hook. The
// controller's own respawn() does NOT go through here, so R can never move the
// mark it returns to.
const fastTravel = { at: null, yaw: 0, source: 'spawn', n: 0 };
{
  const rawTeleport = ctrl.teleport;
  ctrl.teleport = (p, y) => {
    const out = rawTeleport(p, y);
    fastTravel.at = { x: p.x, y: p.y, z: p.z };
    fastTravel.yaw = y === undefined ? ctrl.yaw : y;
    fastTravel.source = 'teleport';        // a caller may name itself after
    fastTravel.n++;
    ctrl.setHome(p, fastTravel.yaw, 0);
    return out;
  };
}

// ---------------------------------------------------------------- chairlifts
// Worlds that declare `lifts` get an F prompt at each base terminal; F puts you
// at the top of that line. Worlds that do not declare any get an empty list and
// nothing below ever fires. See harness/PLAYABLE.md.
//
// `scene` and `runs` are what the three QoL items in lift.js need and nothing
// else: the boarding decal is a mesh, and the derived unload spawn is aimed
// down the run polyline the world declared. Both are read-only uses.
const lifts = createLifts({
  THREE, lifts: world.lifts, collision, ctrl, hud, unitScale,
  scene: world.scene, runs: world.runs,
  onRide: (u, L) => { fastTravel.source = 'lift · ' + (L && L.name ? L.name : ''); },
});
hud.setLiftKey(lifts.count() > 0);

// ------------------------------------------------------------------- boost
// The rocket's motor. It belongs to ONE gear: `gear: 'rocket'` is the whole
// gate, and with anything else equipped holding SPACE does nothing at all. The gear itself
// (walking, coasting, landing) is rocket.js, in the controller's registry. See
// boost.js; the frame loop steps it just before ctrl.update.
// ...and one machine you can bolt it to: the snowmobile fires the same tank off
// SHIFT (or hold-SPACE), which is why SHIFT is no longer the sled's brake. See `riders`
// in boost.js — no other gear is listed, and none of them can spend it.
boost = createBoost({
  THREE, scene: world.scene, ctrl, camera, unitScale, gear: 'rocket',
  riders: { snowmobile: { keys: ['jumpHeld', 'sprint'], mode: 'sled' } },
});
window.__playBoost = boost;      // fx.js reads burning() for the speed lines

// ------------------------------------------------------------------ dev mode
// F8 (or ?dev=1) swaps the player for a noclip fly camera + reference compare;
// everything it needs lives in dev.js. See harness/TUNING.md.
const dev = createDev({
  THREE, camera, canvas: world.renderer.domElement, cfg, hud, unitScale,
  renderNow: () => world.renderer.render(world.scene, camera),
  // specs/0004 — the annotator raycasts its strokes back into the world with
  // the player's OWN grid, and reads hits back out in the frame the scene was
  // authored in. Both are stripped with dev.js in the public build.
  collision, upAxis,
});
function applyCamera() {
  if (dev.active()) dev.applyTo(camera); else camRig.applyTo(camera);
}
const typingIn = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// ------------------------------------------------------------------ input
window.__playFX.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud });
// specs/0006 — the jump-power aura hangs its flame ribbon ON the ski meshes, so
// it inherits the bob, the edge roll, the tip rise, the splay and BOTH rigs'
// visibility for free rather than re-deriving any of it. This is the whole hook:
// fx.js adds one child to each of the four rigs and never touches them again.
// `skiId` is passed as a getter because the locker can change it mid-run, and
// `camMode` because §2.3 gives the two cameras two presentations of the same
// power — the flame on the skis in first person, the fire trail off the rider
// in third — and this rig is the only thing that knows which one you are in.
window.__playFX.skis({ rigs: liveSkis, skiId: () => skiId, camMode: () => camRig.mode });
window.__playAudio.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud });
window.__playSurprise.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud, collision, poi: cfg.poi, run: cfg.run });
window.__playSnowball.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud, collision, poi: cfg.poi, run: cfg.run });
window.__playMarkers.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud, collision, poi: cfg.poi, run: cfg.run, markers: world.markers, upAxis });

// ---- tricks, combos and the personal leaderboard (tricks.js, spec 0002 §3/§4).
//
// WHICH TRAIL a combo happened on is the leaderboard's whole ask, and `play/` has
// no trail concept of its own — but markers.js already keeps a nearest-marker
// readout for its signs, and a run marker IS the trail name. So we read its
// stats (read-only; markers.js is not touched) and fall back to the run id, which
// is the only other scene identifier there is.
const trailName = () => {
  try {
    const n = window.__playMarkers.stats().nearest;
    if (n && n.name && n.d < 260 * unitScale) return n.name;
  } catch { /* markers may be inert on a world with none */ }
  return null;
};
tricks.init({ ctrl, hud, poi: cfg.poi, run: cfg.run, skiId: () => skiId, trail: trailName });

// ---- the guided run (guide.js). ONE flag, and it is off unless something says
// otherwise: `?guide=1` on the bench, `__PLAY.guide === true` for a build that
// ships the tutorial as its default (the standalone exporter sets it there).
// `?guide=0` turns it off again, which is what makes the query form usable as an
// override rather than only as a switch.
//
// The module is DYNAMICALLY imported, so a default boot does not fetch it, does
// not run it and cannot be changed by it. That is the whole isolation story —
// there is no second code path through the player.
const guideQ = (cfg.qs && cfg.qs.get('guide')) ?? null;
// `introFlag` is the PRODUCT flag: the intro card (which carries the OpenStreetMap
// / ODbL credit) and the idle nudge. `guideFlag` is the TUTORIAL, and it is the
// only one a named spawn switches off.
const introFlag = guideQ != null ? (guideQ !== '0' && guideQ !== 'off' && guideQ !== 'false')
                                 : cfg.guide === true;
// ---- ...AND THE NAMED-SPAWN EXCEPTION. The guided run is built around ONE
// place: it stands you at the Red Dog top, walks you down Champs Elysees and
// puts the slalom on the pitch below it. Boot it from /kt22 — 1.2 km west and
// 170 m higher — and every one of its anchors is somewhere you are not, which
// is a broken tutorial rather than a relocated one. So a shareable waypoint URL
// opens the FREE-SKI open world instead: initRace() below, the race circles
// still on the snow, nothing anchored to a hill you did not land on.
//
// `?guide=1` still wins — an explicit flag is an explicit flag, and it is the
// escape hatch for anyone who wants to see what the tutorial does from
// somewhere else. The intro card is NOT affected: it is the credit screen as
// much as it is the tutorial's first beat, and it shows on every visit.
const guideFlag = introFlag && !(namedSpawn && guideQ == null);
//
// ...WITH ONE EXCEPTION, and it is the reason this import is no longer inside
// the `if`. The open-world race courses (guide.js's RACE_COURSES — an orange
// start circle on the snow, F to run the gates) have to exist when the tutorial
// is OFF: on the bench flagship, and in the shipped build the moment the player
// finishes or skips the tutorial. Those courses are the guided run's own
// geometry — the resampled run polyline, the gate rhythm, the dye corridor, the
// scoring machine — so the alternative to importing this module was a second
// copy of all of it in a race module of its own, and two copies of the course
// maths is how "the slalom" quietly becomes two different hills. So guide.js is
// fetched every boot and offers two entry points: init() builds the tutorial,
// initRace() builds nothing but the start circles until somebody skis into one.
const guideMod = await (async () => {
  try { return await import('./guide.js'); } catch (e) { console.warn('[play] guide module failed to load', e); return null; }
})();
const guideCtx = () => ({
  THREE, scene: world.scene, camera, ctrl, hud, collision,
  groundAt: (x, z) => collision.groundAt(x, z, collision.bounds.maxY + 5 * unitScale),
  enter: () => enter(),
  unitScale, upAxis, poi: cfg.poi, run: cfg.run,
  sceneBase: cfg.sceneBase || null,
  runs: world.runs || [],
  lifts: lifts.list(),
  liftRadius: lifts.radius(),
  rides: () => lifts.rides(),
  trickState: () => tricks.state(),
  skiState: () => skiState(),
  skiId: () => skiId,
  debug: !!(cfg.qs && cfg.qs.get('guide') === 'debug'),
});
let guideApi = null;
if (guideMod) {
  try {
    guideApi = guideFlag ? await guideMod.init(guideCtx()) : await guideMod.initRace(guideCtx());
    window.__guide = guideApi;
  } catch (e) {
    console.warn('[play] guide failed to start', e);
    guideApi = null;
  }
}

const canvas = world.renderer.domElement;
canvas.style.position = 'fixed';
canvas.style.left = '0'; canvas.style.top = '0';

// The arrows used to be plain W/S duplicates. They are now their own axis:
// GROUNDED, ski.js treats flipFwd/flipBack as exact aliases of forward/back, so
// arrow-up still skates and arrow-down still plows and nothing on the snow
// changed — but in the air they are the flip handles, and ← → the spin handles,
// and the two together are the trick table (tricks.js, spec 0002 §3).
//
// SHIFT DOES NOTHING ON SKIS. It stopped being the second brake when S became
// the dedicated stop (§2.1), and the tricks wave briefly gave it the
// tuck/absorb job (§1.8) — that is now withdrawn: a skier holding SHIFT gets
// exactly the run they would have got without it, to the last float. The key is
// unchanged for every other gear, which is why it still sets `sprint` (boots
// sprint, the bike brakes, the sled drags its heels, the snowmobile lights its
// booster) and no longer sets `tuck`, which only ski.js ever read.
const KEYMAP = {
  KeyW: 'forward', KeyS: 'back',
  KeyA: 'left', KeyD: 'right',
  ArrowUp: 'flipFwd', ArrowDown: 'flipBack',
  ArrowLeft: 'spinLeft', ArrowRight: 'spinRight',   // steer on the ground, hard spin in the air
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
const setKey = (code, v) => {
  const k = KEYMAP[code];
  if (!k) return false;
  if (Array.isArray(k)) for (const kk of k) ctrl.keys[kk] = v;
  else ctrl.keys[k] = v;
  return true;
};

// E is two controls: TAP toggles boots ↔ the world's default gear, HOLD
// (≥350 ms) opens the gear menu. The toggle therefore fires on keyup.
const HOLD_MS = 350;
let eTimer = null, eMenuOpened = false;

// The menu lists EQUIPMENT TYPES, not controller gears: there is one `glider`
// row and it equips whichever flight model the locker has selected. 'rocket' is
// a gear the player never names.
// specs/0003 — `gearSet`. On the ski set hold-E shows exactly boots and skis;
// everything else still exists and is still reachable through the I locker, it
// is simply not advertised (D34/D44).
const menuGears = () => (FULL_GEAR_MENU
  ? ['boots', ...ctrl.gears.filter((g) => g !== 'rocket')]
  : ['boots', 'skis']);

// what the toast says when you change gear — the glider names its model, because
// "gear · glider" twice in a row for two very different flights is a lie
function flashGearName(m) {
  if (pubGear(m) === 'glider') hud.flash('gear · glider · ' + getGliderModel(gliderId).name);
  else hud.flashGear(m);
  return m;
}

function openGearMenu() {
  eMenuOpened = true;
  for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false;   // menu eats input
  hud.openGear({
    current: pubGear(ctrl.mode),
    def: defaultGear,
    gears: menuGears(),
    onPick: (g) => flashGearName(ctrl.setMode(realGear(g))),
  });
}

// I — the locker. Drops every held key, closes the gear menu, and gives the
// mouse back so the grid can be clicked; closing re-takes the pointer.
function openLocker() {
  for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false;
  hud.closeGear();
  inv.noteEquipped('skis', skiId);
  inv.noteEquipped('glider', gliderId);
  inv.noteEquipped('bike', bikeId);
  inv.open();
  if (document.pointerLockElement) document.exitPointerLock();
}

addEventListener('keydown', (e) => {
  if (typingIn(e.target)) return;                    // dev note field
  if (e.code === 'F8') {
    // specs/0003 §A2 — dev mode is not in every build. The public one gets a
    // stubbed dev.js, and there F8 must do NOTHING: not clear the player's held
    // keys, not swallow the keystroke, not re-enter. `available()` is the only
    // honest test — `toggle()` returning false is also what turning dev mode OFF
    // looks like, so it cannot tell "there is no dev mode" from "I just left it".
    if (!dev.available()) return;
    for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false;   // do not resume a held key
    if (dev.toggle()) hud.setPaused(false);        // dev owns the screen, not the pause panel
    else enter();                                  // back to the body — re-take the pointer
    e.preventDefault();
    return;
  }
  if (dev.active()) { if (dev.key(e.code, true)) e.preventDefault(); return; }
  // the locker owns the whole keyboard while it is up — no key bleeds through
  if (inv.isOpen()) {
    e.preventDefault();
    if (e.repeat && (e.code === 'KeyI' || e.code === 'Escape')) return;   // the I that opened it
    inv.key(e.code);
    if (!inv.isOpen()) enter();
    return;
  }
  if (e.code === 'KeyI') {
    if (!hud.isPaused() && !e.repeat) { openLocker(); e.preventDefault(); }
    return;
  }
  if (hud.gearOpen()) {
    // key repeats of the E that opened the menu must not instantly close it
    if (e.code === 'KeyE' && eMenuOpened) { e.preventDefault(); return; }
    if (hud.gearKey(e.code)) { e.preventDefault(); return; }
  }
  // the secret board (tricks.js) gets first refusal on L and on ESC while it is
  // up. It is deliberately absent from the pause panel — that is what makes it
  // secret rather than merely unlisted.
  if ((e.code === 'KeyL' || e.code === 'Escape') && !hud.isPaused() && !e.repeat) {
    if (tricks.key(e.code)) { e.preventDefault(); return; }
  }
  if (e.code === 'KeyR') { ctrl.respawn(); return; }
  if (e.code === 'KeyC') {
    if (!hud.isPaused()) { hud.flash(camRig.toggle() === 'tp' ? 'chase cam' : 'first person'); e.preventDefault(); }
    return;
  }
  if (e.code === 'KeyF') {
    // ride the lift you are standing at — no-op anywhere else, and unreachable
    // in dev mode / behind the pause panel / with the gear menu up (all above)
    if (!hud.isPaused() && !e.repeat) { lifts.use(); e.preventDefault(); }
    return;
  }
  if (e.code === 'KeyE') {
    if (!hud.isPaused() && !e.repeat && !eTimer && !eMenuOpened) {
      eTimer = setTimeout(() => { eTimer = null; openGearMenu(); }, HOLD_MS);
    }
    e.preventDefault(); return;
  }
  if (e.code === 'Space') {
    // edge for boots/skis (instant jump, exactly as ever); level for the bike's
    // preload/pop, which cares about hold-and-release
    // ...and, since 2026-08-31, `jumpHeld` is ALSO the rocket throttle: boost.js
    // reads it instead of the old `boost` key, so hold-SPACE is what G was. The
    // press half is untouched, and the motor is still gated on wearing the pack.
    if (!hud.isPaused()) { ctrl.keys.jump = true; ctrl.keys.jumpHeld = true; e.preventDefault(); }
    return;
  }
  if (setKey(e.code, true)) e.preventDefault();
});
addEventListener('keyup', (e) => {
  if (typingIn(e.target)) return;
  if (dev.active()) { if (dev.key(e.code, false)) e.preventDefault(); return; }
  if (inv.isOpen()) { e.preventDefault(); return; }   // no key survives the locker
  if (e.code === 'Space') { ctrl.keys.jumpHeld = false; return; }
  if (e.code === 'KeyE') {
    if (eTimer) {   // released inside the hold window — that's a tap
      clearTimeout(eTimer); eTimer = null;
      if (!hud.isPaused() && !(hud.gearOpen && hud.gearOpen())) flashGearName(ctrl.toggleMode());
    }
    eMenuOpened = false;
    return;
  }
  setKey(e.code, false);
});
addEventListener('blur', () => { for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false; });

// The scene brought its own OrbitControls and they are wired to this canvas.
// Swallow pointer traffic in the capture phase so they never see it, and do our
// own mouselook from the same handler.
function pointerCapture(e) {
  const onCanvas = e.target === canvas;
  if (onCanvas) e.stopPropagation();
  if (e.type === 'contextmenu') { if (onCanvas) e.preventDefault(); return; }
  if (dev.active()) { dev.pointer(e, onCanvas); return; }   // fly cam owns the mouse
  if (e.type === 'pointerdown' && onCanvas) enter();
  if (e.type === 'pointermove' && document.pointerLockElement === canvas) {
    ctrl.look(e.movementX || 0, e.movementY || 0);
  }
}
for (const t of ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'contextmenu', 'dblclick']) {
  addEventListener(t, pointerCapture, { capture: true, passive: t !== 'wheel' && t !== 'contextmenu' });
}

// D29 — POINTER LOCK DOES NOT EXIST ON iOS SAFARI, and without this the game
// boots permanently paused on every phone. A coarse pointer takes the same path
// cfg.test already takes: skip requestPointerLock, do not re-pause on
// pointerlockchange, boot unpaused. Not a flag — there is no environment in
// which a phone should boot into a pause panel it cannot dismiss.
const touchMode = matchMedia('(pointer: coarse)').matches;
let testFree = cfg.test || touchMode;      // headless / touch: no pointer lock
function enter() {
  if (dev.active()) return;      // dev mode keeps the cursor free for its panels
  if (inv.isOpen()) return;      // so does the locker
  if (testFree) { hud.setPaused(false); return; }
  hud.setPaused(false);
  if (document.pointerLockElement !== canvas) {
    // if the browser refuses the lock, do not pretend we are playing
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => hud.setPaused(true));
  }
}
addEventListener('pointerlockerror', () => { if (!testFree && !dev.active() && !inv.isOpen()) hud.setPaused(true); });
addEventListener('pointerlockchange', () => {
  if (testFree || dev.active() || inv.isOpen()) return;   // dev and the locker
                                                          // release the lock on purpose
  hud.setPaused(document.pointerLockElement !== canvas);
});
hud.setPaused(!testFree);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (world.ownLoop) world.renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------- loop
let last = performance.now();
let frames = 0;
let simTime = 0;          // seconds of simulation actually stepped
let perfectPops = 0;      // lifetime count, surfaced on __player for tests

// ---- D16.2 the respawn fence. NOT a wall, and as of 2026-08-30 not a boundary
// either: it is the recovery from falling into nothing. In one line —
//
//     grounded on real surface  =>  never, at any coordinate
//     no recoverable ground under you for graceMs  =>  fade and respawn
//
// It used to fire on POSITION: 2 s continuously outside a box and you faded
// home. That was correct for a build where one lift boarded and every unload
// was inside it. The universal-lifts wave made it a defect — four of the seven
// top terminals unload outside that box, so riding the Gold Coast Funitel to
// its top and pushing off started the grace timer and put you back on Red Dog,
// every single time ("flashing and teleporting").
//
// Why ground-below and not a ray-distance cap: the glider legitimately puts the
// player hundreds of metres above real terrain, and any distance cap generous
// enough for a glide is no cap at all. The honest condition is the one the
// design states — is there recoverable ground, yes or no.
//
// THE BOX SURVIVES as FENCE.x0..y1, a HARD BACKSTOP the exporter sets at
// CORE ± 8 km, and it is honestly labelled: NOTHING IN PLAY CAN REACH IT.
// controller.js already clamps pos.x/pos.z into collision.bounds every frame,
// so the backstop is four comparisons of belt-and-braces against a future
// teleport that bypasses the physics. It is checked BEFORE the grounded
// early-out so that it is a genuine last resort. What actually catches you at
// the edge of the world is the ground test: the collision grid is wider than
// the terrain in it, so the far west edge is real, reachable void INSIDE the
// grid and groundAt returns null there.
//
// Cost: one extra downward ray per frame, and only while airborne. Grounded —
// most frames of most sessions — returns on the second line.
//
// THE BENCH SETS NO `cfg.fence`, so FENCE is null there and fenceStep() returns
// immediately: the lab has no containment layer and never had one. This is the
// deploy's rule living in the source it belongs to, not a second code path.
const FENCE = (cfg.fence && typeof cfg.fence.x0 === 'number') ? cfg.fence : null;
// Below the lowest collidable triangle in the world, with a margin, is "under
// the map" by construction — derived from the scene, not a guessed altitude.
const FENCE_VOID_Y = collision.bounds.minY - ((FENCE && FENCE.voidMarginM) || 60) * unitScale;
const fenceFade = document.createElement('div');
fenceFade.className = 'fence-fade';
document.body.appendChild(fenceFade);
let fenceOutT = 0, fencing = false, fenceTrips = 0, fenceWhy = null;
function fenceStep(dt) {
  if (!FENCE || fencing) return;
  const p = ctrl.position;
  // the world is z-up ENU; main.js stores it as (x, z_enu, -y_enu)
  const wx = p.x, wy = -p.z;

  let why = null;
  // 1. THE HARD BACKSTOP, and the only test that outranks standing on ground.
  //    At CORE ± 8 km no collider exists, so nothing in normal play reaches it.
  if (wx < FENCE.x0 || wx > FENCE.x1 || wy < FENCE.y0 || wy > FENCE.y1) {
    why = 'past the hard world limit';
  } else if (ctrl.grounded) {
    // 2. ON THE SURFACE. Unconditional, and the whole point of the rule.
    fenceOutT = 0; fenceWhy = null; return;
  } else if (p.y < FENCE_VOID_Y) {
    why = 'below the world';
  } else if (collision.groundAt(p.x, p.z, p.y + 0.5 * unitScale) === null) {
    // 3. AIRBORNE WITH NOTHING UNDER YOU. Distance is deliberately not capped:
    //    a glider 300 m over the Funitel line has recoverable ground and is
    //    doing exactly what the glider is for.
    why = 'no ground under the player';
  }

  if (!why) { fenceOutT = 0; fenceWhy = null; return; }
  fenceWhy = why;
  fenceOutT += dt;
  if (fenceOutT * 1000 < (FENCE.graceMs || 2000)) return;
  fencing = true; fenceOutT = 0; fenceTrips++;
  fenceFade.classList.add('is-on');
  setTimeout(() => {
    ctrl.respawn();
    camRig.applyTo(camera);
    fenceFade.classList.remove('is-on');
    setTimeout(() => { fencing = false; }, 320);
  }, 280);
}

let paidPumps = 0;        // pump transitions that actually paid, for the combo link
// The per-frame player systems that are NOT the controller: the trick/combo
// machine and the pump's instruments. Factored out because the deterministic
// test stepper (__player.stepFixed) has to drive exactly the same set — a trick
// accumulator that only advances under requestAnimationFrame is untestable.
function playerSystems(dt, live) {
  // D16.2 — the fence is a per-frame SYSTEM, so it is stepped here with the
  // others and not off the rAF line. On the rAF line it would be untestable:
  // __player.stepFixed — the deterministic stepper every ride assertion is
  // written against — calls ctrl.update() and playerSystems() and nothing else,
  // and a containment layer no deterministic test can ride against is a
  // containment layer nobody can prove. playerSystems() runs AFTER ctrl.update()
  // in both callers, so the fence reads the position the frame just produced.
  if (live) fenceStep(dt);
  tricks.update(dt, live);
  // the one place §1 and §3 touch: a transition clean enough (eta >= 1.2) LINKS
  // a combo, so a trick line can be carried across flat ground by carving well
  // and the two systems teach each other. Keyed off the paid-transition counter,
  // so one turn can only ever link once.
  if (ctrl.mode === 'skis') {
    const ss = skiState();
    if (ss.paid !== paidPumps) {
      paidPumps = ss.paid;
      if (live && tricks.pumpLink(ss.last.eta)) window.__playAudio.trick();
    }
    if (hud.pump) hud.pump({ on: true, q: ss.pumpQ, max: ctrl.gearTuning('skis').pumpMax || 4, eta: ss.pumpEta, releasing: ss.releasing });
    // ---- the lip/compression meter. Lab only — hud.lipMeter is a no-op unless
    // DEBUG_HUD built the panel — and the launch record is a ONE-SHOT drain, so
    // it has to be read every frame here whether or not anything is listening.
    if (hud.lipMeter) {
      const skiS = ctrl.gearTuning('skis');
      hud.lipMeter({ on: true, s: ss, T: skiS,
                     grounded: ctrl.grounded, launch: takeSkiLaunch(), dt,
                     // the forward look, straight off the physics' own payout
                     // function — jumpVel is the controller's, not ski.js's
                     pop: skiPopPreview(skiS, ctrl.T.jump * (skiS.popMul || 1)) });
    }
  } else if (hud.pump) { hud.pump({ on: false }); if (hud.lipMeter) hud.lipMeter({ on: false }); }
  // the guided run, when the flag brought it in. It reads the same dt the
  // trick machine does, so the deterministic stepper drives it too.
  if (guideMod) guideMod.update(dt, live);
  // specs/0013 — persistent ski tracks. The splat map lives entirely in
  // tracks.js; this is the whole hook. It is HERE and not on the rAF line for
  // the reason the guided run above is: __player.stepFixed drives this function
  // and nothing else, and the acceptance rides that have to prove a carve
  // leaves two lines are stepFixed rides. Self-initialising on the first call.
  tracks.update(dt, live, world, ctrl, unitScale, cfg.test);
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  const devOn = dev.active();
  // the locker freezes the body the same way pause does — browsing a ski rack
  // should not cost you the run you were in the middle of
  const live = !devOn && !hud.isPaused() && !inv.isOpen();
  // the rocket writes velocity BEFORE the controller integrates it, so the
  // thrust, the cancelled gravity and the collision all belong to one frame
  boost.step(dt, live);
  if (live) { ctrl.update(dt); simTime += dt; }
  const ev = ctrl.takeEvents();
  lifts.tick(!devOn && !hud.isPaused());
  if (!devOn) {
    if (ev.trick) { hud.trick(ev.trick); window.__playAudio.trick(); }
    else if (ev.wipe) hud.trick(ev.wipe);
    if (ev.pop === 'perfect') { hud.flash('PERFECT POP'); perfectPops++; window.__playAudio.trick(); }
    playerSystems(dt, live);
    camRig.update(dt, ev);
    camRig.applyTo(camera);
    updateVisuals();
    boost.draw(dt, camRig.mode);        // plume + trail ride the posed camera
  } else {
    dev.update(dt);
    dev.applyTo(camera);
    fpRig.visible = false; fpGlide.visible = false; model.visible = false;   // the body stayed behind
    fpPack.group.visible = false;
    fpSled.visible = false; fpSnow.visible = false;   // ...and so did both vehicles
    boost.hide();
    dev.tick();
  }
  window.__playFX.update(dt);
  window.__playAudio.rocket(devOn ? 0 : boost.throttle());
  window.__playAudio.update(dt);
  window.__playSurprise.update(dt);
  window.__playSnowball.update(dt);
  window.__playMarkers.update(dt);
  // the fuel bar is rocket-gear furniture: nothing else can spend the tank
  hud.setFuel(boost.fuelFrac(), boost.burning(), boost.dry(), boost.worn());
  hud.tick(ctrl, dt, camRig.mode);
  if (world.ownLoop) {
    if (world.update) { try { world.update(now / 1000); } catch { world.update = null; } }
    world.renderer.render(world.scene, camera);
  }
}
if (!world.ownLoop && world.onBeforeSceneRender) {
  // the scene keeps its own loop; we write the pose in just before it renders
  world.onBeforeSceneRender(applyCamera);
}
requestAnimationFrame((t) => { last = t; frame(t); });

// ------------------------------------------------------------- test handle
const info = {
  poi: cfg.poi, run: cfg.run, adapter: world.adapter, spawn: { ...spawn, position: spawn.position.toArray() },
  spawnSource: spawn.source, defaultGear, gear: ctrl.mode, skiModel: skiId, gliderModel: gliderId, bikeModel: bikeId, unitScale, unitNote, upAxis, upFrom, colliderNote, collisionMs: colMs,
  collision: collision.stats, collidableMeshes: meshes, lifts: lifts.count(),
  bbox: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
  tuning: ctrl.T,
};
// specs/0003 — `debugHud`. The bench dumps this on every boot; the shareable
// build does not, and `?dev` turns it back on there for a bug report.
if (DEBUG_HUD || (cfg.qs && cfg.qs.has('dev'))) console.log('[play]', info);

window.__player = {
  ready: true,
  info: () => info,
  position: () => ({ x: ctrl.position.x, y: ctrl.position.y, z: ctrl.position.z }),
  velocity: () => ({ x: ctrl.velocity.x, y: ctrl.velocity.y, z: ctrl.velocity.z }),
  yaw: () => ctrl.yaw,
  pitch: () => ctrl.pitch,
  grounded: () => ctrl.grounded,
  speed: () => ctrl.speed(),
  respawns: () => ctrl.respawns,
  // the controller gear that is actually flying ('rocket' when the pack is on);
  // `gear()` is the equipment type the player sees, which folds rocket into glider
  mode: () => ctrl.mode,
  gear: () => pubGear(ctrl.mode),
  // 'glider' respects the model you picked; 'rocket' selects the pack outright
  setMode: (m) => {
    if (m === 'rocket') { applyGlider('rocket-pack', { equip: true }); return ctrl.mode; }
    return ctrl.setMode(realGear(m));
  },
  toggleMode: () => flashGearName(ctrl.toggleMode()),
  lean: () => ctrl.lean,
  crouch: () => ctrl.crouch,
  footed: () => ctrl.footedNow,
  // the whole aerodynamic state of the glider — airspeed (relative to the air,
  // so it differs from speed() in lift), AoA, cl, stall fraction, updraft, AGL,
  // bank, barrel-roll angle, flight path angle. Tests read this directly.
  glider: () => gliderState(),
  // the rocket's motor: burning, throttle, fuel (s and 0..1), lifetime burn
  // seconds and ignitions, the thrust direction, and `worn` — whether the rocket
  // gear is even equipped, without which none of the rest can move.
  // `simulateKeys({ boost: true }, ms)` drives it like any other key.
  boost: () => boost.state(),
  // the rocket gear itself (rocket.js): air time, 3D speed, sink rate
  rocket: () => rocketState(),
  perfectPops: () => perfectPops,
  fov: () => camera.fov,
  camMode: () => camRig.mode,
  setCamMode: (m) => camRig.setMode(m),
  airSpinDeg: () => ctrl.airSpinDeg,
  lastTrick: () => ctrl.lastTrick,
  wipeT: () => ctrl.wipeT,
  defaultGear: () => defaultGear,
  // specs/0003 — the two ways `gearSet` shows up, surfaced so a gate can assert
  // them instead of counting DOM. `gears` is the CONTROLLER REGISTRY, which is
  // the only "can ride this" flag the player has; `gearMenuOptions` is what
  // hold-E would offer right now.
  gears: () => ctrl.gears,
  gearMenuOptions: () => menuGears(),
  gearMenuOpen: () => hud.gearOpen(),
  // ---- the ski rack + the locker (ski.js / inventory.js)
  skiModel: () => skiId,
  skiModelName: () => getSkiModel(skiId).name,
  setSkiModel: (id) => applySki(id),
  skiModels: () => SKI_MODELS.map((m) => ({ id: m.id, name: m.name, disc: m.disc, group: m.group, len: m.len, stats: m.stats })),
  skiTuning: () => ({ ...ctrl.gearTuning('skis') }),
  // write into the LIVE ski tuning (the registry holds this exact object). Tests
  // use it to switch a feature off and re-measure; applySki() overwrites it again.
  setSkiTuning: (patch) => { Object.assign(ctrl.gearTuning('skis'), patch || {}); return { ...ctrl.gearTuning('skis') }; },
  skiState: () => skiState(),
  // the physics' own answer to "what would SPACE pay right now" — the same
  // popPay() the real jump spends, so a test can assert prediction == payout
  popPreview: () => skiPopPreview(ctrl.gearTuning('skis'),
    ctrl.T.jump * (ctrl.gearTuning('skis').popMul || 1)),
  // ---- spec 0002 test hooks. `pumpState` is the bank and the last transition's
  // whole breakdown; `trickState`/`comboState` are the air and the combo.
  pumpState: () => {
    const s = skiState();
    return {
      q: s.pumpQ, max: ctrl.gearTuning('skis').pumpMax, eta: s.pumpEta, phase: s.pumpPhase,
      load: s.load, edge: s.edge, fall: s.fall, releasing: s.releasing, payout: s.payout,
      turns: s.turns, paid: s.paid, given: s.given, cost: s.cost, last: s.last,
      stivot: s.stivot, stivoting: s.stivoting, hook: s.hook, slip: s.slip, stop: s.stop,
    };
  },
  trickState: () => tricks.state(),
  comboState: () => tricks.state().combo,
  trickBoard: () => tricks.state().board,
  clearTrickBoard: () => tricks.clearBoard(),
  trickKey: (code) => tricks.key(code),
  // ---- deterministic stepping, for regression traces. The rAF loop's dt is
  // wall-clock and therefore never reproducible; this drives ctrl.update() at a
  // FIXED dt and hands back the position trace plus a cheap hash of it, so two
  // builds can be compared bit-for-bit. Pause first (the loop must not also
  // step): __player.paused(true).
  stepFixed: ({ dt = 1 / 120, n = 600, keys = null, every = 10 } = {}) => {
    if (keys) Object.assign(ctrl.keys, keys);
    const trace = [];
    let h = 2166136261 >>> 0;
    const mix = (v) => {
      // hash the exact float bits — a 1-ulp drift must show up
      const b = new Float64Array([v]), i = new Uint32Array(b.buffer);
      h ^= i[0]; h = Math.imul(h, 16777619) >>> 0;
      h ^= i[1]; h = Math.imul(h, 16777619) >>> 0;
    };
    for (let i = 0; i < n; i++) {
      ctrl.update(dt);
      playerSystems(dt, true);
      simTime += dt;
      const p = ctrl.position, v = ctrl.velocity;
      mix(p.x); mix(p.y); mix(p.z); mix(v.x); mix(v.y); mix(v.z); mix(ctrl.yaw);
      if (i % every === 0) trace.push([+p.x.toFixed(6), +p.y.toFixed(6), +p.z.toFixed(6)]);
    }
    if (keys) for (const k of Object.keys(keys)) ctrl.keys[k] = false;
    const p = ctrl.position;
    return {
      hash: h.toString(16), n, dt, trace,
      end: { x: p.x, y: p.y, z: p.z }, speed: ctrl.speed(), yaw: ctrl.yaw,
    };
  },
  // ---- the bike rack (bike.js / inventory.js)
  bikeModel: () => bikeId,
  bikeModelName: () => getBikeModel(bikeId).name,
  setBikeModel: (id) => applyBike(id),
  bikeModels: () => BIKE_MODELS.map((m) => ({
    id: m.id, name: m.name, disc: m.disc, group: m.group, spec: m.spec, stats: m.stats,
  })),
  bikeTuning: () => ({ ...ctrl.gearTuning('bike') }),
  // ---- the sled rack (sled.js). `sledState()` is the whole story of why you
  // are or are not moving: speed, how flat the ground reads (0..1), how far into
  // the stall band you are, air time and the deck's own roll.
  sledModel: () => sledId,
  sledModelName: () => getSledModel(sledId).name,
  setSledModel: (id) => applySled(id),
  sledModels: () => SLED_MODELS.map((m) => ({
    id: m.id, name: m.name, disc: m.disc, group: m.group, spec: m.spec, stats: m.stats,
  })),
  sledTuning: () => ({ ...ctrl.gearTuning('sled') }),
  sledState: () => sledState(),
  // ---- the snowmobile rack (snowmobile.js). `snowmobileState()` carries the
  // engine: throttle, the drive actually reaching the snow, how squarely you are
  // pointed uphill, how much of the drive the slope is eating, and the suspension.
  snowmobileModel: () => snowmobileId,
  snowmobileModelName: () => getSnowmobileModel(snowmobileId).name,
  setSnowmobileModel: (id) => applySnowmobile(id),
  snowmobileModels: () => SNOWMOBILE_MODELS.map((m) => ({
    id: m.id, name: m.name, disc: m.disc, group: m.group, spec: m.spec, stats: m.stats,
  })),
  snowmobileTuning: () => ({ ...ctrl.gearTuning('snowmobile') }),
  snowmobileState: () => snowmobileState(),
  // ---- the glider rack: one equipment type, two flight models
  gliderModel: () => gliderId,
  gliderModelName: () => getGliderModel(gliderId).name,
  setGliderModel: (id) => applyGlider(id, { equip: true }),
  gliderModels: () => GLIDER_MODELS.map((m) => ({ id: m.id, name: m.name, gear: m.gear, tag: m.tag })),
  inventoryOpen: () => inv.isOpen(),
  openInventory: () => { openLocker(); return inv.isOpen(); },
  closeInventory: () => { inv.close(); return inv.isOpen(); },
  inventory: () => ({
    open: inv.isOpen(), tab: inv.tab(), tabs: inv.tabs(), filter: inv.filter(),
    items: inv.items(), selected: inv.selected(), equipped: inv.equipped(),
  }),
  inventoryKey: (code) => { const r = inv.key(code); if (!inv.isOpen()) enter(); return r; },
  setInventoryTab: (id) => inv.setTab(id),
  setInventoryFilter: (f) => inv.setFilter(f),
  groundNormal: () => { const n = ctrl.groundNormal(); return { x: n.x, y: n.y, z: n.z }; },
  setYaw: (y) => ctrl.setYaw(y),
  // yaw that points straight down the fall line under your feet
  downhillYaw: () => {
    const n = ctrl.groundNormal();
    return Math.hypot(n.x, n.z) < 1e-4 ? ctrl.yaw : Math.atan2(-n.x, -n.z);
  },
  groundAt: (x, z) => collision.groundAt(x, z, collision.bounds.maxY + 5),
  keys: (obj) => { Object.assign(ctrl.keys, obj || {}); return { ...ctrl.keys }; },
  clearKeys: () => { for (const k of Object.keys(ctrl.keys)) ctrl.keys[k] = false; },
  // intro.js calls this when the controls card is dismissed — the same door a
  // canvas click has always used.
  enter: () => enter(),
  touchMode: () => touchMode,
  toggleCam: () => camRig.setMode(camRig.mode === 'tp' ? 'fp' : 'tp'),
  // D16.2 — "why" and "outT" are what make the surface-aware rule testable:
  // "the fence did not fire" is also true of a fence that is not wired up, and
  // a gate has to be able to tell those apart. Null when no host set cfg.fence,
  // which is what a bench boot asserts on to prove the lab has no containment.
  fence: () => (FENCE ? {
    ...FENCE, trips: fenceTrips, why: fenceWhy, outT: +fenceOutT.toFixed(3),
    voidY: FENCE_VOID_Y, grounded: ctrl.grounded,
    groundBelow: collision.groundAt(ctrl.position.x, ctrl.position.z, ctrl.position.y + 0.5 * unitScale),
  } : null),
  // D42 — the export build gate reads these. world.report.stats is the world's
  // own count, not an estimate.
  stats: () => (world.report && world.report.stats) || null,
  sceneRoot: () => world.scene,
  markers: () => world.markers || [],
  // ---- shareable waypoint URLs. `waypoints()` is the WHOLE slug set as the
  // world declares it right now — markers, then runs, then lift tops, plus the
  // alias keys — so "does every waypoint autowire?" is a loop over live data
  // rather than a list somebody has to remember to update. `resolveSpawn(slug)`
  // answers the same question one slug at a time, doing the real ring search,
  // so a gate can prove all eighteen resolve without booting eighteen pages.
  waypoints: () => [...waypointIndex(world, upAxis).entries()]
    .map(([slug, w]) => ({ slug, id: w.id, kind: w.kind, name: w.name })),
  spawnAliases: () => ({ ...SPAWN_ALIASES }),
  resolveSpawn: (slug) => {
    const s = namedSpawnFor(THREE, { slug, collision, world, unitScale, upAxis });
    return s ? { ...s, position: s.position.toArray() } : null;
  },
  pixelRatio: () => (world.renderer ? world.renderer.getPixelRatio() : null),
  // ---- D27: the whole touch seam. touch.js writes the same mutable boolean
  // object the physics already reads by reference, and calls this look() — the
  // one the mouse calls. No physics module and no gear module learns touch
  // exists. THE THIRD ARGUMENT IS LOAD-BEARING and it used to be missing: touch
  // passes LOOK = 0.00022 and a two-argument signature dropped it on the floor
  // and turned at ctrl.look's own `sens = 1`, 450x the mouse's 0.0022. That is
  // the whole of "phone drag-look was far too hot". It still DEFAULTS to the 1
  // the two-argument form always used, so a two-argument caller is unchanged.
  look: (dx, dy, sens) => ctrl.look(dx, dy, sens === undefined ? 1 : sens),
  paused: (v) => { if (v !== undefined) hud.setPaused(!!v); return hud.isPaused(); },
  respawn: () => ctrl.respawn(),
  teleport: (x, y, z) => ctrl.teleport(new THREE.Vector3(x, y, z)),
  // put a velocity on the body — the airborne counterpart of teleport(). Tests
  // use it to start a glide at a chosen airspeed instead of spending 40 m of
  // altitude falling into one.
  setVelocity: (x, y, z) => { ctrl.velocity.set(x, y, z); return ctrl.velocity.toArray(); },
  // chairlifts (lift.js): what the world declared, what the HUD is offering,
  // and the one-call "take the lift called <name>" the tests use
  lifts: () => lifts.list(),
  liftPrompt: () => lifts.prompt(),
  liftRides: () => lifts.rides(),
  lastLift: () => lifts.lastRide(),
  boardLift: (name) => lifts.board(name),
  // the derived unload spawns (lift.js): where each lift actually stands you up,
  // how flat it is there, how far off the fall line it aims you, and why
  liftSpawns: () => lifts.spawns(),
  // the 20%-opacity boarding circles: where they are, how big, how visible
  liftDecals: () => lifts.decals(),
  walkToLift: (name, off) => lifts.walkTo(name, off),
  // where R goes back to: the last place you fast-travelled to, or the world
  // spawn before any of them
  fastTravel: () => ({ ...fastTravel, at: fastTravel.at ? { ...fastTravel.at } : null }),
  // the world's own run polylines, in the three frame — READ-ONLY, and the
  // arrays are the player's converted copies, never the scene's
  runs: () => (world.runs || []).map((r) => ({ id: r.id, name: r.name, n: (r.pts || []).length })),
  runPts: (id) => { const r = (world.runs || []).find((q) => q.id === id); return r ? r.pts.map((p) => p.slice()) : null; },
  // the guided run (guide.js), when the flag is on. null otherwise, which is
  // what a test asserts on to prove the default boot did not grow one.
  guide: () => (guideApi ? guideApi.state() : null),
  guideApi: () => guideApi,
  frames: () => frames,
  sceneChildren: () => world.scene.children.length,
  renderInfo: () => ({ ...world.renderer.info.render, memory: { ...world.renderer.info.memory } }),
  errors: () => consoleErrors.slice(),
  simTime: () => simTime,
  // Hold a key set for `ms` of SIMULATED time. Headless chromium renders this
  // scene at a handful of fps, so wall-clock holds would measure the renderer,
  // not the controller; sim time makes the numbers frame-rate independent.
  simulateKeys: (obj, ms) => new Promise((resolve) => {
    const before = { x: ctrl.position.x, y: ctrl.position.y, z: ctrl.position.z };
    // jump is edge triggered: press it once, then only hold the rest
    const hold = { ...(obj || {}) };
    delete hold.jump;
    Object.assign(ctrl.keys, obj || {});
    const s0 = simTime, t0 = performance.now();
    let minY = Infinity, maxY = -Infinity, n = 0, topSpeed = 0, air = 0;
    const step = () => {
      const p = ctrl.position;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
      if (ctrl.speed() > topSpeed) topSpeed = ctrl.speed();
      if (!ctrl.grounded) air++;
      n++;
      const simMs = (simTime - s0) * 1000, wallMs = performance.now() - t0;
      if (simMs >= ms || wallMs > 60000) {
        for (const k of Object.keys(obj || {})) ctrl.keys[k] = false;
        const after = { x: p.x, y: p.y, z: p.z };
        resolve({
          before, after, minY, maxY, frames: n,
          dx: after.x - before.x, dy: after.y - before.y, dz: after.z - before.z,
          dist: Math.hypot(after.x - before.x, after.z - before.z),
          simMs, wallMs, grounded: ctrl.grounded, speed: ctrl.speed(),
          topSpeed, airFrames: air, mode: ctrl.mode, yaw: ctrl.yaw, lean: ctrl.lean,
          avgSpeed: simMs > 0 ? Math.hypot(after.x - before.x, after.z - before.z) / (simMs / 1000) : 0,
        });
        return;
      }
      Object.assign(ctrl.keys, hold);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }),
};

window.__player.devMode = () => dev.active();
window.__player.dev = dev;
window.__playerDebug = window.__player;   // alias

// ?dev=1 — boot straight into the builder camera (the world-building entry
// point). Guarded by available() for the same reason F8 is (specs/0003 §A2):
// in a build with no dev mode this must not silently un-pause the game behind
// the intro card for anyone who types the query string.
if (dev.available() && cfg.qs && cfg.qs.has('dev') && cfg.qs.get('dev') !== '0') {
  dev.setActive(true);
  hud.setPaused(false);
}

const boot = document.getElementById('play-boot');
if (boot) { boot.classList.add('is-gone'); setTimeout(() => boot.remove(), 300); }

// ------------------------------------------------------- the product overlays
// specs/0003 §B. These five used to be exporter TEMPLATES chained together in
// the standalone build's index.html, which meant the bench would have needed a
// second copy of that chain — and two wirings is exactly the drift 0003 exists
// to stop. So main.js owns it, once, and the conditions are the flags:
//
//   speedo.js  clean.js    always
//   touch.js                coarse pointer only
//   intro.js   idle.js      `guide` only — they are the guided run's boot flow
//                           and its stuck-player nudge, and neither makes sense
//                           in front of a bench world you opened to test a lip
//
// ORDER MATTERS and it is the order below. Every one of them polls
// `window.__player`, and clean.js also reaches for `window.__playMarkers`, so
// they all come after the handle above. idle.js additionally watches for
// `.intro` leaving the DOM, so it comes after intro.js.
//
// EACH ONE IS INDIVIDUALLY CAUGHT. None of them is load-bearing for the game —
// a mountain with no speedometer is still a mountain — and the old chain got
// this wrong: a failure in speedo.js also skipped clean.js, because they were
// links in one promise chain. A per-module catch means one broken overlay costs
// exactly one overlay. `intro-up` is the exception that has to be undone by
// hand: intro.js is what clears it, so if intro.js is the module that failed,
// the class would suppress the entire screen forever.
for (const [name, want] of [
  ['./speedo.js', true],
  ['./clean.js', true],
  ['./touch.js', touchMode],
  // `introFlag`, not `guideFlag`: a named waypoint spawn turns the TUTORIAL off
  // (it is anchored to the Red Dog top) but the intro card still shows, because
  // it is also where the OpenStreetMap / ODbL credit lives and a shared /kt22
  // link is exactly as public as the front door.
  ['./intro.js', introFlag],
  ['./idle.js', introFlag],
]) {
  if (!want) continue;
  try {
    await import(name);
  } catch (e) {
    console.warn('[play] overlay failed to load: ' + name, e);
    if (name === './intro.js') document.body.classList.remove('intro-up');
  }
}

// LAST, and after the overlays on purpose: `__playerReady` is the one signal a
// test or a gate waits on, and it used to go up while intro.js was still in
// flight — so "the player is ready" and "window.__intro exists" were two
// different moments and anything reading the second raced the first.
window.__playerReady = true;
