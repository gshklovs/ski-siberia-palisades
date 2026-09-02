// Floating POI markers — the "what is interesting and where is it" layer.
//
// Self-contained. main.js wires it exactly the way it wires fx.js and
// surprise.js:
//   import './markers.js'            (module attaches window.__playMarkers)
//   window.__playMarkers.init({ THREE, scene, camera, ..., markers, upAxis })
//   window.__playMarkers.update(dt)  // once per frame
//
// WHAT IT DOES
//
// Every place worth going to in a world gets a glowing sign hung 128–236 m in
// the AIR above it. The signs always face the camera, they bob, their halo
// pulses, and because they are high up they do not sit in front of the thing
// you are trying to ski — you tip your head back, read the sky, and now you
// know the map. That height IS the anti-clutter mechanism.
//
// They are DEPTH-TESTED against the world: a ridge or a building in front of a
// sign hides it, and a ridge cutting across one clips it along the skyline. A
// sign you can see is a place you have line of sight to, which is the whole
// reason the height matters — it is what gets a sign over its own ridge.
//
// Walk toward one and a card fades in along the bottom third with the name and
// a line about the place; get within 25 m — you are AT it — and the sign itself
// fades to nothing so the view is clean. Leave and it comes back.
//
// At rest the signs sit at half brightness — present, legible, but behind the
// mountain in your attention. Put the crosshair on one and it eases up to full
// over 150 ms, halo and all, and the offer to go there appears under it: press T
// and you are set down three metres short of the anchor, on the real floor,
// facing the place, in whatever gear you were already wearing.
//
// WHERE THE MARKERS COME FROM (two sources, same shape)
//
//   1. `world.markers` from the PLAYABLE.md contract, for worlds built after
//      this module. See harness/PLAYABLE.md § Markers.
//   2. A baked per-world registry below (REG), mined from each run's
//      layout.mjs anchors / REPORT.md and settled onto the real floor with
//      collision.groundAt() at init. Finished worlds predate the contract.
//
// Both are `{ id, name, kind, pos:[x,y,z], tier, line }` in the PLAYER frame
// (Y-up metres). A z-up world's contract markers are tipped here, exactly the
// way main.js tips its `lifts` — `(x, y, z)_ENU -> (x, z, -y)_three`. The baked
// registry is already stored tipped, so nothing converts it twice.
//
// BUDGET
//
// Two draw calls, total, for every sign in the world: one camera-facing quad
// mesh for the cards (all of them sharing a single 2048×1024 canvas atlas
// painted once at init) and one additive quad mesh for the halos (one shared
// 160² radial texture, tinted per instance). No canvas is redrawn after init;
// the per-frame work is one loop over ≤20 rows writing three small typed arrays
// plus an O(n·6) screen-box declutter, plus — only when the crosshair is on a
// sign, and only every 100 ms — one 56-sample ground-profile walk for the
// fast-travel occlusion gate. Three DOM overlays (approach card, aim prompt,
// teleport flash) and one <style>, like surprise.js. Measured in the bench:
// 2 draw calls added, in every world.
//
// The camera belongs to main.js — this module never writes to it.

import { DEBUG_HUD } from './flags.js';

const CARD_W = 512, CARD_H = 192;      // atlas cell, px
const ATLAS_W = 2048, ATLAS_H = 1024;  // 4 × 5 = 20 cells
const COLS = ATLAS_W / CARD_W, ROWS = ATLAS_H / CARD_H | 0;
const MAX_MARKERS = COLS * ROWS;       // 20 — more than any world declares

const AT_R = 25;        // m — inside this you are AT the poi: the sign gets out of the way
const INTRO_R = 80;     // m — the approach card fades in here
const RESET_R = 200;    // m — leave by this much and the intro re-arms
const LIT_MAX = 6;      // simultaneously fully-lit signs (screen-space declutter)
const FAR_D = 900;      // m — beyond this the card fades out and only the halo dot is left
const FAR_GONE = 1400;  // m — beyond this the halo goes too

const IN_T = 0.45, HOLD_T = 3.0, OUT_T = 0.55;   // intro card timing, seconds
const ANG = 0.21;       // card width as a fraction of its distance (~12° of a 72° fov)

// A sign must hang in AIR. Tier height is measured off the settled ground point,
// but a marker under an overhang — a cliff face rising behind it, a serac wall,
// a lift shed's roof — can have its tier height land inside rock. At init the
// column above every anchor is probed and the sign is pushed up to clear it by
// this margin. RAISE_MAX stops a marker at the foot of a 900 m wall from being
// flung into the stratosphere: past that it stays where the tier put it.
const CLEAR_M = 22;     // m of daylight demanded between a sign and anything above the anchor
const RAISE_MAX = 2.4;  // × tier height — the most a clearance probe may add

// ---- fast travel (T)
// T is free. The player's bound keys, swept across every module that listens:
//   main.js  W A S D · arrows · Shift · Space · E · I · R · C · F · G · F8 · Esc
//   hud.js   B · [ ]
//   inventory.js (only while the locker is up) Q E F Tab Enter Space digits, WASD/arrows, Esc I
//   dev.js   owns the whole keyboard while F8 mode is active — we bail out there
// Nothing claims KeyT, in any of them.
const TRAVEL_KEY = 'KeyT', TRAVEL_KEY_CAP = 'T';
// The aim box. A card is drawn about 12° wide and 4.5° tall, which is already an
// enormous target next to a crosshair — padding that by half again, as the first
// cut did, left a sign TEN DEGREES off the crosshair still "aimed at", and let
// two neighbouring signs both answer. So: pad, then CAP. The pad earns its keep
// on the thin vertical axis and on demoted cards that have shrunk to 0.42; the
// caps keep the offer honest at ±6.6° across and ±5.2° up.
const AIM_PAD_H = 1.20, AIM_PAD_V = 2.00;
const AIM_MAX_H = 0.115, AIM_MAX_V = 0.090;   // radians, half-extent
const AIM_MIN_A = 0.06; // a sign faded to a ghost is not a target
const AIM_MIN_DOT = 0.20;
// Two signs land nearly in line — a near lift station in front of a far venue —
// and BOTH answer the aim test. Picking the nearer one is wrong: it hands the
// offer, and the hover ease with it, to a sign the crosshair is nowhere near,
// which is the "wrong one lights up" bug. The offer goes to the sign the
// crosshair is most deeply INSIDE (see aimMiss), and only a genuine tie falls
// through to nearest. AIM_STICK is how much more centred a challenger must be to
// take the offer off the sign that already holds it: without it a slow sweep
// across the gap between two overlapping cards flips the offer every frame around
// the crossover, which reads as two signs flickering rather than one lighting up.
const AIM_STICK = 0.12;
const AIM_HZ = 0.10;    // s — how often the (expensive) occlusion probe re-runs
const OCC_STEPS = 56;   // samples along the camera→sign line
const TRAVEL_OFF = 3;   // m — land beside the anchor, not inside whatever is on it
const LAND_TOL = 4;     // m — a landing spot whose floor is this close to the
                        // anchor's own floor is on the same shelf, not over its edge
const FLASH_MS = 300;   // the white flash. Wall clock, not dt: dt is clamped to
                        // 50 ms a frame, so on a 6 fps headless run a dt-driven
                        // flash would hang about for a second and a half.

// ---- resting vs hovered
// At rest a sign is a HALF-PRESENT thing: still legible from across a valley,
// still obviously a place, but no longer competing with the mountain for the
// front of your attention. Put the crosshair on one and it comes all the way up.
// The card floor is 0.50 — the atlas paints a drop shadow and a hard border into
// every cell, which is what keeps a 50 % card off a bright snowfield. The halo
// floor sits a little higher: it is additive, so half of it against lit snow is
// most of the way to nothing, and the halo is what tells you a sign is over
// there before you can read it.
const REST_CARD = 0.50, REST_HALO = 0.55;
const HOVER_IN = 0.150, HOVER_OUT = 0.300;   // seconds, wall clock — see FLASH_MS

const S = {
  ok: false,
  THREE: null, scene: null, camera: null, ctrl: null, hud: null, collision: null,
  poi: '', run: '', key: '', source: '',
  u: 1, t: 0, farD: FAR_D, farGone: FAR_GONE, maxW: 96, settled: 0,
  rows: [],                 // the markers
  group: null, card: null, halo: null, fwd: null,
  atlas: null, haloTex: null,
  root: null, cardEl: null, iconEl: null, nameEl: null, kindEl: null, lineEl: null,
  intro: null,              // { row, phase, t }
  iconUrl: {},              // kind -> dataURL for the DOM card
  nearest: null, visible: 0, lit: 0, litRows: [],
  errors: 0,
  // ---- fast travel
  aim: null, aimT: 0, aimBlocked: false, aimEl: null, aimKeyEl: null, aimNameEl: null,
  hoverWall: 0,
  flashEl: null, flash: 0, travels: 0, lastTravel: null, wired: false,
};

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smooth = (k) => k * k * (3 - 2 * k);   // ease in-out on a 0..1 ramp

// ===========================================================================
// kinds — one design system, five venue dialects
// ===========================================================================

const KINDS = {
  'ski-run': {
    label: 'SKI RUN',
    panel: '#f4f1ea', ink: '#171614', sub: '#726c60', border: '#171614',
    plate: '#171614', glow: '#cfe0ff',
  },
  lift: {
    label: 'CHAIRLIFT',
    panel: '#171614', ink: '#f6f3ec', sub: '#a49c8d', border: '#ff4d00',
    plate: '#ff4d00', glow: '#ff6a1f',
  },
  'bike-trail': {
    label: 'TRAIL',
    panel: '#171c15', ink: '#eff5e6', sub: '#9aa88a', border: '#8ec63f',
    plate: '#8ec63f', glow: '#9fe04a',
  },
  landmark: {
    label: 'LANDMARK',
    panel: '#0e2a33', ink: '#eaf7fb', sub: '#83a9b4', border: '#7fd4e8',
    plate: '#7fd4e8', glow: '#7fd4e8',
  },
  venue: {
    label: 'VENUE',
    panel: '#ffab00', ink: '#171614', sub: '#6b4a06', border: '#171614',
    plate: '#171614', glow: '#ffc44d',
  },
};
const kindOf = (k) => KINDS[k] || KINDS.landmark;

// tier -> how high it hangs, how big the card is, how bright, and how hard it
// fights for screen space when two signs land on top of each other
// Heights are DOUBLE what they first shipped as (118/88/64): the signs read as
// sky furniture rather than as things standing on the hill, and — now that they
// are depth-tested — hanging them higher is what keeps a sign clear of the ridge
// its own POI sits behind. The card holds a constant angular size, so nothing
// about how it reads changes with the extra altitude; you just look up further.
const TIERS = {
  major: { h: 236, size: 1.30, glow: 1.00, rank: 220 },
  mid: { h: 176, size: 1.06, glow: 0.82, rank: 0 },
  minor: { h: 128, size: 0.88, glow: 0.66, rank: -140 },
};
const tierOf = (t) => TIERS[t] || TIERS.mid;

// ===========================================================================
// icons — flat geometric marks, drawn on the plate. cx/cy centre, r half-size.
// ===========================================================================

function icoDiamond(g, cx, cy, r, fill, n) {
  g.fillStyle = fill;
  const k = n === 2 ? 0.62 : 1;
  const xs = n === 2 ? [-r * 0.46, r * 0.46] : [0];
  for (const dx of xs) {
    g.beginPath();
    g.moveTo(cx + dx, cy - r * k);
    g.lineTo(cx + dx + r * 0.78 * k, cy);
    g.lineTo(cx + dx, cy + r * k);
    g.lineTo(cx + dx - r * 0.78 * k, cy);
    g.closePath(); g.fill();
  }
}
// square, NOT rotated: a rotated square is a diamond, and on a trail sign those
// two shapes are the whole difficulty scale
function icoSquare(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.fillRect(cx - r * 0.70, cy - r * 0.70, r * 1.40, r * 1.40);
}
function icoCircle(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.beginPath(); g.arc(cx, cy, r * 0.76, 0, 7); g.fill();
}

// a chair on its hanger, hung off the haul rope
function icoChair(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.lineWidth = r * 0.155;
  g.beginPath(); g.moveTo(cx - r, cy - r * 0.82); g.lineTo(cx + r, cy - r * 0.82); g.stroke();  // rope
  g.beginPath(); g.moveTo(cx, cy - r * 0.82); g.lineTo(cx, cy - r * 0.10); g.stroke();          // hanger
  g.beginPath();                                                                                // seat + back
  g.moveTo(cx - r * 0.62, cy - r * 0.34);
  g.lineTo(cx - r * 0.62, cy + r * 0.30);
  g.lineTo(cx + r * 0.60, cy + r * 0.30);
  g.stroke();
  g.fillRect(cx - r * 0.62, cy + r * 0.30, r * 1.22, r * 0.18);                                 // seat pan
  g.beginPath(); g.moveTo(cx + r * 0.34, cy + r * 0.48); g.lineTo(cx + r * 0.34, cy + r * 0.86); g.stroke();
}

function icoBike(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineWidth = r * 0.135; g.lineCap = 'round'; g.lineJoin = 'round';
  const wr = r * 0.40, y = cy + r * 0.30;
  g.beginPath(); g.arc(cx - r * 0.56, y, wr, 0, 7); g.stroke();
  g.beginPath(); g.arc(cx + r * 0.56, y, wr, 0, 7); g.stroke();
  g.beginPath();
  g.moveTo(cx - r * 0.56, y); g.lineTo(cx - r * 0.06, y);
  g.lineTo(cx + r * 0.20, cy - r * 0.36); g.lineTo(cx + r * 0.56, y);
  g.moveTo(cx - r * 0.06, y); g.lineTo(cx + r * 0.20, cy - r * 0.36);
  g.stroke();
  g.beginPath(); g.moveTo(cx + r * 0.10, cy - r * 0.52); g.lineTo(cx + r * 0.46, cy - r * 0.52); g.stroke();
  g.beginPath(); g.moveTo(cx - r * 0.34, cy - r * 0.22); g.lineTo(cx + r * 0.02, cy - r * 0.22); g.stroke();
}

function icoPeak(g, cx, cy, r, fill) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(cx - r * 0.98, cy + r * 0.62);
  g.lineTo(cx - r * 0.16, cy - r * 0.72);
  g.lineTo(cx + r * 0.30, cy - r * 0.02);
  g.lineTo(cx + r * 0.56, cy - r * 0.36);
  g.lineTo(cx + r * 0.98, cy + r * 0.62);
  g.closePath(); g.fill();
}

function icoFlag(g, cx, cy, r, fill) {
  g.strokeStyle = fill; g.fillStyle = fill;
  g.lineWidth = r * 0.16; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - r * 0.52, cy - r * 0.86); g.lineTo(cx - r * 0.52, cy + r * 0.86); g.stroke();
  g.beginPath();
  g.moveTo(cx - r * 0.40, cy - r * 0.78);
  g.lineTo(cx + r * 0.86, cy - r * 0.30);
  g.lineTo(cx - r * 0.40, cy + r * 0.16);
  g.closePath(); g.fill();
}

// difficulty badge for a ski run: '' | 'blue' | 'green' | 'double'
function skiBadge(g, cx, cy, r, diff) {
  if (diff === 'green') return icoCircle(g, cx, cy, r, '#3fbf62');
  if (diff === 'blue') return icoSquare(g, cx, cy, r, '#4d9bff');
  if (diff === 'double') return icoDiamond(g, cx, cy, r, '#f6f3ec', 2);
  return icoDiamond(g, cx, cy, r, '#f6f3ec', 1);
}

function drawIcon(g, row, cx, cy, r) {
  switch (row.kind) {
    case 'ski-run': return skiBadge(g, cx, cy, r, row.diff);
    case 'lift': return icoChair(g, cx, cy, r, '#171614');
    case 'bike-trail':
      if (row.diff) return skiBadgeBike(g, cx, cy, r, row.diff);
      return icoBike(g, cx, cy, r, '#171c15');
    case 'venue': return icoFlag(g, cx, cy, r, '#ffab00');
    default: return icoPeak(g, cx, cy, r, '#0e2a33');
  }
}
// a bike trail marker board still speaks in circles / squares / diamonds
function skiBadgeBike(g, cx, cy, r, diff) {
  if (diff === 'green') return icoCircle(g, cx, cy, r, '#171c15');
  if (diff === 'blue') return icoSquare(g, cx, cy, r, '#171c15');
  if (diff === 'double') return icoDiamond(g, cx, cy, r, '#171c15', 2);
  return icoDiamond(g, cx, cy, r, '#171c15', 1);
}

// ===========================================================================
// the atlas — every card painted once, into one texture
// ===========================================================================

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fitFont(g, text, maxW, start, weight, family) {
  let px = start;
  for (;;) {
    g.font = `${weight} ${px}px ${family}`;
    if (g.measureText(text).width <= maxW || px <= 13) break;
    px -= 1;
  }
  return px;
}

const FAM = '"Segoe UI Variable Text","Segoe UI",system-ui,Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,"Cascadia Mono",Consolas,"Segoe UI Mono",monospace';

// one cell of the atlas: a rounded card with an icon plate, the name, a kind
// strip, and a short stem below so it reads as a sign hung over a spot.
function paintCard(g, ox, oy, row) {
  const K = kindOf(row.kind);
  const X = ox + 10, Y = oy + 8, W = CARD_W - 20, H = 146, R = 16;

  g.save();
  g.translate(0, 0);

  // drop shadow — one soft pass, so the card holds against bright sky
  g.shadowColor = 'rgba(0,0,0,0.42)';
  g.shadowBlur = 18; g.shadowOffsetY = 6;
  rrect(g, X, Y, W, H, R);
  g.fillStyle = K.panel; g.fill();
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;

  // icon plate — the left third, clipped to the card's left corners
  g.save();
  rrect(g, X, Y, W, H, R); g.clip();
  g.fillStyle = K.plate;
  g.fillRect(X, Y, 120, H);
  g.restore();
  drawIcon(g, row, X + 60, Y + H / 2, 40);

  // border last, so it sits over both fills
  rrect(g, X + 1.5, Y + 1.5, W - 3, H - 3, R - 1);
  g.strokeStyle = K.border; g.lineWidth = 3; g.stroke();

  // ---- type
  const tx = X + 142, tw = W - 158;
  const name = String(row.name || '').toUpperCase();
  const px = fitFont(g, name, tw, 46, 700, FAM);
  g.fillStyle = K.ink;
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `700 ${px}px ${FAM}`;
  g.fillText(name, tx, Y + 68);

  // accent rule + kind strip
  g.fillStyle = K.border;
  g.fillRect(tx, Y + 84, 34, 3);
  g.font = `700 15px ${MONO}`;
  g.fillStyle = K.sub;
  g.fillText(spaced(row.sub || K.label), tx + 46, Y + 89);

  // one-liner, trimmed — the sign says what, the intro card says why
  if (row.tag) {
    g.font = `600 17px ${FAM}`;
    g.fillStyle = K.sub;
    g.fillText(clip(g, row.tag, tw), tx, Y + 120);
  }

  // ---- the stem: this sign belongs to a point on the ground below it
  g.fillStyle = K.border;
  g.fillRect(ox + CARD_W / 2 - 2, Y + H, 4, 20);
  g.beginPath();
  g.moveTo(ox + CARD_W / 2 - 13, Y + H + 16);
  g.lineTo(ox + CARD_W / 2 + 13, Y + H + 16);
  g.lineTo(ox + CARD_W / 2, Y + H + 38);
  g.closePath(); g.fill();

  g.restore();
}

const spaced = (s) => String(s).toUpperCase().split('').join(' ');
function clip(g, s, maxW) {
  let t = String(s);
  if (g.measureText(t).width <= maxW) return t;
  while (t.length > 4 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function buildAtlas(THREE, rows) {
  const c = mkCanvas(ATLAS_W, ATLAS_H);
  const g = c.getContext('2d');
  for (let i = 0; i < rows.length; i++) {
    const col = i % COLS, r = (i / COLS) | 0;
    paintCard(g, col * CARD_W, r * CARD_H, rows[i]);
  }
  // NOTE: no sRGB colour space and no tone mapping on either texture. These are
  // raw ShaderMaterials, so three's output-encoding chunk never runs on them —
  // sampling the bytes exactly as painted and writing them straight out is what
  // makes the sign on screen the sign in the canvas.
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// the halo: one soft radial disc, tinted per marker by a vertex colour
function buildHalo(THREE) {
  const c = mkCanvas(160, 160);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(80, 80, 2, 80, 80, 79);
  gr.addColorStop(0.00, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, 'rgba(255,255,255,0.72)');
  gr.addColorStop(0.38, 'rgba(255,255,255,0.26)');
  gr.addColorStop(0.68, 'rgba(255,255,255,0.07)');
  gr.addColorStop(1.00, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 160, 160);
  return new THREE.CanvasTexture(c);
}

// ===========================================================================
// the billboard mesh — N quads, one draw call, camera-facing in the shader
// ===========================================================================

const VERT = `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec2 aScale;
attribute float aAlpha;
attribute float aLift;
attribute vec3 aTint;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(aCenter + vec3(0.0, aLift, 0.0), 1.0);
  mv.xy += aCorner * aScale;          // screen-aligned: the sign always faces you
  gl_Position = projectionMatrix * mv;
}`;

const FRAG_CARD = `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(t.rgb, a);
}`;

const FRAG_HALO = `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  float m = texture2D(uMap, vUv).a * vAlpha;
  if (m < 0.004) discard;
  gl_FragColor = vec4(vTint * m, m);
}`;

function quadGeo(THREE, n, uvFor) {
  const g = new THREE.BufferGeometry();
  const corner = new Float32Array(n * 4 * 2);
  const uv = new Float32Array(n * 4 * 2);
  const center = new Float32Array(n * 4 * 3);
  const scale = new Float32Array(n * 4 * 2);
  const alpha = new Float32Array(n * 4);
  const lift = new Float32Array(n * 4);
  const tint = new Float32Array(n * 4 * 3);
  const idx = new Uint16Array(n * 6);
  const C = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < n; i++) {
    const uvs = uvFor(i);        // [u0, v0, u1, v1]
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      corner[j * 2] = C[k][0]; corner[j * 2 + 1] = C[k][1];
      uv[j * 2] = C[k][0] < 0 ? uvs[0] : uvs[2];
      uv[j * 2 + 1] = C[k][1] < 0 ? uvs[1] : uvs[3];
    }
    const o = i * 6, v = i * 4;
    idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
    idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
  }
  // `position` is required by three's material plumbing but unused by our shader
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  g.setAttribute('aCenter', new THREE.BufferAttribute(center, 3));
  g.setAttribute('aScale', new THREE.BufferAttribute(scale, 2));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  g.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  // a sky-high sign must never be frustum-culled by a bbox we do not maintain
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  return g;
}

function hex(THREE, s) { return new THREE.Color(s); }

// ===========================================================================
// DOM — the approach card. Own overlay, own stylesheet (.pmk__*).
// ===========================================================================

const CSS = `
.pmk { position: fixed; left: 0; right: 0; bottom: 21vh; z-index: 20;
  display: flex; justify-content: center; pointer-events: none; }
.pmk__card {
  display: flex; align-items: center; gap: 14px;
  max-width: min(80vw, 820px);
  background: rgba(23, 22, 20, .88); color: #f4f1ea;
  border: 1px solid rgba(244, 241, 234, .20);
  border-radius: 4px; padding: 16px 26px 16px 22px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, .40);
  opacity: 0;
}
.pmk__icon { width: 38px; height: 38px; flex: none;
  background: center/contain no-repeat; }
.pmk__txt { min-width: 0; }
.pmk__kind { font-family: ui-monospace, Consolas, monospace;
  font-size: 14px; font-weight: 700; letter-spacing: .24em; text-transform: uppercase;
  color: var(--pmk-accent, #ff4d00); margin-bottom: 3px; }
.pmk__name { font-family: ui-monospace, Consolas, monospace;
  font-size: 29px; font-weight: 700; letter-spacing: .05em; line-height: 1.15;
  text-shadow: 0 1px 6px rgba(0, 0, 0, .55); }
.pmk__line { margin-top: 5px; font-size: 19px; line-height: 1.42; color: #c6c0b3; }
.pmk__dist { font-family: ui-monospace, Consolas, monospace;
  font-size: 15px; letter-spacing: .14em; color: #8b8578; margin-top: 6px; }

/* fast travel — the prompt sits just under the crosshair, so the thing you are
   aiming at and the offer to go there are the same glance */
.pmk-aim { position: fixed; left: 50%; top: 50%; z-index: 21;
  transform: translate(-50%, 34px); pointer-events: none;
  display: flex; align-items: center; gap: 9px;
  padding: 5px 12px 5px 6px; border-radius: 3px;
  background: rgba(23, 22, 20, .78);
  border: 1px solid rgba(244, 241, 234, .18);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .38);
  opacity: 0; transition: opacity .12s linear; }
.pmk-aim.is-on { opacity: 1; }
.pmk-aim__key { font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; font-weight: 700; letter-spacing: .06em;
  color: #171614; background: var(--pmk-accent, #ff4d00);
  border-radius: 2px; padding: 3px 7px; }
.pmk-aim__txt { font-family: ui-monospace, Consolas, monospace;
  font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
  color: #a49c8d; white-space: nowrap; }
.pmk-aim__name { color: #f4f1ea; font-weight: 700; }
.pmk-flash { position: fixed; inset: 0; z-index: 40; background: #fff;
  pointer-events: none; opacity: 0; display: none; }
`;

function mountDom() {
  if (!document.getElementById('pmk-style')) {
    const st = document.createElement('style');
    st.id = 'pmk-style'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  let root = document.querySelector('.pmk');
  if (!root) {
    root = document.createElement('div');
    root.className = 'pmk';
    document.body.appendChild(root);
  }
  root.textContent = '';
  const card = document.createElement('div'); card.className = 'pmk__card';
  const ico = document.createElement('div'); ico.className = 'pmk__icon';
  const txt = document.createElement('div'); txt.className = 'pmk__txt';
  const kd = document.createElement('div'); kd.className = 'pmk__kind';
  const nm = document.createElement('div'); nm.className = 'pmk__name';
  const ln = document.createElement('div'); ln.className = 'pmk__line';
  txt.append(kd, nm, ln);
  card.append(ico, txt);
  root.append(card);
  card.style.display = 'none';
  S.root = root; S.cardEl = card; S.iconEl = ico;
  S.kindEl = kd; S.nameEl = nm; S.lineEl = ln;

  // the fast-travel prompt and the teleport flash live outside .pmk (which is
  // pinned to the bottom third) — both want the middle of the screen
  for (const el of document.querySelectorAll('.pmk-aim, .pmk-flash')) el.remove();
  const aim = document.createElement('div'); aim.className = 'pmk-aim';
  const key = document.createElement('span'); key.className = 'pmk-aim__key'; key.textContent = TRAVEL_KEY_CAP;
  const lbl = document.createElement('span'); lbl.className = 'pmk-aim__txt';
  const nmA = document.createElement('span'); nmA.className = 'pmk-aim__name';
  lbl.append(document.createTextNode('fast travel · '), nmA);
  aim.append(key, lbl);
  const fl = document.createElement('div'); fl.className = 'pmk-flash';
  // specs/0003 — `debugHud`. The "T · fast travel · <sign>" card under the
  // crosshair. It is CONTEXTUAL — opacity:0 until you aim at a sign — which is
  // why it never showed up in a screenshot and why it is worth being precise
  // about: the front side of the mountain is covered in signs, so in practice it
  // lights up constantly, and a card that names the key, the feature AND the
  // destination is not keeping a secret (D44). The FEATURE is untouched in both
  // builds: KeyT still teleports, aimedAt() still answers, and the arrival flash
  // is still appended. Only the advertisement is lab-only.
  //
  // DETACHED, not deleted — setAim() writes classes and textContent to S.aimEl
  // on every frame you are looking at a sign, and _test.aimEl() reads it back. A
  // detached node takes all of that silently.
  if (DEBUG_HUD) document.body.append(aim);
  document.body.append(fl);
  S.aimEl = aim; S.aimKeyEl = key; S.aimNameEl = nmA; S.flashEl = fl;
}

// one 96² icon per kind, painted once, handed to the DOM as a data URL
function iconUrl(row) {
  const k = row.kind + (row.diff || '');
  if (S.iconUrl[k]) return S.iconUrl[k];
  const c = mkCanvas(96, 96);
  const g = c.getContext('2d');
  const K = kindOf(row.kind);
  g.fillStyle = K.plate;
  rrect(g, 0, 0, 96, 96, 12); g.fill();
  drawIcon(g, row, 48, 48, 30);
  const url = c.toDataURL();
  S.iconUrl[k] = url;
  return url;
}

function showIntro(row) {
  try {
    if (!S.cardEl) return;
    const K = kindOf(row.kind);
    // the halo colour is the kind's signature — the card's rule and its kind
    // strip use it too, so the sky and the HUD agree about what this place is
    S.cardEl.style.setProperty('--pmk-accent', K.glow);
    S.iconEl.style.backgroundImage = `url(${iconUrl(row)})`;
    S.kindEl.textContent = row.sub || K.label;
    S.nameEl.textContent = row.name;
    S.lineEl.textContent = row.line || '';
    S.lineEl.style.display = row.line ? '' : 'none';
    S.cardEl.style.display = '';
    S.cardEl.style.opacity = '0';
    S.intro = { row, phase: 'in', t: 0 };
    row.introShown = true;
  } catch { S.errors++; }
}

function hideIntro() {
  S.intro = null;
  if (S.cardEl) { S.cardEl.style.opacity = '0'; S.cardEl.style.display = 'none'; }
}

// frame-rate independent: every phase is a clock, never a frame count
function tickIntro(dt) {
  const I = S.intro;
  if (!I) return;
  I.t += dt;
  if (I.phase === 'in') {
    const k = clamp(I.t / IN_T, 0, 1);
    S.cardEl.style.opacity = String(+(k * k * (3 - 2 * k)).toFixed(3));
    if (I.t >= IN_T) { I.phase = 'hold'; I.t = 0; S.cardEl.style.opacity = '1'; }
  } else if (I.phase === 'hold') {
    if (I.t >= HOLD_T) { I.phase = 'out'; I.t = 0; }
  } else {
    const k = clamp(1 - I.t / OUT_T, 0, 1);
    S.cardEl.style.opacity = String(+(k * k * (3 - 2 * k)).toFixed(3));
    if (I.t >= OUT_T) hideIntro();
  }
}

// ===========================================================================
// the registries
// ===========================================================================
// Coordinates are PLAYER frame — Y-up metres, the frame the controller reports.
// Every one of these worlds is authored ENU z-up and tipped by main.js, so a
// source anchor (x, y_enu, z_enu) is stored here as (x, z_enu, -y_enu). `pos.y`
// is the GROUND at the spot; the sign hangs `tier.h` metres over it, and
// init() re-settles y on the real collider floor where it can.

const REG = {
  // ================================================= PALISADES FRONT SIDE
  // runs/palisades-front-A-merge-01. Merged ENU frame (Red Dog's, unchanged):
  // origin 39.19197/-120.23108, z = 0 at 1890.0 m ASL. Anchors are the `A`
  // block and the RUNS[].pts[0] tops of scene/layout.mjs. This world is an
  // ORPHAN run (no poi id), so it is keyed by run prefix.
  'palisades-front': [
    { id: 'kt22', name: 'KT-22', kind: 'landmark', tier: 'major',
      pos: [-913.4, 570.8, 996.4], sub: 'SUMMIT', tag: '2,460 m · the roof of the front side',
      line: 'The highest point in the frame, and the mountain Squaw was built around. Everything from here is down.' },
    { id: 'eagles-nest', name: "EAGLE'S NEST", kind: 'landmark', tier: 'minor',
      pos: [-894.2, 552.0, 997.2], sub: 'SPIRES', tag: "McConkey's drops off the back",
      line: 'The spires on the summit knob. Shane McConkey’s run starts off the far side and does not ease you into it.' },
    { id: 'gs-bowl', name: 'GS BOWL', kind: 'ski-run', tier: 'mid', diff: 'black',
      pos: [-981.3, 541.0, 942.0], sub: 'KT-22', tag: '2,431 m · patrol shack at the gate',
      line: 'The wide north-facing bowl off the KT summit. Cornice at the top, 170 m of fall line under it.' },
    { id: 'olympic-lady', name: 'OLYMPIC LADY', kind: 'lift', tier: 'mid',
      pos: [-685.1, 519.0, 1027.2], sub: 'TOP STATION', tag: '732 m · fixed double',
      line: 'The smallest chair on the front side, and the one that ties KT-22 to Exhibition. Unload here for The Saddle.' },
    { id: 'exhibition', name: 'EXHIBITION', kind: 'lift', tier: 'mid',
      pos: [-591.7, 258.2, 297.6], sub: 'TOP STATION', tag: '727 m · fixed quad',
      line: 'Six runs start within 12 m of this station — Easy Street, Julia’s Gold, Schimmelpfennig Bowl among them.' },
    { id: 'red-dog-express', name: 'RED DOG EXPRESS', kind: 'lift', tier: 'major',
      pos: [322.5, 403.8, 401.8], sub: 'TOP STATION', tag: '917 m · six-pack',
      line: 'The 2023 six-pack, unloading on the Snow King knoll. The whole east half of the front side hangs off this point.' },
    { id: 'red-dog-face', name: 'RED DOG FACE', kind: 'ski-run', tier: 'major', diff: 'double',
      pos: [-276.5, 167.4, 135.3], sub: 'MOGULS', tag: '86 m wide · 600 m of bumps',
      line: 'The bump run the resort races on. Every mogul on it was built by somebody braking.' },
    { id: 'race-venue', name: 'OLYMPIC VILLAGE', kind: 'venue', tier: 'mid',
      pos: [-309.5, 13.0, -384.7], sub: 'GS COURSE', tag: 'Stifel Palisades Tahoe Cup' },
    { id: 'base-area', name: 'THE VILLAGE', kind: 'venue', tier: 'major',
      pos: [-270.0, 16.0, -515.0], sub: 'BASE AREA', tag: '1,890 m · lifts, lodges, lots',
      line: 'The valley floor. Five lift bases meet here, and every run in the world ends somewhere on this flat.' },
    { id: 'kt22-base', name: 'KT-22 EXPRESS', kind: 'lift', tier: 'minor',
      pos: [-481.8, 10.3, -359.0], sub: 'BASE STATION', tag: '1,425 m · express quad',
      line: 'The load for KT-22. Ride it and you are on the summit — 535 m of vertical in one lift line.' },
  ],

  // ================================================= SIBERIA / PALISADES BOWL
  // runs/siberia-palisades-A-raw-01. ENU, origin 39.18375/-120.26625,
  // z = 0 at 2366.0 m ASL. Anchors: layout.mjs `A` + runs-data.mjs way tops.
  'siberia-palisades': [
    { id: 'siberia-top', name: 'SIBERIA EXPRESS', kind: 'lift', tier: 'major',
      pos: [-511.6, 279.1, 109.8], sub: 'TOP STATION', tag: '2,645 m · the high lift',
      line: 'The top of the Siberia bowl. Everything worth doing up here starts within 30 m of this unload.' },
    { id: 'palisades-cliffs', name: 'THE PALISADES', kind: 'landmark', tier: 'major',
      pos: [-278.5, 329.9, 346.7], sub: 'CLIFF BAND', tag: 'Chimney · Main · Extra Chute',
      line: 'The cliff band the place is named for: 620 m of rock with three named chutes cut through it. Look before you drop.' },
    { id: 'reverse-traverse', name: 'REVERSE TRAVERSE', kind: 'ski-run', tier: 'mid', diff: 'blue',
      pos: [-242.7, 242.8, 246.8], sub: 'TRAVERSE', tag: 'Siberia top → Headwall top',
      line: 'The high line that connects the two lifts without giving up altitude. Ride it out and the whole Headwall opens.' },
    { id: 'headwall-top', name: 'HEADWALL EXPRESS', kind: 'lift', tier: 'mid',
      pos: [43.7, 266.0, 152.2], sub: 'TOP STATION', tag: '2,632 m',
      line: 'The east end of the Reverse Traverse and the gate to Sun Bowl, North Bowl and the Slot.' },
    { id: 'sun-bowl', name: 'SUN BOWL', kind: 'ski-run', tier: 'minor', diff: 'black',
      pos: [3.7, 259.8, 182.9], sub: 'BOWL', tag: '1,310 m · south-facing',
      line: 'The long south-facing bowl off the Headwall. It runs 1.3 km and it softens first every afternoon.' },
    { id: 'the-slot', name: 'THE SLOT', kind: 'ski-run', tier: 'mid', diff: 'double',
      pos: [259.2, 211.6, 97.8], sub: 'CHUTE', tag: 'off the scree ridge',
      line: 'A narrow line off the east end of the scree ridge. You walk to it, which is why nobody is in it.' },
    { id: 'high-camp', name: 'HIGH CAMP', kind: 'venue', tier: 'mid',
      pos: [102.7, 59.4, -599.5], sub: 'FUNITEL TOP', tag: '2,425 m',
      line: 'The mid-mountain village at the top of the Funitel. Everything on this side funnels back to it.' },
  ],

  // ================================================= DENALI / MULDROW GLACIER
  // runs/denali-muldrow-A-raw-01. ENU about 63.20/-150.80, z = 0 at 1600.0 m
  // ASL, so scene z = ASL - 1600. Anchors: layout.mjs SPAWN / TEMPLE / CAMPS,
  // work/chasms.json, scene/ice-data.mjs LAND. Default gear here is the glider.
  'denali-muldrow': [
    { id: 'temple', name: 'SOUTHERN AIR TEMPLE', kind: 'landmark', tier: 'major',
      pos: [1682.0, 947.0, 17.0], sub: 'TEMPLE', tag: '2,547 m · on the east shelf',
      line: 'A monastery on a shelf above the glacier — towers, an airball court and an outlook over the whole Muldrow. Fly to it.' },
    { id: 'launch-cornice', name: 'LAUNCH CORNICE', kind: 'venue', tier: 'major',
      pos: [-500.0, 1378.0, 1650.0], sub: 'LAUNCH', tag: '2,978 m · step off here',
      line: 'The lip you start from. Nothing but 1,100 m of air between this cornice and the glacier below it.' },
    { id: 'icefall', name: 'LOWER ICEFALL', kind: 'landmark', tier: 'mid',
      pos: [-2812.5, 532.5, 1506.6], sub: 'SERAC ZONE', tag: '2,133 m · broken ice',
      line: 'Where the Muldrow tears itself apart over a step in the bedrock. A kilometre of seracs, best seen from above.' },
    { id: 'chasm-field', name: 'THE CHASM FIELD', kind: 'landmark', tier: 'mid',
      pos: [-2410.0, 475.2, 1288.0], sub: 'CREVASSES', tag: 'six open chasms',
      line: 'Six crevasses wide enough to fly into, cut across the glacier between the icefall and the flats.' },
    { id: 'icefall-camp', name: 'LOWER ICEFALL CAMP', kind: 'venue', tier: 'mid',
      pos: [-2717.7, 415.7, 799.8], sub: 'CAMP', tag: '2,016 m',
      line: 'Tents on the ice below the icefall. The first place on the glacier anybody stops.' },
    { id: 'the-flats', name: 'THE FLATS', kind: 'venue', tier: 'mid',
      pos: [-1189.4, 276.7, -474.7], sub: 'CAMP', tag: '1,877 m · the long flat',
      line: 'The lower camp, out where the Muldrow finally stops falling. Landing here is the easy option.' },
    { id: 'gunsight', name: 'GUNSIGHT PASS', kind: 'landmark', tier: 'minor',
      pos: [-2578.0, 401.7, -637.0], sub: 'PASS', tag: '2,002 m',
      line: 'The notch on the north wall. Thread it and you are out of the Muldrow drainage entirely.' },
  ],

  // ================================================= TRUCKEE BIKE PARK
  // runs/truckee-bike-park-A-raw-01. ENU about 39.32975/-120.15803, z = 0 at
  // 1763.5 m ASL. Line starts come from layout.mjs LOC + the shipped ride
  // manifests; the park is only ±180 m so y is settled off the collider floor.
  'truckee-bike-park': [
    { id: 'runway-26', name: 'RUNWAY 26', kind: 'bike-trail', tier: 'major', diff: 'black',
      pos: [-60.0, 4.0, 108.6], sub: 'SLOPESTYLE', tag: 'start tower · 212 m to the finish',
      line: 'The park’s headline line. Off the tower deck, straight down the spine, and it does not have a slow section.' },
    { id: 'blue-slope', name: 'BLUE SLOPE LINE', kind: 'bike-trail', tier: 'mid', diff: 'blue',
      pos: [-78.0, 4.0, 110.0], sub: 'SLOPESTYLE', tag: 'the friendly one',
      line: 'Same hill as Runway 26, every gap turned into a table. This is where you learn the fall line.' },
    { id: 'jaws', name: 'JAWS', kind: 'bike-trail', tier: 'major', diff: 'double',
      pos: [10.0, 4.0, 116.5], sub: 'UPPER DJZ', tag: 'the big set',
      line: 'The largest jumps in the park, at the top of the upper dirt-jump zone. Full commitment or nothing.' },
    { id: 'djz', name: 'DIRT JUMP ZONE', kind: 'venue', tier: 'mid',
      pos: [50.0, 4.0, 60.0], sub: 'LOWER DJZ', tag: 'Maidu · SNP · Barbara-Jean · Intern',
      line: 'Four lines off one roll-in shelf, black through blue. The whole zone runs north into the plaza.' },
    { id: 'pump-track', name: 'PUMP TRACK', kind: 'venue', tier: 'mid',
      pos: [84.0, 4.0, -76.0], sub: 'PUMP', tag: 'asphalt loop + strider ring',
      line: 'The loop nobody pedals. Pump it well enough and you never touch the cranks for a full lap.' },
    { id: 'dual-slalom', name: 'DUAL SLALOM', kind: 'venue', tier: 'mid',
      pos: [-112.0, 4.0, 100.0], sub: 'RACE', tag: 'two gates · 184 m',
      line: 'Two parallel lines off one start deck, berm for berm the whole way down. Race venue, west edge of the park.' },
    { id: 'trailhead', name: 'TBP TRAILHEAD', kind: 'landmark', tier: 'minor',
      pos: [-60.0, 4.0, -90.0], sub: 'BASE', tag: 'plaza · shop · airbag',
      line: 'Where every line ends and every lap starts again. Map kiosk, shop hut and the airbag pad.' },
  ],

  // ================================================= RED BULL JOYRIDE
  // runs/redbull-joyride-whistler-A-raw-01. This world is authored THREE.js
  // Y-up (+Z south), `up:'y'` — no conversion. Values are the ride-line points
  // out of scene/layout.mjs, not the deck tops.
  'redbull-joyride-whistler': [
    { id: 'start-hut', name: 'START HUT', kind: 'venue', tier: 'major',
      pos: [2.0, 69.8, 300.0], sub: 'START', tag: 'drop in here',
      line: 'The deck at the top of the Boneyard. Seventeen features and 514 m of course between you and the corral.' },
    { id: 'boner-log', name: 'BONER LOG', kind: 'bike-trail', tier: 'mid', diff: 'black',
      pos: [5.97, 66.48, 238.4], sub: 'FEATURE 3', tag: 'we did not name it',
      line: 'A log ride into a gap, third feature down. Crankworx commentary has been dealing with the name since 2011.' },
    { id: 'lip-14ft', name: 'THE 14-FOOTER', kind: 'bike-trail', tier: 'mid', diff: 'double',
      pos: [-16.1, 53.72, 115.59], sub: 'FEATURE 7', tag: '4.3 m lip',
      line: 'The lip that decides the contest. Go deep off it and the crowd hears about it before you land.' },
    { id: 'whale-tail', name: 'WHALE-TAIL', kind: 'bike-trail', tier: 'major', diff: 'double',
      pos: [-12.63, 26.56, 10.53], sub: 'FEATURE 10', tag: '17 m gap into a step-down',
      line: 'The signature feature of Joyride: off the deck, over the tail, straight into a step-down with no reset between them.' },
    { id: 'finish-corral', name: 'FINISH CORRAL', kind: 'venue', tier: 'major',
      pos: [-13.52, -2.75, -197.51], sub: 'FINISH', tag: 'under the arch',
      line: 'The legendary corral at the bottom of the Whistler bike park. Twelve thousand people, one inflatable arch.' },
  ],

  // ================================================= EASTNOR FLOATING COURSE
  // runs/eastnor-floating-bike-course-A-raw-01. ENU, z = 0 at the lake surface;
  // `up:'z'`. Module mid-points from scene/layout.mjs's accumulator walk.
  'eastnor-floating-bike-course': [
    { id: 'start-arch', name: 'START ARCH', kind: 'venue', tier: 'major',
      pos: [177.6, 0.45, -8.0], sub: 'START', tag: 'roll in west',
      line: 'The arch on the east shore. From here the whole course floats — nothing you ride is standing on the bottom.' },
    { id: 'cheese-wheel', name: 'THE CHEESE WHEEL', kind: 'bike-trail', tier: 'major', diff: 'black',
      pos: [88.0, 1.65, -8.0], sub: 'FEATURE', tag: '4 m wheel · rolling',
      line: 'A four-metre wheel of cheese you ride over the top of. It creaks. It has always creaked.' },
    { id: 'teeter', name: 'THE TEETER', kind: 'bike-trail', tier: 'minor', diff: 'blue',
      pos: [109.5, 0.5, -8.0], sub: 'FEATURE', tag: 'floating seesaw',
      line: 'A seesaw on pontoons. It tips when you cross the middle, exactly as a seesaw should, and it is on water.' },
    { id: 'castle', name: 'EASTNOR CASTLE', kind: 'landmark', tier: 'major',
      pos: [-248.0, 11.0, -58.0], sub: 'VIEWPOINT', tag: '1812 · deer park',
      line: 'The castle across the water, and the reason the course is here. Eight hundred years of lawn, and tyre marks on it.' },
    { id: 'finish', name: 'FINISH JETTY', kind: 'venue', tier: 'mid',
      pos: [-93.1, 0.4, -43.3], sub: 'FINISH', tag: 'still floating',
      line: 'The far end of the chain. Get here with the plank still under you and both of those count as results.' },
  ],

  // ================================================= SAND HARBOR, LAKE TAHOE
  // runs/sand-harbor-B-harness-01 — the CONTRACT run (A-raw-01 is a
  // page-takeover orbit demo with no world.mjs and no declared frame, so this
  // key is deliberately B-only). ENU, z = 0 at the waterline; `up:'z'`.
  // Positions are the layout.json hero anchors.
  'sand-harbor-B': [
    { id: 'divers-rock', name: "DIVER'S ROCK", kind: 'landmark', tier: 'major',
      pos: [55.8, 3.0, -209.2], sub: 'JUMP ROCK', tag: '4.6 m over the water',
      line: 'The granite block everybody jumps off. The lake is clear enough that you can see exactly how deep it is not.' },
    { id: 'the-point', name: 'THE POINT', kind: 'landmark', tier: 'major',
      pos: [-46.7, 3.0, -36.2], sub: 'HEADLAND', tag: '10.5 m granite',
      line: 'The granite headland at the west end of the beach. Climb it for the view down the whole east shore.' },
    { id: 'main-beach', name: 'MAIN BEACH', kind: 'venue', tier: 'major',
      pos: [88.5, 1.2, -7.4], sub: 'BEACH', tag: 'south shore · 200 m of sand',
      line: 'The main south beach. Boulders at both ends, turquoise shelf offshore, and the clearest water in Nevada.' },
    { id: 'amphitheater', name: 'TREPP AMPHITHEATER', kind: 'venue', tier: 'mid',
      pos: [44.9, 3.0, -33.7], sub: 'AMPHITHEATRE', tag: 'nine granite rows',
      line: 'Nine rows of granite facing the lake. Perfect acoustics, tough room.' },
    { id: 'boat-launch', name: 'BOAT LAUNCH', kind: 'venue', tier: 'minor',
      pos: [203.6, 0.5, -308.9], sub: 'PIER', tag: 'north end',
      line: 'The pier and ramp at the north end of the park. A gull holds the end of it and does not negotiate.' },
  ],
};

// ===========================================================================
// wiring
// ===========================================================================

function regKey(ctx) {
  const p = (ctx.poi || '').trim();
  if (REG[p]) return p;
  const r = (ctx.run || '').trim();
  let best = '';
  for (const k of Object.keys(REG)) {
    if (r.indexOf(k) === 0 && k.length > best.length) best = k;
  }
  return best;
}

// contract markers (world.markers) — validate hard, drop anything malformed
function fromContract(list, upAxis) {
  const out = [];
  for (const m of list) {
    if (!m || !Array.isArray(m.pos) || m.pos.length < 3) continue;
    const p = m.pos.map(Number);
    if (!p.every((v) => isFinite(v))) continue;
    // the z-up tip, exactly as main.js does it for spawn and lifts
    const pos = upAxis === 'z' ? [p[0], p[2], -p[1]] : [p[0], p[1], p[2]];
    out.push({
      id: String(m.id || m.name || 'marker-' + out.length),
      name: String(m.name || m.id || 'POI'),
      kind: KINDS[m.kind] ? m.kind : 'landmark',
      tier: TIERS[m.tier] ? m.tier : 'mid',
      diff: m.diff || '', sub: m.sub || '', tag: m.tag || '',
      line: m.line || m.blurb || '',
      pos,
    });
    if (out.length >= MAX_MARKERS) break;
  }
  return out;
}

function fromRegistry(key) {
  const rows = (REG[key] || []).slice(0, MAX_MARKERS);
  return rows.map((m) => ({
    id: m.id, name: m.name, kind: KINDS[m.kind] ? m.kind : 'landmark',
    tier: TIERS[m.tier] ? m.tier : 'mid',
    diff: m.diff || '', sub: m.sub || '', tag: m.tag || '',
    line: m.line || '', pos: m.pos.slice(),
  }));
}

// Registry y is the anchor's own elevation — an OSM node's, a layout module's,
// or in a couple of worlds a flat placeholder because the layout only ships XY.
// Where the collider floor can be read and does not disagree wildly (a reading
// 60 m out is a roof, a serac or a hole in the grid), prefer it: the DEM the
// sign hangs over should be the one the player actually stands on.
const SETTLE_TOL = 60;

function settle(rows) {
  const at = (S.collision && S.collision.groundAt && S.collision.bounds)
    ? (x, z) => S.collision.groundAt(x, z, S.collision.bounds.maxY + 5)
    : (window.__player && window.__player.groundAt) || null;
  if (!at) return 0;
  let n = 0;
  for (const r of rows) {
    try {
      const g = at(r.pos[0], r.pos[2]);
      if (g === null || g === undefined || !isFinite(g)) continue;
      r.ground = g;
      if (Math.abs(g - r.pos[1]) <= SETTLE_TOL * S.u) { r.pos[1] = g; n++; }
    } catch { S.errors++; }
  }
  return n;
}

// How far away a sign is still worth drawing. A 400 m bike park and a 5 km
// glacier cannot share one number: take it from the collidable extent, which
// is the only honest measure of how big the world the player is in actually is.
// The topmost collidable surface in a column — a roof, a serac, the cliff lip
// above an anchor tucked under it. groundAt() probes DOWN from above everything,
// so this is the highest thing the world has at (x, z).
function topAt(x, z) {
  try {
    const col = S.collision;
    if (!col || !col.groundAt || !col.bounds) return null;
    const g = col.groundAt(x, z, col.bounds.maxY + 5 * S.u);
    return (g === null || g === undefined || !isFinite(g)) ? null : g;
  } catch { S.errors++; return null; }
}

// Where the sign for `r` actually hangs. Start at the tier height over the
// settled ground, then make sure nothing in the world is standing between the
// anchor and the sign, or above the sign:
//   1. the top of the column must be below it (an anchor under an overhang has a
//      topmost surface far above its own ground);
//   2. a ray straight up from just over the anchor must reach it without hitting
//      anything (a roof, a bridge deck, the underside of a serac).
// Anything found pushes the sign to CLEAR_M above the obstruction, up to
// RAISE_MAX × the tier height. Records r.top / r.raise so the tests can read it.
function skyFor(r, tierH) {
  const base = r.pos[1];
  const want = base + tierH * S.u;
  const cap = base + tierH * S.u * RAISE_MAX;
  const clear = CLEAR_M * S.u;
  let y = want;
  const top = topAt(r.pos[0], r.pos[2]);
  r.top = top;
  if (top !== null && y < top + clear) y = top + clear;
  try {
    const col = S.collision;
    if (col && col.raycast) {
      const from = base + 3 * S.u;                 // clear of the triangle underfoot
      const reach = Math.max(y - from, 1);
      const hit = col.raycast(r.pos[0], from, r.pos[2], 0, 1, 0, reach);
      if (hit && isFinite(hit.dist)) {
        const hy = from + hit.dist;
        if (y < hy + clear) y = hy + clear;
      }
    }
  } catch { S.errors++; }
  if (y > cap) y = cap;
  if (y < want) y = want;
  r.raise = +(y - want).toFixed(2);
  return y;
}

function farRange() {
  let span = 0;
  try {
    const b = S.collision && S.collision.bounds;
    if (b) span = Math.max(b.x1 - b.x0, b.z1 - b.z0);
  } catch { span = 0; }
  if (!isFinite(span) || span <= 0) span = 1800 * S.u;
  S.farD = clamp(span * 0.55, FAR_D * S.u, 4000 * S.u);
  S.farGone = S.farD * 1.55;
  // How wide a card is allowed to get in world units. This is the distance at
  // which a sign stops holding its angular size and starts shrinking — put it
  // near the far range so a 1.4 km peak on a merged resort is still a legible
  // sign, while a 400 m bike park's cards never bloat.
  S.maxW = clamp(S.farD * 0.09, 96 * S.u, 420 * S.u);
}

function build(THREE, rows) {
  const n = rows.length;
  if (!n) return;
  S.atlas = buildAtlas(THREE, rows);
  S.haloTex = buildHalo(THREE);

  const uvCard = (i) => {
    const col = i % COLS, r = (i / COLS) | 0;
    const u0 = (col * CARD_W) / ATLAS_W, u1 = ((col + 1) * CARD_W) / ATLAS_W;
    // canvas y grows down, texture v grows up
    const v1 = 1 - (r * CARD_H) / ATLAS_H, v0 = 1 - ((r + 1) * CARD_H) / ATLAS_H;
    return [u0, v0, u1, v1];
  };
  const gCard = quadGeo(THREE, n, uvCard);
  const gHalo = quadGeo(THREE, n, () => [0, 0, 1, 1]);

  // OCCLUSION. depthTest is ON for both meshes: a sign is a thing in the world at
  // a real distance, and a ridge or a building in front of it must hide it. The
  // halo is additive and gets exactly the same treatment — an additive glow that
  // survives the mountain in front of it is the same "see through walls" bug as
  // the card, only brighter.
  //
  // depthWrite stays OFF. These are transparent quads with a shared atlas, drawn
  // in an order the declutter pass decides rather than back to front, so writing
  // depth would let whichever card happened to be drawn first punch a hole in the
  // one behind it — and would let the additive halo mask its own card.
  //
  // Because the billboard is built by offsetting the CENTRE in view space
  // (`mv.xy += aCorner * aScale`, mv.z untouched), every fragment of a quad
  // carries the centre's depth. The sign therefore tests as a flat plane facing
  // the camera at the sign's own distance, which is what makes partial occlusion
  // look right: a ridge crossing the quad clips it along the skyline instead of
  // popping the whole card in and out.
  const mCard = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: S.atlas } },
    vertexShader: VERT, fragmentShader: FRAG_CARD,
    transparent: true, depthTest: true, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
  });
  const mHalo = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: S.haloTex } },
    vertexShader: VERT, fragmentShader: FRAG_HALO,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });

  S.card = new THREE.Mesh(gCard, mCard);
  S.halo = new THREE.Mesh(gHalo, mHalo);
  S.card.name = 'pmk:cards'; S.halo.name = 'pmk:halos';
  S.card.frustumCulled = false; S.halo.frustumCulled = false;
  // Both are transparent, so they sort into the transparent pass: renderOrder
  // only decides the halo draws before its card, and that the pair draws after a
  // world's own transparent props (water, canopies) instead of interleaving with
  // them. It no longer means "on top of everything" — the depth test decides that.
  S.card.renderOrder = 992; S.halo.renderOrder = 991;   // halo behind the card

  S.group = new THREE.Group();
  S.group.name = 'pmk:markers';
  S.group.add(S.halo, S.card);
  S.scene.add(S.group);

  // static per-instance data: the anchor and the halo tint
  const cC = gCard.getAttribute('aCenter'), cH = gHalo.getAttribute('aCenter');
  const tH = gHalo.getAttribute('aTint');
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const T = tierOf(r.tier);
    r.sky = skyFor(r, T.h);
    const col = hex(THREE, kindOf(r.kind).glow);
    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      cC.array[j * 3] = r.pos[0]; cC.array[j * 3 + 1] = r.sky; cC.array[j * 3 + 2] = r.pos[2];
      cH.array[j * 3] = r.pos[0]; cH.array[j * 3 + 1] = r.sky; cH.array[j * 3 + 2] = r.pos[2];
      tH.array[j * 3] = col.r; tH.array[j * 3 + 1] = col.g; tH.array[j * 3 + 2] = col.b;
    }
    r.phase = (i * 2.39996) % 6.283;
  }
  cC.needsUpdate = true; cH.needsUpdate = true; tH.needsUpdate = true;
}

// ===========================================================================
// per-frame
// ===========================================================================

function step(dt, devOn) {
  const rows = S.rows;
  if (!rows.length || !S.card) return;
  const cam = S.camera;
  const cp = cam.position;
  // camera forward, for the centrality term of the declutter score.
  // getWorldDirection() refreshes the matrix itself — this runs before the
  // world renders, so reading matrixWorld raw would be a frame behind.
  const f = cam.getWorldDirection(S.fwd);
  const fx = f.x, fy = f.y, fz = f.z;
  // the camera's own right/up, so a marker can be placed on the SCREEN rather
  // than merely in the world — that is what the declutter pass needs
  const e = cam.matrixWorld.elements;
  const rx = e[0], ry = e[1], rz = e[2];
  const ux = e[4], uy = e[5], uz = e[6];

  let nearest = null, nearD = Infinity, visible = 0;

  for (const r of rows) {
    // ---- distance to the POI ON THE GROUND (that is the thing you walk to),
    // and to the sign in the sky (that is what sets its on-screen size)
    const dx = cp.x - r.pos[0], dy = cp.y - r.pos[1], dz = cp.z - r.pos[2];
    r.d = Math.sqrt(dx * dx + dy * dy + dz * dz) / S.u;
    const sy = cp.y - r.sky;
    r.ds = Math.sqrt(dx * dx + sy * sy + dz * dz);
    if (r.d < nearD) { nearD = r.d; nearest = r; }

    // where it lands on screen, in radians off the axis: centrality (1 dead
    // ahead, 0 at 90°) plus horizontal and vertical offset, and the angular
    // size the card is about to be drawn at
    const L = r.ds || 1;
    r.dot = (-dx * fx - sy * fy - dz * fz) / L;
    r.sx = (-dx * rx - sy * ry - dz * rz) / L;
    r.sy = (-dx * ux - sy * uy - dz * uz) / L;
    r.aw = Math.min(ANG, S.maxW / L) * tierOf(r.tier).size;
    r.ah = r.aw * (CARD_H / CARD_W);

    // ---- fades. Everything below is a function of distance and time, never
    // of frame count, so a 10 fps headless run and a 240 Hz monitor agree.
    let a = 1;
    if (r.d < AT_R * S.u) a = 0.04;                                  // AT the poi: get out of the way
    else if (r.d < AT_R * 1.8 * S.u) a = 0.04 + 0.96 * ((r.d - AT_R * S.u) / (AT_R * 0.8 * S.u));
    if (r.ds > S.farD) a *= clamp(1 - (r.ds - S.farD) / (0.3 * S.farD), 0, 1);
    r.aCard = a;
    let h = clamp(1 - (r.ds - S.farGone) / (0.45 * S.farGone), 0, 1) * tierOf(r.tier).glow;
    if (r.d < AT_R * S.u) h *= 0.12;
    r.aHalo = h;
    if (a > 0.02 || h > 0.02) visible++;
  }

  // ---- screen-space declutter. Two rules, in this order:
  //   1. at most LIT_MAX signs are fully lit at once, best score first — a
  //      score that rewards being near and dead ahead;
  //   2. a sign that would land ON TOP of one already lit is demoted, tested as
  //      an overlap of the two cards' angular boxes on screen.
  // Everything demoted stays on as a dim beacon: you can still see there is a
  // place over there, you just are not asked to read six cards at once. This is
  // what stops a merged resort's five distant lift stations from stacking into
  // one illegible pile when you look up the valley from the base.
  const score = (r) => r.dot * 900 + tierOf(r.tier).rank - r.ds * 0.55;
  const sorted = rows.slice().sort((p, q) => score(q) - score(p));
  const litRows = S.litRows;
  litRows.length = 0;
  for (const r of sorted) {
    let ok = r.dot > 0.05 && litRows.length < LIT_MAX;
    if (ok) {
      for (const q of litRows) {
        if (Math.abs(r.sx - q.sx) < 0.5 * (r.aw + q.aw) &&
            Math.abs(r.sy - q.sy) < 0.62 * (r.ah + q.ah)) { ok = false; break; }
      }
    }
    r.full = ok;
    if (ok) litRows.push(r);
  }
  S.lit = litRows.length;

  // ---- how big each card is about to be drawn.
  //
  // Angular-constant sizing. A sign is only useful if you can READ it, so the
  // card is sized to subtend a roughly fixed slice of the screen — about 12° of
  // the horizontal field for a mid-tier one — instead of shrinking with distance
  // like a world-space object. The clamps stop it swallowing the sky underfoot,
  // and let it go back to being a small bright chip a kilometre out, which is the
  // "far = smaller" half of the distance behaviour. A demoted sign also shrinks,
  // so a cluster reads as one card plus a couple of chips rather than three cards
  // fighting for the same patch of sky.
  //
  // This runs BEFORE the aim test, because the aim box is the card's own angular
  // size, and the aim test in turn drives the hover ease below. Size is settled
  // once and reused; hovering brightens a sign, it never resizes it — a card that
  // grew under the crosshair would shove its neighbours around.
  for (const r of rows) {
    r.w = clamp(r.ds * ANG, 14 * S.u, S.maxW) * tierOf(r.tier).size * (r.full ? 1 : 0.42);
    r.h = r.w * (CARD_H / CARD_W);
    r.angW = r.w / (r.ds || 1);
    r.angH = r.h / (r.ds || 1);
  }

  // ---- what the crosshair is on, and whether a ridge is in the way
  tickAim(dt, !devOn && travelLive());
  tickHover();

  // ---- write the instance attributes
  const gc = S.card.geometry, gh = S.halo.geometry;
  const aA = gc.getAttribute('aAlpha'), aS = gc.getAttribute('aScale'), aL = gc.getAttribute('aLift');
  const hA = gh.getAttribute('aAlpha'), hS = gh.getAttribute('aScale'), hL = gh.getAttribute('aLift');

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const bob = Math.sin(S.t * 0.55 + r.phase) * 1.0 * S.u;
    const pulse = 0.86 + 0.14 * Math.sin(S.t * 0.9 + r.phase * 1.7);
    const w = r.w, h = r.h;

    // ---- the brightness stack, dimmest term first. Each layer survives the one
    // over it, which is what keeps every earlier behaviour intact:
    //   aCard  the distance / far-chip / AT-the-poi fade — at 25 m this is 0.04
    //          and nothing below can rescue it, so standing on a place still
    //          clears its sign out of the view;
    //   dim    declutter demotion, so a resting demoted sign is dimmer than a
    //          resting lit one;
    //   rest   the resting floor, lifted to 1 by hover.
    // Hover lifts the demotion too: putting the crosshair on a sign is an
    // explicit statement of interest, and answering it with 45 % of half is a
    // sign that looks broken rather than chosen.
    const hv = smooth(r.hov || 0);
    const dim = r.full ? 1 : 0.45;
    const hdim = r.full ? 1 : 0.55;
    const ca = r.aCard * (dim + (1 - dim) * hv) * (REST_CARD + (1 - REST_CARD) * hv);
    const ha = r.aHalo * pulse * (hdim + (1 - hdim) * hv) * (REST_HALO + (1 - REST_HALO) * hv);
    const hw = w * (r.full ? 1.7 : 1.95) * pulse;
    r.aDraw = ca; r.hDraw = ha;

    for (let k = 0; k < 4; k++) {
      const j = i * 4 + k;
      aS.array[j * 2] = w; aS.array[j * 2 + 1] = h;
      aA.array[j] = ca; aL.array[j] = bob;
      hS.array[j * 2] = hw; hS.array[j * 2 + 1] = hw;
      hA.array[j] = ha; hL.array[j] = bob + h * 0.06;
    }
  }
  aA.needsUpdate = aS.needsUpdate = aL.needsUpdate = true;
  hA.needsUpdate = hS.needsUpdate = hL.needsUpdate = true;

  S.nearest = nearest; S.visible = visible;

  // ---- the approach card
  if (devOn) { if (S.intro) hideIntro(); return; }        // dev mode: fly, do not narrate
  // The card belongs to the nearest UNSEEN poi inside the approach radius — not
  // to `nearest`, or standing next to one place you have already met would mute
  // the introduction to the one you are actually walking toward.
  let cand = null;
  for (const r of rows) {
    if (r.d > RESET_R * S.u) r.introShown = false;        // properly left — re-arm
    if (r.introShown || r.d > INTRO_R * S.u) continue;
    if (!cand || r.d < cand.d) cand = r;
  }
  if (!S.intro && cand) showIntro(cand);
}

// ===========================================================================
// fast travel — aim at a sign, press T, be there
// ===========================================================================
//
// The aim test is angular, against the card the shader actually drew: `r.sx` and
// `r.sy` are already the sign's offset from the view axis along the camera's own
// right/up (computed for the declutter pass), and `r.angW/angH` are the drawn
// card's angular size. A hit is "inside the card, padded and then capped".
//
// When two signs overlap on screen, the offer goes to the one the crosshair is
// most deeply inside, measured as a fraction of that sign's OWN box (aimMiss) so
// big cards and demoted chips are judged the same way; a genuine tie goes to the
// nearer sign. Picking purely by nearness — which is what this first did — hands
// the offer to whichever sign happens to be closest among all the ones whose
// generous padded box the crosshair grazes, so aiming squarely at a far venue lit
// a near lift station instead, and the hover ease went with it.
//
// Occlusion. The signs are depth-tested now, so a sign behind a ridge is not on
// the screen — and something you cannot see must not be something you can travel
// to. The GPU's answer is not readable from here at a sane cost, so this walks
// the ground profile along the camera→sign line and asks whether the world's
// topmost surface ever rises above the ray. That is the same question the depth
// buffer answered, asked of the collider instead of the framebuffer, and it is
// the case Greg described: a ridge standing between you and the sign.

// Is this sign a target at all, and if so how well is the crosshair on it?
//
// ELIGIBILITY is the padded, capped box, exactly as before — that pad is what
// makes a card only 4.5° tall a comfortable thing to point at.
//
// RANKING is a separate question and is measured against the sign's OWN DRAWN
// CARD: 0 dead centre, 1 on the card's edge, above 1 out in the padding. Two
// normalisations matter here. Against the card rather than the box, so a sign the
// crosshair is genuinely ON always out-ranks one it is merely in the padding of —
// the vertical pad is 2× and would otherwise let a sign 4° above the crosshair
// look better placed than the one under it. And against each sign's own size, so
// a 1.30 major card and a 0.42 demoted chip compete on "is the crosshair on this
// sign" rather than on which of them is bigger.
function aimMiss(r) {
  if (!(r.aCard > AIM_MIN_A)) return Infinity;
  if (!(r.dot > AIM_MIN_DOT)) return Infinity;
  if (!isFinite(r.angW) || !isFinite(r.angH)) return Infinity;
  if (!(r.angW > 0) || !(r.angH > 0)) return Infinity;
  const hw = Math.min(0.5 * r.angW * AIM_PAD_H, AIM_MAX_H);
  const hh = Math.min(0.5 * r.angH * AIM_PAD_V, AIM_MAX_V);
  if (Math.abs(r.sx) > hw || Math.abs(r.sy) > hh) return Infinity;
  return Math.max(Math.abs(r.sx) / (0.5 * r.angW), Math.abs(r.sy) / (0.5 * r.angH));
}

function occluded(r) {
  const col = S.collision;
  if (!col || !col.groundAt || !col.bounds) return false;   // no collider: nothing to hide behind
  try {
    const cp = S.camera.position;
    const ex = r.pos[0] - cp.x, ey = r.sky - cp.y, ez = r.pos[2] - cp.z;
    const top = col.bounds.maxY + 5 * S.u;
    const bias = 0.5 * S.u;
    for (let i = 1; i < OCC_STEPS; i++) {
      const f = i / OCC_STEPS;
      const g = col.groundAt(cp.x + ex * f, cp.z + ez * f, top);
      if (g === null || g === undefined || !isFinite(g)) continue;   // outside the grid
      if (g > cp.y + ey * f + bias) return true;
    }
  } catch { S.errors++; }
  return false;
}

// run every frame off the cheap angular test; re-probe occlusion on a timer, or
// straight away when the sign under the crosshair changes
function tickAim(dt, live) {
  if (!live) { setAim(null); return; }
  let best = null, bestM = Infinity;
  for (const r of S.rows) {
    const m = aimMiss(r);
    if (m === Infinity) continue;
    // Most-centred wins. Only a true tie — the crosshair equally deep inside two
    // boxes — falls through to "nearest", which is still what keeps a distant peak
    // from taking the offer off the lift station standing in front of it.
    if (m < bestM - 1e-4) { best = r; bestM = m; }
    else if (best && m <= bestM + 1e-4 && r.ds < best.ds) { best = r; bestM = m; }
  }
  // Hold the offer on the sign that already has it unless the challenger is
  // clearly more centred — but never while the current one is blocked, or a sign
  // behind a ridge would sit on the offer and mute the one you can actually see.
  if (best && S.aim && !S.aimBlocked && best !== S.aim) {
    const cur = aimMiss(S.aim);
    if (cur !== Infinity && bestM > cur - AIM_STICK) { best = S.aim; bestM = cur; }
  }
  if (best !== S.aim) { S.aim = best; S.aimT = 0; S.aimBlocked = best ? occluded(best) : false; }
  else if (best) {
    S.aimT += dt;
    if (S.aimT >= AIM_HZ) { S.aimT = 0; S.aimBlocked = occluded(best); }
  }
  setAim(S.aimBlocked ? null : best);
}

// Ease every sign's hover weight toward where the crosshair says it should be.
//
// Wall clock, not dt — same lesson the teleport flash taught: dt is clamped to
// 50 ms a frame, so on a slow world a dt-driven 150 ms ease would take most of a
// second. A rate ramp rather than a timestamp so it is interruptible: glance
// away halfway up and it falls from halfway, it does not snap or restart.
function tickHover() {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const wdt = clamp((now - (S.hoverWall || now)) / 1000, 0, 0.25);
  S.hoverWall = now;
  const on = (S.aim && !S.aimBlocked) ? S.aim : null;
  for (const r of S.rows) {
    if (r.hov === undefined) r.hov = 0;
    const want = r === on ? 1 : 0;
    if (r.hov === want) continue;
    const up = want > r.hov;
    const k = r.hov + (up ? 1 : -1) * (wdt / (up ? HOVER_IN : HOVER_OUT));
    r.hov = up ? Math.min(1, k) : Math.max(0, k);
  }
}

function setAim(r) {
  const el = S.aimEl;
  if (!el) return;
  if (!r) { el.classList.remove('is-on'); return; }
  if (S.aimNameEl.textContent !== r.name) {
    S.aimNameEl.textContent = r.name;
    el.style.setProperty('--pmk-accent', kindOf(r.kind).glow);
  }
  el.classList.add('is-on');
}

// what the crosshair is offering right now, or null
export function aimedAt() {
  const r = (S.aim && !S.aimBlocked) ? S.aim : null;
  if (!r) return null;
  return {
    id: r.id, name: r.name, kind: r.kind, tier: r.tier,
    d: +(r.d || 0).toFixed(1), ds: +(r.ds || 0).toFixed(1),
    offAxisDeg: +(Math.hypot(r.sx, r.sy) * 180 / Math.PI).toFixed(2),
    blocked: false,
  };
}

// the same widening probe lift.js steps off a chair with: trust the triangles,
// not the declared y, and never drop anybody through the floor
function groundY(x, z, hintY) {
  const col = S.collision;
  if (!col || !col.groundAt) return hintY;
  try {
    for (const up of [2.5, 12, 45]) {
      const g = col.groundAt(x, z, hintY + up * S.u);
      if (g !== null && g !== undefined && isFinite(g)) return g;
    }
    const g = col.groundAt(x, z, col.bounds.maxY + 5 * S.u);
    if (g !== null && g !== undefined && isFinite(g)) return g;
  } catch { S.errors++; }
  return hintY;
}

// three.js forward is -Z and the controller reads yaw as (-sin, -cos) — the same
// conversion lift.js uses to face you back down the line
const yawToward = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));

// The whole feature. Lands TRAVEL_OFF metres short of the anchor on the side you
// came from, on the real floor, looking at the place — so you arrive seeing the
// thing you asked for rather than standing in the middle of it.
export function fastTravel(id) {
  try {
    if (!S.ok || !S.rows.length || !S.ctrl || !S.ctrl.teleport || !S.THREE) return null;
    const r = id ? S.rows.find((q) => q.id === id || q.name === id)
                 : ((S.aim && !S.aimBlocked) ? S.aim : null);
    if (!r) return null;

    const p = S.ctrl.position;
    let ox = p.x - r.pos[0], oz = p.z - r.pos[2];
    let m = Math.hypot(ox, oz);
    if (!(m > 1e-3)) { ox = 0; oz = 1; m = 1; }      // standing on it: step off south
    const off = TRAVEL_OFF * S.u;
    const hint = (r.ground !== undefined && r.ground !== null && isFinite(r.ground)) ? r.ground : r.pos[1];
    const th0 = Math.atan2(oz / m, ox / m);

    // The side you came from is the first choice — you arrive looking the way you
    // were already looking. But a temple on a shelf has an edge, and three metres
    // the wrong way off it is a fall, not an arrival. So walk the offsets round
    // the anchor and take the first whose floor is on the anchor's own level.
    let x = r.pos[0] + Math.cos(th0) * off, z = r.pos[2] + Math.sin(th0) * off;
    let y = groundY(x, z, hint), bestErr = Math.abs(y - hint);
    if (bestErr > LAND_TOL * S.u) {
      for (let k = 1; k < 8; k++) {
        const th = th0 + (k * Math.PI * 2) / 8;
        const tx = r.pos[0] + Math.cos(th) * off, tz = r.pos[2] + Math.sin(th) * off;
        const ty = groundY(tx, tz, hint);
        const err = Math.abs(ty - hint);
        if (err < bestErr) { x = tx; z = tz; y = ty; bestErr = err; }
        if (bestErr <= LAND_TOL * S.u) break;
      }
    }
    const yaw = yawToward(x, z, r.pos[0], r.pos[2]);

    const from = { x: p.x, y: p.y, z: p.z };
    S.ctrl.teleport(new S.THREE.Vector3(x, y, z), yaw);
    S.flash = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + FLASH_MS;
    paintFlash();
    S.travels++;
    // arriving IS the introduction — let the approach card play again here
    r.introShown = false;
    hideIntro();
    S.aim = null; S.aimBlocked = false; setAim(null);
    S.lastTravel = {
      id: r.id, name: r.name, from, to: { x, y, z }, yaw,
      gear: (S.ctrl && S.ctrl.mode) || null,
    };
    if (S.hud && S.hud.flash) { try { S.hud.flash(String(r.name).toLowerCase()); } catch { S.errors++; } }
    return S.lastTravel;
  } catch { S.errors++; return null; }
}

// Hold white for a beat, then ease it off — a cut would read as a bug, a slow
// dissolve would read as a loading screen. S.flash is the wall-clock instant the
// flash ends; the first fifth of it stays at full white.
function paintFlash() {
  const el = S.flashEl;
  if (!el) return;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const left = S.flash - now;
  if (left <= 0) { S.flash = 0; el.style.display = 'none'; el.style.opacity = '0'; return; }
  const k = clamp(left / (FLASH_MS * 0.8), 0, 1);
  el.style.display = '';
  el.style.opacity = String(+(k * k * (3 - 2 * k)).toFixed(3));
}

const typingIn = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

// Everything that owns the keyboard ahead of us: the fly camera, the pause
// panel, the gear menu, the locker. Same order main.js gates F (ride the lift).
function travelLive() {
  try {
    if (!S.ok || !S.rows.length) return false;
    const P = window.__player;
    if (P && P.devMode && P.devMode()) return false;
    if (S.hud && S.hud.isPaused && S.hud.isPaused()) return false;
    if (S.hud && S.hud.gearOpen && S.hud.gearOpen()) return false;
    if (P && P.inventoryOpen && P.inventoryOpen()) return false;
  } catch { return false; }
  return true;
}

function wireKeys() {
  if (S.wired) return;
  S.wired = true;
  addEventListener('keydown', (e) => {
    try {
      if (e.code !== TRAVEL_KEY) return;
      if (e.repeat) return;                 // one teleport per keypress, not per repeat
      if (typingIn(e.target)) return;       // the dev note field
      if (!travelLive()) return;
      if (!S.aim || S.aimBlocked) return;   // nothing under the crosshair
      fastTravel();
      e.preventDefault();
    } catch { S.errors++; }
  });
}

// ===========================================================================
// public
// ===========================================================================

export function init(ctx) {
  try {
    if (S.ok || !ctx) return;
    S.THREE = ctx.THREE; S.scene = ctx.scene; S.camera = ctx.camera;
    S.ctrl = ctx.ctrl; S.hud = ctx.hud; S.collision = ctx.collision || null;
    S.poi = ctx.poi || ''; S.run = ctx.run || '';
    if (!S.THREE || !S.scene || !S.camera) return;
    S.u = (S.ctrl && S.ctrl.T && S.ctrl.T.eyeHeight) ? S.ctrl.T.eyeHeight / 1.70 : 1;
    S.fwd = new S.THREE.Vector3();

    let rows = [];
    if (Array.isArray(ctx.markers) && ctx.markers.length) {
      rows = fromContract(ctx.markers, ctx.upAxis === 'z' ? 'z' : 'y');
      S.source = 'contract';
    }
    if (!rows.length) {
      S.key = regKey(ctx);
      if (S.key) { rows = fromRegistry(S.key); S.source = 'registry'; }
    }
    S.rows = rows;
    if (!rows.length) { S.ok = true; return; }   // no markers: mounted, inert, silent

    mountDom();
    farRange();
    S.settled = settle(rows);
    build(S.THREE, rows);
    wireKeys();
    S.ok = true;
  } catch { S.errors++; }
}

export function update(dt) {
  if (!S.ok) return;
  try {
    dt = clamp(dt || 0.016, 0.0005, 0.05);
    if (!S.rows.length) return;
    // the teleport flash runs on the wall clock — it must finish on time even if
    // the player hits pause on the frame after arriving, or the world renders at
    // six frames a second
    if (S.flash > 0) paintFlash();
    const paused = S.hud && S.hud.isPaused && S.hud.isPaused();
    let devOn = false;
    try { devOn = !!(window.__player && window.__player.devMode && window.__player.devMode()); } catch { devOn = false; }
    if (paused && !devOn) { setAim(null); S.aim = null; tickIntro(dt); return; }
    S.t += dt;
    step(dt, devOn);
    tickIntro(dt);
  } catch { S.errors++; }
}

export function stats() {
  const n = S.nearest;
  return {
    ok: S.ok, poi: S.key || '', source: S.source, errors: S.errors,
    count: S.rows.length,
    visible: S.visible,
    lit: S.lit,
    settled: S.settled, far: Math.round(S.farD), draws: S.card ? 2 : 0,
    // signs are depth-tested against the world now; these say so out loud so a
    // regression that puts them back on top of the mountain is one assert away
    depthTest: !!(S.card && S.card.material && S.card.material.depthTest),
    depthWrite: !!(S.card && S.card.material && S.card.material.depthWrite),
    haloDepthTest: !!(S.halo && S.halo.material && S.halo.material.depthTest),
    tiers: { major: TIERS.major.h, mid: TIERS.mid.h, minor: TIERS.minor.h },
    raised: S.rows.filter((r) => r.raise > 0).length,
    travelKey: TRAVEL_KEY, travels: S.travels,
    // signs rest at REST_CARD and ease to full under the crosshair
    rest: { card: REST_CARD, halo: REST_HALO, inMs: HOVER_IN * 1000, outMs: HOVER_OUT * 1000 },
    hovered: (() => { const r = S.rows.find((q) => (q.hov || 0) > 0.999); return r ? r.id : null; })(),
    aim: aimedAt(),
    nearest: n ? { id: n.id, name: n.name, kind: n.kind, d: +n.d.toFixed(1) } : null,
    intro: S.intro ? { id: S.intro.row.id, phase: S.intro.phase } : null,
  };
}

// ---------------------------------------------------------------- test hooks
const _test = {
  stats,
  list: () => S.rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, tier: r.tier,
    pos: r.pos.slice(), sky: r.sky, ground: r.ground === undefined ? null : r.ground,
    // the doubled tier height, plus whatever the clearance probe had to add, plus
    // how much daylight is actually under the sign in its own column
    h: +(r.sky - r.pos[1]).toFixed(1),
    top: r.top === undefined ? null : r.top,
    raise: r.raise === undefined ? 0 : r.raise,
    airGap: (r.top === undefined || r.top === null) ? null : +(r.sky - r.top).toFixed(1),
    // hov is the raw 0..1 ease; drawn/drawnHalo are the alphas actually written
    // into the buffers this frame — resting, hovered, demoted, at-poi and all
    hov: r.hov === undefined ? 0 : +r.hov.toFixed(3),
    drawn: r.aDraw === undefined ? null : +r.aDraw.toFixed(4),
    drawnHalo: r.hDraw === undefined ? null : +r.hDraw.toFixed(4),
    angW: r.angW === undefined ? null : +r.angW.toFixed(4),
    sx: r.sx === undefined ? null : +r.sx.toFixed(4),
    sy: r.sy === undefined ? null : +r.sy.toFixed(4),
    d: r.d === undefined ? null : +r.d.toFixed(1),
    card: r.aCard === undefined ? null : +r.aCard.toFixed(3),
    halo: r.aHalo === undefined ? null : +r.aHalo.toFixed(3),
    full: !!r.full, introShown: !!r.introShown,
  })),
  row: (id) => S.rows.find((r) => r.id === id) || null,
  alpha: (id) => { const r = S.rows.find((q) => q.id === id); return r ? r.aCard : null; },
  // what actually reached the buffer: card alpha, halo alpha, hover ease
  drawn: (id) => {
    const r = S.rows.find((q) => q.id === id);
    return r ? { card: r.aDraw, halo: r.hDraw, hov: r.hov || 0, full: !!r.full } : null;
  },
  introEl: () => (S.cardEl && S.cardEl.style.display !== 'none' ? {
    opacity: +(S.cardEl.style.opacity || 0),
    name: S.nameEl.textContent, kind: S.kindEl.textContent, line: S.lineEl.textContent,
    phase: S.intro ? S.intro.phase : 'gone',
  } : null),
  forceIntro: (id) => { const r = S.rows.find((q) => q.id === id); if (r) showIntro(r); return !!r; },
  clearIntro: () => hideIntro(),
  rearm: () => { for (const r of S.rows) r.introShown = false; hideIntro(); },
  draws: () => (S.card ? 2 : 0),
  // hide both meshes without tearing anything down — a pixel test needs the same
  // frame with and without the signs to say "this box changed because of them"
  setVisible: (v) => { if (S.group) S.group.visible = !!v; return !!(S.group && S.group.visible); },
  // Read, or temporarily un-set, the depth test on both meshes. Exists so a
  // regression test can photograph the same camera pose with the signs occluded
  // and with them painted over the mountain — the bug this replaced.
  depthTest: (v) => {
    for (const m of [S.card, S.halo]) {
      if (!m) continue;
      if (v !== undefined) { m.material.depthTest = !!v; m.material.needsUpdate = true; }
    }
    return !!(S.card && S.card.material.depthTest);
  },
  // ---- fast travel
  aim: aimedAt,
  travel: fastTravel,
  travels: () => S.travels,
  lastTravel: () => S.lastTravel,
  travelKey: () => TRAVEL_KEY,
  // is a ridge between the camera and this sign right now? the aim gate's answer
  occluded: (id) => { const r = S.rows.find((q) => q.id === id); return r ? occluded(r) : null; },
  // Where this sign's quad lands on screen, in CSS pixels — the box the depth
  // test either lets through or does not. Rebuilt the way the shader builds it:
  // the centre goes to view space, the corners are offset THERE, and only then
  // is the projection applied. Exists so an occlusion test can sample the exact
  // pixels the card would occupy rather than guessing at the middle of the screen.
  quadOf: (id) => {
    const r = S.rows.find((q) => q.id === id);
    if (!r || !S.camera || !S.THREE || r.angW === undefined) return null;
    const T = S.THREE;
    const c = new T.Vector3(r.pos[0], r.sky, r.pos[2]).applyMatrix4(S.camera.matrixWorldInverse);
    const w = r.angW * (r.ds || 0), h = r.angH * (r.ds || 0);
    const P = (x, y) => {
      const v = new T.Vector3(x, y, c.z).applyMatrix4(S.camera.projectionMatrix);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
    };
    const m = P(c.x, c.y), a = P(c.x - w / 2, c.y + h / 2), b = P(c.x + w / 2, c.y - h / 2);
    return {
      cx: +m.x.toFixed(1), cy: +m.y.toFixed(1),
      x0: +a.x.toFixed(1), y0: +a.y.toFixed(1), x1: +b.x.toFixed(1), y1: +b.y.toFixed(1),
      inFront: c.z < 0, alpha: +(r.aCard || 0).toFixed(3), halo: +(r.aHalo || 0).toFixed(3),
      full: !!r.full, ds: +(r.ds || 0).toFixed(1),
    };
  },
  aimEl: () => (S.aimEl && S.aimEl.classList.contains('is-on')
    ? { name: S.aimNameEl.textContent, key: S.aimKeyEl.textContent } : null),
  flash: () => +(S.flashEl ? (S.flashEl.style.opacity || 0) : 0),
  // press T exactly the way a player does, gates and all
  key: (code) => {
    dispatchEvent(new KeyboardEvent('keydown', { code: code || TRAVEL_KEY, bubbles: true }));
    return S.lastTravel;
  },
  // the painted atlas, for eyeballing the sign design without a world around it
  atlasUrl: () => (S.atlas && S.atlas.image ? S.atlas.image.toDataURL() : null),
  keys: () => Object.keys(REG),
  // tear down and rebuild against a different marker source, reusing this
  // world's THREE/scene/camera. Exists so the `world.markers` contract path —
  // including the z-up tip — can be exercised in a world that has not declared
  // one yet; nothing in the player calls it.
  reinit: (list, upAxis) => {
    const ctx = {
      THREE: S.THREE, scene: S.scene, camera: S.camera, ctrl: S.ctrl, hud: S.hud,
      collision: S.collision, poi: S.poi, run: S.run, markers: list, upAxis,
    };
    _test.destroy();
    init(ctx);
    return stats();
  },
  destroy: () => {
    if (S.group && S.group.parent) S.group.parent.remove(S.group);
    if (S.card) { S.card.geometry.dispose(); S.card.material.dispose(); }
    if (S.halo) { S.halo.geometry.dispose(); S.halo.material.dispose(); }
    if (S.atlas) S.atlas.dispose();
    if (S.haloTex) S.haloTex.dispose();
    if (S.root && S.root.parentNode) S.root.parentNode.removeChild(S.root);
    for (const el of document.querySelectorAll('.pmk-aim, .pmk-flash')) el.remove();
    const st = document.getElementById('pmk-style');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    S.rows = []; S.group = S.card = S.halo = null; S.root = null; S.ok = false;
    S.aim = null; S.aimBlocked = false; S.aimEl = S.flashEl = null; S.flash = 0;
  },
};

window.__playMarkers = { init, update, stats, aimedAt, fastTravel, _test };
export default init;
