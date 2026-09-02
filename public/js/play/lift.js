// Chairlifts you can actually use.
//
// A world declares its lift lines (PLAYABLE.md, `lifts`); walk into the load
// point at a base terminal and the HUD offers F, and F puts you on the unload
// flat at the top of that line facing back down it.
//
// It is a TELEPORT, not a ride. Nothing is suspended, nothing is attached, no
// mid-ride state exists: one frame you are at the bottom, the next you are at
// the top standing on real ground in the gear you were already wearing. The
// declaration may carry `speed` / `chairSpacing` (worlds that animate their own
// chairs already know them) — they are accepted and ignored here.
//
// A world with no `lifts` gets an empty list and this module never touches the
// HUD or the controller.
//
// Three things this file does beyond the teleport, none of them flag-gated:
//
//   1. THE LOAD SPOT IS DRAWN ON THE SNOW. Every rideable lift gets a faint
//      circle decal exactly the size of its F-accept radius, laid on the real
//      ground under the load point and faded up inside 30 m. "Where do I stand"
//      stops being a guess.
//
//   2. THE ACCEPT RADIUS IS GENEROUS AND THE SAME EVERYWHERE. A world's own
//      `radius` can only widen it, never narrow it: a 4 m trigger at the foot of
//      a 900 m lift is a pixel-hunt, and one that is 4 m at one station and 16 m
//      at the next teaches nothing.
//
//   3. THE UNLOAD SPAWN IS DERIVED, NOT DECLARED. The author's `top` is a hint;
//      what a player needs is flat ground, on the run the lift serves, pointed
//      down it, so that W commits. That point is searched for at load time
//      (flatness from the collider, commitment from a fall-line walk, heading
//      from the served run's own polyline) and the whole search is tunable per
//      lift in LIFT_SPAWNS below.

const vec = (a) => (Array.isArray(a)
  ? { x: +a[0], y: +a[1], z: +a[2] }
  : (a && typeof a === 'object' ? { x: +a.x, y: +a.y, z: +a.z } : null));

const finite = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// three.js forward is -Z, and the controller reads yaw as (-sin, -cos).
const yawToward = (from, to) => Math.atan2(-(to.x - from.x), -(to.z - from.z));
const TAU = Math.PI * 2;
const wrapPi = (a) => a - TAU * Math.round(a / TAU);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R2D = 180 / Math.PI;

// ======================================================== the boarding circle
// How close counts as "at the load point", in metres, for every lift in every
// world. A declaration may raise it (a funitel plaza really is 16 m across) and
// may not lower it.
export const BOARD_RADIUS_M = 9;
export const BOARD_HEIGHT_M = 9;      // ...and how far above/below, so a chair
                                      // on the cable is not "at the base"
export const DECAL_FADE_M = 30;       // the decal is visible inside this

// ========================================================= the unload spawns
// ONE table. Per-lift keys override `_default`; a lift with no entry uses the
// default search unchanged. Everything is metres / degrees.
//
// The search, in words: sample a ring of candidate points around the author's
// declared unload; keep the ones standing on flat ground; from each, walk the
// fall line and check the walk actually descends without a cliff in it; aim the
// player down that walk, pulled toward the served run's own heading but never
// more than `runAimMaxDeg` off the fall line — because the promise being kept is
// "press W and you commit down the run", and gravity has to agree.
export const LIFT_SPAWNS = {
  _default: {
    rings: [0, 10, 17, 24, 32, 40, 50],   // m out from the declared top
    probes: 16,                            // bearings sampled per ring
    // NOT "the flattest spot". The flattest spot on a lift-served knoll is a
    // cat-track bench, and a bench is where W skates for twenty metres and
    // nothing happens. What is wanted is the pitch a groomed unload ramp
    // actually has: standable, and it rolls. Red Dog's own spawn note measures
    // the good answer at 8.9 deg and the terminal itself at 21.7 deg.
    targetSlopeDeg: 8,                     // the pitch being aimed for
    maxSlopeDeg: 11,                       // ...and the hard ceiling on it
    slopeProbeM: 3.5,                      // gradient sample arm
    walkM: 60,                             // how far the commit walk goes
    walkStep: 5,
    minDropM: 7,                           // ...and how much it must descend
    maxRiseM: 1.4,                         // any step climbing more than this = not a run
    // The commit test that matters, because it is the one the player performs:
    // walk 30 m in the direction you are ACTUALLY FACING and see how far you
    // fell. A fall-line walk that descends beautifully 20 deg off your nose is
    // not the promise being made.
    aimProbeM: 30,
    minAimDropM: 2.5,
    // The fall line is measured on a RING, not from the triangle underfoot and
    // not from the wander of a downhill walk. On a 4-degree unload bench the
    // triangle normal is reading noise and the walk drifts round the contour;
    // "which way is down from here" over the next 25 m is the question a skier
    // is actually asking, and the lowest point on a ring is its answer.
    fallRadiusM: 25,
    fallProbes: 48,
    aimM: 26,                              // the walk distance the heading is taken over
    runNearM: 55,                          // a run polyline this close is "the run served"
    // How far the served run may pull the aim off the fall line. It is small on
    // purpose: five of the seven unloads here sit on a CAT TRACK, whose own
    // heading is across the hill by definition, and "W commits" is the promise
    // being kept. The run decides which way along the fall line you look; it
    // does not get to point you across it.
    runAimMaxDeg: 18,
    homeBiasPerM: 0.10,                    // score penalty per metre from the declared top
  },
  // Per-lift tuning goes here. Empty object = "the default search, and it was
  // checked". Add `offset: [dx, dz]` to shove a spawn by hand, or `yawDeg` to
  // pin the heading outright.
  'red-dog-express': {},
  'far-east-express': {},
  'exhibition': {},
  'olympic-lady': {},
  'kt22-express': {},
  'gold-coast-funitel': {},
  'gold-coast-express': {},
};

// ======================================================== the stand-up search
// LIFTED OUT OF createLifts, unchanged, because it stopped being only a lift
// thing. spawn.js asks the same question for a shareable waypoint URL — "put me
// on this place, standing on ground that works, facing down the hill" — and the
// answer has to be the SAME answer, from the same code, or /kt22 and riding the
// KT-22 chair would quietly stand you up in two different places by two
// different rules. One search, two callers.
//
// `anchor` is the declared point (a lift's top terminal, or a marker/run head);
// `T` is a LIFT_SPAWNS row already merged over `_default`. Returns null when
// there is no ground anywhere on the rings, which is a real answer and the
// caller is expected to have a fallback for it.
export function makeStandUp({ collision, runs, unitScale = 1 }) {
  // the unconditional probe — used by the spawn search, where "no ground here"
  // is a real answer and must not be papered over
  const gAt = (x, z) => collision.groundAt(x, z, collision.bounds.maxY + 5 * unitScale);

  // slope in degrees, and the downhill gradient direction, at (x, z)
  function surfaceAt(x, z, arm) {
    const h = arm * unitScale;
    const c = gAt(x, z);
    if (c === null) return null;
    const px = gAt(x + h, z), nx = gAt(x - h, z);
    const pz = gAt(x, z + h), nz = gAt(x, z - h);
    if (px === null || nx === null || pz === null || nz === null) return null;
    const dx = (px - nx) / (2 * h), dz = (pz - nz) / (2 * h);   // rise per metre
    const g = Math.hypot(dx, dz);
    return {
      y: c, slopeDeg: Math.atan(g) * R2D,
      // steepest DESCENT direction, unit
      dx: g < 1e-6 ? 0 : -dx / g, dz: g < 1e-6 ? 0 : -dz / g, grad: g,
    };
  }

  // walk the fall line and report whether it is a run or a ledge
  function commitWalk(x, z, T) {
    let cx = x, cz = z;
    const s0 = surfaceAt(cx, cz, T.slopeProbeM);
    if (!s0) return null;
    let y = s0.y, drop = 0, aimX = 0, aimZ = 0, aimSet = false, dist = 0;
    for (let i = 0; i < Math.ceil(T.walkM / T.walkStep); i++) {
      const s = surfaceAt(cx, cz, T.slopeProbeM);
      if (!s) return { drop, dist, ok: false, aimX, aimZ, why: 'void' };
      if (s.grad < 1e-4) return { drop, dist, ok: drop >= T.minDropM, aimX, aimZ, why: 'flat' };
      const nx = cx + s.dx * T.walkStep * unitScale;
      const nz = cz + s.dz * T.walkStep * unitScale;
      const ny = gAt(nx, nz);
      if (ny === null) return { drop, dist, ok: false, aimX, aimZ, why: 'void' };
      if (ny > y + T.maxRiseM * unitScale) return { drop, dist, ok: false, aimX, aimZ, why: 'rise' };
      drop += Math.max(0, y - ny);
      dist += T.walkStep * unitScale;
      cx = nx; cz = nz; y = ny;
      if (!aimSet && dist >= T.aimM * unitScale) { aimX = cx - x; aimZ = cz - z; aimSet = true; }
    }
    if (!aimSet) { aimX = cx - x; aimZ = cz - z; }
    return { drop, dist, ok: drop >= T.minDropM * unitScale, aimX, aimZ, why: 'ok' };
  }

  // the run polyline nearest this point, and its downhill heading there.
  // `runs` is the world's own declaration, already in the three frame and
  // ordered TOP -> BOTTOM (PLAYABLE.md), so the forward tangent IS downhill.
  function nearestRun(x, z, nearM) {
    if (!Array.isArray(runs) || !runs.length) return null;
    let best = null, bd = (nearM * unitScale) ** 2;
    for (const r of runs) {
      const p = r && r.pts;
      if (!Array.isArray(p) || p.length < 2) continue;
      for (let i = 0; i < p.length; i++) {
        const d = (p[i][0] - x) ** 2 + (p[i][2] - z) ** 2;
        if (d < bd) { bd = d; best = { run: r, i }; }
      }
    }
    if (!best) return null;
    const p = best.run.pts;
    const i = Math.min(best.i, p.length - 2);
    const a = p[i], b = p[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const m = Math.hypot(dx, dz) || 1;
    return { id: best.run.id, name: best.run.name, d: Math.sqrt(bd), dx: dx / m, dz: dz / m };
  }

  // how far you actually descend walking `m` metres on this heading, sampled
  // against the real collider — the ONLY question "press W and you commit" is
  // asking, so it is measured directly rather than inferred
  function aimDrop(x, z, yaw, T) {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw);       // three's forward
    const y0 = gAt(x, z);
    if (y0 === null) return { drop: 0, ok: false };
    let y = y0, worstRise = 0;
    const steps = Math.max(2, Math.round(T.aimProbeM / 5));
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * T.aimProbeM * unitScale;
      const ny = gAt(x + dx * d, z + dz * d);
      if (ny === null) return { drop: y0 - y, ok: false };
      worstRise = Math.max(worstRise, ny - y);
      y = ny;
    }
    return { drop: y0 - y, ok: (y0 - y) >= T.minAimDropM * unitScale && worstRise < T.maxRiseM * 2 * unitScale };
  }

  // the heading for a candidate: the fall line is the promise (W has to agree
  // with gravity), the served run is the intent, and the run may only pull the
  // aim `runAimMaxDeg` off the fall line — never across the hill
  // the bearing of the lowest ground on a ring of radius fallRadiusM
  function fallLineYaw(x, z, T) {
    const r = T.fallRadiusM * unitScale;
    let bestA = null, bestY = Infinity;
    for (let k = 0; k < T.fallProbes; k++) {
      const a = (k / T.fallProbes) * TAU;
      // the point at bearing `a` from here, in the controller's yaw convention
      const gy = gAt(x - Math.sin(a) * r, z - Math.cos(a) * r);
      if (gy !== null && gy < bestY) { bestY = gy; bestA = a; }
    }
    return bestA;
  }

  function headingFor(x, z, walk, run, T) {
    const ring = fallLineYaw(x, z, T);
    const fallYaw = ring === null ? Math.atan2(-walk.aimX, -walk.aimZ) : ring;
    if (Number.isFinite(T.yawDeg)) return { yaw: T.yawDeg / R2D, fallYaw, aimSource: 'pinned' };
    if (!run) return { yaw: fallYaw, fallYaw, aimSource: 'fall-line' };
    const runYaw = Math.atan2(-run.dx, -run.dz);
    const d = wrapPi(runYaw - fallYaw);
    const lim = T.runAimMaxDeg / R2D;
    return {
      yaw: fallYaw + clamp(d, -lim, lim), fallYaw,
      aimSource: Math.abs(d) <= lim ? 'run' : 'run-clamped',
    };
  }

  return function standUp(anchor, T) {
    const home = { x: anchor.x, y: anchor.y, z: anchor.z };
    if (Array.isArray(T.offset)) { home.x += T.offset[0] * unitScale; home.z += T.offset[1] * unitScale; }
    let best = null;
    for (const r of T.rings) {
      const n = r === 0 ? 1 : T.probes;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        const x = home.x + Math.cos(a) * r * unitScale;
        const z = home.z + Math.sin(a) * r * unitScale;
        const s = surfaceAt(x, z, T.slopeProbeM);
        if (!s) continue;
        const w = commitWalk(x, z, T);
        if (!w) continue;
        const run = nearestRun(x, z, T.runNearM);
        const h = headingFor(x, z, w, run, T);
        const ad = aimDrop(x, z, h.yaw, T);
        // The whole judgement, in one number, and the terms are in the order
        // they matter: does W commit, is the pitch rideable, is it near where
        // the author put the unload, is it on a run somebody named.
        let score = 0;
        score += Math.min(ad.drop, 12) * 2.4;                     // W commits
        score += ad.ok ? 16 : -22;
        score -= Math.abs(s.slopeDeg - T.targetSlopeDeg) * 1.1;   // a rideable pitch
        score -= Math.max(0, s.slopeDeg - T.maxSlopeDeg) * 6.0;   // ...never a cliff
        score += Math.min(w.drop, 30) * 0.25;
        score += w.ok ? 6 : -8;
        score -= Math.hypot(x - anchor.x, z - anchor.z) * T.homeBiasPerM;
        if (run) score += 8 - run.d * 0.06;
        if (!best || score > best.score) {
          best = { x, z, y: s.y, score, slopeDeg: s.slopeDeg, walk: w, run, ring: r, h, ad };
        }
      }
    }
    if (!best) return null;

    return {
      x: best.x, y: best.y, z: best.z, yaw: best.h.yaw,
      slopeDeg: +best.slopeDeg.toFixed(2),
      fallYaw: best.h.fallYaw, aimSource: best.h.aimSource,
      aimOffDeg: +Math.abs(wrapPi(best.h.yaw - best.h.fallYaw) * R2D).toFixed(2),
      // the number that says the promise is kept: metres lost over aimProbeM
      // walked straight ahead from where you are stood up
      aimDropM: +best.ad.drop.toFixed(2), commits: !!best.ad.ok,
      dropM: +best.walk.drop.toFixed(1), walkM: +best.walk.dist.toFixed(1),
      committed: !!best.walk.ok, why: best.walk.why,
      run: best.run ? best.run.id : null, runD: best.run ? +best.run.d.toFixed(1) : null,
      movedM: +Math.hypot(best.x - anchor.x, best.z - anchor.z).toFixed(1),
      ring: best.ring, score: +best.score.toFixed(2),
    };
  };
}

// The LIFT_SPAWNS row for one lift, merged over `_default`. Exported because
// spawn.js needs the same merge when a named waypoint lands on a lift top.
export function standUpTuning(id, name) {
  return {
    ...LIFT_SPAWNS._default,
    ...(LIFT_SPAWNS[id] || LIFT_SPAWNS[String(name || '').toLowerCase()] || {}),
  };
}

export function createLifts({ THREE, lifts, collision, ctrl, hud, scene, runs, unitScale = 1, onRide }) {
  const RADIUS = BOARD_RADIUS_M * unitScale;
  const HEIGHT = BOARD_HEIGHT_M * unitScale;
  const FADE = DECAL_FADE_M * unitScale;

  const list = [];
  for (const raw of Array.isArray(lifts) ? lifts : []) {
    if (!raw) continue;
    const base = vec(raw.base), top = vec(raw.top);
    if (!finite(base) || !finite(top)) continue;
    list.push({
      name: String(raw.name || raw.id || 'lift ' + (list.length + 1)),
      id: raw.id || null,
      base, top,
      // a declared radius may only WIDEN the trigger — see (2) above
      radius: Math.max(RADIUS, Number.isFinite(raw.radius) ? raw.radius * unitScale : 0),
      speed: Number.isFinite(raw.speed) ? raw.speed : null,
      chairSpacing: Number.isFinite(raw.chairSpacing) ? raw.chairSpacing : null,
      length: Math.hypot(top.x - base.x, top.y - base.y, top.z - base.z),
      rise: top.y - base.y,
      // step off pointing back down the line — away from the shed, down the hill.
      // Replaced by the derived unload below when the search finds something.
      yaw: yawToward(top, base),
      unload: null,
    });
  }

  let rides = 0;
  let last = null;
  let prompt = null;                   // the lift the HUD is currently offering

  // The declared y is the author's idea of ground. Trust the triangles instead,
  // widening the probe until something answers, so a metre of drift in the
  // declaration cannot drop anybody through the floor or bury them in it.
  function groundY(x, z, hintY) {
    for (const up of [2.5, 12, 45]) {
      const g = collision.groundAt(x, z, hintY + up * unitScale);
      if (g !== null) return g;
    }
    const g = collision.groundAt(x, z, collision.bounds.maxY + 5 * unitScale);
    return g === null ? hintY : g;
  }
  // ================================================== 3 — the unload spawns
  // The search itself is makeStandUp() above — shared, verbatim, with spawn.js.
  const standUp = makeStandUp({ collision, runs, unitScale });

  function deriveUnload(L) {
    return standUp(L.top, standUpTuning(L.id, L.name));
  }

  for (const L of list) {
    try {
      const u = deriveUnload(L);
      if (u) { L.unload = u; L.yaw = u.yaw; }
    } catch { /* a world with a strange collider keeps the declared top */ }
  }

  // ================================================ 1 — the boarding decals
  // One disc per lift, ground-conforming (every vertex settled onto the real
  // collider, so it paints the snow instead of hovering over it), sized to the
  // accept radius, faded up inside DECAL_FADE_M.
  const decals = [];
  if (THREE && scene && list.length) {
    try {
      const grp = new THREE.Group();
      grp.name = 'lift:board-decals';
      for (const L of list) {
        const seg = 44;
        const r = L.radius;
        const pos = [], idx = [];
        const cy = groundY(L.base.x, L.base.z, L.base.y);
        pos.push(L.base.x, cy + 0.07 * unitScale, L.base.z);
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * TAU;
          const x = L.base.x + Math.cos(a) * r, z = L.base.z + Math.sin(a) * r;
          const gy = collision.groundAt(x, z, cy + 8 * unitScale);
          pos.push(x, (gy === null ? cy : gy) + 0.07 * unitScale, z);
        }
        for (let i = 1; i <= seg; i++) idx.push(0, i, i + 1);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff4d00, transparent: true, opacity: 0.20,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 3;
        mesh.frustumCulled = false;
        mesh.visible = false;
        grp.add(mesh);
        decals.push({ mesh, mat, L });
      }
      scene.add(grp);
    } catch { /* a scene that cannot take a mesh still gets working lifts */ }
  }

  function drawDecals() {
    if (!decals.length) return;
    const p = ctrl.position;
    for (const d of decals) {
      const dist = Math.hypot(p.x - d.L.base.x, p.z - d.L.base.z);
      const k = clamp((FADE - dist) / (10 * unitScale), 0, 1);
      d.mat.opacity = 0.20 * k;
      d.mesh.visible = k > 0.02;
    }
  }

  function nearest() {
    if (!list.length) return null;
    const p = ctrl.position;
    let best = null, bd = Infinity;
    for (const L of list) {
      const d = Math.hypot(p.x - L.base.x, p.z - L.base.z);
      if (d > L.radius || d >= bd) continue;
      if (Math.abs(p.y - L.base.y) > HEIGHT) continue;
      bd = d; best = L;
    }
    return best;
  }

  function byName(name) {
    if (!name) return null;
    const want = String(name).trim().toLowerCase();
    return list.find((L) => L.name.toLowerCase() === want)
        || list.find((L) => (L.id || '').toLowerCase() === want)
        || list.find((L) => L.name.toLowerCase().includes(want) || want.includes(L.name.toLowerCase()))
        || null;
  }

  // where this lift actually puts you down
  function unloadOf(L) {
    if (L.unload) return { x: L.unload.x, y: L.unload.y, z: L.unload.z, yaw: L.unload.yaw };
    const y = groundY(L.top.x, L.top.z, L.top.y);
    return { x: L.top.x, y, z: L.top.z, yaw: L.yaw };
  }

  // The whole feature, in five lines.
  function ride(L) {
    if (!L) return null;
    const u = unloadOf(L);
    ctrl.teleport(new THREE.Vector3(u.x, u.y, u.z), u.yaw);
    rides++;
    last = { name: L.name, id: L.id, at: { x: u.x, y: u.y, z: u.z }, yaw: u.yaw, rise: L.rise };
    // R goes back to the last place you fast-travelled to, and a lift ride is
    // the commonest fast travel there is (main.js owns the policy)
    if (typeof onRide === 'function') { try { onRide(u, L); } catch { /* */ } }
    if (hud) { hud.setPrompt(null); hud.flash('top of ' + L.name.toLowerCase()); }
    prompt = null;
    return last;
  }

  return {
    // main.js: called every frame. `on` is false in dev mode / while paused,
    // which is the whole of the gating — no prompt, no key.
    tick(on) {
      drawDecals();
      const want = on ? nearest() : null;
      if (want === prompt) return;
      prompt = want;
      if (hud) hud.setPrompt(want ? { key: 'F', text: 'ride ' + want.name } : null);
    },
    // F
    use() { return ride(prompt || nearest()); },
    prompt() { return prompt ? prompt.name : null; },
    rides() { return rides; },
    lastRide() { return last; },
    count() { return list.length; },
    radius() { return RADIUS; },
    // the boarding circles, as they are right now: how big, how far away, and
    // how visible. `fade` is the distance at which they start coming up.
    decals() {
      const p = ctrl.position;
      return decals.map((d) => ({
        id: d.L.id, name: d.L.name, r: d.L.radius,
        at: { x: d.L.base.x, y: d.L.base.y, z: d.L.base.z },
        d: +Math.hypot(p.x - d.L.base.x, p.z - d.L.base.z).toFixed(2),
        opacity: +d.mat.opacity.toFixed(3), visible: d.mesh.visible, fade: FADE,
      }));
    },
    list() {
      return list.map((L) => ({
        name: L.name, id: L.id,
        base: { ...L.base }, top: { ...L.top },
        length: L.length, rise: L.rise, radius: L.radius,
        speed: L.speed, chairSpacing: L.chairSpacing,
        unload: L.unload ? { ...L.unload } : null,
      }));
    },
    // the derived unload table, as measured — the thing to read when tuning
    // LIFT_SPAWNS. Every row carries why it was chosen.
    spawns() {
      return list.map((L) => ({
        id: L.id, name: L.name,
        declared: { ...L.top },
        ...(L.unload ? L.unload : { x: L.top.x, y: L.top.y, z: L.top.z, yaw: L.yaw, derived: false }),
        derived: !!L.unload,
      }));
    },
    // test hook: stand at the load point, then take the lift.
    board(name) {
      const L = byName(name);
      if (!L) return null;
      const y = groundY(L.base.x, L.base.z, L.base.y);
      ctrl.teleport(new THREE.Vector3(L.base.x, y, L.base.z), yawToward(L.base, L.top));
      prompt = L;
      const out = ride(L);
      return out && { ...out, from: { x: L.base.x, y, z: L.base.z } };
    },
    // test hook: stand ON the load decal without riding, so the prompt and the
    // accept radius can be measured from where a player would actually be
    walkTo(name, offsetM = 0) {
      const L = byName(name);
      if (!L) return null;
      const y = groundY(L.base.x + offsetM, L.base.z, L.base.y);
      ctrl.teleport(new THREE.Vector3(L.base.x + offsetM, y, L.base.z), yawToward(L.base, L.top));
      return { name: L.name, id: L.id, at: { x: L.base.x + offsetM, y, z: L.base.z }, radius: L.radius };
    },
  };
}
