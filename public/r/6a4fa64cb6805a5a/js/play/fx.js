// Visual effects for the first-person player: snow spray + graphics polish.
//
// Self-contained — touches no other module. main.js wires it with:
//   import './fx.js'         (module attaches window.__playFX at load)
//   window.__playFX.init({ THREE, scene, camera, renderer, ctrl, hud })
//   window.__playFX.update(dt)          // once per frame, after ctrl.applyToCamera
//
// Everything feature-detects and no-ops when a piece is missing, so the same
// module rides along on contract worlds, glb worlds and page-takeover worlds
// (sand-harbor) without assumptions. All snow work only happens on skis; the
// speed lines ride any gear that goes fast (and read the glider's airspeed
// rather than its ground speed), and the glider also gets a ground-skim spray.
//
// The imports are read-only state snapshots — airspeed, the ground-effect
// fraction, the edge/stop/stivot machine and the pump payout are all physics
// facts this layer has no way to re-derive.
//
// Budget: one THREE.Points pool (4096 particles, CPU-integrated — ~0.1 ms),
// one 2D canvas overlay for the speed lines (~16 fill() calls, 24 while
// specs/0047's outfit ink has a streak alive — still zero draw calls
// on the mountain's renderer), one CanvasTexture, one DOM vignette.
// No post pass, no shadow maps, no per-particle raycasts.

import { gliderState } from './glider.js';
import { skiState, takeSkiBurst, bankState, skiAccent, getSkiModel, SKI_REF } from './ski.js';
// specs/0019 — the two clean-frame knobs. A leaf module: read every frame,
// never cached here, so a flip in the locker lands on the very next frame.
import { get as setting } from './settings.js';
// specs/0047 §1 — the WORN outfit's three colours, and nothing else about the
// outfit. Same read-only shape as `skiAccent`: three numbers, cached over
// there, handed back by reference, and this module cannot write one back.
// specs/0056 §2 — the snow uniform's one writer, and the rig lookup the shed
// props need (the poles' fp slice, and `rig.poles` for the draw range).
import { lookColours, lookPalette, PAL_MAX, riderSnow, rigOf } from './rider.js';

const POOL = 4096;          // particle pool size
const SPRAY_CONE = 35 * Math.PI / 180;   // half-angle of the spray() throw cone
const SPRAY_FRAME = 400;    // hard per-frame ceiling on spray(), so one hockey
                            // stop cannot eat the whole shared pool in a frame

const R = {
  ok: false,                // init succeeded
  THREE: null, scene: null, camera: null, renderer: null, ctrl: null, hud: null,
  u: 1,                     // scene unit scale (1 unit = 1/u metres)
  // particle pool
  pts: null, pGeo: null, pMat: null,
  px: null, py: null, pz: null, vx: null, vy: null, vz: null,
  life: null, ttl: null, sz: null, a0: null,
  aPos: null, aSize: null, aAlpha: null,
  cursor: 0, alive: 0,
  accWake: 0, accRoost: 0, accSpray: 0,   // fractional emission accumulators
  dt: 0.016,                // last frame's dt, so spray() can turn a rate into a count
  sprayLeft: SPRAY_FRAME,   // what is left of this frame's spray budget
  // frame-to-frame state
  prevGrounded: false, prevVy: 0,
  errors: 0,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// -------------------------------------------------- specs/0047 — the outfit
// HOW MUCH OF THE SUIT RIDES IN THE FIRE, in one table, because the answer to
// "why is the flame that colour" has to be one number a reader can move.
//
// THE READING STAYS "THE SKI'S FIRE". Every one of these is a fraction mixed
// INTO a colour that was already there — the ski accent, white, the ink field —
// and none of them is a replacement. A ski is still the thing that is burning;
// the outfit is what the burn has caught. That is why the biggest number here
// is 0.45 and not 1.0: at a half-and-half blend you can still name the ski.
//
//   aura  the flame ON THE SKIS, and the same blend under the coloured burst's
//         three alpha buckets: ski accent → the outfit's `accent`.
//   core  the WHITE-HOT CORE, white → the outfit's `glow`, and it is the
//         smallest useful number for a reason: 0.35 leaves the core 65 % white,
//         which is the floor at which fire still reads as fire rather than as a
//         coloured light. Do not raise it. It also only arrives past FLARE_AT
//         (it rides `flare`), so "the flames up moment" is when the outfit
//         catches — below that the core is byte-identical to what it was.
//   trail the fire trail at the heels, same blend as `aura` but weaker: forty-
//         five cross-sections stack end-on down the track (see TR_GAIN) and a
//         45 % blend there stacks into a wash of suit colour rather than a
//         trail of fire.
//   lines every Nth speed streak spawned is drawn in the outfit's `accent`
//         instead of white or slate — 1/3 of them, and 1/2 above the speedo's
//         "fires up" tier (SL.OUTFIT_FIRE_AT). A ratio, not a blend: a streak
//         is one flat ink at one bucket alpha, as it has always been.
//   comp  the CHARGE. The flame growing before the flare is tinted toward the
//         outfit's `primary`, so a red suit charges red and a black suit
//         charges dark, and it fades out as `flare` comes in — the build-up is
//         the suit, the flare is the fire.
//
// ---- specs/0047 §A (0047a), Greg 2026-09-05 — MOST OF THIS TABLE IS RETIRED.
// "remove the color mixing for the onscreen lightning aura — just use ski
// palette not outfit. BUT use all of the outfit palette for the speed lines."
// So `aura` / `trail` / `comp` no longer mix anything (auraDress resolves all
// four flame colours to `skiAccent(id)` flat), and `lines` no longer states a
// share, because the share is now ALL of them off a table of the suit's whole
// palette (`SLP_FILL`, `slPaletteInks`). They stay written down because the
// numbers are the record of what 0047 did and what §A took back; `core` is the
// one entry still read, and only to keep `flStyles`' white-hot core arithmetic
// in one place. Nothing here is live geometry any more.
const OUTFIT_TINT = { aura: 0.45, core: 0.35, trail: 0.35, lines: 1 / 3, comp: 0.25 };

const hexs = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

// channel blend of two 0xRRGGBB, `t` of `b` into `a`. Integer in, integer out —
// every consumer here wants a hex (a uniform setHex, an rgba() string), and
// going through a THREE.Color to get one would allocate.
function mixHex(a, b, t) {
  const s = 1 - t;
  const r = (((a >> 16) & 255) * s + ((b >> 16) & 255) * t) | 0;
  const g = (((a >> 8) & 255) * s + ((b >> 8) & 255) * t) | 0;
  const l = ((a & 255) * s + (b & 255) * t) | 0;
  return (r << 16) | (g << 8) | l;
}

// ------------------------------------------------------------------ sprite
function makeSprite(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.30, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(250,252,255,0.35)');
  grad.addColorStop(1.0, 'rgba(250,252,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // a few darker flecks so spray reads as chunks against white snow, not fog
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(150,165,190,0.28)';
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.arc(10 + Math.random() * 44, 10 + Math.random() * 44, 2.5 + Math.random() * 4, 0, 7);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------ graphics polish
function polish(THREE, scene, camera, renderer, hud) {
  // renderer: filmic tone mapping + sRGB out — only when the world has not
  // already chosen its own mapping (page worlds may have; ours sets None).
  try {
    if (renderer && THREE.ACESFilmicToneMapping !== undefined &&
        renderer.toneMapping === THREE.NoToneMapping) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      if ('outputColorSpace' in renderer && THREE.SRGBColorSpace &&
          renderer.outputColorSpace !== THREE.SRGBColorSpace) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
      // materials compiled before the switch need a recompile to pick it up
      scene.traverse((o) => {
        const m = o.material;
        if (!m) return;
        const arr = Array.isArray(m) ? m : [m];
        for (const mat of arr) mat.needsUpdate = true;
      });
    }
  } catch { R.errors++; }

  // fog for depth — only when the scene brought none
  try {
    if (scene && !scene.fog && THREE.Fog) {
      const far = (camera && camera.far) || 4000;
      let col = new THREE.Color(0xdde9f4);
      if (scene.background && scene.background.isColor) {
        col = scene.background.clone().lerp(new THREE.Color(0xffffff), 0.22);
      }
      scene.fog = new THREE.Fog(col, far * 0.30, far * 0.94);
    }
  } catch { R.errors++; }

  // lights: warm key + cool/warm hemi fill, only if the world has none of that
  try {
    if (scene) {
      let hasDir = false, hasFill = false;
      scene.traverse((o) => {
        if (o.isDirectionalLight) hasDir = true;
        if (o.isHemisphereLight || o.isAmbientLight) hasFill = true;
      });
      if (!hasFill && THREE.HemisphereLight) {
        const h = new THREE.HemisphereLight(0xcfe2ff, 0x9c8f78, 0.85);
        h.name = 'fx:hemi';
        scene.add(h);
      }
      if (!hasDir && THREE.DirectionalLight) {
        const d = new THREE.DirectionalLight(0xfff1dc, 1.55);
        d.name = 'fx:key';
        d.position.set(160, 300, 110);
        scene.add(d);
      }
    }
  } catch { R.errors++; }

  // vignette: DOM overlay — zero GPU cost, sits under the HUD (phud is z 20)
  try {
    if (!document.querySelector('.pfx-vignette')) {
      const v = document.createElement('div');
      v.className = 'pfx-vignette';
      v.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:15;' +
        'background:radial-gradient(ellipse at 50% 46%,rgba(0,0,0,0) 58%,rgba(6,10,20,0.30) 100%);';
      const anchor = hud && hud.root && hud.root.parentNode === document.body ? hud.root : null;
      if (anchor) document.body.insertBefore(v, anchor);
      else document.body.appendChild(v);
    }
  } catch { R.errors++; }
}

// ------------------------------------------------------------- particle pool
function buildPool(THREE, scene) {
  R.px = new Float32Array(POOL); R.py = new Float32Array(POOL); R.pz = new Float32Array(POOL);
  R.vx = new Float32Array(POOL); R.vy = new Float32Array(POOL); R.vz = new Float32Array(POOL);
  R.life = new Float32Array(POOL); R.ttl = new Float32Array(POOL); R.sz = new Float32Array(POOL);
  R.a0 = new Float32Array(POOL);
  R.aPos = new Float32Array(POOL * 3);
  R.aSize = new Float32Array(POOL);
  R.aAlpha = new Float32Array(POOL);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(R.aPos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(R.aSize, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(R.aAlpha, 1));
  if (THREE.DynamicDrawUsage !== undefined) {
    geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
    geo.attributes.aSize.setUsage(THREE.DynamicDrawUsage);
    geo.attributes.aAlpha.setUsage(THREE.DynamicDrawUsage);
  }

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: makeSprite(THREE) },
      uColor: { value: new THREE.Color(0.96, 0.98, 1.0) },
      uScale: { value: 600 },
    },
    vertexShader: `
      attribute float aSize; attribute float aAlpha;
      uniform float uScale;
      varying float vA;
      void main() {
        vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float d = max(0.15, -mv.z);
        gl_PointSize = clamp(aSize * uScale / d, 0.0, 160.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        if (a < 0.012) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });

  const pts = new THREE.Points(geo, mat);
  pts.name = 'fx:snow';
  pts.frustumCulled = false;
  pts.renderOrder = 90;
  scene.add(pts);
  R.pts = pts; R.pGeo = geo; R.pMat = mat;
}

function emit(x, y, z, vx, vy, vz, life, size, alpha) {
  const i = R.cursor;
  R.cursor = (i + 1) % POOL;
  R.px[i] = x; R.py[i] = y; R.pz[i] = z;
  R.vx[i] = vx; R.vy[i] = vy; R.vz[i] = vz;
  R.life[i] = life; R.ttl[i] = life;
  R.sz[i] = size;
  R.a0[i] = alpha;
}

// The public spawn hook (spec §2.4). `origin` is a world-space point, `dir` is
// the MEAN throw velocity in scene units per second — its direction sets where
// the snow goes, its magnitude sets how hard and therefore how big the chunks
// are. `rate` is particles per second: this is called once per frame, so the
// fractional remainder is carried in R.accSpray exactly the way the wake and
// roost emitters carry theirs. `size` is the base particle radius in METRES,
// scaled to scene units here. Safe before init(), and it never throws.
export function spray(origin, dir, rate, size) {
  try {
    if (!R.ok || !origin || !dir || !(rate > 0)) return;
    const u = R.u;
    const dx = dir.x || 0, dy = dir.y || 0, dz = dir.z || 0;
    const dm = Math.hypot(dx, dy, dz);
    if (!(dm > 1e-5)) return;
    R.accSpray += rate * R.dt;
    let n = R.accSpray | 0;
    R.accSpray -= n;
    if (n > R.sprayLeft) { n = R.sprayLeft; R.accSpray = 0; }
    if (n <= 0) return;
    R.sprayLeft -= n;
    // an orthonormal frame with the throw direction as its axis, so the cone is
    // sampled the same way whatever direction the caller handed in
    const ax = dx / dm, ay = dy / dm, az = dz / dm;
    const hx = Math.abs(ay) < 0.9 ? 0 : 1, hy = Math.abs(ay) < 0.9 ? 1 : 0;
    let t1x = hy * az, t1y = -hx * az, t1z = hx * ay - hy * ax;
    const t1m = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1m; t1y /= t1m; t1z /= t1m;
    const t2x = ay * t1z - az * t1y, t2y = az * t1x - ax * t1z, t2z = ax * t1y - ay * t1x;
    const cosC = Math.cos(SPRAY_CONE);
    const szK = (size || 0.12) * u * (0.7 + 0.5 * clamp(dm / (6 * u), 0, 1.6));
    while (n--) {
      // uniform over the spherical cap, not over the angle — an angle-uniform
      // cone piles everything on the axis and reads as a jet, not a plume
      const ct = 1 - Math.random() * (1 - cosC);
      const st = Math.sqrt(Math.max(0, 1 - ct * ct));
      const ph = Math.random() * Math.PI * 2;
      const cp = Math.cos(ph) * st, sp = Math.sin(ph) * st;
      const spd = dm * rand(0.6, 1.3);
      emit(
        origin.x + rand(-0.09, 0.09) * u, origin.y + rand(-0.04, 0.09) * u, origin.z + rand(-0.09, 0.09) * u,
        (ax * ct + t1x * cp + t2x * sp) * spd,
        (ay * ct + t1y * cp + t2y * sp) * spd,
        (az * ct + t1z * cp + t2z * sp) * spd,
        rand(0.5, 0.9), szK * rand(0.7, 1.3), rand(0.45, 0.95),
      );
    }
  } catch { R.errors++; }
}

// ============================================================ speed lines
// ANIME SPEED LINES (集中線 — "concentrated lines"). What was here before was a
// world-space THREE.LineSegments of 52 streaks arranged in a camera-space
// annulus: it switched on at 15 m/s, faded its ONE shared opacity up to a
// ceiling, and then sat there. Every streak was immortal, every streak was the
// same length and the same weight, and the ring they lived on was pinned to the
// centre of the frame no matter which way you were actually travelling. It read
// as a decal on the lens rather than as speed.
//
// This replaces it with a 2D canvas overlay, for the same reason the speedo is
// one: the effect is screen-space by definition, so paying WebGL for it buys
// nothing. It costs the mountain ZERO draw calls and the renderer knows nothing
// about it. The whole field is drawn in ~16 fill() calls a frame (below).
//
// WHAT MAKES IT LOOK ALIVE, in the order the eye notices:
//   1. NOTHING IS PERMANENT. Every line has a lifetime of 70-300 ms and then it
//      is gone; the field is continuously respawned at a rate that holds the
//      population near its target. That constant churn is the flicker that
//      separates an anime action frame from a lens overlay, and it is why the
//      pool is spawn/die rather than a fixed ring of streaks.
//   2. THE FOCUS LEADS. The lines converge on where you are GOING, not on the
//      middle of the screen — the velocity vector is projected into screen space
//      and the convergence point rides toward it (SL.FOCUS_LEAD), smoothed so it
//      swings rather than snaps. Look left while bombing a fall line and the
//      whole field rakes to the right, which is the read the frame should give.
//   3. LENGTH ANSWERS ACCELERATION. Lines stretch while you are gaining speed
//      (SL.ACCEL_STRETCH) and relax while you are scrubbing it. Steady 30 m/s
//      and a 30 m/s that is still climbing do not look the same.
//   4. AIR IS NOT GROUND. Off the snow the field goes CLEANER: fewer lines
//      (SL.AIR_CLEAN), longer and longer-lived (SL.AIR_LONG). On the ground it
//      is dense and busy. You can feel a landing in the field alone.
//   5. IT PUNCTUATES. Landing a drop, lighting the rocket and stomping a trick
//      each throw a burst — a spike in count, length and brightness that decays
//      over SL.BURST_TAU.
//
// THE STYLE IS INK, NOT BLUR. Each line is a tapered quad (a spike, near-zero
// at the inner end, SL.WIDTH at the outer) with butt ends and no gradient and no
// shadow — the crisp cut a brush or a screentone knife leaves. Rather more than
// half are white and the rest (SL.INK_FRAC) are a deep cool slate, because this
// is a MOUNTAIN: white lines on white snow are not subtle, they are invisible,
// and the ink ones are what carry the bottom of the frame the way black lines
// carry white paper. There is no motion blur anywhere in here.
//
// IT COSTS ALMOST NOTHING. Geometry is precomputed into one flat Float32Array
// per frame and the lines are then bucketed by alpha (8 levels x 2 inks, and
// x 3 since specs/0047 put the worn outfit's accent on every third streak), so
// the whole field goes down in at most 16 fill() calls — 24 with an outfit
// streak alive — with the fillStyle strings built once at module load (the
// outfit's eight are rebuilt when the LOOK changes, which is not a frame
// event). Per-line trig is done at SPAWN and cached, so the
// per-frame inner loop is pure arithmetic. Measured, not asserted: the last 240
// frames of step+draw are in a ring, and __speedlines.cost() reads out its p95.
//
// AND IT OBEYS THE SAME SILENCES EVERYTHING ELSE DOES: H (clean frame), pause,
// the locker, the gear menu, the boot cards and dev fly mode all take it off the
// screen — and because it is a <canvas> that draws no text it can never put a
// string in front of the build gate's banned-string lists.

const SL = {
  // ---- WHEN THEY EXIST. Aligned to the speedometer's tiers, which is the
  // escalation the player has already been taught by the corner of the screen.
  ON_AT: 8,            // m/s — below this there is nothing at all
  MAX_AT: 40,          // m/s — 'rocket'. Everything above 40 looks like 40, the
                       // same ceiling rule the gauge uses: unhinged needs a top.
  // The tiers in between are not thresholds, they are where the single linear
  // intensity t = (speed - ON_AT) / (MAX_AT - ON_AT) happens to land:
  //   15 m/s -> t 0.22  subtle streaks
  //   28 m/s -> t 0.63  committed anime lines
  //   40 m/s -> t 1.00  screen-edge rush
  ON_AT_AIR: 6,        // the glider hangs off airspeed and feels wind sooner
  ON_AT_BOOST: 6,      // under thrust the lines are the only cue you are moving

  // ---- HOW MANY
  MAX_LINES: 165,      // live lines at t = 1
  DENSITY_POW: 1.15,   // > 1 keeps the low tiers genuinely sparse

  // ---- HOW LONG THEY LAST (seconds). This is the flicker.
  LIFE_MIN: 0.07,
  LIFE_MAX: 0.30,

  // ---- GEOMETRY, in fractions of the screen's half-extent
  INNER_AT_ON: 0.66,   // inner ends start this far out at ON_AT (centre stays clear)
  INNER_AT_MAX: 0.22,  // ...and this far out at MAX_AT (they close in on you)
  LEN_MIN: 0.14,       // line length at ON_AT
  LEN_MAX: 0.72,       // ...at MAX_AT
  REACH: 1.34,         // how far past the corners radius 1.0 sits
  WIDTH: 5.0,          // outer-end width in CSS px at t = 1
  WIDTH_REF: 760,      // ...measured on a screen this small; phones scale down
  TAPER: 0.10,         // inner-end width as a fraction of the outer end
  DRIFT: 0.55,         // outward crawl over a life, as a multiple of own length

  // ---- BRIGHTNESS
  ALPHA_MIN: 0.16,     // a line's mean alpha at ON_AT
  ALPHA_MAX: 0.72,     // ...at MAX_AT
  INK_FRAC: 0.45,      // share drawn in slate rather than white, at t = 1
  INK_FLOOR: 0.35,     // ...as a fraction of INK_FRAC at ON_AT.
  // THE INK IS NOT A GARNISH, IT IS HALF THE EFFECT, and the first cut got that
  // wrong. This is a mountain: the bottom two thirds of almost every frame is
  // WHITE SNOW, and white lines on white snow are not subtle, they are absent —
  // the first pass looked right against the sky and disappeared below the
  // horizon. Manga solves this by drawing the lines in ink on white paper, so
  // roughly half of them here are a deep cool slate. Against the sky the white
  // ones carry the field; against the snow the ink ones do; wherever the frame
  // is mixed both are visible and the field reads as drawn rather than lit.

  // ---- ALIVENESS
  ACCEL_STRETCH: 0.55, // extra length at +8 m/s^2; negative accel shortens
  FOCUS_LEAD: 0.34,    // convergence point rides this far toward travel (of half-min)
  FOCUS_TAU: 0.18,     // seconds — focus smoothing, so it swings not snaps
  AIR_CLEAN: 0.62,     // line-count multiplier off the ground
  AIR_LONG: 1.35,      // ...and length multiplier
  AIR_LIFE: 1.50,      // ...and lifetime multiplier

  // ---- PUNCTUATION
  BURST_LAND: 0.90,    // landing, scaled by impact speed
  BURST_BOOST: 1.00,   // rocket ignition
  BURST_TRICK: 0.80,   // a landed trick
  BURST_TAU: 0.30,     // seconds — burst decay
  BURST_LINES: 90,     // extra lines at burst = 1

  // ---- THE 40 M/S RUSH: edges only, never the middle of the frame
  RUSH_FROM: 34,
  RUSH_ALPHA: 0.15,

  // ---- specs/0047 §2: THE THIRD INK IS THE OUTFIT. Where the share changes.
  // 28 m/s is the speedo's "fires up" tier (speedo.js T_FIRE) — the number the
  // corner of the screen has already taught the player as the moment the run
  // stops being fast and starts being on fire. Restated rather than imported:
  // this module reads physics and never a HUD, and one constant with the tier's
  // name on it is cheaper to keep in step than an import edge to a widget.
  OUTFIT_FIRE_AT: 28,
};

const SL_CAP = 240;            // pool ceiling (MAX_LINES + BURST_LINES + slack)
const SL_BUCKETS = 8;          // alpha quantisation levels per ink
const SL_INKS = 3;             // white, slate, and specs/0047's outfit accent
const SL_ALPHA_CEIL = 0.80;
const SL_DPR_CAP = 1.5;        // a full-screen overlay does not need 3x on a phone
const SL_SPAWN_FRAME = 48;     // hard per-frame spawn ceiling, for post-stall frames

// The 24 fill styles, built ONCE. Nothing in the loop concatenates a string.
// 0–7 white, 8–15 slate, 16–23 the outfit's accent (specs/0047 §2) — one table,
// indexed by `bucket + ink * SL_BUCKETS`, and the only entries that are ever
// rebuilt are the last eight, when the worn look changes.
const SL_FILL = [];
const slAlphaOf = (b) => ((b + 1) / SL_BUCKETS * SL_ALPHA_CEIL).toFixed(3);
for (let b = 0; b < SL_BUCKETS; b++) SL_FILL.push(`rgba(255,255,255,${slAlphaOf(b)})`);
for (let b = 0; b < SL_BUCKETS; b++) SL_FILL.push(`rgba(46,60,84,${slAlphaOf(b)})`);   // ink, not a grey — see INK_FRAC
for (let b = 0; b < SL_BUCKETS; b++) SL_FILL.push(`rgba(255,255,255,${slAlphaOf(b)})`);

// specs/0047 §2 — the outfit ink, AT THE STREAK'S EXISTING ALPHA. Only the ink
// changes: same buckets, same ceiling, same eight strings, rebuilt only when
// the worn look changes (auraDress) rather than per frame or per line.
//
// 0035 §1 deleted a third ink table (0033's orange impact bucket) and the note
// it left behind is the reason this one is not a second array: an alias nobody
// needs is a second thing to keep in step. `imDraw` walks `SL_BUCKETS * 2` and
// so still sees exactly the two inks the impact frame is entitled to.
function slOutfitInk(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  for (let i = 0; i < SL_BUCKETS; i++) SL_FILL[SL_BUCKETS * 2 + i] = `rgba(${r},${g},${b},${slAlphaOf(i)})`;
}

// ---- specs/0047 §A (0047a): THE FIELD'S OWN TABLE — THE WHOLE OUTFIT PALETTE
//
// Greg, 2026-09-05: "use all of the outfit palette for the speed lines (not jump
// speed lines but normal speed lines); rn we use one, but let's only use outfit
// palette and the whole outfit palette." So the ordinary ink field stops being
// white + slate + one borrowed accent and becomes the look itself: `PAL_MAX`
// inks, every colour `lookPalette()` found on the worn suit, one per streak.
//
// A SECOND TABLE, not a resized `SL_FILL`, and that is the whole reason it is
// here. `SL_FILL` has three tenants that 0047a does NOT change — `imDraw`'s two
// base inks (0033), its third slot when a jib pop asks for the outfit accent
// (0057 §7.3), and the `__speedlines.outfit` probe — and every one of them
// indexes it by the fixed `bucket + ink * SL_BUCKETS` arithmetic. Growing that
// array under them would silently repaint the wipeout frame. So the field gets
// `SLP_FILL` and leaves `SL_FILL` exactly as it found it: two arrays with two
// owners beats one array with four.
//
// Rebuilt only when the worn look changes — `lookPalette()` hands the same array
// back by reference, so slStep's check is an identity compare, the same shape
// `auraDress` uses on `lookColours()`.
const SLP_FILL = [];
let SL_PAL = null;        // the palette array itself, for the identity test
let SL_NP = 0;            // how many inks are in it (0 = fall back to SL_FILL)
function slPaletteInks(pal) {
  SL_PAL = pal;
  SL_NP = Math.min(pal.length, PAL_MAX);
  SLP_FILL.length = 0;
  for (let p = 0; p < SL_NP; p++) {
    const hex = pal[p], r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    for (let i = 0; i < SL_BUCKETS; i++) SLP_FILL.push(`rgba(${r},${g},${b},${slAlphaOf(i)})`);
  }
}

// ---- specs/0035 §1: THE THIRD INK IS GONE, and with it its whole table.
//
// 0033 built a separate 24-entry `IM_FILL` here (`SL_FILL.slice()` plus eight
// buckets of `rgba(255,120,40)`) so the impact frame could burn the ski flame's
// orange. That was a misread of the lookbook: the orange Greg asked for is the
// INVERSION of a blue-white mountain (§2), not ink on the spokes. So the table
// goes and `imDraw` indexes `SL_FILL` directly — the impact frame and the
// ordinary field are two inks each, the same two, at the same buckets and the
// same ceiling. Deleting the array rather than leaving it at `SL_FILL.slice()`
// is the point: an alias nobody needs is a second thing to keep in step.

// ---- specs/0054 §1b: ...AND A THIRD INK COMES BACK, RED THIS TIME.
//
// 0035 was right that the tint Greg was pointing at lived in the compositor and
// not on the spokes, and it stays there (§1a turns it red). This is the OTHER
// half of "it should always have some degree of red": a share of the burst's own
// lines carries the colour, so the frame is red for its whole 0.42 s and not
// only for the eight frames the flash is up.
//
// EIGHT strings, not twenty-four. 0033 built a full 24-entry `IM_FILL` copy so
// it could index one table; that made two tables to keep in step for the sake of
// one addition, and 0047 has since claimed `SL_FILL[16..23]` for the outfit
// accent — which this must not touch, and cannot, because it is a separate
// array. `imDraw` walks three ink slots and reaches for this one on the third.
//
// The red is `rgba(230,30,24)` and NOT the ski flame's `rgba(255,120,40)`: hue
// 2 deg against the flame's 25, and a third of its green. 0033 deliberately
// matched the flame "so the two read as one language"; 0054 §1 reverses that on
// purpose, because the flame is a reward for a landing and this is damage.
const IM_RED_RGB = '230,30,24';
const IM_RED = [];
for (let b = 0; b < SL_BUCKETS; b++) IM_RED.push(`rgba(${IM_RED_RGB},${slAlphaOf(b)})`);

const S = {
  cv: null, cx: null, w: 0, h: 0, dpr: 0, shown: false,
  // pool (struct-of-arrays; no per-line objects, so no GC churn at 650 spawns/s)
  ca: new Float32Array(SL_CAP), sa: new Float32Array(SL_CAP),   // cos/sin of the ray
  r0: new Float32Array(SL_CAP), ln: new Float32Array(SL_CAP),
  wd: new Float32Array(SL_CAP), a0: new Float32Array(SL_CAP),
  lf: new Float32Array(SL_CAP), tt: new Float32Array(SL_CAP),
  ik: new Uint8Array(SL_CAP),
  cursor: 0, live: 0, acc: 0,
  // per-frame draw geometry: 4 points x 2 coords, plus a bucket id (255 = skip)
  gx: new Float32Array(SL_CAP * 8), gb: new Uint8Array(SL_CAP),
  // specs/0047 §2 — the outfit ink's own two numbers. `spawnN` counts spawns so
  // "every third streak" is a COUNT and not a coin flip (a 1-in-3 random would
  // clump, and the field is sparse enough at the low tiers to show the clumps);
  // `inks` is how far slDraw walks the fill table this frame, 2 until an outfit
  // streak is actually live, so a run with no outfit line in it pays nothing.
  spawnN: 0, inks: 2, olive: 0,
  // specs/0047 §A (0047a) — the palette field's own three. `tbl` is the fill
  // table slDraw walks THIS frame (SLP_FILL once a look is dressed, SL_FILL on
  // the fallback path), and `pc` counts live streaks per palette ink so a gate
  // can assert "every colour of the suit is on screen" rather than eyeball it.
  tbl: SL_FILL, pc: new Uint16Array(PAL_MAX),
  // signals
  focusX: 0, focusY: 0, prevS: NaN, accel: 0,
  burst: 0, prevBoost: false, prevLanded: -1, trickPoll: 0,
  t: 0, rush: 0,
  // cached rush gradient — rebuilt only when the focus or the strength moves
  grad: null, gk: -1, gxq: 1e9, gyq: 1e9,
  // cost ring, so the budget claim is measured rather than asserted
  cost: new Float32Array(240), ci: 0, cn: 0,
};

function slBuild() {
  const cv = document.createElement('canvas');
  cv.className = 'pfx-lines';
  cv.setAttribute('aria-hidden', 'true');
  // Inline, because play.css opens with `body.play canvas { position: fixed;
  // left: 0; top: 0 }` at (0,1,2) — a bare class loses that cascade, and the
  // same specificity trap means the `hidden` ATTRIBUTE would lose to it too.
  // So visibility is an inline `display`, which nothing can outrank.
  cv.style.cssText =
    'position:fixed;left:0;top:0;width:100%;height:100%;' +
    'pointer-events:none;z-index:16;background:none;display:none;';
  // z 16 sits above the vignette (15) and below the instrument HUD (20): the
  // lines are weather on the world, not an overlay on somebody's panel.
  const anchor = R.hud && R.hud.root && R.hud.root.parentNode === document.body ? R.hud.root : null;
  if (anchor) document.body.insertBefore(cv, anchor);
  else document.body.appendChild(cv);
  S.cv = cv;
  S.cx = cv.getContext('2d', { alpha: true });
  slSize();
  addEventListener('resize', slSize, { passive: true });
}

function slSize() {
  if (!S.cv) return;
  const d = Math.min(window.devicePixelRatio || 1, SL_DPR_CAP);
  const w = window.innerWidth || 1280, h = window.innerHeight || 720;
  if (w === S.w && h === S.h && d === S.dpr) return;
  S.w = w; S.h = h; S.dpr = d;
  S.cv.width = Math.max(1, Math.round(w * d));
  S.cv.height = Math.max(1, Math.round(h * d));
  S.cx.setTransform(d, 0, 0, d, 0, 0);   // set on resize, never per frame
  S.grad = null; S.gk = -1;
}

// Every reason the field must not be on the screen, in one place — the shape
// speedo.js and idle.js already established. H is in here because clean-frame's
// structural rule is `> *:not(canvas)` and this element IS a canvas, so the
// stylesheet deliberately walks past it; the suppression has to be real.
//
// specs/0019 added `ignoreClean`, and only that: it takes H — and NOTHING else —
// out of the list for one read. Everything below the first line is unconditional
// and stays unconditional, which is what "every other suppression reason still
// applies" means in the spec. Callers that pass nothing get the original
// function, so the sparks (specs/0020) and every other reader are untouched.
function slSuppressed(paused, ignoreClean) {
  const b = document.body.classList;
  if (!ignoreClean && b.contains('clean-frame')) return true;   // H — the frame is being filmed
  if (b.contains('intro-up')) return true;
  if (b.contains('gd-intro-up')) return true;
  if (b.contains('is-dev')) return true;        // dev fly mode is not play
  if (paused) return true;
  const P = window.__player;
  if (P) {
    try { if (P.inventoryOpen()) return true; } catch { /* no locker */ }
    try { if (P.gearMenuOpen()) return true; } catch { /* no gear menu */ }
  }
  return false;
}

// specs/0019 — the two knobs mean the ink field can now be silent while the
// coloured burst on the SAME canvas is not, so "drop the field" had to become
// separable from "hide the canvas". This half is the drop: the state slHide()
// always left behind, without touching a canvas the other half may still be
// drawing into. `gb[i] = 255` is the "not in any alpha bucket" value slStep
// writes for a dead line, and it is what stops slDraw re-painting a frozen
// field that nothing is stepping any more.
function slDrop(force) {
  if (!force && !S.live && !S.rush && !S.burst) return;   // already dropped; do it once
  S.live = 0; S.acc = 0; S.burst = 0; S.rush = 0; S.t = 0;
  S.accel = 0; S.prevS = NaN;      // see slStep: no acceleration across a gap
  S.inks = 2; S.olive = 0;         // specs/0047 — no outfit line is live in a dropped field
  for (let i = 0; i < SL_CAP; i++) { S.lf[i] = 0; S.gb[i] = 255; }
}

function slHide() {
  if (S.shown) {
    S.shown = false;
    S.cv.style.display = 'none';
    // drop the field rather than freezing it: coming back from the pause panel
    // to a stale 200-line frame would flash a photograph of the moment you left
    slDrop(true);
    S.cx.clearRect(0, 0, S.w, S.h);
  }
}

// THE FOCUS-LEAD PROJECTION, in one place. A world DIRECTION becomes a
// screen-space offset from the centre of the frame, clamped to `lead` px. The
// arithmetic is the speed lines' original and is unchanged; it is a function
// because specs/0006 §2.2 asks the consumed burst to converge on the LAUNCH
// vector rather than the travel vector, which is the same projection aimed at a
// different direction, and two copies of it would be two copies to drift.
// `nx/ny/nz` must already be unit length. Writes into `out`.
function projectDir(nx, ny, nz, lead, out) {
  const cam = R.camera;
  out.x = 0; out.y = 0;
  if (!cam) return out;
  const m = cam.matrixWorld.elements;
  // camera basis: cols 0/1/2 are right/up/back, so forward is -col2
  const cr = m[0] * nx + m[1] * ny + m[2] * nz;
  const cu = m[4] * nx + m[5] * ny + m[6] * nz;
  const cf = -(m[8] * nx + m[9] * ny + m[10] * nz);
  if (cf > 0.15) {
    // a real perspective projection of the direction, then clamped
    const f = (S.h * 0.5) / Math.tan((cam.fov || 72) * Math.PI / 360);
    let tx = (cr / cf) * f, ty = -(cu / cf) * f;
    const d = Math.hypot(tx, ty);
    if (d > lead) { tx = tx / d * lead; ty = ty / d * lead; }
    out.x = tx; out.y = ty;
  } else {
    // pointing sideways or backwards relative to the look: the vanishing point
    // is off-screen, so peg the focus at the edge it went out of
    const d = Math.hypot(cr, cu) || 1;
    out.x = (cr / d) * lead; out.y = (-cu / d) * lead;
  }
  return out;
}

const _proj = { x: 0, y: 0 };

// The convergence point. `vx/vy/vz` is world velocity; the camera's own basis
// turns it into a screen direction, so the field answers where you are LOOKING
// as well as where you are going.
function slFocus(dt) {
  let tx = 0, ty = 0;
  const c = R.ctrl;
  if (R.camera && c && c.velocity) {
    const vx = c.velocity.x, vy = c.velocity.y, vz = c.velocity.z;
    const vm = Math.hypot(vx, vy, vz);
    if (vm > 1e-4) {
      projectDir(vx / vm, vy / vm, vz / vm, SL.FOCUS_LEAD * Math.min(S.w, S.h) * 0.5, _proj);
      tx = _proj.x; ty = _proj.y;
    }
  }
  const k = 1 - Math.exp(-dt / SL.FOCUS_TAU);
  S.focusX += (tx - S.focusX) * k;
  S.focusY += (ty - S.focusY) * k;
}

function slSpawn(inner, len, wide, alpha, life, inkP, every) {
  // rolling first-fit; the pool is sized so this practically never walks far
  let i = S.cursor, tries = SL_CAP;
  while (tries-- > 0 && S.lf[i] > 0) i = (i + 1) % SL_CAP;
  if (S.lf[i] > 0) return false;
  S.cursor = (i + 1) % SL_CAP;
  const a = Math.random() * Math.PI * 2;
  S.ca[i] = Math.cos(a); S.sa[i] = Math.sin(a);     // trig paid ONCE, at spawn
  S.r0[i] = inner * rand(0.92, 1.30);
  S.ln[i] = len * rand(0.45, 1.35);
  S.wd[i] = wide * rand(0.55, 1.55);
  S.a0[i] = alpha * rand(0.55, 1.25);
  const L = life * rand(0.72, 1.28);
  S.lf[i] = L; S.tt[i] = L;
  // ---- specs/0047 §A (0047a) — WHICH OF THE SUIT'S COLOURS THIS LINE IS.
  // Every streak takes one ink off `lookPalette()`, picked by a hash of the
  // spawn ordinal mixed with the pool slot and FROZEN here: a line keeps its
  // colour for its whole life, so the field crackles rather than shimmering.
  //
  // A hash and not `spawnN % np`, which is what 0047 used for its one-in-three:
  // a plain modulo over an ordinal is a fixed cycle, and with the spawn count
  // per frame settling near a multiple of the palette size the same colours land
  // in the same corners frame after frame and the field starts to band. Mixing
  // the slot in breaks that without costing anything — two imuls and an xor at
  // spawn, nothing per frame.
  //
  // `inkP` / `every` survive as the FALLBACK only: before a look is dressed
  // (SL_NP === 0) the field is 0047's white + slate + accent, unchanged, so a
  // frame captured before `auraDress` runs is byte-for-byte what it always was.
  //
  // AND IT IS AVALANCHED, which is not decoration. `S.cursor` advances one slot per
  // spawn and `spawnN` one count per spawn, so the two move in LOCKSTEP and every
  // low bit of a plain `(a ^ b)` mix is a constant. Measured: a four-ink suit
  // (g27 Ferrum, g28 Phantom) drew inks 0 and 2 and never 1 or 3 — half the suit
  // missing from a field that is supposed to BE the suit. The murmur3 finalizer
  // below carries the high bits down, and the census comes out even.
  if (SL_NP > 0) {
    let h = (Math.imul(++S.spawnN, 2654435761) ^ Math.imul(i + 1, 40503)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    S.ik[i] = SL_NP === 1 ? 0 : (h >>> 0) % SL_NP;
  } else {
    // specs/0047 §2 — every `every`th streak spawned is the outfit's; the others
    // are the two inks this field has always drawn, at the same INK_FRAC odds.
    S.ik[i] = (++S.spawnN % every === 0) ? 2 : (Math.random() < inkP ? 1 : 0);
  }
  return true;
}

// One step: age the field, spawn what the speed asks for, and lay the frame's
// geometry down into S.gx/S.gb. Draws nothing — slDraw does that.
function slStep(dt, sMs, inAir) {
  // ---- intensity, and the acceleration that stretches the lines
  const boosting = S.boosting;
  const onAt = boosting ? SL.ON_AT_BOOST : (inAir && R.ctrl && R.ctrl.mode === 'glider') ? SL.ON_AT_AIR : SL.ON_AT;
  const t = clamp((sMs - onAt) / (SL.MAX_AT - onAt), 0, 1);
  S.t = t;
  // NaN is the "just came back from a suppressed frame" sentinel: the speed
  // delta across a pause is not an acceleration and must not stretch anything.
  const raw = Number.isFinite(S.prevS) ? (sMs - S.prevS) / dt : 0;
  S.prevS = sMs;
  S.accel += (raw - S.accel) * (1 - Math.exp(-dt / 0.15));

  S.burst *= Math.exp(-dt / SL.BURST_TAU);
  if (S.burst < 0.004) S.burst = 0;
  // a burst is a punctuation mark on speed, not a substitute for it — landing a
  // two-foot drop at walking pace must not paint an action frame
  const burst = S.burst * clamp(sMs / SL.ON_AT, 0, 1);

  if (t <= 0 && burst === 0 && S.live === 0) { S.rush = 0; return false; }

  // specs/0047 §A (0047a) — the worn look's whole palette, re-read only when it
  // is a different look. `lookPalette()` caches per serialised look and hands
  // the array back BY REFERENCE, so this is one Map hit and one identity compare
  // per ACTIVE frame (never on the dormant path above), and the fill strings are
  // rebuilt at most once per dress. Done here rather than in `auraDress` on
  // purpose: the ink field has to be right on a gear with no skis and no aura.
  const pal = lookPalette();
  if (pal !== SL_PAL) slPaletteInks(pal);

  // ---- what the field should look like right now
  const dens = Math.pow(t, SL.DENSITY_POW);
  let want = SL.MAX_LINES * dens + SL.BURST_LINES * burst;
  if (inAir) want *= SL.AIR_CLEAN;
  // never ask for a full pool: slSpawn's first-fit scan is O(pool) only when
  // there is nothing free, and leaving headroom keeps it O(1) in practice
  if (want > SL_CAP * 0.85) want = SL_CAP * 0.85;

  const inner = (SL.INNER_AT_ON + (SL.INNER_AT_MAX - SL.INNER_AT_ON) * t) * (1 - 0.25 * burst);
  let len = SL.LEN_MIN + (SL.LEN_MAX - SL.LEN_MIN) * Math.pow(t, 0.85);
  len *= 1 + SL.ACCEL_STRETCH * clamp(S.accel / 8, -0.4, 1.6);
  len *= 1 + 0.45 * burst;
  if (inAir) len *= SL.AIR_LONG;
  const wide = SL.WIDTH * (0.55 + 0.45 * t) * clamp(Math.min(S.w, S.h) / SL.WIDTH_REF, 0.7, 1.4);
  const alpha = SL.ALPHA_MIN + (SL.ALPHA_MAX - SL.ALPHA_MIN) * Math.pow(t, 0.8) + 0.20 * burst;
  const life = ((SL.LIFE_MIN + SL.LIFE_MAX) * 0.5) * (inAir ? SL.AIR_LIFE : 1);
  const inkP = SL.INK_FRAC * (SL.INK_FLOOR + (1 - SL.INK_FLOOR) * t);
  // specs/0047 §2 — one in three streaks is the outfit's, one in two once the
  // speedo has fired up. Derived from the ratio rather than written twice, so
  // OUTFIT_TINT.lines stays the one place the share is stated.
  const every = sMs >= SL.OUTFIT_FIRE_AT ? 2 : Math.round(1 / OUTFIT_TINT.lines);

  // ---- spawn. Rate is population / mean lifetime, so the count settles on
  // `want` without anyone tracking it: lines leave on their own clock.
  if (want > 0.5) {
    S.acc += (want / life) * dt;
    let n = S.acc | 0;
    S.acc -= n;
    if (n > SL_SPAWN_FRAME) n = SL_SPAWN_FRAME;
    while (n-- > 0) {
      if (!slSpawn(inner, len, wide, alpha, life, inkP, every)) break;
    }
  }

  // ---- age + lay down geometry
  slFocus(dt);
  const fx = S.w * 0.5 + S.focusX, fy = S.h * 0.5 + S.focusY;
  const HX = S.w * 0.5 * SL.REACH, HY = S.h * 0.5 * SL.REACH;
  const step = SL_ALPHA_CEIL / SL_BUCKETS;
  let live = 0, outfit = 0;
  // 0047a — how far up the ink axis this frame actually reaches, and the
  // per-ink census. `hiInk` keeps slDraw's walk honest: a six-ink suit with
  // three streaks alive still pays three fill() calls, not forty-eight.
  let hiInk = 0;
  const pc = S.pc;
  if (SL_NP > 0) pc.fill(0);
  for (let i = 0; i < SL_CAP; i++) {
    let L = S.lf[i];
    if (L <= 0) { S.gb[i] = 255; continue; }
    L -= dt; S.lf[i] = L;
    if (L <= 0) { S.gb[i] = 255; continue; }
    live++;
    const ttl = S.tt[i];
    const frac = L / ttl;                       // 1 -> 0
    const age = ttl - L;
    // a hard pop in and a soft fall out: the field crackles rather than pulses
    const env = Math.min(1, age * 14) * Math.pow(frac, 0.6);
    const a = S.a0[i] * env;
    if (a < step * 0.5) { S.gb[i] = 255; continue; }
    let b = (a / step) | 0;
    if (b >= SL_BUCKETS) b = SL_BUCKETS - 1;
    const ink = S.ik[i];
    // 0047a — in palette mode EVERY live streak is the outfit's, so `olive`
    // keeps answering "how many of these are the suit's" and simply says all of
    // them; `pc` is the reading that got interesting.
    if (SL_NP > 0) { pc[ink]++; outfit++; if (ink >= hiInk) hiInk = ink + 1; }
    else if (ink === 2) outfit++;
    S.gb[i] = b + ink * SL_BUCKETS;

    const ln = S.ln[i];
    const rIn = S.r0[i] + ln * SL.DRIFT * (1 - frac);   // crawls outward as it dies
    const rOut = rIn + ln;
    const ca = S.ca[i], sa = S.sa[i];
    const ax = fx + ca * rIn * HX, ay = fy + sa * rIn * HY;
    const bx = fx + ca * rOut * HX, by = fy + sa * rOut * HY;
    let dx = bx - ax, dy = by - ay;
    const dm = Math.hypot(dx, dy) || 1;
    // the perpendicular, in PIXELS — an ellipse-space normal would put a visible
    // width difference between the horizontal and the vertical lines
    const nx = -dy / dm, ny = dx / dm;
    const wo = S.wd[i] * 0.5, wi = wo * SL.TAPER;
    const o = i * 8;
    S.gx[o]     = ax + nx * wi; S.gx[o + 1] = ay + ny * wi;
    S.gx[o + 2] = bx + nx * wo; S.gx[o + 3] = by + ny * wo;
    S.gx[o + 4] = bx - nx * wo; S.gx[o + 5] = by - ny * wo;
    S.gx[o + 6] = ax - nx * wi; S.gx[o + 7] = ay - ny * wi;
  }
  S.live = live;
  S.olive = outfit;
  // specs/0047 — the third ink is walked only when it has lines in it; 0047a
  // says the same thing with `hiInk` over a palette that can be eight deep.
  S.inks = SL_NP > 0 ? hiInk : (outfit ? SL_INKS : 2);
  S.tbl = SL_NP > 0 ? SLP_FILL : SL_FILL;
  S.rush = smooth(sMs, SL.RUSH_FROM, SL.MAX_AT + 2);
  return live > 0 || S.rush > 0.02;
}

function slDraw() {
  const g = S.cx;
  g.clearRect(0, 0, S.w, S.h);

  // the 40 m/s rush: one cached radial gradient hugging the edges, and never
  // anything in the middle of the frame — at 53 m/s in trees you need the trees
  if (S.rush > 0.02) {
    const fx = S.w * 0.5 + S.focusX, fy = S.h * 0.5 + S.focusY;
    const qk = Math.round(S.rush * 20), qx = Math.round(fx / 12), qy = Math.round(fy / 12);
    if (!S.grad || qk !== S.gk || qx !== S.gxq || qy !== S.gyq) {
      S.gk = qk; S.gxq = qx; S.gyq = qy;
      const rad = Math.hypot(S.w, S.h) * 0.62;
      const gr = g.createRadialGradient(fx, fy, rad * 0.42, fx, fy, rad);
      const a = SL.RUSH_ALPHA * S.rush;
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.72, `rgba(246,251,255,${(a * 0.45).toFixed(3)})`);
      gr.addColorStop(1, `rgba(255,255,255,${a.toFixed(3)})`);
      S.grad = gr;
    }
    g.fillStyle = S.grad;
    g.fillRect(0, 0, S.w, S.h);
  }

  // the field itself: one path and one fill per (alpha bucket x ink), so 120+
  // tapered spikes cost at most 24 fill() calls and zero string work — 16 of
  // them until specs/0047's outfit ink actually has a streak alive (`S.inks`),
  // which is what keeps a run with the field off byte-for-byte what it was
  const gx = S.gx, gb = S.gb;
  for (let b = 0; b < SL_BUCKETS * S.inks; b++) {
    let opened = false;
    for (let i = 0; i < SL_CAP; i++) {
      if (gb[i] !== b) continue;
      if (!opened) { g.beginPath(); opened = true; }
      const o = i * 8;
      g.moveTo(gx[o], gx[o + 1]);
      g.lineTo(gx[o + 2], gx[o + 3]);
      g.lineTo(gx[o + 4], gx[o + 5]);
      g.lineTo(gx[o + 6], gx[o + 7]);
      g.closePath();
    }
    // 0047a — `S.tbl` is `SLP_FILL` (the worn suit's whole palette) once a look
    // is dressed and `SL_FILL` before that; the walk and the indexing arithmetic
    // are the ones this loop has always used.
    if (opened) { g.fillStyle = S.tbl[b]; g.fill(); }
  }
}

// ---------------------------------------------------------- specs/0019
// The two knob-aware reads. `slSuppressed` is unchanged and still answers "is
// this silent, H included"; these two ask the same question with H made
// CONDITIONAL on the knob that owns that effect. One line each, deliberately:
// there is no second list of silences to drift out of step with the first.
//
// The keys are read every call rather than cached, which is the whole of "a knob
// flips live" — settings.js is a property lookup, not storage I/O.
const slHidden = (paused) => slSuppressed(paused, setting('cleanSpeedLines'));
const auHidden = (paused) => slSuppressed(paused, setting('cleanPumpTracks'));

// The whole overlay, once a frame. `sMs` is metres per second — the caller has
// already chosen between ground speed and the wing's airspeed.
function slUpdate(dt, sMs, inAir, paused) {
  A.lineMs = 0;
  if (!S.cv) return;
  // specs/0019 — the ink field and the coloured burst share this canvas but no
  // longer share their silence: in a clean frame each answers to its own knob,
  // because one is "anime lines" and the other is half of the aura. Everywhere
  // else the two reads are identical, so this is a no-op outside H.
  const inkOff = slHidden(paused);
  const fireOff = auHidden(paused);
  // specs/0015 — the impact frame is a THIRD tenant of this canvas, and the one
  // that can hold it open alone: §4's whole point is that a wipe bursts at a
  // speed the field correctly ignores. It answers its own suppression (inside
  // imStep) and keeps its own clock, so this is the entire seam.
  const imOn = imStep(dt, paused);
  if (inkOff && fireOff && !imOn) { slHide(); flReset(); return; }
  const t0 = performance.now();
  // a suppressed half is DROPPED, not frozen — same reason slHide() drops it:
  // a field nothing is stepping would otherwise be re-painted unchanged, every
  // frame, as a photograph of the moment the knob went off.
  let any = false;
  if (inkOff) slDrop(); else any = slStep(dt, sMs, inAir);
  // specs/0006's coloured burst shares this canvas and this frame. It is stepped
  // and timed SEPARATELY so neither budget can quietly be charged to the other,
  // and it can hold the overlay open on its own: a full-bank pop from a standing
  // start spends real power at a speed the ink field correctly ignores.
  let fany = false, flMs = 0;
  if (FX_AURA_ON) {
    if (fireOff) flReset();
    else {
      const q = performance.now();
      fany = flStep(dt);
      flMs = performance.now() - q;
    }
  }
  if (!any && !fany && !imOn) { slHide(); return; }
  if (!S.shown) { S.shown = true; S.cv.style.display = 'block'; }
  slDraw();
  const t1 = performance.now();
  if (fany) flDraw(S.cx);
  // ...and specs/0015 last, on top of both: for an eighth of a second the impact
  // frame is the loudest thing on the screen, and then it is gone.
  if (imOn) imDraw(S.cx);
  A.lineMs = flMs + (performance.now() - t1);
  S.cost[S.ci] = (t1 - t0) - flMs;
  S.ci = (S.ci + 1) % S.cost.length;
  if (S.cn < S.cost.length) S.cn++;
}

// the public punctuation hook — landings, ignitions and stomped tricks
function slBurst(amount) {
  const a = clamp(amount, 0, 1.4);
  if (a > S.burst) S.burst = a;
}

function costPct(p) {
  if (!S.cn) return 0;
  const a = Array.prototype.slice.call(S.cost.subarray(0, S.cn)).sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(4);
}

// ======================================================== JUMP-POWER AURA
// specs/0006. Greg, in full:
//
//   "it would be cool if they are more flame-like and the color of the ski that
//    is equipped and comes from a direction that screams 'jump power'. maybe
//    it's almost a glow around the skis (which flames up when enough) and then
//    when consumed for a big jump becomes ski-color fire speed lines to the
//    extent of the power used. I want it to go from the tips down so you can see
//    it in first person, and it goes all the way down the skis' back so it looks
//    great in third."
//
// TWO HALVES, ONE READING. Half one is a flame that lives ON THE SKIS and grows
// with the stored jump power; half two is what happens to it when that power is
// spent. Neither half invents a number: the fuel is the carve bank and the lip
// charge that ski.js has already banked (spec 0002), read through `bankState()`,
// which cannot write anything back. Nothing in here can change how far you jump.
//
// WHY IT STARTS AT THE TIPS. It is the only part of your own skis you can see in
// first person — the tails are behind the lens. So the flame FILLS tip → tail as
// the bank charges (at p ≈ 0.15 only the tips lick) and it DRAINS tail → tip
// when the bank is spent, which means both the fill and the empty are readable
// from inside the helmet. Third person then gets the whole length for free,
// because it is the same ribbon seen from further back.
//
// WHY IT IS PARENTED TO THE SKI MESHES. main.js already bobs, rolls, splays and
// tip-rises four ski rigs every frame, and fpRig/model already own the "which
// camera am I in" answer. Hanging one ribbon under each rig inherits all of it
// and can never disagree with it — there is no second pose to keep in sync, and
// no visibility rule to duplicate. main.js's whole contribution is one call
// handing over the four rig handles.
//
// WHY IT IS A SHADER AND NOT PARTICLES. A flame that wraps 1.8 m of ski at 40
// m/s is a few thousand particles; it is one draw call as a shell with noise on
// it. ONE geometry, ONE additive material, FOUR meshes (two of which are always
// on a hidden parent) — so at most 2 draw calls are ever submitted, and at p = 0
// the meshes are `visible = false`, which is why the idle frame is bit-identical
// to a build with FX_AURA_ON off.
//
// THE CONSUMED BURST IS AN EDGE, NEVER A LEVEL. `bankState().launch` hands back
// ski.js's takeoff record BY REFERENCE and skiLaunch builds a fresh one per
// takeoff, so "did we just leave the ground on stored power" is an object
// identity test. No drain is taken (takeSkiLaunch is the lab meter's one-shot
// and two readers of one drain is a bug), and a held state cannot pin the burst.
//
// THE BURST'S LINES SHARE THE ANIME CANVAS. Same <canvas>, same clear, same
// frame — the white/slate ink field above is untouched and keeps answering
// SPEED; these are a second, coloured ink set that answers POWER, drawn in at
// most 4 fill() calls (3 alpha buckets of ski-accent flame + 1 white-hot core).
// They are fatter, wavier and curled where the ink lines are crisp spikes,
// because one field is a screentone knife and the other is fire.
//
// SINCE specs/0047 §A (0047a) THE SKI ACCENT ARRIVES ALONE. 0047 blended the
// worn outfit into every colour below — the three buckets, the core, the ribbon,
// the trail — and §A takes all four blends back out: the flame is `skiAccent(id)`
// and the core is white-hot, which is what 0006 §2.1 asked for. The suit's colour
// did not go away, it moved: it is the SPEED-LINE FIELD now, whole palette
// (`slPaletteInks`). Still resolved once per (ski, look) in auraDress.

const FX_AURA_ON = true;        // the kill-switch (spec §3). false → nothing in
                                // this section builds, steps, draws or is added
                                // to the scene, and `window.__aura` goes inert.

const AU = {
  // ---- WHAT COUNTS AS POWER. `p` is max(bank, lip charge) — see bankState().
  ON_AT: 0.012,        // below this there is no aura at all and no meshes drawn
  REACH_POW: 0.85,     // p → lit fraction of the ski, from the tip back
  REACH_MAX: 1.14,     // ...at p = 1 the whole length plus a margin
  EDGE_SOFT: 0.20,     // how soft the flame front is, in ski lengths

  // ---- HOW BIG THE FLAME IS
  H_MIN: 0.34,         // flame height multiplier at p → 0
  H_MAX: 0.96,         // ...at p = 1, before the flare
  FLARE_AT: 0.68,      // p where it "flames up": taller, brighter, faster
  FLARE_H: 0.40,       // extra height at full flare
  GAIN: 1.30,          // additive brightness at p = 1
  NEAR0: 0.40,         // metres — the flame is invisible closer than this to the
  NEAR1: 1.35,         // lens and full strength beyond this. See the shader.
  LAG: 0.42,           // tailward lean of the flame tips at full speed (metres)
  SWAY: 0.030,         // lateral lick, metres
  WIND_AT: 26,         // m/s where the wind terms saturate

  // ---- THE TRAIL, third person only (spec §2.3, reshaped by spec 0010 §1b).
  // Metres.
  //
  // It is the rider's own TRACK, on fire. Greg, on the two cuts before this one:
  // "Not rocket cone, more-so leaving a fire trail behind me. Like the last X ft
  // of railroad tracks behind me have a flame. The flame already looks good,
  // it's just all over the place horizontally instead of fore-aft starting from
  // the player and projected behind."
  //
  // Both earlier shapes were a straight bar aimed along −v̂ and sized to fight
  // the foreshortening of a camera looking down that same bar: first a 3.4 m
  // wide, 2 m tall slab hung 55 cm over the boots, which from the chase camera
  // projects as a horizontal band ACROSS the rider at hip height (up-screen is
  // downhill, so a band at hip height reads as fire in FRONT of him); then a
  // cone, which is the same bar with a taper. The width was the bug in both.
  //
  // The fix is not another envelope. It is to stop extruding a shape and start
  // drawing WHERE HE HAS BEEN: a ring buffer of ski-tail anchors on the snow,
  // distance-spaced, TR_SEG stations covering the last TR_LEN metres of PATH.
  // In a carve it bends with the tracks, because it IS the tracks. Nothing is
  // wide — the ribbon is one ski stance across for its whole length — so there
  // is nothing left to read as horizontal, and the foreshortening that the
  // width was paying for is the shot rather than a problem: the chase camera
  // sits ~2.4 m above the rider looking down, so the track behind him projects
  // BELOW his boots, running away toward the bottom of the frame.
  TR_LEN: 8.00,        // metres of PATH alight at p = 1 and full speed ("the
                       // last X ft" — about 26). No camera cap: the near end is
                       // allowed to run under the lens and TR_NEAR0/1 handle it.
  TR_LEN0: 0.30,       // ...as a fraction of that, standing still: a lick at the
                       // heels rather than a banner, because a flame with no
                       // wind on it does not stream
  TR_MIN: 1.05,        // ...but never shorter than a lick at the heels
  TR_STEP: 0.18,       // metres between stations. DISTANCE-spaced, not time-
                       // spaced: a rider at 4 m/s and a rider at 30 m/s lay the
                       // same track, they just lay it at different rates, and a
                       // time-spaced buffer would bunch forty stations into one
                       // metre the moment he slowed down. 44 × 0.18 = 7.9 m.
  TR_JUMP: 3.00,       // ...and a gap bigger than this between two samples is
                       // not skiing, it is a respawn or a teleport. Clear the
                       // buffer rather than drawing a burning line across the
                       // mountain from wherever he used to be.

  // ---- HOW BIG. Constant width, the whole length: this is the correction.
  TR_HW: 0.24,         // half-width — one ski stance, and it does not open out
  TR_H0: 0.60,         // flame height at the rider's heels...
  TR_H1: 0.35,         // ...and at the oldest end, where it has burned down
  TR_UP: 0.10,         // anchor clearance above the SKI TAILS, along the CONTACT
                       // NORMAL rather than world up. The anchor's xz is the
                       // mean of the two third-person ski tails: a trail leaves
                       // the machine where the machine touches the ground, which
                       // on a skier is the back of the skis, not a point
                       // floating over his belt buckle.
  TR_RISE: 0.06,       // how far a station floats off the snow as it ages — hot
                       // gas rises, and that is the whole of it now. The 32° of
                       // sky-lean this number used to carry is what put the
                       // first cut above the chase camera's eye line.
  TR_WHIP: 1.25,       // extra rise while the pop drains it: the trail whips up
  TR_GAIN: 0.82,       // additive gain per surface. Lower than the ski flame's
                       // because forty-five cross-sections stack end-on down the
                       // track and the ski's gain clips the near stations to
                       // white, taking the ski's colour with them.
  TR_HOT: 0.12,        // fraction of the length that burns white-hot at the
                       // rider before it settles into the ski's accent
  TR_DIE: 0.30,        // ...and the oldest fraction, over which it dissolves to
                       // nothing rather than ending on a straight card edge
  TR_NEAR0: 0.35,      // metres — the trail is invisible closer than this to the
  TR_NEAR1: 1.00,      // lens and full past this. Its OWN pair, not the ski
                       // flame's (AU.NEAR0/NEAR1): the ski ribbon is frozen and
                       // its uniforms have to stay byte-identical.

  // ---- WHEN HE STOPS. The buffer is distance-spaced, so a stationary rider
  // stops laying stations and the track simply sits where it is. It must not
  // snap off: a fire on the snow burns down.
  TR_STOP: 0.60,       // m/s below which the rider counts as stopped
  TR_TAU_OUT: 0.60,    // seconds to burn out in place once he has
                       // (there is no TR_TAU any more — direction smoothing was
                       // a property of a bar aimed along a vector, and a path
                       // ribbon has no aim to smooth. The path IS the smoothing.)

  // ---- THE DRAIN. Spent power empties tail → tip, the reverse of the fill.
  DRAIN_T: 0.15,       // seconds (spec §2.2)

  // ---- THE CONSUMED BURST (the coloured lines)
  MIN_E: 0.02,         // a pop that spent less than this paints nothing
  BURST_TAU: 0.34,     // seconds — burst decay
  LINES: 60,           // live flame lines at e = 1
  LIFE_MIN: 0.11, LIFE_MAX: 0.46,
  INNER: 0.26,         // inner ends start this far out (fraction of half-extent)
  LEN_MIN: 0.22,       // line length at e → 0
  LEN_MAX: 0.92,       // ...at e = 1
  REACH: 1.36,         // how far past the corners radius 1.0 sits
  WIDTH: 13.0,         // outer-end width in CSS px at e = 1
  WIDTH_REF: 760,      // ...measured on a screen this small
  DRIFT: 0.62,         // outward crawl over a life, as a multiple of own length
  CURL: 0.16,          // lateral wave, as a fraction of the line's own length
  ALPHA: 0.66,         // a line's mean alpha at e = 1
  CORE_W: 0.34,        // the white-hot inner edge, as a fraction of the width
  CORE_A: 0.30,        // ...and its alpha
  DOWN: 0.12,          // the burst emanates from this far BELOW the convergence
                       // point, because that is where the skis are (spec §2.2)
  FOCUS_BACK: 0.55,    // seconds — the burst focus falls back to the travel focus
};

// ---- geometry of the ribbon, in TWO parts, and both are needed.
//
// SHEETS run the LENGTH of the ski and are the GLOW — Greg's "almost a glow
// around the skis". The profile is a zigzag swept tip -> tail: base points sit
// on the deck (h = 0) and tip points stand a few centimetres off it (h = 1), so
// the six strips between them wrap the ski in a low flickering skirt. They are
// deliberately SHORT. The first cut made them the whole effect, 30 cm tall, and
// it read as a coloured fog: both cameras in this game look down the ski from
// behind — first person over the tips, third person over the tails — and from
// there a lengthwise sheet is edge-on, so every tongue drawn inside it projects
// into the same long streak as its neighbours.
//
// RIBS stand ACROSS it and are the FLAME. Thirty short sheets square to that
// view, each with its own ragged top edge, so what the player actually sees is
// thirty tongues stacked down the ski rather than one smear. This is the
// crossed-billboard trick every fire effect ends up at, and the reason it is
// worth two geometries instead of one is that the sheets still carry the effect
// side-on — mid-carve, and in the locker preview — where the ribs go edge-on.
//
// Coordinates are METRES in ski-rig space (x across, y up, z tip → tail); `s` is
// a per-point seed that decorrelates the flicker between neighbouring sheets.
const AU_PROFILE = [
  // x       y      h  seed
  [-0.070, 0.016, 0, 0.13],
  [-0.150, 0.300, 1, 0.61],
  [ 0.000, 0.026, 0, 0.29],
  [ 0.150, 0.300, 1, 0.83],
  [ 0.070, 0.016, 0, 0.19],
];
const AU_SEG = 72;               // stations down the length — enough that the
                                 // vertex-shader lick above does not alias
const AU_Z0 = -1.20, AU_Z1 = 0.64;   // tip and tail of the reference ski, metres
const AU_RIBS = 26;              // cross flames down the length
const AU_RIB_X = [-0.100, -0.050, 0.000, 0.050, 0.100];    // columns across a rib
const AU_RIB_S = [0.07, 0.37, 0.91, 0.53, 0.23];           // ...and their seeds

// ---- THE TRAIL (spec §2.3, Greg 2026-09-01: "in third person, can the aura
// look like it's emanating from the back of my character, like a fire trail
// almost"). Same power, second presentation, and it exists because the two
// cameras want opposite things. In first person the skis are a metre from the
// lens and the flame ON them is the whole picture. In third the same skis are
// 45 px of ski six metres away, and a 40 cm flame on them is four pixels — so
// what third person gets is the fire STREAMING OFF the rider, which is big,
// which is legible at chase distance, and which is what a trail of fire behind
// somebody actually looks like. One presentation is live at a time, chosen off
// the camera mode main.js hands over with the ski rigs.
//
// The cross-section is normalised (x = ±1, y = 0..1) and swept along the
// rider's PATH — not along an axis. Every station carries its own world-space
// frame (centre, side, up) as three vertex attributes rewritten each frame, so
// the ribbon bends through a carve exactly the way the ski tracks under it do.
// The mesh itself lives at the world origin with an identity rotation; there is
// no model matrix to aim, because there is no single direction to aim it in.
// Two WINGS make the flat body — the chase camera looks down on the rider, so
// that is the face it sees — and one FIN stands up through them for the side-on
// view a hard carve swings the camera into.
const TR_PROFILE = [
  // x     y     h  seed
  [-1.00, 0.30, 1, 0.21],
  [ 0.00, 0.00, 0, 0.44],
  [ 1.00, 0.30, 1, 0.33],
  [ 0.00, 0.02, 0, 0.58],
  [ 0.00, 1.00, 1, 0.77],
];
const TR_LINK = [[0, 1], [1, 2], [3, 4]];    // which profile pairs are strips
const TR_SEG = 44;                            // segments of path...
const TR_NST = TR_SEG + 1;                    // ...so this many stations, and
                                              // TR_SEG × TR_STEP = 7.9 m of it

// ---- AND RIBS ACROSS IT, for exactly the reason the ski ribbon has them, only
// more so. Every strip above runs ALONG the trail, and the trail runs along the
// track — which is the line the chase camera is looking straight down. From
// there the wings are horizontal planes seen edge-on and the fin is a vertical
// plane seen edge-on, so the entire plume projects into a bright thread lying on
// the snow. That is not a subtle loss: it is the whole effect, and it is what
// made the first cut of the backward trail read as a smear at the rider's heels.
//
// ONE CROSS-SECTION PER STATION, square to the LOCAL PATH TANGENT — which is
// the part that matters now the ribbon bends: through a carve each rib turns
// with its own bit of track rather than all forty-five facing the same way.
// Each is a flame-shaped slice of the ribbon's envelope (arched, so the middle
// stands taller than the edges) with its own seed, so what a player behind the
// rider sees is a stack of glowing sleepers receding up his own track. Same
// geometry, same material, same draw call.
const TR_RIBS = TR_NST;
const TR_RIB_X = [-1.00, -0.55, 0.00, 0.55, 1.00];
const TR_RIB_S = [0.09, 0.41, 0.87, 0.57, 0.29];

const FL_CAP = 96;               // flame-line pool ceiling
const FL_ST = 5;                 // stations along one flame line
const FL_BUCKETS = 3;            // alpha levels — 3 body fills + 1 core = 4
const FL_ALPHA_CEIL = 0.86;

const A = {
  ok: false, built: false,
  rigs: null, skiId: null, camMode: null,   // handed over by main.js (one hook)
  geo: null, mat: null, meshes: [],
  trail: null, trailMat: null, tdx: 0, tdy: 0, tdz: 1,
  tpMeshes: [],                  // the third-person skis, for the tail anchor
  // ---- THE PATH RING (spec 0010 §1b). Newest sample first: `trkN` entries
  // live, `trk[0..2]` is station 0 = the rider's heels, and a station is only
  // ever pushed once he has moved TR_STEP since the last one. Positions and
  // contact normals are stored raw in world metres; everything the shader needs
  // (centre / side / up per station) is derived from them each frame.
  trk: new Float32Array(TR_NST * 3), trkN: new Float32Array(TR_NST * 3),
  trkCount: 0, trkLive: 0, trkUse: 0, trkIdx: null, trkV: null,
  // ...and the per-station frame the ring is turned into each frame, kept here
  // rather than allocated in trailPath() — this runs every frame of every ride
  frCtr: new Float32Array(TR_NST * 3),
  frSide: new Float32Array(TR_NST * 3),
  frUp: new Float32Array(TR_NST * 3),
  id: null, colour: 0xfff0e0,
  // specs/0047 §2 — the ski accent with the outfit already mixed in, resolved
  // once per (ski, look) in auraDress rather than per frame. `oc` is the object
  // `lookColours()` handed back, kept for the identity test that says the worn
  // look changed. `tint` is the flame at full flare and `tintComp` is the same
  // flame while it is still charging; auraStep walks between them on `flare`.
  oc: null, tint: 0xfff0e0, tintComp: 0xfff0e0,
  tintTrail: 0xfff0e0, tintTrailComp: 0xfff0e0, glow: 0xffffff,
  bodyNow: 0xfff0e0, coreNow: 0xffffff, trailNow: 0xfff0e0,   // ...and what went to the uniforms this frame
  p: 0, e: 0, drain: 0, drainT: 0, hold: 0, time: 0,
  forced: null,                  // test-only p override (__aura.force)
  lastLaunch: undefined,         // the takeoff EDGE token — see bankState()
  shown: false,
  // ---- the coloured burst's own pool (struct-of-arrays, same reason as SL's)
  burst: 0,
  ca: new Float32Array(FL_CAP), sa: new Float32Array(FL_CAP),
  r0: new Float32Array(FL_CAP), ln: new Float32Array(FL_CAP),
  wd: new Float32Array(FL_CAP), a0: new Float32Array(FL_CAP),
  ph: new Float32Array(FL_CAP),
  lf: new Float32Array(FL_CAP), tt: new Float32Array(FL_CAP),
  cursor: 0, live: 0, acc: 0,
  gx: new Float32Array(FL_CAP * FL_ST * 4),   // body polygon, 2 sides x FL_ST pts
  cx: new Float32Array(FL_CAP * FL_ST * 4),   // the white-hot core polygon
  gb: new Uint8Array(FL_CAP),
  fx: 0, fy: 0,                  // the burst's own convergence point
  // cost ring, so the budget claim is measured rather than asserted
  stepMs: 0, lineMs: 0,
  cost: new Float32Array(240), ci: 0, cn: 0,
};

// the ski-accent fill strings, rebuilt ONLY when the equipped ski changes
const FL_FILL = ['rgba(255,120,40,0.2)', 'rgba(255,120,40,0.5)', 'rgba(255,120,40,0.8)'];
let FL_CORE = 'rgba(255,246,232,0.30)';

// `hex` arrives from auraDress with specs/0047's outfit blend already in it —
// the three body buckets are one ink by construction, so §2's "the outer bucket
// blends ski-accent → outfit accent" is the flame BODY as against the white-hot
// core, and all three buckets take it at the one ratio they have always shared.
// `core` is the core's own colour (white → the outfit's `glow`, §2's 35 %).
function flStyles(hex, core) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  // lift the ink toward heat: the topsheet colour straight off the rack reads as
  // paint on the canvas, and these are meant to read as fire coming off a ski
  const lr = Math.round(r + (255 - r) * 0.22);
  const lg = Math.round(g + (255 - g) * 0.16);
  const lb = Math.round(b + (255 - b) * 0.08);
  for (let i = 0; i < FL_BUCKETS; i++) {
    const a = ((i + 1) / FL_BUCKETS) * FL_ALPHA_CEIL;
    FL_FILL[i] = `rgba(${lr},${lg},${lb},${a.toFixed(3)})`;
  }
  const c = mixHex(0xfff7ec, core, OUTFIT_TINT.core);
  FL_CORE = `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${AU.CORE_A.toFixed(3)})`;
}

// ------------------------------------------------------------- the ribbon
function auraBuild() {
  const THREE = R.THREE;
  const u = R.u;
  const P = AU_PROFILE, NP = P.length, NS = AU_SEG + 1;
  const NC = AU_RIB_X.length;
  const n = NP * NS + AU_RIBS * NC * 2;
  const pos = new Float32Array(n * 3);
  const aT = new Float32Array(n), aH = new Float32Array(n), aS = new Float32Array(n);
  const idx = [];
  // ---- the length sheets
  for (let j = 0; j < NS; j++) {
    const t = j / AU_SEG;                       // 0 at the TIP, 1 at the tail
    const z = (AU_Z0 + (AU_Z1 - AU_Z0) * t) * u;
    for (let i = 0; i < NP; i++) {
      const k = j * NP + i, o = k * 3;
      pos[o] = P[i][0] * u; pos[o + 1] = P[i][1] * u; pos[o + 2] = z;
      aT[k] = t; aH[k] = P[i][2]; aS[k] = P[i][3];
    }
  }
  for (let j = 0; j < AU_SEG; j++) {
    for (let i = 0; i < NP - 1; i++) {
      const a0 = j * NP + i, b0 = a0 + 1, a1 = a0 + NP, b1 = b0 + NP;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // ---- the cross ribs: one row on the deck, one row at the flame top, with the
  // top row arched so a rib is a flame and not a fence panel
  let k = NP * NS;
  for (let r = 0; r < AU_RIBS; r++) {
    const t = (r + 0.5) / AU_RIBS;
    const z = (AU_Z0 + (AU_Z1 - AU_Z0) * t) * u;
    const base = k;
    for (let i = 0; i < NC; i++) {
      const x = AU_RIB_X[i];
      const w = Math.abs(x) / AU_RIB_X[NC - 1];
      const top = 0.230 * (1 - 0.50 * w * w);
      let o = k * 3;
      pos[o] = x * u; pos[o + 1] = 0.016 * u; pos[o + 2] = z;
      aT[k] = t; aH[k] = 0; aS[k] = AU_RIB_S[i]; k++;
      o = k * 3;
      pos[o] = x * 0.70 * u; pos[o + 1] = top * u; pos[o + 2] = z;
      aT[k] = t; aH[k] = 1; aS[k] = AU_RIB_S[i] + 0.11; k++;
    }
    for (let i = 0; i < NC - 1; i++) {
      const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  geo.setIndex(idx);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(1, 0.42, 0.06) },
      uCore: { value: new THREE.Color(1, 1, 1) },   // specs/0047 §2 — the white-hot core's own colour
      uP: { value: 0 }, uBack: { value: 0 }, uFlare: { value: 0 },
      uWind: { value: 0 }, uTime: { value: 0 },
      uH: { value: AU.H_MIN }, uGain: { value: AU.GAIN },
      uLag: { value: AU.LAG * R.u }, uSway: { value: AU.SWAY * R.u },
      uNear0: { value: AU.NEAR0 * R.u }, uNear1: { value: AU.NEAR1 * R.u },
    },
    vertexShader: `
      attribute float aT; attribute float aH; attribute float aS;
      uniform float uP, uBack, uFlare, uWind, uTime, uH, uLag, uSway;
      varying float vT, vH, vS, vMask, vD;
      void main() {
        vT = aT; vH = aH; vS = aS;
        // THE LENGTH MASK. Lit from the tip (aT = 0) back to uBack — that is the
        // whole "from the tips down" read, and during the drain uBack retreats
        // toward the tip instead of the flame just dimming out where it stood.
        vMask = 1.0 - smoothstep(uBack - ${AU.EDGE_SOFT.toFixed(3)}, uBack + 0.02, aT);
        // THE RAGGED EDGE, and it is load-bearing. In first person you are
        // looking almost straight down the skis, so these sheets are edge-on and
        // the only thing of them you can see is their OUTLINE — shading tongues
        // inside a sheet whose top edge is a straight line reads as a smear of
        // light, which is what the first cut of this did. Cutting the outline
        // itself into licks, here, is what makes it read as fire from inside the
        // helmet. Three sines rather than a noise texture: it is per-vertex, it
        // costs nothing, and a periodic edge is invisible on a shape this busy.
        float w = sin(aT * 10.0 + uTime * 3.4 + aS * 2.1) * 0.54
                + sin(aT * 23.0 + uTime * 6.2 + aS * 6.3) * 0.30
                + sin(aT * 41.0 - uTime * 9.1 + aS * 11.7) * 0.16;
        float lick = 0.14 + 1.10 * clamp(w * 0.72 + 0.46, 0.0, 1.0);
        vec3 p = position;
        // the flame tips (aH = 1) collapse onto the deck where there is no power
        // and where the mask has not reached; the base points never move
        float grow = (uH + ${AU.FLARE_H.toFixed(3)} * uFlare) * vMask * lick;
        p.x *= mix(1.0, grow, aH);
        p.y *= mix(1.0, grow, aH);
        // ...and lean tailward in the wind, the way a flame does on a moving
        // thing, with a small lateral lick on top so it is never a static shape
        p.z += aH * uWind * uLag;
        p.x += aH * uSway * sin(uTime * 7.3 + aT * 9.1 + aS * 6.2);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor, uCore;
      uniform float uP, uFlare, uWind, uTime, uGain, uNear0, uNear1;
      varying float vT, vH, vS, vMask, vD;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.11))) * 43758.5453123); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
                   mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        if (vMask <= 0.002) discard;
        // three octaves scrolling TOWARD THE TIP and faster with speed: the
        // flame is being blown off the ski, not painted on it
        float sc = uTime * (1.0 + 2.6 * uWind) * (1.0 + 0.6 * uFlare);
        float n = vn(vec2(vT *  6.0 - sc * 1.2, vS *  3.1 + uTime * 0.9)) * 0.58
                + vn(vec2(vT * 15.0 - sc * 2.6, vS *  7.3 - uTime * 1.6)) * 0.28
                + vn(vec2(vT * 34.0 - sc * 5.0, vS * 13.7 + uTime * 2.4)) * 0.14;
        // Averaging octaves pulls a noise field toward its mean, and a flame
        // whose tongues are all the same height is a tube with a texture on it.
        // This stretches the field back out around the middle, so some tongues
        // reach the top of the sheet and their neighbours barely leave the deck.
        n = clamp((n - 0.5) * 2.1 + 0.5, 0.0, 1.0);
        // HOW TALL THIS PARTICULAR TONGUE IS, and where up it we are. Reading
        // the colour off q rather than off the raw sheet height is the whole
        // difference between fire and a gradient: every tongue gets a dark
        // root, a core in the ski's own colour and a white-hot tip, however
        // long or short it happens to be this frame.
        float top = (0.16 + 1.15 * n) * (0.66 + 0.42 * uFlare);
        if (vH >= top) discard;
        float q = vH / top;
        // dense at the root, gone at the tip, and thinning as the tongue gets
        // long — a tall lick is a wisp, a short one is the body of the fire
        // DO NOT PAINT THE LENS. The first-person skis hang off the camera and
        // their tails end within a couple of centimetres of it, so a third of a
        // metre of flame down there covers the whole bottom of the frame as an
        // undifferentiated wash — which is what killed the first two cuts of
        // this shader. Fading the near half metre out costs nothing anywhere
        // else (in third person the whole ski is five metres away) and it is
        // also simply true: you cannot see a flame you are standing inside.
        float a = pow(1.0 - q, 2.0) * (0.42 + 0.58 * (1.0 - top))
                * vMask * (0.22 + 0.78 * uP) * smoothstep(uNear0, uNear1, vD);
        // The white-hot tip is a garnish, not the colour. Additive over a white
        // mountain already eats most of the saturation there is — spend any more
        // on white and every ski in the rack burns the same pale blue-white.
        // specs/0047 §2: the white in that garnish is uCore — white until the
        // flame is past FLARE_AT and then 35 % of the way to the outfit's glow,
        // so the "flames up" moment is when the suit's own light catches. It is
        // driven from JS on the flare ramp, which is why below the flare this
        // line is bit-for-bit the vec3(1.0) it has always been.
        vec3 col = mix(uColor * 0.40, uColor, smoothstep(0.0, 0.30, q));
        col = mix(col, mix(uColor, uCore, 0.50), smoothstep(0.55, 1.0, q));
        gl_FragColor = vec4(col * (uGain * (0.62 + 0.55 * uFlare)), clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  A.geo = geo; A.mat = mat;
  for (let i = 0; i < A.rigs.length; i++) {
    const rig = A.rigs[i];
    if (!rig) continue;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'fx:aura';
    m.renderOrder = 92;              // after the snow pool (90), before the HUD
    m.frustumCulled = false;         // the vertex shader moves points; the two on
    m.visible = false;               // a hidden parent cost nothing either way
    rig.add(m);
    A.meshes.push(m);
    // main.js hands over [fpSkiL, fpSkiR, mSkiL, mSkiR] — the last two are the
    // ones on the third-person body, and their TAILS are where the trail leaves
    // the machine. Reading the ribbon mesh rather than the rig means the
    // per-ski length scale (auraDress sets scale.z) is already in the matrix.
    if (i >= 2) A.tpMeshes.push(m);
  }
  if (!A.tpMeshes.length) A.tpMeshes = A.meshes.slice();
  A.built = A.meshes.length > 0;
  if (A.built) trailBuild();
}

// ---------------------------------------------------------------- the trail
// One mesh, WORLD SPACE, at the origin with an identity rotation, and it is not
// parented to anything and never aimed. The rider's rig turns with the LOOK, a
// straight trail would have to be aimed along −v̂, and neither is where he has
// actually BEEN — which through a carve is a curve. So the vertices carry the
// path instead of the matrix carrying a direction.
//
// The STATIC half of the buffer, built once: which profile point a vertex is
// (`position.xy`, normalised — x = ±1 across, y = 0..1 up), which STATION it
// belongs to (`aI`, an integer 0 at the rider), and its flicker seed. The
// per-frame half — the station's world centre, its side vector and its up
// vector, all three already scaled into metres — is written by trailPath()
// into aCtr/aSide/aUp below.
function trailBuild() {
  const THREE = R.THREE, u = R.u;
  const P = TR_PROFILE, NP = P.length, NS = TR_NST;
  const NC = TR_RIB_X.length;
  const n = NP * NS + TR_RIBS * NC * 2;
  const pos = new Float32Array(n * 3);
  const aT = new Float32Array(n), aH = new Float32Array(n), aS = new Float32Array(n);
  const aI = new Float32Array(n);
  const aCtr = new Float32Array(n * 3), aSide = new Float32Array(n * 3), aUp = new Float32Array(n * 3);
  for (let j = 0; j < NS; j++) {
    for (let i = 0; i < NP; i++) {
      const k = j * NP + i, o = k * 3;
      pos[o] = P[i][0]; pos[o + 1] = P[i][1]; pos[o + 2] = 0;
      aI[k] = j; aT[k] = j / TR_SEG; aH[k] = P[i][2]; aS[k] = P[i][3];
    }
  }
  const idx = [];
  for (let j = 0; j < TR_SEG; j++) {
    for (const [i0, i1] of TR_LINK) {
      const a0 = j * NP + i0, b0 = j * NP + i1, a1 = a0 + NP, b1 = b0 + NP;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // ---- the cross-sections, ONE PER STATION (see TR_RIBS), sharing that
  // station's frame, so a rib is square to the local path tangent by
  // construction and can never disagree with the strips it sits inside.
  let k = NP * NS;
  for (let r = 0; r < TR_RIBS; r++) {
    const base = k;
    for (let i = 0; i < NC; i++) {
      const x = TR_RIB_X[i];
      const arch = 1 - 0.55 * x * x;      // a flame slice, not a fence panel
      let o = k * 3;
      pos[o] = x; pos[o + 1] = 0.02; pos[o + 2] = 0;
      aI[k] = r; aT[k] = r / TR_SEG; aH[k] = 0; aS[k] = TR_RIB_S[i]; k++;
      o = k * 3;
      pos[o] = x * 0.86; pos[o + 1] = arch; pos[o + 2] = 0;
      aI[k] = r; aT[k] = r / TR_SEG; aH[k] = 1; aS[k] = TR_RIB_S[i] + 0.13; k++;
    }
    for (let i = 0; i < NC - 1; i++) {
      const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aH', new THREE.BufferAttribute(aH, 1));
  geo.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
  geo.setAttribute('aI', new THREE.BufferAttribute(aI, 1));
  geo.setAttribute('aCtr', new THREE.BufferAttribute(aCtr, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aUp', new THREE.BufferAttribute(aUp, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setIndex(idx);
  // the station each vertex belongs to, kept as a plain typed array too: the
  // per-frame write below walks vertices, not stations, and reading it out of
  // the attribute every time would be the same array with a property lookup.
  A.trkIdx = aI;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      // specs/0047 §2 — its OWN Color object. It used to share the ski flame's
      // ("one colour, one source"), and one source is still true: both are
      // `skiAccent(id)` with the worn outfit's accent mixed in by auraDress.
      // What 0047 splits is the RATIO — 0.45 on the skis, 0.35 here, because
      // forty-five cross-sections stack end-on down the track (see TR_GAIN) and
      // the ski's blend stacks into a wash of suit colour rather than fire.
      uColor: { value: new THREE.Color().copy(A.mat.uniforms.uColor.value) },
      uP: { value: 0 }, uFlare: { value: 0 }, uWind: { value: 0 }, uTime: { value: 0 },
      uGain: { value: AU.GAIN }, uLen: { value: 0 },
      // how many station-gaps are actually alight right now: the ring holds 45
      // stations but a short trail (low p, low speed) only lights the first few,
      // and vT — age, colour, dissolve — is measured against THAT, not against
      // the buffer, so a two-metre trail is a whole two-metre trail rather than
      // the first quarter of an eight-metre one.
      uSpan: { value: TR_SEG },
      uLive: { value: 1 },        // the burn-down when he stops (TR_TAU_OUT)
      uHot: { value: AU.TR_HOT }, uDie: { value: AU.TR_DIE },
      uNear0: { value: AU.TR_NEAR0 * u }, uNear1: { value: AU.TR_NEAR1 * u },
    },
    vertexShader: `
      attribute float aT; attribute float aH; attribute float aS; attribute float aI;
      attribute vec3 aCtr; attribute vec3 aSide; attribute vec3 aUp;
      uniform float uP, uFlare, uWind, uTime, uSpan;
      varying float vT, vH, vS, vD;
      void main() {
        // AGE, not position along an axis. 0 at the rider's heels, 1 at the
        // oldest station still alight.
        vT = clamp(aI / max(uSpan, 1.0), 0.0, 1.0);
        vH = aH; vS = aS;
        // the same ragged-outline trick the ski ribbon uses, and for the same
        // reason: from the chase camera the fin is edge-on and only its top
        // edge is visible, so the licks have to be cut into the edge itself.
        // Phased on aT — the STATION's own fixed index — so the flicker stays
        // attached to a place in the queue instead of resampling every time the
        // trail changes length.
        float w = sin(aT *  6.0 + uTime * 4.1 + aS * 3.3) * 0.56
                + sin(aT * 15.0 - uTime * 8.2 + aS * 9.1) * 0.30
                + sin(aT * 31.0 + uTime * 12.4 + aS * 15.7) * 0.14;
        // centred on 1.0 rather than the old 0.72, because TR_HW is now a real
        // half-width in metres and not a slab to be tapered: the licks should
        // ripple around the ski stance, not shrink it to two thirds of one.
        float k = clamp(w * 0.74 + 0.46, 0.0, 1.0);
        float lick = 0.30 + 1.40 * k;
        // ...but the HEIGHT gets a much gentler one, and that is not a detail.
        // There is a cross-rib at EVERY station — one every 18 cm — and driving
        // their heights over the same 0.3..1.7 range makes neighbours alternate
        // between a lick and a spike: side-on the trail reads as a zip fastener
        // rather than a fire. Ragged top edge, yes; comb, no.
        float hLick = 0.62 + 0.52 * k;
        // ...and THIS is the whole geometry. No length, no width, no rise: the
        // station's world frame arrives pre-scaled in metres from trailPath(),
        // so a carve is a carve because the centres curve, not because anything
        // here bends them.
        vec3 p = aCtr + aSide * (position.x * lick) + aUp * (position.y * hLick);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uP, uFlare, uWind, uTime, uGain, uNear0, uNear1, uLive, uHot, uDie;
      varying float vT, vH, vS, vD;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.11))) * 43758.5453123); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
                   mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float sc = uTime * (1.4 + 3.0 * uWind);
        float n = vn(vec2(vT *  5.0 + sc * 1.4, vS *  3.1 + uTime * 1.1)) * 0.58
                + vn(vec2(vT * 13.0 + sc * 2.9, vS *  7.3 - uTime * 1.9)) * 0.28
                + vn(vec2(vT * 29.0 + sc * 5.6, vS * 13.7 + uTime * 2.7)) * 0.14;
        n = clamp((n - 0.5) * 2.1 + 0.5, 0.0, 1.0);
        float top = (0.18 + 1.15 * n) * (0.68 + 0.40 * uFlare);
        if (vH >= top) discard;
        float q = vH / top;
        // AGE, honestly. The previous cut kept a floor under this because its
        // plume opened out behind the rider — fade a cone out truthfully and all
        // that is left burning is the narrow throat. A track does not open out,
        // so there is nothing to protect: it is hottest under the skis, cools
        // along its length, and the oldest uDie of it dissolves to nothing
        // instead of ending on a straight card edge.
        float fade = (0.22 + 0.78 * pow(1.0 - vT, 0.70)) * smoothstep(1.0, 1.0 - uDie, vT);
        // A GENTLER FALL-OFF ACROSS THE RIBBON than the ski flame uses. On the
        // ski, alpha collapsing away from each tongue's root is what cuts the
        // licks; here it would leave a bright thread down the centreline of the
        // track and nothing either side of it.
        float a = pow(1.0 - q, 1.35) * fade * (0.25 + 0.75 * uP) * uLive
                * smoothstep(uNear0, uNear1, vD);
        // white-hot for the first uHot of the length, the ski's colour along the
        // middle, burning down to a dark ember at the oldest end
        vec3 col = mix(mix(uColor, vec3(1.0), 0.68), uColor, smoothstep(0.0, uHot, vT));
        col = mix(col, uColor * 0.30, smoothstep(0.45, 1.0, vT));
        // ...and WHITE-HOT AT THE TIPS OF THE TONGUES, exactly the way the ski
        // ribbon does it (half a mix to white past q = 0.55). Without it
        // the accent is the only colour on the ribbon and additive red over
        // blue-shadowed snow is a flat magenta stripe. With it the tips burn
        // out and what is left reads as fire rather than as paint.
        // ...and kept to a GARNISH, for the reason the ski ribbon's own comment
        // gives: additive over a white mountain eats most of the saturation
        // there is, and a trail that spends any more on white burns the same
        // pale pink whatever ski is on the rack.
        col = mix(col, mix(uColor, vec3(1.0), 0.34), smoothstep(0.66, 1.0, q));
        gl_FragColor = vec4(col * (uGain * (0.62 + 0.55 * uFlare)), clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  const m = new THREE.Mesh(geo, mat);
  m.name = 'fx:aura-trail';
  m.renderOrder = 91;
  m.frustumCulled = false;
  m.visible = false;
  R.scene.add(m);
  A.trail = m; A.trailMat = mat;
  A.tdx = 0; A.tdy = 0; A.tdz = 1;
  A.trkCount = 0; A.trkLive = 0; A.trkUse = 0;
  A.trkV = new THREE.Vector3();      // one scratch vector, reused every frame
}

// ---- WHERE THE TRAIL LEAVES THE MACHINE. The mean of the two third-person ski
// TAILS in world space, lifted TR_UP along the contact normal. Not the rider's
// centre: a fire trail comes off the back of the skis where they touch the
// snow, and anchoring it at c.position put it a body-width forward of the tails
// and (with the old TR_UP) at belt height, which is most of why it read as fire
// ON the rider rather than behind him. Returns the anchor in `o` and the
// surface normal it was lifted along.
function trailAnchor(o) {
  const c = R.ctrl, u = R.u;
  // WHICH WAY IS "OFF THE SNOW". Not world up: on a 30° face world up buries
  // the ribbon in the hillside on a traverse. The contact normal means "away
  // from the surface" everywhere on the mountain. Airborne there is no surface,
  // so it relaxes back toward world up.
  let nx = 0, ny = 1, nz = 0;
  const gn = c.groundNormal ? c.groundNormal() : null;
  if (gn) { nx = gn.x; ny = gn.y; nz = gn.z; }
  if (!c.grounded) { nx *= 0.3; ny = ny * 0.3 + 0.7; nz *= 0.3; }
  const nm = Math.hypot(nx, ny, nz) || 1;
  nx /= nm; ny /= nm; nz /= nm;

  let tx = 0, ty = 0, tz = 0, n = 0;
  const v = A.trkV;
  if (v) {
    for (const sm of A.tpMeshes) {
      if (!sm.parent) continue;
      // main.js has already bobbed, rolled, splayed and tip-risen the rigs by
      // the time auraStep runs (see the call site) — but nothing has asked for
      // a world matrix yet this frame, so ask for this one.
      sm.updateWorldMatrix(true, false);
      v.set(0, 0, AU_Z1 * u).applyMatrix4(sm.matrixWorld);
      tx += v.x; ty += v.y; tz += v.z; n++;
    }
  }
  if (!n) { const q = c.position; tx = q.x; ty = q.y; tz = q.z; n = 1; }
  o.x = tx / n + nx * AU.TR_UP * u;
  o.y = ty / n + ny * AU.TR_UP * u;
  o.z = tz / n + nz * AU.TR_UP * u;
  o.nx = nx; o.ny = ny; o.nz = nz;
  return o;
}
const _anch = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 };

// ---- THE PATH RING. Distance-spaced, newest first.
//
// Slot 0 is the LIVE anchor and is rewritten every frame, so the near end of
// the trail stays welded to the ski tails no matter what the frame rate is
// doing. Slots 1.. are COMMITTED samples, and one is only committed once the
// rider has actually moved TR_STEP from the last — which is what makes the
// spacing a property of the TRACK rather than of the frame rate. Commit on
// time instead and a rider at 4 m/s bunches forty stations into one metre
// while a rider at 30 m/s stretches them over fifteen.
function trailPush(a) {
  const u = R.u, T = A.trk, N = A.trkN;
  const step = AU.TR_STEP * u;
  if (A.trkCount >= 2) {
    let bx = T[3], by = T[4], bz = T[5];
    let d = Math.hypot(a.x - bx, a.y - by, a.z - bz);
    // a gap this big is not skiing, it is a respawn or a dev-fly teleport, and
    // drawing through it would run a burning line across the mountain from
    // wherever he used to be
    if (d > AU.TR_JUMP * u) A.trkCount = 0;
    else {
      // ONE FRAME CAN BE WORTH MANY STATIONS, and this loop is the difference
      // between distance spacing and a lie about it. At 30 m/s a 50 ms frame
      // covers a metre and a half — eight stations — and committing only the
      // newest would space the track by the frame time after all, which is the
      // exact thing the buffer exists not to do. So walk the gap.
      let guard = TR_NST;
      while (d >= step && guard-- > 0) {
        const f = step / d;
        const px = bx + (a.x - bx) * f, py = by + (a.y - by) * f, pz = bz + (a.z - bz) * f;
        T.copyWithin(6, 3); N.copyWithin(6, 3);   // everything older shifts back
        T[3] = px; T[4] = py; T[5] = pz;
        // the interpolated stations all take the live contact normal: they span
        // at most one frame of terrain, which is less than the snow changes in
        N[3] = a.nx; N[4] = a.ny; N[5] = a.nz;    // the width of one station
        if (A.trkCount < TR_NST) A.trkCount++;
        bx = px; by = py; bz = pz;
        d = Math.hypot(a.x - bx, a.y - by, a.z - bz);
      }
    }
  }
  if (A.trkCount < 2) {
    T[3] = a.x; T[4] = a.y; T[5] = a.z;
    N[3] = a.nx; N[4] = a.ny; N[5] = a.nz;
    A.trkCount = 2;
    A.trkUse = 0;
  }
  T[0] = a.x; T[1] = a.y; T[2] = a.z;
  N[0] = a.nx; N[1] = a.ny; N[2] = a.nz;
}

// ---- AND WRITE IT INTO THE MESH. Three vec3 attributes per vertex — the
// station's world centre, its side vector and its up vector, both already in
// metres — so the vertex shader only has to add them up. 675 vertices × 9
// floats is 24 KB an upload, which is the price of a ribbon that can bend.
function trailPath(p, wind) {
  const u = R.u, T = A.trk, N = A.trkN, geo = A.trail.geometry;
  const aCtr = geo.attributes.aCtr.array;
  const aSide = geo.attributes.aSide.array;
  const aUp = geo.attributes.aUp.array;
  const idx = A.trkIdx, nv = idx.length;

  // how much PATH is alight: the length ramp from 0006 §2.3, unchanged, but it
  // now buys stations off the ring instead of stretching one bar.
  let len = AU.TR_LEN * u * p * (AU.TR_LEN0 + (1 - AU.TR_LEN0) * wind);
  if (len < AU.TR_MIN * u) len = AU.TR_MIN * u;
  const want = Math.min(TR_NST, Math.max(2, Math.round(len / (AU.TR_STEP * u)) + 1));
  const use = Math.min(want, A.trkCount);
  A.trkUse = use;
  const span = Math.max(1, use - 1);
  const rise = (AU.TR_RISE + AU.TR_WHIP * A.drain) * u;
  const hw = AU.TR_HW * u;

  // per-station frame: centre (with its age-buoyancy), side, up
  const cx = A.frCtr, sx = A.frSide, ux = A.frUp;
  for (let j = 0; j < TR_NST; j++) {
    const jj = Math.min(j, use - 1), o = jj * 3;
    const t = j / span;                       // age, ≥ 1 past the live end
    // TANGENT along the path — central difference, so a rib is square to the
    // bit of track it stands on rather than to the chord of the whole trail.
    const pj = Math.max(0, jj - 1) * 3, nj = Math.min(use - 1, jj + 1) * 3;
    let tgx = T[pj] - T[nj], tgy = T[pj + 1] - T[nj + 1], tgz = T[pj + 2] - T[nj + 2];
    let tm = Math.hypot(tgx, tgy, tgz);
    if (tm < 1e-6) { tgx = 0; tgy = 0; tgz = 1; tm = 1; }
    tgx /= tm; tgy /= tm; tgz /= tm;
    let nx = N[o], ny = N[o + 1], nz = N[o + 2];
    // side = normal × tangent, then the up is re-squared off the two so the
    // frame stays orthonormal on a cross-slope
    let sxv = ny * tgz - nz * tgy, syv = nz * tgx - nx * tgz, szv = nx * tgy - ny * tgx;
    let sm = Math.hypot(sxv, syv, szv);
    if (sm < 1e-6) { sxv = 1; syv = 0; szv = 0; sm = 1; }
    sxv /= sm; syv /= sm; szv /= sm;
    nx = tgy * szv - tgz * syv; ny = tgz * sxv - tgx * szv; nz = tgx * syv - tgy * sxv;
    const um = Math.hypot(nx, ny, nz) || 1;
    nx /= um; ny /= um; nz /= um;
    // height: tallest at the heels, burned down by the oldest end (§1b)
    const tc = t > 1 ? 1 : t;
    const h = (AU.TR_H0 + (AU.TR_H1 - AU.TR_H0) * tc) * u;
    const fl = Math.pow(tc, 1.35) * rise;     // hot gas rises as it ages
    const q = j * 3;
    cx[q] = T[o] + nx * fl; cx[q + 1] = T[o + 1] + ny * fl; cx[q + 2] = T[o + 2] + nz * fl;
    sx[q] = sxv * hw; sx[q + 1] = syv * hw; sx[q + 2] = szv * hw;
    ux[q] = nx * h; ux[q + 1] = ny * h; ux[q + 2] = nz * h;
  }
  // ...and fan it out to the vertices. Stations past `use` were collapsed onto
  // the live end above, so their triangles are zero-area AND their vT is ≥ 1,
  // which the dissolve takes to zero: two independent reasons to draw nothing.
  for (let k = 0; k < nv; k++) {
    const j = idx[k] * 3, o = k * 3;
    aCtr[o] = cx[j]; aCtr[o + 1] = cx[j + 1]; aCtr[o + 2] = cx[j + 2];
    aSide[o] = sx[j]; aSide[o + 1] = sx[j + 1]; aSide[o + 2] = sx[j + 2];
    aUp[o] = ux[j]; aUp[o + 1] = ux[j + 1]; aUp[o + 2] = ux[j + 2];
  }
  geo.attributes.aCtr.needsUpdate = true;
  geo.attributes.aSide.needsUpdate = true;
  geo.attributes.aUp.needsUpdate = true;

  // the chord, for the direction assertion and __aura.trailDir(): anchor → the
  // oldest live station, which on a straight run IS −v̂ and in a carve is the
  // secant of the arc, exactly as the tracks under it are.
  const e = (use - 1) * 3;
  const dx = T[e] - T[0], dy = T[e + 1] - T[1], dz = T[e + 2] - T[2];
  const dm = Math.hypot(dx, dy, dz);
  if (dm > 1e-4) { A.tdx = dx / dm; A.tdy = dy / dm; A.tdz = dz / dm; }
  return { len: (use - 1) * AU.TR_STEP * u, span };
}

// One mesh, world space, never aimed: `p` and the speed buy how much of the
// rider's own recent PATH is alight, and the path is where it goes.
function trailPose(dt, p, wind, flare, tp) {
  const m = A.trail;
  if (!m) return;
  const c = R.ctrl, u = R.u;
  if (!tp || p <= AU.ON_AT) { m.visible = false; return; }

  const a = trailAnchor(_anch);
  trailPush(a);

  // ---- WHEN HE STOPS. The ring is distance-spaced, so a stationary rider
  // simply stops laying stations and the track sits where it is. It must not
  // snap off — a fire on the snow burns down — so alpha runs out over
  // TR_TAU_OUT and comes straight back the moment he moves.
  const v = c.velocity;
  const sp = v ? Math.hypot(v.x, v.y, v.z) : 0;
  if (sp > AU.TR_STOP * u) A.trkLive = 1;
  else A.trkLive = Math.max(0, A.trkLive - dt / AU.TR_TAU_OUT);

  const g = trailPath(p, wind);

  const U = A.trailMat.uniforms;
  // specs/0047 §2 — the trail's own body colour, on the same charge → flare walk
  // as the ski ribbon's, at the trail's own blend (see the uColor uniform above)
  A.trailNow = flare <= 0 ? A.tintTrailComp : mixHex(A.tintTrailComp, A.tintTrail, flare);
  U.uColor.value.setHex(A.trailNow);
  U.uP.value = p;
  U.uFlare.value = flare;
  U.uWind.value = wind;
  U.uTime.value = A.time;
  U.uLen.value = g.len;
  U.uSpan.value = g.span;
  U.uLive.value = A.trkLive;
  U.uGain.value = AU.GAIN * AU.TR_GAIN * (0.45 + 0.55 * p);
  m.visible = A.trkUse >= 2 && A.trkLive > 0;
}

// The equipped ski, when it changes: one colour, one length. `len` matters
// because makeSkiRig scales the BLADE and not the rig, so a 218 cm Redster DH
// and a 157 cm Redster S9 are the same group with different children — the
// ribbon has to be told the same scale the blade was.
// specs/0047 §2 — and the WORN LOOK, when THAT changes, because the outfit is
// now half of what the flame is coloured by. `lookColours()` caches per
// serialised look and hands the same object back, so the second test is an
// identity compare and this function still does nothing on 99.9 % of frames.
// The four hexes it resolves are the whole of 0047's colour arithmetic: every
// frame after this one just picks between two of them.
function auraDress(id) {
  const oc = lookColours();
  if (A.id === id && A.oc === oc) return;
  const dressed = A.id === id;
  A.id = id; A.oc = oc;
  A.colour = skiAccent(id);
  // ---- specs/0047 §A (0047a) — THE AURA IS THE SKI AGAIN, and only the ski.
  // Greg, 2026-09-05: "remove the color mixing for the onscreen lightning aura —
  // just use ski palette not outfit." 0047 §2 blended the outfit's `accent` into
  // the flame body at 45 % (35 % on the trail), its `primary` into the charge at
  // 25 % and its `glow` into the white-hot core at 35 %. All four blends go: the
  // reading goes back to 0006 §2.1, which is that the flame IS the equipped ski's
  // topsheet — `skiAccent(id)`, the more chromatic of the ski's `look.base` and
  // `look.accent` — and the core is white-hot heat, not anybody's colour.
  //
  // The four fields stay (auraStep walks `tintComp → tint` on the flare ramp and
  // `A.glow` still feeds the core) so nothing downstream changed shape; they now
  // all resolve to the one ski colour, which makes that walk a no-op by value
  // rather than by a deleted branch. `OUTFIT_TINT.aura/.trail/.comp/.core` are
  // retired with them — the outfit's colour now rides the SPEED LINES alone, and
  // `OUTFIT_TINT.core` stays live only for `flStyles`' core argument below.
  A.tint = A.colour;
  A.tintComp = A.colour;
  A.tintTrail = A.colour;
  A.tintTrailComp = A.colour;
  A.glow = 0xffffff;                 // 0006 §2.1: "tips of the flames toward white-hot"
  A.mat.uniforms.uColor.value.setHex(A.tint);
  // ...and the trail's colour is its OWN object since 0047: one power, two
  // presentations, and §2 gave them two blend ratios (0.45 and 0.35). 0047a
  // gives them the same ski colour; the field stays because the two ribbons are
  // two materials and always were.
  A.trailMat.uniforms.uColor.value.setHex(A.tintTrail);
  // 0047a — the consumed-burst flame (0006 §2.2) is the SAME reading as the aura
  // and reverses with it: ski body, white-hot core. `A.glow` is 0xffffff above,
  // so `flStyles`' core mix lands back on the near-white it opened life at.
  flStyles(A.tint, A.glow);
  // ...and these three do NOT reverse: `slOutfitInk` paints `SL_FILL[16..23]`,
  // which is the IMPACT frame's third ink (0057 §7.3) and the jib spray's tint,
  // neither of which 0047a touches.
  slOutfitInk(oc.accent);
  JS.ink = oc.accent;              // specs/0057 §7.2 — the jib spray's tint, off
  JS.inkLit = litHex(oc.accent);   // the same accent and on the same one event
  if (dressed) return;                        // same ski, new suit: no rescale
  const k = (getSkiModel(id).len || SKI_REF.len) / SKI_REF.len;
  for (const m of A.meshes) m.scale.z = k;
}

function auraHide() {
  if (A.trail) A.trail.visible = false;
  if (!A.shown) return;
  A.shown = false;
  for (const m of A.meshes) m.visible = false;
}

// The consumed edge (spec §2.2). `e` is how much power was spent, 0..1, and it
// starts the drain and the burst together — they are one event.
function auraFire(e) {
  const a = clamp(e, 0, 1);
  if (a < AU.MIN_E) return 0;
  A.e = a;
  A.hold = Math.max(A.p, a);      // the aura freezes at what it had, then drains
  A.drainT = AU.DRAIN_T;
  if (a > A.burst) A.burst = a;
  // ...and the burst converges on the LAUNCH vector rather than the travel one,
  // which is the difference between "you are going fast" and "you were just
  // thrown". Falls back to the field's own focus when there is no velocity yet.
  const c = R.ctrl;
  let set = false;
  if (c && c.velocity) {
    const vx = c.velocity.x, vy = c.velocity.y, vz = c.velocity.z;
    const vm = Math.hypot(vx, vy, vz);
    if (vm > 1e-4) {
      projectDir(vx / vm, vy / vm, vz / vm, SL.FOCUS_LEAD * Math.min(S.w, S.h) * 0.5, _proj);
      A.fx = _proj.x; A.fy = _proj.y; set = true;
    }
  }
  if (!set) { A.fx = S.focusX; A.fy = S.focusY; }
  ringArm(a);        // specs/0059 §2 — the takeoff edge, latched. Reads nothing, moves nothing.
  try { window.__playAudio.auraArm(a); } catch { /* no audio ctx */ }  // specs/0062 §3a — arms, does not fire
  return A.e;
}

// One step of the 3D half: read the bank, resolve p, and write six uniforms.
// Reads nothing it can write and writes nothing but its own material.
function auraStep(dt, paused) {
  A.stepMs = 0;
  if (!FX_AURA_ON || !A.built) return;
  const t0 = performance.now();
  try {
    A.time += dt;
    const c = R.ctrl;
    // Every silence the anime lines obey (spec §3), plus the two this one has of
    // its own: no skis on your feet, and no aura on a bike/sled/glider (v1).
    // specs/0019: `auHidden`, not `slSuppressed` — in a clean frame this half
    // answers to the aura's own knob. Everywhere else the two are the same read.
    const onSkis = !!(c && c.mode === 'skis');
    if (!onSkis || auHidden(paused)) {
      auraHide();
      A.p = 0; A.burst = 0; A.drainT = 0; A.live = 0;
      for (let i = 0; i < FL_CAP; i++) A.lf[i] = 0;
      return;
    }
    auraDress((A.skiId && A.skiId()) || A.id || 'lab-standard');

    const T = c.gearTuning ? c.gearTuning('skis') : null;
    const bs = bankState(T);

    // ---- the takeoff EDGE. Object identity, not a level and not a drain.
    if (bs.launch !== A.lastLaunch) {
      const first = A.lastLaunch === undefined;
      A.lastLaunch = bs.launch;
      if (bs.launch && !first) {
        // "the payout actually applied, normalised the same way as p": the lip
        // charge the takeoff really spent, against the same ceiling — or, when
        // the ground gave nothing back, simply the flame that was standing on
        // the skis, because that is the power the player watched charge up.
        const paid = bs.chargeMax > 0 ? clamp(bs.launchTotal / bs.chargeMax, 0, 1) : 0;
        auraFire(Math.max(A.p, paid));
      }
    }

    // ---- p. The drain holds it at what it was so the empty is watchable; a
    // 150 ms snap to zero would just be the flame disappearing.
    let p;
    if (A.drainT > 0) {
      A.drainT = Math.max(0, A.drainT - dt);
      A.drain = 1 - A.drainT / AU.DRAIN_T;
      p = A.hold;
    } else {
      A.drain = 0;
      p = bs.p;
    }
    if (A.forced != null) { p = clamp(A.forced, 0, 1); A.drain = 0; }
    A.p = p;

    if (p <= AU.ON_AT && A.drain <= 0) { auraHide(); return; }

    const reach = Math.pow(p, AU.REACH_POW) * AU.REACH_MAX;
    const flare = smooth(p, AU.FLARE_AT, 1);
    const sp = c.speed ? c.speed() / R.u : 0;
    // WHICH PRESENTATION (spec §2.3). One power, two readings, and the camera
    // picks: the ski flame is a metre from the lens in first person and four
    // pixels of it in third, and the trail is the other way round.
    const tp = !!(A.camMode && A.camMode() === 'tp');
    trailPose(dt, p, clamp(sp / AU.WIND_AT, 0, 1), flare, tp);
    const U = A.mat.uniforms;
    // specs/0047 §2 — the two colour writes, and they are the whole per-frame
    // cost of this spec on the 3D half: two hex blends and two setHex. The body
    // walks charge → flare (§2's `comp` fades out exactly as the flare comes
    // in), and the core walks white → the outfit's glow on the same ramp — so
    // below FLARE_AT the core is the pure white it has always been and the only
    // thing 0047 has changed at that end of the ramp is the body's colour.
    A.bodyNow = flare <= 0 ? A.tintComp : mixHex(A.tintComp, A.tint, flare);
    A.coreNow = flare <= 0 ? 0xffffff : mixHex(0xffffff, A.glow, OUTFIT_TINT.core * flare);
    U.uColor.value.setHex(A.bodyNow);
    U.uCore.value.setHex(A.coreNow);
    U.uP.value = p;
    U.uBack.value = reach * (1 - A.drain);       // drains tail → tip
    U.uFlare.value = flare;
    U.uWind.value = clamp(sp / AU.WIND_AT, 0, 1);
    U.uTime.value = A.time;
    U.uH.value = AU.H_MIN + (AU.H_MAX - AU.H_MIN) * Math.pow(p, 0.7);
    U.uGain.value = AU.GAIN * (0.45 + 0.55 * p);
    if (!A.shown) { A.shown = true; for (const m of A.meshes) m.visible = true; }
  } catch { R.errors++; } finally { A.stepMs = performance.now() - t0; }
}

// ------------------------------------------------- the coloured burst lines
function flSpawn(inner, len, wide, alpha, life) {
  let i = A.cursor, tries = FL_CAP;
  while (tries-- > 0 && A.lf[i] > 0) i = (i + 1) % FL_CAP;
  if (A.lf[i] > 0) return false;
  A.cursor = (i + 1) % FL_CAP;
  // BOTTOM-WEIGHTED. The convergence point is the launch vector, but the fire is
  // coming off the skis, which are under you — so upward rays are mostly
  // reflected down and the field rakes out of the bottom of the frame.
  let a = Math.random() * Math.PI * 2;
  if (Math.sin(a) < 0 && Math.random() < 0.62) a = -a;
  A.ca[i] = Math.cos(a); A.sa[i] = Math.sin(a);
  A.r0[i] = inner * rand(0.85, 1.35);
  A.ln[i] = len * rand(0.50, 1.40);
  A.wd[i] = wide * rand(0.50, 1.70);
  A.a0[i] = alpha * rand(0.55, 1.30);
  A.ph[i] = Math.random() * 6.283;
  const L = life * rand(0.70, 1.30);
  A.lf[i] = L; A.tt[i] = L;
  return true;
}

function flStep(dt) {
  if (!FX_AURA_ON) return false;
  A.burst *= Math.exp(-dt / AU.BURST_TAU);
  if (A.burst < 0.004) A.burst = 0;
  const e = A.burst;
  if (e === 0 && A.live === 0) return false;

  // the burst's focus falls back toward the field's travel focus as it decays,
  // so a long burst does not stay pinned to a launch that is over
  const k = 1 - Math.exp(-dt / AU.FOCUS_BACK);
  A.fx += (S.focusX - A.fx) * k;
  A.fy += (S.focusY - A.fy) * k;

  if (e > 0) {
    const inner = AU.INNER * (1 - 0.22 * e);
    const len = AU.LEN_MIN + (AU.LEN_MAX - AU.LEN_MIN) * Math.pow(e, 0.8);
    const wide = AU.WIDTH * (0.42 + 0.58 * e)
      * clamp(Math.min(S.w, S.h) / AU.WIDTH_REF, 0.7, 1.4);
    const alpha = AU.ALPHA * Math.pow(e, 0.75);
    const life = (AU.LIFE_MIN + AU.LIFE_MAX) * 0.5;
    // same rate law as the ink field: population / mean lifetime, so the count
    // settles on `want` without anyone tracking it
    A.acc += ((AU.LINES * e) / life) * dt;
    let n = A.acc | 0;
    A.acc -= n;
    if (n > 24) n = 24;
    while (n-- > 0) if (!flSpawn(inner, len, wide, alpha, life)) break;
  }

  const fx = S.w * 0.5 + A.fx, fy = S.h * 0.5 + A.fy + S.h * AU.DOWN;
  const HX = S.w * 0.5 * AU.REACH, HY = S.h * 0.5 * AU.REACH;
  const step = FL_ALPHA_CEIL / FL_BUCKETS;
  const SPAN = FL_ST * 2;
  let live = 0;
  for (let i = 0; i < FL_CAP; i++) {
    let L = A.lf[i];
    if (L <= 0) { A.gb[i] = 255; continue; }
    L -= dt; A.lf[i] = L;
    if (L <= 0) { A.gb[i] = 255; continue; }
    live++;
    const ttl = A.tt[i], frac = L / ttl, age = ttl - L;
    const env = Math.min(1, age * 11) * Math.pow(frac, 0.55);
    const a = A.a0[i] * env;
    if (a < step * 0.5) { A.gb[i] = 255; continue; }
    let b = (a / step) | 0;
    if (b >= FL_BUCKETS) b = FL_BUCKETS - 1;
    A.gb[i] = b;

    const ca = A.ca[i], sa = A.sa[i], ln = A.ln[i], ph = A.ph[i];
    const rIn = A.r0[i] + ln * AU.DRIFT * (1 - frac);
    // the ray's pixel direction and its perpendicular, computed ONCE per line —
    // an ellipse-space normal would make the horizontal lines fatter
    let dx = ca * HX, dy = sa * HY;
    const dm = Math.hypot(dx, dy) || 1;
    dx /= dm; dy /= dm;
    const nx = -dy, ny = dx;
    const o = i * SPAN * 2;
    for (let k = 0; k < FL_ST; k++) {
      const s = k / (FL_ST - 1);
      const r = rIn + ln * s;
      // THE CURL. A flame line is not a straight spike: the centreline waves,
      // and the wave grows outward, so the far end whips.
      const curl = Math.sin(s * 3.4 + ph) * AU.CURL * ln * (0.20 + s) * HX;
      const px = fx + ca * r * HX + nx * curl;
      const py = fy + sa * r * HY + ny * curl;
      const w = A.wd[i] * (0.12 + 0.88 * Math.pow(s, 0.75)) * 0.5;
      const cw = w * AU.CORE_W;
      const f = k * 2, bk = (SPAN - 1 - k) * 2;    // forward edge, return edge
      A.gx[o + f]      = px + nx * w;  A.gx[o + f + 1]  = py + ny * w;
      A.gx[o + bk]     = px - nx * w;  A.gx[o + bk + 1] = py - ny * w;
      A.cx[o + f]      = px + nx * cw; A.cx[o + f + 1]  = py + ny * cw;
      A.cx[o + bk]     = px - nx * cw; A.cx[o + bk + 1] = py - ny * cw;
    }
  }
  A.live = live;
  return live > 0;
}

// Four fill() calls, ceiling: three alpha buckets of ski-accent flame and one
// white-hot core drawn only over the brightest bucket (so the core fades by
// population rather than popping off at a threshold). Same canvas, same frame,
// on top of the ink field — which is untouched.
function flDraw(g) {
  const gx = A.gx, cx = A.cx, gb = A.gb, SPAN = FL_ST * 2;
  for (let b = 0; b < FL_BUCKETS; b++) {
    let opened = false;
    for (let i = 0; i < FL_CAP; i++) {
      if (gb[i] !== b) continue;
      if (!opened) { g.beginPath(); opened = true; }
      const o = i * SPAN * 2;
      g.moveTo(gx[o], gx[o + 1]);
      for (let k = 1; k < SPAN; k++) g.lineTo(gx[o + k * 2], gx[o + k * 2 + 1]);
      g.closePath();
    }
    if (opened) { g.fillStyle = FL_FILL[b]; g.fill(); }
  }
  let opened = false;
  for (let i = 0; i < FL_CAP; i++) {
    if (gb[i] !== FL_BUCKETS - 1) continue;
    if (!opened) { g.beginPath(); opened = true; }
    const o = i * SPAN * 2;
    g.moveTo(cx[o], cx[o + 1]);
    for (let k = 1; k < SPAN; k++) g.lineTo(cx[o + k * 2], cx[o + k * 2 + 1]);
    g.closePath();
  }
  if (opened) { g.fillStyle = FL_CORE; g.fill(); }
}

function flReset() {
  if (A.live === 0 && A.burst === 0) return;
  A.live = 0; A.burst = 0; A.acc = 0;
  for (let i = 0; i < FL_CAP; i++) A.lf[i] = 0;
}

function auraCostPct(p) {
  if (!A.cn) return 0;
  const a = Array.prototype.slice.call(A.cost.subarray(0, A.cn)).sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(4);
}

// ---------------------------------------------------------------- emitters
function emitSki(dt) {
  const c = R.ctrl, u = R.u;
  if (!c || c.mode !== 'skis') return;
  const p = c.position, v = c.velocity;
  const s = c.speed();
  const yaw = c.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);        // along the skis
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);         // across the skis
  const vr = v.x * rx + v.z * rz;                        // lateral (edge load)
  // The stop/stivot machine is the authority on what the skis are doing. SHIFT
  // is tuck now and S only brakes when it opposes travel, so reading the keys
  // here would light the plume in all the wrong places (spec §2.1, §2.4).
  const st = skiState();
  const stop = st.stop | 0;                              // 0 none, 1 plow, 2 hockey
  const edge = clamp(st.edge || 0, 0, 1);
  const shortStiv = !!st.stivoting && st.stivot < 0.45;
  const braking = stop !== 0;
  // §2.4 rate multipliers. Hockey and pizza outrank a stivot, a stivot outranks
  // a release, and a plain carve is the 1.0 the roost below is already tuned to.
  const mul = stop === 2 ? 4.0 : stop === 1 ? 1.6 : shortStiv ? 2.2 : st.releasing ? 1.4 : 1.0;

  // ---- landing burst (works from any mode transition while on skis)
  if (c.grounded && !R.prevGrounded) {
    const impact = Math.max(0, -R.prevVy);
    if (impact > 2.5 * u) {
      const n = Math.min(380, Math.round(26 * impact / u));
      const up = clamp(impact / (10 * u), 0.6, 1.8);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = rand(0.5, 3.4) * u * clamp(impact / (12 * u), 0.4, 1.7);
        emit(
          p.x + Math.cos(a) * rand(0.1, 0.7) * u, p.y + rand(0.02, 0.3) * u, p.z + Math.sin(a) * rand(0.1, 0.7) * u,
          Math.cos(a) * rr + v.x * 0.5, rand(1.0, 4.2) * u * up, Math.sin(a) * rr + v.z * 0.5,
          rand(0.9, 1.6), rand(0.10, 0.32) * u, rand(0.6, 0.95),
        );
      }
    }
  }

  if (!c.grounded) return;

  // tails of the skis, a touch behind the boots
  const tx = p.x - fx * 0.55 * u, tz = p.z - fz * 0.55 * u;

  // ---- continuous wake at speed (light)
  if (s > 2.5 * u) {
    R.accWake += (70 + 220 * clamp(s / (28 * u), 0, 1)) * dt;
    let n = R.accWake | 0; R.accWake -= n;
    while (n--) {
      const side = Math.random() < 0.5 ? -1 : 1;
      emit(
        tx + rx * side * 0.22 * u + rand(-0.08, 0.08) * u, p.y + rand(0.0, 0.12) * u, tz + rz * side * 0.22 * u + rand(-0.08, 0.08) * u,
        -fx * s * rand(0.05, 0.22) + rand(-0.4, 0.4) * u, rand(0.3, 1.4) * u, -fz * s * rand(0.05, 0.22) + rand(-0.4, 0.4) * u,
        rand(0.35, 0.8), rand(0.05, 0.12) * u, rand(0.3, 0.55),
      );
    }
  }

  // ---- carve roost: rate ~ speed x lateral grip, thrown to the outside of the
  // turn. Two populations: HEAVY roost that inherits most of the player's
  // velocity (it rides alongside and climbs into the first-person frame — this
  // is the spray you actually SEE), and trailing roost left hanging behind.
  const load = Math.abs(vr);
  if (!braking && load > 0.8 * u && s > 4 * u) {
    const rate = mul * 2400 * clamp(s / (28 * u), 0, 1) * clamp(load / (6 * u), 0, 1);
    R.accRoost += rate * dt;
    let n = R.accRoost | 0; R.accRoost -= n;
    const sgn = vr > 0 ? 1 : -1;              // outside of the turn
    const ox = rx * sgn, oz = rz * sgn;       // outward
    const loadK = 0.75 + 0.4 * clamp(load / (5 * u), 0, 1.4);
    while (n--) {
      const kick = (1.0 + 0.7 * load / u) * u * rand(0.5, 1.3);
      if (Math.random() < 0.55) {
        // rider spray: born beside the boots, keeps pace, climbs into view
        const inh = rand(0.55, 0.9);
        emit(
          p.x + ox * rand(0.15, 0.7) * u + fx * rand(-0.2, 0.6) * u,
          p.y + rand(0.05, 0.4) * u,
          p.z + oz * rand(0.15, 0.7) * u + fz * rand(-0.2, 0.6) * u,
          v.x * inh + ox * kick * 0.7,
          rand(2.0, 4.8) * u * loadK,
          v.z * inh + oz * kick * 0.7,
          rand(0.6, 1.1), rand(0.12, 0.30) * u, rand(0.55, 0.95),
        );
      } else {
        // trailing roost: hangs in the air where the carve happened
        emit(
          tx + ox * rand(0.1, 0.5) * u, p.y + rand(0.02, 0.25) * u, tz + oz * rand(0.1, 0.5) * u,
          v.x * rand(0.1, 0.3) + ox * kick,
          rand(1.4, 3.6) * u * loadK,
          v.z * rand(0.1, 0.3) + oz * kick,
          rand(0.8, 1.4), rand(0.10, 0.28) * u, rand(0.5, 0.9),
        );
      }
    }
  }

  // ---- stop / stivot plumes, all of them through the public spray() hook. The
  // rate is |vr| x edge x the §2.4 multiplier; the edge term is floored because
  // a flat-ski slide still moves a lot of snow, it just does not bite, and a
  // plume that vanishes at zero edge angle reads as a bug rather than a nuance.
  // `vrs` is what the skis are scrubbing sideways; a pizza scrubs almost nothing
  // sideways and throws its snow straight off the tips instead, so the term the
  // rate rides is the larger of the two.
  const vrs = Math.abs(vr);
  const sgn = vr > 0 ? 1 : -1;                           // outside of the slip
  const scrub = Math.max(vrs, stop === 1 ? s * 0.35 : 0);
  const plume = 900 * clamp(scrub / (6 * u), 0.15, 1.4) * (0.35 + 0.65 * edge);
  // the ground normal leans DOWNhill, so its negated horizontal is the uphill
  // bearing the hockey wall throws into
  let ux = 0, uz = 0;
  try {
    const gn = c.groundNormal && c.groundNormal();
    if (gn) { const h = Math.hypot(gn.x, gn.z); if (h > 1e-3) { ux = -gn.x / h; uz = -gn.z / h; } }
  } catch { R.errors++; }

  if (stop === 2 && s > 1.0 * u) {
    // hockey stop: one wall, thrown across the skis to the outside of the slip
    // and canted uphill, which is where a real one puts it
    const thr = (2.6 + 0.55 * vrs / u) * u;
    spray(
      { x: p.x + rx * sgn * 0.24 * u, y: p.y + 0.10 * u, z: p.z + rz * sgn * 0.24 * u },
      { x: (rx * sgn * 0.80 + ux * 0.60) * thr, y: 0.95 * thr, z: (rz * sgn * 0.80 + uz * 0.60) * thr },
      plume * 4.0, 0.19,
    );
  } else if (stop === 1 && s > 1.0 * u) {
    // pizza: two narrow plumes, one off each tip, half the budget each
    const thr = (1.6 + 0.30 * s / u) * u;
    for (let side = -1; side <= 1; side += 2) {
      spray(
        { x: p.x + fx * 0.50 * u + rx * side * 0.26 * u, y: p.y + 0.06 * u, z: p.z + fz * 0.50 * u + rz * side * 0.26 * u },
        { x: (fx * 0.75 + rx * side * 0.55) * thr, y: 0.45 * thr, z: (fz * 0.75 + rz * side * 0.55) * thr },
        plume * 0.8, 0.13,
      );
    }
  } else if (shortStiv && s > 2 * u) {
    // short stivot: a wide fan off the tails, gone again in under half a second
    const thr = (2.0 + 0.50 * vrs / u) * u;
    spray(
      { x: tx + rx * sgn * 0.20 * u, y: p.y + 0.08 * u, z: tz + rz * sgn * 0.20 * u },
      { x: (rx * sgn * 0.90 - fx * 0.35) * thr, y: 0.70 * thr, z: (rz * sgn * 0.90 - fz * 0.35) * thr },
      plume * 2.2, 0.16,
    );
  }

  // ---- release burst: one shot, sized by the speed the transition actually
  // handed back (§1.10). takeSkiBurst() is a drain, so read it exactly once a
  // frame whatever else is going on; rate = n/dt spends the count in this frame.
  const burst = takeSkiBurst();
  if (burst > 0.02 * u) {
    const n = Math.min(200, Math.round(120 * burst / u));
    const thr = (2.2 + 0.9 * burst / u) * u;
    spray(
      { x: p.x + rx * sgn * 0.20 * u, y: p.y + 0.18 * u, z: p.z + rz * sgn * 0.20 * u },
      { x: (rx * sgn * 0.70 - fx * 0.30) * thr, y: 1.05 * thr, z: (rz * sgn * 0.70 - fz * 0.30) * thr },
      n / R.dt, 0.22,
    );
  }
}

// Glider: the only thing on the ground to kick up is what you skim over, so the
// emitter is entirely about the last two metres. Ground effect and a spray off
// the surface arrive together, which is exactly the read the player wants —
// "you are close enough that the ground is holding you up".
function emitGlide(dt) {
  const c = R.ctrl, u = R.u;
  if (!c || c.mode !== 'glider' || c.grounded) return;
  const g = gliderState();
  if (!(g.skim > 0.05)) return;
  const p = c.position, v = c.velocity;
  const s = c.speed();
  R.accWake += 900 * g.skim * clamp(s / (22 * u), 0, 1) * dt;
  let n = R.accWake | 0; R.accWake -= n;
  const fx = v.x / (s || 1), fz = v.z / (s || 1);
  while (n--) {
    const side = Math.random() < 0.5 ? -1 : 1;
    emit(
      p.x - fx * rand(0.2, 1.4) * u + (-fz) * side * rand(0, 0.9) * u,
      p.y - g.agl + rand(0.02, 0.25) * u,
      p.z - fz * rand(0.2, 1.4) * u + fx * side * rand(0, 0.9) * u,
      -fx * s * rand(0.1, 0.35) + (-fz) * side * rand(0.4, 2.0) * u,
      rand(0.8, 3.0) * u * (0.5 + g.skim),
      -fz * s * rand(0.1, 0.35) + fx * side * rand(0.4, 2.0) * u,
      rand(0.4, 0.9), rand(0.06, 0.18) * u, rand(0.3, 0.7),
    );
  }
}

// ------------------------------------------------------------------- public
export function init(ctx) {
  try {
    if (R.ok || !ctx) return;
    R.THREE = ctx.THREE; R.scene = ctx.scene; R.camera = ctx.camera;
    R.renderer = ctx.renderer; R.ctrl = ctx.ctrl; R.hud = ctx.hud;
    if (!R.THREE || !R.scene) return;
    R.u = (R.ctrl && R.ctrl.T && R.ctrl.T.eyeHeight) ? R.ctrl.T.eyeHeight / 1.70 : 1;
    polish(R.THREE, R.scene, R.camera, R.renderer, R.hud);
    buildPool(R.THREE, R.scene);
    sparksBuild();          // specs/0020 §2b — dormant until an edge finds stone
    slBuild();
    R.ok = true;
    // specs/0006 — if main.js handed the ski rigs over first, build now
    if (FX_AURA_ON && A.rigs && !A.built) auraBuild();
  } catch { R.errors++; }
}

export function update(dt) {
  if (!R.ok) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    R.dt = dt;
    R.sprayLeft = SPRAY_FRAME;          // spray() budget, refilled once a frame
    const c = R.ctrl, u = R.u;
    const paused = !!(R.hud && R.hud.isPaused && R.hud.isPaused());

    // The landing edge, read BEFORE the emitters move R.prevGrounded on: the
    // snow burst and the speed-line burst are the same event and must not be
    // able to disagree about which frame it happened on.
    const landed = !!(c && c.grounded && !R.prevGrounded);
    const landVy = Math.max(0, -R.prevVy) / u;

    // emit (not while paused; each emitter gates on its own gear)
    if (c && !paused) { emitSki(dt); emitGlide(dt); }

    // specs/0057 §7 — the jib look, HERE and not below the pool integrator: its
    // spray goes into the same shared pool the ski emitters feed, and a particle
    // born after the integrate loop would sit at a stale position for one frame.
    // It also has to run in FRONT of `sparksWant`, which reads this frame's
    // `__rail` sample; the sampler owns both and the harness door calls the same
    // one, so there is exactly one order of operations for the whole of §7.
    fxJibSample(dt, paused);

    // specs/0059 §8 — the landing ring, HERE and beside §7 for the same reason:
    // its snow goes into the shared pool and a particle born after the integrate
    // loop would sit at a stale position for a frame. It owns its own grounded
    // and velocity history (`RG.pg`, `RG.pv*`), so it cannot race the emitters'.
    ringStep(dt, paused);

    // remember for edge detection (sample fall speed before landing zeroes it)
    if (c) {
      R.prevGrounded = c.grounded;
      R.prevVy = c.velocity ? c.velocity.y : 0;
    }

    // integrate the pool
    const g = 7.5 * u, dragK = Math.exp(-1.6 * dt);
    let alive = 0;
    for (let i = 0; i < POOL; i++) {
      let L = R.life[i];
      if (L <= 0) { R.aSize[i] = 0; R.aAlpha[i] = 0; continue; }
      L -= dt; R.life[i] = L;
      if (L <= 0) { R.aSize[i] = 0; R.aAlpha[i] = 0; continue; }
      alive++;
      R.vy[i] -= g * dt;
      R.vx[i] *= dragK; R.vy[i] *= dragK; R.vz[i] *= dragK;
      R.px[i] += R.vx[i] * dt; R.py[i] += R.vy[i] * dt; R.pz[i] += R.vz[i] * dt;
      const o = i * 3;
      R.aPos[o] = R.px[i]; R.aPos[o + 1] = R.py[i]; R.aPos[o + 2] = R.pz[i];
      const t = L / R.ttl[i];                              // 1 -> 0
      const fadeIn = Math.min(1, (R.ttl[i] - L) * 9);      // quick pop
      R.aSize[i] = R.sz[i] * (1 + 1.3 * (1 - t));          // puff expands as it flies
      R.aAlpha[i] = R.a0[i] * fadeIn * Math.pow(t, 1.15);  // fade out
    }
    // ...and specs/0020's sparks, which keep their own pool. Emit then step, the
    // order canopy.js's snow uses: a spark asked for on this frame is on the
    // screen on this frame. specs/0057 §7 moved that pair up into `fxJibSample`
    // above, unchanged and in the same order, so the jib's own emitters share
    // the one sample and the one ordering.
    // specs/0056 — the gear you lost, the snow on you, and the ice block. Same
    // place, and the same order the sparks used to sit in: it reads events off
    // `ctrl.snow` and emits into the pool that was just integrated, so a shard
    // asked for on this frame is on the screen on this frame.
    gearStep(dt, paused);

    R.alive = alive;
    R.pGeo.attributes.position.needsUpdate = true;
    R.pGeo.attributes.aSize.needsUpdate = true;
    R.pGeo.attributes.aAlpha.needsUpdate = true;

    // point-size scale from the real framebuffer height + fov
    if (R.renderer && R.camera) {
      const h = R.renderer.domElement ? R.renderer.domElement.height : 800;
      R.pMat.uniforms.uScale.value = h / (2 * Math.tan((R.camera.fov || 72) * Math.PI / 360));
    }

    // ---- speed lines. The wind reads off AIRSPEED on the glider — diving into
    // a headwind of your own making is the whole point, and horizontal speed
    // alone misses a vertical dive. While the rocket is lit the wing is stood
    // down and its airspeed readout is a frozen lie, so the field goes back to
    // the body's own speed — and starts earlier, because at boost speeds the
    // lines are the only cue that you are moving.
    const b = window.__playBoost;
    const boosting = !!(b && b.burning && b.burning());
    const inAir = !!(c && !c.grounded);
    S.boosting = boosting;
    let sMs = 0;
    if (c) {
      sMs = (c.mode === 'glider' && inAir && !boosting) ? (gliderState().airspeed || 0) / u : c.speed() / u;
    }

    // ---- the three punctuation events. Each is an EDGE, never a level, so a
    // held state cannot pin the field open.
    if (!paused) {
      if (landed) S.trickPoll = 4;
      if (landed && landVy > 2.0) slBurst(SL.BURST_LAND * clamp(landVy / 9, 0.35, 1.25));
      if (boosting && !S.prevBoost) slBurst(SL.BURST_BOOST);
      // trickState() builds an object and a board slice, so it is NOT read every
      // frame — a trick can only score on touchdown, so the counter is polled for
      // the few frames around a landing and ignored the rest of the time.
      if (S.trickPoll > 0) {
        S.trickPoll--;
        try {
          const ts = window.__player && window.__player.trickState();
          if (ts) {
            if (S.prevLanded >= 0 && ts.landed > S.prevLanded) slBurst(SL.BURST_TRICK);
            S.prevLanded = ts.landed;
          }
        } catch { /* a world with no trick machine */ }
      }
    }
    S.prevBoost = boosting;

    // ---- specs/0006. The aura poses itself HERE and not in updateVisuals,
    // because main.js calls this after it has bobbed, rolled, splayed and
    // tip-risen the ski rigs: the ribbon is a child of those rigs, so by now it
    // is already in the right place and only the uniforms are left to write.
    auraStep(dt, paused);

    slUpdate(dt, sMs, inAir, paused);

    // one sample per frame of everything the aura spent: the 3D step and the
    // coloured lines together, measured rather than asserted
    if (FX_AURA_ON) {
      A.cost[A.ci] = A.stepMs + A.lineMs;
      A.ci = (A.ci + 1) % A.cost.length;
      if (A.cn < A.cost.length) A.cn++;
    }
  } catch { R.errors++; }
}

// specs/0006 — THE ONE HOOK. main.js hands over the four ski rigs it already
// builds and poses (two on the camera, two on the third-person body) plus a
// getter for the equipped ski id. Read-only in both directions: this adds one
// child to each rig and never touches the rigs, the rack or the physics again.
// Safe to call before or after init(), once or never; a world with no skis in it
// simply never calls it and the aura never exists.
export function skis(ctx) {
  try {
    if (!FX_AURA_ON || A.built || !ctx || !Array.isArray(ctx.rigs)) return;
    A.rigs = ctx.rigs;
    A.skiId = typeof ctx.skiId === 'function' ? ctx.skiId : null;
    A.camMode = typeof ctx.camMode === 'function' ? ctx.camMode : null;
    if (R.ok) auraBuild();
  } catch { R.errors++; }
}

export function stats() {
  return { ok: R.ok, alive: R.alive, errors: R.errors, unit: R.u };
}

// The test handle, in the shape speedo.js and clean.js already use: a canvas
// cannot be interrogated any other way, and the gate has to be able to tell "the
// field is dormant at 6 m/s" apart from "the field is broken".
window.__speedlines = {
  el: () => S.cv,
  visible: () => !!S.shown,
  lines: () => S.live,
  intensity: () => +S.t.toFixed(3),
  // the FIELD's tiers, not the gauge's — a name a screenshot can be filed under.
  // They sit on the same speeds the speedo escalates at (15 / 20-28 / 28+ / 40).
  tier: () => (S.t <= 0 ? 'off' : S.t < 0.25 ? 'subtle' : S.t < 0.62 ? 'streaks' : S.t < 0.9 ? 'anime' : 'rush'),
  burst: () => +S.burst.toFixed(3),
  accel: () => +S.accel.toFixed(2),
  focus: () => ({ x: Math.round(S.focusX), y: Math.round(S.focusY) }),
  rush: () => +S.rush.toFixed(3),
  // specs/0047 §2 — the third ink: how many of the live streaks are the
  // outfit's, and how far slDraw is walking the fill table because of them
  outfit: () => ({ lines: S.olive, inks: S.inks, fill: SL_FILL[SL_BUCKETS * 3 - 1] }),
  // specs/0047 §A (0047a) — the field IS the suit now, so the reading a gate
  // needs is the census: which of the look's colours are on screen, and how many
  // streaks each one has. `n` 0 means the fallback table is still up.
  palette: () => ({
    n: SL_NP,
    hex: SL_PAL ? SL_PAL.map((c) => '#' + c.toString(16).padStart(6, '0')) : [],
    counts: Array.from(S.pc.slice(0, SL_NP)),
    fill: SLP_FILL.slice(),
  }),
  // specs/0019 — the FIELD's own answer, knob included, so a gate reading this
  // is reading the same boolean slUpdate branched on rather than a near-miss.
  suppressed: () => slHidden(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
  fire: (a) => { slBurst(a === undefined ? 1 : a); return S.burst; },
  tuning: SL,
  // measured, not asserted: the ring holds the last 240 frames of step+draw
  cost: () => ({ n: S.cn, p50: costPct(0.50), p95: costPct(0.95), max: costPct(0.999) }),
  costReset: () => { S.ci = 0; S.cn = 0; return true; },
};

// specs/0006 §3 — the aura's test handle, the same shape __speedlines has, for
// the same reason: a shader on a mesh and a polygon on a canvas can neither be
// interrogated any other way, and a gate has to be able to tell "there is no
// bank so there is no flame" apart from "the flame is broken".
//
// `force` and `fire` are TEST-ONLY WRITES and they are writes to the PICTURE,
// never to the physics: force() pins the aura's p where a headless run cannot
// carve a real bank up, and fire() paints a burst of a given size. Neither one
// can move vel, the bank, the charge or a payout by a millimetre — everything
// this module knows about the physics arrived through bankState(), which is a
// pure read. Passing null to force() hands the aura back to the real bank.
window.__aura = {
  enabled: () => FX_AURA_ON,
  built: () => A.built,
  meshes: () => A.meshes.length,
  visible: () => !!A.shown,
  p: () => +A.p.toFixed(3),
  e: () => +A.e.toFixed(3),
  burst: () => +A.burst.toFixed(3),
  drain: () => +A.drain.toFixed(3),
  // the EQUIPPED SKI's accent, untinted — specs/0047 changed what the flame is
  // painted with and deliberately did not change what this answers, so "the
  // reading stays the ski's fire" has a number behind it
  colour: () => '#' + A.colour.toString(16).padStart(6, '0'),
  // specs/0047 — the three the worn look lent (§1), and the three the flame is
  // actually wearing this frame (§2's charge → flare walk, live)
  outfit: () => (A.oc ? {
    primary: hexs(A.oc.primary), accent: hexs(A.oc.accent), glow: hexs(A.oc.glow),
    body: hexs(A.bodyNow), core: hexs(A.coreNow), trail: hexs(A.trailNow),
  } : null),
  ski: () => A.id,
  lines: () => A.live,
  // §2.3 — which presentation is live, and how long the trail is right now
  view: () => (A.camMode && A.camMode() === 'tp' ? 'tp' : 'fp'),
  trail: () => (A.trail && A.trail.visible
    ? +(A.trailMat.uniforms.uLen.value / R.u).toFixed(2) : 0),
  // the trail's own aim — the chord from the rider's heels to the oldest lit
  // station — so a test can assert it runs down the TRACK rather than down the
  // look; the two differ by tens of degrees in any real carve
  trailDir: () => (A.trail ? { x: +A.tdx.toFixed(3), y: +A.tdy.toFixed(3), z: +A.tdz.toFixed(3) } : null),
  // spec 0010 §1b — the path itself, in world metres, newest station first, so
  // a test can hold it against __player's own position history and against the
  // straight −v̂ line a carve is supposed to bend away from
  trailPath: () => {
    const n = A.trkUse || 0, o = [];
    for (let j = 0; j < n; j++) {
      o.push({ x: +A.trk[j * 3].toFixed(3), y: +A.trk[j * 3 + 1].toFixed(3), z: +A.trk[j * 3 + 2].toFixed(3) });
    }
    return o;
  },
  trailStations: () => A.trkUse,
  // spec 0010 §3 is measured in SCREEN pixels ("below the hip line", "35 % of
  // the frame height"), because that is what Greg is looking at, and nothing
  // outside this module hands a test the live camera. Read-only, and the
  // picture does not depend on it existing.
  project: (x, y, z) => {
    const c = R.camera, rn = R.renderer;
    if (!c || !rn) return null;
    const v = new R.THREE.Vector3(x, y, z);
    c.updateMatrixWorld();
    v.project(c);
    const s = rn.getSize(new R.THREE.Vector2());
    const e = c.position;
    // z > 1 means the point is BEHIND the lens and the x/y beside it are a
    // mirror, not a place — an 8 m trail on a 6 m chase runs past the camera,
    // so a caller that does not check this will measure ghosts.
    return { x: (v.x * 0.5 + 0.5) * s.x, y: (0.5 - v.y * 0.5) * s.y, z: v.z, w: s.x, h: s.y,
      cam: { x: e.x, y: e.y, z: e.z, fov: c.fov } };
  },
  // a name a screenshot can be filed under, on the tiers spec §2.1 describes
  tier: () => (A.p <= AU.ON_AT ? 'off' : A.p < 0.30 ? 'tips' : A.p < AU.FLARE_AT ? 'lit' : 'flare'),
  // specs/0019 — the AURA's own answer: `cleanPumpTracks`, not the line knob
  suppressed: () => auHidden(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
  force: (p) => { A.forced = (p == null ? null : clamp(+p || 0, 0, 1)); return A.forced; },
  fire: (e) => auraFire(e === undefined ? 1 : e),
  tuning: AU,
  cost: () => ({ n: A.cn, p50: auraCostPct(0.50), p95: auraCostPct(0.95), max: auraCostPct(0.999) }),
  costReset: () => { A.ci = 0; A.cn = 0; return true; },
};

// ---------------------------------------------------------------- sparks
// specs/0020 §2b, Greg on the bench 2026-09-02: "Skiing on top of a rock should
// not wipe out, it should throw some sparks though."
//
// This is the whole of what edge-on-stone now costs you, visually: the wipeout
// it used to be is gone (controller.js), the SPEED it costs you is ski.js's
// rock friction, and this is the tell that says why. A self-contained pool with
// its own Points object, deliberately NOT the shared snow pool above — sparks
// are additive and orange and rise off the tails, and folding two looks into one
// material would have cost a uniform switch per emitter.
//
// Lifecycle discipline is canopy.js's `snow()`: a packed array with a draw
// range, `visible` false and +0 draw calls whenever nothing is alive, and a
// swap-remove that keeps the pool packed so the range is always [0, live).
const SP = {
  // 2026-09-06 (D11 look pass): 160 → 320. A CEILING, not a draw call and not a
  // target — the pool is one `Points` object either way, and 0020's rock path
  // never came near the old number (RATE 90 × LIFE 0.30 ≈ 27 live). The rail
  // path now stamps a DASH per spark (JB.TRAIL) at ~3.7× the old rate and peaks
  // at **232 live** measured at 18 m/s over 600 frames, so 160 would clip the
  // shower at exactly the speed it is supposed to be densest. 320 clears that
  // peak by 1.4× and no further: a flush writes and re-uploads the WHOLE
  // attribute pair, so every slot above the peak is bandwidth nobody looks at.
  CAP: 320,             // pool ceiling; a hard ceiling, not a target
  V_MIN: 3.0,           // m/s — under this, edges are not striking anything
  V_FULL: 18.0,         // m/s — the rate and the throw are at full at this speed
  RATE: 90,             // particles/s at V_FULL (about 1.5 a frame at 60)
  LIFE: 0.30,           // s
  G: 11.0,              // m/s^2 — heavier than snow; a spark falls, it does not drift
  THROW: 3.2,           // m/s — how hard they are flung back along the track
  SPREAD: 1.4,          // m/s — lateral scatter
  SIZE: 0.085,          // PointsMaterial world size. three's attenuation is
                        // `size * (h/2) / d`, so on a 720-line canvas this is
                        // ~6 px at 5 m — the snowfall's number, in the units
                        // this material happens to want
  TAIL: 0.55,           // m behind the body the tails are taken to be
  GAP: 0.36,            // m between the two skis
};

const SK = {
  pts: null, geo: null, mat: null, posAttr: null, colAttr: null,
  px: null, py: null, pz: null, vx: null, vy: null, vz: null, age: null,
  // 2026-09-06 — PER-PARTICLE life, because the rail path now has two kinds in
  // one pool: brief bright streaks and the occasional long ember. `SP.LIFE` is
  // still 0020's number and is still what the rock path writes into `life`.
  life: null,
  // ...and the resolved hot colour, as three 0..1 channels. Cached rather than
  // recomputed per particle: `skiAccent()` is a map lookup behind a try, and the
  // flush touches every live point every frame.
  hr: 1, hg: 0.30, hb: 0, hotId: null,
  live: 0, acc: 0, bursts: 0, lifetime: 0, on: false, why: 'idle',
  // specs/0057 §7.4 — the measured budget, in the shape __aura.cost() already
  // uses: a ring of the last 600 frames of jib-fx step time, so the acceptance
  // number is a median that was TAKEN and not a number that was asserted.
  cost: new Float32Array(600), ci: 0, cn: 0, ms: 0,
};

// ---------------------------------------------------------------- specs/0057 §7
// THE JIB LOOK (D11): "cool spark effects and takeoff effect".
//
// Three things, and no fourth: STEEL throws sparks (rail, tube), PLASTIC AND
// SNOW throw spray (box, aframe), and popping off the end throws one burst. All
// of it rides pools that already exist — 0020's spark Points for the sparks,
// 0006's snow pool through `spray()` for the spray, and 0015/0033/0035/0054's
// impact-frame path for the burst. No new pool, no new material, no new draw
// call, and the outfit tint is 0047's accent in both places it appears.
//
// The C15 rule (§7.4) is STRUCTURAL and not a tuning: `railRead()` returns null
// whenever `window.__rail` is absent or `on()` is false, and every emitter here
// is behind that null. With no jib under the rider this whole section is one
// property read and a return — byte-for-byte the shipped behaviour, which is
// why the no-wipe lanes can only read 0.0000 %.
const JB = {
  // ---- D11's LOOK, 2026-09-06. Greg: the sparks were correct but read as "a
  // few faint white dots". Everything in this block is the RAIL/TUBE path only
  // — `sparksEmit` branches on `onRail`, so 0020's granite sparks and §7.2's
  // box/aframe spray are untouched to the byte.
  SPARK_RATE: 520,      // spark EVENTS/s at V_FULL on rail/tube (was 140 — 3.7×).
                        // 0020's rock path is SP.RATE 90 and does not move.
                        // Still multiplied by the same `t` ramp, so it is ∝ vt
                        // and a slow rail is still sparse: at 6 m/s t is 0.2 and
                        // this is 104 events/s, under the old full-speed rate.
  SIZE: 0.17,           // m — the PointsMaterial's world size WHILE ON A RAIL,
                        // 2× `SP.SIZE` 0.085. The pool has one material and one
                        // size for every point in it, but the rock shower and
                        // the rail shower are never both running: `sparksWant()`
                        // returns 'on rock' or 'on rail' and never both, so the
                        // size is set per surface at emit and put back for
                        // 0020's granite. The only window where the two overlap
                        // is the 0.3 s after leaving a rail onto snow, where the
                        // leftover rail sparks are already fading out.
  TRAIL: 4,             // points stamped per event, spaced along the spark's OWN
                        // velocity — a streak is one dash flying, not one dot.
                        // This is what buys a trail without a second draw call:
                        // three points of one Points object, not a line strip.
  TRAIL_F: 2.6,         // frames (at 60 Hz) of travel the dash spans, so the
                        // streak is the 2–4 frames D11 asks for and scales with
                        // speed for free — a faster spark draws a longer dash.
  SPARK_LIFE: 0.085,    // s — a streak is bright and brief (≈5 frames at 60 Hz)
  EMBER_P: 0.10,        // ...and one spark in ten is an EMBER instead
  EMBER_N: 4,           // points per ember, tightly jittered — the size above is
                        // per MATERIAL, so within one shower a bigger spark is
                        // still more points rather than a fatter one
  EMBER_JIT: 0.05,      // m — how tightly that cluster is packed
  DASH_W: 0.035,        // m — a little perpendicular jitter down the dash, so a
                        // streak has WIDTH and does not read as three dots in a
                        // perfectly straight line
  EMBER_LIFE: 0.42,     // s — it outlives the streaks and cools through the ramp
  EMBER_LIFT: 2.6,      // m/s of lift an ember gets that a streak does not, so it
                        // arcs up out of the shower and falls back through it
  THROW: 7.5,           // m/s back along −tangent (SP.THROW 3.2 is the rock path)
  SPREAD: 2.2,          // m/s lateral scatter across the line
  DOWN_MIN: -1.4,       // m/s vertical at birth. BACK AND DOWN (D11): steel
  DOWN_MAX: 0.7,        // struck by an edge sprays down off the bar and only
                        // then arcs; the rock path throws up and is left alone.
  HOT: 0xff4d00,        // the orange the ramp passes through
  HOT_TINT: 0.35,       // ...of the SKI ACCENT, mixed into it. fx/palette's rule
                        // is that this family takes `skiAccent(id)` and not the
                        // outfit and not white, so a red ski throws red-orange
                        // and a cold ski throws a cooler ember — but every one
                        // of them is still hot, because HOT dominates the mix.
  CORE: 0.22,           // fraction of life spent WHITE-hot before the colour
                        // lands on HOT and then falls away to dark
  SPRAY_RATE: 90,       // particles/s at V_FULL on box/aframe, through spray()
  SPRAY_SIZE: 0.06,     // m — the base chunk radius handed to spray()
  SPRAY_TINT: 0.30,     // ...of 0047's outfit accent, mixed into the snow's own
                        // white while a box is under the skis (and only then)
  TINT_EASE: 0.15,      // s — the tint fades in and out rather than popping
  EDGE: 0.09,           // m — half the gap between the two edge contact points
  ENTRY_N: 12,          // §7.3 entry burst, scaled by impact / LAND_HARD
  LAND_HARD: 12.0,      // rider.js:1800's tier — the last reader of impact here
  TAKEOFF_N: 24,        // §7.3 takeoff burst lines, radial from the boots
  CHARGE_MAX: 10.0,     // RAIL_CHARGE_MAX (§3.2) — what the burst is scaled by
  POP_VY: 1.5,          // m/s of lift on the exit frame that reads as a POP
                        // rather than as running off the end of the line
};

// Live jib state, sampled once a frame from R1's `window.__rail`.
const JS = {
  on: false, id: null, type: null, charge: 0, yaw: 0,
  // specs/0057 §7.1, fixed 2026-09-06 — the ALONG-RAIL speed in m/s, taken from
  // `__rail.state().vt` once a frame in railFxStep(). `null` means the rail
  // module in the page does not publish it (a park built before 2026-09-06, or
  // a world with no park at all), and the source falls back to `ctrl.speed()`.
  vt: null,
  prevOn: false, prevVy: 0, tint: 0, tintBase: 0xf5faff, accSpray: 0,
  entries: 0, takeoffs: 0, sprays: 0, why: 'no rail',
  // specs/0047 §2's accent, captured where `slOutfitInk` already captures it —
  // ONE read of the worn look, on the frame the look changes, not per particle.
  // `tintBase` is `buildPool`'s own `uColor` (0.96, 0.98, 1.0) as a hex, so the
  // mix always starts from the snow's shipped white and returns to it exactly.
  ink: 0xffffff, inkLit: 0xffffff,
};

// specs/0057 §7.2 — the accent AT SNOW'S BRIGHTNESS. 0047's accent is an INK: it
// is painted on a dark speed-line canvas at alpha, and the default kit's is
// (23, 22, 26), a near-black. Mixed straight into the snow's white at 0.30 that
// turns a rooster tail into a puff of soot — the outfit was legible and the
// SNOW was not, which is backwards. So the hue is taken and the value is not:
// the accent's channels are scaled until its peak channel is full, giving the
// same colour at snow's brightness, and THAT is what the mix uses. A red kit
// throws pink snow; a black kit throws white snow with a cool cast, which is
// what a black kit's accent actually looks like when it catches light.
function litHex(hex) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const pk = Math.max(r, g, b);
  if (pk < 8) return 0xffffff;                 // a true black has no hue to carry
  const k = 255 / pk;
  return ((Math.min(255, r * k) | 0) << 16) | ((Math.min(255, g * k) | 0) << 8) | (Math.min(255, b * k) | 0);
}

// specs/0057 §7 — the ONLY door into R1's module, and it is read-only: `on()`
// and `state()`, the two signatures §9 pinned before either brief started.
// Everything defensive, because F1 ships before R1 lands and a world with no
// park in it (or a rail.js that has not been imported yet) must cost nothing.
function railRead() {
  const rl = window.__rail;
  if (!rl || typeof rl.on !== 'function') { JS.why = 'no rail'; return null; }
  let on = false;
  try { on = !!rl.on(); } catch { on = false; }
  if (!on) { JS.why = 'off'; return null; }
  let st = null;
  try { st = typeof rl.state === 'function' ? rl.state() : null; } catch { st = null; }
  if (!st) { JS.why = 'no state'; return null; }
  const type = st.type || 'rail';
  JS.why = `on ${type}`;
  return st;
}

function sparksBuild() {
  const THREE = R.THREE;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(SP.CAP * 3);
  const col = new Float32Array(SP.CAP * 4);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    size: SP.SIZE * R.u,
    // the snow pool's sprite, not a second copy of the same 32x32 disc
    map: (R.pMat && R.pMat.uniforms && R.pMat.uniforms.uMap) ? R.pMat.uniforms.uMap.value : makeSprite(THREE),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;      // the emitter is always at the camera
  pts.renderOrder = 6;
  pts.visible = false;
  pts.name = 'fx:sparks';
  R.scene.add(pts);
  SK.pts = pts; SK.geo = g; SK.mat = mat;
  SK.posAttr = g.attributes.position; SK.colAttr = g.attributes.color;
  SK.px = new Float32Array(SP.CAP); SK.py = new Float32Array(SP.CAP); SK.pz = new Float32Array(SP.CAP);
  SK.vx = new Float32Array(SP.CAP); SK.vy = new Float32Array(SP.CAP); SK.vz = new Float32Array(SP.CAP);
  SK.age = new Float32Array(SP.CAP);
  SK.life = new Float32Array(SP.CAP);
  SK.life.fill(SP.LIFE);               // 0020's life is the default for every slot
}

// specs/0057 §7.1 look pass, 2026-09-06 — THE HOT COLOUR, resolved once per ski.
//
// fx/palette's rule for this family is `skiAccent(id)`: the EQUIPPED SKI's
// accent, not the worn outfit's and not white. `litHex` lifts it to snow
// brightness the way §7.2's spray tint already does, and `JB.HOT_TINT` 0.35 of
// that is mixed into `JB.HOT` #ff4d00 — HOT dominates, so every ski throws a
// hot spark and the accent only says which hot. Cached on the ski id because
// the flush reads it for every live point on every frame.
// The id comes off `A.skiId`, which is the hook main.js hands `skis()` and the
// same one `ringAccent()` and `auraDress()` read — one source for the whole ski
// palette, so a spark cannot disagree with the aura about which ski is on.
// Resolved on EVERY emit frame rather than cached against the id, because
// `A.skiId()` is the equipped ski's id and `getSkiModel()` is what turns that
// into a model — swapping the model under a fixed id (which `setSkiModel` does)
// would leave an id-keyed cache painting the old ski's sparks. This is one Map
// get and one mix, once a frame, not once a particle; the flush reads the three
// channels off `SK` and never asks again.
function sparkHot() {
  let id = null;
  try { id = A.skiId ? A.skiId() : null; } catch { id = null; }
  SK.hotId = id;
  let hex = JB.HOT;
  try { if (id) hex = mixHex(JB.HOT, litHex(skiAccent(id)), JB.HOT_TINT); } catch { hex = JB.HOT; }
  SK.hr = ((hex >> 16) & 255) / 255;
  SK.hg = ((hex >> 8) & 255) / 255;
  SK.hb = (hex & 255) / 255;
}

// Is there stone under the edges right now, and how hard are they on it?
// `groundClass()` is the controller's captured value (specs/0020) — the class
// under THIS step's ground probe, not whatever ray happened to run last.
function sparksWant() {
  const c = R.ctrl;
  if (!c) { SK.why = 'no ctrl'; return 0; }
  // specs/0057 §7.1 — THE SECOND SOURCE, and it is ahead of the `groundClass`
  // return because a rail is not a ground class: the jib is a collider you are
  // HELD to (§2.4), and 0020's stone probe has no opinion about steel. It is
  // also ahead of the grounded/boots tests, because a jib entered out of the air
  // (§2.3's hard-fall save onto the A-frame) is throwing sparks on the frame it
  // locks on, before the controller has called the rider grounded again.
  // `JS.on` is this frame's sample, taken once in railFxStep().
  if (JS.on && !(c.wipeT > 0)) {
    if (JS.type !== 'rail' && JS.type !== 'tube') { SK.why = 'jib: spray'; return 0; }
    // specs/0057 §7.1, FIXED 2026-09-06 (GATE-0057 §6 item 4). This read used to
    // be `ctrl.speed() / R.u` and that is the wrong number on a jib, for a
    // reason that is structural and not a tuning miss: `ctrl.speed()` is
    // `hypot(vel.x, vel.z)` AFTER rail.js's hold has projected the velocity onto
    // the line (rail.js:374 `vel = tangent * vt`), so it is a POST-projection
    // horizontal component, not the ride's speed. It loses the whole vertical
    // share of a pitched line, and on a held jib it can sit under `V_MIN` 3.0
    // while the rider is visibly grinding — which is why D11's sparks were dead
    // on rails and alive on boxes (the box path never asks).
    //
    // `railState().vt` is the ride's own along-line speed, in m/s, and is the
    // number rail.js integrates `s` with. `V_MIN` DOES NOT MOVE — it is 0020's
    // "edges are not striking anything below this" and it is still true; what
    // changed is that the gate is now asked about the right velocity.
    const vj = JS.vt != null ? Math.abs(JS.vt) : (c.speed ? c.speed() : 0) / R.u;
    if (vj < SP.V_MIN) { SK.why = 'jib: too slow'; return 0; }
    SK.why = 'on rail';
    return clamp((vj - SP.V_MIN) / (SP.V_FULL - SP.V_MIN), 0, 1);
  }
  if (!c.grounded) { SK.why = 'airborne'; return 0; }
  if (c.wipeT > 0) { SK.why = 'wiping'; return 0; }
  // boots do not have edges. Every ride gear does.
  if (c.mode === 'boots') { SK.why = 'on foot'; return 0; }
  let cls = 0;
  try { cls = c.groundClass ? c.groundClass() : 0; } catch { cls = 0; }
  if (cls !== 1) { SK.why = 'on snow'; return 0; }
  const sp = c.speed ? c.speed() : 0;
  const v = sp / R.u;                          // metres per second, whatever the scene's unit
  if (v < SP.V_MIN) { SK.why = 'too slow'; return 0; }
  SK.why = 'on rock';
  return clamp((v - SP.V_MIN) / (SP.V_FULL - SP.V_MIN), 0, 1);
}

function sparksEmit(dt, paused) {
  if (!SK.pts) return;
  // the same suppression the speed lines answer to, and for the same reason:
  // clean-frame is being filmed, the locker is a menu, dev fly is not play.
  if (slSuppressed(paused)) { SK.on = false; SK.why = 'suppressed'; SK.acc = 0; return; }
  const t = sparksWant();
  SK.on = t > 0;
  if (!SK.on) { SK.acc = 0; return; }
  const c = R.ctrl, u = R.u;
  // specs/0057 §7.1 — one rate constant, picked by which surface is under the
  // edges. `SP.RATE` 90 is 0020's granite; steel is `JB.SPARK_RATE` 140. The
  // pool ceiling, life, gravity, throw and colour ramp are all 0020's, untouched
  // — a rail spark falls like a rock spark, there are simply more of them.
  const onRail = SK.why === 'on rail';
  if (onRail) sparkHot();                      // one map lookup, only on a rail
  // ...and the point size, per surface. A plain property write on the existing
  // material — no recompile, no new material, no second draw call — guarded by
  // the compare so a frame that changes nothing dirties nothing.
  const want = (onRail ? JB.SIZE : SP.SIZE) * R.u;
  if (SK.mat && SK.mat.size !== want) SK.mat.size = want;
  SK.acc += (onRail ? JB.SPARK_RATE : SP.RATE) * t * dt;
  let n = Math.floor(SK.acc);
  if (n <= 0) return;
  SK.acc -= n;
  // one frame cannot own the pool. The rail path emits ~4.3 events a frame at
  // full speed against the rock path's ~1.2, so its ceiling is its own.
  const nMax = onRail ? 24 : 12;
  if (n > nMax) n = nMax;
  const p = c.position, v = c.velocity;
  const sp = Math.hypot(v.x, v.z) || 1;
  const fx = v.x / sp, fz = v.z / sp;          // travel direction
  const rx = -fz, rz = fx;                     // ...and across it
  // ---- specs/0057 §7.1 look pass, 2026-09-06 — THE RAIL SHOWER.
  //
  // Every spark is STAMPED AS A DASH: `JB.TRAIL` points spaced along the
  // spark's own velocity, spanning `JB.TRAIL_F` frames of its travel. They
  // share a velocity, so the dash stays a dash while it flies and reads as the
  // 2–4 frame streak D11 asks for — and it is three points of the one Points
  // object this section has always drawn, so the draw count does not move. A
  // faster spark draws a longer dash for free, which is the whole reason the
  // streak is written in frames of travel rather than in metres.
  //
  // One in `JB.EMBER_P` is an EMBER instead: slower, lifted, `EMBER_LIFE` long,
  // and stamped as a jittered cluster because the pool's material has ONE size
  // for every point — a bigger spark has to be more points, not a fatter one.
  if (onRail) {
    for (let k = 0; k < n; k++) {
      const ember = Math.random() < JB.EMBER_P;
      const pts = ember ? JB.EMBER_N : JB.TRAIL;
      if (SK.live + pts > SP.CAP) break;
      // the two edge contact points, ±JB.EDGE either side of the line
      const side = (k % 2 ? 1 : -1) * JB.EDGE * u;
      const ox = p.x - fx * 0.06 * u + rx * side;
      const oy = p.y + 0.02 * u;
      const oz = p.z - fz * 0.06 * u + rz * side;
      // BACK AND DOWN, with a little spread across the line
      const back = JB.THROW * (0.4 + 0.8 * t) * (ember ? 0.45 : 1) * rand(0.7, 1.25) * u;
      const sprd = JB.SPREAD * (ember ? 0.6 : 1) * u;
      const wx = -fx * back + rx * rand(-sprd, sprd);
      const wz = -fz * back + rz * rand(-sprd, sprd);
      const wy = (ember ? rand(0.4, 1.0) * JB.EMBER_LIFT : rand(JB.DOWN_MIN, JB.DOWN_MAX)) * u;
      const life = ember ? JB.EMBER_LIFE * rand(0.8, 1.2) : JB.SPARK_LIFE * rand(0.75, 1.25);
      // the dash: point j sits j/TRAIL of `TRAIL_F` frames BEHIND the head, and
      // is aged by the same fraction of the life so the tail is already dimmer
      const span = JB.TRAIL_F / 60;
      const jit = (ember ? JB.EMBER_JIT : JB.DASH_W) * u;
      for (let j = 0; j < pts; j++) {
        const i = SK.live++;
        const b = ember ? 0 : (j / pts) * span;
        SK.px[i] = ox - wx * b + rand(-jit, jit);
        SK.py[i] = oy - wy * b + rand(-jit, jit);
        SK.pz[i] = oz - wz * b + rand(-jit, jit);
        SK.vx[i] = wx; SK.vy[i] = wy; SK.vz[i] = wz;
        SK.life[i] = life;
        SK.age[i] = ember ? 0 : life * (j / pts) * 0.55;
        SK.lifetime++;
      }
    }
    SK.bursts++;
    // NO FLUSH HERE. `fxJibSample` is the only path into this file's §7 work and
    // it runs `sparksEmit` then `sparksStep`, and `sparksStep` flushes on its way
    // out — so a flush here writes every live particle into the attribute arrays
    // and re-uploads both buffers, microseconds before the step does it again
    // with the same particles one integration later. Dropping it halves the
    // per-frame upload, which is the whole of what this section costs once the
    // pool is carrying a few hundred points.
    return;
  }
  for (let k = 0; k < n; k++) {
    if (SK.live >= SP.CAP) break;
    const i = SK.live++;
    // ---- 0020's ROCK PATH, and nothing else reaches here any more: the rail
    // shower returns above. Every number below is 0020's, unchanged — the
    // tails 0.55 m behind the body, the 0.36 m ski gap, THROW 3.2, the upward
    // lift, and `SP.LIFE`. It is written into `life` explicitly because
    // `sparksStep`'s swap-remove can move a rail ember's life into this slot.
    const side = (k % 2 ? 1 : -1) * SP.GAP * 0.5 * u;
    SK.px[i] = p.x - fx * SP.TAIL * u + rx * side;
    SK.py[i] = p.y + 0.04 * u;
    SK.pz[i] = p.z - fz * SP.TAIL * u + rz * side;
    // flung BACK along the track, with a little lift and scatter: an edge
    // throws its sparks behind it, which is what makes the direction readable
    const back = SP.THROW * (0.5 + t) * u;
    SK.vx[i] = -fx * back * rand(0.6, 1.2) + rx * rand(-SP.SPREAD, SP.SPREAD) * u;
    SK.vy[i] = rand(0.6, 2.4) * u;
    SK.vz[i] = -fz * back * rand(0.6, 1.2) + rz * rand(-SP.SPREAD, SP.SPREAD) * u;
    SK.age[i] = 0;
    SK.life[i] = SP.LIFE;
    SK.lifetime++;
  }
  SK.bursts++;
  sparksFlush();
}

function sparksFlush() {
  const pa = SK.posAttr.array, ca = SK.colAttr.array;
  const n = SK.live;
  for (let i = 0; i < n; i++) {
    const o = i * 3, q = i * 4;
    pa[o] = SK.px[i]; pa[o + 1] = SK.py[i]; pa[o + 2] = SK.pz[i];
    // ---- THE RAMP, 2026-09-06: WHITE CORE → HOT → DARK.
    //
    // `JB.CORE` of the life is spent white-hot, which is the bit that reads as
    // a struck spark rather than a coloured dot; the colour then lands on
    // `SK.hr/hg/hb` — #ff4d00 carrying `JB.HOT_TINT` of the SKI ACCENT — and
    // falls from there to black while the alpha closes. Additive blending
    // cannot paint darker than the snow behind it, so "dark" is the colour
    // going to zero and the alpha with it: the spark stops adding light, which
    // over white snow is exactly what going out looks like.
    //
    // 0020's rock sparks ride the same ramp, and they should: (1, 0.92, 0.72)
    // fading to (1, 0.37, 0.06) was already a white-to-orange cool, and this
    // is the same read with a hotter middle and a proper end.
    const f = SK.age[i] / (SK.life[i] || SP.LIFE);
    const w = f < JB.CORE ? 1 - f / JB.CORE : 0;          // white-hot weight
    const h = f < JB.CORE ? 1 : Math.max(0, 1 - (f - JB.CORE) / (1 - JB.CORE));
    const s = 1 - w;
    ca[q] = w + s * SK.hr * h;
    ca[q + 1] = w + s * SK.hg * h;
    ca[q + 2] = w + s * SK.hb * h;
    ca[q + 3] = Math.max(0, 1 - f * f);
  }
  SK.geo.setDrawRange(0, n);
  SK.posAttr.needsUpdate = true;
  SK.colAttr.needsUpdate = true;
  SK.pts.visible = n > 0;
}

function sparksStep(dt) {
  if (!SK.pts || !SK.live) return;             // nothing alive: not one instruction
  const g = SP.G * R.u;
  let n = SK.live;
  for (let i = 0; i < n; i++) {
    SK.age[i] += dt;
    if (SK.age[i] >= (SK.life[i] || SP.LIFE)) {
      const j = --n;                           // swap-remove keeps the pool packed
      if (j !== i) {
        SK.px[i] = SK.px[j]; SK.py[i] = SK.py[j]; SK.pz[i] = SK.pz[j];
        SK.vx[i] = SK.vx[j]; SK.vy[i] = SK.vy[j]; SK.vz[i] = SK.vz[j];
        SK.age[i] = SK.age[j]; SK.life[i] = SK.life[j];
      }
      i--;
      continue;
    }
    SK.vy[i] -= g * dt;
    SK.px[i] += SK.vx[i] * dt;
    SK.py[i] += SK.vy[i] * dt;
    SK.pz[i] += SK.vz[i] * dt;
  }
  SK.live = n;
  sparksFlush();
}

// ---- specs/0057 §7.2 — SPRAY, for the surfaces that are not steel.
//
// A box deck is UHMW plastic over ply and an A-frame is bare ply, and neither
// throws a spark: what comes off them is the snow the deck is carrying and a
// little of the plastic. So the same speed norm drives 0006's snow pool through
// its existing public `spray()` hook — no new pool, no new emitter, and the
// per-frame `R.sprayLeft` budget a hockey stop already answers to still caps it.
function jibSpray(dt) {
  const c = R.ctrl, u = R.u;
  if (!c || !c.position || !c.velocity) return 0;
  const v = c.velocity;
  const sp = Math.hypot(v.x, v.z);
  const vms = sp / u;
  const t = clamp((vms - SP.V_MIN) / (SP.V_FULL - SP.V_MIN), 0, 1);
  if (t <= 0) return 0;
  const fx = v.x / (sp || 1), fz = v.z / (sp || 1);
  const p = c.position;
  // thrown BACK along the tangent with a little lift, the direction an edge
  // scrubbing a deck actually throws — the same read the carve roost gives
  const push = (1.2 + 2.6 * t) * u;
  JB_ORG.x = p.x - fx * 0.10 * u;
  JB_ORG.y = p.y + 0.03 * u;
  JB_ORG.z = p.z - fz * 0.10 * u;
  JB_DIR.x = -fx * push; JB_DIR.y = 1.5 * u * (0.5 + t); JB_DIR.z = -fz * push;
  spray(JB_ORG, JB_DIR, JB.SPRAY_RATE * t, JB.SPRAY_SIZE);
  JS.sprays++;
  return t;
}
const JB_ORG = { x: 0, y: 0, z: 0 };   // specs/0057 §7.2 — reused, never allocated
const JB_DIR = { x: 0, y: 0, z: 0 };   // ...in a per-frame emitter

// ---- specs/0057 §7.3 — THE ENTRY BURST. Twelve particles, one frame, scaled by
// the impact that would otherwise have put you down (§2.3's hard-fall save is
// the loudest version of this). It is the LAST reader of landing impact on a
// jib: the tiers fire no clip and no burst of their own once R1 has locked on.
function jibEntryBurst(impact) {
  const c = R.ctrl, u = R.u;
  if (!c || !c.position) return;
  const k = clamp(impact / JB.LAND_HARD, 0, 1);
  const p = c.position, v = c.velocity || { x: 0, z: 0 };
  const sp = Math.hypot(v.x, v.z) || 1;
  const fx = v.x / sp, fz = v.z / sp;
  const steel = JS.type === 'rail' || JS.type === 'tube';
  for (let i = 0; i < JB.ENTRY_N; i++) {
    const side = (i % 2 ? 1 : -1) * JB.EDGE * u;
    const rx = -fz, rz = fx;
    if (steel) {
      if (SK.live >= SP.CAP) break;
      const j = SK.live++;
      SK.px[j] = p.x + rx * side; SK.py[j] = p.y + 0.02 * u; SK.pz[j] = p.z + rz * side;
      const back = SP.THROW * (0.8 + 1.4 * k) * u;
      SK.vx[j] = -fx * back * rand(0.5, 1.4) + rx * rand(-SP.SPREAD, SP.SPREAD) * u;
      SK.vy[j] = rand(0.8, 3.2) * (0.6 + k) * u;
      SK.vz[j] = -fz * back * rand(0.5, 1.4) + rz * rand(-SP.SPREAD, SP.SPREAD) * u;
      SK.age[j] = 0; SK.lifetime++;
    } else {
      const a = Math.random() * Math.PI * 2;
      const rr = rand(0.6, 2.6) * u * (0.5 + k);
      emit(
        p.x + rx * side + Math.cos(a) * 0.12 * u, p.y + rand(0.02, 0.20) * u, p.z + rz * side + Math.sin(a) * 0.12 * u,
        Math.cos(a) * rr - fx * sp * 0.25, rand(1.2, 3.4) * u * (0.6 + k), Math.sin(a) * rr - fz * sp * 0.25,
        rand(0.5, 0.9), rand(0.06, 0.16) * u, rand(0.45, 0.90),
      );
    }
  }
  if (steel) sparksFlush();
  JS.entries++;
}

// ---- specs/0057 §7 — ONE STEP, and it is the only thing this section adds to
// the frame. It runs BEFORE `sparksEmit` so `JS.on` is this frame's sample and
// not last frame's, and every branch inside it is behind `railRead()` returning
// non-null (§7.4 rule 1): with no jib under the rider the whole call is a
// property read, a `typeof`, and a return.
function railFxStep(dt, paused) {
  // `__sparks.step()` is reachable before `init()` — 0020 built that door to be
  // callable from a paused page — and `jibEntryBurst` writes into pool arrays
  // that `sparksBuild()` allocates. One guard, the same one `update()` opens with.
  if (!R.ok || !SK.pts) { JS.on = false; JS.why = 'no fx'; return; }
  const c = R.ctrl;
  const st = railRead();
  // `on` is the RIDE and `vis` is whether it may be seen. They are two facts and
  // the edges below read the first: a clean frame (0019's H) or the locker
  // opening mid-slide must not be able to fake a pop off the end of the rail.
  const on = !!st;
  const quiet = slSuppressed(paused);
  const vis = on && !quiet;
  const vis0 = !quiet;           // ...and the same answer on the frame it ENDS
  JS.on = on;
  if (st) {
    JS.type = st.type || 'rail';
    JS.id = st.jib != null ? st.jib : JS.id;
    if (typeof st.charge === 'number') JS.charge = st.charge;
    if (typeof st.yaw === 'number') JS.yaw = st.yaw;
    JS.vt = typeof st.vt === 'number' ? st.vt : null;
  } else JS.vt = null;

  // ---- the two EDGES, read before anything emits so the burst and the ride
  // cannot disagree about which frame the lock-on happened on (0015's rule).
  if (on && !JS.prevOn) {
    if (vis) jibEntryBurst(Math.max(0, -JS.prevVy) / R.u);
  } else if (!on && JS.prevOn) {
    // §3.4 gives a jib exactly two exits and only one of them is a takeoff: you
    // POP, or you run off the end. R1's state is gone by this frame, so the tell
    // is the body itself — RISING is a pop, everything else is the end of the
    // line, which §3.4 says gets no bonus and no burst. `grounded` is
    // deliberately NOT in the test: ski.js writes the pop velocity before the
    // controller has decided the body has left the surface, so a grounded test
    // would eat the burst on the frame it belongs to. `POP_VY` 1.5 m/s sits well
    // under T.jump 4.5 and well over the metre-a-second a downhill rail's last
    // tangent can leave behind. (If R1 later names the exit, read that instead.)
    const vy = c && c.velocity ? c.velocity.y : 0;
    if (vis0 && c && vy > JB.POP_VY * R.u) {
      imFireTakeoff(clamp(JS.charge / JB.CHARGE_MAX, 0, 1));
    }
    JS.charge = 0;
  }
  JS.prevOn = on;
  if (c && c.velocity) JS.prevVy = c.velocity.y;

  // ---- the ride itself: spray on plastic and snow, and the outfit tint that
  // goes with it. Sparks are `sparksWant`'s job, two calls down.
  const plastic = vis && (JS.type === 'box' || JS.type === 'aframe');
  if (plastic) jibSpray(dt);

  // §7.2's tint. 0006's snow is ONE material with ONE `uColor`, so the accent is
  // eased into and out of that uniform rather than carried per particle — which
  // is what "no new material" costs and buys. It is a uniform write on the
  // frames a box is under the skis and on the 0.15 s either side of them, and
  // the guard below means it is not even a branch on any other frame.
  const want = plastic ? 1 : 0;
  if (JS.tint > 0 || want > 0) {
    const k = clamp(dt / JB.TINT_EASE, 0, 1);
    JS.tint += (want - JS.tint) * k;
    if (JS.tint < 0.002 && want === 0) JS.tint = 0;
    if (R.pMat && R.pMat.uniforms && R.pMat.uniforms.uColor) {
      R.pMat.uniforms.uColor.value.setHex(mixHex(JS.tintBase, JS.inkLit, JB.SPRAY_TINT * JS.tint));
    }
  }
}

// ---- specs/0057 §7.3 — THE TAKEOFF BURST, through the impact frame's own path.
//
// D11 asks for "a takeoff effect" on popping off the end of a jib, on the canvas
// the ski flame and the impact frame already share. This is that frame's pool,
// that frame's lay, that frame's draw loop and that frame's clock — 24 lines
// instead of 49-104, travelling OUT instead of in, in 0047's outfit accent
// instead of 0054's damage red, and with NO flash rect at all: a pop is not a
// hit and must not borrow the language of one. `k` is `railComp / 10.0`, so a
// pop off a cold rail is a whisper and a pop off 2.5 s of charge is the picture.
function imFireTakeoff(k) {
  const kk = clamp(+k || 0, 0, 1);
  const n = JB.TAKEOFF_N;
  const wide = IM.WIDTH * clamp(Math.min(S.w || 1280, S.h || 720) / IM.WIDTH_REF, 0.7, 1.4);
  // the same largest-remainder quota `imFire` uses, at the same three slots — the
  // third one is the outfit accent here, and it carries the burst.
  const frac = [1 - IM.INK_FRAC - JB_OUT_FRAC, IM.INK_FRAC, JB_OUT_FRAC];
  const off = [Math.random(), Math.random(), Math.random()];
  const got = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = ((i + rand(0.15, 0.85)) / n) * Math.PI * 2;
    IMS.ca[i] = Math.cos(a); IMS.sa[i] = Math.sin(a);
    IMS.d[i] = Math.random() * IM.STAGGER;
    IMS.ln[i] = IM.LEN * rand(0.55, 1.35);
    IMS.wd[i] = wide * rand(0.45, 1.30);
    let ink = 0, bestD = -Infinity;
    for (let j = 0; j < 3; j++) {
      const d = frac[j] * (i + 1) + off[j] - got[j];
      if (d > bestD) { bestD = d; ink = j; }
    }
    got[ink]++;
    IMS.ik[i] = ink;
    IMS.a0[i] = IM.ALPHA * (0.45 + 0.55 * kk) * rand(0.60, 1.20);
  }
  IMS.lines = n;
  IMS.inkN = got;
  IMS.out = true; IMS.ink3 = 'outfit';
  IMS.k = kk;
  IMS.speed = +(kk * JB.CHARGE_MAX).toFixed(2);
  IMS.why = 'jib-pop';
  IMS.flash = false; IMS.flashA0 = 0; IMS.flashA = 0;
  IMS.t = 0; IMS.live = true; IMS.n++;
  JS.takeoffs++;
  IMS.last = { why: IMS.why, speed: IMS.speed, lines: n, flash: false,
               ink: { white: got[0], slate: got[1], red: 0, outfit: got[2] } };
  return IMS.last;
}
const JB_OUT_FRAC = 0.55;   // specs/0057 §7.3 — the outfit's share of a takeoff
                            // burst. 0054's red is 0.35 of a wipe because damage
                            // is an accent on a white frame; this is the frame.

// The test handle, the shape __speedlines and __aura already use.
window.__sparks = {
  count: () => SK.live,
  state: () => ({
    live: SK.live, on: SK.on, why: SK.why,
    lifetime: SK.lifetime, bursts: SK.bursts,
    // 2026-09-06 look pass — the resolved hot colour and the ski it came from,
    // so a gate can assert the accent rule instead of eyeballing a screenshot.
    hot: '#' + (((SK.hr * 255) | 0) << 16 | ((SK.hg * 255) | 0) << 8 | ((SK.hb * 255) | 0)).toString(16).padStart(6, '0'),
    hotSki: SK.hotId, cap: SP.CAP,
    draws: SK.pts && SK.pts.visible ? 1 : 0,
    built: !!SK.pts,
    suppressed: slSuppressed(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
    groundClass: (() => { try { return R.ctrl && R.ctrl.groundClass ? R.ctrl.groundClass() : null; } catch { return null; } })(),
    speed: (() => { try { return R.ctrl ? +(R.ctrl.speed() / R.u).toFixed(3) : null; } catch { return null; } })(),
  }),
  // specs/0057 §7 — what the jib look is doing, as ONE reading. `on` is R1's
  // answer and nothing else: with no `window.__rail` in the page this is false,
  // every counter is 0 and every emitter above is unreachable, which is §7.4's
  // structural argument for the C15 lanes stated as something a gate can read.
  jib: () => ({
    on: JS.on, type: JS.type, id: JS.id, why: JS.why,
    // 2026-09-06 — the along-rail speed the spark source actually gated on this
    // frame, beside `state().speed` (which is still `ctrl.speed()`), so a gate
    // can print both and see the gap that killed D11's sparks.
    vt: JS.vt == null ? null : +JS.vt.toFixed(3),
    medium: !JS.on ? null : (JS.type === 'rail' || JS.type === 'tube' ? 'sparks' : 'spray'),
    charge: +JS.charge.toFixed(3), tint: +JS.tint.toFixed(4),
    ink: '#' + (JS.ink >>> 0).toString(16).padStart(6, '0'),
    inkLit: '#' + (JS.inkLit >>> 0).toString(16).padStart(6, '0'),
    entries: JS.entries, takeoffs: JS.takeoffs, sprays: JS.sprays,
    railed: !!(window.__rail && typeof window.__rail.on === 'function'),
  }),
  tuning: SP,
  jibTuning: JB,           // specs/0057 §7 — the constants, where 0020's already are
  // specs/0057 §7.4 — THE MEASURED BUDGET, the shape `__aura.cost()` uses. One
  // sample per driven frame of everything §7 costs: the jib step, the spark emit
  // and the spark integrate together. `p50` is the acceptance's median.
  cost: () => {
    const n = SK.cn;
    if (!n) return { n: 0, p50: 0, p95: 0, max: 0 };
    const a = Array.prototype.slice.call(SK.cost, 0, n).sort((x, y) => x - y);
    const at = (q) => +a[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))].toFixed(4);
    return { n, p50: at(0.50), p95: at(0.95), max: at(0.999) };
  },
  costReset: () => { SK.ci = 0; SK.cn = 0; return true; },
  reset: () => {
    SK.live = 0; SK.acc = 0; SK.lifetime = 0; SK.bursts = 0;
    // specs/0057 §7 — the jib counters reset with the pool they feed, so a probe
    // that resets between two lanes does not read the first lane's bursts.
    JS.entries = 0; JS.takeoffs = 0; JS.sprays = 0;
    if (SK.pts) sparksFlush();
    return true;
  },
  // THE HARNESS DOOR, and it exists because of a seam that predates this spec:
  // main.js drives `__playFX.update()` off the requestAnimationFrame line, which
  // `__player.stepFixed()` does not run — and stepFixed has to PAUSE the game to
  // be deterministic at all, which `slSuppressed` correctly reads as "not
  // playing". A gate that could only ask through update() could therefore never
  // see a spark. This runs the real `sparksEmit` + `sparksStep` with the pause
  // flag SUPPLIED instead of read. Every other suppression — clean-frame, the
  // intro, dev fly, the locker, the gear menu — is still slSuppressed's own and
  // is not overridable, which is what keeps §3.3 an honest test.
  step: (dt, paused = false) => {
    const d = clamp(dt || 0.016, 0.0005, 0.05);
    // specs/0057 §7 — the jib emitters ride the SAME door, for the same reason
    // 0020 built it: `update()` runs off requestAnimationFrame and `stepFixed`
    // has to pause the page to be deterministic, so a gate that could only ask
    // through update() could never see a spark — and now could never see a
    // spray or a burst either. `spray()` turns a rate into a count off `R.dt`
    // and the per-frame budget, so both are supplied here exactly as update()
    // supplies them, and the whole §7 cost is sampled around all three calls.
    R.dt = d;
    R.sprayLeft = SPRAY_FRAME;
    fxJibSample(d, !!paused);
    return SK.live;
  },
};

// ================================================ specs/0056 — gear, snow, ice
// Greg, 2026-09-05: "more intense wipeout = losing more equipment ... when i get
// back up i get equipment back, keep snow. And if i have too much snow i turn
// into ice rectangle for a second".
//
// controller.js owns the NUMBERS (I, S, the tier, the freeze) and publishes them
// as `ctrl.snow` with five monotonic counters. This block owns the PICTURE and
// nothing else: it edge-detects on those counters exactly the way `imStep` edge-
// detects on `wipeT`, so a frame the renderer missed cannot lose an event and
// there is no second opinion about when a ski left the body.
//
// WHY IT IS HERE AND NOT IN rider.js. specs/0050-DECISIONS §1 gives the rider's
// CODE block (rider.js + outfits + rig, C20's third row) 65,536 B brotli and this
// branch found 1,999 B of that unspent. rider.js therefore carries §2's shader
// patch — the one thing that genuinely needs `physMat` — and the props, the ice
// block and the bursts live here, where the scene, the particle pool and the
// ground soup already are and where the bytes are not charged to that ceiling.
//
// EVERYTHING IS LAZY. Not one object below exists until the first wipeout that
// earns it, which is what keeps the contract's node census, its material walk
// (whose four roots are `play:body`/`play:ski-l`/`play:ski-r`/`play:fp-skis`, and
// which skips any `fx:*` subtree — hence `fx:gear`) and its no-wipe pixel lanes
// looking at exactly the tree they looked at before.
const GEAR = {
  THROW: 2.4,      // m/s — sideways off the body, whichever way the tumble threw you
  UP: 1.8,         // m/s — ...and up, so a ski arcs rather than skids off
  SPIN: 6.0,       // rad/s — about a random axis; a shed ski tumbles
  G: 9.81,         // m/s^2
  SLIDE: 0.62,     // kept, per bounce, of the tangential speed
  BOUNCE: 0.18,    // ...and of the closing speed, back out
  DRAG: 4.5,       // 1/s on the ground (a quarter of it in the air)
  SLEEP: 0.35,     // m/s — under this it is lying on the snow, and stays there
  REST: 0.03,      // m — how far off the surface a resting prop sits
  MAX: 5,          // live props: one full tier, both skis + both poles + the head
  FLY: 0.25,       // s — §1's fly-back on the get-up
};
const ICE = {
  PAD: 0.06,       // m — the block is the rider's bbox plus this, skis included
  MIN: 0.35,       // m — a floor on each axis, so a degenerate bbox is still a block
  MARGIN: 0.18,    // m — the flesh on the bones the body is measured by
  OP: 0.55,        // face-on opacity: you can see yourself in there
  EDGE_OP: 0.93,   // ...and at a grazing angle, which is the frosted silhouette
  SHARDS: 140,     // the shatter, on the shared pool
  SHARD_V: 4.2,    // m/s
  TINT_T: 0.45,    // s — how long the pool reads ice-blue after the block breaks
};
const SNOWFX = {
  AT: 0.5,         // S above which the body sheds loose snow while skiing
  RATE: 26,        // particles/s at S = 1.0
  PUFF: 90,        // the shake-off, on an R or a lift ride
};
const GS = {
  root: null, props: [], hidden: [], ice: null, iceMat: null,
  pShed: 0, pRest: 0, pIce: 0, pShat: 0, pReset: 0,
  tint: 0, tint0: null, lead: null, names: [],
  box: null, bb: null, v3: null, v3b: null, qt: null, qa: null, mi: null, mw: null,
};

// The one container. Named `fx:gear` because the contract's material walk skips
// any subtree whose name starts `fx:` — a shed ski is a prop, not a rider slot.
function gearRoot() {
  if (GS.root && GS.root.parent) return GS.root;
  const T = R.THREE;
  if (!T || !R.scene) return null;
  GS.root = new T.Group();
  GS.root.name = 'fx:gear';
  GS.box = new T.Box3(); GS.bb = new T.Box3(); GS.v3 = new T.Vector3(); GS.v3b = new T.Vector3();
  GS.mi = new T.Matrix4(); GS.mw = new T.Matrix4();
  GS.qt = new T.Quaternion(); GS.qa = new T.Quaternion();
  GS.lead = new T.Vector3(0, 0, -1);
  R.scene.add(GS.root);
  return GS.root;
}

// HIDE, per MESH and not per subtree: three tests `object.layers` on the object
// itself and never inherits it, so a ski RIG is a Group of meshes and each one
// has to be switched off. `visible` is not usable here — main.js's pose pass
// writes `mSkiL.visible = ski` on EVERY frame, wipe or no wipe, and would light
// a shed ski back up a sixtieth of a second after it left. The saved masks are
// what `gearShow` puts back, so a look change mid-wipe cannot strand a node dark.
function gearHide(o) {
  if (!o) return;
  o.traverse((n) => { if (n.isMesh) { GS.hidden.push([n, n.layers.mask]); n.layers.disableAll(); } });
}
function gearShow() {
  for (const [n, m] of GS.hidden) n.layers.mask = m;
  GS.hidden.length = 0;
}

// One prop: a clone of the node that is leaving, sharing its geometry and its
// material (so it wears the same outfit, and takes §2's snow with it), lifted out
// to the scene at the world transform the node had this frame.
function gearProp(src, name, side) {
  const T = R.THREE, root = gearRoot();
  if (!T || !root || !src || GS.props.length >= GEAR.MAX) return null;
  const u = R.u, c = R.ctrl;
  src.updateMatrixWorld(true);
  const obj = src.clone(true);
  obj.name = 'gear:' + name;
  obj.traverse((n) => { n.layers.enableAll(); if (n.isMesh) { n.castShadow = false; n.frustumCulled = false; } });
  src.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
  root.add(obj);
  const v = c && c.velocity ? c.velocity : { x: 0, y: 0, z: 0 };
  const a = Math.random() * Math.PI * 2;
  const p = {
    obj, src, name, side,
    vx: v.x * rand(0.7, 1.05) + Math.cos(a) * GEAR.THROW * u * side,
    vy: Math.max(0, v.y) + GEAR.UP * u * rand(0.6, 1.4),
    vz: v.z * rand(0.7, 1.05) + Math.sin(a) * GEAR.THROW * u * side,
    ax: new T.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize(),
    spin: GEAR.SPIN * rand(0.6, 1.4) * (Math.random() < 0.5 ? -1 : 1),
    down: false, sleep: false, fly: -1,
  };
  GS.props.push(p);
  GS.names.push(name);
  return p;
}

// WHAT LEAVES, at each of §1's tiers. The head piece is the one the look actually
// wears: the goggles when they are on, and the visible helmet when specs/0044 §A
// has taken them off — one prop either way, never two.
function gearShed(tier) {
  const sc = R.scene;
  if (!sc || tier <= 0) return 0;
  const skiL = sc.getObjectByName('play:ski-l'), skiR = sc.getObjectByName('play:ski-r');
  const body = sc.getObjectByName('play:body');
  const rig = body ? rigOf(body) : null;
  const poles = rig ? rig.poles : null;
  // both skis at tier 2 and up; ONE at tier 1, and it is the right, so a strip
  // frame at 0.25 ≤ I < 0.5 reads as "you lost a ski" and not "you lost the pair"
  if (skiR) { gearProp(skiR, 'ski-r', 1); gearHide(skiR); }
  if (tier >= 2 && skiL) { gearProp(skiL, 'ski-l', -1); gearHide(skiL); }
  // The poles are ONE SkinnedMesh whose index buffer is the left pole's half and
  // then the right's (rider.js §2.5 slices `fpPoles` on exactly that split), so
  // shedding one is a draw range and not a second mesh. The prop reuses the fp
  // pole's already-sliced, already-bone-local rigid geometry — no new geometry.
  if (tier >= 2 && poles && rig.fpPoles && rig.fpPoles.length === 2) {
    const half = poles.geometry.index ? poles.geometry.index.count >> 1 : 0;
    const sides = tier >= 3 ? ['r', 'l'] : ['r'];
    for (const s of sides) {
      const bone = body.getObjectByName('rider:glove-' + s) || body.getObjectByName('rider:pole-' + s);
      const fpm = rig.fpPoles[s === 'r' ? 1 : 0];
      if (bone && fpm) { bone.updateMatrixWorld(true); gearProp(fpm, 'pole-' + s, s === 'r' ? 1 : -1); const q = GS.props[GS.props.length - 1]; if (q) bone.matrixWorld.decompose(q.obj.position, q.obj.quaternion, q.obj.scale); }
    }
    // tier 2 hides the right half (indices [half, 2*half)); tier 3 hides both
    if (half) poles.geometry.setDrawRange(0, tier >= 3 ? 0 : half);
  }
  if (tier >= 3 && body) {
    let head = null;
    body.traverse((n) => { if (!head && n.isMesh && n.visible && /^rider:goggles-/.test(n.name)) head = n; });
    if (!head) body.traverse((n) => { if (!head && n.isMesh && n.visible && /^rider:helmet-/.test(n.name)) head = n; });
    if (head) { gearProp(head, head.name.slice(6), 1); gearHide(head); }
  }
  return GS.props.length;
}

// §1's ONE reattach, and it is idempotent by construction: with nothing out it
// touches nothing, and a second call while the props are already flying home is a
// no-op because `fly` is only ever set from −1. `hard` snaps (an R, a mode change,
// a fast travel); a get-up flies them back over FLY so the body is dressed before
// it stands up.
function gearReattach(hard) {
  const sc = R.scene;
  if (sc) {
    const body = sc.getObjectByName('play:body');
    const rig = body ? rigOf(body) : null;
    if (rig && rig.poles) rig.poles.geometry.setDrawRange(0, Infinity);
  }
  if (!GS.props.length) { gearShow(); return 0; }
  if (hard) {
    for (const p of GS.props) { if (p.obj.parent) p.obj.parent.remove(p.obj); }
    GS.props.length = 0; GS.names.length = 0;
    gearShow();
    return 0;
  }
  let n = 0;
  for (const p of GS.props) if (p.fly < 0) { p.fly = 0; p.p0 = p.obj.position.clone(); p.q0 = p.obj.quaternion.clone(); n++; }
  return n;
}

// The props' own second: thrown, falling, landing on 0034's soup and lying there.
function gearPhys(dt) {
  if (!GS.props.length) return;
  const u = R.u, col = (typeof window !== 'undefined' && window.__playCollision) || null;
  for (let i = GS.props.length - 1; i >= 0; i--) {
    const p = GS.props[i], o = p.obj;
    if (p.fly >= 0) {
      p.fly += dt;
      const k = clamp(p.fly / GEAR.FLY, 0, 1), s = k * k * (3 - 2 * k);
      p.src.updateMatrixWorld(true);
      p.src.matrixWorld.decompose(GS.v3, GS.qt, GS.v3b);
      o.position.lerpVectors(p.p0, GS.v3, s);
      o.quaternion.copy(p.q0).slerp(GS.qt, s);
      if (k >= 1) {
        if (o.parent) o.parent.remove(o);
        GS.props.splice(i, 1); GS.names.splice(i, 1);
        if (!GS.props.length) gearShow();
      }
      continue;
    }
    if (p.sleep) continue;
    p.vy -= GEAR.G * u * dt;
    const f = Math.exp(-GEAR.DRAG * (p.down ? 1 : 0.25) * dt);
    p.vx *= f; p.vz *= f;
    o.position.x += p.vx * dt; o.position.y += p.vy * dt; o.position.z += p.vz * dt;
    if (p.spin) { GS.qa.setFromAxisAngle(p.ax, p.spin * dt); o.quaternion.premultiply(GS.qa); }
    let gy = null;
    try { gy = col && col.groundAt ? col.groundAt(o.position.x, o.position.z, o.position.y + 4 * u) : null; } catch { gy = null; }
    if (gy == null) { if (o.position.y < -400 * u) { if (o.parent) o.parent.remove(o); GS.props.splice(i, 1); GS.names.splice(i, 1); } continue; }
    const floor = gy + GEAR.REST * u;
    if (o.position.y <= floor) {
      o.position.y = floor;
      if (p.vy < 0) p.vy = -p.vy * GEAR.BOUNCE;
      p.vx *= GEAR.SLIDE; p.vz *= GEAR.SLIDE; p.spin *= GEAR.SLIDE;
      p.down = true;
      if (Math.hypot(p.vx, p.vy, p.vz) < GEAR.SLEEP * u) {
        p.vx = p.vy = p.vz = 0; p.spin = 0; p.sleep = true;
        // a ski at rest lies ON the snow: keep the heading, drop the tilt
        o.rotation.set(0, o.rotation.y, 0);
      }
    }
  }
}

// §3 — the ice rectangle. ONE BoxGeometry (12 tris), built once and re-scaled to
// the rider's world bbox with the skis in. NO `transmission`: specs/0046 §3.1 bans
// it on the rider for a measured +8–11 ms (WebGLRenderer renders the whole scene a
// second time for a transmissive draw) and a one-second gag cannot buy that. The
// visor's recipe instead — low roughness, clearcoat, the world's own envmap — with
// a fresnel that closes the silhouette to EDGE_OP and frosts it, which is the
// refraction the eye actually reads at this size.
// GLSL has no implicit int→float (see rider.js `g1`): every injected number
// gets a decimal point, or the program silently fails to link and the draw is
// dropped without an error anywhere.
const gf = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
function iceFrost(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <clearcoat_normal_fragment_begin>',
    `#include <clearcoat_normal_fragment_begin>
  float iF = pow( 1.0 - abs( dot( normalize( vViewPosition ), normal ) ), 2.5 );
  diffuseColor.a = mix( ${gf(ICE.OP)}, ${gf(ICE.EDGE_OP)}, iF );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.90, 0.95, 1.0 ), iF * 0.70 );
  roughnessFactor = mix( 0.06, 0.62, iF );`);
}
function iceOn() {
  const T = R.THREE, root = gearRoot(), sc = R.scene;
  if (!T || !root || !sc) return null;
  const sk = sc.getObjectByName('play:skier') || sc.getObjectByName('play:body');
  if (!sk) return null;
  if (!GS.ice) {
    const body = sc.getObjectByName('rider:body');
    GS.iceMat = new T.MeshPhysicalMaterial({
      color: 0xcfe8ff, transparent: true, opacity: ICE.OP, depthWrite: false,
      roughness: 0.06, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06,
      ior: 1.31, side: T.DoubleSide,
      envMap: (body && body.material && body.material.envMap) || null, envMapIntensity: 1.0,
    });
    GS.iceMat.onBeforeCompile = iceFrost;
    GS.ice = new T.Mesh(new T.BoxGeometry(1, 1, 1), GS.iceMat);
    GS.ice.name = 'fx:gear-ice'; GS.ice.renderOrder = 12; GS.ice.frustumCulled = false;
    root.add(GS.ice);
  }
  // The box is taken in the SKIER'S OWN space and the block is then oriented to
  // it. A world-axis-aligned box round a body that is 75° over on its hip with
  // two 1.9 m skis fanned off it measures 4.2 m across — measured, first run —
  // and that is a shed, not a rider in an ice cube. In local space it is the
  // rider: about 0.8 × 1.8 × 2.1 m, and the block rolls with the tumble.
  sk.updateMatrixWorld(true);
  GS.mi.copy(sk.matrixWorld).invert();
  GS.box.makeEmpty();
  // A SkinnedMesh's `geometry.boundingBox` is the BIND pose and knows nothing
  // about the tumble — 1.7 m of standing rider laid on its side is 1.7 m of Z
  // whatever the body is actually doing, which is how the first cut measured
  // 3.3 m. So the body is measured off its BONES, which are posed, plus a margin
  // for the flesh on them; the rigid nodes (both skis, the bone-parented
  // toggles) keep their real geometry boxes, because those are exact.
  // ...and the walk does NOT descend into an `fx:` subtree. specs/0006's aura and
  // its trail hang off `play:ski-l/r` (C14 counts them there) and are metres of
  // glow quad: measured, they alone took the block from 2.4 m to 3.7. The same
  // name rule the contract's own material walk uses, for the same reason.
  const stack = [sk];
  while (stack.length) {
    const n = stack.pop();
    // ...and not into anything switched OFF. `visible` is per-object and does not
    // inherit, so the glider's twelve rib panels — parked under the skier with
    // their own `visible` still true under a hidden wing group — measured 1.6 ×
    // 2.1 m each and were the whole of the first cut's 3.7 m block.
    if (n !== sk && (!n.visible || /^fx:/.test(n.name || ''))) continue;
    for (const k of n.children) stack.push(k);
    if (n.isBone) { GS.v3.setFromMatrixPosition(n.matrixWorld).applyMatrix4(GS.mi); GS.box.expandByPoint(GS.v3); continue; }
    if (!n.isMesh || n.isSkinnedMesh || !n.geometry) continue;
    if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
    if (!n.geometry.boundingBox) continue;
    GS.bb.copy(n.geometry.boundingBox).applyMatrix4(GS.mw.multiplyMatrices(GS.mi, n.matrixWorld));
    GS.box.union(GS.bb);
  }
  if (GS.box.isEmpty()) GS.box.setFromObject(sk);
  else GS.box.expandByScalar(ICE.MARGIN * R.u);
  const u = R.u, pad = ICE.PAD * u, mn = ICE.MIN * u;
  GS.box.getSize(GS.v3); GS.box.getCenter(GS.v3b);
  GS.ice.scale.set(Math.max(mn, GS.v3.x + pad * 2), Math.max(mn, GS.v3.y + pad * 2), Math.max(mn, GS.v3.z + pad * 2));
  GS.ice.position.copy(GS.v3b).applyMatrix4(sk.matrixWorld);
  sk.getWorldQuaternion(GS.qt);
  GS.ice.quaternion.copy(GS.qt);
  GS.ice.visible = true;
  return GS.ice;
}
// ...and it breaks. The shards go on the SHARED snow pool, which is what 0015's
// landing puff does and what the brief means by reusing the burst machinery. That
// pool has ONE `uColor` (0.96, 0.98, 1.0 — already a cold white), so the ice-blue
// is a timed lerp of that single uniform, restored from the value captured the
// first time. specs/0056a moved the shatter to the GET-UP (t = 1.60 of a 2.0 s
// wipe) instead of the end of a freeze, and the claim behind the shared pool
// survives that intact: §2's loose snow is gated on `!(c.wipeT > 0)`, so for the
// first 0.40 s of TINT_T = 0.45 the rider is still tumbling and spraying nothing
// and every particle in the pool IS a shard. The 0.05 s of overlap after the
// stand-up is at most one particle at SNOWFX.RATE. 0047's plumbing is untouched —
// it lives on the aura, the trail and the speed lines, never on this pool.
function iceShatter() {
  if (GS.ice) GS.ice.visible = false;
  const c = R.ctrl, u = R.u;
  if (!c) return 0;
  const p = c.position, h = GS.ice ? GS.ice.scale.y * 0.5 : 0.9 * u;
  for (let i = 0; i < ICE.SHARDS; i++) {
    const a = Math.random() * Math.PI * 2, e = rand(-0.35, 1.0);
    const s = ICE.SHARD_V * u * rand(0.35, 1.3);
    emit(p.x + rand(-0.35, 0.35) * u, p.y + h * rand(0.0, 1.5), p.z + rand(-0.35, 0.35) * u,
         Math.cos(a) * s, e * s + rand(0.4, 2.6) * u, Math.sin(a) * s,
         rand(0.55, 1.15), rand(0.06, 0.20) * u, rand(0.65, 1.0));
  }
  const uc = R.pMat && R.pMat.uniforms && R.pMat.uniforms.uColor;
  if (uc) { if (!GS.tint0) GS.tint0 = uc.value.clone(); uc.value.setRGB(0.70, 0.86, 1.0); GS.tint = ICE.TINT_T; }
  return ICE.SHARDS;
}
// §4's shake-off, on the same pool.
function snowPuff(n) {
  const c = R.ctrl, u = R.u;
  if (!c) return 0;
  const p = c.position;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(0.4, 2.2) * u;
    emit(p.x + Math.cos(a) * rand(0.05, 0.45) * u, p.y + rand(0.1, 1.4) * u, p.z + Math.sin(a) * rand(0.05, 0.45) * u,
         Math.cos(a) * s, rand(-0.4, 1.4) * u, Math.sin(a) * s,
         rand(0.5, 1.1), rand(0.08, 0.22) * u, rand(0.5, 0.9));
  }
  return n;
}

// The driver. Called once a frame from update(), and by `__gear.step` so a
// headless stepFixed() run can see the same second a player does.
function gearStep(dt, paused) {
  const c = R.ctrl;
  if (!c || !R.THREE || !R.scene) return false;
  const s = c.snow;
  if (!s) return false;                       // a pre-0056 controller: nothing to do
  // §2 — the body's own coverage, and the direction it is travelling, which is
  // what makes the leading faces the snowy ones.
  if (GS.lead || gearRoot()) {
    const v = c.velocity, sp = v ? Math.hypot(v.x, v.z) : 0;
    if (sp > 0.4 * R.u && GS.lead) GS.lead.set(v.x / sp, 0, v.z / sp);
  }
  riderSnow(s.S, GS.lead ? GS.lead.x : 0, 0, GS.lead ? GS.lead.z : -1);
  // the five edges, in the order the second actually happens in
  if (s.shedSeq !== GS.pShed) { GS.pShed = s.shedSeq; gearShed(s.tier); }
  if (s.restoreSeq !== GS.pRest) { GS.pRest = s.restoreSeq; gearReattach(!(c.wipeT > 0)); }
  if (s.iceSeq !== GS.pIce) { GS.pIce = s.iceSeq; iceOn(); }
  if (s.shatterSeq !== GS.pShat) { GS.pShat = s.shatterSeq; iceShatter(); }
  if (s.resetSeq !== GS.pReset) { GS.pReset = s.resetSeq; gearReattach(true); if (GS.ice) GS.ice.visible = false; snowPuff(SNOWFX.PUFF); }
  // specs/0056a §A — and THIS is what makes the block ride the ragdoll. `s.frozen`
  // no longer means "the sim is stopped" (nothing stops it); it means "there is a
  // block round you", and it is true for 1.25 s of a tumble that is still running.
  // So the re-fit below is no longer a formality over a held pose: it re-measures
  // the posed bones every frame and the box ROLLS with the body inside it.
  if (GS.ice && GS.ice.visible && s.frozen) iceOn();          // track the body's bbox
  if (GS.ice && GS.ice.visible && !s.frozen) GS.ice.visible = false;
  // ---- THE SAME RULE main.js's `gearRestore()` states, for the half 0056 owns.
  //
  // fix/lost-ski put the ski TRANSFORM back on every frame the tumble does not
  // own the body (main.js, `tumbleStep`'s off-branch) rather than on an edge,
  // because a respawn, a teleport, a gear change, a rack mount and a flip to
  // first person are five exits and an edge detector has to know all of them.
  // 0056's half — the layers-hidden originals, the poles' draw range and the
  // props on the snow — answers to exactly the same rule and is written the same
  // way: an assignment, not an unwind. It runs BEFORE the pause gate, so a
  // paused page (N33's probe, the locker, a headless walk) can never be left
  // standing with a ski still switched off, and it costs one boolean on a frame
  // with nothing shed. The 0.25 s fly-back is untouched by it: the flight starts
  // at t = 1.60 and lands at 1.85, and `wipeT` is > 0 until 2.0.
  if (!(c.wipeT > 0) && !s.frozen && (GS.props.length || GS.hidden.length)) gearReattach(true);
  // A PAUSED page draws but does not simulate — the same discipline the tumble
  // rig relies on (0015 §5b): `wipeT` only moves when the controller steps, so a
  // prop must only move when something steps it. `__gear.step(dt)` is that
  // something on a headless run, exactly as `__impact.step` and `__sparks.step`
  // are, and without this gate the wall-clock rAF would race the fixed step.
  if (paused) return true;
  gearPhys(dt);
  // the pool's ice-blue, always given back
  if (GS.tint > 0) {
    GS.tint -= dt;
    const uc = R.pMat && R.pMat.uniforms && R.pMat.uniforms.uColor;
    if (GS.tint <= 0 && uc && GS.tint0) { uc.value.copy(GS.tint0); GS.tint = 0; }
  }
  // §2 — loose snow off a snowy body, while it is actually skiing. spray() is the
  // budgeted path, so this cannot eat a hockey stop's plume.
  if (s.S > SNOWFX.AT && !s.frozen && c.grounded && c.mode === 'skis' && !(c.wipeT > 0)) {
    const u = R.u, p = c.position, v = c.velocity;
    const k = (s.S - SNOWFX.AT) / (1 - SNOWFX.AT);
    spray({ x: p.x, y: p.y + 0.95 * u, z: p.z },
          { x: -v.x * 0.18, y: -0.5 * u, z: -v.z * 0.18 },
          SNOWFX.RATE * k, 0.09);
  }
  return true;
}

// The lab handle, the shape `__sparks` and `__impact` already use. `__rider.snow`
// is §5's one readout — the HUD gets nothing new.
window.__gear = {
  props: () => GS.names.slice(),
  live: () => GS.props.length,
  ice: () => !!(GS.ice && GS.ice.visible),
  iceBox: () => (GS.ice ? { x: +GS.ice.scale.x.toFixed(3), y: +GS.ice.scale.y.toFixed(3), z: +GS.ice.scale.z.toFixed(3), tris: 12 } : null),
  restore: (hard = true) => gearReattach(hard),
  // headless: `update()` rides requestAnimationFrame, which stepFixed does not run
  step: (dt, paused = false) => gearStep(clamp(dt || 0.016, 0.0005, 0.05), !!paused),
};
window.__rider = {
  snow: () => {
    const s = R.ctrl && R.ctrl.snow;
    return s ? { S: +s.S.toFixed(4), tier: s.tier, I: +s.I.toFixed(4), deltaS: +s.deltaS.toFixed(4),
                 wipes: s.wipes, frozen: !!s.frozen, iceT: +s.iceT.toFixed(3), shed: GS.names.slice() } : null;
  },
  setSnow: (v) => (R.ctrl && R.ctrl.setSnow ? R.ctrl.setSnow(v) : null),
  reset: (why) => (R.ctrl && R.ctrl.snowReset ? R.ctrl.snowReset(why || 'probe') : null),
};

// specs/0057 §7.4 — one sample of what §7 costs, taken around the three calls
// that ARE §7. Both drives (update() and the harness door) go through here, so
// the median a gate reads is the median the game pays.
function fxJibSample(d, paused) {
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  railFxStep(d, paused);
  sparksEmit(d, paused);
  sparksStep(d);
  if (t0) {
    SK.ms = performance.now() - t0;
    SK.cost[SK.ci] = SK.ms;
    SK.ci = (SK.ci + 1) % SK.cost.length;
    if (SK.cn < SK.cost.length) SK.cn++;
  }
}

// ============================================================ the impact frame
// specs/0015 §4. Greg picked it out of the lookbook on 2026-09-01 — "lets do
// 2 5" — so it is exactly two things and there is no third: an INWARD burst of
// speed lines from the edge of the frame toward a point a third of the way to
// the centre (option 2), and, on a big hit only, two frames of white (option 5).
//
// It sits on the SPEED-LINE CANVAS and uses the speed-line draw path — one path
// and one fill per (alpha bucket x ink), zero string work in the loop — because
// a second full-screen 2D canvas to paint 85 quads on 120 ms a run would be a
// second compositor layer for nothing. It does NOT sit in the speed-line FIELD:
// its own little pool, its own clock, its own suppression answer. The field is a
// level (how fast are you going) and this is an event (you just hit a tree), and
// §4 is explicit that the second must fire when the first is dark — a wipe at
// 6 m/s bursts even though the field was off.
//
// The trigger is the controller's own countdown going ≤ 0 → > 0.5, which is
// where 0017's audio reads the same event, so there is no plumbing in main.js
// and no third opinion about which frame the hit happened on.
// ---- specs/0030 §4: SEVENTY-FIVE PER CENT LOUDER.
//
// Every number that governs how LOUD one burst is goes up by three quarters —
// how long it holds, how many lines are in it, how wide they are, how opaque,
// and how much white frame there is. Nothing that governs how OFTEN one happens
// moves at all: `V_MIN`/`V_MAX`, `FLASH_V` and `SHAPE` are untouched, so a
// stumble at walking pace is the same stumble it was and a 12 m/s trunk is the
// only thing that still earns a white frame. Louder, not more frequent.
// ---- specs/0033 §1 + §2: THIRTY PER CENT QUIETER, AND ORANGE.
//
// Greg asked for the orange back and the lines 30 % less intense. The orange had
// never been here — 0015 built this frame out of white and slate and 0030 made
// it louder without adding a colour; what he remembers is the ski flame
// (`FL_FILL`, specs/0006), which is on screen when a jump launch ends in a cased
// landing and which 0030's 149 white lines at alpha 1.0 buried. So the fix is
// both halves at once: the frame gets its own heat ink (§2, `HEAT_FRAC`), and
// the lines come off 30 % (§1) so there is room to see it.
//
// EXACTLY the four numbers that make a line loud move: how many, how wide, how
// opaque, and the pool that holds them. `DUR`, `FLASH_A`, `FLASH_FRAMES`,
// `FLASH_V`, `V_MIN`/`V_MAX`, `SHAPE`, `INNER`/`OUTER`/`LEN`/`TAPER`/`STAGGER`
// are 0030's untouched — the frame lasts exactly as long, flashes exactly as
// hard, and fires exactly as often. Only the lines are quieter.
// ---- specs/0035 §1 + §2: THE ORANGE WAS NEVER INK. IT IS THE INVERSION.
//
// 0033 read the lookbook wrong. The panel Greg picked is option 4, "flash
// frame — two frames of INVERSION (the 'colour changes for a split second'
// one)", and the note under it says the white-flash variant is the same code
// with a white rect. A blue-white mountain run through `difference` comes back
// as a dark frame with an ORANGE sky: THAT is the orange tint he asked for, and
// it is a property of the whole picture rather than a colour on 35 spokes.
//
// So 0033's heat ink is deleted outright (§1) — the third fill table, the third
// quota slot and `HEAT_FRAC` — and the flash stops being a white veil and starts
// being the inversion (§2, `imBlend`). The two changes are one change: the
// frame's colour event moved out of the ink and into the compositor.
//
// `LINES_MIN/MAX`, `WIDTH`, `ALPHA` and `DUR` are 0033's, to the digit. The
// lines are exactly as quiet as Greg signed off on; only their palette is back
// to 0015's white and slate.
// ---- specs/0054: RED, TWICE AS LONG, ON EVERY WIPEOUT.
//
// Greg, on rider/v3: "can wipeout impact frame orange tint become red and 2x
// duration / lower threshold to activate (it should always have some degree of
// red)". The "orange tint" is 0035's inversion — nothing here has been orange
// since 0035 deleted 0033's ink — so all three halves of that sentence land on
// this block and on `imBlend`.
//
// RED (§1): the flash rect becomes `rgba(230,30,24)` under `hard-light` instead
// of white under `difference` (see `imBlend` for why the blend mode had to move
// with the colour), and `RED_FRAC` of the lines are drawn in the same red.
//
// TWICE AS LONG (§2): `DUR` and `FLASH_FRAMES` double, and three shape numbers
// move WITH them so the frame decays over its new life instead of holding: a
// line still snaps on in the same milliseconds (`RISE`), the fan still arrives
// in roughly the same window (`STAGGER` as a fraction of a DUR that doubled),
// and the alpha falls off nearly twice as fast in normalised time (`TAPER_P`).
// Doubling `DUR` alone would have given a burst that sits on the screen.
//
// EVERY WIPEOUT (§3): `FLASH_V` stops being the speed BELOW WHICH there is no
// flash and becomes the speed AT WHICH the flash is full — every wipe now
// flashes, from `FLASH_A_MIN` up. And below `V_MIN`, where the line count used
// to sit flat at `LINES_MIN` on full alpha, an intensity `k` scales both down to
// `K_MIN`. The floor under all of it is red: `RED_FRAC` is a constant share of
// every burst at every speed, and a red line's alpha never scales below
// `RED_K_FLOOR`, so "some degree of red" is true of a 1 m/s stumble.
const IM = {
  DUR: 0.42,            // s — 0054 §2. Was 0.21 (0030's +75 %, 0033/0035 held it)
  LINES_MIN: 49,        // ...at V_MIN      (0030: 70,  −30 %)
  LINES_MAX: 104,       // ...and at V_MAX and above (0030: 149, −30 %)
  V_MIN: 4.0, V_MAX: 12.0,
  // ...and how the count runs BETWEEN those two. Not linearly: §5.4 asks for
  // ~45 lines at 6 m/s on 0015's curve, and the straight line through its
  // (4, 40) and (12, 85) passes through 51 there. 0030 lifts both ends by 75 %
  // and leaves the exponent alone, so the SHAPE of the escalation is 0015's.
  // A wipe at walking pace is a stumble and should look like one; the frame is
  // meant to escalate as you approach the speeds a trunk actually hurts at.
  SHAPE: 1.6,
  CAP: 112,             // pool ceiling: LINES_MAX plus slack
  INNER: 0.35,          // stops 35 % of the way in from the edge
  OUTER: 1.18,          // ...having started just outside the frame
  LEN: 0.30,            // one line's own length, as a fraction of the half-frame
  WIDTH: 11.0,          // px at the outer (trailing) end (0030: 15.75, −30 %)
  TAPER: 0.14,          // ...and the fraction of that at the converging end
  WIDTH_REF: 720,
  ALPHA: 0.70,          // 0030: 1.0. Still bucketed and capped by SL_ALPHA_CEIL
  INK_FRAC: 0.30,       // the same deep slate the ordinary field is 30 % made of
  // 0033's `HEAT_FRAC` was DELETED by 0035 §1 rather than zeroed. 0054 §1b does
  // not resurrect the name: that constant meant "the flame's orange", and this
  // one means "the damage red", which is the opposite argument.
  RED_FRAC: 0.35,       // ...of every burst, at every speed (0033's share, red)
  // ...and the floor under `k` for the red lines alone. A 1 m/s stumble runs at
  // k = 0.45, which would put its red at alpha 0.31 and inside the noise; the
  // white and slate go quiet with the hit but the red does not go below this.
  RED_K_FLOOR: 0.70,
  // ---- specs/0054 §3: how hard a burst is BELOW the old floor.
  // `t` (the V_MIN..V_MAX ramp) clamps at 0 under 4 m/s, so every wipe under
  // walking-into-a-tree speed used to draw the same 49 lines at the same alpha
  // as one AT the tree. `k` is the leg below that floor: 1 at V_MIN and above,
  // K_MIN at a standstill, linear between, on the count and on the line alpha.
  K_MIN: 0.45,
  STAGGER: 0.20,        // how much of DUR the last line waits (0035: 0.34, on a
                        // DUR half as long — 0.071 s then, 0.084 s now)
  RISE: 18,             // `min(1, q * RISE)`: 0035 had 9 inline, on half the DUR
  TAPER_P: 1.30,        // `pow(1 - q, TAPER_P)`: 0035 had 0.55 inline. At the
                        // half-way point a line is at 41 % rather than 68 %, so
                        // the doubled frame DECAYS instead of holding.
  FLASH_V: 12.0,        // m/s — 0054 §3: the speed the flash is FULL at. It was
                        // "below this there is no flash, ever"; there is now a
                        // flash on every wipe, from FLASH_A_MIN up to FLASH_A.
  // ---- specs/0035 §2: FLASH_A is no longer "how white". specs/0054 §1a: and it
  // is no longer "how inverted" either — it is HOW RED. The flash is a
  // `hard-light` composite of an `rgba(230,30,24,A)` rect against the composited
  // page, so A scales continuously from a hint of red to a frame that is red.
  FLASH_A: 0.85,        // ...at and above FLASH_V
  FLASH_A_MIN: 0.22,    // ...and at a standstill. Never zero: §3's "always red".
  FLASH_FRAMES: 8,      // 0054 §2 — eight frames at 60, 133 ms (0035: 4)
  // ---- specs/0054 §4: THE DARK BORDERS. Not a canvas draw — see `vgBuild`.
  VIG: {
    // The borders are THERE on the impact frame — RISE0 of full strength on the
    // frame of the hit — and reach full over IN. A ramp from zero would have put
    // the one frame Greg is looking at (the hit) outside the effect; a step from
    // zero to full would pop. This is neither.
    RISE0: 0.45,
    IN: 0.03,           // s — ...and how long RISE0 takes to become 1
    OUT: 0.50,          // s — ...and the smoothstep ease-out at the END of the
                        // tumble, measured off `wipeT` and not off a timer here
    MIN: 0.30,          // element opacity at a standstill (every wipe gets some)
    MAX: 1.00,          // ...and at FLASH_V and above
    PEAK: 0.78,         // the gradient's own alpha in the corners, at opacity 1
  },
};

const IMS = {
  live: false, t: 0, lines: 0, speed: 0, why: null, flash: false,
  n: 0, last: null, hold: null,
  prevWipe: 0, prevSp: 0,
  // struct-of-arrays, exactly as the field's pool is: a burst is 85 lines in one
  // frame and 85 short-lived objects is 85 things for the GC to find later
  ca: new Float32Array(IM.CAP), sa: new Float32Array(IM.CAP),
  d: new Float32Array(IM.CAP), ln: new Float32Array(IM.CAP),
  wd: new Float32Array(IM.CAP), a0: new Float32Array(IM.CAP),
  ik: new Uint8Array(IM.CAP),          // 0 white, 1 slate, 2 red (0054 §1b)
  inkN: [0, 0, 0],                     // ...and how many of each the last burst armed
  gx: new Float32Array(IM.CAP * 8), gb: new Uint8Array(IM.CAP),
  drawn: 0, flashA: 0,
  // specs/0057 §7.3 — the two things the takeoff burst changes about a frame
  // that is otherwise 0015's to the pixel: which way the fan travels, and what
  // the third ink slot points at. `out` false and `ink3` 'red' is the wipeout
  // frame every existing spec describes, and `imFire` sets them back on arming.
  out: false, ink3: 'red',
  // 0054 §3: the burst's own two scalars, kept so `state()` can report the
  // mapping the spec's table states rather than re-deriving it from the speed.
  k: 1, flashA0: 0,
};

// ARM ONE. `speedMs` is the speed the frame BEFORE the scrub — `wipeout()` has
// already taken 70 % of it by the time anything downstream can see the event,
// and a burst sized off the remainder would make every hit look like a stumble.
function imFire(speedMs, why) {
  const sp = Math.max(0, +speedMs || 0);
  const t = Math.pow(clamp((sp - IM.V_MIN) / (IM.V_MAX - IM.V_MIN), 0, 1), IM.SHAPE);
  // ---- specs/0054 §3: the leg BELOW the old floor. `t` is flat at 0 under
  // V_MIN, so 0035 drew the same 49 lines at the same alpha for a 0.5 m/s
  // stumble as for a 4 m/s one. `k` is the ramp that was missing: 1 at and above
  // V_MIN (so nothing at or over the old threshold moves by a pixel), K_MIN at a
  // standstill. It multiplies the count and the line alpha, and nothing else —
  // the geometry of a burst is the same fan whatever hit made it.
  const k = sp >= IM.V_MIN ? 1 : IM.K_MIN + (1 - IM.K_MIN) * (sp / IM.V_MIN);
  const n = Math.min(IM.CAP,
    Math.round((IM.LINES_MIN + (IM.LINES_MAX - IM.LINES_MIN) * t) * k));
  const wide = IM.WIDTH * clamp(Math.min(S.w || 1280, S.h || 720) / IM.WIDTH_REF, 0.7, 1.4);
  // ---- 0033 §2: WHICH INK, decided by quota rather than by a coin.
  //
  // 0030 rolled `Math.random() < INK_FRAC` per line. At 104 lines that is a
  // binomial with a standard deviation of ~4.7 lines — 4.5 % — so a share the
  // spec pins to ±5 % would be outside its own tolerance about a third of the
  // time, and the misses would be a colour the eye can see going missing. So
  // each line goes to whichever ink is furthest BEHIND its share so far
  // (largest-remainder): the counts land within one line of the quota every
  // time, and because `i` is the fan slot the two inks come out interleaved
  // around the ring instead of clumped into arcs. `off` is a random phase per
  // burst so the repeat is not the same two-cycle on every hit.
  //
  // 0035 §1 keeps the quota and drops the third slot. It still earns its keep at
  // two inks — a coin on a 30 % share of 104 lines is σ ≈ 4.7 lines — and it is
  // what makes "70/30" a fact about EVERY burst rather than about the average of
  // many of them.
  // 0054 §1b restores the third slot the quota had under 0033, with red in it.
  const frac = [1 - IM.INK_FRAC - IM.RED_FRAC, IM.INK_FRAC, IM.RED_FRAC];
  const off = [Math.random(), Math.random(), Math.random()];
  const got = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    // an EVEN FAN with a jittered angle inside each slot. A uniform random ring
    // leaves gaps big enough to read as gaps at 85 lines, and the one thing this
    // frame has to say is "from every direction at once".
    const a = ((i + rand(0.15, 0.85)) / n) * Math.PI * 2;
    IMS.ca[i] = Math.cos(a); IMS.sa[i] = Math.sin(a);
    IMS.d[i] = Math.random() * IM.STAGGER;
    IMS.ln[i] = IM.LEN * rand(0.55, 1.45);
    IMS.wd[i] = wide * rand(0.50, 1.50);
    let ink = 0, bestD = -Infinity;
    for (let j = 0; j < 3; j++) {
      const d = frac[j] * (i + 1) + off[j] - got[j];
      if (d > bestD) { bestD = d; ink = j; }
    }
    got[ink]++;
    IMS.ik[i] = ink;
    // ...and the ink is chosen BEFORE the alpha, because 0054 §3's red floor is
    // an alpha rule about one ink: white and slate go quiet with a soft hit, the
    // red does not follow them all the way down. That is the difference between
    // "some degree of red" and "a red you can only see at 12 m/s".
    IMS.a0[i] = IM.ALPHA * (ink === 2 ? Math.max(k, IM.RED_K_FLOOR) : k) * rand(0.60, 1.20);
  }
  IMS.lines = n;
  IMS.inkN = got;
  IMS.out = false; IMS.ink3 = 'red';    // specs/0057 §7.3 — a wipe is inward, red
  IMS.k = k;
  IMS.speed = +sp.toFixed(2);
  IMS.why = why || null;
  // ---- specs/0054 §3: THE FLASH FIRES ON EVERY WIPEOUT.
  // `FLASH_V` used to be a gate and is now the top of a ramp. `flash` stays in
  // the shape 0015 §4 gave it (the readers of `last()` want a boolean) and is
  // simply always true; `flashA0` is the strength this burst earned.
  IMS.flash = true;
  IMS.flashA0 = IM.FLASH_A_MIN
    + (IM.FLASH_A - IM.FLASH_A_MIN) * clamp(sp / IM.FLASH_V, 0, 1);
  IMS.t = 0; IMS.live = true; IMS.n++;
  IMS.last = { why: IMS.why, speed: IMS.speed, lines: n, flash: IMS.flash,
               ink: { white: got[0], slate: got[1], red: got[2] } };
  return IMS.last;
}

// Lay the frame's geometry at phase `p` (0 = the instant of the hit, 1 = the end
// of the burst). A PURE FUNCTION of the phase and the pool: nothing here
// integrates, which is what lets `hold()` photograph any instant of a 120 ms
// event on a headless box that cannot render 60 of them a second.
function imLay(p) {
  const w = S.w || 1280, h = S.h || 720;
  const cx = w * 0.5, cy = h * 0.5, HX = w * 0.5, HY = h * 0.5;
  const step = SL_ALPHA_CEIL / SL_BUCKETS;
  let drawn = 0;
  for (let i = 0; i < IM.CAP; i++) IMS.gb[i] = 255;
  for (let i = 0; i < IMS.lines; i++) {
    const d = IMS.d[i];
    const q = (p - d) / (1 - d);
    if (q <= 0 || q >= 1) continue;
    // fast off the edge and settling as it arrives — an impact line does not
    // cruise in at a constant rate, it is thrown
    const e = 1 - (1 - q) * (1 - q) * (1 - q);
    // specs/0057 §7.3 — the takeoff burst runs this fan OUTWARD. Everything else
    // about it is 0015's geometry (the same ease, the same length, the same
    // taper, the same pool, the same fill loop): only the direction of travel is
    // reversed, because an impact arrives at you and a pop leaves from you. Two
    // expressions, one flag, and no second lay function to keep in step.
    const rh = IMS.out
      ? IM.INNER + (IM.OUTER - IM.INNER) * e                 // leaving the boots
      : IM.OUTER + (IM.INNER - IM.OUTER) * e;                // the converging head
    const rt = IMS.out
      ? Math.max(0, rh - IMS.ln[i] * (1 - 0.45 * e))         // ...trailing behind
      : rh + IMS.ln[i] * (1 - 0.45 * e);                     // ...and the tail behind
    // 0054 §2: both numbers are named and both moved with `DUR`. `RISE` doubled
    // so a line still snaps on in the same milliseconds it did at half the span,
    // and `TAPER_P` more than doubled so the alpha is falling for most of the
    // burst's new life. Doubling DUR with 0035's 9/0.55 gave a frame that held.
    const a = IMS.a0[i] * Math.min(1, q * IM.RISE) * Math.pow(1 - q, IM.TAPER_P);
    if (a < step * 0.5) continue;
    let b = (a / step) | 0;
    if (b >= SL_BUCKETS) b = SL_BUCKETS - 1;
    IMS.gb[i] = b + IMS.ik[i] * SL_BUCKETS;    // 0054: three inks, 0..23
    drawn++;
    const ca = IMS.ca[i], sa = IMS.sa[i];
    const ax = cx + ca * rh * HX, ay = cy + sa * rh * HY;   // inner: the point
    const bx = cx + ca * rt * HX, by = cy + sa * rt * HY;   // outer: the edge
    let dx = bx - ax, dy = by - ay;
    const dm = Math.hypot(dx, dy) || 1;
    const nx = -dy / dm, ny = dx / dm;
    // WIDE at the frame edge, tapering to nothing at the convergence point. That
    // direction is the whole reason the burst reads as inward rather than as the
    // ordinary field with the sign flipped.
    const wo = IMS.wd[i] * 0.5, wi = wo * IM.TAPER;
    const o = i * 8;
    IMS.gx[o]     = ax + nx * wi; IMS.gx[o + 1] = ay + ny * wi;
    IMS.gx[o + 2] = bx + nx * wo; IMS.gx[o + 3] = by + ny * wo;
    IMS.gx[o + 4] = bx - nx * wo; IMS.gx[o + 5] = by - ny * wo;
    IMS.gx[o + 6] = ax - nx * wi; IMS.gx[o + 7] = ay - ny * wi;
  }
  IMS.drawn = drawn;
  // OPTION 4 in the lookbook, "flash frame": FLASH_FRAMES frames at 60. 0015
  // through 0035 also gated it on IM.FLASH_V — "a crossed landing at 6 m/s is a
  // shrug" — and 0054 §3 is Greg overruling that: a wipeout is never a shrug and
  // there should always be some degree of red. The gate becomes a RAMP, computed
  // once per burst in `imFire`; what is left here is the WINDOW.
  // The half-frame is not fussiness: at 60 fps the eighth shutter lands exactly
  // on `FLASH_FRAMES / 60` and float equality decides whether the flash is eight
  // frames long or nine.
  IMS.flashA = p * IM.DUR < (IM.FLASH_FRAMES - 0.5) / 60 ? IMS.flashA0 : 0;
}

// The phase this frame is being drawn at. `hold` is a TEST-ONLY WRITE, in the
// shape `__aura.force()` already established, and it is a write to the PICTURE:
// it pins the burst's clock in seconds since the hit and forces the overlay
// visible so a paused headless page can photograph a 120 ms event frame by
// frame. It cannot move a body, a velocity or a payout by a millimetre.
function imPhase() {
  const s = IMS.hold != null ? IMS.hold : IMS.t;
  return clamp(s / IM.DUR, 0, 1.6);
}

// ---- specs/0035 §2: THE INVERSION, and why it is a CSS property and not a fill.
//
// The lookbook's option 4 is `globalCompositeOperation = 'difference'` plus a
// white rect: a blue-white mountain comes back dark with an ORANGE sky, which is
// the "colour changes for a split second" Greg picked and the orange he has been
// asking for since. 0015 wrote it up as the white-rect variant and 0030/0033
// built on that; 0033's orange ink was my misread of the same note.
//
// It cannot be done with `globalCompositeOperation` here. The 3D scene is a
// WebGL canvas and these lines are a SECOND canvas above it (z-index 16); a 2D
// `difference` fill can only see the pixels in its own bitmap, which are the
// speed lines and nothing else, so it would inverse-tint the spokes and leave
// the mountain exactly as it was. The inversion has to happen where the two
// canvases meet, and that is the compositor.
//
// So: `mix-blend-mode: difference` on the overlay ELEMENT, for the flash frames
// only. Both canvases are position:fixed children of <body> (`body.play canvas`
// in play.css pins them; slBuild appends this one to body, or before the HUD
// root which is also a body child), body has no `isolation`, no `opacity`, no
// `filter` and no transform — so the overlay is a compositing sibling of the
// WebGL canvas in the root stacking context and its backdrop IS the drawn
// scene. The `filter: invert()` fallback §2 allows is not needed and is not
// used; it would also have been worse, because it inverts the WebGL canvas ONLY
// and would leave the vignette at z 15 uninverted on top of an inverted world.
//
// `mixBlendMode` is written only when it CHANGES, so a burst is two style
// writes (on at the first flash frame, off at the ninth) and not one per frame.
//
// ---- specs/0054 §1a: THE MODE HAD TO MOVE WITH THE COLOUR.
//
// Greg wants that tint red. `difference` cannot deliver red, because it is not a
// tint at all — it is |backdrop - source|, and the orange is an ACCIDENT of a
// blue-white mountain being inverted. Put a red rect through it and a blue sky
// comes back blue (|0.55,0.72,0.92 - 0.90,0.12,0.09| = 0.35,0.60,0.83). There is
// no red rect that makes `difference` red on an arbitrary backdrop.
//
// `hard-light` can, and it is the only mode of the set that keeps both things
// 0035 was buying. Source `rgba(230,30,24)`: R = 0.902 is over 0.5, so the red
// channel goes through SCREEN and comes back near 1; G and B are under 0.5, so
// they go through MULTIPLY at 0.24/0.19 and collapse. Every backdrop lands in
// the red band, and because two of three channels are multiplied the mean
// luminance DROPS the way the inversion's did (a plain `screen` or a
// source-over veil would have pushed it up). And white is a fixed point —
// `hard-light(b, 1) = screen(b, 1) = 1` — so the burst's own white lines, drawn
// ON TOP of the rect inside this canvas, still come out white instead of
// disappearing the way they would under a straight `multiply`. Black is a fixed
// point too, which is why §4's vignette can sit above this element unharmed.
//
// Everything else about the mechanism is 0035's, unchanged: the element, not
// `globalCompositeOperation` (a 2D composite only sees this canvas's own
// pixels, so it would tint the spokes and leave the mountain alone); the rect
// first and the lines after; one style write per change; and every path that
// ends the overlay's frame clears it, because a blend mode left standing on a
// canvas nobody is drawing into any more would tint the whole world for good.
function imBlend(on) {
  const cv = S.cv;
  if (!cv) return;
  const want = on ? 'hard-light' : '';
  if (cv.style.mixBlendMode !== want) cv.style.mixBlendMode = want;
}

// ------------------------------------------------- specs/0054 §4: DARK BORDERS
//
// "also dark screen borders would be cool and they fade as wipeout ends."
//
// WHY THIS IS CSS AND NOT A DRAW. The obvious build is a cached radial gradient
// filled over the frame inside `imDraw`, next to the flash rect. It was measured
// against this one and it loses twice. First, cost: a full-screen gradient
// `fillRect` at 1280x720xdpr is the single most expensive thing this module
// could do per frame, and unlike the burst it would have to happen on EVERY
// frame of a 2.0 s tumble rather than on 25 frames of a 0.42 s burst. Second,
// lifetime: the canvas sleeps at `DUR` today (`imStep` returns false and
// `slUpdate` hides the element), and a vignette drawn into it would have to hold
// the whole overlay — clear, field walk, draw path — open five times longer for
// the sake of one gradient. An element whose `opacity` is the only thing that
// moves is a compositor-only change: no repaint, no relayout, one property
// write per frame, and the canvas goes back to sleep exactly when it used to.
// It is the same argument the always-on `.pfx-vignette` (z 15, `init`) was built
// on, and the numbers are in `__impact.state().vignette.ms`.
//
// z 17 IS LOAD-BEARING. It is ABOVE the lines canvas (z 16) and below the
// instrument HUD (z 20). Below the canvas it would be part of the FLASH's
// backdrop, and `hard-light` would turn its dark corners into the brightest red
// in the frame — the exact opposite of "dark borders". Above it, the borders
// stay dark through the flash and the HUD stays readable over both.
//
// THE CLOCK IS THE TUMBLE'S, not one of ours: `ctrl.wipeT`, the same counter
// 0034 lengthened and the same one `imStep`'s edge is read off. So a wipe that
// is cut short — a respawn, a reset — takes the borders with it in the same
// frame, and if `WIPE.LEN` ever moves the fade moves with it, with no constant
// here to fall out of step.
const VG = {
  on: false,            // armed by a wipe edge, disarmed when wipeT runs out
  str: 0,               // the impact's own strength, 0..1 (VIG.MIN..VIG.MAX)
  a: 0,                 // ...and what is on the element right now
  span: 0,              // the wipe span at the moment of the hit, for the rise
  el: null,             // built lazily: a run with no wipe in it has no element
  cost: new Float32Array(240), ci: 0, cn: 0,
};

// Built on the FIRST wipe of a session and never before, so a clean-frame probe
// or a no-wipe contract lane has nothing in the DOM to diff against main.
function vgBuild() {
  if (VG.el || typeof document === 'undefined') return;
  try {
    const v = document.createElement('div');
    v.className = 'pfx-wipe-vignette';
    v.setAttribute('aria-hidden', 'true');
    v.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;' +
      'z-index:17;display:none;opacity:0;will-change:opacity;' +
      'background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 30%,' +
      `rgba(5,7,14,0.30) 62%,rgba(2,3,9,${IM.VIG.PEAK}) 100%);`;
    const anchor = R.hud && R.hud.root && R.hud.root.parentNode === document.body ? R.hud.root : null;
    if (anchor) document.body.insertBefore(v, anchor);
    else document.body.appendChild(v);
    VG.el = v;
  } catch { R.errors++; }
}

// ARM, on the same edge and off the same pre-scrub speed as the burst, so the
// borders and the frame are one event and scale together.
function vgArm(speedMs, span) {
  const u = clamp(Math.max(0, +speedMs || 0) / IM.FLASH_V, 0, 1);
  VG.str = IM.VIG.MIN + (IM.VIG.MAX - IM.VIG.MIN) * u;
  VG.span = span > 0 ? span : 0;
  VG.on = true;
}

// ...and the whole per-frame cost of the effect. A PURE FUNCTION of `wipeT` and
// the armed strength: nothing here integrates, so a suppressed frame, a paused
// frame or a dropped frame cannot leave the borders stuck on or half-faded.
function vgStep(paused) {
  const t0 = performance.now();
  const c = R.ctrl;
  const wt = c ? c.wipeT : 0;
  // `hold` is the burst's TEST-ONLY door and it opens for the borders too: it is
  // how a paused headless page photographs an effect whose whole job is to be on
  // screen while the game runs. It cannot move a body or a payout, and outside a
  // harness it is null, so `slHidden` governs exactly as it did.
  const forced = IMS.hold != null;
  let a = 0;
  if (VG.on && wt > 0 && (forced || !slHidden(paused))) {
    const el = VG.span > 0 ? VG.span - wt : 0;                 // s since the hit
    const r0 = IM.VIG.RISE0;
    const rise = IM.VIG.IN > 0 ? r0 + (1 - r0) * clamp(el / IM.VIG.IN, 0, 1) : 1;
    // ...and the ease-out over the LAST VIG.OUT seconds of the tumble. `f` is
    // how much of that window is left, so the smoothstep leaves full strength
    // gently and arrives at zero gently, on the frame the get-up finishes.
    const f = clamp(wt / IM.VIG.OUT, 0, 1);
    a = VG.str * rise * (f * f * (3 - 2 * f));
  }
  if (!(wt > 0)) VG.on = false;
  vgPaint(a);
  const ms = performance.now() - t0;
  VG.cost[VG.ci] = ms;
  VG.ci = (VG.ci + 1) % VG.cost.length;
  if (VG.cn < VG.cost.length) VG.cn++;
  return VG.on;
}

function vgPaint(a) {
  const q = +Math.max(0, a).toFixed(3);
  if (q === VG.a && (q > 0 || VG.el === null || VG.el.style.display === 'none')) return;
  VG.a = q;
  if (q <= 0) {
    if (VG.el) { VG.el.style.opacity = '0'; VG.el.style.display = 'none'; }
    return;
  }
  if (!VG.el) vgBuild();
  if (!VG.el) return;
  if (VG.el.style.display !== 'block') VG.el.style.display = 'block';
  VG.el.style.opacity = String(q);
}

function vgCost(p) {
  if (!VG.cn) return 0;
  const a = Array.prototype.slice.call(VG.cost.subarray(0, VG.cn)).sort((x, y) => x - y);
  return +a[Math.min(a.length - 1, Math.floor(a.length * p))].toFixed(4);
}

// One step. Returns whether the overlay has anything to say this frame.
//
// 0054 §4 wraps it: the borders outlive the burst by a factor of five, so they
// are stepped on EVERY frame this is called on and not only on the ones the
// burst is alive for — and their own liveness does NOT hold the canvas open,
// because they are not on the canvas.
function imStep(dt, paused) {
  const on = imStepBurst(dt, paused);
  vgStep(paused);
  return on;
}

function imStepBurst(dt, paused) {
  const c = R.ctrl;
  if (IMS.hold != null) { imLay(imPhase()); return true; }
  const wt = c ? c.wipeT : 0;
  // THE EDGE: ≤ 0 → > 0.5, the same read 0017's audio makes, so the wipe cannot
  // be spent twice or spent on a tumble already in progress.
  if (wt > 0.5 && IMS.prevWipe <= 0) {
    const lt = c.lastTrick;
    imFire(IMS.prevSp, lt && lt.name === 'wipeout' ? (lt.why || null) : null);
    // 0054 §4 — one edge, two effects. The span is read from the controller's
    // own tuning rather than restated, so the fade tracks whatever 0034 (or the
    // next spec) makes the tumble; `wt` is the fallback if that getter is gone.
    const wtun = c.wipeTuning;
    vgArm(IMS.prevSp, wtun && wtun.LEN > 0 ? wtun.LEN : wt);
  }
  IMS.prevWipe = wt;
  // ...and the pre-scrub speed, which is simply "the last frame that was not a
  // wipeout". Sampled here rather than in the emitters because those are gated
  // on gear and this event is not: you can eat it on anything.
  if (!(wt > 0) && c) IMS.prevSp = c.speed() / R.u;
  // EVERY path that ends the overlay's frame clears the blend mode, because
  // `imDraw` — which is where it is turned ON — is only called on the frames
  // this function returns true for. A `difference` left standing on a canvas
  // nobody is drawing into any more would invert the whole world for good.
  if (IMS.live) {
    IMS.t += dt;
    if (IMS.t >= IM.DUR) {
      IMS.live = false; IMS.t = 0; IMS.flashA = 0; IMS.drawn = 0;
      imBlend(false); return false;
    }
  }
  if (!IMS.live) { imBlend(false); return false; }
  // §4: every `slSuppressed` reason still applies — the intro, dev fly, the
  // locker, the gear menu, a pause — and clean-frame alone is 0019's knob to
  // govern, which is exactly what `slHidden` is.
  if (slHidden(paused)) { imBlend(false); return false; }
  imLay(imPhase());
  return true;
}

// ...and the paint, into the speed lines' own context, by the speed lines' own
// method. Called from slUpdate() after the field and after 0006's coloured burst,
// so the impact frame is on top of both: it is the loudest thing on the screen
// for an eighth of a second and then it is gone.
function imDraw(g) {
  // The rect goes down FIRST and the lines on top of it, per §2: with the
  // element in `difference` the whole canvas is one blended layer, so anything
  // painted after the rect is what the compositor inverts at that pixel and the
  // spokes still read as spokes rather than as a rect drawn over them.
  if (IMS.flashA > 0) {
    imBlend(true);
    // 0054 §1a — red, not white. Under `hard-light` this is the tint itself and
    // not a veil: the rect's own alpha is how far the frame is pushed into it.
    g.fillStyle = `rgba(${IM_RED_RGB},${IMS.flashA.toFixed(3)})`;
    g.fillRect(0, 0, S.w, S.h);
  } else {
    imBlend(false);
  }
  const gx = IMS.gx, gb = IMS.gb;
  // 0054 §1b: THREE inks, and the walk is ASCENDING, so white (0–7) goes down
  // first, slate (8–15) over it and red (16–23) last — 0033's rule, that the
  // colour must not be buried under the lines drawn after it. The first two
  // index the field's own table; the third indexes `IM_RED`, because
  // `SL_FILL[16..23]` belongs to 0047's outfit accent and is not ours to read.
  for (let b = 0; b < SL_BUCKETS * 3; b++) {
    let opened = false;
    for (let i = 0; i < IMS.lines; i++) {
      if (gb[i] !== b) continue;
      if (!opened) { g.beginPath(); opened = true; }
      const o = i * 8;
      g.moveTo(gx[o], gx[o + 1]);
      g.lineTo(gx[o + 2], gx[o + 3]);
      g.lineTo(gx[o + 4], gx[o + 5]);
      g.lineTo(gx[o + 6], gx[o + 7]);
      g.closePath();
    }
    if (opened) {
      // specs/0057 §7.3 — the third slot is the burst's OWN ink. A wipeout reads
      // 0054's damage red; a pop off the end of a jib reads 0047's outfit accent,
      // which is `SL_FILL[16..23]` — the eight strings the speed lines already
      // rebuild whenever the worn look changes. No fourth table, no fourth quota
      // slot, and nothing rebuilt per burst.
      g.fillStyle = b < SL_BUCKETS * 2
        ? SL_FILL[b]
        : (IMS.ink3 === 'outfit' ? SL_FILL[b] : IM_RED[b - SL_BUCKETS * 2]);
      g.fill();
    }
  }
}

// The test handle, the shape `__speedlines`, `__aura` and `__sparks` already use.
window.__impact = {
  // §4's two required readings
  count: () => IMS.n,
  last: () => (IMS.last ? { ...IMS.last } : null),
  // ...and what a gate needs beyond them
  live: () => IMS.live || IMS.hold != null,
  drawn: () => IMS.drawn,
  flashAlpha: () => +IMS.flashA.toFixed(3),
  phase: () => +imPhase().toFixed(4),
  t: () => +IMS.t.toFixed(4),
  suppressed: () => slHidden(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
  tuning: IM,
  // 0033 §2's required reading: the per-ink counts of the last burst, as counts
  // and as the shares the spec states them in, alongside the flash so one call
  // answers the acceptance whole. 0035: two inks, and `flashMode` names what the
  // flash now IS, because "flashAlpha 0.85" means the opposite thing under a
  // difference composite than it did under a plain white fill.
  state: () => {
    const n = IMS.lines || 0;
    const pct = (k) => (n ? +(IMS.inkN[k] / n * 100).toFixed(1) : 0);
    return {
      lines: n, speed: IMS.speed, why: IMS.why, live: IMS.live || IMS.hold != null,
      ink: { white: IMS.inkN[0], slate: IMS.inkN[1], red: IMS.inkN[2] },
      inkPct: { white: pct(0), slate: pct(1), red: pct(2) },
      // 0054 §3's mapping, as the burst actually resolved it: `k` is the leg
      // below V_MIN, `lineAlpha` the number the spec's table states, and
      // `redAlpha` the same after RED_K_FLOOR has caught it.
      k: +IMS.k.toFixed(4),
      lineAlpha: +(IM.ALPHA * IMS.k).toFixed(4),
      redAlpha: +(IM.ALPHA * Math.max(IMS.k, IM.RED_K_FLOOR)).toFixed(4),
      // 0054 §3: a flash on EVERY wipeout, so this is always true; `flashA0` is
      // what this burst earned and `flashA` is the ceiling it is measured against.
      flash: !!IMS.flash, flashFrames: IMS.flash ? IM.FLASH_FRAMES : 0,
      // specs/0057 §7.3 — which frame this is. A wipeout is 'red' and inward;
      // a pop off a jib is 'outfit' and outward, and the ink counts above read
      // as white/slate/OUTFIT on that one. Two facts, so a gate can prove the
      // takeoff burst is not borrowing the language of a crash.
      ink3: IMS.ink3, out: !!IMS.out,
      flashMode: 'red-hardlight', flashInk: `rgba(${IM_RED_RGB})`,
      flashA: IM.FLASH_A, flashA0: +IMS.flashA0.toFixed(3),
      flashAlpha: +IMS.flashA.toFixed(3),
      // ...and the blend mode as the DOM actually holds it, so a gate can prove
      // §5's "off outside the flash" from the element rather than from intent
      blend: S.cv ? (S.cv.style.mixBlendMode || '') : '',
      // 0054 §4 — the borders, likewise read off the element and not off intent.
      vignette: {
        on: VG.on, alpha: VG.a, strength: +VG.str.toFixed(3), span: VG.span,
        mode: 'css-opacity', z: 17, el: !!VG.el,
        shown: !!(VG.el && VG.el.style.display === 'block'),
        opacity: VG.el ? (VG.el.style.opacity || '0') : null,
        ms: vgCost(0.5), ms95: vgCost(0.95), samples: VG.cn,
      },
      drawn: IMS.drawn, phase: +imPhase().toFixed(4), count: IMS.n,
    };
  },
  vignette: () => VG.a,
  vignetteMs: () => ({ p50: vgCost(0.5), p95: vgCost(0.95), n: VG.cn }),
  reset: () => {
    IMS.live = false; IMS.t = 0; IMS.hold = null; IMS.drawn = 0; IMS.flashA = 0;
    IMS.flashA0 = 0; IMS.k = 1; IMS.lines = 0; IMS.inkN = [0, 0, 0];
    IMS.prevWipe = 0; imBlend(false);
    VG.on = false; VG.str = 0; VG.span = 0; vgPaint(0);
    return true;
  },
  // TEST-ONLY WRITES. `fire` arms a burst at a stated speed; `hold` pins its
  // clock (seconds since the hit) and forces the overlay visible; `step` is the
  // harness door `__sparks.step` opened for exactly the same reason — main.js
  // drives `__playFX.update()` off the rAF line, which `stepFixed` does not run,
  // and stepFixed has to pause the game to be deterministic at all.
  fire: (speed, why) => imFire(speed === undefined ? IM.V_MAX : speed, why || 'tree'),
  // lays the frame straight away, so a caller can read `drawn`/`flashAlpha` back
  // without first waiting for a requestAnimationFrame it has no handle on
  hold: (s) => {
    IMS.hold = s == null ? null : Math.max(0, +s || 0);
    if (IMS.hold != null) imLay(imPhase());
    else imBlend(false);          // letting go of the clock also lets go of §2's blend
    return IMS.hold;
  },
  step: (dt, paused = false) => imStep(clamp(dt || 0.016, 0.0005, 0.05), !!paused),
};

// ------------------------------------------------------- specs/0059 §8
// THE LANDING RING — a ring of lightning that earthshatters out from under you
// when you land an aura-powered jump.
//
// Greg, 2026-09-05: "Same color as ski aura, can I get a ring of lightning that
// earthshatters out from me when I land from an aura-powered jump; size and
// intensity of ring grows with speed/impact and tricks performed in the air."
//
// WHY A MESH AND NOT A FOURTH CANVAS TENANT. 0033/0035/0054's impact frame, the
// speed lines and 0006's coloured burst lines all live on the 2D fx canvas, and
// a fourth would have been free of a draw call. It cannot be one: this ring is a
// thing lying ON THE MOUNTAIN — it hugs the slope, it stays where you landed
// while you ski away from it, and a 12 m circle round a rider on a 40° face is
// an ellipse whose shape changes every frame with the camera. That is a world
// object, and the honest cost of a world object is one draw call. It is ONE
// additive Mesh with a fixed-topology buffer (no per-frame allocation, no
// re-index, no shader), so the draw call is all it costs.
//
// EVERYTHING BELOW IS SELF-CONTAINED. §8 touches the rest of fx.js in exactly
// two places — `ringStep(dt, paused)` in `update()`, and `ringArm(a)` at the end
// of `auraFire()`, which is the takeoff edge and the one fact §8 cannot measure
// for itself. Both are one line and both are cited.
const RING_ON = true;             // the kill switch, the shape 0006's FX_AURA_ON has
const RING = {
  // ---- WHAT ARMS IT: "an aura-powered jump".
  //
  // The aura already answers this exactly. `auraFire(e)` is 0006 §2.2's CONSUMED
  // edge — the takeoff that spent the bank — and `e` is `max(A.p, paid)`: the
  // flame that was standing on the skis when you left the lip, or the lip charge
  // the takeoff actually paid out, whichever is larger, both normalised the same
  // way. So "the ski flame/aura was active at takeoff" is `e >= ARM_E` and there
  // is no second definition of jump power anywhere in this file.
  ARM_E: 0.20,        // ...above AU.MIN_E, and above the aura's own visible floor:
                      // a flameless roll-off arms nothing at all
  MIN_AIR: 0.18,      // s — and you have to have LEFT THE GROUND. A pump payout on
                      // a groomer fires auraFire() without ever going airborne.
  // ---- THE SPEED TERM, and it is TWO measures MAXED, never summed — the rule
  // `bankState()` states for bank against charge, for the same reason: they are
  // different currencies. `vn` is how hard you hit the ground, `sp` is how fast
  // you were going, and a 40 m/s stomp onto a face that falls away under you is
  // maximal on one and modest on the other.
  //
  // `vn` is rider/land-pop's number to the digit: `max(0, -(v · n))`, the closing
  // speed along the GROUND NORMAL, not `-prevVy`. On this mountain every Gold
  // Coast roller lands at -prevVy 6…17 purely because the ground falls away
  // (rider.js §"THE POP AND THE THREE LANDING TIERS"), which would read as a
  // stomp at every touchdown. VN_MIN/VN_MAX are that file's LAND_SOFT and
  // LAND_HARD — fx.js:2166's own burst gate, and IM.FLASH_V.
  VN_MIN: 2.5, VN_MAX: 12.0,
  SP_MIN: 8.0,        // m/s — SL.ON_AT, the speed lines' own "below this there is nothing"
  SP_MAX: 40.0,       // m/s — Greg's own ceiling ("a 720 stomped at 40 m/s is the max")
  // ---- THE TRICK TERM. tricks.js's landing verdict, and only when it is THIS
  // landing's: `S.last` is compared by REFERENCE, the same identity test
  // rider.js's `_lastJudged` uses, because a stale verdict from the jump before
  // would light a ring on a straight air.
  DEG_FULL: 720,      // ° — Greg's own ceiling. `deg` is hypot(spin, flip), tricks.js state()
  SKETCHY: 0.60,      // a sketchy landing scores 0.5 of the points; it lights 0.6 of the ring
  // the two weights, and they sum to 1 so `k` needs no renormalising
  W_SPEED: 0.60, W_TRICK: 0.40,
  // ---- WHAT k BUYS. Every row is a straight lerp on k, and the two ends are
  // Greg's two anchors: "a small clean air the min: ~3 m, ~0.4 s" and "a 720
  // stomped at 40 m/s is the max: radius ~12 m, ~1 s".
  R_MIN: 3.0,  R_MAX: 12.0,     // m — the ring's final radius
  T_MIN: 0.40, T_MAX: 1.00,     // s — how long it lives
  A_MIN: 5,    A_MAX: 14,       // arcs of lightning round the circumference
  W_MIN: 0.16, W_MAX: 0.45,     // m — the band's thickness at birth
  B_MIN: 0.75, B_MAX: 1.00,     // the band's opacity multiplier at birth
  C_MIN: 3,    C_MAX: 9,        // radial crack lines
  P_MIN: 24,   P_MAX: 120,      // the snow puff at the front, in particles
  // ---- shape
  SEG: 96,            // band segments round the circle (fixed topology)
  CSEG: 3,            // quads per crack: a crack is a JAGGED POLYLINE, not a ray.
                      // One quad per crack drew a long thin triangle out of the
                      // rider's feet and the whole effect read as a starburst.
  CMAX: 30,           // crack quads allocated — must be >= C_MAX × CSEG
  GSEG: 16,           // GROUND PROBES PER FRAME. The whole per-frame cost that is
                      // not arithmetic. Interpolated round SEG, and banked into a
                      // radial profile as the front sweeps out, so the cracks get
                      // terrain for free rather than costing probes of their own.
  PSTEP: 8,           // radial stations in that profile
  PROBE_UP: 3.0,      // m — how far above the last known height each probe starts
  LIFT: 0.06,         // m — off the snow, so an additive band does not z-fight it
  GROW: 2.2,          // r = R · (1 − (1 − a)^GROW): fast out, decelerating. An
                      // earthshatter leaves at once and slows; a ripple does not.
  FADE: 1.0,          // env = (1 − a)^FADE
  HOLD: 0.35,         // ...and the alpha only fades to HOLD + (1 − HOLD)·env, so the
                      // bolt is still a bolt at three quarters of its life. At a bare
                      // env it was a ghost by 0.4 s — measured, first strip.
  THIN: 0.60,         // the band thins to (1 − THIN) of its birth width by the end
  JAG: 1.05,          // × width — the radial wobble that makes it a bolt, not a hoop
  RISE: 0.30,         // × width — and the vertical one
  SMOOTH: 1,          // passes of the 1-2-1 over the jag. TWO made a smooth ellipse;
                      // one leaves the kinks a bolt is made of.
  COVER0: 0.42, COVER1: 0.66,   // fraction of the circumference the arcs cover, at k 0…1
  CRACK_IN: 0.26,     // cracks START this far out — a clear gap round the boots, so
                      // they are damage in the snow and not spikes out of the rider
  CRACK_R: 0.52,      // ...and reach this fraction of the front. WELL INSIDE it: a
                      // crack is what the ring left behind, not a ray
  CRACK_W: 0.26,      // × band width at the inner end — a crack is widest where it
                      // started and tapers to a point
  CRACK_TIP: 0.12,    // × CRACK_W at the outer tip
  CRACK_JAG: 0.85,    // × the crack's own width — how far each joint steps sideways
  CRACK_A: 0.92,      // × the band's alpha — a crack has to actually darken the snow
  CRACK_DARK: 0.18,   // ...and a crack in snow is DARK: the accent this far toward black
  CORE: 0.80,         // the INNER edge is this much white over the ski accent — the
                      // bolt's hot core. The outer edge stays the ski's own colour,
                      // so one quad carries the whole white-hot-to-accent gradient.
  PUFF_T: 0.22,       // s — the spray at the front runs for this long
  PUFF_RATE: 90,      // /s at k = 1, on top of the birth puff
};
const RG = {
  built: false, mesh: null, mat: null, geo: null,
  pos: null, col: null,                  // the two attributes, written in place
  on: false, t: 0, dur: 0, k: 0,
  ox: 0, oy: 0, oz: 0,                   // the landing point, world
  nx: 0, ny: 1, nz: 0,                   // and the surface it landed on
  rMax: 0, w0: 0, bright: 0, arcs: 0, cracks: 0,
  jag: null, rise: null, live: null,     // per-segment, regenerated per fire
  crA: null, crJ: null,                  // per-crack bearing and jag
  gy: null, prof: null,                  // GSEG heights this frame; GSEG×PSTEP profile
  puffT: 0, puffAcc: 0,
  // the arm/edge machinery, with its OWN velocity history (see ringStep)
  arm: 0, airT: 0, pg: true, pend: null, pLast: null,
  pvx: 0, pvy: 0, pvz: 0,
  // cost
  ms: 0, cost: new Float32Array(240), ci: 0, cn: 0,
  fires: 0, last: null,
};

function ringBuild() {
  const T = R.THREE;
  if (!T || !R.scene || RG.built) return RG.built;
  const quads = RING.SEG + RING.CMAX, verts = quads * 6;
  RG.pos = new Float32Array(verts * 3);
  RG.col = new Float32Array(verts * 4);
  RG.geo = new T.BufferGeometry();
  RG.geo.setAttribute('position', new T.BufferAttribute(RG.pos, 3));
  // FOUR components, and that is the whole reason this needs no shader: three
  // defines USE_COLOR_ALPHA off the attribute's own itemSize and multiplies
  // `diffuseColor` by `vColor` INCLUDING its alpha, so one buffer carries both
  // the palette and the fade.
  RG.geo.setAttribute('color', new T.BufferAttribute(RG.col, 4));
  // NORMAL BLENDING, not additive, and the first cut got this wrong. Additive
  // light cannot be coloured ON SNOW: the ground is already at ~0.85 white, so
  // adding any hex clips all three channels and every ring rendered white
  // whatever ski was on (measured — four skis, four accents, one white ring).
  // A blended band keeps its hue against a bright background and lets the cracks
  // be DARKER than the snow, which is what a crack in snow is.
  RG.mat = new T.MeshBasicMaterial({
    vertexColors: true, transparent: true,
    depthWrite: false, side: T.DoubleSide, toneMapped: false,
  });
  RG.mesh = new T.Mesh(RG.geo, RG.mat);
  RG.mesh.name = 'fx:landing-ring';
  RG.mesh.frustumCulled = false;         // one mesh, and its bounds move every frame
  RG.mesh.renderOrder = 11;
  RG.mesh.visible = false;
  R.scene.add(RG.mesh);
  RG.jag = new Float32Array(RING.SEG + 1);
  RG.rise = new Float32Array(RING.SEG + 1);
  RG.live = new Uint8Array(RING.SEG);
  RG.crA = new Float32Array(RING.CMAX);
  RG.crJ = new Float32Array(RING.CMAX * 4);   // CSEG+1 joints' sideways jog per crack
  RG.gy = new Float32Array(RING.GSEG);
  RG.prof = new Float32Array(RING.GSEG * RING.PSTEP);
  RG.built = true;
  return true;
}

// specs/0059 §2 — the takeoff edge, latched. Called from `auraFire()`, which is
// the ONE place this file already knows a jump was paid for. It cannot fire a
// ring on its own: it only says how much flame left the lip.
function ringArm(e) {
  if (!RING_ON) return;
  if (e > RG.arm) RG.arm = e;
}

// §3 — the shape of one fire, regenerated per event so no two rings are the same
// bolt. All of it lands in arrays that already exist.
function ringShape() {
  const S = RING.SEG;
  // the jag is SMOOTHED round the ring — raw per-segment noise is a sawtooth and
  // reads as static, the same lesson 0056 §2's normal quantiser learned
  for (let i = 0; i <= S; i++) { RG.jag[i] = rand(-1, 1); RG.rise[i] = rand(-1, 1); }
  RG.jag[S] = RG.jag[0]; RG.rise[S] = RG.rise[0];        // close the loop
  for (let pass = 0; pass < RING.SMOOTH; pass++) {
    let pj = RG.jag[S - 1], pr = RG.rise[S - 1];
    for (let i = 0; i < S; i++) {
      const nj = RG.jag[(i + 1) % S], nr = RG.rise[(i + 1) % S];
      const cj = RG.jag[i], cr = RG.rise[i];
      RG.jag[i] = (pj + cj * 2 + nj) * 0.25; RG.rise[i] = (pr + cr * 2 + nr) * 0.25;
      pj = cj; pr = cr;
    }
    RG.jag[S] = RG.jag[0]; RG.rise[S] = RG.rise[0];
  }
  // ---- the ARCS. `live[i]` says whether segment i belongs to one; a segment
  // that does not is written as a DEGENERATE quad (four coincident corners), so
  // the gaps in the ring cost the same fixed buffer and no branch in the draw.
  RG.live.fill(0);
  const cover = RING.COVER0 + (RING.COVER1 - RING.COVER0) * RG.k;
  const per = S / RG.arcs;
  for (let a = 0; a < RG.arcs; a++) {
    const len = Math.max(2, Math.round(per * cover * rand(0.6, 1.35)));
    const slack = per - len > 0 ? per - len : 0;
    const st = Math.round(a * per + rand(0, slack));
    for (let j = 0; j < len; j++) RG.live[(st + j) % S] = 1;
  }
  for (let c = 0; c < RG.cracks; c++) {
    RG.crA[c] = (c + rand(0.15, 0.85)) * (Math.PI * 2 / RG.cracks);
    RG.crJ[c * 4] = 0;                                    // the root does not wander
    for (let j = 1; j <= RING.CSEG; j++) RG.crJ[c * 4 + j] = rand(-1, 1);
  }
}

// §4 — fire. `k` is the one number §1's table is a function of.
function ringFire(k, x, y, z, nx, ny, nz, inp) {
  if (!RING_ON || !ringBuild()) return null;
  const u = R.u;
  RG.k = clamp(k, 0, 1);
  RG.on = true; RG.t = 0;
  RG.dur = RING.T_MIN + (RING.T_MAX - RING.T_MIN) * RG.k;
  RG.rMax = (RING.R_MIN + (RING.R_MAX - RING.R_MIN) * RG.k) * u;
  RG.w0 = (RING.W_MIN + (RING.W_MAX - RING.W_MIN) * RG.k) * u;
  RG.bright = RING.B_MIN + (RING.B_MAX - RING.B_MIN) * RG.k;
  RG.arcs = Math.round(RING.A_MIN + (RING.A_MAX - RING.A_MIN) * RG.k);
  RG.cracks = Math.round(RING.C_MIN + (RING.C_MAX - RING.C_MIN) * RG.k);
  RG.ox = x; RG.oy = y; RG.oz = z;
  RG.nx = nx; RG.ny = ny; RG.nz = nz;
  RG.puffT = RING.PUFF_T; RG.puffAcc = 0;
  ringShape();
  // the profile starts FLAT AT THE LANDING POINT — near the centre that is not an
  // approximation, it is the ground, and the sweep fills the rest in as it goes
  RG.prof.fill(y);
  for (let b = 0; b < RING.GSEG; b++) RG.gy[b] = y;
  RG.mesh.visible = true;
  RG.fires++;
  // the earth-shatter's own snow: one puff at the foot, sized by k
  const n = Math.round(RING.P_MIN + (RING.P_MAX - RING.P_MIN) * RG.k);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(0.5, 2.6) * u;
    emit(x + Math.cos(a) * rand(0.1, 0.6) * u, y + rand(0.05, 0.5) * u, z + Math.sin(a) * rand(0.1, 0.6) * u,
         Math.cos(a) * s, rand(0.6, 3.0) * u * (0.5 + RG.k), Math.sin(a) * s,
         rand(0.5, 1.2), rand(0.09, 0.26) * u, rand(0.5, 0.95));
  }
  RG.last = { k: +RG.k.toFixed(3), r: +(RG.rMax / u).toFixed(2), dur: +RG.dur.toFixed(3),
              arcs: RG.arcs, cracks: RG.cracks, w: +(RG.w0 / u).toFixed(3), bright: +RG.bright.toFixed(3),
              puff: n, colour: hexs(ringAccent()),
              // §3's two inputs as measured at the touchdown, so a gate can hold
              // the mapping table against the numbers that produced it
              vn: inp ? inp.vn : null, sp: inp ? inp.sp : null,
              kS: inp ? inp.kS : null, kT: inp ? inp.kT : null,
              verdict: inp ? inp.verdict : null };
  try { window.__playAudio.auraLand(RG.k); } catch { /* no audio ctx */ }   // specs/0062 §4
  return RG.last;
}

// §5 — one quad into the buffer, as two triangles. `q` is the quad index; the
// four corners go round. A degenerate quad (all four the same point) draws
// nothing, which is how the gaps between arcs are written.
// Corners go round: a and d are the INNER pair, b and c the OUTER one, and the
// two colours are theirs — so a white-hot core against a ski-coloured outer edge
// costs one extra argument and no extra geometry. The vertex order the two
// triangles are written in is a,b,c,a,c,d, hence the 0/3/5 vs 1/2/4 split.
const RQ_IN = [1, 0, 0, 1, 0, 1];
function ringQuad(q, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
                  ir, ig, ib, or_, og, ob, a) {
  const o = q * 18, oc = q * 24;
  const P = RG.pos, C = RG.col;
  P[o] = ax; P[o + 1] = ay; P[o + 2] = az;
  P[o + 3] = bx; P[o + 4] = by; P[o + 5] = bz;
  P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = cz;
  P[o + 9] = ax; P[o + 10] = ay; P[o + 11] = az;
  P[o + 12] = cx; P[o + 13] = cy; P[o + 14] = cz;
  P[o + 15] = dx; P[o + 16] = dy; P[o + 17] = dz;
  for (let i = 0; i < 6; i++) {
    const j = oc + i * 4, inn = RQ_IN[i];
    C[j] = inn ? ir : or_; C[j + 1] = inn ? ig : og; C[j + 2] = inn ? ib : ob; C[j + 3] = a;
  }
}

// the banked radial profile: the height at bearing b, `f` of the way out
function ringProfY(b, f) {
  const s = clamp(f, 0, 1) * (RING.PSTEP - 1);
  const i = Math.min(RING.PSTEP - 2, s | 0), t = s - i;
  const o = b * RING.PSTEP;
  return RG.prof[o + i] * (1 - t) + RG.prof[o + i + 1] * t;
}

// §6 — the step. Called once a frame from update(), and by `__ring.step` so a
// headless stepFixed() walk sees the same ring a player does.
function ringStep(dt, paused) {
  if (!RING_ON) return false;
  const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  try {
    const c = R.ctrl, u = R.u;
    if (!c || !R.THREE || !R.scene) return false;
    // ---- THE EDGE MACHINERY. Its own grounded/velocity history, deliberately:
    // `R.prevGrounded` is the emitters' and is moved further down update(), and
    // two readers of one edge is a bug where one of them silently never fires.
    const gnd = !!c.grounded;
    const v = c.velocity;
    if (!paused) {
      // ---- THE ONE-STEP DEFER, and it is consumed BEFORE a new one is taken.
      // specs/0059 §2: "never fires on a wipeout — the impact frame owns that".
      // `wipeout()` runs AFTER the landing test inside controller.update(), so on
      // the crash frame itself `wipeT` is still 0 and a ring fired there would be
      // a ring on a wipeout. One step later the verdict is in. 16 ms is invisible;
      // a lightning ring round a body that is already tumbling is not.
      if (RG.pend) {
        const P = RG.pend; RG.pend = null;
        if (gnd && !(c.wipeT > 0) && P.verdict !== 'wipe' && !(c.snow && c.snow.frozen)) {
          const n = c.groundNormal ? c.groundNormal() : null;
          ringFire(P.k, P.x, P.y, P.z, n ? n.x : 0, n ? n.y : 1, n ? n.z : 0, P);
        }
      }
      if (!gnd) RG.airT += dt; else if (RG.pg) RG.airT = 0;
      // ---- THE TAKEOFF, and it is where the trick verdict is SYNCED. Whatever
      // `tricks.js` last scored at the moment you leave the lip is by definition
      // not this flight's, so latching it here makes the reference test at the
      // landing exact — the same identity test rider.js's `_lastJudged` runs, and
      // it costs one `trickState()` per jump rather than one per frame (which is
      // why fx.js polls it around landings and not always).
      if (!gnd && RG.pg) {
        try {
          const ts = window.__player && window.__player.trickState ? window.__player.trickState() : null;
          RG.pLast = ts ? ts.last : null;
        } catch { RG.pLast = null; }
      }
      // ---- THE LANDING. Everything §2 asks, in the order it can be answered.
      if (gnd && !RG.pg) {
        const armed = RG.arm >= RING.ARM_E && RG.airT >= RING.MIN_AIR;
        RG.arm = 0; RG.airT = 0;
        if (armed && c.mode === 'skis') {
          // the closing speed along the GROUND NORMAL (rider/land-pop), off the
          // velocity the frame ARRIVED with — sampled at the foot of this block,
          // before the ground snap takes vel.y off you
          const n = c.groundNormal ? c.groundNormal() : null;
          const vn = Math.max(0, n ? -(RG.pvx * n.x + RG.pvy * n.y + RG.pvz * n.z) : -RG.pvy) / u;
          const sp = Math.hypot(RG.pvx, RG.pvz) / u;
          const vI = clamp((vn - RING.VN_MIN) / (RING.VN_MAX - RING.VN_MIN), 0, 1);
          const sI = clamp((sp - RING.SP_MIN) / (RING.SP_MAX - RING.SP_MIN), 0, 1);
          const kS = vI > sI ? vI : sI;             // MAXED, never summed
          let kT = 0, verdict = null;
          try {
            const ts = window.__player && window.__player.trickState ? window.__player.trickState() : null;
            const L = ts ? ts.last : null;
            if (L && L !== RG.pLast) {              // by REFERENCE: this flight's, or none
              verdict = L.verdict;
              if (verdict !== 'wipe') {
                kT = clamp((L.deg || 0) / RING.DEG_FULL, 0, 1) * (verdict === 'sketchy' ? RING.SKETCHY : 1);
              }
            }
            RG.pLast = L;
          } catch { kT = 0; }
          const k = clamp(RING.W_SPEED * kS + RING.W_TRICK * kT, 0, 1);
          const p = c.position;
          RG.pend = { k, x: p.x, y: p.y, z: p.z, verdict, vn: +vn.toFixed(2), sp: +sp.toFixed(2), kS: +kS.toFixed(3), kT: +kT.toFixed(3) };
        }
      }
      if (v) { RG.pvx = v.x; RG.pvy = v.y; RG.pvz = v.z; }
      RG.pg = gnd;
    }
    if (!RG.on) return true;
    if (paused) return true;                        // a paused page draws but does not step
    RG.t += dt;
    const a = RG.t / RG.dur;
    if (a >= 1) { RG.on = false; if (RG.mesh) RG.mesh.visible = false; return true; }
    // ---- the front, and the envelope
    const grow = 1 - Math.pow(1 - a, RING.GROW);
    const r = RG.rMax * grow;
    const env = Math.pow(1 - a, RING.FADE);
    const w = RG.w0 * (1 - RING.THIN * a);
    // ---- THE GROUND, GSEG probes, and the profile they bank as the front sweeps.
    // `groundAt` writes the shared normal `groundNormal()` hands out (collision.js),
    // so the LAST probe of the frame is the rider's own foot: whatever reads the
    // normal after fx.js gets the surface it was standing on, not the one 12 m
    // downhill. One extra ray, and the alternative is a whole second collision API.
    const col = (typeof window !== 'undefined' && window.__playCollision) || null;
    const band = Math.min(RING.PSTEP - 1, Math.round(grow * (RING.PSTEP - 1)));
    if (col && col.groundAt) {
      for (let b = 0; b < RING.GSEG; b++) {
        const th = b * (Math.PI * 2 / RING.GSEG);
        const x = RG.ox + Math.cos(th) * r, z = RG.oz + Math.sin(th) * r;
        let gy = null;
        try { gy = col.groundAt(x, z, RG.gy[b] + RING.PROBE_UP * u); } catch { gy = null; }
        if (gy == null) { try { gy = col.groundAt(x, z, RG.oy + 40 * u); } catch { gy = null; } }
        if (gy != null) RG.gy[b] = gy;
        RG.prof[b * RING.PSTEP + band] = RG.gy[b];
      }
      try { col.groundAt(c.position.x, c.position.z, c.position.y + 2 * u); } catch { /* nothing under us */ }
    } else {
      // no collision module (the locker, a bare page): the landing's tangent plane
      for (let b = 0; b < RING.GSEG; b++) {
        const th = b * (Math.PI * 2 / RING.GSEG);
        const dx = Math.cos(th) * r, dz = Math.sin(th) * r;
        RG.gy[b] = RG.ny > 1e-3 ? RG.oy - (dx * RG.nx + dz * RG.nz) / RG.ny : RG.oy;
        RG.prof[b * RING.PSTEP + band] = RG.gy[b];
      }
    }
    // ---- the colours. THE SKI PALETTE: `A.colour` is `skiAccent(id)`, the
    // EQUIPPED SKI's accent untinted — the same number `__aura.colour()` prints
    // and the one the aura is going back to. Not `A.tint` (0047's outfit blend)
    // and not `A.bodyNow`: the ring and the flame are one palette by construction,
    // read from one field, so neither can drift from the other.
    // ...and it is the LIT accent, `litHex` (specs/0057 §7.2): the ski rack has
    // black-based topsheets whose accent is a near-black, and a near-black bolt
    // on white snow is a smudge. `litHex` scales the channels until the peak one
    // is full, which is that accent's own hue at snow's brightness — the exact
    // question 0057 asked of the same rack and answered the same way.
    const acc = litHex(ringAccent());
    const ar = ((acc >> 16) & 255) / 255, ag = ((acc >> 8) & 255) / 255, ab = (acc & 255) / 255;
    const alpha = clamp(RG.bright * (RING.HOLD + (1 - RING.HOLD) * env), 0, 1);
    const cr = ar + (1 - ar) * RING.CORE, cg = ag + (1 - ag) * RING.CORE, cb = ab + (1 - ab) * RING.CORE;
    const S = RING.SEG, lift = RING.LIFT * u;
    const gper = RING.GSEG / S;
    for (let i = 0; i < S; i++) {
      if (!RG.live[i]) { ringQuad(i, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); continue; }
      const th0 = i * (Math.PI * 2 / S), th1 = (i + 1) * (Math.PI * 2 / S);
      const j0 = RG.jag[i] * RING.JAG * w, j1 = RG.jag[i + 1] * RING.JAG * w;
      const y0 = ringGy(i * gper) + lift + RG.rise[i] * RING.RISE * w;
      const y1 = ringGy((i + 1) * gper) + lift + RG.rise[i + 1] * RING.RISE * w;
      const ri0 = r + j0 - w * 0.5, ro0 = r + j0 + w * 0.5;
      const ri1 = r + j1 - w * 0.5, ro1 = r + j1 + w * 0.5;
      const c0 = Math.cos(th0), s0 = Math.sin(th0), c1 = Math.cos(th1), s1 = Math.sin(th1);
      ringQuad(i,
        RG.ox + c0 * ri0, y0, RG.oz + s0 * ri0,
        RG.ox + c0 * ro0, y0, RG.oz + s0 * ro0,
        RG.ox + c1 * ro1, y1, RG.oz + s1 * ro1,
        RG.ox + c1 * ri1, y1, RG.oz + s1 * ri1,
        cr, cg, cb, ar, ag, ab, alpha);
    }
    // ---- THE CRACKS. Radial, jagged, and DARK — `CRACK_DARK` of the accent,
    // which under normal blending is a line darker than the snow it is drawn on.
    // That is the earth-shatter: the ring is the bolt and the cracks are what it
    // opened. They sit at CRACK_R of the front, well inside it, because a crack
    // is what the ring LEFT BEHIND and not a ray coming out of the rider.
    const cw = w * RING.CRACK_W, ca = alpha * RING.CRACK_A, cd = RING.CRACK_DARK;
    const dr = ar * cd, dg = ag * cd, db = ab * cd;
    let quad = S;
    for (let q = 0; q < RG.cracks; q++) {
      const th = RG.crA[q], ct = Math.cos(th), st = Math.sin(th);
      const px = -st, pz = ct;                       // across the crack
      const bidx = Math.min(RING.GSEG - 1, (th / (Math.PI * 2 / RING.GSEG)) | 0);
      const r0 = r * RING.CRACK_IN, r1 = r * RING.CRACK_R;
      // CSEG segments along the bearing, each joint stepped sideways by its own
      // stored jog and each one narrower than the last: a crack that forks away
      // from straight and closes to a point.
      for (let k = 0; k < RING.CSEG; k++) {
        const t0 = k / RING.CSEG, t1 = (k + 1) / RING.CSEG;
        const ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
        const ja = RG.crJ[q * 4 + k] * cw * RING.CRACK_JAG, jb = RG.crJ[q * 4 + k + 1] * cw * RING.CRACK_JAG;
        const wa = cw * (1 - (1 - RING.CRACK_TIP) * t0), wb = cw * (1 - (1 - RING.CRACK_TIP) * t1);
        const ya = ringProfY(bidx, ra / Math.max(1e-4, RG.rMax)) + lift;
        const yb = ringProfY(bidx, rb / Math.max(1e-4, RG.rMax)) + lift;
        const axc = RG.ox + ct * ra + px * ja, azc = RG.oz + st * ra + pz * ja;
        const bxc = RG.ox + ct * rb + px * jb, bzc = RG.oz + st * rb + pz * jb;
        ringQuad(quad++,
          axc + px * wa, ya, azc + pz * wa,
          axc - px * wa, ya, azc - pz * wa,
          bxc - px * wb, yb, bzc - pz * wb,
          bxc + px * wb, yb, bzc + pz * wb,
          dr, dg, db, dr, dg, db, ca);
      }
    }
    for (; quad < S + RING.CMAX; quad++) ringQuad(quad, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    RG.geo.attributes.position.needsUpdate = true;
    RG.geo.attributes.color.needsUpdate = true;
    // ---- the spray at the front. Budgeted by count, not by rate, and it stops
    // after PUFF_T: the ring outruns the snow it kicked up almost at once.
    if (RG.puffT > 0) {
      RG.puffT -= dt;
      RG.puffAcc += RING.PUFF_RATE * RG.k * dt;
      let n = RG.puffAcc | 0;
      if (n > 12) n = 12;                            // per frame, hard
      RG.puffAcc -= n;
      for (let i = 0; i < n; i++) {
        const b = (Math.random() * RING.GSEG) | 0;
        const th = b * (Math.PI * 2 / RING.GSEG) + rand(-0.2, 0.2);
        const x = RG.ox + Math.cos(th) * r, z = RG.oz + Math.sin(th) * r;
        emit(x, RG.gy[b] + rand(0.05, 0.4) * u, z,
             Math.cos(th) * rand(0.6, 2.4) * u, rand(0.8, 3.0) * u, Math.sin(th) * rand(0.6, 2.4) * u,
             rand(0.4, 0.95), rand(0.08, 0.22) * u, rand(0.45, 0.85));
      }
    }
    return true;
  } catch { R.errors++; return false; } finally {
    RG.ms = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
    if (RG.on || RG.pend) { RG.cost[RG.ci] = RG.ms; RG.ci = (RG.ci + 1) % RG.cost.length; if (RG.cn < RG.cost.length) RG.cn++; }
  }
}

// specs/0059 §5 — THE SKI PALETTE, and the one place it is resolved.
//
// `A.colour` is `skiAccent(id)`, the equipped ski's accent untinted, and the
// aura keeps it current — but `auraDress()` runs inside `auraStep()`, BEHIND
// `auHidden(paused)`, so a page that has been paused across a ski change carries
// the accent of the ski before it (measured: four skis, four different accents,
// one hex). The ring is a world object and does not get to be stale, so it asks
// the same function the aura asks whenever the two disagree. Same source, same
// number, and no write into the aura's own state.
function ringAccent() {
  try {
    const id = A.skiId && A.skiId();
    if (id && id !== A.id) return skiAccent(id);
  } catch { /* no rack on this page */ }
  return A.colour;
}

// the ground height a fractional bearing station away, wrapped
function ringGy(fb) {
  const n = RING.GSEG;
  let f = fb % n; if (f < 0) f += n;
  const i = f | 0, t = f - i;
  return RG.gy[i] * (1 - t) + RG.gy[(i + 1) % n] * t;
}

// specs/0059 §7 — the lab handle, the shape `__aura`, `__gear` and `__impact`
// already use. `fire()` PAINTS a ring of a given size and can move nothing else;
// `cost()` is the measured median, not an assertion.
window.__ring = {
  enabled: () => RING_ON,
  built: () => RG.built,
  on: () => RG.on,
  fires: () => RG.fires,
  // what the last fire was worth, and the arm state behind it
  last: () => (RG.last ? { ...RG.last } : null),
  arm: () => +RG.arm.toFixed(3),
  airT: () => +RG.airT.toFixed(3),
  // live geometry, in METRES, so a test can assert the table rather than pixels
  state: () => (RG.on ? {
    t: +RG.t.toFixed(3), dur: +RG.dur.toFixed(3), k: +RG.k.toFixed(3),
    r: +((RG.rMax * (1 - Math.pow(1 - RG.t / RG.dur, RING.GROW))) / R.u).toFixed(3),
    rMax: +(RG.rMax / R.u).toFixed(3), arcs: RG.arcs, cracks: RG.cracks,
    env: +Math.pow(1 - RG.t / RG.dur, RING.FADE).toFixed(4),
  } : null),
  // the palette it is painted in, and the one the aura is painted in: the SAME
  // field, which is the whole of specs/0059 §5
  colour: () => hexs(ringAccent()),
  // the ground it is hugging, this frame — GSEG heights in metres
  ground: () => Array.prototype.slice.call(RG.gy).map((y) => +(y / R.u).toFixed(3)),
  fire: (k, x, y, z) => {
    const c = R.ctrl;
    const p = c ? c.position : { x: 0, y: 0, z: 0 };
    const n = (c && c.groundNormal) ? c.groundNormal() : null;
    return ringFire(clamp(+k || 0, 0, 1), x == null ? p.x : x, y == null ? p.y : y, z == null ? p.z : z,
                    n ? n.x : 0, n ? n.y : 1, n ? n.z : 0);
  },
  // §8's whole per-frame cost while it is up, measured the way `__aura` measures
  // its own: p50 and p95 of the samples taken around this module's one step
  cost: () => {
    if (!RG.cn) return { n: 0, p50: 0, p95: 0 };
    const s = Array.prototype.slice.call(RG.cost.subarray(0, RG.cn)).sort((x, y) => x - y);
    return { n: RG.cn, p50: +s[Math.floor(s.length * 0.5)].toFixed(4), p95: +s[Math.min(s.length - 1, Math.floor(s.length * 0.95))].toFixed(4) };
  },
  step: (dt, paused = false) => ringStep(clamp(dt || 0.016, 0.0005, 0.05), !!paused),
};


// ==================================================== specs/0060: THE TINT FRAME
//
// NAMED ADDITIVE BLOCK. Nothing above this line reads `HS`, nothing above it is
// edited by this spec, and `hitstopTint(0)` — the state the module boots in and
// the state every frame outside a dip is in — leaves the DOM exactly as it was.
//
// WHY IT IS CSS AND NOT A `fillRect` ON THE IMPACT CANVAS. This is 0054 §4's
// measurement, on the same shape, and it lands the same way: a full-frame fill at
// 1280x720xdpr is the most expensive thing this module can do in a frame, and the
// lines canvas SLEEPS outside a wipe (`imStep` returns false, `slUpdate` hides the
// element) — drawing the tint there would mean holding the whole overlay open,
// clear and field-walk included, for a 60-120 ms effect that has nothing to do
// with a tumble. An element whose `opacity` is the only thing that moves is a
// compositor-only write: no repaint, no relayout, one property assignment per
// frame. `__impact.state().vignette.ms` is the 0.0007 ms this is copied from.
//
// z 14 IS THE LAYER ORDER THE SPEC ASKS FOR: under the lines canvas (16) and
// under the always-on `.pfx-vignette` (15), over the world. The dip is a thing
// that happens to the MOUNTAIN, so the ink and the instruments sit on top of it.
//
// Built on the FIRST dip of a session and never before, so a no-wipe contract
// lane, a clean-frame probe or any run that never charges a lip has nothing in
// the DOM to diff against main. Same rule, same reason, as `vgBuild`.
const HS = { el: null, a: 0, rim: false, cost: new Float32Array(240), ci: 0, cn: 0 };
// specs/0048's `T.gradTo` — the BLUE STOP of the trick HUD's purple->blue
// gradient, so the dip is painted in a colour the product already speaks.
const HS_BLUE = '59,108,255';                       // #3b6cff

function hsBuild() {
  if (HS.el || typeof document === 'undefined') return;
  try {
    const v = document.createElement('div');
    v.className = 'pfx-hitstop';
    v.setAttribute('aria-hidden', 'true');
    v.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;' +
      'z-index:14;display:none;opacity:0;will-change:opacity;' +
      `background:rgba(${HS_BLUE},1);`;
    const anchor = R.hud && R.hud.root && R.hud.root.parentNode === document.body ? R.hud.root : null;
    if (anchor) document.body.insertBefore(v, anchor);
    else document.body.appendChild(v);
    HS.el = v;
  } catch { R.errors++; }
}

// The whole per-frame cost of the effect, and a PURE FUNCTION of its two
// arguments: nothing here integrates, so a dropped frame, a paused frame or a
// disarmed event cannot leave the tint stuck on. specs/0060 (tuned 2026-09-06): `a`
// is main.js's `min(HS_TINT_MAX, HS_TINT_K · hsTint())` — the tint's OWN envelope,
// which holds at peak past the event's end and fades over the 600 ms after it, so
// the blue outlives the slowdown; `rim` is the reward tier's bright edge and rides
// the same envelope. specs/0060 [freeze, 2026-09-06]: the envelope now RISES over
// the freeze, and it is the ONE thing that moves while the frame is repeated —
// which is exactly why it had to be a compositor-only opacity write and not a fill
// on a canvas the frozen frame is not redrawing. This module is unchanged by that: it was already a pure
// function of the alpha it is handed, which is why the envelope could move without
// touching a line of the paint.
export function hitstopTint(a, rim = false) {
  const t0 = performance.now();
  const q = +clamp(+a || 0, 0, 1).toFixed(3);
  const want = !!rim;
  if (q !== HS.a || want !== HS.rim) {
    HS.a = q; HS.rim = want;
    if (q <= 0) {
      if (HS.el) { HS.el.style.opacity = '0'; HS.el.style.display = 'none'; }
    } else {
      if (!HS.el) hsBuild();
      if (HS.el) {
        // THE REWARD TIER'S RIM, and it is PALE and not the field's own blue for a
        // reason worth writing down: `opacity` multiplies the whole element, so a
        // box-shadow in the same rgb as the background composites to exactly the
        // background and is invisible at any alpha. What survives the multiply is
        // a different COLOUR — a near-white blue, which over the snow reads as a
        // lifted edge and over the sky and the trees reads as a bright one. 3 px
        // of it plus a soft inner glow, so it frames rather than vignettes.
        HS.el.style.boxShadow = want
          ? 'inset 0 0 0 3px rgba(222,238,255,1), inset 0 0 46px 0 rgba(168,204,255,1)'
          : 'none';
        if (HS.el.style.display !== 'block') HS.el.style.display = 'block';
        HS.el.style.opacity = String(q);
      }
    }
  }
  const ms = performance.now() - t0;
  HS.cost[HS.ci] = ms; HS.ci = (HS.ci + 1) % HS.cost.length;
  if (HS.cn < HS.cost.length) HS.cn++;
  return q;
}

// What a gate reads: the alpha on the element, whether the rim is up, whether the
// element was ever built at all, and the paint cost this spec promises to print.
export function hitstopTintState() {
  let sum = 0, max = 0;
  for (let i = 0; i < HS.cn; i++) { sum += HS.cost[i]; if (HS.cost[i] > max) max = HS.cost[i]; }
  return { alpha: HS.a, rim: HS.rim, built: !!HS.el, blue: `#3b6cff`,
           ms: HS.cn ? +(sum / HS.cn).toFixed(5) : null, msMax: +max.toFixed(4), frames: HS.cn };
}

window.__playFX = { init, update, stats, spray, skis, hitstopTint, hitstopTintState };
export default init;
