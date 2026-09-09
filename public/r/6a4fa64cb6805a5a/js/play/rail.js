// specs/0057 — JIBS: the park's rails, boxes, tubes and A-frame stop being
// ramps you roll over and become LINES you lock onto, slide, yaw on and pop off.
//
// THE ONE RULE THIS MODULE BREAKS, AND THE ONLY PLACE IT MAY BE BROKEN.
// Everywhere else in this engine the body is DEPENETRATED and slid along —
// physics/no-snag (controller.js:414-472) owns that and "everything is
// rideable" is what it means. A jib is the single exception: while `railOn` the
// body is HELD to a line (§2.4). That is why this is its own module with one
// state, one entry, two exits and no third — a held body is a bug everywhere
// else in the player and a feature here, so it is worth being able to read the
// whole of it in one file.
//
// WHAT IT IS NOT. There is no balance mini-game, nothing knocks you off, and
// there is no slide-out failure state (D5, D7). You ride to the end or you pop.
// A jib cannot put you down; the only thing that can, on a jib, is a grab you
// are still holding at touchdown (§5.4, R3's).
//
// FRAMES. park.mjs builds the world in ENU z-up and `out.jibs` carries the jib
// lines in that frame. main.js stores the world as (x, z_enu, -y_enu)
// (main.js:2325), so the table is TIPPED ONCE at init, exactly the way
// markers.js tips `world.markers` (markers.js:929). Nothing downstream of
// `initRail()` ever sees an ENU coordinate.
//
// THE RIDE LINE vs THE BUILT LINE. `pts` are the points the geometry was drawn
// through: the deck TOP for a box, the tube CENTRELINE for a tube or a rail —
// which is what park.mjs hands `tube()`. `radius` is what lifts a centreline to
// the surface a ski actually slides on, so the ride line is `pts + radius` on
// world up, and a box (radius 0) is unchanged. P1 asserts the table against
// park.mjs's own expressions, so the offset lives here and not in the table.

// ------------------------------------------------------------ THE CONSTANTS
// specs/0057 §1.3, §2, §3. Every one of these is a spec number; none is tuned.
const RAIL = {
  // §1.3 / §2.1 — THE ENTRY WINDOW. Horizontal and vertical are SPLIT so you
  // cannot lock on from under a rail, and `RAIL_DZ` sits deliberately below
  // `T.stepUp` 0.55: a jib you can step onto for free is not a jib you lock on.
  // GREG, 2026-09-06: "rails and boxes should be more magnetics and carry
  // double speed by default". `CATCH` and `FLAT` are DOUBLED — the capture is
  // the half of that decision this block owns. `DZ` is NOT: it is the one that
  // stops you locking on from under a rail, and 0.35 already sits deliberately
  // under `T.stepUp` 0.55, so doubling it would make a jib something you step
  // onto for free. See specs/0057-DECISIONS.md §2026-09-06 for the measured
  // false-lock-on sweep behind these two numbers.
  CATCH: 1.00,        // m — perpendicular distance to the line, HORIZONTAL only
                      //     (was 0.50; 2026-09-06)
  DZ: 0.35,           // m — |feet y - line y| at that parameter
  FLAT: 30 * Math.PI / 180,   // rad — ski roll. Flat locks on, a carve does not
                      //     (was 15°; 2026-09-06. Still 10° under SAVE_FLAT, so
                      //     the hard-fall save stays the wider of the two.)
  V_MIN: 2.5,         // m/s — tangential. Only stops a STANDING rider being
                      // captured; it sits under ski.js's `landMin` 3.0 so a slow
                      // arrival still locks on and still never falls
  // §2.3 — THE HARD-FALL SAVE (D3). The same test, widened, run from the
  // controller's landing block before `wipeout()`. No impact ceiling and no
  // `V_MIN`: a dead-vertical drop onto a rail locks on.
  SAVE_DZ: 0.60,      // m
  SAVE_FLAT: 40 * Math.PI / 180,   // rad
  // §2.2 — THE MAGNET. The lateral error pays off over 8 fixed steps (0.067 s
  // at 120 Hz) as `err x (1 - smoothstep(i/8))`, so 0.50 m is under 0.01 m
  // inside the 8 and the pull is never a snap. VELOCITY IS NOT TOUCHED — the
  // magnet is position-only, so it can neither add nor remove speed.
  PULL_N: 8,          // fixed steps
  // ...and the hold is bounded at PUSH_MAX's own number (controller.js:422),
  // reused rather than restated so a rescue and a hold cannot disagree about
  // what a metre a frame is.
  HOLD_MAX: 0.60,     // m per frame
  // §3.1 — YAW AT WILL (D4). A/D about world up. 3.2 rad/s is 183 deg/s, so a
  // 180 deg switch takes 0.98 s. The arrows are untouched and stay the air
  // trick keys; on a jib the ski's carve path is inert.
  YAW_RATE: 3.2,      // rad/s
  SW_HYST: 8 * Math.PI / 180,  // rad — the 90 deg lattice's debounce band
  // §3.2 — THE COMPRESSION CHARGE (D6). Full in 2.5 s. `comp` reaches ski.js as
  // a NAMED ADDITIVE TERM summed into the compression at its read sites; the
  // lip/pop constants themselves (`lipCompK` 0.25, `lipCompMax` 3.0,
  // `popCompK` 0.18, `popCompMax` 3.0) do not move, which is the whole of D6's
  // "the existing charge cap / pop model is unchanged".
  CHARGE: 4.0,        // m/s of compression per second on a jib
  CHARGE_MAX: 10.0,   // m/s
  COMP_DECAY: 6.0,    // m/s per second, OFF the jib — it is a pop-off-this-jib
                      // bank, not a charge you carry down the run
  // §3.3 — FEEL (D7). RETIRED 2026-09-06 and kept for the record only: Greg's
  // "carry double speed by default" makes the ride's along-line speed a
  // CONSTANT (see BOOST below), so there is nothing left for a per-type decay
  // rate to act on. The table stays in the file because 0057 §3.3 is written
  // around it and the decision that retired it names these four numbers; it is
  // read by nothing.
  DRAG: { tube: 0.04, rail: 0.06, box: 0.22, aframe: 0.30 },
  // GREG, 2026-09-06 — THE SPEED HALF. On lock-on the along-line speed becomes
  // `2 x |v_entry . tangent|`, floored at `V_MIN`, and is then HELD for the
  // whole ride: no drag, no gravity term, no charge tax. Both §3.4 exits write
  // it straight back onto `vel`, so the pop and the end of the line carry the
  // doubled speed into the air or the snow — which is the whole point of the
  // decision. It is also the number fx.js's spark source reads (§7.1), so a
  // 50-50 throws sparks at the ramp's full rate instead of at a third of it.
  BOOST: 2.0,         // x, on the entry's tangential speed
  // The sweep resolution for §1.3's swept-segment test. At 20 m/s one fixed
  // step covers 0.167 m and a fast drop-in would tunnel a point test, so
  // `prevPos -> pos` is sampled at this spacing (capped, so a teleport cannot
  // buy an unbounded loop).
  SWEEP_STEP: 0.10,   // m
  SWEEP_MAX: 12,      // samples
  // ...and what is NOT a sweep. A step that moved further than this is a
  // teleport, a respawn or a lift unload, not a body travelling; sweeping it
  // would let a fast-travel across the map lock onto a rail it flew over. Well
  // over the 0.167 m a 20 m/s rider covers in one fixed step, and over the 1.0 m
  // the 0.05 s dt clamp allows at that speed.
  SWEEP_JUMP: 2.0,    // m
  // §2.4 — the hold FOLLOWS THE SURFACE. A tube is faceted (park.mjs draws it
  // with 8-10 sides), so its real top sits a few millimetres under the ideal
  // centreline + radius, and a body parked on the ideal line is airborne by
  // that much — which costs the pop its ground (`grounded` is the jump's gate,
  // controller.js:1332) and freezes ski.js's whole lip model in its air branch.
  // So the held y is the JIB'S OWN SURFACE where one is within this of the
  // line, and the ideal line where it is not: a ski slides on the triangles,
  // not on the axis.
  SURF_SNAP: 0.25,    // m
};

// smoothstep, the one the magnet's decay is written in
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const DEG = 180 / Math.PI;

// ------------------------------------------------------------- MODULE STATE
// One rider, one jib, one state. `S.on` is the whole of "am I on a jib".
const S = {
  ctrl: null, jibs: [], u: 1, ready: false,
  on: false, jib: null, seg: 0, s: 0, L: 0,
  railYaw: 0,        // rad, UNWRAPPED — the switch-up lattice counts on this
  entryYaw: 0,       // rad, wrapped — what the lock-on was worth (§4.2)
  sw: 0,             // switch-ups crossed
  swIdx: null,       // the lattice index last counted (null = between bands)
  comp: 0,           // banked compression, m/s
  // THE ALONG-LINE SPEED, world units per second, SIGNED (riding a rail switch
  // is riding it backwards, and the sign is what says so). Set once at lock-on
  // to `BOOST x` the entry's tangential speed and then held; `advance()` reads
  // it instead of re-deriving a tangential component off `vel` every step, so
  // gravity and the slide cannot bleed the ride. It is also the ONE number
  // fx.js's spark source wants — `railState().vt` publishes it in m/s.
  vt: 0,
  t: 0,              // seconds on this jib
  why: '',           // 'ride' | 'jib' — 'jib' is the hard-fall save (§2.3, P7)
  pull: 0,           // steps left in the magnet
  errX: 0, errY: 0, errZ: 0,
  jumpAt: 0,         // ctrl.jumpEdges when this ride started
  // ...and the jib you have just left, which you may not re-enter until you
  // have actually LEFT ITS WINDOW. Without it §3.4's two exits do not exist: a
  // pop rises 0.06 m in its first frame and is inside `RAIL_DZ` 0.35 for
  // another five, so the entry test recaptures it before it clears the rail and
  // a pop is a 0.12 m hop; and a ride off the end is still within `RAIL_CATCH`
  // of the clamped last point, so it re-locks and exits every other frame. It
  // is a re-ENTRY rule and not a timer: clear the window and the same rail is
  // yours again on the next step, which is what a pop-and-land-back-on is.
  relock: null,
  popped: false,     // the last exit was a pop off the end (fx reads it, §7.3)
  prev: null,        // last step's position — the swept segment's tail
  rides: 0,
};

// --------------------------------------------------------------- THE TABLE
// One row per jib, tipped into the player frame and pre-measured: cumulative
// arc length, per-segment tangent, total length, and a bounding sphere so the
// per-step sweep rejects six of the seven jibs on one distance test.
function tipTable(rows, upAxis, u) {
  const out = [];
  for (const r of rows || []) {
    if (!r || !Array.isArray(r.pts) || r.pts.length < 2) continue;
    const rad = (Number(r.radius) || 0) * u;
    const pts = r.pts.map((p) => {
      const q = upAxis === 'z' ? [p[0], p[2], -p[1]] : [p[0], p[1], p[2]];
      // the ride line: the built line lifted by the tube's own radius, which is
      // 0 for a box and is why a box needs no special case anywhere below
      return { x: q[0] * u, y: q[1] * u + rad, z: q[2] * u };
    });
    if (!pts.every((p) => isFinite(p.x) && isFinite(p.y) && isFinite(p.z))) continue;
    const seg = [];
    let L = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      seg.push({ a, b, len, s0: L, tx: dx / len, ty: dy / len, tz: dz / len });
      L += len;
    }
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p.x; cy += p.y; cz += p.z; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    let rr = 0;
    for (const p of pts) rr = Math.max(rr, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
    out.push({
      id: String(r.id || 'jib-' + out.length),
      type: RAIL.DRAG[r.type] === undefined ? 'rail' : r.type,
      width: (Number(r.width) || 0) * u, radius: rad,
      pts, seg, L, cx, cy, cz, rr,
    });
  }
  return out;
}

// ------------------------------------------------------------ THE GEOMETRY
// Where on the line is this point, and how far off it. HORIZONTAL ONLY for the
// distance (§1.3): the vertical term is split out so you cannot lock on from
// under a rail. `f` is the clamped parameter on the segment, in the horizontal
// plane, which is what "perpendicular distance to the line" means for a rider
// standing beside one.
function nearOnSeg(g, p) {
  const dx = g.b.x - g.a.x, dz = g.b.z - g.a.z;
  const l2 = dx * dx + dz * dz;
  const f = l2 > 1e-9 ? Math.min(1, Math.max(0, ((p.x - g.a.x) * dx + (p.z - g.a.z) * dz) / l2)) : 0;
  const qx = g.a.x + dx * f, qz = g.a.z + dz * f;
  const qy = g.a.y + (g.b.y - g.a.y) * f;
  return { f, horiz: Math.hypot(p.x - qx, p.z - qz), dy: p.y - qy, x: qx, y: qy, z: qz };
}

// The point on the whole polyline at arc length `s`, and the segment it is on.
function lineAt(J, s) {
  let i = 0;
  while (i < J.seg.length - 1 && s > J.seg[i].s0 + J.seg[i].len) i++;
  const g = J.seg[i];
  const f = Math.min(1, Math.max(0, (s - g.s0) / g.len));
  return { seg: i, g, x: g.a.x + (g.b.x - g.a.x) * f, y: g.a.y + (g.b.y - g.a.y) * f,
           z: g.a.z + (g.b.z - g.a.z) * f };
}

// ------------------------------------------------------------- THE SWEEP
// §1.3 — BOTH TESTS RUN ON THE SWEPT SEGMENT `prevPos -> pos`, not on the point.
// At 20 m/s one fixed step covers 0.167 m; a fast drop-in tunnels a point test
// straight through a 0.35 m vertical window. Sampled rather than solved because
// the vertical term is per-parameter and the sample spacing (0.10 m) is a third
// of the smaller of the two windows.
function sweep(prev0, pos, catchR, dzMax) {
  const mv0 = prev0 ? Math.hypot(pos.x - prev0.x, pos.y - prev0.y, pos.z - prev0.z) : 0;
  const prev = mv0 > RAIL.SWEEP_JUMP * S.u ? null : prev0;   // a teleport is not a sweep
  const mv = prev ? mv0 : 0;
  const n = Math.min(RAIL.SWEEP_MAX, Math.max(1, Math.ceil(mv / RAIL.SWEEP_STEP)));
  let best = null;
  for (const J of S.jibs) {
    // the bounding-sphere reject: six of the seven jibs die here every step
    const d = Math.hypot(pos.x - J.cx, pos.y - J.cy, pos.z - J.cz);
    if (d - mv > J.rr + catchR + dzMax + 2) continue;
    for (let k = 0; k <= n; k++) {
      const f = n === 0 ? 1 : k / n;
      const p = prev
        ? { x: prev.x + (pos.x - prev.x) * f, y: prev.y + (pos.y - prev.y) * f, z: prev.z + (pos.z - prev.z) * f }
        : pos;
      for (let i = 0; i < J.seg.length; i++) {
        const q = nearOnSeg(J.seg[i], p);
        if (q.horiz > catchR || Math.abs(q.dy) > dzMax) continue;
        if (!best || q.horiz < best.horiz) {
          best = { J, seg: i, horiz: q.horiz, dy: q.dy,
                   s: J.seg[i].s0 + q.f * J.seg[i].len, at: p };
        }
      }
    }
  }
  return best;
}

// §1.3 — SKI ROLL, `asin(|right . up_world|)`: the edge angle, not the pitch
// and not the ground normal. The body's right vector is the yaw frame rolled by
// `lean` about its own forward axis, so `right . up_world` is `sin(lean)` by
// construction and this is `|lean|` written the way the spec measures it.
function rollNow() {
  const l = S.ctrl ? (S.ctrl.lean || 0) : 0;
  return Math.asin(Math.min(1, Math.abs(Math.sin(l))));
}

// The yaw whose FORWARD is this tangent. three.js forward is (-sin y, -, -cos y).
const tanYaw = (g) => Math.atan2(-g.tx, -g.tz);

// ---------------------------------------------------------------- LOCK-ON
// §2.1 + §2.2. One entry, used by both the ordinary ride-on and the hard-fall
// save; `wide` is the save's widened window and is the ONLY difference between
// them (§2.3): `RAIL_CATCH` unchanged, `RAIL_DZ` 0.60, roll 40 deg, no impact
// ceiling, and `RAIL_V_MIN` not applied.
function tryLock(wide) {
  const c = S.ctrl;
  if (!c || !S.jibs.length) return false;
  if (S.on || c.mode !== 'skis') return false;
  if (!wide && c.wipeT > 0) return false;
  if (rollNow() > (wide ? RAIL.SAVE_FLAT : RAIL.FLAT)) return false;
  const pos = c.position;
  const hit = sweep(S.prev, pos, RAIL.CATCH * S.u, (wide ? RAIL.SAVE_DZ : RAIL.DZ) * S.u);
  // the re-entry rule: the jib just left stays refused until a step where the
  // window no longer holds it at all, and then it is an ordinary jib again
  if (!hit || hit.J.id !== S.relock) S.relock = null;
  if (!hit || hit.J.id === S.relock) return false;
  const J = hit.J, g = J.seg[hit.seg];
  const v = c.velocity;
  // TANGENTIAL SPEED, signed either way: sliding a rail switch is a slide.
  const vt = v.x * g.tx + v.z * g.tz;
  if (!wide && Math.abs(vt) < RAIL.V_MIN * S.u) return false;

  // GREG, 2026-09-06 — THE DOUBLE. The ride's speed is decided here, once, off
  // the speed you arrived with, and nothing changes it again until release:
  // `2 x |vt|`, floored at `V_MIN` so the hard-fall save (which skips the
  // `V_MIN` gate above and can arrive at a dead-vertical zero) still leaves the
  // rail moving instead of parked on it. The sign is the entry's, so a switch
  // entry rides switch.
  const sgn = vt < 0 ? -1 : 1;
  S.vt = sgn * Math.max(RAIL.V_MIN * S.u, Math.abs(vt) * RAIL.BOOST);

  S.on = true; S.jib = J; S.seg = hit.seg; S.s = hit.s; S.L = J.L;
  S.railYaw = wrapPi(c.yaw - tanYaw(g));
  S.entryYaw = S.railYaw;
  S.sw = 0; S.t = 0; S.rides++;
  S.why = wide ? 'jib' : 'ride';
  S.popped = false;
  // the lattice index we STARTED in, so a slide-in at a clean 90 deg does not
  // score a switch-up for standing still (§3.1)
  const k0 = Math.round(S.railYaw / (Math.PI / 2));
  S.swIdx = Math.abs(S.railYaw - k0 * Math.PI / 2) <= RAIL.SW_HYST ? k0 : null;
  // §2.2 — the magnet's debt, paid off over the next `PULL_N` steps. Position
  // only: `vel` is not touched here or anywhere in the pull.
  const at = lineAt(J, S.s);
  S.errX = pos.x - at.x; S.errY = pos.y - at.y; S.errZ = pos.z - at.z;
  S.pull = RAIL.PULL_N;
  S.jumpAt = c.jumpEdges;
  if (c.setRailHold) c.setRailHold(true);   // §2.4 rule 1 — the NOSNAG skip
  return true;
}

// ---------------------------------------------------------------- RELEASE
function release(why) {
  S.relock = S.jib ? S.jib.id : null;
  S.on = false; S.pull = 0; S.popped = why === 'pop';
  // ...and the ride's speed is spent. `vel` already carries it (both exits and
  // the hold write `g.t * S.vt` onto the controller before this runs), so
  // zeroing here takes the number off the READOUT and not off the rider: it
  // stops `railState().vt` handing fx.js a stale speed for a jib nobody is on.
  S.vt = 0;
  if (S.ctrl && S.ctrl.setRailHold) S.ctrl.setRailHold(false);
}

// ------------------------------------------------------------- THE ON-RAIL
// §3. Advanced from the fixed step `stepFixed` drives, AFTER `ctrl.update()`:
// the controller has already integrated gravity, run the slide and judged the
// landing, and this is the frame's last word on where the body is.
function advance(dt) {
  const c = S.ctrl, J = S.jib, pos = c.position, vel = c.velocity;
  S.t += dt;

  // ---- yaw at will (D4). The ski's carve is inert on a jib: `yaw` is written
  // here every step, so whatever ski.js did with A/D this frame is overwritten.
  let dy = 0;
  if (c.keys.left) dy += 1;
  if (c.keys.right) dy -= 1;
  if (dy) S.railYaw += dy * RAIL.YAW_RATE * dt;
  // ...and the SWITCH-UPS. Every crossing of the 90 deg lattice in EITHER
  // direction is one (D4's "every 90 deg crossed"), so yawing back across the
  // same boundary counts again. `SW_HYST` is the debounce: a boundary is
  // counted on entering its band and cannot count again until the band is left,
  // so parking on a boundary cannot farm the counter.
  const k = Math.round(S.railYaw / (Math.PI / 2));
  if (Math.abs(S.railYaw - k * Math.PI / 2) <= RAIL.SW_HYST) {
    if (S.swIdx !== k) { S.sw += 1; S.swIdx = k; }
  } else S.swIdx = null;

  // ---- the charge (D6). Clamped, and it is the ONLY thing this module adds to
  // ski.js's compression.
  S.comp = Math.min(RAIL.CHARGE_MAX * S.u, S.comp + RAIL.CHARGE * S.u * dt);

  // ---- along the line. `s += (v . tangent) dt`; crossing a `pts` vertex
  // carries `s` and re-projects velocity onto the next tangent, which on this
  // park is the flatbar's kink and nothing else.
  let at = lineAt(J, S.s);
  let g = at.g;
  // GREG, 2026-09-06 — the along-line speed is `S.vt`, decided at lock-on and
  // HELD. It is no longer re-derived from `vel` each step, and §3.3's per-type
  // `DRAG` is no longer applied. Both of those were the same mechanism read two
  // ways: re-projecting `vel` is what let gravity, the slide and the landing
  // judge quietly take speed off a ride, and `DRAG` is what took the rest. A
  // held ride cannot lose speed to any of them, which is what "carry double
  // speed" means once you follow it through the frame.
  const vt = S.vt;
  S.s += vt * dt;
  S.seg = at.seg;

  // ---- §3.4 EXIT 1: THE END OF THE LINE. Release with the velocity you have,
  // along the last tangent, plus the drop. No bonus, no burst.
  if (S.s > J.L || S.s < 0) {
    S.s = Math.min(J.L, Math.max(0, S.s));
    vel.x = g.tx * vt; vel.y = g.ty * vt; vel.z = g.tz * vt;
    release('end');
    return;
  }

  at = lineAt(J, S.s); g = at.g; S.seg = at.seg;
  // the heading follows the segment the body is actually on, so the kink turns
  // the rider with it and `railYaw` stays the angle to the tangent under foot
  c.setYaw(tanYaw(g) + S.railYaw);

  // ---- THE HOLD. §2.4: this is the ONE place in the engine where the body is
  // held rather than depenetrated. During the magnet's 8 steps the remaining
  // offset decays as `1 - smoothstep(i/8)`; after them the body IS the line.
  // Bounded at `HOLD_MAX` per frame either way.
  let kx = 0;
  if (S.pull > 0) {
    S.pull -= 1;
    kx = 1 - smoothstep((RAIL.PULL_N - S.pull) / RAIL.PULL_N);
  }
  // ...and the line's own y is replaced by the JIB'S SURFACE where the two are
  // within `SURF_SNAP`, so the body ends the frame standing ON the triangles and
  // the controller's ground probe grounds it. Without this a faceted tube leaves
  // the rider a few millimetres airborne for the whole slide, `grounded` is
  // false, and the pop (§3.4) has no ground to leave.
  let ly = at.y;
  if (S.collision && S.collision.groundAt) {
    const gy = S.collision.groundAt(at.x, at.z, at.y + RAIL.SURF_SNAP * S.u);
    if (gy !== null && Math.abs(gy - at.y) <= RAIL.SURF_SNAP * S.u) ly = gy;
  }
  const tx = at.x + S.errX * kx, ty = ly + S.errY * kx, tz = at.z + S.errZ * kx;
  const mx = tx - pos.x, my = ty - pos.y, mz = tz - pos.z;
  const ml = Math.hypot(mx, my, mz);
  const cap = RAIL.HOLD_MAX * S.u;
  const sc = ml > cap ? cap / ml : 1;
  pos.x += mx * sc; pos.y += my * sc; pos.z += mz * sc;
  // ...and the velocity is PROJECTED onto the tangent. Not scaled, not added
  // to: the magnet is position-only (§2.2) and this is the hold, which cannot
  // hand the rider speed it did not already have along the line.
  vel.x = g.tx * vt; vel.y = g.ty * vt; vel.z = g.tz * vt;
}

// =============================================================== THE MODULE
export function initRail(ctx) {
  S.ctrl = (ctx && ctx.ctrl) || null;
  S.collision = (ctx && ctx.collision) || null;
  S.u = (ctx && ctx.unitScale) || 1;
  S.jibs = tipTable(ctx && ctx.jibs, ctx && ctx.upAxis === 'z' ? 'z' : 'y', S.u);
  S.on = false; S.comp = 0; S.prev = null; S.ready = !!(S.ctrl && S.jibs.length);
  if (S.ctrl && S.ctrl.setRailHold) S.ctrl.setRailHold(false);
  return S.jibs.length;
}

// The whole per-step story, called from main.js's `playerSystems()` — FIRST, so
// tricks.js and the HUD read the jib state the frame just produced.
export function railStep(dt, live) {
  const c = S.ctrl;
  if (!c) return;
  if (!live) { S.prev = { x: c.position.x, y: c.position.y, z: c.position.z }; return; }

  // A FAST TRAVEL IS NOT A SLIDE. `ctrl.teleport` is every marker T, every lift
  // unload and every respawn (main.js:1893), and none of them re-enters the
  // jib the body was on — so a step that moved further than a body can move
  // ends the ride before anything else looks at it. Without this the hold drags
  // the rider back toward a rail on the other side of the mountain at
  // `HOLD_MAX` a frame.
  if (S.on && S.prev
      && Math.hypot(c.position.x - S.prev.x, c.position.y - S.prev.y, c.position.z - S.prev.z)
         > RAIL.SWEEP_JUMP * S.u) release('teleport');

  if (S.on) {
    // ---- the three things that end a ride, checked before the hold so none of
    // them can be undone by it.
    // §3.4 EXIT 2: THE POP. `keys.jump` is edge-triggered and `ctrl.update()`
    // eats it on its last line, so the edge is read off the controller's own
    // counter. The jump itself already went through ski.js's ORDINARY pop path
    // inside update() with `railComp` banked — the pop window/coyote knobs are
    // not consulted, because on a jib the jib is the lip.
    if (c.jumpEdges !== S.jumpAt) { release('pop'); }
    // §2.4 rule 2: `railOn` does not suppress the wall wipe. A near-90 meeting
    // with something that is NOT the jib still wipes, and clears the state on
    // the frame it fires.
    else if (c.wipeT > 0) release('wipe');
    else if (c.mode !== 'skis') release('gear');
    else advance(dt);
  } else if (c.mode === 'skis' && c.wipeT === 0) {
    tryLock(false);
  }

  // §3.2 — OFF the jib the bank decays. It is a pop-off-this-jib bank, not a
  // charge you carry down the run.
  if (!S.on) S.comp = Math.max(0, S.comp - RAIL.COMP_DECAY * S.u * dt);
  if (S.feed) S.feed(S.comp);
  S.prev = { x: c.position.x, y: c.position.y, z: c.position.z };
}

// ski.js's named additive term (§3.2). Wired by main.js rather than imported so
// this module has no dependency of its own and a world with no jibs pays
// nothing: `railComp` is 0 and every read site is bit-for-bit unchanged.
export function railFeed(fn) { S.feed = fn; }

// §2.3 — THE HARD-FALL SAVE (D3). Called from controller.js's landing block,
// BEFORE `wipeout()`, and it overrides BOTH of that block's verdicts: `crossed`
// (skis > 90 deg + wipeTol off travel) and `rotation` (tricks.js's judge).
// Landing on a jib from a height that would otherwise wipe you out locks on
// clean instead. It does NOT save a held grab (§5.4) — that check is upstream.
export function railSave() {
  if (!S.ready || S.on) return false;
  return tryLock(true);
}

export function railOn() { return S.on; }

// The state F1's fx, R2's scoring and R3's grabs read, and nothing else. `yaw`
// and `entryYaw` are DEGREES, signed and wrapped to (-180, 180] — the units
// §4.2's `|railYaw|/90` and §4.4's name bands are written in.
export function railState() {
  return {
    jib: S.on ? S.jib.id : null,
    type: S.on ? S.jib.type : null,
    s: S.on ? S.s : 0,
    yaw: S.on ? wrapPi(S.railYaw) * DEG : 0,
    switchUps: S.sw,
    charge: S.comp,
    entryYaw: S.entryYaw * DEG,
    // beyond the seven the spec names, and additive: length, time on the
    // feature (§4.1's 0.30 s micro-hop rule reads it), why the lock happened
    // ('jib' is the hard-fall save, which is what P7 asserts) and whether the
    // last exit was a pop (§7.3's takeoff burst).
    // specs/0057 §7.1, fixed 2026-09-06 — THE ALONG-RAIL SPEED, in METRES PER
    // SECOND and signed, like `yaw` is in degrees: the unit the consumer asks
    // in, converted once here rather than at each read site. fx.js's spark
    // source reads THIS and not `ctrl.speed()`. The two are not the same
    // number and the difference is the whole of the dead-sparks bug: the hold
    // (§2.4) writes `vel = tangent * vt` as the frame's LAST word, so anything
    // sampling the controller reads a velocity that has already been through
    // gravity, the slide and the landing judge on its way there, and on a held
    // jib that can sit under `SP.V_MIN` 3.0 while the rider is plainly moving.
    // `vt` is the ride's own speed and cannot.
    vt: S.on ? S.vt / S.u : 0,
    L: S.on ? S.L : 0, t: S.on ? S.t : 0, why: S.why, popped: S.popped,
    rides: S.rides, yawRad: S.on ? wrapPi(S.railYaw) : 0, width: S.on ? S.jib.width : 0,
  };
}

// The table itself, tipped and measured, for P1 and for anything that wants to
// draw it. `pts` is the RIDE LINE — the built line lifted by `radius` — which is
// the line every test in §8 places a body on.
export function railJibs() {
  return S.jibs.map((J) => ({
    id: J.id, type: J.type, L: J.L, width: J.width, radius: J.radius,
    pts: J.pts.map((p) => [p.x, p.y, p.z]),
  }));
}

// specs/0057 §0 — the module publishes its own handle, the convention
// controller.js and collision.js already use. EXACTLY `{ on(), state() }`: F1,
// R2 and R3 read this and nothing else, and it adds nothing to `__player`
// (0058 §4.1 / C13).
try {
  if (typeof window !== 'undefined') {
    window.__rail = { on: railOn, state: railState };
    // ...and the TABLE, on its own lab handle rather than on `__rail`, whose
    // shape the spec pins to exactly two calls. P1 reads this; so does anything
    // that wants to place a body on a jib without knowing park.mjs's frame.
    window.__playJibs = railJibs;
  }
} catch { /* not a browser */ }
