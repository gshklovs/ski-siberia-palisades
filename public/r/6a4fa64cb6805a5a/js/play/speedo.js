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
// WHAT THIS DIAL IS NOW, AND WHAT WENT (specs/0048). Greg, 2026-09-03: "i want
// the speedometer to be flattened and simplified the same way. it should look
// sick but simple because it's just numbers, a dial-shaped circle, and units in
// a much smaller font than the numbers to the left of the numbers."
//
// So it is three things and there is no fourth: a ring, an arc on it in the
// purple→blue gradient, and the integer with its unit beside it. (specs/0055
// §4.2, as picked 2026-09-06 — Greg: "Can we remove the ticks in the speedo,
// thresholds should be only in effect, not visible threshold, also switch to
// mph units" and "Double speedo thickness and make sure number is centered
// inside of it, the unit could be to the right of the speedo". So the ring is a
// top half at double weight, NOTHING on it marks a threshold, the reading is
// MPH, the number is centred on the dial's own centre and the unit stands
// outside the dial in a bay of its own.) The escalation table this file used to
// open with was:
//
//   < 10   dormant   graphite ring, cool needle, no light at all
//   10-20  warming   the ring energizes and the colour walks toward amber
//   20-28  hot       amber into orange, the arc thickens, a glow appears
//   28+    fires up  embers coming off the arc, the bezel ignites
//   30     insane    full flame ring, chromatic split on the arc and the digits
//   40+    rocket    corona, rotating sweep, white-hot core
//
// EVERY VISUAL IN THAT TABLE IS GONE: the embers, the chromatic split, the
// bezel, the corona, the sweep, the white-hot core, the scrim, the ramp from
// graphite to orange, the shadowBlur glow, the tick ladder, the tick labels and
// the MPH line under the number. Not because any of it was broken — it worked,
// and at 53 m/s it was genuinely a sight — but because six escalating states is
// six things to read on a dial whose whole job is one number, and Greg asked for
// the number. What survives of the escalation is the ONE thing colour is good
// for: above the redline the arc's last segment turns flat #ff5c8a. That is a
// verdict, not a light show.
//
// ...AND THE FIVE FLAME MARKS WENT THE SAME WAY (specs/0055 §4.2, Greg
// 2026-09-06: "thresholds should be only in effect, not visible threshold").
// W2 replaced 0048's four ticks with five tongues, one per tier, lit as `heat`
// crossed them — a tick says "this is 20", a flame says "you are past 20". Both
// sentences are now unsaid on the glass. The tier model is untouched: the five
// thresholds, `tierOf`, the slow-fall `heat` lerp and `__speedo.tier()` are all
// byte-for-byte what they were, and the arc still switches colour at each of
// them. What changed is that the dial no longer POINTS at a threshold — you see
// the effect (the band you are in) and never the boundary. One band edge is a
// stronger statement than a band edge with a marker standing on it.
//
// THE TIER MODEL SURVIVES UNCHANGED under the paint. `heat`, `tierOf()` and the
// five thresholds are still exactly what they were, still on the same slow-fall
// lerp, and `__speedo.tier()` still names dormant/warm/hot/fire/insane/rocket
// for the build gate. `embers()` survives too and now honestly reports 0: the
// gauge has no particles, and a probe that reads the field should be told that
// rather than handed a fabricated count.
//
// AND IT NEVER BLOCKS THE GAME. Every pixel it lights is inside its own 208 px
// box in a corner, `pointer-events: none`, and there is no full-screen layer —
// not a vignette, not a shake, not a flash. The rule the whole design is bent
// around: at 53 m/s in trees you need to see the trees.
//
// THE TYPEFACE IS `hudType`, THE ONE IN hud.js. This file used to carry ten
// hand-drawn stencil glyphs as polylines, because the old brief wanted a wide
// tracked-out stencil cut that no free face provides. 0048 asks for the
// opposite: the SAME Avenir-stack oblique caps the trick HUD uses, so that the
// timer over the rider's head and the number in the corner are one voice. A
// second, private face in this file would have been exactly the drift `hudType`
// exists to stop — so the glyph table went and `ctx.font` came back.
//
//   The oblique is a SKEW MATRIX and not a token in the font string. A
//   `ctx.font` value the browser cannot parse is silently discarded and the
//   previous font stays, so a font shorthand carrying `oblique 12deg` risks
//   being a wrong SIZE on any engine that does not take it. 12° of skew about
//   the baseline is the same slant and cannot half-fail.
//
// GPU-CHEAP, on purpose, because the mountain gets the frame budget:
//   · one 2D canvas, no second WebGL pass, no filters, no box-shadows
//   · the DPR transform is set on resize, never per frame
//   · nothing reads layout in the loop — no getBoundingClientRect, no offsetTop
//   · no particles, no shadowBlur, no globalCompositeOperation, no radial fills
//   · two gradient objects a frame, and both are the cheap linear kind
//   · when the gauge is hidden the loop early-returns before touching the canvas
//
// AND IT DOES NOT JITTER. Ski chatter oscillates ctrl.speed() by a metre or two
// a second, so nothing here reads the raw number: `disp` is an exponentially
// lerped speed (the arc), `heat` is a SECOND lerp that rises fast and falls
// slow (the tier model), and the integer on the dial only changes when it is
// more than 0.6 away from what is displayed. The three together are why the arc
// does not twitch on a steady traverse and why the redline, when it comes, does
// not flicker on and off at 39.9 m/s.

import { hudType, hudSurf, hudFont } from './hud.js';

// ------------------------------------------------------------------ geometry
// specs/0055 §4.2 (Greg 2026-09-06) — THE DIAL'S SQUARE AND THE UNIT'S BAY ARE
// TWO DIFFERENT THINGS NOW. "the unit could be to the right of the speedo": the
// unit is no longer part of the reading inside the dial, it stands OUTSIDE it,
// and there are only 13 px between the arc's right edge and the old 172 px
// canvas — `MPH` at 11 px measures 27.6. So the canvas grew a bay on the right
// and the dial did not move: `DIAL` is still 172, the centre is still (86, 86),
// and the gauge still sits at 14,14 at z 22. Everything the dial draws is laid
// out against `DIAL`; only the canvas and speedo.css's box read `BOX`.
//
// THE CANVAS STAYS SQUARE, and that is load-bearing rather than tidy: verify's
// [5] asserts `rect.w === rect.h === __speedo.box().box`, so a 208 × 172 canvas
// fails the gate on a geometry the gate is right to insist on. The 36 px below
// the dial is transparent, `pointer-events: none` and inside `contain: strict`,
// so it costs a slightly larger texture and nothing else.
const DIAL = 172;                // the dial's own square — unchanged since 0048
const UNIT_BAY = 36;             // the strip on its right the unit stands in
const BOX = DIAL + UNIT_BAY;     // 208 — the element, and it is square
const DIA = 146;                 // the gauge itself — Greg asked for 120-150
const CX = DIAL / 2, CY = DIAL / 2;
// specs/0055 §4.2 (D7) — THE TOP HALF OF A SEMICIRCLE, NINE O'CLOCK TO THREE.
// Greg: "the wheel is the TOP HALF of a semicircle, no ticks". In canvas angles
// 0 is three o'clock and positive runs clockwise, so π is nine o'clock and a
// sweep of π carries the arc over the top to three. 0048's tach sweep — 120°
// round to 300° at five o'clock — is gone with the ticks it was scaled for: a
// full circle with a notch in it reads as a gauge face, and a half reads as a
// horizon, which is the shape a speed on a mountain wants.
const A0 = Math.PI;              // 180° — nine o'clock
const SWEEP = Math.PI;           // 180° — over the top, round to three o'clock
const VMAX = 55;                 // the snowmobile tops out around 53

// specs/0055 §4.2 (Greg 2026-09-06) — DOUBLE THICKNESS. "Double speedo
// thickness": both strokes doubled, 2 → 4 on the unlit ring and 5 → 10 on the
// lit arc, and `R_ARC` does NOT move. The arc's outer edge is R_ARC + ARC_W/2 =
// 73, so the dial is exactly `DIA` = 146 px across — the fattened stroke lands
// on the number Greg asked 0048 for rather than growing past it — and there are
// still 13 px of clear canvas outside it on every side of the 172 px dial
// square. Nothing clips, so there was no reason to pull R_ARC in.
const R_ARC = 68;                // the ring's centreline, and the arc rides it
const RING_W = 4;                // the unlit ring (was 2)
const ARC_W = 10;                // the lit arc over it (was 5)
const R_IN = R_ARC - ARC_W / 2;  // 63 — the arc's INNER edge: the bowl the
                                 //   number has to live inside
// specs/0055 §4.2 — 0048's FOUR TICKS and W2's FIVE FLAME MARKS ARE BOTH GONE,
// with the constants that sized them (`MARK_L`, `FLAME_H`, `FLAME_W`) deleted
// by name. "No ticks", and then "thresholds should be only in effect, not
// visible threshold": the scale's ends are the arc's ends, the integer says
// where you are, and the tier you are in is the colour the arc already is.
// Nothing on this ring points at a boundary.
const UNIT_GAP = 8;              // px between the dial and the unit (§4.2)
const NUM_PAD = 4;               // the number's clearance off the arc's inner
                                 //   edge, 2 px a side

// ------------------------------------------------------------- the gear blade
// specs/0055 §4.2 (the fidelity sheet, row 1, 2026-09-06). The picked
// speedometer-B cell — lookbook.html `#k-speedometer-idle`, the "open dial +
// gear blade" alternate — draws a small two-part blade under the dial reading
// `GEAR · SKIS`, and W2 shipped the dial without it. This is that blade, and
// the dial stays PLATELESS: the B cell has no plate and Greg asked for the open
// dial, so nothing here adds the 34 % HUD plate the A cell mounted it on.
//
// IT IS DRAWN ON THE CANVAS, NOT IN THE DOM, and that is not a style choice.
// D44's advertisement list (verify.mjs:448) bans the literal string `GEAR` from
// `document.body.innerText` during play — the bottom-left gear chip is exactly
// what that rule was written against — so a `<span>GEAR</span>` beside the
// canvas would fail the gate on the same line it was added. The gauge's whole
// structural advantage is that it contributes zero characters; the blade
// inherits it, and inherits its suppression and its clean-frame H for free.
//
// MEASURED OFF THE CELL AT 1:1 (900 px viewport, deviceScaleFactor 1): the
// blade box is 94.73 × 24.59 for `GEAR · SKIS`, a 3 px spine, 3 px of padding
// top and bottom, 12 px right, the label 11 px in from the spine, an 11 px gap
// before the value, and both spans' line boxes centred at 12.30 px from the
// blade's top. Those are the numbers below; nothing is estimated.
const BLADE_SPINE = 3;           // .blade's 3 px border-left, the kind spine
const BLADE_PADL = 11;           // .blade__k's padding-left
const BLADE_GAP = 11;            // .blade's gap
const BLADE_PADR = 12;           // .blade's padding-right (the cell's override)
const BLADE_H = 24.59;           // the measured box height
const BLADE_MID = 12.30;         // both spans' line-box centre, from the top
const BLADE_K_PX = 10;           // .blade__k — mono 700, .2em
const BLADE_K_TRACK = 2;
const BLADE_V_PX = 12;           // .blade__v — the cell's font-size override
const BLADE_V_TRACK = 0.72;      // .06em on 12 px
// k-hud's `--ksub`. Not one of §10.3's three reserved hexes (#7b3fe4 / #f4f1ea
// / #ff4d00), so it is typed here; the two that ARE reserved come off `hudSurf`
// and `hudType` rather than being re-typed — the cream value is `hudSurf.cream`
// and the spine's blue is `hudType.gradTo`, which is what k-hud's `--kb` is.
const BLADE_K_COL = '#a49c8d';
const BLADE_MONO = 'ui-monospace,"Cascadia Mono",Consolas,"Segoe UI Mono","DejaVu Sans Mono",monospace';
// the scrim, from the cell: linear-gradient(90deg, ink .86, ink .74 at 62 %,
// ink 0). `hudSurf.ink` is #171614 = rgb(23,22,20) — the same ink, imported.
const INK = ((h) => h.slice(1).match(/../g).map((c) => parseInt(c, 16)).join(','))(hudSurf.ink);
const inkA = (a) => 'rgba(' + INK + ',' + a + ')';
// ...UNDER THE DIAL, at its bottom-left. The cell offsets the blade (0, 178)
// from a dial that filled its whole 172 px square; this dial is a top half
// whose ink ends at the reading, so the blade follows the INK: flush with the
// dial square's left edge — the same 14 px screen inset the gauge and the key
// legend both use — and 10 px under the hero's baseline. It is pinned to HERO
// and not to the painted `size`, so a three-digit reading cannot nudge it.
const BLADE_X = 0;
// (`hudType.heroDial * 0.70` is `capOf(HERO)`, spelled out because both are
// declared further down and a const arrow in its temporal dead zone is a boot
// error rather than a lint warning.)
const BLADE_Y = Math.round(DIAL / 2 + hudType.heroDial * 0.70 / 2 + 10);   // 118

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
// (the smoothstep that drove the six escalation curves went with them — 0048)

// THE WHOLE PALETTE, and it is two colours and a red. The graphite→bone→amber→
// orange→red ramp this file used to interpolate every frame is gone with the
// escalation it drove: there is no colour temperature on this dial any more,
// because a number that changes hue as it climbs is a number you have to
// re-learn to read at every speed.
const REDLINE = '#ff5c8a';       // §3 — the arc's last segment above the redline
// One tan, computed once: the 12° oblique, as a skew about the baseline.
const SKEW = Math.tan(hudType.obliqueDeg * Math.PI / 180);

// THE UNIT, and specs/0055 §4.2 as picked 2026-09-06 makes it `MPH`. 0048
// printed `M/S` because m/s is the number the physics thinks in and the number
// the tier model is keyed to; W2 printed `KM/H`; Greg asked for mph ("also
// switch to mph units"), so the CONVERSION still happens in exactly ONE place —
// `MPH_OF` below, at paint time — and every other number in this file, the whole
// tier model and every field on `window.__speedo` stay in m/s. `__speedo.mph()`
// is untouched: the gate prints it on every tier row, and it is the same
// conversion by a slightly shorter constant.
const UNIT = 'MPH';
const MPH_OF = (v) => Math.round(v * 2.236936);
// 0.06 em of tracking, in px, precomputed for both sizes. Canvas takes a
// LENGTH, not an em — and it also appends the spacing after the LAST glyph,
// which is why the widths below subtract one back off before centring.
const HERO = hudType.heroDial;
const TRACK_HERO = (hudType.track * HERO).toFixed(2) + 'px';
const TRACK_HERO_PX = hudType.track * HERO;
const TRACK_UNIT = (hudType.track * hudType.unit).toFixed(2) + 'px';
// (`TRACK_UNIT_PX` went with the unit's measurement: the unit is no longer
// measured at paint time because it is no longer laid out against the number —
// it stands at a fixed x in its own bay. specs/0055 §4.2, Greg 2026-09-06.)

// ------------------------------------------------------------------ the type
// `hudType` (hud.js) is the face, the weight, the tracking and the two colours;
// these two helpers are the only thing this file adds, and both exist because a
// canvas has no `background-clip: text` and no `font-style: oblique <angle>`
// worth trusting.
//
// THE 10-GLYPH STENCIL FACE THAT USED TO LIVE HERE IS GONE (specs/0048). It was
// ~1.4 KB of polylines with a hard-won metric — every stencil slot exactly one
// stroke wide, the zero cut at the waist so it did not read as "[ ]", the five's
// bowl left open so it did not read as an S — and all of it was in service of a
// brief ("wide, tracked out, stencil-cut") that 0048 replaced with a different
// one: the corner must speak in the same voice as the trick HUD. It does now.

// The purple -> blue gradient, along an arbitrary line. The line matters: a
// gradient across the gauge's bounding box puts purple on the left half and
// blue on the right, so an arc that has only reached ten o'clock is entirely
// purple and the ramp never appears at all. Given the arc's START and its
// current TIP, the ramp is always the full purple -> blue no matter how far
// round it has got, which is the read the brief asks for.
function gradFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, hudType.gradFrom);
  g.addColorStop(1, hudType.gradTo);
  return g;
}

// ================================================== specs/0055 §4.2 (D8)
// COLOUR SWITCHES AT THE FIVE THRESHOLDS, and it is the SAME two colours.
// D18 pins the token to purple → blue with no third stop, so the tier colours
// are not new hues: they are that one ramp SAMPLED at six points, so a tier is
// a flat band of the gradient rather than a slice of a smooth one. Crossing
// T_HOT changes the arc's colour; nothing between two thresholds does.
const RGB = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const G0 = RGB(hudType.gradFrom), G1 = RGB(hudType.gradTo);
const mixHex = (f) => 'rgb(' + G0.map((c, i) => Math.round(c + (G1[i] - c) * f)).join(',') + ')';
// The five thresholds, with 0 in front of them so index i is the band that
// OPENS at TIER_V[i]: dormant · warm · hot · fire · insane, and then REDLINE
// above T_ROCKET exactly as 0048 shipped it. Five band colours (i = 0..4)
// evenly along the one ramp.
//
// specs/0055 §4.2 (Greg 2026-09-06) — `TIER_NAMES` and `markColour` went with
// the flame marks: the only thing that ever read them was the mark drawing, and
// the tier's NAME now reaches the outside world through `tierOf` alone. The
// thresholds themselves are exactly where they were, and this table is still
// what puts a band edge on each of them.
const TIER_V = [0, T_WARM, T_HOT, T_FIRE, T_INSANE, T_ROCKET];
const TIER_C = [0, 1, 2, 3, 4].map((i) => mixHex(i / 4));

// The gradient the arc is stroked with: ONE gradient object on the arc's own
// start→tip line (§1.4), carrying ONE STOP PER TIER. The stop's offset is the
// threshold's point on the arc PROJECTED onto that line, which is exactly where
// a linear gradient reads its colour from — so the band edge lands on the
// threshold's angle to the pixel, and on the flame mark drawn there.
function arcGrad(ctx, v, a1) {
  const x0 = CX + Math.cos(A0) * R_ARC, y0 = CY + Math.sin(A0) * R_ARC;
  const x1 = CX + Math.cos(a1) * R_ARC, y1 = CY + Math.sin(a1) * R_ARC;
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  g.addColorStop(0, TIER_C[0]);
  let band = 0;
  if (len2 > 1e-6) {
    let prev = 0;
    // ...up to T_INSANE only: the segment above T_ROCKET is the flat REDLINE
    // stroke paint() has drawn separately since 0048, and this gradient never
    // reaches it.
    for (let i = 1; i <= 4; i++) {
      if (v <= TIER_V[i]) break;
      const a = ang(TIER_V[i]);
      const px = CX + Math.cos(a) * R_ARC - x0, py = CY + Math.sin(a) * R_ARC - y0;
      const o = clamp((px * dx + py * dy) / len2, prev, 1);
      // two stops at the same offset = a hard switch, not a blend
      g.addColorStop(o, TIER_C[i - 1]);
      g.addColorStop(o, TIER_C[i]);
      prev = o;
      band = i;
    }
  }
  g.addColorStop(1, TIER_C[band]);
  return g;
}

// A 12 deg oblique leans the cap line RIGHT by tan(12 deg) x cap, so the shape
// a skewed run of text actually occupies is WIDER than measureText says by
// exactly that much. Everything below lays out those VISUAL boxes rather than
// the metric ones — otherwise the 8 px gap between the unit and the number is
// 8 px of metrics and about 4 px of picture, which is what the first draft did.
const capOf = (size) => size * 0.70;
const obliqueW = (w, size) => w + SKEW * capOf(size);

// Draw `s` obliqued about its baseline with its VISUAL left edge at `x` — which
// on a right-leaning oblique is the bottom-left corner of the first glyph, i.e.
// the origin fillText already uses. No pre-shift: the lean is spent on the
// extra width `obliqueW` already accounted for.
function obliqueText(ctx, s, x, baseline, _size) {
  ctx.save();
  ctx.translate(x, baseline);
  ctx.transform(1, 0, -SKEW, 1, 0, 0);
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

// THE GEAR BLADE, drawn (specs/0055 §4.2, the fidelity sheet's row 1). One
// scrim, one spine, two words: the mono key at 35 % warm grey and the gear in
// the same oblique the rest of the gauge speaks, sized and spaced off the
// measurements above. The blade's WIDTH is the content's — `GEAR · SKIS` comes
// out at the cell's 94.7 px and `GEAR · SNOWMOBILE` simply runs longer, which
// is what an inline-flex blade does.
//
// THE CELL'S `text-shadow: 0 1px 5px rgba(0,0,0,.6)` IS NOT DRAWN. It is there
// for a blade over a photograph; this one always has its own 86 % ink scrim
// directly behind it, where a 60 %-black 5 px blur moves no measurable pixel.
// Skipping it keeps this file's "no shadowBlur" budget line true, and that line
// is worth more than a shadow nobody can see.
function bladeAt(ctx, x, y, gear) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  ctx.font = '700 ' + BLADE_K_PX + 'px ' + BLADE_MONO;
  ctx.letterSpacing = BLADE_K_TRACK + 'px';
  // THE TRAILING TRACKING IS KEPT HERE, and that is the opposite of what the
  // reading does two functions down. The reading subtracts it because it is
  // CENTRING ink and a phantom 3.8 px on the right would push the digits left.
  // The blade is reproducing a CSS inline-flex row, and a CSS inline box
  // includes the letter-spacing after its last glyph — the cell's 42.44 px
  // `.blade__k` is 11 px of padding plus 31.44 px of text WITH its trailing
  // 2 px in it, and the 11 px gap starts after that. Subtracting it here made
  // the blade 92.49 px against the cell's 94.73.
  const wK = ctx.measureText('GEAR').width;
  ctx.font = hudFont(BLADE_V_PX);
  ctx.letterSpacing = BLADE_V_TRACK + 'px';
  const wV = ctx.measureText(gear).width;
  const w = BLADE_SPINE + BLADE_PADL + wK + BLADE_GAP + wV + BLADE_PADR;

  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, inkA(0.86));
  g.addColorStop(0.62, inkA(0.74));
  g.addColorStop(1, inkA(0));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, BLADE_H);

  ctx.fillStyle = hudType.gradTo;                 // k-hud's --kb
  ctx.fillRect(x, y, BLADE_SPINE, BLADE_H);

  const mid = y + BLADE_MID;
  ctx.font = '700 ' + BLADE_K_PX + 'px ' + BLADE_MONO;
  ctx.letterSpacing = BLADE_K_TRACK + 'px';
  ctx.fillStyle = BLADE_K_COL;
  ctx.fillText('GEAR', x + BLADE_SPINE + BLADE_PADL, mid);

  ctx.font = hudFont(BLADE_V_PX);
  ctx.letterSpacing = BLADE_V_TRACK + 'px';
  ctx.fillStyle = hudSurf.cream;
  obliqueText(ctx, gear, x + BLADE_SPINE + BLADE_PADL + wK + BLADE_GAP, mid, BLADE_V_PX);

  ctx.letterSpacing = '0px';
  ctx.textBaseline = 'alphabetic';
  return w;
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
let disp = 0;          // the lerped speed the arc and the marks use
let heat = 0;          // the SLOW-FALLING one the tier model uses
let shown = 0;         // the deadbanded m/s integer — `__speedo.shown()`
// specs/0055 §4.2 — ...and the integer actually PRINTED, in MPH. It is a
// second state and not a conversion of `shown`, because converting a
// deadbanded m/s integer would step the dial 2.24 mph at a time (54 · 56 · 58)
// and print a number that is over a mile an hour from the truth. Same rule as
// `shown`, applied in the units on the glass: it moves when it is more than
// 1 mph — 0.45 m/s, 0048's own 0.6 m/s deadband expressed in the new unit and
// rounded to the unit the glass actually shows — from what is displayed.
let shownM = 0;
// specs/0055 §4.2 — the gear on the blade, read from `__player.gear()`: the
// PUBLIC gear name, which is the same state the readout's GEAR line used and
// the same one verify's peg block asserts is back to `skis`. It is a string and
// not a lerp, so it is sampled once a frame beside the speed and never inside
// paint().
let gear = '';
let last = 0;
let visible = false;
// specs/0048 — the gauge has no particles. The array stays because
// `__speedo.embers()` is part of the surface the build gate reads, and the
// honest answer to "how many embers" on a dial with none is 0, reported from
// the same place it was always reported from.
const embers = [];

const TAU_DISP = 0.16;
const TAU_UP = 0.20;
const TAU_DOWN = 0.65;

function ang(v) { return A0 + SWEEP * clamp(v / VMAX, 0, 1); }

// ------------------------------------------------------------------ drawing
//
// THREE THINGS, IN THIS ORDER: the ring, the arc, the number with its unit.
// Nothing composites, nothing blurs, nothing fills a disc. (specs/0055 §4.2 as
// picked 2026-09-06 — the ring is the TOP HALF at double weight, and NOTHING
// stands on it: 0048's four ticks and W2's five flames are both gone.) On a snow
// field at noon the old dial needed a dark scrim under it to read at all; this
// one reads because every mark it makes is DARK on that field — the gradient
// number, the indigo unit, the indigo ring — and dropping the scrim is what
// makes the corner look like the mountain rather than like a panel bolted
// onto it.
function paint() {
  ctx.clearRect(0, 0, BOX, BOX);

  const a1 = ang(disp);
  const aRed = ang(T_ROCKET);

  // ---- (1) THE RING. One flat 4 px circle segment at 35 %, the whole scale,
  // nine o'clock over the top to three (§4.2) — the "top half of a semicircle",
  // at the doubled weight Greg asked for on 2026-09-06.
  ctx.lineCap = 'butt';
  ctx.lineWidth = RING_W;
  ctx.strokeStyle = hudType.dim;
  ctx.beginPath();
  ctx.arc(CX, CY, R_ARC, A0, A0 + SWEEP);
  ctx.stroke();

  // ---- (2) THE ARC, 10 px, over the ring, in the purple -> blue gradient,
  // ramped from where the arc STARTS to where it currently ENDS. So the tip is
  // always the blue end however far round it has got, and the ramp is the same
  // one the number carries rather than a slice of a fixed background wash.
  if (disp > 0.15) {
    ctx.lineWidth = ARC_W;
    // specs/0055 §4.2 — ONE STOP PER TIER on the same start→tip line (§1.4).
    ctx.strokeStyle = arcGrad(ctx, disp, a1);
    ctx.beginPath();
    ctx.arc(CX, CY, R_ARC, A0, Math.min(a1, aRed));
    ctx.stroke();
    // ...and above the redline the LAST SEGMENT ONLY turns flat red-purple.
    // The whole of what is left of the escalation: not a glow, not a hue ramp,
    // one segment that is a different colour because you are past forty.
    if (disp > T_ROCKET) {
      ctx.strokeStyle = REDLINE;
      ctx.beginPath();
      ctx.arc(CX, CY, R_ARC, aRed, a1);
      ctx.stroke();
    }
  }

  // ---- (3) THE NUMBER, CENTRED IN THE DIAL, AND THE UNIT OUTSIDE IT.
  // (specs/0055 §4.2, Greg 2026-09-06: "make sure number is centered inside of
  // it, the unit could be to the right of the speedo".)
  //
  // W2 hung the reading in the bowl BELOW the centre line — cap top on CY,
  // digits under it — to dodge the ring's two ends at nine and three o'clock.
  // With the unit gone from the group the number is free to be centred, and it
  // is centred the only way the geometry allows: its CAP BOX sits on the dial's
  // own centre (CX, CY), so the reading is centred both ways on the circle the
  // arc is a half of.
  //
  //   WHY (CX, CY) AND NOT THE HALF-DISC'S MIDDLE. The bowl the arc encloses is
  //   R_IN = 63 px deep. A 64 px hero has a 44.8 px cap, and the widest reading
  //   the dial can show is three digits — "123" at VMAX 55 m/s, 114.0 px wide,
  //   half-width 57.0. Push the cap box up to the bowl's own vertical mid-line
  //   (CY − 31.5) and the chord available at the cap's top edge falls to 65 px:
  //   the hero would have to shrink to ~36 px, and it would shrink again every
  //   time the reading crossed 99 mph. Held on CY, the top corners sit at
  //   √(57.0² + 22.4²) = 61.2 px from the centre, inside the arc's inner edge at
  //   63 — so the widest reading this gauge can produce fits at the full 64 px
  //   and the number NEVER MOVES between two digits and three. A dial whose
  //   number hops 12 px vertically at 100 mph is the same defect the three lerps
  //   in this file exist to prevent.
  //
  //   AND IT CLEARS THE RING'S ENDS, which is what drove W2 downwards. The ends
  //   are the arc's butt caps on the centre line, x ∈ [13, 23] and [149, 159];
  //   a reading of half-width ≤ 63 centred on CX spans [23, 149] at worst and
  //   the two never meet.
  const s = String(shownM);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // ...AND IT FITS THE BOWL. `AVAIL` is no longer the canvas's width: with the
  // number inside the arc, the width it may occupy is the CHORD of the arc's
  // inner circle at the cap's top edge, which is where a centred cap box is
  // widest-constrained. 64 px whenever the reading fits that chord, and scaled
  // down by exactly the overflow when it does not. measureText is linear in the
  // font size, so one division is the exact answer and there is no loop; the
  // scaled-down cap is shorter, so the true chord is wider than the one the
  // division used and the answer is conservative in the safe direction.
  ctx.font = hudFont(HERO);
  ctx.letterSpacing = TRACK_HERO;
  const wHero = obliqueW(ctx.measureText(s).width - TRACK_HERO_PX, HERO);
  const capH = capOf(HERO);
  const avail = 2 * Math.sqrt(Math.max(0, R_IN * R_IN - capH * capH / 4)) - NUM_PAD;
  const size = wHero > avail ? HERO * (avail / wHero) : HERO;
  const cap = capOf(size);
  const wNum = wHero * (size / HERO);
  // the cap box centred on the dial's centre: half above the centre line, half
  // below, which is what "centred inside it" means on a circle.
  const baseline = CY + cap / 2;
  const numX = CX - wNum / 2;

  ctx.font = hudFont(size);
  ctx.letterSpacing = (hudType.track * size).toFixed(2) + 'px';
  ctx.fillStyle = gradFill(ctx, numX, baseline, numX + wNum, baseline);
  obliqueText(ctx, s, numX, baseline, size);

  // ---- (4) THE UNIT, OUTSIDE THE DIAL. It is not part of the reading any
  // more: `MPH` stands in its own bay `UNIT_GAP` px off the arc's right edge —
  // the dial's outer radius, not the number's right side — baseline-aligned
  // with the hero, 11 px flat indigo, the same style it has always had. The bay
  // is exactly wide enough (`UNIT_BAY`), so the unit ends 13 px inside the
  // canvas: the same margin the dial keeps on its other three sides.
  ctx.font = hudFont(hudType.unit);
  ctx.letterSpacing = TRACK_UNIT;
  ctx.fillStyle = hudType.flat;
  obliqueText(ctx, UNIT, CX + R_ARC + ARC_W / 2 + UNIT_GAP, baseline, hudType.unit);
  ctx.letterSpacing = '0px';

  // ---- (5) THE GEAR BLADE, under the dial's bottom-left. The fidelity sheet's
  // row 1: the picked B cell has drawn it since the lookbook and W2 built the
  // dial without it. Last, so the reading is never painted over it.
  if (gear) bladeAt(ctx, BLADE_X, BLADE_Y, gear.toUpperCase());
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
    shownM = MPH_OF(disp);
  }

  let raw = 0;
  try { raw = P.speed(); } catch { return; }
  if (!Number.isFinite(raw)) raw = 0;
  // ...and the gear on the blade, from the same place, on the same frame. A
  // gear that cannot be read is an EMPTY blade rather than a stale one: paint()
  // skips the whole thing on a falsy string.
  try { gear = String(P.gear() || ''); } catch { gear = ''; }

  disp += (raw - disp) * (1 - Math.exp(-dt / TAU_DISP));
  heat += (raw - heat) * (1 - Math.exp(-dt / (raw > heat ? TAU_UP : TAU_DOWN)));
  // a deadband on the integer: rounding a lerped float still flickers at .5, and
  // a digit that changes twice a second on a steady traverse is the exact defect
  // the smoothing exists to remove.
  if (Math.abs(disp - shown) > 0.6) shown = Math.round(disp);
  if (Math.abs(MPH_OF(disp) - shownM) > 1) shownM = MPH_OF(disp);  // specs/0055 §4.2

  paint();
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
  // 0 on every tier since specs/0048 flattened the dial. Kept because the gate
  // reads it, and because "the gauge reports no particles" is the truth this
  // field should be telling after the particles were removed.
  embers: () => embers.length,
  // §3 — what is LEFT of the escalation, as a fact the gate can assert instead
  // of an ember count: above the redline the arc's last segment is flat
  // #ff5c8a, and this is that segment existing.
  redline: () => disp > T_ROCKET,
  box: () => ({ box: BOX, dia: DIA }),
  // used by the gate to settle the lerps without waiting on wall clock
  settle: () => { try { disp = heat = window.__player.speed(); shown = Math.round(disp); shownM = MPH_OF(disp); } catch { /* */ } },
  suppressed: () => suppressed(window.__player),
};
