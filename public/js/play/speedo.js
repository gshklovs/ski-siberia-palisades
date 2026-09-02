// The speedometer. One canvas in the top-left corner, where the debug readout
// used to live before D43 cut it — this is what replaces it.
//
// PROMOTED to bench source by specs/0003 (was tools/export-red-dog/templates/).
// It is ordinary player source now: edit it HERE, commit, bump the exporter pin.
//
// WHY IT EXISTS. D43 stripped `.phud__read` (x/y/z · speed · state · gear · cam)
// because a world-builder's instrument panel is the one thing a screenshot of
// the shareable build should not have in it. But speed is not instrumentation on
// a ski mountain, it is the *subject*: the whole reason to point yourself down
// Red Dog Face is to find out how fast the hill will let you go. So the corner
// gets its number back — designed rather than dumped, and it earns the pixels by
// telling you something the terrain already made you feel.
//
// THE ESCALATION, keyed to m/s, because m/s is the number the physics thinks in:
//   < 10   dormant   graphite ring, cool needle, no light at all
//   10-20  warming   the ring energizes and the colour walks toward amber
//   20-28  hot       amber into orange, the arc thickens, a glow appears
//   28+    fires up  embers start coming off the arc and the bezel ignites
//   30     insane    the ski world's own terminal velocity. Full flame ring,
//                    chromatic split on the arc and on the digits.
//   40+    rocket    absolute maximum: corona, rotating sweep, white-hot core.
//                    Nothing above 40 escalates further — the snowmobile's 53
//                    m/s pegs the needle gloriously but does not keep climbing
//                    the effects, because "unhinged" has to have a ceiling or it
//                    stops reading as a ceiling.
//
// AND IT NEVER BLOCKS THE GAME. Every pixel it lights is inside its own 172 px
// box in a corner, `pointer-events: none`, and there is no full-screen layer at
// any tier — not a vignette, not a shake, not a flash. The rule the whole design
// is bent around: at 53 m/s in trees you need to see the trees.
//
// THE TYPEFACE IS DRAWN, NOT LOADED. The brief asked for John Wick title
// lettering — wide, tracked out, stencil-cut — and Google Fonts has expanded
// grotesques (Saira Expanded, Archivo's width axis, Michroma) and it has stencil
// faces (Saira Stencil One, Stardos Stencil), but it does not have one face that
// is both. So the ten digits are drawn here as polylines, stroked with butt caps
// and mitre joins: butt caps ARE the flat cut terminals and the gaps in the
// polylines ARE the stencil slots. It costs ~1.4 KB of source instead of a woff2
// (which this builder could not ship anyway — templates are read as utf8, and
// D7 bans binary assets), it cannot FOUT, and it renders identically on every
// machine, which a font stack does not.
//
// GPU-CHEAP, on purpose, because the mountain gets the frame budget:
//   · one 2D canvas, no second WebGL pass, no filters, no box-shadows
//   · the DPR transform is set on resize, never per frame
//   · nothing reads layout in the loop — no getBoundingClientRect, no offsetTop
//   · at most 56 embers, and they only exist above 28 m/s
//   · when the gauge is hidden the loop early-returns before touching the canvas
//
// AND IT DOES NOT JITTER. Ski chatter oscillates ctrl.speed() by a metre or two
// a second, so nothing here reads the raw number: `disp` is an exponentially
// lerped speed (the needle and the ring), `heat` is a SECOND lerp that rises
// fast and falls slow (every colour and every effect), and the integer on the
// dial only changes when it is more than 0.6 away from what is displayed. The
// three together are why the fire does not flicker on and off at 27.9 m/s.

// ------------------------------------------------------------------ geometry
const BOX = 172;                 // the element, glow included
const DIA = 146;                 // the gauge itself — Greg asked for 120-150
const R = DIA / 2;
const CX = BOX / 2, CY = BOX / 2;
const A0 = Math.PI * 0.75;       // 135° — open at the bottom, like a tach
const SWEEP = Math.PI * 1.5;     // 270°
const VMAX = 55;                 // the snowmobile tops out around 53

const R_ARC = 60;                // the progress ring's centreline
const R_TICK = 68;
const R_LBL = 47;

// --------------------------------------------------------------- escalation
const T_WARM = 10, T_HOT = 20, T_FIRE = 28, T_INSANE = 30, T_ROCKET = 40;

// The tier a screenshot (and the build gate) can name.
function tierOf(v) {
  if (v >= T_ROCKET) return 'rocket';
  if (v >= T_INSANE) return 'insane';
  if (v >= T_FIRE) return 'fire';
  if (v >= T_HOT) return 'hot';
  if (v >= T_WARM) return 'warm';
  return 'dormant';
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// The colour ramp, as stops in m/s. Graphite → bone → amber → orange → the
// house accent (#ff4d00, the same orange as every other signal on this screen)
// → a hotter red at the ceiling.
const RAMP = [
  [0, 95, 90, 82],
  [10, 140, 133, 120],
  [16, 255, 194, 71],
  [24, 255, 138, 31],
  [30, 255, 77, 0],
  [40, 255, 40, 0],
];
function rampAt(v) {
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1][0]) i++;
  const a = RAMP[i], b = RAMP[i + 1];
  const t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
  return [Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t)), Math.round(lerp(a[3], b[3], t))];
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

// --------------------------------------------------------------- the digits
// Ten glyphs, each a list of POLYLINES in a unit box: x 0..1 across an advance
// of ADV × cap height, y 0..1 down the cap height. Stroked with butt caps and
// mitre joins, so the terminals come out flat-cut and the corners come out
// sharp — and every gap between two polylines is a stencil slot.
// THE ONE METRIC THAT MATTERS, and the first draft got it wrong: a stencil slot
// has to be at least as wide as the stroke it interrupts, or the glow and the
// mitres close it and the face reads as a filled block. Stroke is 0.118 cap =
// 4.2 px at the dial's cap height; every gap below is 0.156 in x (4.5 px across
// an 0.80-cap advance) or 0.124 in y (4.5 px), so every slot is one stroke wide.
const ADV = 0.80;                // the extension: 0.55 would be a normal face
const STROKE = 0.118;            // of cap height
const XL = 0.075, XR = 0.925;    // vertical-stroke centrelines, inset by lw/2
const YT = 0.062, YB = 0.938;    // horizontal-stroke centrelines
const YM = 0.50;
const CL = 0.422, CR = 0.578;    // where a top/bottom bar breaks for its slot
const MU = 0.438, ML = 0.562;    // where a side breaks at the waist
const GLYPHS = {
  // the zero is cut at the WAIST, not at the top and bottom centre. Cutting the
  // bars left two short stubs either side of each slot and the glyph read as
  // "[ ]" — and zero is the glyph a player looks at for the whole ride up.
  '0': [[XL, MU, XL, YT, XR, YT, XR, MU], [XR, ML, XR, YB, XL, YB, XL, ML]],
  '1': [[0.20, 0.28, 0.50, YT, 0.50, 1.00], [0.04, YB, 0.348, YB], [0.652, YB, 0.96, YB]],
  '2': [[XL, 0.30, XL, YT, CL, YT], [CR, YT, XR, YT, XR, 0.40],
        [XR, 0.525, 0.28, YB], [XL, YB, XR, YB]],
  '3': [[XL, 0.26, XL, YT, CL, YT], [CR, YT, XR, YT, XR, MU],
        [0.30, YM, 0.80, YM],
        [XR, ML, XR, YB, CR, YB], [CL, YB, XL, YB, XL, 0.74]],
  '4': [[0.66, YT, 0.66, 1.00], [0.51, 0.16, 0.13, 0.66], [0.03, 0.66, 0.97, 0.66]],
  // the five's lower bowl is OPEN at the left. It used to close with a short
  // riser up the left edge, which made the glyph symmetric top-to-bottom and a
  // lone "5" on the dial read as an S. A five's bowl terminates; an S's does not.
  '5': [[XL, 0.356, XL, YT, CL, YT], [CR, YT, XR, YT],
        [XL, 0.48, XR, 0.48, XR, 0.62], [XR, 0.744, XR, YB, XL, YB]],
  '6': [[CR, YT, XR, YT, XR, 0.22], [CL, YT, XL, YT, XL, YB, CL, YB],
        [CR, YB, XR, YB, XR, ML, CR, ML], [CL, ML, XL, ML]],
  '7': [[XL, YT, XR, YT], [0.87, 0.245, 0.28, 1.00]],
  '8': [[CL, YT, XL, YT, XL, MU], [XL, ML, XL, YB, CL, YB],
        [CR, YT, XR, YT, XR, MU], [XR, ML, XR, YB, CR, YB],
        [0.26, YM, 0.74, YM]],
  '9': [[CL, YB, XL, YB, XL, 0.78], [CR, YB, XR, YB, XR, YT, CR, YT],
        [CL, YT, XL, YT, XL, MU, CL, MU], [CR, MU, XR, MU]],
};

// `track` is the letterspacing, in cap heights — this face wants a lot of it.
function digitsWidth(s, cap, track) {
  return s.length * ADV * cap + Math.max(0, s.length - 1) * track * cap;
}
function drawDigits(ctx, s, cx, baseline, cap, track) {
  const w = digitsWidth(s, cap, track);
  let x = cx - w / 2;
  ctx.lineWidth = STROKE * cap;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 6;
  for (const ch of s) {
    const g = GLYPHS[ch];
    if (g) {
      ctx.beginPath();
      for (const pl of g) {
        ctx.moveTo(x + pl[0] * ADV * cap, baseline - cap + pl[1] * cap);
        for (let i = 2; i < pl.length; i += 2) ctx.lineTo(x + pl[i] * ADV * cap, baseline - cap + pl[i + 1] * cap);
      }
      ctx.stroke();
    }
    x += (ADV + track) * cap;
  }
}

// ------------------------------------------------------------------- the DOM
const root = document.createElement('canvas');
root.className = 'pspeedo';
root.width = BOX;
root.height = BOX;
root.hidden = true;
// It draws its own text, so it contributes NOTHING to document.body.innerText —
// which is what every text assertion in this repo's gate reads. That is not an
// accident, it is the reason a canvas won over a stack of <div>s: a designed
// gauge that also had to be kept out of six banned-string lists would be a
// gauge with a maintenance bill on it.
root.setAttribute('aria-hidden', 'true');
document.body.appendChild(root);
const ctx = root.getContext('2d', { alpha: true });

let dpr = 0;
function sizeCanvas() {
  const d = Math.min(window.devicePixelRatio || 1, 2);
  if (d === dpr) return;
  dpr = d;
  root.width = Math.round(BOX * d);
  root.height = Math.round(BOX * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);      // set ONCE, never per frame
}
sizeCanvas();
addEventListener('resize', sizeCanvas, { passive: true });

// -------------------------------------------------------------- suppression
// Every reason the gauge must not be on the screen, in one place — the shape
// idle.js already established. `hidden` is the real switch, not opacity.
function suppressed(P) {
  const b = document.body.classList;
  if (b.contains('intro-up')) return true;          // the boot cards own the screen
  if (b.contains('gd-intro-up')) return true;       // ...and so do the guide's
  if (b.contains('clean-frame')) return true;       // H — the frame is being filmed
  if (b.contains('is-dev')) return true;            // dev fly mode is not play
  if (document.querySelector('.intro')) return true;
  try { if (P.paused()) return true; } catch { return true; }
  try { if (P.inventoryOpen()) return true; } catch { /* no locker */ }
  try { if (P.gearMenuOpen()) return true; } catch { /* no gear menu */ }
  // ON A PHONE, THE RACE CLOCK WINS THE TOP STRIP. The guide's race readout is
  // fixed at top-centre and this gauge is fixed at top-left; on a 1280 px
  // desktop they are 300 px apart and the gate measures that, but on a 390 px
  // screen two fixed panels cannot both have the top strip and they would
  // collide. The race HUD wins because it is the thing the guide is actively
  // asking you to read, and it is on screen for one leg of one run — the gauge
  // comes straight back the moment the race ends.
  if (window.innerWidth < 560 && document.querySelector('.gd__race.is-on')) return true;
  return false;
}

// ------------------------------------------------------------------- state
let disp = 0;          // the lerped speed the needle and the ring use
let heat = 0;          // the SLOW-FALLING one every colour and effect uses
let shown = 0;         // the integer actually on the dial
let spin = 0;          // the rocket sweep's angle
let last = 0;
let visible = false;
const embers = [];

const TAU_DISP = 0.16;
const TAU_UP = 0.20;
const TAU_DOWN = 0.65;

function ang(v) { return A0 + SWEEP * clamp(v / VMAX, 0, 1); }

// ------------------------------------------------------------------ drawing
function paint(dt) {
  const c = rampAt(heat);
  const warm = smooth(heat, T_WARM, T_HOT);
  const hot = smooth(heat, T_HOT - 2, T_FIRE);
  const fire = smooth(heat, T_FIRE - 2, T_INSANE);
  const insane = smooth(heat, T_INSANE - 1, 34);
  const rocket = smooth(heat, 36, T_ROCKET);
  const glow = 4 * hot + 12 * fire + 10 * rocket;
  const arcW = 7 + 2 * hot + 2 * rocket;

  ctx.clearRect(0, 0, BOX, BOX);

  // ---- the scrim. A dark plate is the whole reason this reads at all on a
  // snow field at noon; the gradient falls off so the gauge has no hard edge.
  const scrim = ctx.createRadialGradient(CX, CY, 8, CX, CY, R + 10);
  scrim.addColorStop(0, 'rgba(18,17,15,0.88)');
  scrim.addColorStop(0.74, 'rgba(18,17,15,0.80)');
  scrim.addColorStop(0.90, 'rgba(18,17,15,0.62)');
  scrim.addColorStop(1, 'rgba(18,17,15,0)');
  ctx.fillStyle = scrim;
  ctx.beginPath();
  ctx.arc(CX, CY, R + 10, 0, Math.PI * 2);
  ctx.fill();

  // ---- the corona: rocket tier only, and it is the one effect allowed outside
  // the bezel. It stops 13 px short of the element box, so nothing bleeds.
  if (rocket > 0.01) {
    const co = ctx.createRadialGradient(CX, CY, R * 0.86, CX, CY, R + 12);
    co.addColorStop(0, rgba(c, 0));
    co.addColorStop(0.55, rgba(c, 0.30 * rocket));
    co.addColorStop(1, rgba(c, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = co;
    ctx.beginPath();
    ctx.arc(CX, CY, R + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- bezel. Bone at rest (the .pchip border, 22% cream), ignites with the ring.
  ctx.lineWidth = 1;
  ctx.strokeStyle = fire > 0.02
    ? rgba(c, 0.28 + 0.55 * fire)
    : `rgba(244,241,234,${0.20 + 0.10 * warm})`;
  ctx.beginPath();
  ctx.arc(CX, CY, R - 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // ---- ticks. Every 2.5 m/s minor, every 10 major, and above 40 they run hot
  // so the redline is a property of the dial rather than a decal on it.
  for (let v = 0; v <= VMAX; v += 2.5) {
    const major = Math.abs(v % 10) < 1e-6;
    const a = ang(v);
    const co = Math.cos(a), si = Math.sin(a);
    const red = v >= T_ROCKET;
    const lit = v <= disp;
    ctx.lineWidth = major ? 2 : 1;
    ctx.strokeStyle = red
      ? `rgba(255,77,0,${lit ? 0.85 : 0.42})`
      : lit ? `rgba(244,241,234,${major ? 0.80 : 0.46})` : `rgba(244,241,234,${major ? 0.34 : 0.17})`;
    const r1 = R_TICK, r2 = R_TICK - (major ? 10 : 5);
    ctx.beginPath();
    ctx.moveTo(CX + co * r1, CY + si * r1);
    ctx.lineTo(CX + co * r2, CY + si * r2);
    ctx.stroke();
  }

  // ---- tick labels, in the same mono silkscreen every chip on this screen uses.
  // TEN THROUGH FORTY AND NO MORE. 0 and 50 both sit in the dial's open bottom,
  // where the mph line and the M/S unit already are — the 50 landed on top of
  // "M/S" and the 0 on top of "65 MPH". Neither is a reading anybody needs off
  // the scale: the arc's two ends say where the scale ends, and 40 is the number
  // that actually means something, because it is where the redline starts.
  ctx.font = '700 8px ui-monospace, "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = 10; v <= 40; v += 10) {
    const a = ang(v);
    ctx.fillStyle = v >= T_ROCKET ? 'rgba(255,110,60,0.78)' : 'rgba(180,174,163,0.62)';
    ctx.fillText(String(v), CX + Math.cos(a) * R_LBL, CY + Math.sin(a) * R_LBL);
  }

  // ---- the unlit track the arc runs in
  ctx.lineCap = 'butt';
  ctx.lineWidth = arcW;
  ctx.strokeStyle = 'rgba(244,241,234,0.09)';
  ctx.beginPath();
  ctx.arc(CX, CY, R_ARC, A0, A0 + SWEEP);
  ctx.stroke();

  // ---- THE ARC. Chromatic split above 30: a cyan copy trailing and a red copy
  // leading, both in `lighter`, so the edge of the ring separates into colour
  // the way a lens does when it is being asked for too much.
  const a1 = ang(disp);
  if (disp > 0.15) {
    const split = 0.030 * insane + 0.022 * rocket;   // radians
    if (split > 0.001) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(60,190,255,${0.34 * (insane + rocket) / 2 + 0.16 * insane})`;
      ctx.beginPath();
      ctx.arc(CX, CY, R_ARC, A0 - split, Math.max(A0 - split, a1 - split));
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,40,90,${0.34 * (insane + rocket) / 2 + 0.16 * insane})`;
      ctx.beginPath();
      ctx.arc(CX, CY, R_ARC, A0 + split, Math.max(A0 + split, a1 + split));
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.shadowBlur = glow;
    ctx.shadowColor = rgba(c, 0.9);
    ctx.strokeStyle = rgba(c, 0.92);
    ctx.beginPath();
    ctx.arc(CX, CY, R_ARC, A0, a1);
    ctx.stroke();
    // white-hot core, rocket only
    if (rocket > 0.02) {
      ctx.lineWidth = arcW * 0.34;
      ctx.strokeStyle = `rgba(255,244,232,${0.75 * rocket})`;
      ctx.beginPath();
      ctx.arc(CX, CY, R_ARC, A0, a1);
      ctx.stroke();
      ctx.lineWidth = arcW;
    }
    ctx.shadowBlur = 0;
  }

  // ---- the rotating sweep: rocket only. One 50° highlight running round the
  // ring, which is what makes the top tier read as *powered* rather than merely
  // bright in a still frame.
  if (rocket > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = arcW;
    ctx.strokeStyle = `rgba(255,220,190,${0.26 * rocket})`;
    const s0 = A0 + ((spin % SWEEP) + SWEEP) % SWEEP;
    ctx.beginPath();
    ctx.arc(CX, CY, R_ARC, s0, Math.min(s0 + 0.9, A0 + SWEEP));
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- embers. They come off the lit arc, drift out and up, and burn out.
  if (embers.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      const k = e.life / e.max;
      ctx.fillStyle = `rgba(${e.c[0]},${e.c[1]},${e.c[2]},${(k * k * 0.9).toFixed(3)})`;
      ctx.fillRect(e.x - e.s / 2, e.y - e.s / 2, e.s, e.s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- THE POINTER, and it RIDES THE RING rather than pivoting in the middle.
  // The first draft had a proper centre-pivot needle and its hub landed exactly
  // on top of the number — which is the choice this dial cannot make, because
  // the number is the whole point of it. A marker travelling the arc says the
  // same thing (where on the scale you are), leaves the centre entirely to the
  // typography, and costs three paths instead of a blade, a hub and a bezel.
  const nc = heat < T_WARM ? [178, 172, 160] : c;
  const na = ang(disp);
  const nco = Math.cos(na), nsi = Math.sin(na);
  const px = -nsi, py = nco;                       // perpendicular to the radius
  const white = rocket > 0.35;
  ctx.shadowBlur = glow * 0.7;
  ctx.shadowColor = rgba(nc, 0.9);
  ctx.strokeStyle = white ? `rgba(255,250,244,${0.80 + 0.20 * rocket})` : rgba(nc, 0.95);
  ctx.lineWidth = 3;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(CX + nco * (R_ARC - 11), CY + nsi * (R_ARC - 11));
  ctx.lineTo(CX + nco * (R_ARC + 10), CY + nsi * (R_ARC + 10));
  ctx.stroke();
  // the outward tip: a chevron, so the pointer has a direction and a sharp end
  ctx.fillStyle = white ? `rgba(255,250,244,${0.80 + 0.20 * rocket})` : rgba(nc, 0.95);
  ctx.beginPath();
  ctx.moveTo(CX + nco * (R_ARC + 17), CY + nsi * (R_ARC + 17));
  ctx.lineTo(CX + nco * (R_ARC + 9) + px * 4, CY + nsi * (R_ARC + 9) + py * 4);
  ctx.lineTo(CX + nco * (R_ARC + 9) - px * 4, CY + nsi * (R_ARC + 9) - py * 4);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;

  // ---- THE NUMBER. The drawn stencil face, tracked out hard, with the same
  // chromatic split the arc gets once the dial is past insane. It is offset left
  // by half the "M/S" block so the number-plus-unit reads optically centred.
  const s = String(shown);
  const cap = 36;
  const track = 0.17;
  const baseline = CY + 15;
  const NUMX = CX - 11;      // half the M/S block, so the pair is optically centred
  const dc = heat < T_WARM ? [205, 199, 186] : c;
  if (insane > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    const dx = 1.2 * insane + 1.2 * rocket;
    ctx.strokeStyle = `rgba(50,190,255,${0.34 * insane})`;
    drawDigits(ctx, s, NUMX - dx, baseline, cap, track);
    ctx.strokeStyle = `rgba(255,40,90,${0.34 * insane})`;
    drawDigits(ctx, s, NUMX + dx, baseline, cap, track);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.shadowBlur = glow * 0.5;
  ctx.shadowColor = rgba(dc, 0.8);
  // The number runs WHITE-HOT at the top tier rather than deeper red. Colour is
  // how the ring escalates; the digits escalate by getting brighter, because the
  // one thing that must never get harder to read as the speed climbs is the
  // speed. `fire` walks them off the ramp and `rocket` finishes the job.
  const wk = 0.40 * fire + 0.45 * rocket;
  ctx.strokeStyle = heat < T_WARM
    ? 'rgba(226,221,210,0.80)'
    : `rgba(${Math.round(lerp(dc[0], 255, wk))},${Math.round(lerp(dc[1], 244, wk))},${Math.round(lerp(dc[2], 232, wk))},0.97)`;
  drawDigits(ctx, s, NUMX, baseline, cap, track);
  ctx.shadowBlur = 0;

  // the unit, hung off the number's right shoulder
  ctx.font = '700 9px ui-monospace, "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = `rgba(180,174,163,${0.62 + 0.30 * warm})`;
  ctx.fillText('M/S', NUMX + digitsWidth(s, cap, track) / 2 + 4, baseline - 1);

  // ---- and the mph line beneath, deliberately the quiet one: the big number is
  // the one the physics thinks in, this is the one a person converts to.
  ctx.font = '700 10px ui-monospace, "Cascadia Mono", Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.letterSpacing = '0.10em';
  ctx.fillStyle = `rgba(205,199,186,${0.60 + 0.32 * warm})`;
  ctx.fillText(Math.round(disp * 2.23694) + ' MPH', CX, CY + 31);
  ctx.letterSpacing = '0px';
}

// ------------------------------------------------------------------ embers
function stepEmbers(dt, fire, insane, rocket) {
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.life -= dt;
    if (e.life <= 0) { embers.splice(i, 1); continue; }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.vy += 26 * dt;              // they fall off, they do not float away
  }
  const want = Math.round(56 * Math.min(1, fire * 0.45 + insane * 0.35 + rocket * 0.45));
  if (!want) return;
  const rate = want * 3.2 * dt;
  let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  while (n-- > 0 && embers.length < 56) {
    const a = A0 + SWEEP * clamp(disp / VMAX, 0, 1) * (0.25 + 0.75 * Math.random());
    const r = R_ARC + (Math.random() - 0.5) * 9;
    const co = Math.cos(a), si = Math.sin(a);
    const sp = 14 + 40 * Math.random() * (0.4 + rocket);
    embers.push({
      x: CX + co * r, y: CY + si * r,
      vx: co * sp * 0.7 + (Math.random() - 0.5) * 14,
      vy: si * sp * 0.7 - 26 * (0.4 + Math.random()),
      s: 1.2 + Math.random() * (1.4 + 1.4 * rocket),
      life: 0.30 + Math.random() * (0.45 + 0.35 * rocket),
      max: 1,
      c: Math.random() < 0.30 + 0.4 * rocket ? [255, 236, 205] : rampAt(heat),
    });
    embers[embers.length - 1].max = embers[embers.length - 1].life;
  }
}

// -------------------------------------------------------------------- loop
function frame(now) {
  requestAnimationFrame(frame);
  // The cap is for the frame that arrives after a stall — a backgrounded tab, a
  // shader compile — so the needle eases in instead of snapping. It is 0.25 s
  // and not 0.1 because 0.1 was silently a FRAME-RATE LIMIT on the lerp: below
  // 10 fps every real dt exceeds the cap, so the gauge advances 0.1 s of
  // smoothing per frame no matter how much time actually passed and the needle
  // falls permanently behind the speed. Measured under swiftshader at ~2.5 fps
  // it read 40 m/s while the game was doing 53. A weak laptop is the same case.
  const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016);
  last = now;

  const P = window.__player;
  if (!P) return;
  if (suppressed(P)) {
    if (visible) { visible = false; root.hidden = true; embers.length = 0; }
    return;
  }
  if (!visible) {
    visible = true;
    root.hidden = false;
    // arrive at the truth rather than sweeping up to it from 0 every time the
    // pause panel closes
    try { disp = heat = P.speed(); } catch { disp = heat = 0; }
    shown = Math.round(disp);
  }

  let raw = 0;
  try { raw = P.speed(); } catch { return; }
  if (!Number.isFinite(raw)) raw = 0;

  disp += (raw - disp) * (1 - Math.exp(-dt / TAU_DISP));
  heat += (raw - heat) * (1 - Math.exp(-dt / (raw > heat ? TAU_UP : TAU_DOWN)));
  // a deadband on the integer: rounding a lerped float still flickers at .5, and
  // a digit that changes twice a second on a steady traverse is the exact defect
  // the smoothing exists to remove.
  if (Math.abs(disp - shown) > 0.6) shown = Math.round(disp);

  const fire = smooth(heat, T_FIRE - 2, T_INSANE);
  const insane = smooth(heat, T_INSANE - 1, 34);
  const rocket = smooth(heat, 36, T_ROCKET);
  spin += dt * 2.4;
  stepEmbers(dt, fire, insane, rocket);
  paint(dt);
}
requestAnimationFrame(frame);

// The same test handle intro.js and idle.js expose, for the same reason: the
// gate has to be able to tell "the gauge is dormant" from "the gauge is broken",
// and a canvas cannot be asked in any other way.
window.__speedo = {
  visible: () => !root.hidden,
  el: () => root,
  raw: () => { try { return window.__player.speed(); } catch { return null; } },
  display: () => disp,
  heat: () => heat,
  shown: () => shown,
  mph: () => Math.round(disp * 2.23694),
  tier: () => tierOf(heat),
  tiers: { warm: T_WARM, hot: T_HOT, fire: T_FIRE, insane: T_INSANE, rocket: T_ROCKET, vmax: VMAX },
  embers: () => embers.length,
  box: () => ({ box: BOX, dia: DIA }),
  // used by the gate to settle the lerps without waiting on wall clock
  settle: () => { try { disp = heat = window.__player.speed(); shown = Math.round(disp); } catch { /* */ } },
  suppressed: () => suppressed(window.__player),
};
