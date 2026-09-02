// The rocket pack. A VEHICLE, not an ability.
//
// It used to be a cross-gear ability — hold G on skis, on the bike, under the
// wing — and that was the problem: a 100 m/s motor available at every moment
// dissolves the thing you are wearing. So it is something you put on now, and
// while it is on your back you are a rocket and nothing else.
//
// To the player it is not even a separate gear: it is the second model in the
// GLIDER rack (`GLIDER_MODELS` in glider.js), sitting in the locker's glider tab
// next to Aang's wing. One equipment type, two ways to stay off the ground. It
// is a separate controller gear only because it is separate PHYSICS, and mixing
// a wing and a motor into one step function would have been the worse lie.
//
// The shape is the wing's, because the wing already solved the hard part:
// `footed` gears do not exist on the ground. Feet down, you are boots — same
// walk, same sprint, same jump, byte-identical. The gear only owns the frames
// where you are airborne.
//
// And in those frames it owns almost nothing, which is the whole design:
//
//   THRUSTING, boost.js owns the velocity (the controller's `setBoosting`
//   stands this model down). 35 m/s² along the look, soft 100 m/s, gravity
//   cancelled. That physics did not change and is not duplicated here.
//
//   NOT THRUSTING, you are a body in the air. Gravity, and a linear air drag
//   that costs you ~10% of your speed per second — a coasting rocket bleeds off
//   rather than sailing at 100 m/s until it finds a mountain. There is no wing,
//   no lift, no air control: the ONLY way to change where you are going is to
//   light the motor.
//
// That asymmetry is the skill. Arriving is your problem, and the answer is the
// retro-burn: point the nozzle at where you are going and burn it off, because
// touching down over `landSpeed` / `landVy`, or into anything steeper than
// `landSteep`, is the same wipeout a glider eats.

export const ROCKET_TUNING = {
  // ---- contract with the controller's ride path
  maxSpeed: 110,      // m/s — post-landing horizontal clamp; also what the camera
                      // normalises speed against, so the FOV opens across the
                      // whole 0→100 range instead of pinning at a third of it
  snapMul: 1.0,       // × (speed·dt) downhill snap — never reached: footed gears
                      // touch down exactly once
  landMin: 3.0,       // m/s — unused; judgeWipe owns the verdict

  // ---- coasting
  airDrag: 0.10,      // 1/s — 10 m/s² at 100 m/s, 1 m/s² at 10. A falling body,
                      // not a wing: it never turns you, it only bleeds you.
  leanRecover: 6.0,   // 1/s — drain any bank carried in from another gear

  // ---- touchdown, judged the way the wing's is but without a flare to save you
  landVy: 9.0,        // m/s — sinking faster than this on contact = wipe
  landSpeed: 16.0,    // m/s — horizontal faster than this on contact = wipe
  landSteep: 0.62,    // sinθ above which the surface is a wall, not a field
  landScrub: 0.45,    // fraction of horizontal speed kept on a clean touchdown
  landRun: 9.0,       // m/s — hardest you can be running when you stand up
};

// Lengths / speeds / accelerations scale with the scene's unit; rates (1/s),
// times and pure ratios do not.
export function scaleRocketTuning(u, over = {}) {
  const S = { ...ROCKET_TUNING, ...over };
  if (u === 1) return S;
  for (const k of ['maxSpeed', 'landVy', 'landSpeed', 'landRun', 'landMin']) S[k] *= u;
  return S;
}

// One pilot per page, so module state — the same trade ski.js and glider.js make.
const st = { airT: 0, lean: 0, v: 0, vy: 0 };

export function rocketReset() { st.airT = 0; st.lean = 0; st.v = 0; st.vy = 0; }

// Live snapshot for the HUD and the tests.
export function rocketState() {
  return { airTime: st.airT, speed: st.v, vy: st.vy, lean: st.lean };
}

// One step of coasting. Mutates ctx.vel. Note what is NOT here: no lift, no
// thrust, no air steering. boost.js does the thrusting, and while it does the
// controller never calls this at all.
//
// ctx: { vel, pos, yaw, pitch, keys, grounded, normal|null, gravity, dt, S, lean }
export function rocketStep(ctx) {
  const { vel, dt, S } = ctx;
  const yaw = ctx.yaw;                       // the look is aim, never a torque

  if (ctx.grounded) {
    // With `footed` set the controller runs the boots walk while your feet are
    // down and never calls us grounded; this is here so the model stays correct
    // if the flag is ever off.
    st.airT = 0;
    st.lean += (0 - st.lean) * Math.min(1, S.leanRecover * dt);
    st.v = Math.hypot(vel.x, vel.y, vel.z); st.vy = vel.y;
    return { yaw, lean: st.lean };
  }
  st.airT += dt;

  // Air resistance, straight against the velocity. Linear rather than quadratic
  // on purpose: a v² term tuned to matter at 100 m/s is invisible at 10, and
  // this is the only thing standing between "released the key" and "arrived at
  // a cliff still doing 100".
  const k = Math.max(0, 1 - S.airDrag * dt);
  vel.x *= k; vel.y *= k; vel.z *= k;

  st.v = Math.hypot(vel.x, vel.y, vel.z);
  st.vy = vel.y;
  st.lean += (0 - st.lean) * Math.min(1, S.leanRecover * dt);
  return { yaw, lean: st.lean };
}

// Contact with the ground. Same three questions the wing asks — how hard are you
// sinking, how fast are you going, and is this a field or a wall — with more
// room on the first two, because a rocket has no flare and its whole landing
// technique is the retro-burn.
export function rocketJudgeWipe(vel, impact, normal, S) {
  const spH = Math.hypot(vel.x, vel.z);
  const nh = normal ? Math.hypot(normal.x, normal.z) : 0;
  st.airT = 0;
  if (impact > S.landVy) return true;
  if (spH > S.landSpeed) return true;
  if (nh > S.landSteep && spH > S.landSpeed * 0.6) return true;
  return false;
}

// A clean touchdown: you are on your feet, so most of what is left goes away —
// but enough is kept that a well-flown arrival rolls out into a run.
export function rocketLand(vel, impact, normal, S) {
  st.airT = 0; st.lean = 0;
  const sp = Math.hypot(vel.x, vel.z);
  if (sp < 1e-4) return;
  let k = S.landScrub;
  if (sp * k > S.landRun) k = S.landRun / sp;
  vel.x *= k; vel.z *= k;
}

// ---------------------------------------------------------------- the pack
// A back-mounted pair of tanks on a harness plate, with two bells underneath.
// Built here rather than in main.js so the locker's mannequin and the live body
// are provably the same object — the preview clones the rig by name.
//
// Origin is the FEET, like every other body part in main.js, and -Z is forward.
// The bells sit at ~0.94 m, which is where boost.js puts the nozzle
// (`eyeHeight * 0.55`), so the plume comes out of the hardware and not out of a
// point near it.
export function makeRocketPack(THREE, u = 1) {
  const lamb = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  const shell = lamb(0xb9bec4, 0x4a4d52);     // brushed tank
  const trim = lamb(0xff4d00, 0x7a2500);      // the lab's orange
  const dark = lamb(0x1a191c, 0x0b0a0c);      // harness, bells
  const g = new THREE.Group();

  // the plate that straps to your back
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.30 * u, 0.42 * u, 0.09 * u), dark);
  plate.position.set(0, 1.12 * u, 0.17 * u);
  g.add(plate);

  for (const side of [-1, 1]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.078 * u, 0.078 * u, 0.44 * u, 10), shell);
    tank.position.set(side * 0.115 * u, 1.16 * u, 0.245 * u);
    // the orange band, so the pack reads as lab kit at chase distance
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.082 * u, 0.082 * u, 0.07 * u, 10), trim);
    band.position.copy(tank.position);
    band.position.y = 1.30 * u;
    // domed cap
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.078 * u, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    cap.position.set(tank.position.x, 1.38 * u, tank.position.z);
    // the bell — open cone, mouth down and a touch aft
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.038 * u, 0.075 * u, 0.16 * u, 10, 1, true), dark);
    bell.position.set(side * 0.115 * u, 0.94 * u, 0.255 * u);
    bell.rotation.x = 0.20;
    bell.material.side = THREE.DoubleSide;
    // shoulder strap
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.055 * u, 0.30 * u, 0.045 * u), dark);
    strap.position.set(side * 0.135 * u, 1.24 * u, 0.02 * u);
    strap.rotation.x = -0.16;
    g.add(tank, band, cap, bell, strap);
  }
  return g;
}

// First person you are wearing the thing, so there is no plume to look at — what
// you get is its light at the bottom of the frame, and just enough of the two
// bells under it to say where the light is coming from.
//
// "Just enough" is the whole tuning. The first pass put the bells fully in frame
// and they read as two black holes punched in the bottom of the screen: unlit
// geometry at 60 cm is a silhouette, not a machine. So they sit mostly BELOW the
// bottom edge — only the rims clear it — they are grey rather than black, and
// the glow does the actual talking. Mounted to the camera, like the fp skis and
// the fp wing.
export function makeRocketFP(THREE, u = 1) {
  const metal = new THREE.MeshLambertMaterial({ color: 0x6d7076, emissive: 0x33353a });
  const g = new THREE.Group();
  const glows = [];
  const tex = nozzleGlowTex(THREE);
  for (const side of [-1, 1]) {
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.024 * u, 0.044 * u, 0.10 * u, 10, 1, true), metal);
    bell.material.side = THREE.DoubleSide;
    bell.position.set(side * 0.235 * u, -0.505 * u, -0.66 * u);
    bell.rotation.x = 1.30;                    // mouth toward the bottom of frame
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34 * u, 0.34 * u),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
      }),
    );
    glow.position.set(side * 0.235 * u, -0.475 * u, -0.65 * u);
    glow.renderOrder = 95;
    glows.push(glow);
    g.add(bell, glow);
  }
  g.frustumCulled = false;
  return { group: g, glows };
}

function nozzleGlowTex(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0.00, 'rgba(255,236,190,0.95)');
  grad.addColorStop(0.35, 'rgba(255,138,40,0.55)');
  grad.addColorStop(1.00, 'rgba(255,60,0,0)');
  x.fillStyle = grad;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
