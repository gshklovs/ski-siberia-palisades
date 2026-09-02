// Where you wake up.
//
// Priority: explicit ?spawn= > a named waypoint slug > the adapter's own spawn >
// layout.json views[0] > where the scene's default camera was pointed > scene
// bbox centre. Everything is then dropped onto real ground, and the two derived
// cases hill-climb a little to find dry, flat, open footing instead of dumping
// you in the lake.
//
// ---------------------------------------------------------- NAMED WAYPOINTS
// `?spawn=kt22`, and — on a host that rewrites unknown paths to index.html —
// the bare path `/kt22`. This is the shareable-URL feature: tweet
// ski-red-dog-face.vercel.app/kt22 and the visitor wakes on the KT-22 summit
// instead of the Red Dog top.
//
// THE SLUG SET IS NOT A LIST. It is derived, every boot, from what the world
// itself declares — `world.markers`, then `world.runs`, then `world.lifts` —
// so a waypoint added to world.mjs is a working URL with no wiring anywhere
// else. There is exactly one hand-curated layer, ALIASES below, and it exists
// only for the names people actually type that no id spells.
//
// Resolution is deliberately forgiving in one direction and silent in the
// other: an id, a marker's display name and either of those slugified all
// resolve; anything else falls through to the ordinary default spawn with no
// error, because a bad link in a tweet must still open the mountain.

import { makeStandUp, standUpTuning } from './lift.js';

const RINGS = [0, 5, 11, 19, 30, 44];
const ANGLES = 16;

// The ONLY hand-maintained naming in this file. Left side is what somebody
// types; right side is an id the world declares (marker, run or lift). A key
// whose target the world does not declare simply never resolves.
export const ALIASES = {
  village: 'base-area',        // "THE VILLAGE" — the base area, the valley floor
  fingers: 'the-fingers',      // the reef off the KT summit; a RUN, not a marker
};

// how close a named waypoint has to be to a declared lift top before the search
// is tuned as that lift's unload rather than as bare hillside
const LIFT_TOP_NEAR_M = 45;

const slugify = (s) => String(s == null ? '' : s)
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// the first path segment, which is what a pretty URL puts the slug in.
// '/kt22' -> 'kt22'; '/' , '/index.html' and the bench's '/play' resolve to
// nothing the world declares and therefore to the default spawn.
function pathSlug(pathname) {
  const seg = String(pathname || '').split('/').filter(Boolean)[0] || '';
  if (!seg || /\./.test(seg)) return '';         // a file, not a slug
  return slugify(seg);
}

// Every place in this world you can be sent to, keyed by slug. Markers win over
// runs, runs over lifts, ids over display names — so a marker id can never be
// shadowed by a run that happens to share a word.
export function waypointIndex(world, upAxis = 'y') {
  const table = new Map();
  const add = (key, entry) => { const k = slugify(key); if (k && !table.has(k)) table.set(k, entry); };
  // world.markers is the RAW contract array — main.js tips spawnHint, lifts and
  // runs into the three frame but deliberately leaves markers for markers.js,
  // so the same (x, y, z)_ENU -> (x, z, -y) conversion is done here.
  const tip = (p) => (upAxis === 'z' ? { x: +p[0], y: +p[2], z: -p[1] } : { x: +p[0], y: +p[1], z: +p[2] });
  const fin = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

  const markers = Array.isArray(world.markers) ? world.markers : [];
  for (const m of markers) {
    if (!m || !Array.isArray(m.pos) || m.pos.length < 3) continue;
    const at = tip(m.pos);
    if (!fin(at)) continue;
    add(m.id, { id: m.id || m.name, kind: 'marker', name: m.name || m.id, at });
  }
  for (const m of markers) {
    if (!m || !m.name || !Array.isArray(m.pos)) continue;
    const at = tip(m.pos);
    if (!fin(at)) continue;
    add(m.name, { id: m.id || m.name, kind: 'marker', name: m.name, at });
  }
  // runs: PLAYABLE.md orders pts TOP -> BOTTOM, so pts[0] is the drop-in
  for (const r of (Array.isArray(world.runs) ? world.runs : [])) {
    if (!r || !Array.isArray(r.pts) || !r.pts.length) continue;
    const p = r.pts[0];
    const at = { x: +p[0], y: +p[1], z: +p[2] };
    if (!fin(at)) continue;
    add(r.id, { id: r.id, kind: 'run', name: r.name || r.id, at });
    if (r.name) add(r.name, { id: r.id, kind: 'run', name: r.name, at });
  }
  // lifts: the top terminal, already tipped by main.js
  for (const l of (Array.isArray(world.lifts) ? world.lifts : [])) {
    if (!l || !l.top) continue;
    const t = l.top;
    const at = { x: +(t.x !== undefined ? t.x : t[0]), y: +(t.y !== undefined ? t.y : t[1]), z: +(t.z !== undefined ? t.z : t[2]) };
    if (!fin(at)) continue;
    add(l.id || l.name, { id: l.id || l.name, kind: 'lift', name: l.name || l.id, at });
  }
  return table;
}

export function resolveWaypoint(slug, world, upAxis = 'y') {
  const s = slugify(slug);
  if (!s) return null;
  const table = waypointIndex(world, upAxis);
  const target = Object.prototype.hasOwnProperty.call(ALIASES, s) ? slugify(ALIASES[s]) : s;
  const hit = table.get(target) || null;
  return hit ? { ...hit, slug: s, via: target === s ? 'id' : 'alias:' + target } : null;
}

export function pickSpawn(THREE, { collision, world, layout, qs, unitScale = 1, upAxis = 'y', pathname = null }) {
  const top = collision.bounds.maxY + 5;
  const drop = (x, z) => collision.groundAt(x, z, top);

  const out = (position, yaw, source, pitch = 0) => ({ position, yaw, pitch, source });
  // three.js forward for a Y-rotation is (-sin yaw, 0, -cos yaw)
  const yawTo = (from, to) => Math.atan2(from.x - to.x, from.z - to.z);

  // 1 — explicit override, for debugging and for the headless harness
  const sp = qs && qs.get('spawn');
  if (sp) {
    const n = sp.split(',').map(Number);
    if (n.length >= 3 && n.every(isFinite)) {
      const p = new THREE.Vector3(n[0], n[1], n[2]);
      const g = drop(p.x, p.z);
      if (g !== null && !isFinite(n[1])) p.y = g;
      const y = qs.get('yaw');
      return out(p, y ? Number(y) * Math.PI / 180 : 0, 'query');
    }
  }

  // 1b — a NAMED waypoint. `?spawn=<id>` beats the path, so a shared pretty
  // link can still be overridden by hand without editing the path. An
  // unresolvable name is not an error: it falls through to the default spawn,
  // which is what a mistyped or stale link has to do.
  const slug = (sp && !/^[-+0-9.,eE ]+$/.test(sp)) ? sp : pathSlug(pathname);
  const named = namedSpawn(THREE, { slug, collision, world, unitScale, upAxis });
  if (named) {
    const y = qs && qs.get('yaw');
    if (y) named.yaw = Number(y) * Math.PI / 180;
    return named;
  }

  // 2 — the scene told us (PLAYABLE.md contract)
  if (world.spawnHint && world.spawnHint.position) {
    const p = toVec(THREE, world.spawnHint.position);
    // the contract asks for feet; accept an eye-height point too
    if (world.spawnHint.eyeHeight) p.y -= world.spawnHint.eyeHeight;
    const g = drop(p.x, p.z);
    // only honour it if there is actually floor there — otherwise it would
    // drop you through the world on the first frame, forever
    if (g !== null) {
      p.y = g;
      const la = world.spawnHint.lookAt ? toVec(THREE, world.spawnHint.lookAt) : null;
      return out(p, la ? yawTo(p, la) : 0, 'world.mjs');
    }
  }

  // 3 — layout.json views[]. The layout frame is locked ENU-metres (+X east,
  // +Y north, +Z up); three.js scenes here are Y-up, so (x,y,z) -> (x, z, -y).
  const view = layout && Array.isArray(layout.views) && layout.views[0];
  if (view && Array.isArray(view.position)) {
    const p = enuToThree(THREE, view.position);
    const g = drop(p.x, p.z);
    if (g !== null && Math.abs(g - p.y) < 200) {
      p.y = g;
      const la = Array.isArray(view.lookAt) ? enuToThree(THREE, view.lookAt) : null;
      return out(p, la ? yawTo(p, la) : 0, 'layout.json views[0]');
    }
  }

  // 4 — where the author's default camera was aimed
  const cam = world.camera;
  let seed = null, source = 'scene bbox';
  if (cam) {
    const o = cam.position, d = cam.getWorldDirection(new THREE.Vector3());
    const hit = collision.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 6000);
    if (hit) {
      seed = new THREE.Vector3(o.x + d.x * hit.dist, o.y + d.y * hit.dist, o.z + d.z * hit.dist);
      source = 'default-camera aim';
    }
  }

  // 5 — fall back to the middle of the collidable world
  if (!seed) {
    const b = collision.bounds;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const g = drop(cx, cz);
    seed = new THREE.Vector3(cx, g === null ? 0 : g, cz);
  }

  const spot = bestFooting(collision, seed, unitScale, drop);
  // face back at whatever the camera was aimed at; if we barely moved, face the
  // most prominent thing around instead of staring at our own feet
  const target = seed.distanceTo(spot) > 4 * unitScale ? seed : lookTarget(collision, spot, unitScale, drop);
  return out(spot, yawTo(spot, target), source);
}

// Resolve one slug all the way to a spawn, or null. Exported so the player's
// test handle can answer "is this slug a working URL?" for EVERY waypoint the
// world declares without booting eighteen pages — which is what keeps the
// autowiring honest instead of assumed.
export function namedSpawn(THREE, { slug, collision, world, unitScale = 1, upAxis = 'y' }) {
  const wp = resolveWaypoint(slug, world, upAxis);
  if (!wp) return null;
  const stood = standUpAt(wp.at, world, collision, unitScale);
  if (!stood) return null;
  return {
    position: new THREE.Vector3(stood.x, stood.y, stood.z),
    yaw: stood.yaw, pitch: 0,
    source: 'spawn:' + wp.id,
    slug: wp.slug, waypoint: wp.id, waypointKind: wp.kind,
    waypointVia: wp.via, waypointName: wp.name,
    anchor: [wp.at.x, wp.at.y, wp.at.z],
    offAnchorM: +Math.hypot(stood.x - wp.at.x, stood.z - wp.at.z).toFixed(1),
    commits: !!stood.commits, aimDropM: stood.aimDropM,
    slopeDeg: stood.slopeDeg, onRun: stood.run,
  };
}

// Stand somebody up on a named waypoint, using lift.js's ring search — the
// SAME code that stands you up when you ride a chair, so /kt22 and the KT-22
// Express unload cannot drift apart into two different ideas of the summit.
//
// The only thing that changes between the two callers is the tuning row: a
// waypoint that sits on a declared lift top borrows that lift's LIFT_SPAWNS
// entry, and everything else gets `_default` — the same rings, the same
// standable-pitch test and the same "walk 30 m the way you are facing and see
// how far you fell" commits-downhill check, applied to bare hillside.
function standUpAt(at, world, collision, unitScale) {
  try {
    let key = null, keyName = null, bestD = LIFT_TOP_NEAR_M * unitScale;
    for (const l of (Array.isArray(world.lifts) ? world.lifts : [])) {
      if (!l || !l.top) continue;
      const t = l.top;
      const tx = t.x !== undefined ? t.x : t[0], tz = t.z !== undefined ? t.z : t[2];
      const d = Math.hypot(tx - at.x, tz - at.z);
      if (d <= bestD) { bestD = d; key = l.id || null; keyName = l.name || null; }
    }
    const standUp = makeStandUp({ collision, runs: world.runs || [], unitScale });
    return standUp(at, standUpTuning(key, keyName));
  } catch {
    return null;      // a strange collider is a fall-through, never a crash
  }
}

function toVec(THREE, v) {
  return v.isVector3 ? v.clone() : new THREE.Vector3(v[0], v[1], v[2]);
}
function enuToThree(THREE, a) {
  return new THREE.Vector3(a[0], a[2], -a[1]);
}

// Walk outward from the seed looking for footing that is a bit higher than the
// seed (i.e. out of the water), locally flat, and not under something.
function bestFooting(collision, seed, u, drop) {
  const y0 = drop(seed.x, seed.z);
  const base = y0 === null ? seed.y : y0;
  let best = null;
  for (const rr of RINGS) {
    const r = rr * u;
    const n = rr === 0 ? 1 : ANGLES;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = seed.x + Math.cos(a) * r, z = seed.z + Math.sin(a) * r;
      const y = drop(x, z);
      if (y === null) continue;
      const rise = y - base;
      if (rise < -0.4 * u || rise > 14 * u) continue;

      let rough = 0;
      for (const [ox, oz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) {
        const yn = drop(x + ox * u, z + oz * u);
        if (yn === null) { rough += 4; continue; }
        rough = Math.max(rough, Math.abs(yn - y));
      }
      // headroom: nothing hanging within 2.4 m above the head
      const up = collision.raycast(x, y + 0.4 * u, z, 0, 1, 0, 2.4 * u);
      const covered = up ? 1 : 0;

      // dry and flat and open and close in
      const score = Math.min(rise, 3 * u) * 2.2 - rough * 3.0 - covered * 6 - r * 0.045;
      if (!best || score > best.score) best = { x, y, z, score };
    }
  }
  if (!best) return seed.clone();
  return new (seed.constructor)(best.x, best.y, best.z);
}

// something worth looking at: highest ground within a couple of hundred metres
function lookTarget(collision, from, u, drop) {
  let best = null;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const rr of [60, 130, 220]) {
      const x = from.x + Math.cos(a) * rr * u, z = from.z + Math.sin(a) * rr * u;
      const y = drop(x, z);
      if (y === null) continue;
      if (!best || y > best.y) best = { x, y, z };
    }
  }
  return best ? new (from.constructor)(best.x, best.y, best.z) : new (from.constructor)(from.x, from.y, from.z - 10);
}
