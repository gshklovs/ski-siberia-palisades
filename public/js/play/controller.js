// Capsule-ish first person character controller.
//
// Ground: one ray straight down from (feet + stepUp). Anything the ray finds is
// standable, which is what makes shallow rocks and dune slopes free — they are
// simply "ground that moved up a bit". Walls: two horizontal probes (knee and
// chest) that start ABOVE the step height, so a 30 cm rock is a step and a
// 3 m boulder is a wall, with no separate classification pass.
//
// Gears: BOOTS (walk/sprint/jump, below) plus a registry of RIDE gears — SKIS
// (ski.js), BIKE (bike.js), the GLIDER (glider.js) and the ROCKET (rocket.js,
// whose thrust lives in boost.js) — that share the probes,
// the wall slide and the ground snap, but nothing else. updateWalk is exactly
// the code it always was, so equipping a gear cannot change how walking feels.
// Adding a gear is one GEARS entry:
//   { S, step, land, jumpVel, launch?, reset?, wipe, holdJump?, footed?,
//     judgeWipe?, spinTrick? }
// E toggles boots ↔ the world's default gear; main.js owns the key and the menu.
//
// `footed` gears (the glider, the rocket) only exist in the air: while your feet
// are down the controller runs updateWalk, so on the ground they ARE boots, and
// the gear takes the whole velocity vector the moment you leave the ground.
//
// `setBoosting` (boost.js) is the one hook an outside module has on the velocity
// here. It says "the motor owns the velocity for these frames", and the gear's
// own model — walk friction, carve, wing, coast — steps aside for exactly that
// long. Collision, the ground snap and every wipe rule keep running underneath
// it. Only the ROCKET gear ever calls it; on skis, the bike, the glider and
// boots this file is what it always was.

import { skiStep, skiLand, skiLaunch, skiCoyote, skiSnapRelease, scaleSkiTuning, resetSki } from './ski.js';
import { bikeStep, bikeLand, bikeLaunch, bikeReset, scaleBikeTuning } from './bike.js';
import { gliderStep, gliderLand, gliderJudgeWipe, gliderReset, scaleGliderTuning } from './glider.js';
import { rocketStep, rocketLand, rocketJudgeWipe, rocketReset, scaleRocketTuning } from './rocket.js';
import { sledStep, sledLand, sledReset, scaleSledTuning } from './sled.js';
import { snowmobileStep, snowmobileLand, snowmobileReset, scaleSnowmobileTuning } from './snowmobile.js';
import { BIKE_GEAR } from './flags.js';

export const TUNING = {
  eyeHeight: 1.70,      // m — standing eye
  radius: 0.36,         // m — body radius used by the wall probes
  walk: 4.5,            // m/s
  sprint: 8.0,          // m/s
  jump: 4.5,            // m/s launch
  gravity: 16.0,        // m/s^2 (game gravity: ~0.63 m apex, 0.56 s hang)
  // Quake-style: acceleration scales with the speed you are asking for, so the
  // top speed is accel/friction * target and both walk and sprint actually
  // reach their number. A fixed m/s^2 caps out at accel/friction regardless.
  accelGround: 14,      // 1/s
  accelAir: 2.5,        // 1/s
  friction: 11,         // 1/s
  stepUp: 0.55,         // m — max free climb
  maxFall: 60,          // m/s terminal
  voidDrop: 90,         // m below spawn before we respawn you
  snapDown: 0.45,       // m — stay glued to ground walking downhill
  // ---- specs/0012: the world is allowed to hurt you.
  // Trees were decor in every one of these maps — surprise.js quipped when you
  // rode THROUGH one. A trunk is now a solid vertical cylinder (solids.js) and
  // meeting it at speed is a wipeout on the same path a bad landing takes.
  treeWipeV: 4.0,       // m/s — at or above this, a trunk is a wipeout; below it
                        // you slide off and can nudge past at walking pace
  // ...and rock is rock. `groundClass()` (collision.js) says what is under the
  // feet; a rock face steeper than 35 deg is stone, flatter is the snow cap
  // sitting on it and skis like snow.
  rockWipeV: 6.0,       // m/s — grounded on stone above this is a wipeout
  rockLandV: 3.0,       // m/s — landing onto stone harder than this is a wipeout
                        // whatever the horizontal speed
};

const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

// collision.js's surface classes, spelled out here so this file does not import
// a constant it only compares against.
const CLASS_ROCK = 1;

export function createController(THREE, collision, spawn, tuning = {}) {
  const T = { ...TUNING, ...tuning };
  // THE SCENE'S UNIT, recovered rather than passed. main.js scales a FIXED list
  // of tuning keys by unitScale before it gets here and `walk` is on that list;
  // the specs/0012 thresholds are not, and a scene where 1 unit is 4 m would
  // otherwise get metre-sized numbers. Recovering it from a length the caller
  // did scale keeps the seam where it already is instead of adding another
  // argument to a call site this spec may not touch.
  const U = (T.walk > 0 && TUNING.walk > 0) ? T.walk / TUNING.walk : 1;
  for (const k of ['treeWipeV', 'rockWipeV', 'rockLandV']) {
    if (tuning[k] === undefined) T[k] = TUNING[k] * U;
  }
  // ride-gear registry — tunings already scaled by the caller
  const GEARS = {
    skis: {
      S: scaleSkiTuning(1, tuning.ski || {}),
      step: skiStep, land: skiLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // ski models bring their own pop
      launch: skiLaunch,         // lips hand back the vertical the ground snap ate
      coyote: skiCoyote,         // ...and a pop just after one is still a pop
      snapRelease: skiSnapRelease,   // ...and the snap itself lets go off a knuckle
      wipe: true,                // off-axis landings tumble (bike.js scrubs in bikeLand)
      reset: resetSki,           // the pump bank and the stivot state are not
                                 // yours across a respawn, a gear change or a teleport
    },
    // specs/0003 — `gearSet`. THIS REGISTRY IS THE FLAG: there is no separate
    // "can ride a bike" boolean anywhere in the player, so with no entry here
    // ctrl.mode can never become 'bike' — every path into it goes through GEARS.
    // bike.js still ships and is still imported above, because main.js builds
    // the fp/tp rigs from it unconditionally and inventory.js imports its
    // thumbnail painter. A registry edit, not a file deletion (D24).
    ...(BIKE_GEAR ? {
      bike: {
        S: scaleBikeTuning(1, tuning.bike || {}),
        step: bikeStep, land: bikeLand,
        jumpVel: (S) => S.hop,     // bunny hop (unused while holdJump is set)
        launch: bikeLaunch,        // lips hand back the vertical the snap ate
        reset: bikeReset,
        wipe: false,
        holdJump: true,            // SPACE is preload/pop: the gear's step owns the
                                   // jump (writes vel.y on release), so the instant
                                   // keys.jump path must not fire
      },
    } : {}),
    glider: {
      S: scaleGliderTuning(1, tuning.glider || {}),
      step: gliderStep, land: gliderLand,
      jumpVel: (S) => T.jump,    // (unreachable: footed gears jump out of updateWalk)
      reset: gliderReset,
      wipe: false,
      footed: true,              // on the ground you are simply on foot
      judgeWipe: gliderJudgeWipe,// flare or eat it — the ski off-axis rule does not apply
      spinTrick: false,          // the mouse turns you all day; barrel rolls are the trick
    },
    rocket: {
      S: scaleRocketTuning(1, tuning.rocket || {}),
      step: rocketStep, land: rocketLand,
      jumpVel: (S) => T.jump,    // (unreachable: footed gears jump out of updateWalk)
      reset: rocketReset,
      wipe: false,
      footed: true,              // boots until the motor lights
      judgeWipe: rocketJudgeWipe,// no flare to save you; the retro-burn is the landing
      spinTrick: false,          // aiming a rocket is not a 360
    },
    sled: {
      S: scaleSledTuning(1, tuning.sled || {}),
      step: sledStep, land: sledLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // you cannot really jump a sled
      reset: sledReset,
      wipe: true,                // the ski off-axis rule, with a NEGATIVE wipeTol:
                                 // a sled tumbles at ~74° where a ski shrugs at 93°
    },
    snowmobile: {
      S: scaleSnowmobileTuning(1, tuning.snowmobile || {}),
      step: snowmobileStep, land: snowmobileLand,
      jumpVel: (S) => T.jump * (S.popMul || 1),   // a small pop; 400 kg does not fly
      reset: snowmobileReset,
      wipe: true,                // forgiving (wipeTol 0.30) but not immune
    },
  };
  // What tap-E toggles boots ↔. Mutable because one equipment type can be flown
  // by more than one gear: picking the rocket pack in the locker's glider tab
  // has to move the toggle target with it, or tap-E would hand you back the wing.
  let defaultGear = GEARS[tuning.defaultGear] ? tuning.defaultGear : 'skis';
  const pos = new THREE.Vector3().copy(spawn.position);      // FEET position
  const vel = new THREE.Vector3();
  let yaw = spawn.yaw || 0, pitch = spawn.pitch || 0;
  let grounded = false;
  let respawns = 0;
  let mode = 'boots';            // 'boots' | keys of GEARS
  let lean = 0;                  // rad — camera bank, ride gears only
  const home = { position: pos.clone(), yaw, pitch };

  const keys = {
    forward: false, back: false, left: false, right: false, sprint: false, jump: false,
    // SPACE level (not edge). Three consumers now: the bike's preload/pop, the
    // glider's flare, and — since 2026-08-31 — the rocket's THROTTLE, which used
    // to be its own `boost` key on G. One level input, one key, and touch.js
    // already sets it for a hold on the right half of the glass.
    jumpHeld: false,
    spinLeft: false, spinRight: false,       // ← → : steer on the ground, trick-spin in the air
    // ↑ ↓ : EXACT aliases of W/S on the ground (ski.js reads them that way), the
    // flip axis in the air (tricks.js). Split off W/S so a flip is not a brake.
    flipFwd: false, flipBack: false,
    tuck: false,                             // SHIFT — flex/absorb in a turn, aero tuck in a line
  };
  // The rocket's motor (boost.js) is driving the velocity this frame. Every gear
  // model here tops out around 30 m/s, so a 100 m/s thrust cannot merely be added
  // to one — it has to replace it for the frames it burns. Only the velocity
  // MODEL stands down: the probes, the wall slide, the ground snap, the landing
  // judgement and the wipe rules below all still run, which is why flying into a
  // cliff is an ordinary wipe.
  let boosting = false;
  // A motor is pushing but the gear model STAYS IN CHARGE. The snowmobile takes
  // its booster this way: standing the sled's model down would take its steering
  // and its track drag with it, and a rocket sled you cannot point is a bullet.
  // The gear reads this as `thrust` in its step ctx and may relax its own limits.
  let thrusting = false;
  let crouch = 0;                // 0..1 — preload compression, from the gear's step

  // ---- air tricks. Yaw accumulated while airborne on skis; judged on landing.
  let airSpin = 0;               // rad, signed, this air
  let airTime = 0;               // s, this air
  let spinPrevYaw = yaw;
  let wipeT = 0;                 // s left of wipeout (camera tumble; speed already scrubbed)
  let lastTrick = null;          // { name, deg } — '360' | '720' | '1080' | 'wipeout'
  let trickJudge = null;         // tricks.js's landing-window verdict, if wired
  let treeHits = 0, rockWipes = 0;   // specs/0012 counters, for the test handle
  const events = { land: 0, trick: null, wipe: null, pop: null };   // drained by main.js each frame

  const TWO_PI = Math.PI * 2;
  const wrapPi = (a) => a - TWO_PI * Math.round(a / TWO_PI);

  function respawn() {
    pos.copy(home.position);
    vel.set(0, 0, 0);
    yaw = home.yaw; pitch = home.pitch;
    grounded = false;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0;
    for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    respawns++;                  // gear is kept: respawning is not un-equipping
  }

  function setMode(m) {
    const next = GEARS[m] ? m : 'boots';
    if (next === mode) return mode;
    mode = next;
    lean = 0; crouch = 0;
    airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0;
    for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    // stepping out of the bindings at 28 m/s would be a physics joke; keep a
    // little of it so the switch never feels like hitting a wall
    if (mode === 'boots') {
      const sp = Math.hypot(vel.x, vel.z);
      if (sp > T.sprint) { const k = T.sprint / sp; vel.x *= k; vel.z *= k; }
    }
    return mode;
  }

  function look(dx, dy, sens = 0.0022) {
    yaw -= dx * sens;
    pitch = clamp(pitch - dy * sens, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  // one horizontal probe; returns the blocking normal or null
  function probe(dx, dz, dist, height) {
    const h = collision.raycast(pos.x, pos.y + height, pos.z, dx, 0, dz, dist);
    if (!h) return null;
    // Only near-vertical surfaces are walls. A steep-but-climbable slope must
    // not stop you dead, otherwise every dune reads as a fence.
    if (Math.abs(h.ny) > 0.72) return null;
    return { nx: h.nx, nz: h.nz, dist: h.dist };
  }

  function slide(mx, mz) {
    let len = Math.hypot(mx, mz);
    if (len < 1e-6) return [mx, mz];
    for (let iter = 0; iter < 3 && len > 1e-6; iter++) {
      const dx = mx / len, dz = mz / len;
      let blocked = null;
      for (const hgt of [T.stepUp + 0.12, 1.35]) {
        const p = probe(dx, dz, len + T.radius, hgt);
        if (p && (!blocked || p.dist < blocked.dist)) blocked = p;
      }
      if (!blocked) break;
      // project the move onto the wall plane, then re-test
      const d = mx * blocked.nx + mz * blocked.nz;
      if (d < 0) { mx -= blocked.nx * d; mz -= blocked.nz * d; }
      else break;
      len = Math.hypot(mx, mz);
    }
    return [mx, mz];
  }

  // THE ONE PLACE A WIPEOUT IS SPENT. Every source — skis crossed on a landing,
  // a rotation left open, a trunk, a rock band — pays exactly the same price, so
  // "you ate it" reads the same however you got there. `why` is what the HUD's
  // WIPEOUT card prints. Zeroing the air is part of the price: whatever you were
  // in the middle of is over, and it also stops a landing judged later in the
  // same frame from overwriting this verdict with its own.
  function wipeout(why, spinDeg = 0) {
    vel.x *= 0.30; vel.z *= 0.30;
    wipeT = 0.9;
    lastTrick = { name: 'wipeout', deg: Math.round(spinDeg), why };
    events.wipe = { ...lastTrick };
    airSpin = 0; airTime = 0;
  }

  // ---- specs/0012 §A: TREES ARE SOLID.
  //
  // A trunk is not in the triangle soup and should not be: a fir is 30 m of
  // needles around a 60 cm stem, and putting the canopy in the soup would make
  // it a floor you could stand on. solids.js keeps the stems in their own 8 m
  // hash instead, so this query is O(cell) — at most four cells read, however
  // many firs the world placed — and not O(trees).
  //
  // Run on EVERY step, grounded or airborne. Skipping it in the air would let
  // you clear a glade by hopping, which is the opposite of what a glade is.
  function stemGuard() {
    if (wipeT > 0) return;                        // no double hits in the tumble
    if (!collision.stemHit) return;               // host with no stem index
    // Up to three passes. `stemHit` answers with the DEEPEST overlap, and in a
    // tight glade two trunks can hold you at once — pushing out of one can put
    // you into the other, and a body left standing inside a trunk is the one
    // state there is no way back out of. Three is enough for any real placement
    // and is bounded, which a while-loop against float geometry would not be.
    // the verdict is on the speed you ARRIVED with, not on the tangential
    // remainder the push-out is about to leave you holding
    const arrival = Math.hypot(vel.x, vel.z);
    let touched = false;
    for (let pass = 0; pass < 3; pass++) {
      const h = collision.stemHit(pos.x, pos.y, pos.z, T.radius, U);
      if (!h) break;
      touched = true;
      // the extra millimetre is not decoration: pushing out by exactly `pen`
      // lands the body ON the cylinder, where float rounding leaves it inside
      // as often as out, and "outside the trunk" has to be true every time
      pos.x += h.nx * (h.pen + 1e-3); pos.z += h.nz * (h.pen + 1e-3);
      // ...and stop driving into the wood. Below the wipe speed this IS the
      // whole event: you slide off, and can nudge past a tree at a walk.
      const into = vel.x * h.nx + vel.z * h.nz;   // < 0 = still heading at it
      if (into < 0) { vel.x -= h.nx * into; vel.z -= h.nz * into; }
    }
    if (!touched) return;
    treeHits++;
    if (arrival >= T.treeWipeV) wipeout('tree');
  }

  function accelerate(wx, wz, target, rate, dt) {
    if (target <= 0) return;
    const cur = vel.x * wx + vel.z * wz;
    const add = clamp(target - cur, 0, rate * target * dt);
    vel.x += wx * add; vel.z += wz * add;
  }

  // A footed gear standing on the ground is boots, full stop — same walk, same
  // jump, same feel. Its own model only gets the frames where you are airborne.
  function footedNow() { const G = GEARS[mode]; return !!(G && G.footed && grounded); }

  function update(dt) {
    dt = clamp(dt, 0.0005, 0.05);
    if (wipeT > 0) wipeT = Math.max(0, wipeT - dt);   // decays in every mode, so a
                                                     // footed gear cannot land mid-
                                                     // wipe and tumble forever
    if (GEARS[mode] && !footedNow()) updateRide(dt);
    else {
      updateWalk(dt);
      // no wing, no bank: let any carried roll drain out while you are on foot
      if (lean) lean += (0 - lean) * Math.min(1, 8 * dt);
    }
    keys.jump = false;   // jump is edge-triggered
  }

  function updateWalk(dt) {
    // wish direction in world XZ from yaw (-Z is forward in three.js)
    const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    let fx = -sinY, fz = -cosY;         // forward
    let rx = cosY, rz = -sinY;          // right
    let wx = 0, wz = 0;
    // the arrows still walk in boots exactly as they always did — they are only
    // a separate axis on skis, and only in the air
    if (keys.forward || keys.flipFwd) { wx += fx; wz += fz; }
    if (keys.back || keys.flipBack) { wx -= fx; wz -= fz; }
    if (keys.right || keys.spinRight) { wx += rx; wz += rz; }   // arrows still strafe in boots
    if (keys.left || keys.spinLeft) { wx -= rx; wz -= rz; }
    const wlen = Math.hypot(wx, wz);
    if (wlen > 1e-6) { wx /= wlen; wz /= wlen; }

    const target = (keys.sprint ? T.sprint : T.walk) * (wlen > 1e-6 ? 1 : 0);

    if (grounded) {
      if (!boosting) {
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > 0) {
          const drop = Math.max(sp, 3) * T.friction * dt;
          const k = Math.max(0, sp - drop) / sp;
          vel.x *= k; vel.z *= k;
        }
        accelerate(wx, wz, target, T.accelGround, dt);
      }
      if (keys.jump) { vel.y = T.jump; grounded = false; }
    } else if (!boosting) {
      accelerate(wx, wz, target, T.accelAir, dt);
    }

    vel.y = Math.max(-T.maxFall, vel.y - T.gravity * dt);

    // ---- horizontal, with wall slide
    let [mx, mz] = slide(vel.x * dt, vel.z * dt);
    pos.x += mx; pos.z += mz;
    if (dt > 1e-6) {
      // keep velocity consistent with what actually happened (so you do not
      // build up speed grinding along a wall)
      vel.x = mx / dt; vel.z = mz / dt;
    }

    // world edge: the collision grid is finite. Stop at it rather than letting
    // people run off into a region with no ground and get respawn-slapped.
    if (!collision.inBounds(pos.x, pos.z)) {
      const b = collision.bounds;
      pos.x = clamp(pos.x, b.x0 + 1, b.x1 - 1);
      pos.z = clamp(pos.z, b.z0 + 1, b.z1 - 1);
      vel.x = 0; vel.z = 0;
    }

    // trunks, before the ground probe — so the height we sample is the height
    // at the place the body actually ended up
    stemGuard();

    // ---- vertical
    const wasGrounded = grounded;
    pos.y += vel.y * dt;

    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
    if (gy !== null && pos.y <= gy + 1e-3) {
      pos.y = gy; vel.y = 0; grounded = true;
    } else if (gy !== null && wasGrounded && vel.y <= 0 && pos.y - gy <= T.snapDown) {
      pos.y = gy; vel.y = 0; grounded = true;   // stick to downhill
    } else {
      grounded = false;
    }

    if (gy === null && pos.y < home.position.y - T.voidDrop) respawn();
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn();
  }

  // ---------------------------------------------------------------- ride
  // Same skeleton as updateWalk — slide, bounds, gravity, ground snap — with
  // the gear module (ski.js / bike.js) doing the horizontal velocity instead
  // of the Quake accelerate(). The differences that matter: the ground normal
  // is fed to the gear model, and the downhill snap grows with speed (at
  // 28 m/s a frame covers half a metre of drop, and a fixed 45 cm snap would
  // leave you chattering).
  const gnorm = { x: 0, y: 1, z: 0 };

  function updateRide(dt) {
    const G = GEARS[mode], S = G.S;

    // the normal under our feet, sampled before we move
    let n = null;
    if (grounded) {
      const g0 = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
      if (g0 !== null) {
        const q = collision.groundNormal();
        gnorm.x = q.x; gnorm.y = q.y; gnorm.z = q.z;
        n = gnorm;
      }
    }

    // The gear model runs unless something else owns the velocity this frame.
    const step = boosting ? null : G.step({
      vel, yaw, keys, grounded, normal: n, gravity: T.gravity, dt, S, lean, thrust: thrusting,
      // gears that fly rather than ride need the look pitch, where they are,
      // and the terrain itself (the glider soars off ground it can sample)
      pitch, pos, collision,
    });
    if (!step) {
      // rocket, not wing: no bank to hold and nothing to preload
      lean += (0 - lean) * Math.min(1, 6 * dt);
      crouch = 0;
    } else {
      yaw = step.yaw;
      lean = step.lean;
      crouch = step.crouch || 0;
      if (step.pop) events.pop = step.pop;   // 'perfect' — HUD stamps it
      // gears that judge their own tricks mid-air (barrel rolls) stamp here
      // rather than waiting for a landing that may never come
      if (step.trick) { lastTrick = { ...step.trick }; events.trick = { ...step.trick }; }
    }

    // holdJump gears (bike) own the jump: their step writes vel.y on release.
    //
    // `coyote` is the one hook that lets a jump edge fire while AIRBORNE, and
    // only skis have one: a pop a beat late off a lip is still that pop. It
    // cannot fire for any other gear, because no other gear declares it.
    //
    // vel.y is pinned to 0 on every grounded frame, so `vel.y +=` is bit-for-bit
    // the assignment it replaces for an ordinary jump. It only does anything on
    // the coyote path — and it must ADD to the true vel.y, sign and all. The
    // first cut wrote `Math.max(0, vel.y) + jumpVel`, which DISCARDED the fall
    // speed: pop a beat after rolling off a downhill knuckle and the −2 m/s you
    // had already picked up was deleted, so a late pop was worth MORE than an
    // on-time one and every downhill roll became a bigger jump than before.
    // Adding decays the coyote payout on its own, with no window arithmetic: at
    // the lip you get the whole jump, a tenth of a second late you get the jump
    // minus what gravity has taken, and off a real lip — where vel.y is already
    // positive — nothing changes at all.
    //
    // ...and `launch` is then given the chance to add the lip to it, exactly as
    // it is on the roll-off path below. The gear's launch is one-shot per air.
    if (keys.jump && !G.holdJump && (grounded || (G.coyote && G.coyote(S)))) {
      vel.y += G.jumpVel(S);
      if (G.launch) G.launch(vel, S, G.jumpVel(S));
      grounded = false;
    }

    // spin meter: every source of yaw counts — A/D, the arrows, the mouse
    // (mouse look lands between frames, which is why this diffs against the
    // yaw we last saw rather than summing torques)
    if (!grounded) {
      airSpin += wrapPi(yaw - spinPrevYaw);
      airTime += dt;
    }
    spinPrevYaw = yaw;

    vel.y = Math.max(-T.maxFall, vel.y - T.gravity * dt);

    // ---- horizontal, with wall slide
    let [mx, mz] = slide(vel.x * dt, vel.z * dt);
    pos.x += mx; pos.z += mz;
    if (dt > 1e-6) { vel.x = mx / dt; vel.z = mz / dt; }

    if (!collision.inBounds(pos.x, pos.z)) {
      const b = collision.bounds;
      pos.x = clamp(pos.x, b.x0 + 1, b.x1 - 1);
      pos.z = clamp(pos.z, b.z0 + 1, b.z1 - 1);
      vel.x = 0; vel.z = 0;
    }

    // trunks. Before the ground probe and before the landing is judged: a tree
    // zeroes the air, so hitting one on the way down is a TREE, not a bad
    // landing that happened to be next to one.
    stemGuard();

    // ---- vertical
    const wasGrounded = grounded;
    const impact = -vel.y;
    pos.y += vel.y * dt;

    // THE DOWNHILL SNAP, and the one hook that is allowed to argue with it.
    // This distance is why a fast rider is glued to the backside of everything:
    // it GROWS with speed, so the quicker you cross a knuckle the further the
    // controller will yank you back down onto it. A gear may hand back a shorter
    // one — only skis do, and only above a speed of their own choosing — and a
    // gear that declares no `snapRelease` keeps this number exactly as computed.
    let snap = Math.max(T.snapDown, Math.hypot(vel.x, vel.z) * dt * S.snapMul);
    if (G.snapRelease) snap = G.snapRelease(S, snap);
    const gy = collision.groundAt(pos.x, pos.z, pos.y + T.stepUp);
    // ---- specs/0012 §B: WHAT IS UNDER THE FEET.
    // Read here and nowhere else, because groundClass() reports the last
    // groundAt() that HIT, exactly as groundNormal() does — and nothing between
    // this line and the landing block below probes the ground again.
    const gCls = (gy !== null && collision.groundClass) ? collision.groundClass() : 0;
    if (gy !== null && pos.y <= gy + 1e-3) {
      pos.y = gy; vel.y = 0; grounded = true;
    } else if (gy !== null && wasGrounded && vel.y <= 0 && pos.y - gy <= snap) {
      pos.y = gy; vel.y = 0; grounded = true;   // stick to downhill
    } else {
      grounded = false;
    }

    // ---- ROCK. The class is the MESH's, gated by the face: a granite bluff's
    // plate tops lie flat enough that this world's snow has covered them, and a
    // snow cap on rock skis like snow (collision.js ROCK_SLOPE_COS). What is
    // left is stone, and stone has two rules:
    //   * arriving out of the air onto it above rockLandV is a wipeout at any
    //     horizontal speed — that is what makes a cliff band a cliff band and
    //     not a ramp;
    //   * riding across it at or above rockWipeV is a wipeout too, and below
    //     that it is simply hard ground you can walk, skate or scramble over.
    // Deliberately NOT gated on airTime: a rock band re-grounds every few frames
    // with a hop far too short to judge, and "that landing was too short to
    // count" must not add up to "granite is free".
    const rockWipe = grounded && wipeT <= 0 && gCls === CLASS_ROCK
      && ((!wasGrounded && impact >= T.rockLandV) || Math.hypot(vel.x, vel.z) >= T.rockWipeV);

    if (grounded && !wasGrounded) {
      const q = collision.groundNormal();
      gnorm.x = q.x; gnorm.y = q.y; gnorm.z = q.z;

      // ---- judge the air. Micro-hops (< 0.3 s) never count either way.
      const spinDeg = Math.abs(airSpin) * 180 / Math.PI;
      let wiped = false;
      // WHY it went wrong, so the stamp can say so. A gear that judges its own
      // landings eats the arrival; skis cross. Printing "skis crossed" over a
      // rocket that came in too hot was the tell that this was missing.
      let why = 'crossed';
      if (airTime > 0.3) {
        const spH = Math.hypot(vel.x, vel.z);
        if (G.judgeWipe) {
          why = 'landing';
          // the gear owns the verdict (a wing cares about sink rate and what it
          // is hitting, not about which way its tips point)
          wiped = !!G.judgeWipe(vel, impact, gnorm, S, keys);
        } else if (G.wipe && spH > S.landMin) {   // landMin doubles as "fast enough to judge"
          // skis pointing >90° off the direction of travel = you eat it. How far
          // past 90° is the gear's business: a park twin forgives a quarter of a
          // turn, a 1972 straight ski forgives nothing. Default is the old 0.06.
          const velYaw = Math.atan2(-vel.x, -vel.z);
          const tol = S.wipeTol == null ? 0.06 : S.wipeTol;
          if (Math.abs(wrapPi(velYaw - yaw)) > Math.PI / 2 + tol) wiped = true;
        }
        // ---- the trick system's landing window (tricks.js, spec 0002 §3.5)
        // LAYERS on top of the rule above; it never replaces it. "Skis crossed"
        // is checked first and is orthogonal — you can close a Cork 900 exactly
        // and still land sideways, and that is still a wipeout. Only if the
        // arrival survives that does the rotation window get a say.
        if (!wiped && trickJudge) {
          const v = trickJudge({ airTime, spinDeg, vel, yaw, impact, normal: gnorm, S, mode });
          if (v && v.wipe) { wiped = true; why = v.why || 'rotation'; }
          if (v && typeof v.snapYaw === 'number') yaw = v.snapYaw;
        }
      }
      // ...and the ground itself gets the last word. Stone beats a clean
      // landing: closing a 720 perfectly onto a granite slab is still a 720 into
      // a granite slab. It is checked outside the airTime gate above, so a
      // micro-hop onto rock counts.
      if (!wiped && rockWipe) { wiped = true; why = 'rock'; rockWipes++; }
      if (wiped) {
        wipeout(why, spinDeg);               // scrub — spins and stone have stakes
      } else if (airTime > 0.3 && G.spinTrick !== false && spinDeg >= 330) {
        const n360 = Math.min(4, Math.floor((spinDeg + 30) / 360));
        lastTrick = { name: String(n360 * 360), deg: Math.round(spinDeg) };
        events.trick = { ...lastTrick };
      }
      if (!wiped) {
        G.land(vel, impact, gnorm, S);          // land on a pitch, keep going
        const sp = Math.hypot(vel.x, vel.z);
        if (sp > S.maxSpeed) { const k = S.maxSpeed / sp; vel.x *= k; vel.z *= k; }
      }
      if (impact > events.land) events.land = impact;
      airSpin = 0; airTime = 0;
    } else if (!grounded && wasGrounded && G.launch) {
      G.launch(vel, S);   // rolled off a lip without jumping — carry the vertical
    } else if (rockWipe) {
      // never left the ground, but the ground turned to stone under you at
      // speed. There is no landing to judge here — the band itself is the event.
      rockWipes++;
      wipeout('rock');
    }

    if (gy === null && pos.y < home.position.y - T.voidDrop) respawn();
    else if (pos.y < collision.bounds.minY - T.voidDrop) respawn();
  }

  function applyToCamera(cam) {
    cam.position.set(pos.x, pos.y + T.eyeHeight, pos.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(pitch, yaw, GEARS[mode] ? lean : 0);
    cam.updateMatrixWorld();
  }

  return {
    T, keys, update, look, respawn, applyToCamera, setMode,
    // the active ride gear's tuning (skis' when in boots — callers use it for
    // "how fast could I possibly go" style normalisation)
    get S() { return (GEARS[mode] || GEARS[defaultGear]).S; },
    get defaultGear() { return defaultGear; },
    setDefaultGear(m) { if (GEARS[m]) defaultGear = m; return defaultGear; },
    get gears() { return Object.keys(GEARS); },
    // A gear's live tuning object, for callers that swap the equipment inside a
    // gear (the ski rack). Object.assign into it — the registry holds this exact
    // object, so replacing it wholesale would not take.
    gearTuning(name) { return GEARS[name] ? GEARS[name].S : null; },
    get position() { return pos; },
    get velocity() { return vel; },
    get grounded() { return grounded; },
    // true when a footed gear (the glider) is standing on the ground, i.e. the
    // walk controller is driving. Callers use it to skip the ride-gear dressing.
    get footedNow() { return footedNow(); },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get respawns() { return respawns; },
    get mode() { return mode; },
    get lean() { return lean; },
    get crouch() { return crouch; },
    get airSpinDeg() { return airSpin * 180 / Math.PI; },
    get airTime() { return airTime; },
    get wipeT() { return wipeT; },
    get lastTrick() { return lastTrick; },
    // specs/0012 — how many trunks the body has actually touched and how many
    // rock bands have ended a run. Counters, not events: a gate asserts on the
    // delta across a stepFixed() run.
    get treeHits() { return treeHits; },
    get rockWipes() { return rockWipes; },
    // what is under the feet right now: 0 snow, 1 rock (collision.js)
    groundClass() { return collision.groundClass ? collision.groundClass() : 0; },
    // one-shot event drain: landing impact + any trick/wipe since the last call
    takeEvents() {
      const out = { land: events.land, trick: events.trick, wipe: events.wipe, pop: events.pop };
      events.land = 0; events.trick = null; events.wipe = null; events.pop = null;
      return out;
    },
    toggleMode() { return setMode(mode === 'boots' ? defaultGear : 'boots'); },
    // tricks.js only: a second opinion on a landing the wipeTol rule already
    // passed. Returns { wipe, why?, snapYaw? } or null.
    setTrickJudge(fn) { trickJudge = typeof fn === 'function' ? fn : null; },
    // boost.js only: "the rocket's motor owns the velocity this frame, stand the
    // gear model down". Nothing else in the player may call this.
    setBoosting(v) { boosting = !!v; return boosting; },
    get boosting() { return boosting; },
    // boost.js only, the other half of the same hook: "a motor is pushing, but
    // keep running the gear model". The gear sees it as ctx.thrust.
    setThrust(v) { thrusting = !!v; return thrusting; },
    get thrusting() { return thrusting; },
    // the surface under your feet as of the last ground probe (skis read it
    // every frame; in boots it is whatever the last update happened to sample)
    groundNormal() { return collision.groundNormal(); },
    setHome(p, y, pi) { home.position.copy(p); home.yaw = y; home.pitch = pi || 0; },
    setYaw(y) { yaw = y; },
    // tricks.js only: the PITCH half of the landing snap. A flip's rotation
    // residual belongs on the flip axis, and this is the only way that module
    // has to spend it there instead of dumping it into the heading. Clamped
    // exactly as look() clamps, so a big residual cannot flip the camera over.
    setPitch(p) { pitch = clamp(p, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02); return pitch; },
    teleport(p, y) {
      pos.copy(p); vel.set(0, 0, 0);
      if (y !== undefined) yaw = y;
      grounded = false; lean = 0; crouch = 0;
      airSpin = 0; airTime = 0; spinPrevYaw = yaw; wipeT = 0;
      for (const g of Object.values(GEARS)) { if (g.reset) g.reset(); }
    },
    speed() { return Math.hypot(vel.x, vel.z); },
  };
}
