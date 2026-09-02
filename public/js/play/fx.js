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
// one 2D canvas overlay for the speed lines (~16 fill() calls, zero draw calls
// on the mountain's renderer), one CanvasTexture, one DOM vignette.
// No post pass, no shadow maps, no per-particle raycasts.

import { gliderState } from './glider.js';
import { skiState, takeSkiBurst, bankState, skiAccent, getSkiModel, SKI_REF } from './ski.js';

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
// per frame and the lines are then bucketed by alpha (8 levels x 2 inks), so the
// whole field goes down in at most 16 fill() calls with the fillStyle strings
// built once at module load. Per-line trig is done at SPAWN and cached, so the
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
};

const SL_CAP = 240;            // pool ceiling (MAX_LINES + BURST_LINES + slack)
const SL_BUCKETS = 8;          // alpha quantisation levels per ink
const SL_ALPHA_CEIL = 0.80;
const SL_DPR_CAP = 1.5;        // a full-screen overlay does not need 3x on a phone
const SL_SPAWN_FRAME = 48;     // hard per-frame spawn ceiling, for post-stall frames

// The 16 fill styles, built ONCE. Nothing in the loop concatenates a string.
const SL_FILL = [];
for (let b = 0; b < SL_BUCKETS; b++) {
  const a = (b + 1) / SL_BUCKETS * SL_ALPHA_CEIL;
  SL_FILL.push(`rgba(255,255,255,${a.toFixed(3)})`);
}
for (let b = 0; b < SL_BUCKETS; b++) {
  const a = (b + 1) / SL_BUCKETS * SL_ALPHA_CEIL;
  SL_FILL.push(`rgba(46,60,84,${a.toFixed(3)})`);   // ink, not a grey — see INK_FRAC
}

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
function slSuppressed(paused) {
  const b = document.body.classList;
  if (b.contains('clean-frame')) return true;   // H — the frame is being filmed
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

function slHide() {
  if (S.shown) {
    S.shown = false;
    S.cv.style.display = 'none';
    // drop the field rather than freezing it: coming back from the pause panel
    // to a stale 200-line frame would flash a photograph of the moment you left
    S.live = 0; S.acc = 0; S.burst = 0;
    S.accel = 0; S.prevS = NaN;      // see slStep: no acceleration across a gap
    for (let i = 0; i < SL_CAP; i++) S.lf[i] = 0;
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

function slSpawn(inner, len, wide, alpha, life, inkP) {
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
  S.ik[i] = Math.random() < inkP ? 1 : 0;
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

  // ---- spawn. Rate is population / mean lifetime, so the count settles on
  // `want` without anyone tracking it: lines leave on their own clock.
  if (want > 0.5) {
    S.acc += (want / life) * dt;
    let n = S.acc | 0;
    S.acc -= n;
    if (n > SL_SPAWN_FRAME) n = SL_SPAWN_FRAME;
    while (n-- > 0) {
      if (!slSpawn(inner, len, wide, alpha, life, inkP)) break;
    }
  }

  // ---- age + lay down geometry
  slFocus(dt);
  const fx = S.w * 0.5 + S.focusX, fy = S.h * 0.5 + S.focusY;
  const HX = S.w * 0.5 * SL.REACH, HY = S.h * 0.5 * SL.REACH;
  const step = SL_ALPHA_CEIL / SL_BUCKETS;
  let live = 0;
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
    S.gb[i] = b + (S.ik[i] ? SL_BUCKETS : 0);

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
  // tapered spikes cost at most 16 fill() calls and zero string work
  const gx = S.gx, gb = S.gb;
  for (let b = 0; b < SL_BUCKETS * 2; b++) {
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
    if (opened) { g.fillStyle = SL_FILL[b]; g.fill(); }
  }
}

// The whole overlay, once a frame. `sMs` is metres per second — the caller has
// already chosen between ground speed and the wing's airspeed.
function slUpdate(dt, sMs, inAir, paused) {
  A.lineMs = 0;
  if (!S.cv) return;
  if (slSuppressed(paused)) { slHide(); flReset(); return; }
  const t0 = performance.now();
  const any = slStep(dt, sMs, inAir);
  // specs/0006's coloured burst shares this canvas and this frame. It is stepped
  // and timed SEPARATELY so neither budget can quietly be charged to the other,
  // and it can hold the overlay open on its own: a full-bank pop from a standing
  // start spends real power at a speed the ink field correctly ignores.
  let fany = false, flMs = 0;
  if (FX_AURA_ON) {
    const q = performance.now();
    fany = flStep(dt);
    flMs = performance.now() - q;
  }
  if (!any && !fany) { slHide(); return; }
  if (!S.shown) { S.shown = true; S.cv.style.display = 'block'; }
  slDraw();
  const t1 = performance.now();
  if (fany) flDraw(S.cx);
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

  // ---- THE TRAIL, third person only (spec §2.3). Metres.
  // The chase camera sits 4.3 + 2.2·spN m behind the rider, and the trail runs
  // straight at it — so its length is capped SHORT of that on purpose. Run it
  // out to seven metres and the wide hot end is behind the lens, the near-fade
  // eats it, and all that is left on screen is the thin bit by the boots.
  TR_LEN: 4.20,        // trail length at p = 1 and full speed
  TR_LEN0: 0.30,       // ...as a fraction of that, standing still: a lick at the
                       // heels rather than a banner, because a flame with no
                       // wind on it does not stream
  // ...and WIDE, for the same reason it is short. The chase camera looks down
  // the trail's own axis, so its LENGTH is the one dimension that is foreshortened
  // to nothing there — what actually reaches the screen is how wide and how tall
  // it opens out behind the rider. Sized so a full bank fills the snow between
  // the rider and the lens rather than drawing a stripe on his back.
  TR_W: 1.40,          // half-width of the plume at its widest
  TR_HGT: 1.70,        // height of the fin at its tallest
  TR_GAIN: 1.35,       // the trail runs brighter than the ski flame: it is much
                       // further from the lens and it has snow behind all of it
  TR_TILT: 0.62,       // how far the whole trail leans up out of the track
  TR_RISE: 0.85,       // how far the tail floats above that line (hot gas rises,
                       // and it is also what lifts the plume out of the exact
                       // line the chase camera is looking down)
  // ...and it FLOATS. The plume is nearly three metres wide at its back end and
  // it streams up-slope over ground that rolls: anchored at boot height it spent
  // most of its length inside the snow, z-buffered away, and what reached the
  // screen was the thin bit between the rider's ankles. Anchored at hip height
  // and rising hard, the whole thing is above the surface it is trailing over.
  TR_UP: 0.62,         // anchor height above the boots
  TR_TAU: 0.09,        // seconds — direction smoothing, so it swings not snaps
  TR_WHIP: 1.25,       // extra rise while the pop drains it: the trail whips up

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
// The cross-section is normalised (x = ±1, y = 0..1) and swept along -Z from
// the anchor to z = -1; the shader scales it into metres, so the trail's length,
// width, height and rise are four uniforms and the geometry is built once.
// Two WINGS make a flat plume — the chase camera looks down on the rider, so
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
const TR_SEG = 44;                            // stations down the trail

const FL_CAP = 96;               // flame-line pool ceiling
const FL_ST = 5;                 // stations along one flame line
const FL_BUCKETS = 3;            // alpha levels — 3 body fills + 1 core = 4
const FL_ALPHA_CEIL = 0.86;

const A = {
  ok: false, built: false,
  rigs: null, skiId: null, camMode: null,   // handed over by main.js (one hook)
  geo: null, mat: null, meshes: [],
  trail: null, trailMat: null, tdx: 0, tdy: 0, tdz: 1,
  id: null, colour: 0xfff0e0,
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

function flStyles(hex) {
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
  FL_CORE = `rgba(255,247,236,${AU.CORE_A.toFixed(3)})`;
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
      uniform vec3 uColor;
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
        vec3 col = mix(uColor * 0.40, uColor, smoothstep(0.0, 0.30, q));
        col = mix(col, mix(uColor, vec3(1.0), 0.50), smoothstep(0.55, 1.0, q));
        gl_FragColor = vec4(col * (uGain * (0.62 + 0.55 * uFlare)), clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });

  A.geo = geo; A.mat = mat;
  for (const rig of A.rigs) {
    if (!rig) continue;
    const m = new THREE.Mesh(geo, mat);
    m.name = 'fx:aura';
    m.renderOrder = 92;              // after the snow pool (90), before the HUD
    m.frustumCulled = false;         // the vertex shader moves points; the two on
    m.visible = false;               // a hidden parent cost nothing either way
    rig.add(m);
    A.meshes.push(m);
  }
  A.built = A.meshes.length > 0;
  if (A.built) trailBuild();
}

// ---------------------------------------------------------------- the trail
// One mesh, world-space, aimed backward along the track every frame. It is NOT
// parented to anything: the rider's rig turns with the LOOK and a fire trail
// hangs off where you have BEEN, which are different directions in every carve.
function trailBuild() {
  const THREE = R.THREE, u = R.u;
  const P = TR_PROFILE, NP = P.length, NS = TR_SEG + 1, n = NP * NS;
  const pos = new Float32Array(n * 3);
  const aT = new Float32Array(n), aH = new Float32Array(n), aS = new Float32Array(n);
  for (let j = 0; j < NS; j++) {
    const t = j / TR_SEG;
    for (let i = 0; i < NP; i++) {
      const k = j * NP + i, o = k * 3;
      // normalised: the shader turns x/y/z into metres, so length, width, height
      // and rise are four live uniforms and this buffer is built exactly once
      pos[o] = P[i][0]; pos[o + 1] = P[i][1]; pos[o + 2] = -t;
      aT[k] = t; aH[k] = P[i][2]; aS[k] = P[i][3];
    }
  }
  const idx = [];
  for (let j = 0; j < TR_SEG; j++) {
    for (const [i0, i1] of TR_LINK) {
      const a0 = j * NP + i0, b0 = j * NP + i1, a1 = a0 + NP, b1 = b0 + NP;
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
      uColor: { value: A.mat.uniforms.uColor.value },   // one colour, one source
      uP: { value: 0 }, uFlare: { value: 0 }, uWind: { value: 0 }, uTime: { value: 0 },
      uGain: { value: AU.GAIN }, uLen: { value: 1 }, uW: { value: AU.TR_W * u },
      uHgt: { value: AU.TR_HGT * u }, uRise: { value: AU.TR_RISE * u },
      uNear0: { value: AU.NEAR0 * u }, uNear1: { value: AU.NEAR1 * u },
    },
    vertexShader: `
      attribute float aT; attribute float aH; attribute float aS;
      uniform float uP, uFlare, uWind, uTime, uLen, uW, uHgt, uRise;
      varying float vT, vH, vS, vD;
      void main() {
        vT = aT; vH = aH; vS = aS;
        // the same ragged-outline trick the ski ribbon uses, and for the same
        // reason: from the chase camera the fin is edge-on and only its top
        // edge is visible, so the licks have to be cut into the edge itself
        float w = sin(aT *  6.0 + uTime * 4.1 + aS * 3.3) * 0.56
                + sin(aT * 15.0 - uTime * 8.2 + aS * 9.1) * 0.30
                + sin(aT * 31.0 + uTime * 12.4 + aS * 15.7) * 0.14;
        float lick = 0.28 + 1.00 * clamp(w * 0.70 + 0.48, 0.0, 1.0);
        // the plume opens out behind the rider and floats as it goes, because
        // hot gas does; the anchor end stays pinned to the boots
        float spread = (0.26 + 0.92 * aT) * lick;
        vec3 p;
        p.x = position.x * uW * spread;
        p.y = position.y * uHgt * spread + pow(aT, 1.35) * uRise;
        p.z = position.z * uLen;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uP, uFlare, uWind, uTime, uGain, uNear0, uNear1;
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
        // It thins down its own length — a trail with a hard end is a ribbon —
        // but it never goes to nothing before the end, and that floor is the
        // whole thing. The plume OPENS OUT as it goes back, so alpha and width
        // run in opposite directions: fade it out honestly and the only part
        // left burning is the narrow throat at the boots, which from a chase
        // camera looking straight down the trail is a smudge. The DARKENING
        // toward the tail is spent on the colour instead, where it costs no
        // area, and the alpha keeps a floor so the wide end still reads.
        float fade = 0.34 + 0.66 * pow(1.0 - vT, 0.75);
        // A GENTLER FALL-OFF ACROSS THE PLUME than the ski flame uses. On the
        // ski, alpha collapsing away from each tongue's root is what cuts the
        // licks; on a trail three metres wide it would leave a bright thread
        // down the centreline and nothing either side of it — which is exactly
        // what a fire trail must not look like.
        float a = pow(1.0 - q, 0.85) * fade * (0.25 + 0.75 * uP)
                * smoothstep(uNear0, uNear1, vD);
        // white-hot where it leaves the rider, the ski's colour through the
        // middle, and burning down to a dark ember at the far end
        vec3 col = mix(mix(uColor, vec3(1.0), 0.62), uColor, smoothstep(0.0, 0.24, vT));
        col = mix(col, uColor * 0.34, smoothstep(0.42, 1.0, vT));
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
}

// Aim it. `p` sizes it, the TRACK aims it, and the direction is smoothed so a
// hard carve sweeps the trail round rather than snapping it.
function trailPose(dt, p, wind, flare, tp) {
  const m = A.trail;
  if (!m) return;
  const c = R.ctrl, u = R.u;
  if (!tp || p <= AU.ON_AT) { m.visible = false; return; }
  // where you have BEEN — the reverse of travel, falling back to the reverse of
  // the ski axis when you are barely moving and there is no track to speak of
  let bx = 0, by = 0, bz = 0;
  const v = c.velocity;
  const vm = v ? Math.hypot(v.x, v.y, v.z) : 0;
  if (vm > 0.25 * u) { bx = -v.x / vm; by = -v.y / vm; bz = -v.z / vm; }
  else { bx = Math.sin(c.yaw); by = 0; bz = Math.cos(c.yaw); }
  // ...AND TILTED UP. Straight down the track, the trail runs along the exact
  // line the chase camera is looking down, so its length foreshortens to nothing
  // and all that reaches the screen is its cross-section around the rider's
  // boots. Leaning it up out of that line is what makes it read as a LENGTH of
  // fire — and it is also what fire does, because hot gas rises.
  by += AU.TR_TILT;
  const bm = Math.hypot(bx, by, bz) || 1;
  bx /= bm; by /= bm; bz /= bm;
  const k = 1 - Math.exp(-dt / AU.TR_TAU);
  A.tdx += (bx - A.tdx) * k; A.tdy += (by - A.tdy) * k; A.tdz += (bz - A.tdz) * k;
  const dm = Math.hypot(A.tdx, A.tdy, A.tdz) || 1;
  const dx = A.tdx / dm, dy = A.tdy / dm, dz = A.tdz / dm;
  const pos = c.position;
  m.position.set(pos.x, pos.y + AU.TR_UP * u, pos.z);
  // Object3D.lookAt (not Camera.lookAt) points +Z AT the target — the arguments
  // to Matrix4.lookAt are swapped for anything that is not a camera or a light.
  // The geometry runs down -Z, so the target goes on the far side of the anchor.
  m.up.set(0, 1, 0);
  m.lookAt(pos.x - dx, pos.y + AU.TR_UP * u - dy, pos.z - dz);
  const U = A.trailMat.uniforms;
  U.uP.value = p;
  U.uFlare.value = flare;
  U.uWind.value = wind;
  U.uTime.value = A.time;
  U.uLen.value = AU.TR_LEN * u * p * (AU.TR_LEN0 + (1 - AU.TR_LEN0) * wind);
  U.uRise.value = (AU.TR_RISE + AU.TR_WHIP * A.drain) * u;
  U.uGain.value = AU.GAIN * AU.TR_GAIN * (0.45 + 0.55 * p);
  m.visible = true;
}

// The equipped ski, when it changes: one colour, one length. `len` matters
// because makeSkiRig scales the BLADE and not the rig, so a 218 cm Redster DH
// and a 157 cm Redster S9 are the same group with different children — the
// ribbon has to be told the same scale the blade was.
function auraDress(id) {
  if (A.id === id) return;
  A.id = id;
  A.colour = skiAccent(id);
  A.mat.uniforms.uColor.value.setHex(A.colour);   // the trail shares this object
  flStyles(A.colour);
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
    const onSkis = !!(c && c.mode === 'skis');
    if (!onSkis || slSuppressed(paused)) {
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
  suppressed: () => slSuppressed(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
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
  colour: () => '#' + A.colour.toString(16).padStart(6, '0'),
  ski: () => A.id,
  lines: () => A.live,
  // §2.3 — which presentation is live, and how long the trail is right now
  view: () => (A.camMode && A.camMode() === 'tp' ? 'tp' : 'fp'),
  trail: () => (A.trail && A.trail.visible
    ? +(A.trailMat.uniforms.uLen.value / R.u).toFixed(2) : 0),
  // the trail's own aim, so a test can assert it points down the TRACK rather
  // than down the look — the two differ by tens of degrees in any real carve
  trailDir: () => (A.trail ? { x: +A.tdx.toFixed(3), y: +A.tdy.toFixed(3), z: +A.tdz.toFixed(3) } : null),
  // a name a screenshot can be filed under, on the tiers spec §2.1 describes
  tier: () => (A.p <= AU.ON_AT ? 'off' : A.p < 0.30 ? 'tips' : A.p < AU.FLARE_AT ? 'lit' : 'flare'),
  suppressed: () => slSuppressed(!!(R.hud && R.hud.isPaused && R.hud.isPaused())),
  force: (p) => { A.forced = (p == null ? null : clamp(+p || 0, 0, 1)); return A.forced; },
  fire: (e) => auraFire(e === undefined ? 1 : e),
  tuning: AU,
  cost: () => ({ n: A.cn, p50: auraCostPct(0.50), p95: auraCostPct(0.95), max: auraCostPct(0.999) }),
  costReset: () => { A.ci = 0; A.cn = 0; return true; },
};

window.__playFX = { init, update, stats, spray, skis };
export default init;
