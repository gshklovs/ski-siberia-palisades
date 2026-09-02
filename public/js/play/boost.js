// The rocket's motor. THE ENGINE ONLY — the gear it belongs to is rocket.js.
//
// This file burns fuel and writes velocity; it does not decide when you are
// allowed to. It runs ONLY while the rocket gear is equipped (`gear` below,
// checked against ctrl.mode every frame) — which the player reaches by picking
// the Lab Rocket Pack in the locker's GLIDER tab. On skis, on the bike, under
// Aang's wing and in boots, G is inert and this module is a no-op that quietly
// tops up a tank nobody can spend. It was a cross-gear ability once, and that
// was the mistake: a 100 m/s motor available at every moment dissolves whatever
// you are wearing. It is a vehicle now.
//
// Hold G with the pack on and the motor pushes you where you are looking:
// ~35 m/s² up to a soft 100 m/s, 6 s of fuel that refills itself. The worlds got
// big; this is how you cross one.
//
// The one idea that makes it work at all: WHILE THE MOTOR BURNS IT OWNS THE
// VELOCITY. controller.js is told (`setBoosting`) to stand the gear model down
// for those frames — no walk friction, no coast drag — because that model tops
// out an order of magnitude below this one and would delete the thrust the frame
// after it arrived.
//
// Everything ELSE the controller does is untouched, and that is the whole safety
// story: the wall probes, the ground snap, the landing judgement and each gear's
// own wipe rules all still run. Flying into a mountain at 100 m/s is the gear's
// normal wipe, not a special case, and there is no invincibility anywhere in
// this file — the only thing a wipe does here is blow the motor out.
//
// Three smaller decisions:
//
//   GRAVITY IS CANCELLED WHILE BURNING. The motor holds you up, so a level look
//   is a level line and traversal is "point, hold, arrive" instead of a ballistic
//   arc you have to re-aim every second. It is added back the instant you let go.
//
//   IGNITION LIFTS YOU OFF. Standing still, thrust along a level look would be
//   eaten by ground contact and the ground snap. So a burn that starts with your
//   feet down tilts its thrust up to ~11° and puts `liftoff` m/s under you: the
//   rocket leaves the pad, exactly as a rocket should.
//
//   RELEASE HANDS THE VELOCITY BACK AS IT IS. No easing, no grace. rocket.js
//   takes it as a body in the air: gravity, a little drag, and no way to steer.
//   That asymmetry — instant to leave, your problem to arrive — is what makes
//   the retro-burn the landing technique instead of a flare.

export const BOOST_TUNING = {
  accel: 35,          // m/s² along the look while burning
  cap: 100,           // m/s — soft cap; drag past it, not a clamp
  capDrag: 8,         // 1/s of drag per m/s over the cap (terminal ≈ cap + accel/capDrag)
  tank: 6.0,          // s of burn from full — 2.9 s of it is the climb to the cap,
                      // so doubling the tank more than doubles the ground covered
  regen: 1.0,         // fuel-seconds per second, always (no ground contact needed)
  liftoff: 2.4,       // m/s of vertical ignition gives you when your feet are down
  groundTilt: 0.20,   // min sin(climb) of the thrust vector while grounded (~11°)
  spool: 9,           // 1/s — throttle ease; drives every piece of dressing
  fovKick: 8,         // degrees of extra fov at full throttle
  trailLife: 0.30,    // s the exhaust ribbon hangs in the air
  nozzle: 0.34,       // m behind the body the plume starts
};

// Lengths / speeds / accelerations scale with the scene's unit; rates (1/s),
// times and pure ratios do not.
export function scaleBoostTuning(u, over = {}) {
  const S = { ...BOOST_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['accel', 'cap', 'liftoff', 'nozzle']) S[k] *= u;
  return S;
}

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));

const MAXT = 44;             // exhaust ribbon samples

// `riders` is the second way in. The pack is still a vehicle and the tank is
// still one tank; a rider is a MACHINE you bolt the same motor to, declared by
// the caller rather than assumed here:
//
//   riders: { snowmobile: { keys: ['jumpHeld', 'sprint'], mode: 'sled' } }
//
// `keys` is what fires it on that gear (the sled takes SHIFT as well as SPACE,
// which is why SHIFT is no longer its brake), and mode 'sled' is the one behavioural
// fork in this file: a motor bolted to a machine pushes the MACHINE, flat along
// its heading, and leaves the machine's own model running so it still steers and
// its track drag still sets the terminal. No liftoff, no up-tilt, no cancelled
// gravity — those three are what make the pack leave the pad, and a sled that
// leaves the pad is a rocket with a seat. Every other gear is still inert here.
export function createBoost({ THREE, scene, ctrl, camera, unitScale = 1, tuning = {}, gear = 'rocket', riders = {} }) {
  const u = unitScale;
  const S = scaleBoostTuning(u, tuning);

  let fuel = S.tank;
  let burn = false;          // motor lit RIGHT NOW
  // Ran the tank dry. Without this latch, holding G on an empty tank alternates
  // one frame of regen with one frame of burn, forever — a permanent half-power
  // motor that is both a lie about the fuel and a horrible stutter. So running
  // out latches the motor OUT, and there are exactly two ways back in: let go of
  // the key (a fresh ignition is always honoured, with whatever is in the tank),
  // or sit on a held key long enough to fill it completely. The second is what
  // makes "hold G forever" a clean 6 s on / 6 s off rhythm instead of a stutter.
  let dry = false;
  let throttle = 0;          // 0..1, eased — dressing only, never the physics
  let clock = 0;             // s, for the ribbon's ages and the flicker
  let burned = 0;            // lifetime seconds of burn (tests read it)
  let ignitions = 0;
  const dir = { x: 0, y: 0, z: -1 };   // last thrust direction, world frame

  // ------------------------------------------------------------------ visuals
  const addMat = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  });

  // The plume: three nested cones, apex at the nozzle, opening backwards. Cone
  // geometry runs along +Y with its apex up, so -90° about X puts the apex at
  // -Z and the mouth at +Z, and the mesh is then slid forward by half its length
  // to sit the apex exactly on the nozzle.
  function cone(r, len, seg, color, opacity) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, len, seg, 1, true), addMat(color, opacity));
    m.rotation.x = -Math.PI / 2;
    m.position.z = len / 2;
    m.renderOrder = 92;
    return m;
  }
  const flame = new THREE.Group();
  flame.name = 'play:boost-flame';
  const coreC = cone(0.15 * u, 1.10 * u, 8, 0xfff4d2, 0.95);
  const midC = cone(0.32 * u, 2.30 * u, 10, 0xff7a1e, 0.55);
  const haloC = cone(0.60 * u, 3.90 * u, 12, 0xff2a00, 0.20);
  flame.add(haloC, midC, coreC);
  flame.visible = false;
  flame.frustumCulled = false;
  scene.add(flame);

  // The exhaust ribbon: a camera-facing strip through the last `trailLife`
  // seconds of nozzle positions. At 100 m/s that is 30 m of streak, which is the
  // only thing at this speed that reads as motion rather than teleporting.
  const trail = [];                       // { x, y, z, t }
  const rPos = new Float32Array(MAXT * 2 * 3);
  const rCol = new Float32Array(MAXT * 2 * 3);
  const rIdx = new Uint16Array((MAXT - 1) * 6);
  for (let i = 0; i < MAXT - 1; i++) {
    const a = i * 2, o = i * 6;
    rIdx[o] = a; rIdx[o + 1] = a + 1; rIdx[o + 2] = a + 2;
    rIdx[o + 3] = a + 1; rIdx[o + 4] = a + 3; rIdx[o + 5] = a + 2;
  }
  const rGeo = new THREE.BufferGeometry();
  rGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  rGeo.setAttribute('color', new THREE.BufferAttribute(rCol, 3));
  rGeo.setIndex(new THREE.BufferAttribute(rIdx, 1));
  if (THREE.DynamicDrawUsage !== undefined) {
    rGeo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    rGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);
  }
  const ribbon = new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  ribbon.name = 'play:boost-trail';
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 93;
  ribbon.visible = false;
  scene.add(ribbon);

  // First person you are sitting in front of the motor, so instead of a plume
  // you get its light: a warm additive wash that only has weight at the edges of
  // the frame. Mounted to the camera like the fp skis / fp wing.
  function glowTex() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
    grad.addColorStop(0.00, 'rgba(255,120,20,0)');
    grad.addColorStop(0.62, 'rgba(255,120,20,0)');
    grad.addColorStop(0.86, 'rgba(255,138,40,0.55)');
    grad.addColorStop(1.00, 'rgba(255,72,0,0.95)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2 * u, 1.9 * u),
    new THREE.MeshBasicMaterial({
      map: glowTex(), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, fog: false,
    }),
  );
  glow.name = 'play:boost-glow';
  glow.frustumCulled = false;
  glow.renderOrder = 96;
  glow.visible = false;
  scene.add(glow);

  function hide() {
    flame.visible = false;
    ribbon.visible = false;
    glow.visible = false;
  }

  // ------------------------------------------------------------------ physics
  // Called BEFORE ctrl.update(dt) every frame: the velocity we write here is the
  // one the controller integrates, collides and judges this same frame, and the
  // gravity we cancel is the gravity it is about to subtract.
  function step(dt, live) {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    clock += dt;

    const keys = ctrl.keys || {};
    // The gate. Everything below is dead unless the motor is something you are
    // actually wearing or sitting on — the whole point of making it a vehicle
    // rather than an ability.
    const rider = ctrl.mode === gear ? null : riders[ctrl.mode];
    const worn = ctrl.mode === gear || !!rider;
    const sled = !!(rider && rider.mode === 'sled');
    // THE THROTTLE IS HOLD-SPACE, and it used to be G (Greg, 2026-08-31: "no
    // more G"). `jumpHeld` is the LEVEL half of the jump input the player already
    // had — main.js sets it on Space down and clears it on Space up, and touch.js
    // sets the same boolean for a hold on the right half of the glass — so the
    // rebind is a read of an existing seam rather than a new key, and the phone
    // gets the motor for free. Space's EDGE (`keys.jump`) is untouched: press is
    // still exactly the jump it always was, and only the HOLD adds thrust.
    //
    // Nothing here changes what gates the motor. `worn` above is still the whole
    // story — you are on the pack, or on a machine it is bolted to — so a skier
    // leaning on Space gets a jump and no thrust, the same as a skier leaning on
    // G got a jump and no thrust.
    const fire = !!(rider ? (rider.keys || ['jumpHeld']).some((k) => keys[k]) : keys.jumpHeld);
    if (!worn || !fire || fuel >= S.tank - 1e-6) dry = false;
    // A wipe blows the motor out. That is the opposite of invincibility: you
    // asked for 100 m/s into a rock face and the motor stops answering.
    const want = !!(worn && live && fire && fuel > 0 && !dry && !(ctrl.wipeT > 0));
    if (want && !burn) ignitions++;
    burn = want;
    // The pack owns the velocity outright; a sled keeps its own model and is
    // merely pushed by this one.
    ctrl.setBoosting(want && !sled);
    if (ctrl.setThrust) ctrl.setThrust(want && sled);
    throttle += ((want ? 1 : 0) - throttle) * Math.min(1, S.spool * dt);

    if (!want) {
      // Regenerates whenever the motor is off — in the air, mid-wipe, standing
      // still. This is a traversal convenience, not a skill economy; making the
      // player land to refuel would just add a chore to crossing a valley.
      if (live) fuel = Math.min(S.tank, fuel + S.regen * dt);
      return false;
    }

    fuel = Math.max(0, fuel - dt);
    if (fuel <= 0) dry = true;
    burned += dt;

    // ---- thrust direction. On a sled it is the machine's heading, dead flat:
    // the booster is bolted to the tunnel, not strapped to your back, so it
    // drives the track forward instead of trying to fly the thing.
    if (sled) {
      const y = ctrl.yaw;
      dir.x = -Math.sin(y); dir.y = 0; dir.z = -Math.cos(y);
      const v = ctrl.velocity;
      v.x += dir.x * S.accel * dt;
      v.z += dir.z * S.accel * dt;
      return true;                      // no liftoff, no gravity cancel, no cap:
    }                                   // the machine's own model governs speed

    // ---- otherwise: exactly where you are looking
    const yaw = ctrl.yaw, pitch = ctrl.pitch;
    const cp = Math.cos(pitch);
    let dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
    if (ctrl.grounded && dy < S.groundTilt) {
      // feet down: the nozzle points at the deck, so tilt up enough to leave it
      dy = S.groundTilt;
      const h = Math.hypot(dx, dz) || 1e-6;
      const k = Math.sqrt(Math.max(0, 1 - dy * dy)) / h;
      dx *= k; dz *= k;
    }
    dir.x = dx; dir.y = dy; dir.z = dz;

    const vel = ctrl.velocity;
    vel.x += dx * S.accel * dt;
    vel.y += dy * S.accel * dt;
    vel.z += dz * S.accel * dt;

    // the motor carries your weight while it burns
    vel.y += ctrl.T.gravity * dt;

    // ignition off the pad: one frame of this and the ground snap lets go
    if (ctrl.grounded && vel.y < S.liftoff) vel.y = S.liftoff;

    // ---- soft cap: drag past `cap`, so the number is a ceiling you lean on
    // rather than a wall you hit. Terminal sits at cap + accel/capDrag.
    const v = Math.hypot(vel.x, vel.y, vel.z);
    if (v > S.cap) {
      const d = Math.min(S.capDrag * (v - S.cap) * dt, v * 0.5);
      const k = (v - d) / v;
      vel.x *= k; vel.y *= k; vel.z *= k;
    }
    return true;
  }

  // ------------------------------------------------------------------ dressing
  // Called AFTER the camera is posed, like every other visual in main.js.
  const _cam = { x: 0, y: 0, z: 0 };
  function draw(dt, camMode) {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    const tp = camMode === 'tp';
    const p = ctrl.position;
    const eye = ctrl.T.eyeHeight;

    // nozzle: the small of your back, a little behind the thrust axis
    const nx = p.x - dir.x * S.nozzle;
    const ny = p.y + eye * 0.55 - dir.y * S.nozzle;
    const nz = p.z - dir.z * S.nozzle;

    if (burn) trail.push({ x: nx, y: ny, z: nz, t: clock });
    while (trail.length && clock - trail[0].t > S.trailLife) trail.shift();
    if (trail.length > MAXT) trail.splice(0, trail.length - MAXT);

    if (throttle < 0.01) { hide(); return; }

    // ---- plume, third person only (in first person it is behind your head)
    flame.visible = tp && throttle > 0.02;
    if (flame.visible) {
      flame.position.set(nx, ny, nz);
      // point the group's +Z back down the exhaust
      const bx = -dir.x, by = -dir.y, bz = -dir.z;
      const yawB = Math.atan2(bx, bz);
      const pitchB = Math.asin(clamp(by, -1, 1));
      flame.rotation.order = 'YXZ';
      flame.rotation.set(-pitchB, yawB, 0);
      const flick = 0.82 + 0.18 * Math.sin(clock * 47) + 0.08 * Math.sin(clock * 113);
      const s = throttle * flick;
      coreC.scale.set(0.9 + 0.2 * s, 1, s);
      midC.scale.set(0.9 + 0.25 * s, 1, s * (0.85 + 0.3 * Math.sin(clock * 31)));
      haloC.scale.set(1, 1, s * 0.8);
      coreC.material.opacity = 0.95 * throttle;
      midC.material.opacity = 0.55 * throttle;
      haloC.material.opacity = 0.20 * throttle;
    }

    // ---- exhaust ribbon: camera-facing strip through the trail samples
    const n = trail.length;
    ribbon.visible = tp && n >= 2;
    if (ribbon.visible) {
      _cam.x = camera.position.x; _cam.y = camera.position.y; _cam.z = camera.position.z;
      for (let i = 0; i < n; i++) {
        const q = trail[i];
        const a = trail[Math.max(0, i - 1)], b = trail[Math.min(n - 1, i + 1)];
        let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
        if (Math.hypot(tx, ty, tz) < 1e-6) { tx = dir.x; ty = dir.y; tz = dir.z; }
        const cx = _cam.x - q.x, cy = _cam.y - q.y, cz = _cam.z - q.z;
        let sx = ty * cz - tz * cy, sy = tz * cx - tx * cz, sz = tx * cy - ty * cx;
        const sl = Math.hypot(sx, sy, sz) || 1;
        const age = clamp((clock - q.t) / S.trailLife, 0, 1);      // 0 head → 1 tail
        const w = (0.05 + 0.40 * (1 - age)) * u * (0.5 + 0.5 * throttle);
        sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
        const f = (1 - age) * (1 - age) * throttle;
        const o = i * 6;
        rPos[o] = q.x + sx; rPos[o + 1] = q.y + sy; rPos[o + 2] = q.z + sz;
        rPos[o + 3] = q.x - sx; rPos[o + 4] = q.y - sy; rPos[o + 5] = q.z - sz;
        const cr = f, cg = f * (0.30 + 0.45 * (1 - age)), cb = f * 0.12 * (1 - age);
        rCol[o] = cr; rCol[o + 1] = cg; rCol[o + 2] = cb;
        rCol[o + 3] = cr; rCol[o + 4] = cg; rCol[o + 5] = cb;
      }
      rGeo.setDrawRange(0, (n - 1) * 6);
      rGeo.attributes.position.needsUpdate = true;
      rGeo.attributes.color.needsUpdate = true;
    }

    // ---- first person: the motor's light on the edges of the frame
    glow.visible = !tp && throttle > 0.02;
    if (glow.visible) {
      glow.position.copy(camera.position);
      glow.quaternion.copy(camera.quaternion);
      glow.translateZ(-0.55 * u);
      glow.material.opacity = 0.34 * throttle * (0.88 + 0.12 * Math.sin(clock * 39));
    }
  }

  return {
    step, draw, hide,
    // camRig adds this to the fov it wants — eased by the throttle, then eased
    // again by the rig's own lerp, so it swells rather than snaps
    fovKick() { return S.fovKick * throttle; },
    burning() { return burn; },
    throttle() { return throttle; },
    fuel() { return fuel; },
    fuelFrac() { return S.tank > 0 ? fuel / S.tank : 0; },
    // ran dry and has not recovered `relight` seconds yet — the HUD dims the bar
    dry() { return dry; },
    // is the motor available on the gear you are in? the HUD shows the fuel bar
    // on exactly this — the sled gets the same readout, because it is the same
    // tank
    worn() { return ctrl.mode === gear || !!riders[ctrl.mode]; },
    gear,
    tuning: S,
    state() {
      return {
        burning: burn, throttle, fuel, frac: S.tank > 0 ? fuel / S.tank : 0,
        tank: S.tank, accel: S.accel, cap: S.cap, dry,
        burned, ignitions, gear, worn: ctrl.mode === gear || !!riders[ctrl.mode],
        // which machine is spending the tank, if it is not the pack itself
        rider: riders[ctrl.mode] ? ctrl.mode : null,
        dir: { ...dir },
      };
    },
  };
}
