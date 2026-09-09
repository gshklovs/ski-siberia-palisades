// "Enter the world" — first person player for a run's scene/.
// Boot (play.html, classic script) has already set <base> + the importmap.

import { loadWorld } from './loader.js';
import { createChunks } from './chunks.js';       // specs/0051 §2 — the tile scheduler
import { collidableBox } from './collision.js';
import { createCollisionRouter, propCapFrom } from './collision-router.js';
import { createController, TUNING } from './controller.js';
import {
  skiTuningFor, resolveSkiId, rememberSkiId,
  makeSkiRig, styleSkiRig, getSkiModel, skiState, rollSkiRigs, SKI_MODELS,
  takeSkiLaunch, skiPopPreview, setSkiRailComp,   // specs/0057 — rail.js banks the jib compression through ski.js (D6)
} from './ski.js';
// specs/0057 — the jib state. It is a per-frame SYSTEM (stepped in
// playerSystems(), so __player.stepFixed drives it), it publishes its own
// `window.__rail`, and it adds nothing to `__player` (0058 4.1 / C13).
import { initRail, railStep, railFeed } from './rail.js';
import * as tricks from './tricks.js';
import { buildRider } from './rider.js';
import { createRiderFpvBoots } from './rider-fpv-boots.js';
import { fitRiderBindings, createBootAttachment, POLISHED_RIDER_LIFT } from './rider-bindings.js';
import { makeBloom } from './rig/bloom.js';
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
import { createRecorder, EV as TRACE_EV } from './recorder.js';   // specs/0058
import { tracks } from './tracks.js';
import './fx.js';
import './surprise.js';
import './snowball.js';
import './markers.js';
import './audio.js';
import { BIKE_GEAR, FULL_GEAR_MENU, DEBUG_HUD, labUI, LABEL, pickBrand } from './flags.js';   // labUI: specs/0055 §5.3

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
// ---------------------------------------------------- specs/0051 §3.4-§3.7
// THE WHOLE-WORLD `colHalf` GRID IS GONE. What used to be here sized ONE 6 m
// CSR to the entire declared world — `Math.min(4200, max(620, span/2 + 60))`,
// measured at 3,217.63 m on this world (§0.4 M11) — and every one of the 26 far
// probes §3.8 enumerates has been standing on it ever since. §3.5: "world
// .colliders becomes a DECLARATION — which meshes are collidable, by name/class
// — consumed per tile." That is what `createCollisionRouter` does with it.
//
// Two things the deleted block did that the router still has to do, and does:
//   * the extent comes off the DECLARED colliders, not off the camera/centroid
//     guess (a contract world has no camera, and the old default left the grid
//     at the origin with 620 m of reach, silently dropping collision beyond it);
//   * `bounds` is that extent GROWN BY 60 m on every side — `main.js:171`'s
//     `+ 60 * unitScale`, which is the reachable void band the respawn-fence
//     probe depends on (§3.7, check 11). The router keeps it to the metre:
//     x0 = -4,527.26 on this world, exactly as before.
// The 4,200 m cap and the square `colHalf` are what go, and only those.
const colOpts = { cell: 6 * unitScale };
// §3.6 — `world.terrainHeight` already exists on both worlds and is consumed by
// ZERO player files. It is the analytic height the soft answer returns, and the
// height the lift unload search walks its fall line over.
const terrainHeight = typeof world.terrainHeight === 'function' ? world.terrainHeight : null;
let collision = createCollisionRouter(THREE, world.scene, {
  ...colOpts,
  unitScale,
  colliders: world.colliders,
  terrainHeight,
  // §1.1: the lattice is anchored on the raster origin so its phase is fixed
  // and independent of the player. `world.chunks` carries it when tiles.mjs
  // shipped (wave 1b); with no handle the lattice anchors at 0.
  origin: world.chunks && world.chunks.origin ? world.chunks.origin : null,
  // every `terrain-*` mesh in both worlds is ground (terrain.mjs:948,949,956,
  // 983,1023,1042,1051,1065,1079,1168). §3.5's 4,000-triangle cap excludes them
  // and applies to trees/props/rocks alone.
  isTerrain: (m) => /^terrain(-|$)/.test(m.name || ''),
  // §3.5's ceiling on trees/props/rocks per tile. `?propcap=N` is the
  // measurement knob that let it be READ off this world rather than guessed —
  // see PROGRESS-0051-2c.md for the census it produced.
  propCap: propCapFrom(cfg.qs),
});

// The residency centre before anything asks a question. §4.6: the player's tile
// is resident before the first frame — here that is the camera/centroid guess,
// which `pickSpawn` immediately replaces with the real spawn (§2.8 path 1).
collision.setFocus(cx, cz);

// A declared colliders[] list is trusted, but not blindly: a scene that keeps
// its ground as an analytic heightfield and only lists rocks would leave us
// with nothing to stand on. If the declared set has no floor anywhere near
// where we intend to spawn, fall back to picking colliders ourselves.
let colliderNote = world.colliders ? 'declared colliders[]' : 'auto (backdrop-filtered)';
if (world.colliders && !hasFloor(collision)) {
  collision = createCollisionRouter(THREE, world.scene, { ...colOpts, unitScale, terrainHeight });
  collision.setFocus(cx, cz);
  colliderNote = 'declared colliders[] had no floor — fell back to auto';
  console.warn('[play] declared colliders[] contained no walkable floor; using every non-backdrop mesh instead');
}
const colMs = Math.round(performance.now() - tCol);

// -------------------------------------------------- specs/0051 §2 — chunking
// The scheduler is built HERE, after the z-up wrap and after the colliders have
// their world matrices, because it needs both: the pool group goes INSIDE the
// wrap so a tile's ENU vertices land where the rest of the world's do, and the
// LF ring (§1.5) is sized off the collider AABB, which is the rim box.
//
// A world with no `scene/tiles.mjs` — every gltf and page adapter, and any
// contract world older than wave 1b — gets an inert handle that reads zero
// rather than a branch at every call site.
const chunks = createChunks({
  THREE,
  scene: world.scene.getObjectByName('play:zup') || world.scene,
  tiles: world.tiles, ground: world.ground, terrain: world.terrain,
  sideErrors: world.sideErrors || null,   // present-but-broken vs genuinely absent
  source: world.chunks || null,
  colliders: world.colliders,
  protos: world.tileProtos || null,      // §5.3 wave 3a — POOL_INST's prototypes
  // specs/0051 D-19 — THE TRUNKS. A fir is solid through the stem set
  // (solids.js), which `buildCollision` harvests in ONE traverse at boot; wave
  // 3a moved every fir in the world into `protos` above, so that traverse found
  // none of them and 24,400 trunks stopped existing (measured: 24,470 stems
  // unchunked, 70 chunked). Handing the pool the SAME StemSet object lets it
  // register a tile's trunks when the tile lands and drop them when it is
  // evicted — the router keeps its whole surface and learns nothing new.
  stems: collision.stems || null,
  // §5.1 wave 4a — the ladder the lattice replaces on screen. A world that
  // declares none (every gltf and page adapter) keeps drawing whatever it built
  // and the pool stays invisible, exactly as 2a shipped it.
  legacy: Array.isArray(world.legacyFloor) ? world.legacyFloor : null,
});
window.__chunks = chunks;
// ==================================================== specs/0051 §2.8 / D-19
// THE FIVE RE-HOME PATHS REACHED THE COLLISION ROUTER AND NOT THE STREAMER.
// `chunks.js`'s own `pinSync` (§2.8, chunks.js:849) had ZERO call sites: every
// one of main.js:1991, controller.js:417 and :1902, spawn.js:125 and lift.js:412
// calls `collision.pinSync`, which is the ROUTER's. So the render lattice was
// never told a fast travel had happened — it discovered the jump on the next
// `chunks.tick`, kept up to GRACE_MAX = 30 of the source's tiles (with their
// firs, and after D-19 with their trunks) resident for GRACE_MS = 2.0 s, and
// streamed the destination's 243 tiles in at §2.7's 2.0 ms a frame. That is
// Greg's "when i fast travel, the chunks dont update so there are trees when
// not supposed to be there", 2026-09-06.
//
// Wrapping the router's call is what fixes ALL FIVE at once, and any sixth a
// later wave adds, rather than five edits that can be five minus one.
//
// 'lift-decal' IS EXCLUDED BY NAME. `lift.js:412` pins a LIFT TOP so the
// boarding decal can raycast against real ground while the player is standing
// somewhere else entirely; re-homing the render lattice onto it would move the
// whole world off the body. It is the one path here that is not a body move.
{
  const rawPin = collision.pinSync;
  collision.pinSync = (dest, path = 'teleport') => {
    const out = rawPin.call(collision, dest, path);
    if (path !== 'lift-decal') {
      // outside every catch, exactly as §2.1 requires of the tick: a scheduler
      // exception on a teleport must be a visible failure and not a world that
      // quietly keeps the tiles it had.
      chunks.pinSync(dest, path);
    }
    return out;
  };
}
// §2.7's focus: the player's own position and velocity, in three space, plus
// the gear, because the glider's lead is 6 s where everything else is 2.5 s.
const chunkFocus = () => ({
  x: ctrl.position.x, y: ctrl.position.y, z: ctrl.position.z,
  vx: ctrl.velocity.x, vy: ctrl.velocity.y, vz: ctrl.velocity.z,
  mode: ctrl.mode,
});

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
// specs/0051 §3.4: `stats.triangles` is now the RESIDENT count and moves with
// the player, so "is there anything to stand on at all" reads the one harvest
// underneath it — the declaration — which is the question this check is asking.
if (collision.stats.soupTriangles === 0) {
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

// third-person skier: the skinned rider (rider.js / rider-mesh.js / rig/clips.js,
// spec 0041) + the same skis. One SkinnedMesh on a 25-bone armature, posed by an
// AnimationMixer — the arms are BONES now, so nothing here writes a limb.
// mBody is the rig's `play:body` and `rig.update()` (§4.2) drives everything in it.
const model = new THREE.Group();
model.name = 'play:skier';
model.rotation.order = 'YXZ';
const alpinePolish = !!cfg.qs && cfg.qs.get('alpinePolish') === '1'
  && cfg.qs.get('riderPolish') === '1'
  && cfg.poi === 'siberia-palisades' && cfg.run === 'siberia-palisades-A-astra-01';
const rider = buildRider(THREE, u, { alpinePolish });
if (alpinePolish) {
  fpSkiL.position.z = fpSkiR.position.z = -0.95 * u;
  const fpBoots = createRiderFpvBoots(THREE, [fpSkiL, fpSkiR], u);
  fpBoots.material.envMap = rider.fp.material[2].envMap;
  fpBoots.material.envMapIntensity = 0.85;
  fpRig.userData.boots = fpBoots.stats;
}
const mBody = rider.model;
// specs/0041 §4.7 — the mount copy's "no rack" case, hoisted out of the frame
const ZERO = new THREE.Vector3();
const mSkiL = makeSki(), mSkiR = makeSki();
if (alpinePolish) for (const ski of [mSkiL, mSkiR]) fitRiderBindings(THREE, ski, u);
// THE BOOT STANCE, and this is the only statement of it. ±0.15 u is the stance
// width and 0.02 u is the base off the snow; both were literals here and again
// in the riding pose and a third time in the tumble's log roll, which is how one
// of the three came to be the only thing restoring the other two.
const SKI_STANCE = { x: 0.15 * u, y: 0.02 * u };
mSkiL.position.set(-SKI_STANCE.x, SKI_STANCE.y, 0);
mSkiR.position.set(SKI_STANCE.x, SKI_STANCE.y, 0);
// named so the inventory's preview can clone this rig and dress it (inventory.js)
mBody.name = 'play:body'; mSkiL.name = 'play:ski-l'; mSkiR.name = 'play:ski-r';
model.add(mBody, mSkiL, mSkiR);
const bootAttachment = alpinePolish ? createBootAttachment(THREE, rider, [mSkiL, mSkiR], u) : null;

// ---------------------------------------------------------------- gearRestore
//
// EVERYTHING THE TUMBLE TOOK OFF YOU GOES BACK ON, and it goes back on the frame
// you stand up rather than on the next wipeout.
//
// Greg, 2026-09-05: "i lose a ski from time to time and don't get it back until
// next wipeout". The tumble writes `mSkiL/mSkiR.position.x` — specs/0034 §2's
// log roll orbits the pair about the travel axis by hand, because the skis are
// children of `model` and not of `mBody`, so the body's own turn does not reach
// them (updateVisuals, the `for (const [s, bx] of ...)` loop). NOTHING in the
// riding pose block writes position.x back: `position.y` and `rotation.z` are
// re-written from scratch every riding frame, `position.x` never was, and the
// only thing restoring it was the roll's own return through auth → 0 at the end
// of a full 2.0 s wipe.
//
// So a wipe that runs out is fine and every other exit is not. A respawn (R, or
// D16.2's fence), a `teleport` (markers' T, lift.js's unload), a gear change, a
// rack mount and a flip to first person all end the tumble at whatever roll it
// had reached, and the ski stays parked at `bx·cos(lr) − by·sin(lr)`: at
// lr ≈ ±π/2 both skis sit on top of each other under the crotch — which is the
// ski you lost — and at ±π they have swapped boots. It came back on the NEXT
// wipeout because that tumble's own exit re-wrote position.x from the stance.
//
// The restore is therefore not an unwind of a particular exit path. It is a
// statement of where the gear LIVES, run on every frame the tumble does not own
// it, from tumbleStep's off-branch — which is called from camRig.update(), once
// a frame, in both camera modes, on foot and on a rack, and reached by every one
// of those exits with no edge to detect and nothing to remember. Idempotent by
// construction: it assigns, it does not accumulate.
//
// specs/0056 (intensity-scaled gear loss): this is the hook. Anything you take
// off the rider in a tumble is put back HERE, so it comes back on the get-up
// however the tumble happened to end.
function gearRestore() {
  mSkiL.position.set(-SKI_STANCE.x, SKI_STANCE.y, 0);
  mSkiR.position.set(SKI_STANCE.x, SKI_STANCE.y, 0);
  // The rotations are assigned (not accumulated) by the riding pose block and by
  // rollSkiRigs on every tp ski frame, so they cannot go stale on their own —
  // but a rig that is only half restored is the bug this function exists to
  // close, and zeroing them costs nothing on a frame that is about to write them.
  mSkiL.rotation.set(0, 0, 0);
  mSkiR.rotation.set(0, 0, 0);
  // The fp pair hang off the camera and are already written unconditionally
  // every fp ski frame (the `if (tum.on)` block up in updateVisuals says so in
  // as many words); the poles are `rider:poles`, whose visibility rider.js
  // recomputes from ctrl.mode / mount / camRig.mode on every rig.update. Neither
  // holds state across a wipe, so neither is restored here — they are named so
  // that the next reader does not have to prove it again.
}
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
// The two forearms are gone: specs/0041 §2.5 gives first person ONE 17-bone rig,
// `play:fp-arms`, that serves the glider, the skis and the bike alike — skinned,
// painted off the same atlas as the body and posed by rider.js, which mounts it
// on the scene root itself (§4.1). Nothing in this file draws a limb any more.
fpGlide.add(fpWing.group);
fpGlide.visible = false;
world.scene.add(fpGlide);

// Third person: the money shot. The wing is a rig on its own now — specs/0041
// §4.7 stops every rack building its own doll, so the pilot IS `play:body`,
// prone under here on the `prone-glider` clip (§3.8.4) and carried by the mount
// copy in updateVisuals rather than by being a child. The bank still tilts both
// together and the rig still pitches with the flight path; what the body no
// longer does is stand up inside the frame.
const tpGlide = new THREE.Group();
const tpWing = makeGlider();
tpWing.group.position.set(0, 1.62 * u, 0);      // spine, right where the hands are
tpGlide.add(tpWing.group);
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
// specs/0041 §4.6 — ONE PARENT UP THE SPINE, not the root: on `rider:spine-2` the
// pack curls with the torso in a tuck and lies down with it under the wing,
// instead of floating where the root used to be. `makeRocketPack` returns a group
// AT THE ORIGIN whose plate is at 1.12 u (rocket.js:152) and the bone's rest head
// is (0, 1.22, 0) (§2.3), so the bone-local rest is −1.22 u — and it is an ADDED
// write, because `tpPack` has no position of its own. C03 asserts it to 5e-3.
tpPack.position.set(0, -1.22 * u, 0);
rider.bone('rider:spine-2').add(tpPack);

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
  // ---- specs/0036 §1: THE LENS TAKES ONE WOBBLE, THE BODY KEEPS THE RAGDOLL.
  // Same amplitude as the body's first cycle — the wobble is felt; it is the
  // REPETITION that goes, and the body's own chatter above is untouched.
  CAM_ROLL: 0.50,    // rad — the lens's single 7 Hz cycle, then flat
  // ---- specs/0035 §3: HOLD, THEN COLLAPSE — not a single decaying exponential.
  //
  // 0030 and 0034 both answered "the chatter dies too early" by lengthening one
  // `exp(-st / ROLL_DAMP)`, and at 1.20 s that envelope is still at 37 % a full
  // second and a bit after the hit. Greg's note is the other shape: "vibrating
  // in first .5s is good but it should exponentially get lower". A single
  // exponential cannot do both — it is already below 1 the instant it starts, so
  // making the tail short makes the first half second wrong too.
  //
  // Two constants instead. FULL amplitude for CHATTER_HOLD, then a genuine
  // exponential collapse with time constant CHATTER_TAU:
  //     env = st < HOLD ? 1 : exp(-(st - HOLD) / TAU)
  // At 0.18 s that is 33 % at 0.7 s, 11 % at 0.9, 5 % at 1.05 and 1 % at 1.35 —
  // the body rattles across the snow for exactly the half second Greg watched
  // and is then still, well before the get-up at 1.6. `ROLL_DAMP` is retired:
  // nothing reads it, so it is deleted rather than left as a dead 1.20.
  //
  // `st` is the clock the whole envelope has always run on — seconds since the
  // FOLD ends, i.e. since the body is down — which is what "after I hit the
  // floor" means. On the tumble's own clock `t`, HOLD ends at 0.15 + 0.50.
  CHATTER_HOLD: 0.50,   // s at full amplitude, from the end of the fold
  CHATTER_TAU: 0.18,    // s — and the collapse after it
  // ---- specs/0034 §2: AND IT SHOULD LOOK LIKE TUMBLING, NOT SLIDING.
  //
  // A longer slide on the same pose is a longer plank. Between LOG_IN and
  // LOG_OUT the body makes ONE FULL ROLL about the axis it is travelling along —
  // prone, onto its back, prone again — while it is still moving fast, and comes
  // out of it on exactly the pose it went in on, because 2*pi is 0. That is what
  // makes it free: no track has to be faded, nothing is switched, and after
  // LOG_OUT the body is prone and chattering exactly as 0030 left it.
  //
  // It is a roll about the BODY'S OWN LONG AXIS and so it goes on mBody's y,
  // not its z. The rig pivots at the feet and the pitch has already laid the
  // spine down along the direction of travel, so `Rx(pitch)` carries the y axis
  // onto the travel axis and a rotation about it is a log roll. (`rotation.z`,
  // which carries PRONE_ROLL and the chatter, is the same axis only while the
  // body is UPRIGHT; on a body pitched 1.32 rad it is very nearly vertical.)
  LOG_ROLL: Math.PI * 2,   // rad — one full turn, and only one
  LOG_IN: 0.35,      // s — from here...
  LOG_OUT: 1.15,     // s — ...to here, smoothstepped
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
  // specs/0034 §2 — the full roll, in units of TUM.LOG_ROLL. Flat until 0.35 s
  // (the hit and the fold own that), one smoothstepped turn to 1.15 s, and then
  // HELD at 1 for the rest of the wipe, which is the same pose as 0: a track
  // that came back to 0 would roll the body a second time, backwards, through
  // the get-up. At 0.75 s — the midpoint, and smoothstep(0.5) is 0.5 — it is
  // exactly half a turn: the body is on its back. That is §3.2's own row.
  logRoll: [[0, 0], [0.35, 0], [1.15, 1], [2.00, 1]],
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
  pitch: 0, roll: 0, logRoll: 0, spin: 0, align: 0, sink: 0, arm: 0, ski: 0,
  bx: 0, bz: 0, back: 0,               // the fold's displacement, in world x/z
  eye: 0, eyeDrop: 0, camP: 0, camR: 0, camY: 0, camLog: 0,
  camRoll: 0,                          // specs/0036 — the LENS's roll, one wobble
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
    tum.pitch = tum.roll = tum.logRoll = tum.spin = tum.align = tum.sink = tum.arm = tum.ski = 0;
    tum.bx = tum.bz = tum.back = 0;
    tum.kickN = tum.backN = 0;                 // specs/0041 §4.4 — the family's two tracks
    tum.eyeDrop = 0; tum.eye = ctrl.T.eyeHeight;
    tum.camP = tum.camR = tum.camY = tum.camLog = tum.camRoll = 0;
    tum.stemDist = -1; tum.clampedGround = 0; tum.clampedStem = 0;
    tum.eyeGround = 0;
    // ...and the gear goes back on. Every frame, not on an edge: this branch is
    // the definition of "the tumble does not own the body", and it is reached by
    // the wipe running out, by a respawn, by a teleport, by a gear change and by
    // stepping off onto a rack alike.
    gearRestore();
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
  // specs/0035 §3: hold at full for CHATTER_HOLD, then collapse at CHATTER_TAU.
  const env = st < TUM.CHATTER_HOLD
    ? 1
    : Math.exp(-(st - TUM.CHATTER_HOLD) / TUM.CHATTER_TAU);
  const osc = Math.sin(st * Math.PI * 2 * TUM.ROLL_HZ) * env;
  const prone = t > TUM.FOLD ? 1 : 0;
  tum.roll = tum.sign * (TUM.FOLD_ROLL * fold * fold
    + TUM.PRONE_ROLL * tumAt(TUM_KF.rollHold, t)
    + TUM.ROLL * osc * prone);
  // ---- specs/0036 §1: THE LENS'S OWN ROLL. Same lean, same hold — the eye is on
  // the body and has to lie over with it — but the chatter term is ONE CYCLE of
  // the same 7 Hz sine and then nothing. `sin` is exactly 0 at st = T1, so the
  // cut is not a step: the wobble arrives, completes, and the horizon is still.
  // The body above keeps 0035's full envelope, because the ragdoll is the part
  // Greg likes; what he cannot watch is the HORIZON doing it for a second.
  const T1 = 1 / TUM.ROLL_HZ;                       // one period, ~0.143 s
  const oscCam = st < T1 ? Math.sin(st * Math.PI * 2 * TUM.ROLL_HZ) : 0;
  tum.camRoll = tum.sign * (TUM.FOLD_ROLL * fold * fold
    + TUM.PRONE_ROLL * tumAt(TUM_KF.rollHold, t)
    + TUM.CAM_ROLL * oscCam * prone);
  // ...and specs/0034 §2's full turn ON TOP of it, the same way round the body
  // was already thrown. Same sign as the lean, so the roll continues the motion
  // the fold started rather than fighting it.
  tum.logRoll = tum.sign * TUM.LOG_ROLL * tumAt(TUM_KF.logRoll, t);

  // ---- the spin
  tum.spin = tum.sign * tumAt(K.spin, t) * (tum.solid ? TUM.SPIN : TUM.SPIN_ROT);

  // ---- the fold's displacement, along -v. A contact only: nothing pushes you
  // back off a landing you simply fluffed.
  const bk = tum.solid ? tumAt(K.back, t) * TUM.BACK * u : 0;
  tum.back = bk;
  // specs/0041 §4.4 — the 4-pose tumble family reads the NORMALISED tracks, not
  // the metres and not a local: `tum.back` is the track × TUM.BACK × u and the
  // kick was a local at the eye block below. Stored here so rider.js can weight
  // `tum-kick` and `tum-prone` off the same samples the root is using; `tum.back`
  // in metres is untouched — `__tumble.fold()` still reports it and C24 reads it.
  tum.kickN = tum.solid ? tumAt(K.kick, t) : 0;    // 0..1, the contact's snap
  tum.backN = tum.solid ? tumAt(K.back, t) : 0;    // 0..1, laid out along the slide
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
  // specs/0036 §1 — off `camRoll`, not `roll`. `applyTo` is untouched: fp still
  // takes `wobR` in full and the chase still takes half of it, and both are now
  // one wobble because the number underneath them is.
  tum.camR = tum.camRoll * a;
  // specs/0034 §2 — "the eye follows: in first person the horizon rolls with the
  // body through that turn". The lens is `YXZ`, so its z IS the view axis, and
  // the view axis is the axis the body is rolling about: the same radian on the
  // camera and on the rig, which is the whole reason both are read off `tum`.
  //
  // SEPARATE from camR, and this is the point of it: the chase camera takes half
  // of camR, which is right for a lean and catastrophic for a turn — at 0.75 s
  // third person would be looking at a hillside standing on its side. The turn
  // belongs to the eye that is INSIDE the body. The chase watches the body do it.
  tum.camLog = tum.logRoll * a;
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
    // ...and specs/0034's full turn does NOT appear here, which is a statement
    // about the rig and not an omission. updateVisuals poses mBody as 'XZY', so
    // the turn is a rotation about the spine and the head sits ON that axis:
    // Rx.Rz.Ry.(0, h, 0) = Rx.Rz.(0, h, 0), the log roll divides out exactly.
    // A head that moved when the body log-rolled would be a head on a pole.
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
  // specs/0034 §3.2 asserts on the BODY ROLL, which is now two numbers: the lean
  // and the chatter on `roll` (mBody's z) and the full turn on `logRoll`
  // (mBody's y). `rollTotal` is what the body has actually turned through about
  // the travel axis and is the column the trace prints.
  roll: () => +tum.roll.toFixed(4),
  camRoll: () => +tum.camRoll.toFixed(4),   // specs/0036 — the LENS's roll
  logRoll: () => +tum.logRoll.toFixed(4),
  rollTotal: () => +(tum.roll + tum.logRoll).toFixed(4),
  pose: () => ({
    t: +tum.t.toFixed(4), auth: +tum.auth.toFixed(4), pitch: +tum.pitch.toFixed(4),
    roll: +tum.roll.toFixed(4), camRoll: +tum.camRoll.toFixed(4),
    logRoll: +tum.logRoll.toFixed(4),
    rollTotal: +(tum.roll + tum.logRoll).toFixed(4),
    spin: +tum.spin.toFixed(4), sink: +tum.sink.toFixed(4),
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
  // specs/0063 §1 — the AIR chase heading. `AIR_TRACK` is deliberately the same
  // 9 s⁻¹ the chase POSITION is eased at a hundred lines below: the air follow
  // is not a new feel, it is the existing follow pointed at the velocity vector
  // instead of at the body, so it must not introduce a second rate to tune.
  // `AIR_VMIN` is the glider's own "is there a track to fly down" gate, reused.
  const AIR_TRACK = 9, AIR_VMIN = 0.5 * u;
  // specs/0063 §2 — how fast the lens rolls the LEFTOVER flip out after touchdown.
  // `trickPose()` goes null the instant the judge closes the air, and a Double
  // Back Flip does not close on a whole turn: measured, the last airborne frame
  // is at −397° and the next is at 0, a 37° / 0.65 rad snap in ONE frame — 46
  // rad/s, seven times the flip's own 6.40 rad/s, and the one thing in this spec
  // that actually tears at 60 fps. It is not capped, because capping the RATE
  // would flatten the trick itself; the residual is rolled out instead, so the
  // landing reads as the body coming back upright rather than as a cut. 6 s⁻¹
  // puts the first frame of that roll-out at 3.7 rad/s and empties it in ~0.4 s.
  // It is under the flip's own rate ON PURPOSE, because the roll-out lands on
  // exactly the frames the landing kick is already on — 6.58 rad/s in the build
  // before this spec — and the two ADD: at 10 s⁻¹ the pair peaked at 12.57 rad/s,
  // 12° in one frame, which is the edge of visible. At 6 it is not.
  const FLIP_OUT = 6;
  // specs/0065 — THE GROUNDED LOOK. On the snow ↑ ↓ used to be exact aliases of
  // the W/S push (ski.js §2.1); they now aim the view instead, and the push is W
  // and S alone. `look` is a PITCH OFFSET ADDED TO THE EYE LINE and never a write
  // to `ctrl.pitch`: that angle is the mouse look, and boots, the glider, the
  // rocket and updateWalk all steer off it, so a keyboard that moved it would be
  // a control input rather than a camera. Written here, read by two expressions,
  // both inside this rig — which is what keeps the spec's "the camera reads state
  // and never writes it" true and keeps `stepFixed` bit-identical.
  //
  // IT LATCHES (Greg, 2026-09-06: "when I look down using arrow keys and let go it
  // looks back up instead of staying down and same for up. I need it to stay").
  // The first cut relaxed the offset out at 8 s⁻¹ on release; that is withdrawn.
  // The offset is a VIEW you set and keep, not a gesture you hold — you aim down
  // the fall line once and ski, rather than skiing with a key held down. Letting
  // go changes nothing at all; the opposite arrow drives it back through 0 and out
  // the other side, which is the only way back and is also the only one a player
  // needs. `LOOK_OUT` is gone with the decay it named.
  //
  // AND THE STICK IS INVERTED (Greg, same day: "also up arrow should look down and
  // down arrow should look up"). ArrowUp pitches the view DOWN the hill and
  // ArrowDown pitches it back UP — a flight stick, not a mouse. So the ramp's sign
  // is the OPPOSITE of `ctrl.pitch`'s, and it is applied once, here, at the one
  // place the key is read.
  const LOOK_RATE = 120 * Math.PI / 180;       // rad/s while held (Greg, 2026-09-06: "double it")
  const LOOK_MAX = 45 * Math.PI / 180;         // rad off the body's natural eye line
  // ...and the SUM is clamped to ctrl.look's own limit, so a rider already looking
  // at his boots cannot arrow the lens over the top and invert the horizon.
  const PITCH_MAX = Math.PI / 2 - 0.02;
  // specs/0065 (smooth round) — NO VIEW TELEPORTS (Greg: "make sure that when i
  // jump/land it doesnt teleport my viewing angle to something unexpected").
  // Traced frame by frame on a 30° face, the build before this round stepped the
  // first-person lens by 29.4° in ONE frame at take-off (the latch cut to 0),
  // 19.6° at touchdown and 36.8°–47.2° at the two edges of a wipeout. Three
  // numbers close all four:
  //
  //   LOOK_OFF   the latch is no longer CUT when you leave the ground — it is
  //              driven to 0 at a linear 150°/s, so a full 45° empties in 0.30 s
  //              and no frame at 60 fps can move more than 2.5°. Linear rather
  //              than exponential on purpose: an exponential's FIRST frame is its
  //              biggest, which is the one frame this round exists to bound.
  //   SETTLE_W   the hand-overs — touchdown, and either edge of a tumble — are
  //              absorbed instead of shown. The error between what the lens was
  //              showing and what the new regime wants is captured on the edge
  //              frame and released critically damped (ζ = 1, released from rest,
  //              so no overshoot by construction): 5 % in ~0.37 s.
  //   LENS_SLEW  and a hard bound under it. On a GROUNDED frame nothing may move
  //              the camera's own pitch faster than this, which is above the
  //              120°/s ramp and below 3° in a 60 fps frame. It can only ever bite
  //              on the first frames of a >40° hand-over, which is exactly where a
  //              spring alone would still sprint.
  const LOOK_OFF = 150 * Math.PI / 180;        // rad/s — the take-off blend-out
  const SETTLE_W = 13;                         // s⁻¹, critically damped
  const LENS_SLEW = 170 * Math.PI / 180;       // rad/s — 2.83°/frame at 60 fps
  let look = 0;
  const lookPitch = () => Math.max(-PITCH_MAX, Math.min(PITCH_MAX, ctrl.pitch + look));
  // The EXTRA is everything camRig adds to the eye on top of `lookPitch()`: the
  // landing dip, 0015's tumble pitch and 0063's flip. It is solved in update()
  // and read by applyTo(), and it is the number the settle and the slew act on —
  // never on `lookPitch()` itself, because that would put the mouse look behind a
  // filter, and never on the AIRBORNE flip, which 0063 throws at 6.4 rad/s
  // deliberately and unclamped.
  let extra = 0, settleErr = 0, settleV = 0;
  let wasGround = true, wasTum = false;
  // specs/0065 (2026-09-06) — THE CHASE IS THE DEFAULT. Greg: "can you make it
  // start on third person by default". Nothing in the build persists a camera
  // choice, so this literal is the only source of one; C still toggles, and a
  // choice made in a session survives a fast travel and a respawn because neither
  // path calls setMode().
  let mode = 'tp';
  let fov = FOV_BASE;
  let prevSp = 0, accelSm = 0;                 // smoothed dSpeed/dt — the G's
  let kickT = -1, kickAmp = 0;
  let t = 0;
  const state = { spN: 0, bob: 0, tipRise: 0, crouch: 0 };
  const shake = { x: 0, y: 0, z: 0, r: 0 };
  // `wobLog` is specs/0034 §2's full turn, kept apart from `wobR` because only
  // the first-person lens takes it (the chase takes half of wobR, and half of a
  // turn is a hillside on its side).
  let dip = 0, wobP = 0, wobR = 0, wobY = 0, wobLog = 0;
  let bodyYaw = 0;                             // where the body points: the track when flying, else the look
  // specs/0063 §1 — the latched air heading, and whether it is latched. Both are
  // camera-local: nothing outside this rig reads or writes them, so the spec's
  // "the camera reads state and never writes it" survives intact.
  let chaseYaw = 0, chaseAir = false;
  let flipLens = 0, flipLive = false;          // specs/0063 §2 — the fp lens's flip, solved in update()
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
    wobP = tum.camP; wobR = tum.camR; wobY = tum.camY; wobLog = tum.camLog;

    // ---- specs/0063 §2 — the first-person lens's flip. Solved HERE, on the
    // update line, and only READ by applyTo() — exactly the arrangement wobP /
    // wobR / wobY are under, and for the same reason: applyTo() has no dt and is
    // called more than once a frame (boot, respawn, the 0058 replay's applyCam),
    // so anything with a memory in it has to live on the line that runs once.
    // The dt is the frame's REAL dt (0060 §1), which is what this function is
    // handed. `trickPose()` reads tricks.js and writes nothing.
    //
    // `trickPose().flip` is the ACCUMULATED rotation, not the remainder: a Double
    // Back Flip hands over −6.93 rad (−397°). As a Euler term that is right — the
    // lens wraps, and −6.93 draws as −0.65 — but as the START OF A DECAY it is a
    // disaster, because rolling 6.93 rad out spins the lens a whole extra turn on
    // the snow. Measured that way round: 49 rad/s, against the 7.13 the landing
    // kick alone produces. So the residual is wrapped into (−π, π] on the falling
    // edge and only then rolled out — the 0.65 rad the rider is actually still
    // tipped by, and nothing else.
    const tpose = ctrl.grounded ? null : tricks.trickPose();
    if (tpose) { flipLens = tpose.flip || 0; flipLive = true; }
    else {
      if (flipLive) { flipLens = angDiff(flipLens, 0); flipLive = false; }
      if (flipLens !== 0) {
        flipLens *= Math.exp(-FLIP_OUT * dt);
        if (Math.abs(flipLens) < 1e-4) flipLens = 0;
      }
    }

    // ---- specs/0065 — the grounded look. Solved on the update line for exactly
    // the reason the flip above is: it has a memory, and applyTo() has no dt and
    // runs more than once a frame. GROUNDED AND RIDING ONLY — in boots the arrows
    // still walk (controller.js updateWalk), so a look there would tip the lens
    // every time you stepped backward; in the air tricks.js has the keys and 0063
    // has the lens; and a wipeout already owns the eye.
    //
    // AND THOSE THREE ARE THE WHOLE OF THE RESET. Because the offset now latches,
    // "when does it go back to 0" is a real question with exactly three answers,
    // and all three are this one predicate going false: TAKE-OFF (0063's air lens
    // takes the eye, and it must take a level one — which also means a landing
    // starts at 0, so a jump is the quick way to straighten up), a WIPEOUT (the
    // tumble owns the eye and hands it back level), and stepping off the gear.
    // The fourth is the C toggle, and it is at `toggle()`/`setMode()` because it
    // is not a frame condition — see there. Nothing else clears it: releasing the
    // key does not, and neither does time.
    const lk = ctrl.keys;
    const lArmed = ctrl.grounded && riding && !tum.on;
    // ArrowUp looks DOWN, ArrowDown looks UP — the flight-stick sense, which is
    // the opposite of ctrl.pitch's. Both held is 0, and 0 now means HOLD.
    const lWant = lArmed ? ((lk.flipBack ? 1 : 0) + (lk.flipFwd ? -1 : 0)) : 0;
    // specs/0065 (smooth round) — off the ground the latch is DRIVEN out, not cut.
    // It still ends at 0, so a landing still starts from 0 — "the latch value after
    // landing is whatever the settle leaves" — but the way there is a 0.30 s move
    // instead of a one-frame 29° jump, which is what the trace caught.
    if (!lArmed) look -= Math.sign(look) * Math.min(Math.abs(look), LOOK_OFF * dt);
    else if (lWant) look = Math.max(-LOOK_MAX, Math.min(LOOK_MAX, look + lWant * LOOK_RATE * dt));

    // ---- specs/0065 (smooth round) — THE HAND-OVERS, ABSORBED.
    // `extraWant` is every pitch term the rig adds on top of the eye line. Its
    // three sources all step: the tumble's pitch arrives and leaves in one frame
    // (0015), the flip's residual is handed over on the touchdown frame (0063),
    // and the landing dip starts on the same frame. On an EDGE — touchdown, or
    // either side of a tumble — the difference between what the lens was showing
    // and what the new regime wants is taken out of the picture and put into
    // `settleErr`, which is then released critically damped: the frame is
    // continuous by construction, and the eye arrives where the regime wanted it
    // ~0.37 s later, having settled to the ordinary riding eye line — the fall
    // line you are travelling down, with nothing left over from the air.
    const extraWant = wobP - flipLens - (dip / u) * 0.5;
    const edge = (ctrl.grounded && !wasGround) || (tum.on !== wasTum);
    if (edge) { settleErr = extra - extraWant; settleV = 0; }
    wasGround = ctrl.grounded; wasTum = tum.on;
    if (settleErr !== 0 || settleV !== 0) {
      settleV += (-2 * SETTLE_W * settleV - SETTLE_W * SETTLE_W * settleErr) * dt;
      settleErr += settleV * dt;
      if (Math.abs(settleErr) < 1e-4 && Math.abs(settleV) < 1e-3) { settleErr = 0; settleV = 0; }
    }
    let extraNow = extraWant + settleErr;
    // ...and the bound. GROUNDED ONLY: in the air 0063 owns the lens outright and
    // throws it at seven times this rate on purpose.
    if (ctrl.grounded) {
      const cap = LENS_SLEW * dt, d = extraNow - extra;
      if (Math.abs(d) > cap) extraNow = extra + Math.sign(d) * cap;
    }
    extra = extraNow;

    // ---- shared animation state for the visuals
    state.bob += dt * (2 + 9 * spN);
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
    const vh = Math.hypot(vel.x, vel.z);
    bodyYaw = flying && vh > 0.5 * u
      ? Math.atan2(-vel.x, -vel.z) : ctrl.yaw;
    // specs/0063 §1 — AIRBORNE, THE FOLLOW COMES OFF THE BODY ENTIRELY. On the
    // snow `ctrl.yaw` IS the heading you are steering and the chase should sit
    // behind it, unchanged. In the air `spinTorque` writes that same yaw through
    // a whole 360, so a chase that keeps reading it whips round with the trick
    // and takes the landing out of frame — you spin, and the picture does not.
    //
    // The latch is the take-off VELOCITY heading rather than the last grounded
    // follow yaw for two reasons (§1): the landing lies down the ballistic path,
    // which is the horizontal velocity; and the pop is paid inside popWindow
    // with an edge still down, so the last grounded yaw is already part-way into
    // the rotation and would latch the camera off by however early you started
    // spinning. Held after that, and steered by the velocity vector ONLY — which
    // is also why a grab, a tweak or rail yaw cannot turn the chase either: all
    // three are body yaw, and body yaw stops being an input the moment you leave
    // the ground. Under AIR_VMIN (a dead-vertical pop) there is no track to
    // point down and the heading simply holds where it was latched.
    //
    // Every branch here is behind `!ctrl.grounded`. A grounded frame runs the
    // first arm, which leaves `bodyYaw` exactly as the two lines above wrote it,
    // so the grounded chase is the same expression it always was — measured, not
    // asserted: §4 D1 traces a carve before and after at max delta 0.000. A
    // tumble takes the same arm, so 0015's crash camera is untouched, and so is
    // the glider, which has ridden its own velocity heading since the wing shipped.
    if (ctrl.grounded || flying || tum.on || !riding) { chaseAir = false; chaseYaw = bodyYaw; }
    else {
      const velYaw = vh > AIR_VMIN ? Math.atan2(-vel.x, -vel.z) : null;
      if (!chaseAir) { chaseAir = true; chaseYaw = velYaw === null ? bodyYaw : velYaw; }
      else if (velYaw !== null) chaseYaw += angDiff(velYaw, chaseYaw) * (1 - Math.exp(-AIR_TRACK * dt));
      bodyYaw = chaseYaw;
    }
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
    // specs/0065 — AND THE CHASE TAKES THE SAME LOOK. The chase already had an
    // elevation-from-pitch term right here; `look` joins `ctrl.pitch` INSIDE the
    // existing sin rather than getting geometry of its own, so it is the orbit
    // elevation moving within the envelope it already had — no new rate to tune,
    // and the hillside raycast forty lines down still keeps the eye out of the
    // snow. At −45° of look the eye rises ~1.7 m on the orbit and the chase
    // pitches ~18° further down, which is what "see over the lip" costs.
    const height = (flying ? 2.05 + 0.50 * spN : 2.1 + 0.6 * spN) * u
      - Math.sin(lookPitch()) * (flying ? 1.7 : 2.4) * u - TUM.CHASE_DOWN * u * tum.auth;
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
      // specs/0063 §2 — THE LENS TAKES THE FLIP. `trickPose().flip` is the
      // off-axis half of the air rotation in radians (the spin half is already
      // on screen in both views: spinTorque writes ctrl.yaw and the line below
      // reads it, which is why first person has always turned with a 360). It
      // used to be applied to `fpRig` instead — `fpRig.rotateX(-flip)` in
      // updateVisuals — and a ski rig that pitches while the lens does not is
      // precisely "the skis detach and orbit the character". Moving the SAME
      // rotation onto the lens leaves the skis in the world orientation they
      // always had (fpRig copies this quaternion), but now they are pinned in
      // frame and the horizon rolls past them, which is what a flip looks like
      // from inside it. `rotation.order` is 'YXZ', so this lands after the yaw
      // and about the body's own right axis — the flip axis. Nothing is clamped:
      // the horizon goes fully over, as far as the trick goes. `trickPose()` is
      // null unless `S.air`, so 0034 §2's grounded horizon roll below is not in
      // this path at all, and third person gains no flip term. `flipLens` is
      // update()'s solved value — the trick's flip exactly while it is being
      // thrown, then FLIP_OUT rolling the leftover out after touchdown.
      // specs/0065 — `lookPitch()` is `ctrl.pitch + look`, clamped to the mouse
      // look's own limit. On a grounded frame with no arrow held it IS `ctrl.pitch`,
      // and `flipLens` is 0 on every grounded frame, so the look and the flip never
      // compose. specs/0065 (smooth round) — the three terms that used to be added
      // here, `-(dip/u)*0.5 + wobP - flipLens`, are now `extra`: the SAME sum,
      // solved on the update line so it can carry the settle and the slew across a
      // hand-over. Airborne `extra` IS that sum to the last float, so 0063's flip is
      // untouched — same rate, same lack of a clamp, the horizon still goes fully
      // over. `lookPitch()` is deliberately outside it: a filter on the mouse look
      // is a filter on the player's own hand.
      cam.rotation.set(
        lookPitch() + extra,
        ctrl.yaw + wobY,
        // specs/0034 §2 — ...and the horizon goes round with the body through the
        // turn. `EYE_FLOOR` and the stem push-out are untouched: they are done in
        // tumbleStep() on the eye's POSITION, and this is only where it is looking.
        (riding ? ctrl.lean * leanMul : 0) + shake.r + wobR + wobLog,
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
    get look() { return look; },                 // specs/0065 — read-only, for the gate
    get lookPitch() { return lookPitch(); },
    // specs/0065 — C CLEARS THE LOOK. The offset latches, and the two views wear
    // it differently (a lens pitch in first person, an orbit elevation in the
    // chase), so carrying it across the cut is carrying a number the player set
    // while looking at a different picture. Switching view is also the one thing
    // a player does when the view is wrong, which makes C the natural "level me"
    // and saves the offset needing a key of its own.
    // specs/0065 (smooth round) — and C does not teleport the lens either. The
    // latch still goes to 0, but the angle it was showing is handed to the same
    // settle the touchdown uses, so a C pressed while looking 45° down eases out
    // over ~0.37 s rather than cutting. Between two DIFFERENT views the cut is
    // invisible anyway; it is `setCamMode(current)` — which the gates call — that
    // would otherwise flick.
    toggle() { mode = mode === 'fp' ? 'tp' : 'fp'; settleErr += look; settleV = 0; look = 0; return mode; },
    setMode(m) { mode = m === 'tp' ? 'tp' : 'fp'; settleErr += look; settleV = 0; look = 0; return mode; },
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
  // specs/0041 §4.7 — the rack the body is riding this frame, or null on foot /
  // on skis. Written by the mount copy below and read twice after it: by the
  // tumble gate (a racked wipeout is the RACK's cartwheel) and by `rig.update`,
  // whose `o.mount` hides the poles. Both writer and readers live in this
  // function, so it is a local rather than the module-level `let` §4.7 implies —
  // a module-level declaration would be a hunk outside every C18 range (§6.2).
  let mount = null;
  // §4.6 — what `tpPilot.rotation.x = aoa * 0.25` used to be: the body lags a beat
  // behind the wing it is hanging from. Set in the glider block, spent by the copy.
  let glideLag = 0;

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
    glideLag = aoa * 0.25;
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
    const fpSkiHeight = alpinePolish ? -1.10 : -0.88;
    fpSkiL.position.y = fpSkiHeight * u + Math.sin(st.bob) * amp;
    fpSkiR.position.y = fpSkiHeight * u + Math.sin(st.bob + 1.7) * amp;
    fpSkiL.rotation.x = st.tipRise;            // tips rise off a jump
    fpSkiR.rotation.x = st.tipRise * 0.92;
    rollSkiRigs([fpSkiL, fpSkiR], 0.9);        // ...and go up on edge in a turn
    // specs/0063 §2 — the flip used to be thrown on this rig
    // (`fpRig.rotateX(-trickPose().flip)`) on the argument that pitching the lens
    // through a Double Rodeo would make somebody put the mouse down. Greg, having
    // watched it: "in first person, cam should follow the flip instead of skis
    // detaching around character" — which is what a rig pitching inside a lens
    // that does not is. The rotation now lives on the lens (camRig.applyTo), and
    // this rig copies that quaternion three lines up, so the skis come out in the
    // same world orientation and are pinned in frame instead of orbiting. There
    // is nothing to add here any more.
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
    const onBike = ctrl.mode === 'bike';
    tpGlide.visible = glideAir;
    tpBike.visible = onBike;
    tpSled.visible = onSled;
    tpSnow.visible = onSnow;
    // specs/0041 §4.7 — the skinned body is the ONLY rider anywhere now, so it no
    // longer steps aside for a rack's own doll: there is no doll. It rides the
    // rack through the mount copy below and is posed by §3.8's four seat clips.
    mBody.visible = true;
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
    // ---- specs/0041 §4.7: THE MOUNT COPY, and it runs on EVERY tp frame.
    //
    // The racks stopped building riders, so `play:body` is the only rider in the
    // scene — but it stays a child of `model` and is never re-parented onto a
    // rack, because the locker clones `model` and hides every `play:tp-*` rig by
    // pattern (inventory.js), and a body living inside a rack group would vanish
    // with it. The rack's own local transform is COPIED onto the body instead:
    // the sled's cartwheel, the snowmobile's roll, the bike's crouch squat and
    // the glider's flight-path pitch all reach the rider through these lines.
    //
    // Where it sits in the frame is load-bearing twice over. It is before the
    // tumble block below, and it is the replacement for the pose block's old
    // per-frame reset of `mBody.position.y`: the tumble's `+= (-tum.sink - y) * a`
    // is a LERP, not an assignment, so on a frame this copy skipped the body would
    // stay sunk for the rest of the session after one wipe.
    //
    // `.x`/`.z` one at a time and never `rotation.copy()`: `mBody.rotation.order`
    // is 'XZY' from the first tumble frame on, and `copy()` carries the SOURCE's.
    mount = onBike ? tpBike : onSled ? tpSled : onSnow ? tpSnow
          : glideAir ? tpGlide : null;
    mBody.position.copy(mount ? mount.position : ZERO);
    if (alpinePolish && ski && !mount) mBody.position.y += POLISHED_RIDER_LIFT * u;
    mBody.rotation.x = mount ? mount.rotation.x + (mount === tpGlide ? glideLag : 0) : 0;
    // the no-rack branch is verbatim what this line said on its own before (§4.6:
    // it is rewritten, not kept) — the legs and hips follow the edges a little,
    // and a third of the edge angle is as much lower body as the root can spend.
    mBody.rotation.z = mount ? mount.rotation.z : (ski ? skiState().roll * 0.30 : 0);
    if (onBike) {
      // §4.7 — `seat-bike` is authored against `lab-standard`, so the whole body
      // moves per model off `bikeRider()`. INSIDE this block and never a standalone
      // `+=` on a later line: a `+=` on a frame the copy skipped accumulates every
      // frame. It is the trick `seatFpBike` already uses for the fp bike.
      const R = bikeRider(getBikeModel(bikeId));
      mBody.position.y += (R.hip[0] - 1.0530) * u;
      mBody.position.z += (R.hip[1] - 0.3050) * u;
    }
    // §4.6 — the five writes that stood here are clip keys now: the walk bob and
    // the −0.34 u·c drop are `walk`/`run`'s own `hips.pos` and the tuck's solved
    // hips (§3.7), the 0.55 c pitch is the tuck's spine, and the two arm rotations
    // are `ski-tuck`'s 0.90 and the A-pose's ±0.22 at rest (§2.2). `0.55 c` and
    // `−0.34 u·c` survive in exactly one place, `__tumble.headY()`, where they
    // stop describing what the root does and become the specification of where
    // the head IS (D-B). `c` stays because §4.6 keeps it — it is the tuck scrub's
    // phase, which rider.js reads for itself off `camRig.state.crouch`.
    const c = riding && !glide ? st.crouch : 0;
    mBody.rotation.y = 0;                      // ...and no log roll while riding
                                               // (specs/0034 §2 writes it below)
    mSkiL.visible = mSkiR.visible = ski;       // (bike riders get no skis; the
    if (ski) {                                 // bike model is the bike agent's)
      mSkiL.rotation.x = st.tipRise * 0.8;
      mSkiR.rotation.x = st.tipRise * 0.72;
      mSkiL.rotation.y = 0; mSkiR.rotation.y = 0;
      mSkiL.position.y = SKI_STANCE.y; mSkiR.position.y = SKI_STANCE.y;
      rollSkiRigs([mSkiL, mSkiR]);             // the edges, from ski.js
    }

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
    // §4.7 — `!mount`, which is behaviour-identical to the old `mBody.visible`:
    // that flag was false in exactly the four cases `mount` is non-null. A racked
    // wipeout stays the rack's cartwheel and the body rides it through the copy.
    if (tum.on && !mount) {
      const a = tum.auth;
      mBody.rotation.x = mBody.rotation.x + (tum.pitch - mBody.rotation.x) * a;
      mBody.rotation.z = mBody.rotation.z + (tum.roll - mBody.rotation.z) * a;
      // specs/0034 §2 — the full turn, about the spine, which the pitch above has
      // already laid along the direction of travel. Blended by `auth` like every
      // other value here, and 0 at both ends of the wipe on its own account: the
      // track is flat until 0.35 s and sits on a whole turn from 1.15 s, so the
      // body enters and leaves this rotation on the same pose either way. The
      // arms, the legs, the head and the pack are CHILDREN of mBody and come with
      // it for free; the skis are not, and are carried by hand below.
      //
      // THE EULER ORDER IS LOad-BEARING and it is why this line is here rather
      // than in the rig's constructor. Default 'XYZ' composes as Rx.Ry.Rz, which
      // applies the log roll to a body the PRONE_ROLL has already leaned — so the
      // head, 0.6 m off the spine at 0.40 rad of lean, ORBITS the roll axis, and
      // since that axis is the pivot at the feet it spends half the turn under
      // the snow. Measured on the first cut: headY −0.2261 m at t = 0.55 s.
      // 'XZY' composes as Rx.Rz.Ry: the turn happens FIRST, in the body's own
      // frame, so it is a roll about the spine — the head is on that axis and
      // does not move at all, exactly as a log-rolling body's head does not. With
      // rotation.y at 0 the two orders are the same matrix, which is why the
      // riding pose, the boot pose and 0015's whole no-wipe frame are untouched.
      mBody.rotation.order = 'XZY';
      mBody.rotation.y = tum.logRoll * a;
      // ABSOLUTE, not `-= sink`: the riding height is `-0.34 u * crouch`, and
      // crouch keeps easing all the way through a tumble because the scrub took
      // the speed that was holding it up. A body whose hips rose 0.1 m over the
      // 2.0 s it spent lying in the snow is a body floating off it.
      mBody.position.y += (-tum.sink - mBody.position.y) * a;
      // the arms — up and forward on the hit, splayed through the slide — are the
      // 4-pose tumble family's now (§4.4): rider.js weights `tum-fold`, `tum-kick`,
      // `tum-prone` and `tum-splay` off `tum.kickN`/`tum.backN` and the fold, and
      // the whole body goes over rather than two rigid boxes on the shoulders.
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
        // specs/0034 §2 — "keep them attached through the roll (they are on the
        // body)". They are children of `model` rather than of mBody, so the turn
        // has to be spent on them by hand, and it is a RIGID rotation about the
        // travel axis and not just a spin of the mesh: `model`'s own z is that
        // axis (its y aligned the body to the slide), so the pair orbit their
        // ±0.15 m stance about it and take the same radians on their own z —
        // which is what a ski attached to a boot does when the boot goes over,
        // and is why the strip's half-turn frame has the skis swung down through
        // the snow side while the poles have come over the top of the torso.
        // `position.x` is written from the rig's OWN stance (the ±0.15 u of
        // makeSki's placement) and not from itself, because unlike position.y and
        // rotation.z — both re-written from scratch every frame above — nothing
        // else in the frame resets it, and a value fed back into its own rotation
        // is a ski that walks sideways out of the model over a few hundred frames.
        //
        // fix/lost-ski — and it is `gearRestore()`, not this loop's own return
        // through lr → 0, that puts position.x back: the frame after the tumble
        // ends re-states the stance whether the wipe ran out or was cut short.
        const lr = tum.logRoll * a;
        const cs = Math.cos(lr), sn = Math.sin(lr);
        for (const [s, bx] of [[mSkiL, -SKI_STANCE.x], [mSkiR, SKI_STANCE.x]]) {
          const by = s.position.y;
          s.position.x = bx * cs - by * sn;
          s.position.y = bx * sn + by * cs;
          s.rotation.z += lr;
        }
      }
    }
    // third person sees the whole flip, which is the point of third person
    const tposeTp = ski ? tricks.trickPose() : null;
    model.rotation.x = tposeTp ? -tposeTp.flip : 0;
  }

  // ---- specs/0041 §4.2: THE RIG, and this is its only call site.
  //
  // OUTSIDE the `if (tp)` block: the same call poses the 17-bone fp rig, which is
  // the whole of first person on skis and on the bike now (§2.5). The clock is
  // `simTime` and never wall time — `rig.update` differences it itself, so the
  // pose is held exactly behind a pause (`live` stops advancing it, main.js's
  // frame loop) and one `stepFixed` burst of n·dt lands the same clip phase as n
  // frames of dt. `mount` is here for the poles: they come off on a rack (§2.6).
  //
  // The three calls inside it run mixer → the §4.5 procedural writes →
  // updateMatrixWorld, in that order and asserted by N17: a bone written BEFORE
  // the mixer is partially restored toward the bind pose by PropertyMixer.apply.
  // specs/0060 — `renderTime`, not `simTime`: the mixer is the one clock the
  // takeoff hitstop is allowed to slow, and it is the reason the effect reads as
  // the body hanging in the air rather than as a dropped frame. Outside a dip the
  // two clocks are equal to the float and this line is the line it always was.
  bootAttachment?.restore();
  rider.update(renderTime, ctrl, camRig, tum, { mount });
  bootAttachment?.update(ctrl.mode === 'skis' && !mount ? 1 - tum.auth : 0);
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
  // specs/0041 §4.7 — no `{ rider }` option: bike.js stopped building dolls. The
  // tp rider is `play:body` on `seat-bike`, the fp one is `play:fp-arms`.
  styleBikeRig(THREE, tpBike, bikeId);
  styleBikeRig(THREE, fpBikeInner, bikeId);
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
  // specs/0055 §5.2 — the locker's new TRAIL QUICK-TRAVEL tab derives its rows
  // from the world contract through spawn.js's `waypointIndex`, so it needs the
  // same two arguments `?spawn=` resolves with. Handing over the object main.js
  // already holds is the whole of the wiring: no list travels with it, and a
  // world that declares no markers, runs or lifts simply has an empty tab.
  world, upAxis,
  // specs/0061 §1 — EQUIPPING A RUN. The locker asks for a trail; guide.js lays
  // it with the tutorial's own dye and chevrons. This seam exists so the locker
  // never imports guide.js: it is three calls wide, it is the only place the
  // HUD's F-precedence row is switched, and a build whose guide module failed to
  // load simply answers null and the tab keeps its fast travel.
  //
  // `window.__guide` rather than the `guideApi` binding below: this object is
  // built before the guide module is awaited, and reading a `let` that has not
  // been initialised yet is a ReferenceError, not a null.
  trail: {
    // specs/0061 (families, 2026-09-06) — `opts` rides through so the locker can
    // hand down the FAMILY's name (WEST FACE), which is what the flash says.
    lay: (id, opts) => {
      const g = window.__guide;
      const t = g && g.layTrail ? g.layTrail(id, opts || {}) : null;   // specs/0061 (families, 2026-09-06)
      hud.setTrailKey(!!t);
      if (t) hud.flash('trail · ' + String(t.name || id).toLowerCase());
      return t;
    },
    clear: () => {
      const g = window.__guide;
      const n = g && g.clearTrail ? g.clearTrail() : 0;
      hud.setTrailKey(false);
      return n;
    },
    state: () => {
      const g = window.__guide;
      return g && g.trailState ? g.trailState() : null;
    },
  },
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

// specs/0061 §2 — the other half of F. It flashes only when there was a trail
// to clear: a key that says something every time you press F short of a
// chairlift is noise, and F is already the no-op key out there.
function clearTrail(why) {
  const g = window.__guide;
  const was = g && g.trailState ? g.trailState() : null;
  const n = g && g.clearTrail ? g.clearTrail() : 0;
  hud.setTrailKey(false);
  if (was) hud.flash('trail cleared');
  return { props: n, was: was ? was.id : null, why: why || 'key' };
}

// --------------------------------------------------------- specs/0058 trace
// The ride recorder, and its replay. Unarmed it is `if (!on) return` on every
// seam below, and the public build does not carry the module at all (the
// exporter stubs it the way it stubs dev.js), so none of this reaches a player.
//
// It reads the controller and never writes to it: every event except the three
// marked below is DERIVED from counters controller.js already publishes, and
// the heading input is the difference across ctrl.update() rather than a
// wrapper on ctrl.look — so nothing here monkey-patches the player.
//
// `step`, `setMode`, `applyCam` and `pause` are the four things only main.js
// can reach; recorder.js owns everything else about replay, including
// `?replay=`, so this file carries no part of it. `step` is EXACTLY the pair
// __player.stepFixed drives, which is what makes a replayed tick and a played
// one indistinguishable.
const rec = createRecorder({
  ctrl, collision, cfg,
  armed: !!(DEBUG_HUD || (cfg.qs && (cfg.qs.has('dev') || cfg.qs.has('trace') || cfg.qs.has('replay')))),
  hooks: {
    pause: (v) => hud.setPaused(!!v),
    flash: (m) => hud.flash(m),
    setMode: (m) => ctrl.setMode(m),
    // specs/0060 — `renderTime` tracks `simTime` on every DETERMINISTIC stepper.
    // The dip is a wall-clock effect on the rAF line and has no business existing
    // in a replay, so this path advances the two clocks together and the mixer
    // sees exactly the argument it saw before that spec.
    step: (dt) => { ctrl.update(dt); playerSystems(dt, true); simTime += dt; renderTime += dt; },
    applyCam: () => camRig.applyTo(camera),
    // specs/0058 §1.8 — the equipment, which is physics: every rack's tuning
    // function rewrites the LIVE object the controller's registry holds, so a
    // bag that does not carry the ski replays on somebody else's slopeAccel.
    // Read from the resolved ids, not from storage, because `?ski=` has already
    // beaten storage by the time these exist.
    gear: () => ({ ski: skiId, bike: bikeId, glider: gliderId, sled: sledId,
                   snowmobile: snowmobileId, boots: inv.equipped().boots || null }),
    // ...and putting it back on. `remember: false` because a replay must not
    // overwrite what the operator's own browser remembers, and `equip: false`
    // because arm() sets the gear from the segment header on the next line.
    setGear: (field, id) => {
      if (field === 'ski') return applySki(id, { remember: false });
      if (field === 'bike') return applyBike(id, { remember: false });
      if (field === 'glider') return applyGlider(id, { remember: false, equip: false });
      if (field === 'sled') return applySled(id, { remember: false });
      if (field === 'snowmobile') return applySnowmobile(id, { remember: false });
      return null;      // `boots` has no per-model tuning to apply (specs/0058 §1.8)
    },
    snapshot: () => {
      try { world.renderer.render(world.scene, camera); } catch { /* the scene owns its loop */ }
      try { return world.renderer.domElement.toDataURL('image/png'); } catch { return null; }
    },
    view: () => ({ position: [ctrl.position.x, ctrl.position.y + ctrl.T.eyeHeight, ctrl.position.z],
                   yaw: ctrl.yaw, pitch: ctrl.pitch, fov: camera.fov }),
    buildInfo: () => ({ adapter: world.adapter, unitScale, defaultGear,
                        pin: (cfg.qs && cfg.qs.get('pin')) || null }),
  },
});

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
    // specs/0051 §2.8 path 1 — the documented seam. The pin builds the
    // destination's 8 x 8 L0 block SYNCHRONOUSLY, before the body is moved, so
    // the frame the player lands in already has collision under it. §7.1's
    // fast-travel probe asserts it resolves in <= 5 frames; it resolves in 0.
    collision.pinSync(p, 'teleport');
    const out = rawTeleport(p, y);
    fastTravel.at = { x: p.x, y: p.y, z: p.z };
    fastTravel.yaw = y === undefined ? ctrl.yaw : y;
    fastTravel.source = 'teleport';        // a caller may name itself after
    fastTravel.n++;
    ctrl.setHome(p, fastTravel.yaw, 0);
    rec.mark(TRACE_EV.teleport);           // specs/0058 1.5 — re-home path #1
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
  scene: world.scene, runs: world.runs, terrainHeight,
  onRide: (u, L) => {
    fastTravel.source = 'lift · ' + (L && L.name ? L.name : '');
    rec.mark(TRACE_EV.liftBoard);          // specs/0058 1.5
  },
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
// specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI) -- the switch can be thrown
// FROM INSIDE dev mode: the locker opens over it. `available()` already stops
// F8 from re-entering, but nothing would have taken us back OUT, and the fly
// camera with its band and its slates is the loudest lab surface there is. So
// the one event flags.js fires also flies the builder home.
addEventListener('play:labui', (e) => { if (!e.detail && dev.active()) dev.setActive(false); });
function applyCamera() {
  if (dev.active()) dev.applyTo(camera); else camRig.applyTo(camera);
}
const typingIn = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// ------------------------------------------------------------------ input
window.__playFX.init({ THREE, scene: world.scene, camera, renderer: world.renderer, ctrl, hud });
// specs/0046 §4.3 — the aura. Built HERE, beside the fx init, because the two
// lights the isolate pass borrows are fx.js's and exist by this line. It owns the
// player's one render call from now on and falls through to `renderer.render` on
// every device §4.6 turns it off for, which is what makes `?bloom=0` a control.
const riderBloom = makeBloom(THREE, world.renderer, world.scene, camera);
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

// The arrows used to be plain W/S duplicates. They are now their own axis, and
// specs/0065 finished the job: GROUNDED they AIM THE VIEW — camRig's `look`
// pitches the eye (and the chase's orbit elevation) at 60°/s and clamps at ±45°.
// specs/0065 (latch round) — FLIGHT-STICK SENSE, so ArrowUp looks DOWN the fall
// line and ArrowDown looks back up; and LATCHED, so letting go keeps the view and
// only a take-off, a wipeout or C puts it back to 0 — while in the air they
// are the flip handles, and ← → the spin handles, and the two together are the
// trick table (tricks.js, spec 0002 §3). THE ARROWS NO LONGER PUSH: ski.js's
// ground alias to forward/back came off with 0065, so W and S are the whole
// signed push again. In boots they still walk (controller.js updateWalk), which
// is why the map below is unchanged and the split lives in the readers.
//
// SHIFT DOES NOTHING ON SKIS. It stopped being the second brake when S became
// the dedicated stop (§2.1), and the tricks wave briefly gave it the
// tuck/absorb job (§1.8) — that is now withdrawn: a skier holding SHIFT gets
// exactly the run they would have got without it, to the last float. The key is
// unchanged for every other gear, which is why it still sets `sprint` (boots
// sprint, the bike brakes, the sled drags its heels, the snowmobile lights its
// booster) and no longer sets `tuck`, which only ski.js ever read.
//
// specs/0057 §4.4 (B, Greg 2026-09-06) — B IS THE TRICK KEY. "Can you make b the
// trick key instead of space". It is an ordinary mapped key and it lives in this
// table rather than in a hand-written branch below, because that is the whole
// point of the change: the grab is now a LEVEL with a key of its own, so
// tricks.js reads `keys.grab` and Space went back to being nothing but the jump.
// B's old job — the lab's reference-photo viewer (hud.js) — moved to N, which no
// shipped or lab row used.
const KEYMAP = {
  KeyW: 'forward', KeyS: 'back',
  KeyA: 'left', KeyD: 'right',
  KeyB: 'grab',                                     // specs/0057 §4.4 (B, Greg 2026-09-06)
  ArrowUp: 'flipFwd', ArrowDown: 'flipBack',
  ArrowLeft: 'spinLeft', ArrowRight: 'spinRight',   // steer on the ground, hard spin in the air
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
};
// specs/0055 §5.1 (any key, Greg 2026-09-06) — the bare modifier keys. They are
// never a press on their own: they are the first half of a browser chord, and
// resuming on the Ctrl of a Ctrl+R would take the pointer back one keystroke
// before the reload. SHIFT is NOT here — it is a game key, and a player who
// leans on it to get going again should get going again.
const RESUME_SKIP = new Set([
  'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'ContextMenu',
]);
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
  // specs/0058 — the trace panel, and J. First refusal, so the note textarea
  // cannot leak a W into the mountain; `key()` is false for everything when the
  // recorder is not armed, which is every shipped path.
  if (rec.key(e.code, true)) { e.preventDefault(); return; }
  // the locker owns the whole keyboard while it is up — no key bleeds through
  if (inv.isOpen()) {
    e.preventDefault();
    // ...and the M that opened it, for the same reason (specs/0061, M opens the
    // map, 2026-09-06): a held key would toggle the screen it just opened.
    if (e.repeat && (e.code === 'KeyI' || e.code === 'KeyM' || e.code === 'Escape')) return;
    inv.key(e.code);
    if (!inv.isOpen()) enter();
    return;
  }
  // ===================== specs/0055 §5.1 (any key, Greg 2026-09-06)
  // THE PAUSE BOARD RESUMES ON ANY KEY. The plate says so now, so this is the
  // line that makes the plate true. It sits HERE and not higher on purpose:
  // everything above it is a surface that owns the whole keyboard while it is
  // open and would be un-openable if a keystroke resumed out from under it —
  // F8's dev mode, the specs/0058 trace recorder, the locker, a focused text
  // field. Everything BELOW it is a control that reads `!hud.isPaused()` and
  // does nothing while the board is up anyway; it now resumes instead, which is
  // the change. R is in that group: with the board up R is "resume", not
  // "reset", because the board's key list documents what the keys do ON THE
  // SNOW and the board's own offer is the one written on the plate.
  //
  // TRUSTED KEYS ONLY. `enter()` re-takes the pointer lock, and a script
  // dispatched KeyboardEvent carries no user activation — Chrome refuses
  // requestPointerLock from one, `pointerlockerror` fires and the board comes
  // straight back up. So an untrusted key cannot resume; it would only flicker
  // the board. Test hooks already have `__player.paused(false)`, which is a
  // statement rather than a guess.
  if (hud.isPaused() && e.isTrusted) {
    // A held key's auto-repeat is not a new press, and the browser's own chords
    // (Ctrl+R, Cmd+Tab, Ctrl+Shift+I) plus the bare modifiers that lead them
    // must reach the browser without dropping the board on the way.
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || RESUME_SKIP.has(e.code)) return;
    enter();
    // preventDefault only for keys with a default action the game cares about —
    // SPACE scrolls, TAB walks the focus ring. F5, F11 and F12 are deliberately
    // left alone: they resume AND still do their browser job.
    if (e.code === 'Space' || e.code === 'Tab' || KEYMAP[e.code]) e.preventDefault();
    return;
  }
  if (e.code === 'KeyI') {
    if (!hud.isPaused() && !e.repeat) { openLocker(); e.preventDefault(); }
    return;
  }
  // specs/0061 (M opens the map, 2026-09-06) — Greg: "M should auto open trails
  // tab". M is I plus one setTab: the same locker, opened straight onto the
  // trail tab, so the map and the run rows are one press from the mountain
  // instead of I-then-six-tabs.
  //
  // THE DEV BAR STILL OWNS M. `dev.active()` takes the whole keyboard forty
  // lines above this, before the locker or any other branch is consulted, so
  // dev.js's own M (`match()`, dev.js:1161) is untouched by this and needs no
  // test here — the dev bar cannot be open and this line be reached.
  if (e.code === 'KeyM') {
    if (!hud.isPaused() && !e.repeat) { openLocker(); inv.setTab('trails'); e.preventDefault(); }
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
    //
    // specs/0061 §2 — F's SECOND meaning, and THE LIFT WINS. `lifts.use()` is
    // asked first and returns the ride it just took, or null where there is no
    // terminal under you; only that null reaches the trail. So at a base
    // terminal F boards and the equipped trail is still there when you unload,
    // and anywhere else on the mountain F clears it. One handler, one order of
    // precedence, and the pause board prints it while a trail is equipped.
    if (!hud.isPaused() && !e.repeat) {
      // ...and guide.js's race circles are the OTHER thing F already means. Its
      // own listener is on the capture phase, so by the time this line runs a
      // start circle under you has already started a race; `raceOn()` says so,
      // and a trail must not be swept up by the same press that dropped you into
      // a slalom. Lift, then race, then the trail.
      const g = window.__guide;
      const racing = !!(g && g.raceOn && g.raceOn());
      if (!lifts.use() && !racing) clearTrail('key');
      e.preventDefault();
    }
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
    //
    // specs/0057 §4.4 (B, Greg 2026-09-06) — AND THAT IS ALL SPACE IS NOW. It
    // was also the grab while airborne; the grab is B (`keys.grab`, KEYMAP
    // above), so nothing on this line reaches tricks.js any more.
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
// specs/0060 — THE SECOND CLOCK. `simTime` is what the physics has stepped;
// `renderTime` is what the PRESENTATION has been shown. specs/0060 [freeze,
// 2026-09-06]: the two no longer come apart at all, because the hitstop is a
// whole-frame event and the mixer is slowed by the same `sdt` as everything else
// — `renderTime` is kept as the mixer's argument (`rig.update` differences it
// itself) and as the assertion that they agree.
let renderTime = 0;
// specs/0060 [freeze, 2026-09-06] — seconds of WALL clock the events have eaten:
// the whole of every frozen frame plus `(1 − rate)` of every slow one. The only
// consumer is a world that keeps its own animation clock, which is handed
// `now / 1000 - hsDebt` so it holds and slows with the rest of the picture.
let hsDebt = 0;
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
// specs/0055 §3.10 — VOID: A, "the closure rope". Greg picked A off
// lookbook.html #k-fence-void-fade; what shipped until now is that cell's B,
// the silent cooled fade. A gives the panel the only two marks a resort uses
// for "you are not allowed to be here" — the red X and the closure rope — plus
// the copy the fade has never had, so it can no longer be mistaken for the
// teleport flash, which is the opposite event drawn in the same white.
//
// The structure is the cell's, in order: a white wash, a rope across the top
// edge and another across the bottom, and a centred stack of X / AREA CLOSED /
// RETURNING YOU TO THE HILL. Every rule that positions and animates it is in
// intro.css beside the fade it replaces; this builds the nodes and nothing else.
const fenceFade = document.createElement('div');
fenceFade.className = 'fence-fade';
{
  // specs/0055 §3.10 — the picked cell's five parts, in its order.
  const fEl = (cls, txt) => {
    const d = document.createElement('div');
    d.className = cls;
    if (txt) d.textContent = txt;
    return d;
  };
  fenceFade.append(
    fEl('fence-fade__wash'),
    fEl('fence-fade__rope fence-fade__rope--t'),
    fEl('fence-fade__rope fence-fade__rope--b'),
  );
  const mid = fEl('fence-fade__mid');
  mid.append(fEl('fence-fade__x'), fEl('fence-fade__hd', 'AREA CLOSED'),
    fEl('fence-fade__sub', 'RETURNING YOU TO THE HILL'));
  fenceFade.append(mid);
}
document.body.appendChild(fenceFade);
// specs/0055 §3.10, the picked cell's own motion table: RISE 220 ms, ropes WIPE
// inward 260 ms, HOLD 900 ms, FALL 160 ms. Only the HOLD lives here — the other
// three are CSS transitions in intro.css. The respawn itself is NOT moved: it
// stays on the 280 ms mark specs/0058 §1.5 derives its second trace event from,
// so the hold runs across the respawn and the player comes out of the fade
// already back on the hill, which is what the sub-copy says will happen.
const FENCE_HOLD_MS = 900;
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
  rec.mark(TRACE_EV.fence);                // specs/0058 1.5 — the respawn 280 ms
                                           // later is a second, derived, event
  fenceFade.classList.add('is-on');
  setTimeout(() => {
    ctrl.respawn();
    camRig.applyTo(camera);
    // specs/0055 §3.10 — HOLD, then FALL. The panel has copy now and copy needs
    // frames; 280 ms of white was never long enough to read a word in.
    setTimeout(() => {
      fenceFade.classList.remove('is-on');
      setTimeout(() => { fencing = false; }, 320);
    }, FENCE_HOLD_MS);
  }, 280);
}

// specs/0055 §8 P3 — THE FORCED-DOM CENSUS HOOK for `fence-void-fade`.
//
// P3 forces all 39 INVENTORY.md panels visible, "test hooks first, real DOM
// second", and this panel is the one with no first option: `__player.fence()`
// returns null on this bench because no host sets `cfg.fence`, so fenceStep()
// returns on its own first line and the fade can never fire in play here
// (specs/0055 §3.10 says as much, and INVENTORY.md's own row records it).
// Without a hook the census can only reach the panel by hand-editing classes,
// which photographs a COPY of it; this drives the shipped element and the
// shipped class — the same two things fenceStep() touches — so what the gate
// counts and photographs is the real panel on the real stylesheet. It returns
// the class's live state so a caller can assert the force took.
//
// It is its own global rather than an `__player` key on purpose: `__player` is
// the game's API and `contract-check`'s C18 locks its key set, while
// `__playSurprise._test.forceFire()` is the shape the panel census already
// calls for exactly this job. One test surface per panel family, named for it.
window.__playFence = {
  force: (on) => {
    fenceFade.classList.toggle('is-on', on !== false);
    return fenceFade.classList.contains('is-on');
  },
};

let paidPumps = 0;        // pump transitions that actually paid, for the combo link
// The per-frame player systems that are NOT the controller: the trick/combo
// machine and the pump's instruments. Factored out because the deterministic
// test stepper (__player.stepFixed) has to drive exactly the same set — a trick
// accumulator that only advances under requestAnimationFrame is untestable.
// specs/0057 — the jib table, tipped once into the player frame. `world.jibs` is
// the run's own contract field (palisades-front's park.mjs builds it from the
// same expressions the geometry is drawn from); a world that declares none gets
// an empty table and every path in rail.js is a single false.
initRail({ ctrl, collision, unitScale, upAxis, jibs: world.jibs || [] });
// ...and the one wire back into the physics: §3.2's named additive term. rail.js
// pushes its bank here every step, including the decay off the jib, so ski.js's
// compression read sites see 0 the moment the bank is spent.
railFeed(setSkiRailComp);
function playerSystems(dt, live) {
  // specs/0057 — FIRST in the frame's systems, and after ctrl.update() in both
  // callers: tricks.js's combo (§4.3) and the HUD's timer (§4.4) read the jib
  // state THIS frame produced, not last frame's.
  railStep(dt, live);
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
    // specs/0055 §4/§5 (W7, Greg 2026-09-06) — the `hud.pump({...})` feed that
    // stood here is gone with the arc it drew. `ss.pumpQ` / `ss.pumpEta` /
    // `ss.releasing` are still produced and still read: `pumpLink` above is on
    // the same state, one line up.
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
  } else if (hud.lipMeter) { hud.lipMeter({ on: false }); }   // specs/0055 §4/§5 (W7, Greg 2026-09-06) — was `else if (hud.pump)`
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
// =============================================== specs/0060: THE TAKEOFF HITSTOP
//
// specs/0060 [freeze, 2026-09-06] — A WHOLE-FRAME EVENT, and no longer a dip in a
// second clock. Greg, after playing the tuned dip: *"The freeze frame threshold is
// too high, id like it to actually freeze for .25 seconds and then slomo for .75
// after that"*. The diagnosis is in the old design: only the rider mixer and the
// fx module took the scaled dt while the physics, the camera and the world all
// kept true time, so a 0.06 "hold" was one layer of the picture stalling against
// five that did not — a stutter, not a freeze frame. So:
//
//   FREEZE  0.10–0.25 s of wall clock. The sim is not stepped AT ALL. The frame
//           loop returns before anything advances and renders the same picture
//           again: the body, the camera, the HUD, the snow, the world's own
//           animation and the audio all hold. Only the tint moves, and it is CSS.
//   SLOMO   0.30–0.75 s at rate 0.45–0.30. Every consumer of the frame's dt takes
//           `sdt = dt · rate` instead — one number, applied once, so the WHOLE
//           world is in slow motion rather than the rider alone.
//   OVER    `sdt === dt`, bit-for-bit (`dt - 0` is exact), and the build is the
//           build before this spec for any session that never charges a lip.
//
// ---- WHAT THE EVENT MAY AND MAY NOT TOUCH.
//
// `simTime`, `rec.tick` and `playerSystems` (the trick timer inside it) all take
// `sdt`, so THEY COUNT SIM TIME. A frozen frame dispenses no tick at all rather
// than a zero-length one, so 0058's trace never records the wall gap as sim, the
// recorded dt sequence stays a real dt sequence, and a replay of the bag replays
// the ride the physics actually had. Air time on the HUD is true air time for the
// same reason. `__player.stepFixed` is a different code path entirely and this
// block cannot reach it: the determinism proof is structural, not a promise.
//
// THE ARMING FRAME RUNS TO COMPLETION. The phase is read at the TOP of the frame,
// before `hsWatch` can arm, so the frame that pays the pop still steps, still
// fires 0062's aura discharge (which lives inside `__playFX.update`) and still
// renders — the discharge lands at the lip and the hold begins after it, which is
// the order the effect reads in.
//
// THE FLAG. One place, one name.
let HITSTOP = true;
// specs/0060 [freeze, 2026-09-06] — THE THRESHOLD COMES DOWN. Greg: "the freeze
// frame threshold is too high". 3.0 m/s of lip charge only ever fired off a real
// booter; 1.5 puts a decent side-hit and a rolled knuckle inside the effect. The
// span widens with it, so `u` still reaches 1 at ski.js's own `lipMax`.
const HS_CHARGE_MIN = 1.5;   // m/s of lip charge — under this, nothing, ever (was 3.0)
const HS_CHARGE_MAX = 7.5;   // ski.js `lipMax`, the charge ceiling — u spans 6.0 now
// specs/0060 [freeze, 2026-09-06] — THE THREE NUMBERS THE EVENT IS MADE OF. Every
// one of them is `lo + (hi − lo)·u`, so the small pop gets the small version of
// exactly the same shape rather than a different effect.
const HS_FREEZE_LO = 0.10;   // s of TRUE FREEZE at HS_CHARGE_MIN...
const HS_FREEZE_HI = 0.25;   // ...and at HS_CHARGE_MAX. Greg's ".25 seconds".
const HS_SLOMO_LO = 0.30;    // s of slow motion after it at HS_CHARGE_MIN...
const HS_SLOMO_HI = 0.75;    // ...and at HS_CHARGE_MAX. Greg's ".75 after that".
const HS_RATE_LO = 0.45;     // the slow-motion rate at HS_CHARGE_MIN...
const HS_RATE_HI = 0.30;     // ...and at HS_CHARGE_MAX. Deeper on the bigger pop.
const HS_MS_CAP = 1050;      // HARD wall-clock cap on freeze + slomo together
const HS_PERFECT_Q = 0.70;   // popQuality gate — the tightest 30 % of popWindow
const HS_TINT_K = 0.20;      // tint alpha per unit of tint-envelope depth
// specs/0060 (tuned 2026-09-06) — THE TINT'S OWN CLOCK. It used to be
// `K·(1 − ts)`, one expression, which meant the blue died with the dip. It now
// rises through the FREEZE to its peak, HOLDS at peak until the event ends, and
// fades over HS_TINT_FADE ms of wall clock AFTER it. The peak depth is 1 and not
// `1 − rate`, because during the freeze the world is not slowed, it is STOPPED.
// HS_TINT_MAX is the readability clamp: over 0.35 the landing zone starts to go.
const HS_TINT_FADE = 600;    // ms of wall-clock fade after the event ends
const HS_TINT_MAX = 0.35;    // hard clamp on the painted alpha

const HS = {
  on: false, t0: 0, dur: 0, perfect: false,
  // specs/0060 [freeze, 2026-09-06] — the event's own three latched numbers.
  freezeMs: 0, slomoMs: 0, rate: 1, phase: 'none',
  ts: 1, charge: 0, q: 0, n: 0, lit: false,
  hold: null,            // TEST-ONLY: pins `p` so a paused page can photograph it
  holdMs: null,          // TEST-ONLY: ...and pins WALL MS, which walks the fade too
  prevPaid: null,        // rider.js's own edge, read the same way (rider.js:2306)
  wallMax: 0,            // longest event this session, ms — the cap's own assertion
  log: [],               // the last event's per-frame (ms, ts) series, for the gate
  // specs/0060 (tuned 2026-09-06) — the tint's three latched numbers. `tintOn` is
  // the envelope's own life, `endT` the wall ms the event ended at (the fade's
  // t0), `depth` the last envelope value painted. `airSim0` is the landing
  // cancel's memory: a pop is PAID while the skis are still on the snow, so
  // "grounded ends it" has to mean "grounded again, after the takeoff". It is a
  // SIM-clock stamp, so it says the same thing at 30 fps and at 144.
  tintOn: false, endT: 0, depth: 0, endDepth: 0, airSim0: -1, endWhy: '',
  // specs/0060 [freeze, 2026-09-06] — the previous frame's `live`, for the abandon
  // EDGE. See the frame loop for why it is an edge and not a level.
  prevLive: true,
};
// specs/0060 (tuned 2026-09-06) — seconds of SIM air before a grounded frame is a
// landing. Chatter and a rolled-over knuckle take the skis off the snow for a
// frame or two all the way down the run; without this floor the first of those
// would cancel an event the rider is still in the middle of. specs/0060 [freeze]:
// it is SIM seconds, so the freeze — which dispenses none — cannot spend it.
const HS_LAND_MIN = 0.05;
const hsClamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ARM. Called on the RISING EDGE of `skiState().popPaid` — ski.js's own one-frame
// "the pop counted" flag, the same edge rider.js takes for the `pop` clip. That
// flag only goes true inside `popWindow` 0.16 s before the lip or `popCoyote`
// 0.14 s after leaving it, and only where popPay() had something to pay, so
// "never on a hop below charge 1.5" and "never on a jump that is not a lip pop"
// are the physics' existing gates plus the one charge comparison below.
function hsArm(charge, quality) {
  if (!HITSTOP || !(charge >= HS_CHARGE_MIN)) return false;
  const u = hsClamp01((charge - HS_CHARGE_MIN) / (HS_CHARGE_MAX - HS_CHARGE_MIN));
  const perfect = quality >= HS_PERFECT_Q;
  HS.on = true;
  HS.t0 = performance.now();
  // specs/0060 [freeze, 2026-09-06] — the SHAPE is the same at every charge and
  // only its scale moves, so the tiers stay one effect: the reward tier is the
  // rim and the low-pass, not a different curve. (The old build's split floors —
  // 0.12 base / 0.06 reward — are gone with the render-clock dip they belonged
  // to; a freeze is a freeze, and there is no deeper version of stopped.)
  HS.freezeMs = 1000 * (HS_FREEZE_LO + (HS_FREEZE_HI - HS_FREEZE_LO) * u);
  HS.slomoMs = 1000 * (HS_SLOMO_LO + (HS_SLOMO_HI - HS_SLOMO_LO) * u);
  HS.rate = HS_RATE_LO + (HS_RATE_HI - HS_RATE_LO) * u;
  HS.dur = Math.min(HS_MS_CAP, HS.freezeMs + HS.slomoMs);
  HS.perfect = perfect;
  HS.charge = charge; HS.q = quality; HS.n++;
  HS.log = [];
  // specs/0060 (tuned 2026-09-06) — the tint's envelope opens with the event and
  // outlives it. `airSim0` starts unset because the pop is paid on the snow.
  HS.tintOn = true; HS.endT = 0; HS.airSim0 = -1; HS.endWhy = '';
  return true;
}

// specs/0060 (tuned 2026-09-06) — ONE PLACE THE DIP ENDS, so "the dip ended" and
// "the fade started" can never disagree. `why` is for the proof sheet only.
function hsEnd(why) {
  if (!HS.on) return false;
  const wall = performance.now() - HS.t0;
  if (wall > HS.wallMax) HS.wallMax = wall;
  HS.on = false; HS.ts = 1; HS.endT = performance.now(); HS.endWhy = why;
  HS.endDepth = HS.depth;   // the fade starts from wherever the envelope had got to
  return true;
}

// THE EDGE WATCHER. Reads only — `skiState()` is a pure read and this drains
// nothing. It is called unconditionally rather than under `live` so that a paused
// headless page driving the sim through `stepFixed` still arms a real event; the
// flag cannot move while paused, because nothing is calling ctrl.update(). It runs
// AFTER the sim step so the pop edge it takes is the one THIS frame produced;
// `hsLand` below is the half that has to run before it, and does.
function hsWatch() {
  const paid = ctrl.mode === 'skis' && !!skiState().popPaid;
  if (HS.prevPaid === null) HS.prevPaid = paid;
  const rose = paid && !HS.prevPaid;
  HS.prevPaid = paid;
  if (rose) { const s = skiState(); hsArm(s.lipVy, s.popQuality || 0); }
  return rose;
}

// specs/0060 (tuned 2026-09-06) — THE LANDING CANCEL. A second of freeze and slow
// motion is long enough to still be running when a short pop touches back down,
// and slow motion arriving at the landing is the one thing it must not do: 0059's
// landing ring and rider.js's land-pop clip both read as broken in slow motion,
// and the moment the physics scores is the moment the picture has to be honest.
// `airSim0` is why this is three conditions and not one: the pop is PAID on the
// snow, so the arming frame is itself a grounded frame, and a frame or two of
// chatter is not a takeoff either — HS_LAND_MIN of SIM air has to have happened
// first. The TINT is not cancelled: its fade simply starts at touchdown, which is
// what keeps the blue over the landing that earned it.
//
// specs/0060 [freeze, 2026-09-06] — IT IS ITS OWN FUNCTION, and the frame loop
// calls it ABOVE the freeze's early return rather than beside `hsWatch` below it.
// Inside the game a frozen body cannot land, because a frozen frame steps no
// physics — but "cannot" is a property of one call site, and a respawn, a
// teleport, a replay stepper or a harness driving `stepFixed` itself all move the
// body without the frame loop's help. Two reads on every frame buys the rule in
// every phase instead of in the two that happen to reach `hsWatch`.
function hsLand() {
  if (!HS.on) return false;
  if (!ctrl.grounded) { if (HS.airSim0 < 0) HS.airSim0 = simTime; return false; }
  if (HS.airSim0 < 0) return false;
  if (simTime - HS.airSim0 >= HS_LAND_MIN) return hsEnd('land');
  HS.airSim0 = -1;
  return false;
}

// specs/0060 [freeze, 2026-09-06] — THE PHASE, and the whole per-frame cost of the
// effect. A PURE FUNCTION of the wall clock and what `hsArm` latched: nothing here
// integrates, so a dropped frame, a stalled tab or a disarm cannot leave the world
// stuck stopped. It returns the WORD the frame loop switches on, and sets `HS.ts`
// to the time scale that word means — `0` while the sim is not being stepped at
// all, `HS.rate` while it is being stepped slowly, `1` otherwise.
//
// The clock is `performance.now()` and not an accumulated dt, deliberately: the
// HS_MS_CAP 1050 ms ceiling is then a literal statement about wall time rather
// than about a sum of frame deltas that a stall could quietly stretch. A tab that
// goes to the background for a second comes back with the event already over,
// which is the correct behaviour and needs no code of its own.
//
// There is NO ramp into the freeze and none out of the slow motion. Both were
// right for a render-clock dip and are wrong here: a hitstop is a stall (Capcom
// and Smash both end theirs on a frame-count expiry), and the return from slow
// motion is covered by the tint, which is still holding at peak when the clock
// comes back and does not release for another 600 ms.
const hsElapsed = () => (HS.holdMs != null ? HS.holdMs
  : HS.hold != null ? HS.hold * HS.dur : (performance.now() - HS.t0));
const hsHeld = () => HS.hold != null || HS.holdMs != null;
function hsPhase() {
  if (!HS.on) { HS.ts = 1; HS.phase = 'none'; return 'none'; }
  const el = hsElapsed();
  let ph;
  if (el >= HS.dur) {
    if (!hsHeld()) hsEnd('window');
    HS.ts = 1; ph = 'none';
  } else if (el < HS.freezeMs) { HS.ts = 0; ph = 'freeze'; }
  else { HS.ts = HS.rate; ph = 'slomo'; }
  // specs/0060 [freeze] — latched, so `state().phase` is the word this function
  // decided and not a guess re-derived from `ts` (which cannot tell a held clock
  // past its window from a clock that never started).
  HS.phase = ph;
  if (HS.log.length < 128) HS.log.push([+el.toFixed(2), +HS.ts.toFixed(4)]);
  return ph;
}

// specs/0060 (tuned 2026-09-06) — THE TINT'S ENVELOPE, and the reason it is a
// second function rather than `1 − ts`. Greg: "the blue goes away really fast" —
// tied to `ts`, the colour could not outlive the slowdown by construction, and the
// slowdown is the short part. specs/0060 [freeze, 2026-09-06] — the shape is the
// same and its landmarks moved onto the new phases: it RISES over the FREEZE (it
// is the one thing that moves while the frame is repeated, and it has to, or the
// hold reads as a dropped frame rather than as an effect), HOLDS at peak through
// the whole of the slow motion, then FADES over HS_TINT_FADE ms of wall clock
// measured from wherever the event actually ended — the window expiring, or a
// landing cancelling it. Still a PURE FUNCTION of the wall clock and what
// `hsArm`/`hsEnd` latched: nothing integrates, so a dropped frame or a stalled tab
// cannot leave the world blue. Peak depth is 1: the world is not slowed during the
// freeze, it is stopped. `endDepth` is the level the fade starts from, so a cancel
// mid-freeze fades from where it was instead of snapping up to the peak first.
function hsTint() {
  if (!HS.tintOn) { HS.depth = 0; return 0; }
  const el = hsElapsed();
  const endEl = HS.endT ? (HS.endT - HS.t0) : HS.dur;
  let e;
  if (el >= endEl) {
    const k = (el - endEl) / HS_TINT_FADE;
    if (k >= 1) { HS.tintOn = false; HS.depth = 0; return 0; }
    const from = HS.endT ? HS.endDepth : 1;
    e = from * (1 - k * k * (3 - 2 * k));
  } else if (el < HS.freezeMs) { const k = el / HS.freezeMs; e = k * k * (3 - 2 * k); }
  else e = 1;
  HS.depth = e;
  return e;
}

// THE TWO PRESENTATION SINKS, driven off the one number — and specs/0060 (tuned
// 2026-09-06) makes that number the TINT'S envelope rather than the dip's, for
// both of them: the rim stays up and the low-pass stays closed for as long as the
// blue is on screen, so the reward tier reads as one continuous event that opens
// with a stall and releases over the next half second, not as three effects that
// all stop the instant the clock comes back. The low-pass is still the REWARD
// TIER'S ALONE (specs/0060 §3): the base dip is silent, so the two tiers are a
// different experience rather than two sizes of the same one. HS_TINT_MAX is the
// readability clamp — the world under the blue still has to be skiable.
function hsPaint(depth) {
  const d = depth > 0 ? depth : 0;
  HS.lit = d > 0;
  const a = Math.min(HS_TINT_MAX, HS_TINT_K * d);
  try { window.__playFX.hitstopTint(a, HS.perfect && d > 0); } catch { /* fx not up yet */ }
  try { window.__playAudio.hitstopLP(HS.perfect ? d : 0); } catch { /* no audio context */ }
}

// The lab handle, on its OWN key and never on `window.__player`: C13 locks that
// key set against tools/rider/api-shape.json, and a debugging instrument has no
// business spending the rider contract's budget to be reachable. Same rule
// `__rail`, `__rig` and `__trace` already follow.
try {
  window.__hitstop = {
    // ---- reads
    state: () => ({ on: HS.on, enabled: HITSTOP, ts: HS.ts, phase: HS.phase,
                    // specs/0060 [freeze, 2026-09-06] — the event's own shape
                    freezeMs: +HS.freezeMs.toFixed(2), slomoMs: +HS.slomoMs.toFixed(2), rate: +HS.rate.toFixed(4),
                    durMs: +HS.dur.toFixed(2), perfect: HS.perfect,
                    charge: +HS.charge.toFixed(3), quality: +HS.q.toFixed(3),
                    dips: HS.n, wallMaxMs: +HS.wallMax.toFixed(2),
                    // the split itself, in one place: what the physics has stepped
                    // against what the presentation has been shown.
                    simTime: +simTime.toFixed(6), renderTime: +renderTime.toFixed(6),
                    skew: +(simTime - renderTime).toFixed(6),
                    // specs/0060 (tuned 2026-09-06) — `alpha` is the TINT'S
                    // envelope now, clamped, not `K·(1 − ts)`: past the dip's end
                    // the two disagree, and what a gate wants is what is painted.
                    alpha: +Math.min(HS_TINT_MAX, HS_TINT_K * HS.depth).toFixed(4),
                    depth: +HS.depth.toFixed(4), tint: HS.tintOn, endWhy: HS.endWhy,
                    endMs: HS.endT ? +(HS.endT - HS.t0).toFixed(2) : null,
                    log: HS.log.slice() }),
    tuning: () => ({ HS_CHARGE_MIN, HS_CHARGE_MAX, HS_FREEZE_LO, HS_FREEZE_HI,
                     HS_SLOMO_LO, HS_SLOMO_HI, HS_RATE_LO, HS_RATE_HI, HS_MS_CAP,
                     HS_PERFECT_Q, HS_LAND_MIN, HS_TINT_K, HS_TINT_FADE,
                     HS_TINT_MAX }),   // specs/0060 [freeze, 2026-09-06]
    // specs/0060 [freeze, 2026-09-06] — the curve, printed rather than asserted:
    // what a pop of any charge would arm, without arming it.
    curve: (charge) => { const u = hsClamp01(((+charge || 0) - HS_CHARGE_MIN) / (HS_CHARGE_MAX - HS_CHARGE_MIN));
      return (+charge || 0) < HS_CHARGE_MIN ? { charge: +charge, arms: false }
        : { charge: +charge, arms: true, u: +u.toFixed(4),
            freezeMs: +(1000 * (HS_FREEZE_LO + (HS_FREEZE_HI - HS_FREEZE_LO) * u)).toFixed(1),
            slomoMs: +(1000 * (HS_SLOMO_LO + (HS_SLOMO_HI - HS_SLOMO_LO) * u)).toFixed(1),
            rate: +(HS_RATE_LO + (HS_RATE_HI - HS_RATE_LO) * u).toFixed(4) }; },
    // ---- TEST-ONLY WRITES, and the same three doors fx.js's `__impact` opens,
    // for the same reason: the render clock runs off the rAF line, which
    // `stepFixed` does not drive, and a headless page has to pause to be
    // deterministic at all. `hold(p)` pins the dip at a fraction of its window and
    // paints it immediately, so any point on the curve can be photographed.
    // specs/0060 (tuned 2026-09-06) — `holdMs(ms)` joins them, because the blue
    // now outlives the dip and `hold(p)`'s p is a fraction of the DIP: past p 1
    // there is nothing left for it to say, and the 600 ms fade is the half of the
    // effect this tune exists to lengthen. `holdMs` pins WALL MS since the arm and
    // therefore walks the dip and the fade with one number.
    enable: (v) => { HITSTOP = !!v; if (!HITSTOP) { HS.on = false; HS.tintOn = false; hsPaint(0); } return HITSTOP; },
    arm: (charge, quality = 1) => hsArm(+charge || 0, +quality || 0),
    hold: (p) => { HS.hold = p == null ? null : hsClamp01(+p || 0); hsPhase(); hsPaint(hsTint()); return HS.hold; },
    holdMs: (ms) => { HS.holdMs = ms == null ? null : Math.max(0, +ms || 0); hsPhase(); hsPaint(hsTint()); return HS.holdMs; },
    reset: () => { HS.on = false; HS.tintOn = false; HS.hold = null; HS.holdMs = null; HS.endT = 0; HS.depth = 0;
                   HS.n = 0; HS.wallMax = 0; HS.log = []; HS.prevPaid = null; hsPaint(0); return true; },
  };
} catch { /* not a browser */ }

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frames++;
  const devOn = dev.active();
  // the locker freezes the body the same way pause does — browsing a ski rack
  // should not cost you the run you were in the middle of
  const live = !devOn && !hud.isPaused() && !inv.isOpen();
  // specs/0060 [freeze, 2026-09-06] — THE PHASE IS READ AT THE TOP, before
  // `hsWatch` below can arm anything. That ordering is the whole reason the
  // ARMING frame runs to completion: the pop is paid inside `ctrl.update`, the
  // aura discharge fires off the launch edge inside `__playFX.update`, and both
  // belong to the lip and not to the hold that follows it.
  //
  // ESC, the locker, the dev cam: `live` FALLING ABANDONS the event outright rather
  // than pausing it. A hitstop is a beat inside one takeoff; a player who opens a
  // menu in the middle of it does not want to come back to the rest of it half a
  // minute later, and `hsEnd` starts the tint's fade so nothing is left lit.
  //
  // THE EDGE, AND NOT THE LEVEL, and the reason is not the harness: "the player
  // opened something" is a thing that HAPPENS, and a page that was already paused
  // when the pop was paid never had it happen. That case is the deterministic
  // stepper — every rider harness in tools/ drives `stepFixed` on a paused page —
  // and a level test would abandon its event on the frame after every arm, which
  // would make the effect untestable and, worse, would make the gate green for a
  // reason that has nothing to do with the rule it is checking.
  if (HS.on && HS.prevLive && !live) hsEnd('abandon');
  HS.prevLive = live;
  hsLand();
  const phase = hsPhase();
  if (phase === 'freeze') {
    // THE FREEZE FRAME. Nothing below this line runs: no sim step, no recorder
    // tick, no camera, no HUD, no fx, no audio, no world clock. The renderer draws
    // the same scene it drew last frame, which is what makes this a freeze frame
    // and not a slow one. The tint is the single exception and it is CSS — a
    // compositor-only opacity write that never touches the frame this returns to.
    hsPaint(hsTint());
    if (world.ownLoop) riderBloom.render();
    return;
  }
  // specs/0060 [freeze, 2026-09-06] — ONE dt FOR THE WHOLE FRAME. `sdt` is what
  // every consumer below takes: the controller, `simTime`, the 0058 recorder, the
  // player systems and the trick timer inside them, the camera, the fx, the audio
  // and the HUD. That is what makes the slow motion the WORLD's and not the
  // rider's. Outside the event `phase` is 'none' and `sdt` is `dt` itself — the
  // same object, not a product — so a session that never charges a lip is the
  // build before this spec to the float.
  const sdt = phase === 'slomo' ? dt * HS.rate : dt;
  // ...and the wall time the event has EATEN, so a world that keeps its own clock
  // can be handed a monotonic one that holds and slows with everything else.
  hsDebt += dt - sdt;
  // the rocket writes velocity BEFORE the controller integrates it, so the
  // thrust, the cancelled gravity and the collision all belong to one frame
  boost.step(sdt, live);              // specs/0060 [freeze] — sdt, like everything else
  // specs/0051 §2.1 — the residency tick, in frame(), BEFORE the controller
  // moves the body and OUTSIDE any swallowing catch. Never hung off
  // `world.update` (main.js:2362 reads `try { … } catch { world.update = null }`,
  // so one throw would permanently and silently disable it, and it only runs on
  // the `world.ownLoop` branch). A scheduler exception must be a visible failure.
  // §2.7 — the glider's ring is wider and both fast gears lead further; the
  // range name is read off the gear the body is actually on, once a frame.
  // specs/0060 [freeze, merge 2026-09-06] — residency takes `dt`, not `sdt`: the
  // streamer's lead and its per-frame build budget are WALL clock, and slowing
  // them with the world would starve the lattice for the length of the event.
  collision.setRange(ctrl.mode === 'glider' ? 'glider' : ctrl.mode === 'snowmobile' ? 'snowmobile' : 'ski');
  collision.tick(dt, ctrl.position, ctrl.velocity);
  // specs/0058 — pre() LATCHES THE INPUT, tick() packs the state. Two calls and
  // not one because keys.jump is an edge and ctrl.update() eats it on its last
  // line: read after the step, a recorder never sees a jump at all.
  if (live) { rec.pre(); ctrl.update(sdt); simTime += sdt; rec.tick(sdt, true); }
  // specs/0051 §2.1 — THE TICK SITE. Here, in frame(), after the controller has
  // integrated this frame's position and BEFORE playerSystems(), and outside
  // every catch: `world.update` is wrapped at :2341 in a `try { } catch {
  // world.update = null }`, so hanging the scheduler off it would let one throw
  // silently and permanently disable streaming, and it only runs on the
  // `world.ownLoop` branch at all. A scheduler exception must be visible.
  chunks.tick(dt, chunkFocus());
  // specs/0060 — AFTER the sim step and never before it, so the pop edge the
  // watcher takes is the one THIS frame's physics produced. `hsWatch` reads
  // skiState() and ctrl.grounded and can reach no physics number.
  hsWatch();
  if (live) renderTime += sdt;
  // ...and the paint is skipped entirely on the frames that are not an event and
  // did not end one, so an ordinary frame costs this spec two float compares.
  // specs/0060 (tuned 2026-09-06) — the gate is the TINT'S life and not the
  // event's, because the blue runs 600 ms past the last slow frame; `HS.lit` is
  // set by `hsPaint` from the envelope, so the loop stops the moment it reaches 0.
  if (HS.tintOn || HS.lit) hsPaint(hsTint());
  const ev = ctrl.takeEvents();
  lifts.tick(!devOn && !hud.isPaused());
  if (!devOn) {
    if (ev.trick) { hud.trick(ev.trick); window.__playAudio.trick(); }
    else if (ev.wipe) hud.trick(ev.wipe);
    if (ev.pop === 'perfect') { hud.flash('PERFECT POP'); perfectPops++; window.__playAudio.trick(); }
    playerSystems(sdt, live);          // specs/0060 [freeze] — the trick timer is in here,
    camRig.update(sdt, ev);            // ...and it counts SIM time, so air time stays true
    camRig.applyTo(camera);
    updateVisuals();
    boost.draw(sdt, camRig.mode);      // specs/0060 [freeze] — plume + trail on sdt
  } else {
    dev.update(dt);
    dev.applyTo(camera);
    fpRig.visible = false; fpGlide.visible = false; model.visible = false;   // the body stayed behind
    fpPack.group.visible = false;
    fpSled.visible = false; fpSnow.visible = false;   // ...and so did both vehicles
    boost.hide();
    dev.tick();
  }
  // specs/0060 [freeze, 2026-09-06] — every remaining consumer of the frame's dt
  // takes `sdt` as well. The plume, the speed-lines, the snowballs, the markers
  // and the HUD's own animations slow WITH the body; the one thing on this list
  // that would read wrong at full rate is all of them.
  window.__playFX.update(sdt);
  window.__playAudio.rocket(devOn ? 0 : boost.throttle());
  window.__playAudio.update(sdt);      // specs/0060 [freeze] — and the rest of the
  window.__playSurprise.update(sdt);  // presentation with it: nothing in this frame
  window.__playSnowball.update(sdt);  // runs on a different clock from the body,
  window.__playMarkers.update(sdt);   // which is the whole difference from the dip
  // the fuel bar is rocket-gear furniture: nothing else can spend the tank
  hud.setFuel(boost.fuelFrac(), boost.burning(), boost.dry(), boost.worn());
  hud.tick(ctrl, sdt, camRig.mode);    // specs/0060 [freeze] — the HUD slows with the world
  if (world.ownLoop) {
    // specs/0060 [freeze, 2026-09-06] — the world's own clock, less the wall time
    // the event ate. Monotonic, continuous, exactly `now / 1000` until the first
    // pop and a fixed offset from it after — so the scene animates at the same
    // rate as everything else instead of running on while the rider hangs.
    if (world.update) { try { world.update(now / 1000 - hsDebt); } catch { world.update = null; } }
    riderBloom.render();                       // specs/0046 §4.3 — was world.renderer.render(world.scene, camera)
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
  alpinePolish, riderPolish: rider.polish ? rider.polish.stats : null,
  groomedRun: world.report?.groomedRun ?? { enabled: false },
  collision: collision.stats, collidableMeshes: meshes, lifts: lifts.count(),
  bbox: box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() },
  tuning: ctrl.T,
};
// specs/0003 — `debugHud`. The bench dumps this on every boot; the shareable
// build does not, and `?dev` turns it back on there for a bug report.
// specs/0055 §5.3 (2026-09-06) — the [play] dump is lab output too, so it reads
// the LIVE switch rather than the boot constant. `?dev=1` still forces it.
if (labUI() || (cfg.qs && cfg.qs.has('dev'))) console.log('[play]', info);

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
  get outfit() { return rider.outfit; },
  setOutfit: (code) => rider.setOutfit(code),
  outfits: rider.outfits,
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
      rec.pre();                 // specs/0058 — the input this step consumes,
                                 // latched before update() eats the jump edge
      ctrl.update(dt);
      playerSystems(dt, true);
      simTime += dt;
      renderTime += dt;          // specs/0060 — the fixed stepper has no wall
                                 // clock, so the two clocks advance together
      rec.tick(dt, true);        // ...and the recorder rides the fixed step too,
                                 // or every gate's ride is untraceable
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
  // specs/0061 (families, 2026-09-06) — `family`/`familyName` and the polyline's
  // HEAD ride on this readout so the acceptance can check "the row travelled to
  // the highest entrance of its family" against the contract rather than against
  // a number typed into the harness.
  runs: () => (world.runs || []).map((r) => ({ id: r.id, name: r.name, n: (r.pts || []).length,
    family: r.family || null, familyName: r.familyName || null,
    head: (r.pts && r.pts[0]) ? { x: +r.pts[0][0].toFixed(2), y: +r.pts[0][1].toFixed(2), z: +r.pts[0][2].toFixed(2) } : null })),
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

// specs/0051 §2.1 — the tile handle, wired here rather than through
// `tiles.mjs`'s one-shot `publishChunks` accessor (wave 1b's deviation 2, which
// this wave was told to delete). §7.4 check 13 reads
// `__player.chunks.collisionFidelity(n)`, and the L1 slab that answers it lives
// in the collision router, so the two handles are merged onto one object.
// MERGE (2a + 2c): 2a made the SCHEDULER the one handle — `__player.chunks` and
// `window.__chunks` must be the same object, or checks 4/10 and checks 3/5/12
// read two things that can disagree. 2c needs check 13's
// `collisionFidelity(n)`, which the collision router answers. So the router's
// probe is attached ONTO the scheduler rather than onto a second object, and
// the assignment below is the same object 2a re-states after the overlays.
// W2FIX1 — the second argument is the DOMAIN, in three space, and it is what
// keeps the row from depending on where the player is standing: the harness
// hands in the tile lattice's crop box so the probe measures the ground L1
// tiles are actually rendered over.
Object.assign(chunks, { collisionFidelity: (n, domain) => collision.collisionFidelity(n, domain) });
window.__player.chunks = chunks;
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

// specs/0051 §2.1 — the scheduler IS `__player.chunks`, and it is the same
// object as `window.__chunks`: the harness reads `drain()` off the first and
// `refusals`/`softHits`/`residency()` off the second (chunkgate.mjs checks 4
// and 10), and two objects could disagree. Wave 1b's `publishChunks` attached
// the lattice handle here through a one-shot accessor; the scheduler delegates
// every one of its probes, so checks 3, 5 and 12 read what they always read.
window.__player.chunks = chunks;

// LAST, and after the overlays on purpose: `__playerReady` is the one signal a
// test or a gate waits on, and it used to go up while intro.js was still in
// flight — so "the player is ready" and "window.__intro exists" were two
// different moments and anything reading the second raced the first.
window.__playerReady = true;
