// TE-styled instrument overlay for the player: readout, legend, crosshair,
// pause panel. Deliberately small — the world is the thing.

import { gliderState } from './glider.js';
import { skiState } from './ski.js';
import { DEBUG_HUD, labUI, BRAND, pick, pickBrand } from './flags.js';

// ============================================================ hudType (0048)
// ONE SHARED STYLE, and it is shared in the strongest sense available: the DOM
// half of the trick HUD and the canvas half of the speedometer both read THESE
// constants — the stylesheet below is built from them at import time, and
// speedo.js imports the same object rather than re-typing the numbers into a
// second `ctx.font` string that would then drift.
//
// Greg, 2026-09-03: "a john wick font/intensity — Avenir Medium Oblique caps
// with the purple blue gradient and flat color + italics".
//
//   THE FACE. Avenir Next is not shippable and this build will not pretend
//   otherwise: D7 bans binary assets, so there is no woff2 to serve and no
//   Google Fonts equivalent of Avenir's particular geometric-humanist middle.
//   The stack falls through honestly — Avenir Next / Avenir on a Mac,
//   Nunito Sans if it happens to be installed, Segoe UI on Windows, whatever
//   `system-ui` resolves to elsewhere — and PROGRESS-0048 records which face
//   actually rendered on the machine the compare was shot on, rather than
//   claiming Avenir on every screenshot.
//
//   THE OBLIQUE. `oblique 12deg` in the CSS; a 12° SKEW MATRIX on the canvas.
//   Not a synonym for `italic`: Avenir has no true italic and the ask was the
//   slanted roman, which is exactly what an oblique angle asks a face for. The
//   canvas cannot be handed the same declaration with any confidence — a
//   `ctx.font` string the browser fails to parse is silently DISCARDED and the
//   old font stays, which would be a wrong SIZE and not merely a wrong slant —
//   so speedo.js skews the transform by the same 12° instead.
//
//   THE COLOUR. Two values and no third: a purple→blue gradient for hero
//   numbers, and one flat cream-blue for everything secondary. No glow, no
//   bevel, no outline anywhere in this file or in speedo.js. Intensity is size,
//   weight and the gradient — that is the whole John-Wick read, and it is also
//   why the trick HUD costs no shadow passes.
export const hudType = {
  family: '"Avenir Next", Avenir, "Nunito Sans", "Segoe UI", system-ui, sans-serif',
  weight: 500,                       // Medium
  obliqueDeg: 12,
  track: 0.06,                       // em, on caps
  hero: 68,                          // px — the live timer and the score card
  // THE SAME HERO, at the bottom of the 64-72 band, for the speedometer. It is
  // not a second size in the system: the dial has 132 px of ring to fit a hero
  // number AND its unit inside, and 68 px puts the two-digit case through the
  // ring at nine o'clock. The trick HUD has the whole screen and takes the top
  // of the band; the dial takes the bottom of it.
  heroDial: 64,
  heroSmall: 28,                     // px — the multiplier
  secondary: 13.5,                   // px — trick names, the quality word
  unit: 11,                          // px — KM/H, M/S
  gradFrom: '#7b3fe4',
  gradTo: '#3b6cff',
  // THE FLAT IS A DEEP INDIGO, NOT A CREAM-BLUE. The first build of 0048 used
  // #dfe6ff at 92 %, which is what §1 asked for and what the compare then
  // proved wrong: it is a near-white, this game is played on a white mountain,
  // and at 1:1 the trick names and the M/S unit simply were not there. The
  // gradient hero numbers never had the problem — 68 px of saturated purple on
  // snow reads fine — so the fix belongs to the SECONDARY colour and not to
  // the type treatment. #2a2456 is the same hue family as the gradient's
  // purple end, one that is dark instead of light, and it needs no shadow,
  // no outline and no plate to survive a bright frame.
  flat: 'rgba(42,36,86,0.90)',       // #2a2456 at 90 %
  dim: 'rgba(42,36,86,0.35)',        // the unlit ring, the empty half of the bar
  // The landing verdict, in the palette rather than beside it. These ARE the
  // clean / sketchy / bailed colours the rest of the player already uses —
  // cream, the orange signal, the dim red — walked toward the purple-blue so
  // one line can carry a multiplier, a trick name and a verdict without the
  // verdict looking like it came off a different screen. `sketchy` is the
  // orange signal DARKENED for the same reason the flat was: #f2a65a is a pale
  // amber and pale is what snow eats.
  clean: 'rgba(42,36,86,0.90)',
  sketchy: '#c77a1a',
  bailed: '#ff5c8a',
};

// The type as a canvas font string. `px` overrides the size; the oblique is a
// transform, never a token in here (see above).
export function hudFont(px, weight = hudType.weight) {
  return weight + ' ' + px + 'px ' + hudType.family;
}

// ======================================================== specs/0055 §1
// THE REST OF THE TOKEN SET, and it lives beside `hudType` for exactly the
// reason `hudType` exists: one place the numbers live. §1.1 puts the `:root`
// block in the stylesheet below so `guide.js`, `intro.js`, `inventory.js`,
// `dev.js`, `touch.js`, `recorder.js` and `snowball.js` each read ONE NAME
// instead of re-typing a hex — §10.3's sweep.
//
// specs/0055 §1.6 — SURFACES, AND THERE ARE TWO. Cream `#f4f1ea` / ink
// `#171614` is the board (markers.js:174-177); the HUD plate is 34 % ink under
// a 2 px mounting rule. D19: **every additional slab is a §11 sign-off item**,
// so nothing may be added here without Greg's yes — the dark-glass
// `rgba(16,20,26,.93)` DESIGN-0055 grafted in was answered `no` on the
// decisions page and is deliberately absent.
export const hudSurf = {
  cream: '#f4f1ea',
  ink: '#171614',
  sub: '#726c60',
  seam: '#c8c2b3',                    // §1.10 hairline, on cream
  plate: 'rgba(23,22,20,0.34)',       // §1.6 the HUD plate — 34 % ink
  hair: 'rgba(244,241,234,0.16)',     // §1.10 hairline, on ink
  hazard: '#ff4d00',                  // §1.9 — 4 px, and it means NOT SHIPPING
  rule: '2px',                        // §1.10 mounting rule
  radius: '2px',                      // §1.10 — boards and caps; 0 on plates
};

// specs/0055 §1.7 — THE KIND DIALECTS, and this is the one place in the build
// that mirrors `markers.js KINDS` instead of importing it. `markers.js` reads
// `hudType` at MODULE TOP LEVEL (`markers.js:390`, `:425`), so an
// `import { KINDS } from './markers.js'` here closes a cycle in which
// markers.js evaluates first and finds `hudType` in its temporal dead zone —
// a ReferenceError on every boot. §10.3 reserves these hexes to `hud.js` and
// `markers.js KINDS`, which is exactly the pair this leaves. Every OTHER panel
// reads `--p-k-*` and types nothing; `dev.js` imports `KINDS` for real (no
// cycle from there).
export const hudKind = {
  run: '#f4f1ea', lift: '#ff4d00', bike: '#8ec63f',
  landmark: '#7fd4e8', venue: '#ffab00',
};

// specs/0055 §1.8 — THE SEVERITY ALPHABET, in the DOM's own colours. Drawn once
// per medium: `signs.mjs:8-20`'s DIFF for the world, `markers.js:256-305`'s
// `ico*` for the atlas, and ONE CSS CLASS PER SHAPE here. The hexes are
// signs.mjs's, so a green circle on a pause-menu group header and a green
// circle on a trail blade are the same green.
export const hudMark = {
  green: '#217a3c', blue: '#1d5fb4', black: '#141414', red: '#ff5c8a',
};

// specs/0055 §1.11 — SIX MOTION VERBS, AND NO PANEL INVENTS A DURATION.
// CUT is the absence of a rule and has no token.
export const hudMotion = {
  rise: '220ms', riseEase: 'cubic-bezier(.16,1,.3,1)',
  wipeRule: '110ms', wipeBody: '260ms',
  hold: '3s', fall: '160ms', snap: '90ms',
};

// ---- the stylesheet, built from the object above so there is exactly one
// place the numbers live. Injected rather than added to play.css for the same
// reason: a rule in a second file cannot be kept in step with a constant in
// this one, and specs/0048 asks for one shared style and not two copies of it.
//
// It is appended to <head> at import time, which is AFTER play.css's <link> in
// the document, so equal-specificity rules here win — which is what the four
// `.phud__combo*` / `.phud__cend*` selectors below rely on: play.css keeps the
// element's old position out of the way and this decides everything visual.
(function injectHudType() {
  const T = hudType;
  const caps = `font-family:${T.family};font-weight:${T.weight};`
    + `font-style:oblique ${T.obliqueDeg}deg;text-transform:uppercase;`
    + `letter-spacing:${T.track}em;`;
  // background-clip:text is the DOM half of the gradient. -webkit- prefix
  // included: it is still the only spelling Safari accepts, and the property
  // silently does nothing without it there.
  const grad = `background-image:linear-gradient(96deg,${T.gradFrom},${T.gradTo});`
    + '-webkit-background-clip:text;background-clip:text;color:transparent;'
    + '-webkit-text-fill-color:transparent;';
  const S = hudSurf, K = hudKind, M = hudMark, MO = hudMotion;
  const css = `
/* ================================================== specs/0055 §1.1 — TOKENS
   ONE NAME EACH. Every token in §1 re-published as a CSS custom property, from
   the objects above, so no other file types a value. Declared on \`:root\`
   rather than on \`.phud\` because the panels that read them are NOT inside the
   HUD's own tree — the guide layer, the locker, the intro cards, the touch
   stick and the dev bar are all siblings of it on <body>.

   THIS SHEET IS THE ONLY DECLARATION SITE. play.css "declares no design token
   today and gains none" (§1.1), so it consumes these names and never defines
   one. The sheet is appended at import time, which is before any panel paints,
   and every consumer is inside the player document that imported hud.js. */
:root {
  --p-fam:${T.family};
  --p-weight:${T.weight};
  --p-oblique:oblique ${T.obliqueDeg}deg;
  --p-track:${T.track}em;
  --p-mono:ui-monospace,Menlo,Consolas,"Segoe UI Mono",monospace;

  /* §1.3 sizes, px */
  --p-hero:${T.hero}px;         --p-hero-dial:${T.heroDial}px;
  /* §4.5 — the hero BOX: S1 and S3 are this wide, 232 px apart (208 + a 24 px
     gutter). specs/0055 §4.4 (fidelity 2026-09-06): it is no longer a width the
     ledger justifies to — the picked combo is the CONTENT-SIZED gate post — it
     is the timer's box, the receipt's floor, and the gate's cap. */
  --p-hero-box:300px;
  --p-hero-sm:${T.heroSmall}px; --p-board-name:30px;
  --p-blade:15px;               --p-secondary:${T.secondary}px;
  --p-unit:${T.unit}px;         --p-kind:10px;   --p-prose:13px;

  /* §1.4 the gradient — TWO STOPS, 96deg, NO BORDER (D18) */
  --p-grad:linear-gradient(96deg,${T.gradFrom},${T.gradTo});
  --p-grad-from:${T.gradFrom}; --p-grad-to:${T.gradTo};

  /* §1.5 flat colour */
  --p-flat:${T.flat}; --p-dim:${T.dim};
  --p-clean:${T.clean}; --p-sketchy:${T.sketchy}; --p-bailed:${T.bailed};

  /* §1.6 surfaces — TWO, and a third needs Greg (D19) */
  --p-cream:${S.cream}; --p-ink:${S.ink}; --p-sub:${S.sub}; --p-seam:${S.seam};
  --p-plate:${S.plate}; --p-hair:${S.hair};

  /* §1.7 kind dialects, mirroring markers.js KINDS */
  --p-k-run:${K.run}; --p-k-lift:${K.lift}; --p-k-bike:${K.bike};
  --p-k-land:${K.landmark}; --p-k-venue:${K.venue};

  /* §1.8 severity alphabet */
  --p-diff-green:${M.green}; --p-diff-blue:${M.blue};
  --p-diff-black:${M.black}; --p-diff-red:${M.red};

  /* §1.9 the hazard stripe, and §1.10's rules and radii */
  --p-hazard:${S.hazard}; --p-stripe:4px;
  --p-rule:${S.rule}; --p-hairline:1px; --p-spine:3px;
  --p-r:${S.radius}; --p-gauge:2px;

  /* §1.11 motion — no panel invents a duration */
  --p-rise:${MO.rise}; --p-rise-ease:${MO.riseEase};
  --p-wipe-rule:${MO.wipeRule}; --p-wipe-body:${MO.wipeBody};
  --p-hold:${MO.hold}; --p-fall:${MO.fall}; --p-snap:${MO.snap};
}

/* ------------------------------------------ specs/0055 §1.6 — THE HUD PLATE
   A sign's plate, emptied out, holding an instrument: 34 % ink, the 2 px
   mounting rule under it, 2 px radius. §2's hard rule — "no gradient numeral on
   bare snow, every hero sits on a plate" — is this element, and it is the only
   surface register 1 has. */
.hudplate {
  background:var(--p-plate);
  border-bottom:var(--p-rule) solid var(--p-grad-to);
  border-radius:var(--p-r);
}
.hudplate.is-bailed { border-bottom-color:var(--p-bailed); }
.hudplate.is-hazard { border-top:var(--p-stripe) solid var(--p-hazard); }

/* ------------------------- specs/0055 §7 — THE LABEL / RULE / HERO BLOCK
   The construction §4.4 calls "the timer's construction": a mono kind label, a
   hero numeral on the plate, and the mounting rule between the two. The live
   timer, the receipt, the bail and the gear/lift board are all THIS OBJECT with
   different words in it — which is what makes §4.5's slot swap a move rather
   than a redesign. W2 restyles the instruments that sit on it (§4.2-4.7); this
   is the block they sit on. */
.hudblk {
  display:inline-block; padding:6px 14px 8px;
  background:var(--p-plate);
  border-bottom:var(--p-rule) solid var(--p-grad-to);
  border-radius:var(--p-r);
  ${caps}
}
.hudblk__lbl {
  display:block; font-family:var(--p-mono); font-size:var(--p-kind);
  font-style:normal; font-weight:700; letter-spacing:.22em;
  color:var(--p-cream); opacity:.72; margin-bottom:2px;
}
.hudblk__hero {
  display:block; font-size:var(--p-hero); line-height:1; white-space:nowrap; ${grad}
}
.hudblk__u {
  font-size:var(--p-unit); margin-left:8px;
  background:none; color:var(--p-cream);
  -webkit-text-fill-color:var(--p-cream);
}
/* §1.10 — ONE 2 px GAUGE serves grace, fuel, charge, skip-hold and every stat
   bar. There is no progress-bar component and no switch. */
.hudgauge { height:var(--p-gauge); background:var(--p-dim); }
.hudgauge > i { display:block; height:100%; width:0; background:var(--p-grad-to); }

/* §1.8 — ONE CSS CLASS PER SHAPE, and nothing else in the DOM draws a rating.
   \`--m\` is the mark's colour; hollow is the same shape, outline only. */
.pmark { display:inline-block; flex:none; --m:var(--p-cream); }
.pmark--green  { width:11px; height:11px; border-radius:50%; background:var(--m); --m:var(--p-diff-green); }
.pmark--blue   { width:10px; height:10px; background:var(--m); --m:var(--p-diff-blue); }
.pmark--black  { width:9px; height:9px; background:var(--m); transform:rotate(45deg); --m:var(--p-diff-black); }
.pmark--double { position:relative; width:20px; height:9px; --m:var(--p-diff-black); }
.pmark--double::before, .pmark--double::after {
  content:""; position:absolute; top:0; width:9px; height:9px;
  background:var(--m); transform:rotate(45deg);
}
.pmark--double::before { left:0; }
.pmark--double::after { right:0; }
/* specs/0066 §marks — TRIPLE BLACK DIAMOND. The same 11 px lobes (9 px square on
   the diagonal) and the same 2 px gap the double has, three of them: 9+2+9+2+9. */
.pmark--triple { position:relative; width:31px; height:9px; --m:var(--p-diff-black); }
.pmark--triple::before, .pmark--triple::after, .pmark--triple > i {
  content:""; position:absolute; top:0; width:9px; height:9px;
  background:var(--m); transform:rotate(45deg);
}
.pmark--triple::before { left:0; }
.pmark--triple > i { left:11px; }
.pmark--triple::after { right:0; }
/* specs/0066 §marks — THE DEATH SIGN, "experts only", and it is GOLD (Greg,
   2026-09-06: "make the death gold"). The gold is --p-k-venue #ffab00 —
   markers.js KINDS.venue, already in :root — and NOT a new hex. Flat fills, no
   stroke and no shadow (D18): the crossbones are two filled quads and the eyes
   and nose are evenodd HOLES in the skull, so the mark is one colour and the
   plate shows through. Hollow (sketchy) is the same glyph outlined, still gold. */
.pmark--death { width:14px; height:14px; --m:var(--p-k-venue); line-height:0; }
.pmark--death > svg { display:block; width:14px; height:14px; fill:var(--m); }
.pmark--death.is-hollow {
  box-shadow:none; --m:var(--p-k-venue);
}
.pmark--death.is-hollow > svg { fill:none; stroke:var(--m); stroke-width:.9; }
.pmark--triple.is-hollow { box-shadow:none; --m:var(--p-sketchy); }
/* the red X — the system's one "closed / refused / it died" mark */
.pmark--x { position:relative; width:11px; height:11px; --m:var(--p-diff-red); }
.pmark--x::before, .pmark--x::after {
  content:""; position:absolute; left:0; top:4px; width:11px; height:2px; background:var(--m);
}
.pmark--x::before { transform:rotate(45deg); }
.pmark--x::after  { transform:rotate(-45deg); }
.pmark.is-hollow { background:none; box-shadow:inset 0 0 0 2px var(--p-sketchy); --m:var(--p-sketchy); }

/* specs/0048 — the trick HUD. Upper-centre, under the top HUD and clear of the
   speedometer's top-left box by the width of the screen. Three siblings rather
   than one wrapper, because the build gate force-measures .phud__combo on its
   own and a hidden parent would hand it a 0x0 rectangle to pass against. */
.phud__atime, .phud__combo, .phud__cend { ${caps}pointer-events:none; }

/* ================================================= specs/0055 §4.5 — THE SLOTS
   "It should move to the side if a new timer or something is ticking there"
   (D10). THREE SLOTS, ONE OCCUPANT EACH:

     S1  left:50%  top:12.5%   the live timer (.phud__atime) > the receipt
     S2  left:50%  top:21.5%   the combo meter (.phud__combo)
     S3  left:calc(50% + 232px) top:12.5%, left-aligned — whichever of S1's
                               two got displaced

   S1 and S3 are the same hero box, S3's left edge at \`calc(50% + 232px)\` — the
   spec's own coordinate. \`--p-hero-box\` is **300 px**, and NOT the 208 px that
   reading "232 px apart" as "the hero's width + a 24 px gutter" would give: a
   68 px six-figure score does not fit 208, and at 300 S1 (490-790) still clears
   S3 (872) by 82 px. The receipt owns S1 UNLESS a timer is live there, and then
   it takes S3 and arrives RISE instead of SNAP. This is also 0057's seam
   (§4.9): air time and jib time are the SAME clock in S1, never two.

   specs/0055 §4.4 (fidelity 2026-09-06) — S2 IS NO LONGER 300 px. The picked
   combo cell is the gate post, which is content-sized (the cell's own gate is
   220.6 px), so S2 grows with the names and caps at the hero box. S1 and S3
   keep the box: the receipt still lands in exactly the pixels the timer
   vacated, which is the half of "the same object" that pick B does not touch.

   AND THE BLOCKS DO NOT TOUCH — §8's P4. 12.5 % and 21.5 % of 720 are 90 px and
   154.8 px, so S1 has 64.8 px of room and a 68 px hero on a \`line-height:1\` box
   is 3.2 px too tall for it: with a live timer and a live combo on screen at
   once the two rectangles have overlapped since 0048, which is the defect P4
   exists to catch. \`line-height:.9\` gives the same glyphs a 61.2 px box — the
   ink is untouched, the half-leading is what shrinks. The bare timer spends the
   3.6 px that leaves on the picked hairline seam: 2 px of gap and 1 px of rule,
   S1 = 64.2, and it clears S2 by 0.6 px. Nothing here is a nudge: every number
   is either the spec's, the cell's, or arithmetic on them. */
.phud__atime, .phud__cend {
  position:absolute; left:50%; top:12.5%; transform:translateX(-50%);
  box-sizing:border-box; width:var(--p-hero-box);
}
/* THE RECEIPT KEEPS THE PLATE — specs/0055 §4.4 (fidelity 2026-09-06). The
   fidelity sheet measured the receipt cell's block at 336×146.9 with 18 px of
   padding = 300 px of content and the same 2 px rule, so this half of the pair
   was already the pick and only its provenance line was missing. The TIMER is
   the half that changed: cell B has no surface at all. */
.phud__cend {
  padding:0 14px;
  background:var(--p-plate);
  border-bottom:var(--p-rule) solid var(--p-grad-to);
  border-radius:var(--p-r);
}
/* S3 — left-aligned, the gutter's width to the right of S1's own left edge */
.phud__cend.is-s3 { left:calc(50% + 232px); transform:none; text-align:left; }
/* ------- specs/0055 §4.3 (fidelity 2026-09-06) — THE TIMER IS **BARE**
   The picked cell (lookbook \`#k-trick-live-timer\`, B) draws NO PLATE: a bare
   68 px gradient hero and one 132×1 px \`rgba(42,36,86,.35)\` hairline under it
   — "the mounting seam shrunk to a hairline", in the cell's own words. W2 built
   cell A's 300 px 34 %-ink plate instead, which is deviation #3 on the sheet.
   The 300 px BOX stays: it is what holds §4.5's slot geometry still and what
   keeps the meter's left edge from moving as the digits change width.

   THE SEAM'S GAP IS 2 px AND NOT THE CELL'S 9 — the one number here that is
   arithmetic rather than the cell's. §4.5 gives S1 exactly 64.8 px (12.5 % and
   21.5 % of 720 are 90 and 154.8) and a 68 px hero on \`line-height:.9\` is
   61.2 of them; 9 + 1 does not fit in the 3.6 that are left, and at the cell's
   9 the hairline would land at 161.2 — straight across the combo's own 2 px
   post, which starts at 158.8. 2 + 1 fits with 0.6 px to spare and P4 stays
   green. Everything else — the 132 px width, the 1 px height, the colour, the
   centring — is the cell's. */
.phud__atime {
  padding:0; background:none; border:0; border-radius:0;
  font-size:${T.hero}px; line-height:.9; white-space:nowrap; text-align:center;
}
.phud__atime-seam {
  width:132px; height:var(--p-hairline); background:var(--p-dim); margin:2px auto 0;
}
/* THE GRADIENT GOES ON THE NUMERAL, NOT ON THE BLOCK. \`background-clip:text\`
   clips EVERY background the element has, so a gradient declared on the block
   would clip the 34 % ink plate to the shape of the digits — which is exactly
   what the first build of this row did, and the plate simply did not appear.
   The hero is its own span (0057/R2 made it one), so the gradient lives there
   and the plate stays a plate. */
.phud__atime-n { ${grad} }
.phud__atime[hidden], .phud__atime.is-hidden { display:none; }
.phud__atime.is-out { opacity:0; transition:opacity var(--p-fall) linear; }

/* ------------------------------------------ specs/0055 §4.3 — LIVE AIR **B**
   THE METER IS VERTICAL, TO THE RIGHT OF THE NUMBER (D9): 16 px off the hero
   block's right edge, the hero's own height, and 5× the 2 px gauge = 10 px
   wide. It is the ONE place §1.10's shared gauge is widened.

   FLAMES RUN UP: the fill rises from the bottom in the gradient, and the five
   notches in the track are \`speedo.js:106\`'s five thresholds — read as
   DECISECONDS, so 10/20/28/30/40 are 1.0/2.0/2.8/3.0/4.0 s in the air. One
   number governs both instruments, which is what §4.3 asks for: the dial's
   \`T_WARM\` and the meter's first notch are the same 10.

   ...AND IT THICKENS AT EACH THRESHOLD — 10 → 12 → 14 → 16 → 18 px at those
   same five, written from JS as \`--aw\`. A gauge that gets FATTER as it fills is
   the one gauge in the system allowed to change shape, because the thing it
   measures is the one thing in the game that is only ever going one way. */
.phud__atime-m {
  position:absolute; left:100%; margin-left:16px; top:0;
  /* THE HERO'S OWN HEIGHT, and the hero's line box is now 61.2 of the block's
     64.2 px — the seam and its gap are the other 3. §4.3 asks for the meter to
     be the hero's height, so it is measured off the hero and not off the block
     it hangs on: specs/0055 §4.3 (fidelity 2026-09-06). */
  height:calc(var(--p-hero) * .9); bottom:auto;
  width:var(--aw,10px);
  background:linear-gradient(to top,
    var(--p-dim) 0 24.2%, var(--p-hair) 24.2% 25.8%,
    var(--p-dim) 25.8% 49.2%, var(--p-hair) 49.2% 50.8%,
    var(--p-dim) 50.8% 69.2%, var(--p-hair) 69.2% 70.8%,
    var(--p-dim) 70.8% 74.2%, var(--p-hair) 74.2% 75.8%,
    var(--p-dim) 75.8% 100%);
}
.phud__atime-m > i {
  position:absolute; left:0; right:0; bottom:0; height:var(--af,0%);
  background:linear-gradient(0deg,var(--p-grad-from),var(--p-grad-to));
}
/* specs/0057 §4.4 — THE UNIT, and it is the speedometer's unit treatment moved
   into the DOM: 11 px flat beside a gradient hero, which is the pattern the
   dial already reads as "number, then what the number is". It says AIR or JIB,
   and that one word is the whole of "no new chrome" — a jib borrows the timer
   rather than being handed a second clock in a second corner.
   The gradient above paints with -webkit-text-fill-color:transparent, which
   descendants inherit, so the unit has to put its own fill back or it renders
   as a hole in the hero. */
.phud__atime-u {
  font-size:${T.unit}px; line-height:1; margin-left:8px;
  background:none; color:var(--p-cream);
  -webkit-text-fill-color:var(--p-cream);
}

/* ------ specs/0055 §4.4 (fidelity 2026-09-06) — THE COMBO IS THE **GATE POST**
   The picked cell (lookbook \`#k-trick-combo-meter\`, B) is TWO SURFACES JOINED
   BY A POST, not one plate with three justified tokens — that is cell A, and it
   is what W2 built (deviation #4 on the sheet). Measured off the cell at 1:1:

     post      2 × 16 px, \`rgba(42,36,86,.35)\`, 4 px above it   (= --p-dim)
     tile      56.4 × 38, \`#f4f1ea\` cream, padding 5/10, the 28 px multiplier
     board    164.2 × 38, \`rgba(23,22,20,.78)\` ink, padding 8/13/7, gap 10,
               the 13.5 px trick names + the verdict word, baseline-aligned
     joint     220.6 × 38, radius 2, \`overflow:hidden\` so the two surfaces
               meet with no seam between them
     rule      the joint's full width, 2 px, \`rgba(42,36,86,.35)\` track under
               a \`#3b6cff\` fill — the grace countdown, now the board's own
               MOUNTING RULE, which is the whole of the signage read

   NO NEW SLAB (D19): cream and ink are §1.6's own two surfaces, and the 78 %
   ink is the cell's — the pick, not an invention. The multiplier becomes the
   PLATE and the trick line becomes the BOARD, which is the literal signage
   grammar §2 already gives the mountain.

   THE 300 px BOX IS A CAP HERE, NOT A WIDTH. The cell's gate is content-sized —
   a two-token board is 164 px and a longer pair is longer — so the box grows
   with the names and stops at \`--p-hero-box\`, the timer's own width, past
   which the name ellipsises rather than the gate running off a 390 px phone.
   The two \`.phud__combo-sep\` middots stay in the DOM (0057/R2 owns the tail's
   content and §4.9 renames nothing) and stay undrawn: the two surfaces do
   their job. */
.phud__combo {
  position:absolute; left:50%; top:21.5%; bottom:auto; transform:translateX(-50%);
  box-sizing:border-box; width:auto; max-width:var(--p-hero-box); padding:0;
  background:none; border:0; border-radius:0;
  display:flex; flex-direction:column; align-items:center; gap:0;
  white-space:nowrap; text-shadow:none;
}
.phud__combo[hidden], .phud__combo.is-hidden { display:none; }
/* the post — 2 × 16, 4 px clear of whatever is above it, and it is the whole of
   "a post hangs the thing off the timer". It is the first child, so §4.5's
   \`top:21.5%\` lands on the post and the gate sits 20 px under it. */
.phud__combo-post {
  flex:none; width:var(--p-gauge); height:16px; background:var(--p-dim); margin-top:4px;
}
/* the JOINT: the cream tile and the ink board, welded. \`overflow:hidden\` on a
   2 px radius is what makes them one object rather than two chips. */
.phud__combo-line {
  display:flex; align-items:stretch; max-width:100%; min-width:0;
  border-radius:var(--p-r); overflow:hidden;
}
.phud__combo-tile {
  flex:none; display:grid; place-items:center;
  padding:5px 10px; background:var(--p-cream);
}
.phud__combo-board {
  display:flex; align-items:baseline; gap:10px; min-width:0;
  padding:8px 13px 7px; background:rgba(23,22,20,.78);
}
.phud__combo-mult { flex:none; font-size:${T.heroSmall}px; line-height:1; ${grad} }
.phud__combo-sep { display:none; }
.phud__combo-n, .phud__combo-q { font-size:${T.secondary}px; color:var(--p-cream); }
.phud__combo-n {
  flex:0 1 auto; min-width:0;
  overflow:hidden; text-overflow:ellipsis;
}
.phud__combo-q { flex:none; }
.phud__combo-n.is-hidden, .phud__combo-q.is-hidden { display:none; }
.phud__combo-q.is-clean { color:var(--p-cream); }
.phud__combo-q.is-sketchy { color:${T.sketchy}; }
.phud__combo-q.is-bailed { color:${T.bailed}; }
/* THE POP IS **SNAP**, 90 ms, \`scale .96 -> 1\` (§1.11) — replacing 0048's
   160 ms 1.0 -> 1.08 -> 1.0. Six verbs, and the punch is one of them: a pop
   that overshoots is a seventh. On the line and not on the block, so the gauge
   under it does not breathe with every landed trick. */
.phud__combo-line.is-pop { animation:psnap var(--p-snap) both; }
@keyframes psnap { from{transform:scale(.96)} to{transform:scale(1)} }

/* ---------------------------------- specs/0055 §4.6 — THE MARKS, UNDER THE LEDGER
   §1.8's alphabet carrying the combo's own facts: one mark per trick, left to
   right, capped at 8 — past which the row reads \`8 marks + xN\` (\`tricks.js:278\`
   already slices to 8). The multiplier stays the 28 px gradient numeral and is
   never re-encoded as marks. */
.phud__marks {
  display:flex; align-items:center; justify-content:flex-start; gap:5px; min-height:11px;
  /* specs/0055 §4.6 (fidelity 2026-09-06) — "under the board", and left to
     right FROM THE BOARD'S OWN LEFT EDGE. \`align-self:stretch\` is what makes
     that true inside a centred column: the row spans the gate and its marks
     start where the cream tile starts. The 5 px is the gap the ledger's own
     column used to supply. */
  align-self:stretch; margin-top:5px;
}
.phud__marks.is-hidden { display:none; }
.pmark.is-hidden { display:none; }
.phud__marks-more {
  font-size:${T.unit}px; line-height:1; color:var(--p-cream); opacity:.8;
}

/* comboGraceT, drained full -> empty: the "you have 2 s to link" read, and it
   is §1.10's ONE 2 px gauge — now sitting directly under the board as the
   gate's MOUNTING RULE, at the joint's own width (specs/0055 §4.4, fidelity
   2026-09-06: the cell draws it 220.6 × 2, flush under the two surfaces). */
.phud__grace {
  align-self:stretch; height:var(--p-gauge); background:var(--p-dim);
}
.phud__grace i { display:block; height:100%; width:100%; background:var(--p-grad-to); }
.phud__grace.is-hidden { display:none; }

/* --------------------------------- specs/0055 §4.4 — THE RECEIPT **B** / BAIL **B**
   THE RECEIPT IS THE TIMER'S CONSTRUCTION with one word changed: same 208 px
   box, same plate, same rule, same hero — which is what "lands in the pixels
   the timer vacated" means literally, and why the swap into S3 (§4.5) is a move
   and not a redesign. Arrives SNAP in S1, RISE in S3 (§6).
   BAILED is the same object again: the mounting rule goes flat #ff5c8a and the
   multiplier is struck through. The only non-gradient rule in the system. */
.phud__cend {
  display:flex; flex-direction:column; align-items:stretch;
  text-align:center; text-shadow:none; white-space:nowrap;
  /* the timer's box is a FLOOR here, not a cap: a six-figure score at 68 px is
     wider than 300 px, and a receipt that clipped its own number to land in the
     timer's pixels would be keeping the wrong promise. Every ordinary score
     sits in exactly the timer's box; a huge one grows out of it. */
  width:auto; min-width:var(--p-hero-box);
}
.phud__cend-row { display:flex; align-items:baseline; justify-content:center; gap:14px; }
.phud__cend[hidden], .phud__cend.is-hidden { display:none; }
.phud__cend.is-bail { border-bottom-color:var(--p-bailed); }
.phud__cend-score, .phud__cend-mult { font-size:${T.hero}px; line-height:.9; }
.phud__cend-score { ${grad} }
.phud__cend-pb { font-size:${T.secondary}px; color:var(--p-cream); }
/* a bail shows the MULTIPLIER, crossed out, flat red-purple — the thing you
   lost, not a score you never banked. No gradient: you did not earn one. */
.phud__cend-mult {
  color:${T.bailed};
  text-decoration:line-through; text-decoration-thickness:4px;
}
.phud__cend-score.is-hidden, .phud__cend-pb.is-hidden, .phud__cend-mult.is-hidden { display:none; }

/* ---- specs/0055 §4.4 (fidelity 2026-09-06) — THE PROVENANCE LINE, cell B
   The ONE thing that distinguishes the receipt's B cell from its A, and the
   only thing the sheet found missing on this row: a 1 px \`rgba(244,241,234,.22)\`
   hairline 10 px under the number, then ONE 9 px mono line — the multiplier,
   the best trick, and the run it happened on. All three are fields the personal
   -best board already stores, so the receipt becomes a row you will later
   recognise on that board. The run is the nearest run marker (or the equipped
   trail); with neither, the token is simply not printed — a receipt that said
   "· —" would be inventing a fact. */
.phud__cend-hair {
  height:var(--p-hairline); background:rgba(244,241,234,.22); margin:10px 0 7px;
}
.phud__cend-prov {
  font-family:var(--p-mono); font-size:9px; font-style:normal; font-weight:700;
  letter-spacing:.2em; text-transform:uppercase; color:#cdc7ba;
}
.phud__cend-hair.is-hidden, .phud__cend-prov.is-hidden { display:none; }

/* ---- specs/0055 §4.4 + §4.6 (fidelity 2026-09-06) — THE BAIL'S MARK IS THE
   **DOUBLE DIAMOND**, not the red X. The picked cell (\`#k-trick-combo-end-bailed\`,
   B) draws §1.8's double diamond in the bail's own \`#ff5c8a\`, 34 × 17 with
   11 px lobes, justified to the block's left edge opposite the struck
   multiplier — "the big trick you lost", the severity of the thing and the loss
   of it in one glance. W2 drew a red X there instead (deviation #6). The X is
   NOT relocated to the ledger's mark row: neither the A nor the B cell of this
   panel draws one, and the row is gone by the frame the combo dies anyway. */
.phud__cend.is-bail .phud__cend-row {
  justify-content:space-between; align-items:center; gap:16px;
}
.phud__cend-dia { width:34px; height:17px; --m:var(--p-bailed); }
.phud__cend-dia::before, .phud__cend-dia::after { width:11px; height:11px; top:1px; }
.phud__cend-dia.is-hidden { display:none; }
/* specs/0066 §marks — THE BEST TRICK'S OWN MARK, beside its name on cell B's
   provenance line. It is the ledger's mark at the ledger's size, in the same
   alphabet, so "what did I just do" and "how hard was it" arrive together.
   Cell A's bail diamond above is untouched (0055 §4.4 pins it). */
.phud__cend-mark { vertical-align:-1px; margin-right:7px; }
/* §6 — SNAP in S1 (the punch, in the pixels you were already reading), RISE in
   S3 (it arrived beside something live, so it announces itself instead). */
.phud__cend.is-snap { animation:psnapc var(--p-snap) both; }
@keyframes psnapc {
  from{transform:translateX(-50%) scale(.96)} to{transform:translateX(-50%) scale(1)}
}
/* RISE only ever lands in S3, which is left-aligned and carries no transform of
   its own — so this one is the plain +10 px arrival §1.11 defines. */
.phud__cend.is-s3.is-rise { animation:prise var(--p-rise) var(--p-rise-ease) both; }
@keyframes prise { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:none} }

/* ======================================= specs/0055 §4.7 — WIPEOUT **C**
   "C title cut — we keep impact frames too for now" (Greg, decisions page
   2026-09-05). The film move: ONE WORD, 96 px, no plate, no surface, no colour
   of its own, arriving on the impact frame; everything that explains it comes
   later and smaller. Cream and not red, because the frame is already red —
   0054's \`hard-light\` flash and its vignette are UNTOUCHED and are what this
   sits on. NO ARC anywhere (D12), and no second stamp.

   The beat is the panel: word · pause · explanation, and it leaves in the
   opposite order so the punchline is the last thing on screen. The 96 px is the
   largest type in the game, past the 68 px hero and the intro's 56 px, and it
   is the one panel whose job is a joke.

   Arrival is **SNAP** (§4.7, §6's table) — the lookbook's C prose argued for a
   hard CUT on the word; the spec's six verbs give the stamp SNAP either way and
   the spec is what ships. 90 ms of \`scale .96 -> 1\` on 96 px type is a punch,
   not a bounce.

   Everything below is scoped to \`.is-wipe\`: a landed trick's stamp is 0048's
   and this row does not touch it. */
/* specs/0055 §4.7 (fidelity 2026-09-06) — THE PANEL IS THE WORD'S OWN WIDTH.
   The picked cell (\`extra-patrol-wipeout.html\` #wo-c, the +0.40 s frame) has no
   width at all: \`white-space:nowrap\` and shrink-to-fit, so the rule and the
   stat row are justified to WIPEOUT itself — measured 462.25 px at 96 px. W2
   shipped \`min(760px,86vw)\` = 760 at 1280, 298 px (65 %) wider than the word,
   which put the joke and the numbers out past both ends of it (deviation #7).
   \`max-content\` is that shrink-to-fit, said in one property; \`96vw\` is the only
   thing that ever overrides it, on a phone too narrow for 96 px caps, and the
   row then justifies to the box because the box is what is left. */
.phud__trick.is-wipe { top:34%; width:max-content; max-width:96vw; }
.phud__trick.is-wipe .phud__trick-big {
  ${caps}font-size:96px; line-height:.94; font-weight:${T.weight};
  letter-spacing:${T.track}em; color:var(--p-cream);
  text-shadow:0 3px 26px rgba(0,0,0,.55);
}
.phud__trick.is-wipe .phud__trick-rule {
  height:var(--p-rule); background:rgba(244,241,234,.30); margin:6px 0 8px;
}
.phud__trick.is-wipe .phud__trick-row {
  display:flex; justify-content:space-between; align-items:baseline; gap:20px;
}
/* the joke is PROSE: roman, sentence case, never oblique (§1.2) */
.phud__trick.is-wipe .phud__trick-sub {
  margin:0; font-family:var(--p-fam); font-style:normal; font-weight:${T.weight};
  font-size:14px; letter-spacing:normal; text-transform:none;
  color:#f0ece0; text-shadow:0 1px 8px rgba(0,0,0,.8);
}
.phud__trick.is-wipe .phud__trick-n {
  ${caps}font-size:14px; line-height:1; color:rgba(244,241,234,.72);
  font-variant-numeric:tabular-nums;
}
/* a landed trick keeps 0048's centred sub and shows neither rule nor numbers */
.phud__trick:not(.is-wipe) .phud__trick-rule,
.phud__trick:not(.is-wipe) .phud__trick-n { display:none; }
/* the beat: the rule and the line RISE 0.40 s after the word, and the word
   FALLs 160 ms before them so the punchline outlives it (§4.7's stagger) */
.phud__trick.is-wipe .phud__trick-rule,
.phud__trick.is-wipe .phud__trick-row { opacity:0; }
.phud__trick.is-wipe.is-late .phud__trick-rule,
.phud__trick.is-wipe.is-late .phud__trick-row {
  animation:prise var(--p-rise) var(--p-rise-ease) both;
}
.phud__trick.is-wipe.is-snap { animation:psnapc var(--p-snap) both; }
.phud__trick.is-wipe.is-gone-word .phud__trick-big {
  opacity:0; transition:opacity var(--p-fall) linear;
}
.phud__trick.is-wipe.is-gone-line .phud__trick-rule,
.phud__trick.is-wipe.is-gone-line .phud__trick-row {
  animation:none; opacity:0; transition:opacity var(--p-fall) linear;
}

/* ================================================ specs/0055 §1.9 + §4.8
   THE LAB DIALECT — register 3 in mono, no gradient, a 4 px hazard rule on the
   top edge, and the rule MEANS NOT SHIPPING. §1.9 names the eight surfaces that
   wear it and §8's P3 asserts exactly eight; anything shipped that grows one is
   the bug the census is for.

   These rules are in THIS sheet rather than play.css on purpose: play.css is
   linked before the injected sheet, so at equal specificity these win, and
   §1.1 keeps play.css free of token declarations. */
.plab {
  background:rgba(23,22,20,.90);
  border:0; border-top:var(--p-stripe) solid var(--p-hazard);
  border-radius:0 0 var(--p-r) var(--p-r);
  font-family:var(--p-mono); color:#e8e4da;
  box-shadow:0 8px 26px rgba(0,0,0,.45);
  padding:0;
}
.plab__hd {
  display:flex; justify-content:space-between; align-items:baseline; gap:18px;
  padding:6px 10px 5px; border-bottom:var(--p-hairline) solid var(--p-hair);
  font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:#ff9153;
}
.plab__hd .v { color:#ff9153; font-variant-numeric:tabular-nums; }
.plab__bd { padding:7px 10px 8px; font-size:10.5px; letter-spacing:.04em; line-height:1.62; }

/* §4.8 — DEBUG READOUT **A**: the slate moves to 200,14, off the dial's 172 px
   box, which is the whole of the collision 0048 shipped with. FPS **stops being
   a floating chip** and becomes the header's right-hand value: fps is a fact
   about the SESSION, not about the rider, so it belongs beside the poi name the
   way a map board carries its scale — two panels become one. */
.phud__read {
  left:200px; top:14px; right:auto; min-width:252px;
  padding:0; gap:0;
}
.phud__read .phud__title {
  padding:6px 10px 5px; border-bottom:var(--p-hairline) solid var(--p-hair);
  font-size:9.5px; letter-spacing:.18em; color:#ff9153;
}
.phud__read .phud__title b { color:#ff9153; letter-spacing:.18em; }
.phud__read .phud__title .dot { background:var(--p-hazard); }
/* the fps value, moved INTO the title row */
.phud__title .spacer { flex:1 1 auto; }
.phud__read .phud__fps {
  position:static; padding:0; background:none; border:0; border-radius:0;
  font-size:9.5px; letter-spacing:.18em; color:#ff9153;
}
.phud__read .phud__fps .k { color:#ff9153; opacity:.7; }
.phud__read .phud__fps .v { color:#ff9153; }
/* dev.js's band pushes the lab surfaces down 34 px while it is up (W5's
   \`is-devbar\`). The fps node is INSIDE the readout now, so it would take that
   offset twice and sit 34 px below its own header row. */
body.play.is-devbar .phud__read .phud__fps { margin-top:0; }
.phud__read .r { padding:0 10px; }
.phud__read .r:first-of-type { padding-top:7px; }
.phud__read .r:last-child { padding-bottom:8px; }

/* §4.8 — LEADERBOARD **B**: the breadcrumb rotates 45° into a diamond, at zero
   pixel cost. It is the smallest instance of §1.8's alphabet in the build. */
.phud__bdot { border-radius:0; transform:rotate(45deg); }

/* §4.8 — KEY HINT: the six free-floating chips become ONE BOARD WITH HAIRLINE
   DIVIDERS — the sign-post strip at the bottom of a lift line. Six contrast
   problems become one, and the bottom edge gets a shape. D44 holds: the
   E / I / F / B / F8 / SHIFT chips are still built and still dark, and the whole
   strip is still absent on \`pointer:coarse\` (hud.js sets display:none inline).
   Key caps are cream plates on ink; ESC keeps the orange, because it is the one
   key that leaves the world. */
.phud__legend {
  gap:0; flex-wrap:nowrap; max-width:none;
  border-radius:var(--p-r); overflow:hidden;
  box-shadow:0 4px 16px rgba(0,0,0,.36);
}
.phud__legend .pkey {
  background:rgba(23,22,20,.86);
  border:0; border-radius:0;
  border-left:var(--p-hairline) solid var(--p-hair);
  padding:6px 11px; gap:7px;
  font-family:var(--p-mono); font-size:9.5px; letter-spacing:.13em; color:#cdc7ba;
}
.phud__legend .pkey:first-child { border-left:0; }
.phud__legend .pkey b {
  background:var(--p-cream); color:var(--p-ink);
  border-radius:var(--p-r); padding:3px 7px; letter-spacing:.06em;
}
/* ESC is the exit, and the only chip that keeps the signal colour */
.phud__legend .pkey.is-out b { background:var(--p-hazard); color:#fff; }
/* HOLD, live (§1.11) — a held key inverts its cap for exactly as long as it is
   held. That is the existing \`is-on\` state, restyled, not a new one. */
.phud__legend .pkey.is-on { background:rgba(23,22,20,.86); border-color:var(--p-hair); color:var(--p-cream); }
.phud__legend .pkey.is-on b { background:var(--p-hazard); color:#fff; }

/* §1.9 — THE HAZARD STRIPE, on the surfaces hud.js owns. The compression meter
   is styled from a \`cssText\` this rule deliberately does not touch: §0 pins
   \`hud.js:228-291\` byte-identical, and \`border-top\` is not one of the
   properties that block declares, so the stripe lands without editing it. */
.phud__read, .phud__lip, .phud__dev, .phud__ref {
  border:0; border-top:var(--p-stripe) solid var(--p-hazard);
  border-radius:0 0 var(--p-r) var(--p-r);
  background:rgba(23,22,20,.90);
}
.phud__dev .phud__title, .phud__ref .phud__title {
  border-bottom:var(--p-hairline) solid var(--p-hair);
  padding-bottom:4px; margin-bottom:4px;
}

/* §5.5 / W5 hand-off 3 — THE F8 SLATE SAYS IT ONCE. dev.js's band head already
   prints \`DEV FLY · F8 · fly back\` across the top edge; this slate is the
   fly CAMERA's numbers, so it names those instead of repeating the mode. */
.phud__dev .phud__title b { color:#ff9153; }

/* §5.5 / W5 hand-off 1 — REFERENCE **A**: right-anchored, and an honest empty
   state. "no reference bundle" is a REFUSAL, not an error, so it gets §1.8's
   red X and no colour of its own. */
.phud__ref { right:14px; left:auto; }
.phud__ref-cap {
  display:flex; align-items:center; gap:8px;
  color:#cdc7ba; letter-spacing:.1em;
}
.phud__ref-cap .pmark { display:none; }
.phud__ref.is-empty .phud__ref-cap .pmark { display:block; }
.phud__ref.is-empty .phud__ref-img { display:none; }

/* §5.5 / W5 hand-off 2 — THE MATCH DIALOG'S FLASH LINE. \`hud.flash()\` is the
   one line dev.js has to say "I will not do that yet"; a refusal takes the red
   X and the words stay verbatim. */
.phud__toast.is-refusal {
  display:flex; align-items:center; gap:9px;
  border-color:var(--p-diff-red); color:var(--p-cream);
}

/* ============================================ specs/0055 §5.1 — W4 hand-off
   THE PAUSE MENU'S GEAR GROUPING. W4 built the map board and could not build
   the grouping, because the grouping is DATA and it lives in this file. Each
   group is its own sub-grid under a header carrying §1.8's mark, and the board
   flows the groups into two columns without a row count anywhere: \`column-count\`
   breaks between groups, never inside one.

   TWO COLUMNS ONLY WHEN THERE ARE TWO THINGS TO PUT IN THEM. \`column-count:2\`
   on a board holding ONE group still reserves the second column, and the
   shipped five-row tier then sits in a board with an empty right half — the
   exact failure W4's sheet comment names ("the shipped five-row tier reserves
   the lab tier's second column"). The builder adds \`is-cols\` when it emitted
   more than one group, which is the same "one code path, both tiers" §5.1
   asks for, said in one class instead of a row count. */
.ppause__keys { display:block; column-count:1; }
.ppause__keys.is-cols { column-count:2; column-gap:26px; column-fill:balance; }
.ppause__grp { break-inside:avoid; -webkit-column-break-inside:avoid; }
/* THE ROW PITCH IS THE LOOKBOOK'S 23 px (\`#k-pause-menu\`, cell A: key plates on
   a 23 px rhythm), not W4's flat-list 27. Eight group headers cost the lab
   board ~110 px it did not spend before, and at 27 the panel measured 880×750
   on a 720 screen — the ODbL credit §5.1 requires verbatim was rendered BELOW
   THE BOTTOM OF THE SCREEN, and "30 rows fit one screen" was not true. 17 px
   plate + 3 + 3 puts the lab board back inside the frame with the footer on it. */
.ppause__grp-rows .cap, .ppause__grp-rows .what { padding-bottom:3px; margin-bottom:3px; }
/* NO RULE UNDER THE GROUP HEADER. The lookbook cell draws none (Greg,
   2026-09-06: match the cell) — the mark and the gap are the header, and a
   second ink hairline in a board that is already all hairlines reads as one
   more row rather than as the thing above them. The 14 / 8 margins are the
   cell's own rhythm, and they buy back the 3 px of padding the rule needed. */
.ppause__grp-hd {
  display:flex; align-items:center; gap:8px;
  margin:14px 0 8px;
  font-family:var(--p-mono); font-size:9px; font-weight:700;
  letter-spacing:.2em; text-transform:uppercase; color:var(--p-sub);
}
.ppause__grp:first-child .ppause__grp-hd { margin-top:0; }
.ppause__grp-rows { display:grid; grid-template-columns:max-content auto; gap:0 14px; }
`;
  const s = document.createElement('style');
  s.id = 'phud-type';
  s.textContent = css;
  document.head.appendChild(s);
})();

// THE WIPEOUT SUBTITLE, by `why`. One line per thing the world is allowed to
// put you down with: the controller decides which, this only prints it. specs/
// 0012 shipped landing/tree, 0020 shipped rock, specs/0018 adds the four props.
// Anything not in here falls back to the rotation wording, which is what an
// unfinished spin and a crossed-ski landing have always read as.
const WIPE_SUB = {
  landing: 'came in too hot',
  tree: 'met a tree',
  rock: 'that was rock',
  building: 'that wall was load-bearing',
  tower: 'the lift is not a slalom gate',
  person: 'sorry. so sorry.',
  bench: 'the bench had it coming',
};

// ===================================================== specs/0055 §4.3 + §4.6
// THE FIVE THRESHOLDS, ONCE. These are `speedo.js:106`'s `T_WARM · T_HOT ·
// T_FIRE · T_INSANE · T_ROCKET` and they are re-declared rather than imported
// because `speedo.js` imports THIS file — an import back would close the cycle
// and put `hudType` in its own temporal dead zone on boot, which is the same
// trap §1.7 documents for `markers.js KINDS`. §4.3 reads them as DECISECONDS
// for the air meter (1.0 / 2.0 / 2.8 / 3.0 / 4.0 s), which is what "one number
// governs both instruments" means: the dial's 10 m/s and the meter's 1.0 s are
// the same 10.
const TIERS = [10, 20, 28, 30, 40];
const airTier = (t) => TIERS.filter((v) => t * 10 >= v).length;   // 0..5

// ------------------------------- specs/0055 §4.4 (fidelity 2026-09-06)
// THE RECEIPT'S THIRD TOKEN — the run the combo happened on. Read off the two
// things that already know the answer, in the order the brief gives them: an
// EQUIPPED TRAIL if the player put one on, otherwise the NEAREST RUN MARKER
// (`markers.js:2234`'s `stats().nearest`, which is already computed every frame
// for the sign hover and costs this nothing). Read through the window globals
// and not through an import: `markers.js` reads `hudType` at module top level,
// so importing it back here closes the same cycle §1.7 documents.
//
// It returns '' rather than a placeholder when neither knows: a receipt that
// printed "· —" would be inventing a fact about where you were.
function runName() {
  try {
    const g = window.__guide;
    const eq = g && typeof g.equipped === 'function' ? g.equipped() : null;
    if (eq && eq.name) return String(eq.name);
    const m = window.__playMarkers;
    const st = m && typeof m.stats === 'function' ? m.stats() : null;
    const n = st && st.nearest;
    if (n && n.kind === 'run' && n.name) return String(n.name);
  } catch { /* the receipt is not worth a boot error */ }
  return '';
}

// ---------------------------------------------- specs/0055 §4.6 — THE MARKS
// §1.8's severity alphabet carrying the combo's own facts. The table:
//
//   green circle   spinMult < 2    clean, under 360°
//   blue square    spinMult 2-3    clean, 360-540°
//   black diamond  spinMult >= 4   clean, >= 720°
//   double         black diamond AND the family has not been seen this line
//   red X          the combo died
//   hollow         sketchy — the same shape, outline only, in `sketchy`
//
// DRIVEN OFF `tricks.js`, and every fact here comes off the payload it already
// sends: `c.names` is `c.tricks` in order, `c.quality` is `c.lastQ`. The DEGREES
// and the FAMILY are read back out of the trick's own name because that is what
// `trickName()` (`tricks.js:278-287`) encodes into it — `Cork 720` is family
// cork at 720°, `50-50` is a jib, `Double Back Flip` is 720° of flip. The
// alternative was a new field on the HUD payload, which is `tricks.js`, which is
// not this row's file (§9). What is NOT recoverable that way is per-trick
// quality: `tricks.js` sends one verdict for the LINE, so the hollow mark goes
// on the mark it describes — the most recent one.
const SPIN_M = [[180, 1.5], [360, 2], [540, 3], [720, 4], [900, 6], [1080, 8], [1260, 10], [1440, 13]];
function spinMultOf(deg) {
  let m = 1;
  for (const [d, v] of SPIN_M) { if (deg + 1e-6 >= d) m = v; else break; }
  return deg > 1440 ? 13 + (deg - 1440) / 180 * 3 : m;
}
// specs/0066 §7 — the alphabet now reads COUNT, not family novelty, and the
// count still comes back out of the NAME: 0066's grammar spells it in full
// ([SWITCH] [COUNT] FAMILY [DEGREES] [GRAB(S)] [TWEAK] [TO SWITCH]) and the
// alternative was a new field on the HUD payload, which is `tricks.js`, which is
// not this row's file (0055 §9). One source for the count — the DEGREES — so a
// count word and a degree can never disagree.
const COUNT_DEG = { DOUBLE: 2, TRIPLE: 3, QUAD: 4, QUINT: 5, SEXT: 6, SEPT: 7, OCT: 8 };
// the count word only counts when it is prefixing a ROTATION family: `DOUBLE
// MUTE` is two grabs off one straight air, not a 720.
const COUNT_RE = /\b(DOUBLE|TRIPLE|QUAD|QUINT|SEXT|SEPT|OCT)\s+(?:FRONT\s+|BACK\s+)?(?:FLIP|CORK|BIO|MISTY|RODEO|D-SPIN|UNDERFLIP)\b/i;
const GRAB_RE = /\b(?:SAFETY|INDY|MUTE|TAIL|NOSE|TRUCK DRIVER)\b/gi;
function degOfName(n) {
  const m = /(\d{3,4})/.exec(n);
  if (m) return +m[1];
  const fl = /\bFLAT\s+(\d+)\b/i.exec(n);          // FLAT 5 is 900°, in half-turns
  if (fl) return +fl[1] * 180;
  const w = COUNT_RE.exec(n);
  if (w) return COUNT_DEG[w[1].toUpperCase()] * 360;
  if (/half-cab/i.test(n)) return 180;
  if (/flip/i.test(n)) return 360;
  return 0;
}
const countOfName = (n) => Math.floor(Math.max(0, Math.round(degOfName(n) / 180) * 180) / 360);
// how many GRABS the phrase names — `NOSE + TAIL` is two, `DOUBLE MUTE` is two,
// `PRESS + MUTE` is one. Only the death sign's second clause reads it.
function grabsOfName(n) {
  const m = String(n).match(GRAB_RE);
  let k = m ? m.length : 0;
  if (/\b(?:DOUBLE|TRIPLE|QUAD)\s+(?:SAFETY|INDY|MUTE|TAIL|NOSE|TRUCK)\b/i.test(n)) k = Math.max(k, 2);
  return k;
}
// specs/0066 §7's table, top down. `fresh` is gone: TRIPLE+ is a double diamond
// whether or not the family is new, which is the whole of Greg's 2026-09-06
// "we can add more icons for harder tricks".
function markClass(n) {
  const deg = degOfName(n), cnt = countOfName(n);
  // EXPERTS ONLY: a Quint or bigger, a Quad flown with two grabs, or a cork that
  // went all the way over (D-SPIN) at 1440° and up.
  if (cnt >= 5 || (cnt >= 4 && grabsOfName(n) >= 2) || (/d-spin/i.test(n) && deg >= 1440)) return 'death';
  if (cnt === 4) return 'triple';
  if (cnt === 3) return 'double';
  if (cnt === 2) return 'black';
  const sm = spinMultOf(deg);
  if (sm >= 4) return 'black';
  return sm >= 2 ? 'blue' : 'green';
}
// The death sign's glyph, at mark size. Two filled quads for the crossbones and
// one evenodd path for the skull, whose eyes and nose are holes rather than
// second-colour fills — flat, one ink, no stroke and no shadow (D18).
const SKULL = '<svg viewBox="0 0 14 14" aria-hidden="true">'
  + '<rect x="0.3" y="10.85" width="13.4" height="1.6" rx="0.3" transform="rotate(13 7 11.65)"/>'
  + '<rect x="0.3" y="10.85" width="13.4" height="1.6" rx="0.3" transform="rotate(-13 7 11.65)"/>'
  + '<path fill-rule="evenodd" d="M7 0.7c-3.1 0-5.2 2.3-5.2 5.2 0 1.7.8 2.9 1.8 3.6v1.2h6.8V9.5'
  + 'c1-.7 1.8-1.9 1.8-3.6C12.2 3 10.1.7 7 .7Z'
  + 'M5.1 4.35a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Z'
  + 'M8.9 4.35a1.35 1.35 0 1 0 0 2.7 1.35 1.35 0 0 0 0-2.7Z'
  + 'M6.3 7.6h1.4L7 9.1Z"/></svg>';
// One mark element, so the ledger, the receipt and any census build it the same
// way. `cls` is markClass()'s word; TRIPLE needs a middle lobe the two pseudo-
// elements cannot draw, and DEATH needs its glyph and its legend text.
function markEl(cls, extra) {
  const m = el('span', 'pmark pmark--' + cls + (extra ? ' ' + extra : ''));
  if (cls === 'triple') m.append(el('i'));
  if (cls === 'death') { m.innerHTML = SKULL; m.title = 'EXPERTS ONLY'; }
  return m;
}

// Write only on CHANGE. specs/0048 §4 puts a 0.2 ms median on the HUD's draw
// and the combo meter is called once per frame for the whole of a line, so the
// multiplier, the two names and the quality word would otherwise be four
// textContent writes a frame for content that changes about twice a second.
// Reading `textContent` is not a layout read — no reflow, no invalidation.
const txt = (node, s) => { if (node.textContent !== s) node.textContent = s; };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createHud({ poi, run, adapter, onResume, onRespawn }) {
  const root = el('div', 'phud');

  // specs/0055 §5.3 (Greg 2026-09-06: hide poi-lab UI) — THE LAB REGISTER, as a
  // list of nodes. Every `if (DEBUG_HUD)` below stays exactly what it was: the
  // BUILD gate, so the shipped build still constructs nothing (specs/0003 §A2).
  // What is new is that each thing it builds also lands in here, and
  // paintInstruments() — the one function in this file that already owns "is
  // this instrument on the screen" — toggles the whole list off `labUI()`.
  // One list, one paint, no second visibility rule per panel.
  const labNodes = [];

  // ---- readout
  //
  // specs/0003 — `debugHud`. The top-left readout (x/y/z · speed · state · gear
  // · cam) and the top-right fps chip are instrumentation for a WORLD BUILDER,
  // and they are the two things a screenshot of a shareable build should not
  // have in it (Greg: "the debug hud will still live in the master builder but
  // not the shareable red dog"). On the shareable build the corner they used to
  // occupy is the speedometer's instead — designed rather than instrumented.
  //
  // They are BUILT in every environment and only APPENDED in the lab: `read`,
  // `rows`, `fps` and `fpsVal` all stay in scope because paintInstruments() and
  // tick() write into them on every frame, and cutting the writes as well would
  // be forty lines of branch for two DOM nodes that are already off the screen.
  // A detached node costs nothing and it keeps this to two `if`s.
  const read = el('div', 'phud__read pchip');
  const title = el('div', 'phud__title');
  title.append(el('span', 'dot'), el('b', null, pick((poi || 'world').toUpperCase(), BRAND)));
  read.append(title);
  // specs/0055 §4.8 — DEBUG READOUT **A**, FPS **inside its header**. The chip
  // moves to `200, 14` (the rule is in the injected sheet) off the dial's
  // 172 px box, which is the collision 0048 shipped with; and the fps chip
  // stops being a second floating object in the opposite corner. It is BUILT
  // here and APPENDED below, after `fps` exists — same "built in every
  // environment, appended only in the lab" contract as the readout itself.
  const titleSpacer = el('span', 'spacer');
  const rows = {};
  for (const [k, label] of [['pos', 'x / y / z'], ['spd', 'speed'], ['state', 'state'], ['gear', 'gear'], ['cam', 'cam']]) {
    const r = el('div', 'r');
    r.append(el('span', 'k', label), el('span', 'v', '—'));
    rows[k] = r.lastChild;
    read.append(r);
  }
  if (DEBUG_HUD) root.append(read);

  // ---- LIP / COMPRESSION METER. Lab only, and lab only in the strongest
  // sense: the nodes are not merely hidden outside DEBUG_HUD, they are never
  // constructed, `lipMeter` below is a no-op without them, and every style it
  // needs is set on the element rather than in play.css — so the shareable
  // build carries no markup, no rule and no branch for it.
  //
  // It exists because "compressions aren't leading to natural launches" and
  // "I'm jumping higher than usual on downhills" are the same sentence said
  // twice, and neither can be answered by watching the screen. What it shows is
  // the physics' own arithmetic, unrounded and unflattered: the surface rate the
  // ski is reading, the reference it is being compared against, what each half
  // of the charge is worth INCLUDING the negative half, and what a takeoff would
  // actually be paid this instant.
  let lipEls = null;
  if (DEBUG_HUD) {
    const box = el('div', 'phud__lip pchip');
    box.style.cssText = 'position:absolute;left:12px;top:190px;min-width:236px;'
      + 'font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;'
      + 'pointer-events:none;white-space:pre;';
    const t = el('div', 'phud__title');
    t.append(el('span', 'dot'), el('b', null, 'LIP · COMPRESSION'));
    box.append(t);
    const line = (k) => {
      const r = el('div');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:10px';
      const kk = el('span', null, k); kk.style.opacity = '.55';
      const vv = el('span', null, '—');
      r.append(kk, vv); box.append(r);
      return vv;
    };
    const rows2 = {};
    for (const k of ['surface vy', 'reference', 'compression']) rows2[k] = line(k);
    const sep = el('div');
    sep.style.cssText = 'height:1px;margin:5px 0;opacity:.25;background:currentColor';
    box.append(sep);
    for (const k of ['ramp x K', 'comp x K', 'charge']) rows2[k] = line(k);
    // the charge bar, against lipMax. Two-tone so the split is visible at a
    // glance: the ramp's share and the compression's share of what is banked.
    const bar = el('div');
    bar.style.cssText = 'position:relative;height:6px;margin:4px 0 6px;'
      + 'border:1px solid currentColor;opacity:.9';
    const barR = el('i');
    barR.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;background:currentColor;opacity:.95';
    const barC = el('i');
    barC.style.cssText = 'position:absolute;top:0;bottom:0;width:0;background:currentColor;opacity:.45';
    const barMin = el('i');   // where lipMin sits — under it nothing launches
    barMin.style.cssText = 'position:absolute;top:-2px;bottom:-2px;width:1px;background:currentColor';
    bar.append(barR, barC, barMin);
    box.append(bar);
    const sep2 = el('div');
    sep2.style.cssText = 'height:1px;margin:5px 0;opacity:.25;background:currentColor';
    box.append(sep2);
    for (const k of ['surface accel', 'snap release', 'pop window', 'pop now', 'state']) rows2[k] = line(k);
    // the takeoff readout: latched for a beat, itemised, and it says outright
    // when the ground swallowed the launch it just paid out
    const shot = el('div');
    shot.style.cssText = 'margin-top:6px;padding-top:5px;border-top:1px solid currentColor;'
      + 'opacity:.85;white-space:pre-wrap';
    shot.textContent = 'takeoff —';
    box.append(shot);
    root.append(box);
    labNodes.push(box);
    lipEls = { box, rows: rows2, barR, barC, barMin, shot, shotT: 0 };
  }

  // ---- fps
  //
  // specs/0055 §4.8 — IT IS A HEADER VALUE NOW, not a chip. `.pchip` comes off
  // (the slate it lands in carries the surface) and the node is appended to the
  // readout's title row instead of to `root`, so there is one lab panel in the
  // corner where there were two in opposite corners. `fpsVal` is unchanged, so
  // tick()'s write is unchanged; nothing outside this file learns of the move.
  const fps = el('div', 'phud__fps');
  fps.append(el('span', 'k', 'fps '), el('span', 'v', '—'));
  const fpsVal = fps.lastChild;
  title.append(titleSpacer, fps);

  // ---- dev readout (F8). Where the builder camera is, in the terms a world
  // builder needs: pose, lens, speed, and the spawn params that reproduce this
  // exact view. dev.js drives it; see harness/TUNING.md.
  //
  // specs/0003 §A2 — THIS IS THE OTHER HALF OF "DEV MODE DOES NOT SHIP". The
  // module is stubbed in the public build, so nothing would ever have driven
  // this panel there — but "never shown" and "never built" are not the same
  // claim, and A2 makes the stronger one. `devRead` stays a `let` so every
  // writer below can null-check it in one place rather than every build growing
  // a second code path.
  let devRead = null, devRows = {}, devParams = null;
  let devFull = '';
  if (DEBUG_HUD) {
    devRead = el('div', 'phud__dev pchip');
    devRead.hidden = true;
    const devTitle = el('div', 'phud__title');
    // specs/0055 §5.5, W5 hand-off 3 — SAID ONCE. dev.js's band already prints
    // `DEV FLY · F8 · fly back` across the top edge of the screen (dev.js:268);
    // this slate is the fly camera's NUMBERS, so it names those. Two panels
    // announcing the same mode is the thing style B removes.
    devTitle.append(el('span', 'dot'), el('b', null, 'FLY CAMERA'));
    devRead.append(devTitle);
    for (const [k, label] of [['pos', 'x / y / z'], ['ang', 'yaw / pitch'], ['fov', 'fov'], ['spd', 'speed'], ['cmp', 'compare']]) {
      const r = el('div', 'r');
      r.append(el('span', 'k', label), el('span', 'v', '—'));
      devRows[k] = r.lastChild;
      devRead.append(r);
    }
    devParams = el('div', 'phud__dev-url');
    devParams.textContent = '?spawn=';
    devRead.append(devParams);
    const devBtns = el('div', 'phud__dev-btns');
    const devCopyP = el('button', 'pdev-btn pdev-btn--sm', 'copy params');
    const devCopyU = el('button', 'pdev-btn pdev-btn--sm', 'copy url');
    devCopyP.type = devCopyU.type = 'button';
    devBtns.append(devCopyP, devCopyU);
    devRead.append(devBtns);
    root.append(devRead);
    const copy = (text, what) => {
      // specs/0055 §5.5 — every writer of this one line clears the refusal mark
      const done = () => { toast.classList.remove('is-refusal'); toast.textContent = 'copied · ' + what; toast.hidden = false; toastT = 1.2; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
      else done();
    };
    devCopyP.addEventListener('click', (e) => { e.stopPropagation(); copy(devParams.textContent, 'spawn params'); });
    devCopyU.addEventListener('click', (e) => { e.stopPropagation(); copy(devFull, 'play url'); });
  }

  // ---- legend
  const legend = el('div', 'phud__legend');
  const mk = (cap, what) => {
    const k = el('span', 'pkey');
    k.append(el('b', null, cap), document.createTextNode(what));
    legend.append(k);
    return k;
  };
  // A chip that is BUILT and never put on the strip. SAME CHILDREN as mk()'s,
  // which is the whole point: tick() relabels the SHIFT chip live
  // (`keyEls.sprint.lastChild.nodeValue = bike ? 'brake' : 'sprint'`), and on a
  // childless span `lastChild` is null and that line throws ONCE PER FRAME —
  // 1,632 page errors in a single gate run, silent on screen. So a stripped chip
  // stays a real chip that is simply not on the strip, and every future tick()
  // write lands on a node instead of on null.
  const dark = (cap, what) => {
    const k = el('span', 'pkey is-hidden');
    k.append(el('b', null, cap), document.createTextNode(what));
    return k;
  };
  // D44, and it is a PRODUCT decision rather than a strip: "secretly keep hidden
  // features but don't clutter user knowledge of their existence." E gear, I
  // locker and F lift are chips for features that are deliberately undocumented
  // in both builds, and a permanent strip naming them is the loudest possible
  // advertisement of the thing it is meant to keep quiet. They all keep WORKING
  // — only the chips go. SHIFT goes for a different reason: it does nothing at
  // all on skis now, so a chip offering it is a hint for a dead key.
  //
  // WHAT SURVIVES, and why:
  //   WASD · SPACE · ← → · C · R · ESC   the documented six, in the order the
  //                                      ESC panel lists them
  //   HOLD SPACE boost   contextual and rocket-only (tick() reveals it), so it
  //             can only ever appear to someone who has ALREADY found the rocket
  //             — that is helping a finder, not advertising the find
  //   F lift    the CHIP goes; the contextual boarding prompt under the
  //             crosshair is untouched and says it at the moment it is true
  //
  // N refs and F8 dev are the LAB's own instruments (`debugHud`), so they are on
  // the strip in the bench and dark in the shareable build. (specs/0057 §4.4, B,
  // Greg 2026-09-06 — that chip said B until the grab took the key. The SHIPPED
  // strip is still exactly six and B is NOT on it: the ESC panel and the intro
  // card are where a shipped key is documented, and they both carry `B · grab`.)
  const keyEls = {
    move: mk('WASD', 'move'),
    sprint: dark('SHIFT', 'sprint'),
    jump: mk('SPACE', 'jump'),
    gear: dark('E', 'gear'),
    inv: dark('I', 'locker'),
    // 2026-08-31 — the throttle moved from G to hold-SPACE. The cap says HOLD
    // SPACE rather than SPACE because the strip already carries a SPACE chip for
    // the jump, and two chips reading SPACE with different words after them is a
    // worse hint than no chip. Still contextual and still rocket-only.
    boost: mk('HOLD SPACE', 'boost'),
    lift: dark('F', 'lift'),
    spin: mk('← →', 'spin'),
    cam: mk('C', 'camera'),
    // R is one of the documented keys — it is on the intro controls card and on
    // the ESC panel — and it was the only one of them with no chip. That is the
    // wrong asymmetry: R is the key you want at the exact moment you are least
    // likely to reopen a panel to look it up. It carries no state, because R is
    // always available and a chip that is always true should not blink.
    reset: mk('R', 'reset'),
    refs: DEBUG_HUD ? mk('N', 'refs') : dark('N', 'refs'),   // specs/0057 §4.4 (B, Greg 2026-09-06)
    dev: DEBUG_HUD ? mk('F8', 'dev') : dark('F8', 'dev'),
    pause: mk('ESC', 'pause'),
  };
  keyEls.lift.classList.add('is-hidden');       // shown only if the world has lifts
  keyEls.boost.classList.add('is-hidden');      // shown only in the rocket gear
  // specs/0055 §4.8 — the six chips are ONE BOARD now (the rule is in the
  // injected sheet). ESC keeps the orange cap because it is the only key on the
  // strip that leaves the world; every other cap is a cream plate on ink.
  keyEls.pause.classList.add('is-out');
  root.append(legend);
  // Greg, 2026-09-01 — "on the mobile screen I don't want to see the chips."
  // Every cap on this strip names a KEY (WASD, SPACE, ← →, C, R, ESC) and a
  // phone has none of them, so on a coarse pointer the strip is six lies taking
  // up the bottom of a 390 px screen. The phone learns its controls from the
  // intro's touch diagram and drives from touch.js's stick instead.
  //
  // An INLINE display, not the `is-hidden` class the rest of this file uses:
  // paintInstruments() toggles `is-hidden` on `legend` every time the pause
  // panel opens or closes, so a class set here would be wiped by the first
  // un-pause. Desktop is untouched — the chips, their order and their live
  // `is-on` states are all exactly as they were.
  if (matchMedia('(pointer: coarse)').matches) legend.style.display = 'none';
  // (the old CSS ski rails lived here — superseded by the real 3D skis in main.js)

  // ---- lift prompt: the one contextual line on the screen. Sits just under
  // the crosshair so it reads as "the thing in front of you", not an instrument.
  //
  // TOUCH — Greg, 2026-09-05: "on mobile, location-based events should be
  // clickable (start race and ride chair)". THIS ONE ELEMENT IS EVERY
  // LOCATION-BASED OFFER THE GAME MAKES. lift.js writes 'ride RED DOG' when you
  // stand on a base terminal's boarding circle; guide.js writes 'race RED DOG
  // SLALOM' when you stand on a course's start circle; both are keyed F and the
  // two already hand this line back and forth (guide.js, "THE PROMPT LINE IS
  // SHARED"). So a phone needs exactly ONE tap target, not one per feature —
  // which is also why specs/0055 gets one chip to restyle rather than a family.
  //
  // WHAT THE TAP DOES: it dispatches the real `keydown`/`keyup` on `window`. Not
  // a shortcut into lifts.use(), and not a second call into guide.js: main.js
  // owns the lift key and guide.js owns the race key, in two listeners this file
  // cannot see and should not learn about, and a private entry point into either
  // is a second thing to keep in step forever. The dispatch runs the same two
  // listeners in the same order the keyboard runs them, so "the tap does what
  // the key does" is true by construction rather than by maintenance.
  // markers.js already fakes its T exactly this way (`_test.press`), so this is
  // the house pattern and not a new one.
  //
  // WHERE IT SITS: bottom centre, NOT under the crosshair. (1) On a coarse
  // pointer the key legend is `display:none` twenty lines above this, so the
  // bottom strip is already empty — the tap target takes the space the key chips
  // vacated instead of adding furniture to a 390 px screen. (2) A 60 px slab
  // under the crosshair is a 60 px slab over the snow you are about to ski into,
  // dead centre, and centre screen is where touch.js's look-drag lives. Bottom
  // centre is the seam between the two thumbs — touch.js gives the left half to
  // the stick and the right half to look/jump — so either thumb reaches it
  // without a re-grip, and because it only exists while an offer is live it
  // steals a jump tap only where you are standing still on a circle anyway.
  //
  // DESKTOP IS UNTOUCHED: same place under the crosshair, same key cap, still
  // `pointer-events: none`. A mouse click is deliberately NOT wired — a desktop
  // player is in pointer lock while playing, so a click can never land on this
  // element, and giving a centre-screen HUD box pointer-events would let it eat
  // the click that re-acquires the lock.
  const COARSE = matchMedia('(pointer: coarse)').matches;
  const promptEl = el('div', 'phud__prompt pchip');
  promptEl.hidden = true;
  const promptKey = el('b', null, 'F');
  const promptTxt = el('span', null, '');
  promptEl.append(promptKey, promptTxt);
  root.append(promptEl);
  let hasLifts = false;
  let promptCap = 'F';          // the KEY the live offer is bound to, cap form
  let promptFires = 0;          // taps taken, for the gate

  // cap -> KeyboardEvent.code. Every caller writes 'F' today; the table is here
  // so a prompt bound to some other key is tappable the day somebody writes it
  // rather than silently dead on a phone.
  const CAP_CODE = { SPACE: 'Space', ENTER: 'Enter', ESC: 'Escape', TAB: 'Tab' };
  const capCode = (cap) => {
    const c = String(cap == null ? 'F' : cap).trim().toUpperCase();
    if (CAP_CODE[c]) return CAP_CODE[c];
    if (/^[A-Z]$/.test(c)) return 'Key' + c;
    if (/^[0-9]$/.test(c)) return 'Digit' + c;
    return 'Key' + (c[0] || 'F');
  };
  function firePrompt() {
    if (promptEl.hidden) return null;
    const code = capCode(promptCap);
    const opt = {
      code,
      key: code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
      bubbles: true,
      cancelable: true,
    };
    promptFires++;
    promptEl.dataset.fires = String(promptFires);
    dispatchEvent(new KeyboardEvent('keydown', opt));
    dispatchEvent(new KeyboardEvent('keyup', opt));
    return code;
  }
  if (COARSE) {
    promptEl.classList.add('phud__prompt--tap');
    // The tap is taken ON THE ELEMENT and stopped there. touch.js listens on
    // `window` in the bubble phase, so stopPropagation is the whole of the
    // isolation: this finger never plants the stick, never counts as the jump
    // tap and can never be half of the double-tap reset. touch.js's reconcile()
    // only ever prunes ids it already has, so a finger it never saw cannot wedge
    // its map either — nothing in that file has to learn this exists.
    promptEl.addEventListener('touchstart', (e) => {
      e.stopPropagation(); e.preventDefault();
      promptEl.classList.add('is-press');
    }, { passive: false });
    // ONE KEY PER GESTURE, and `is-press` is the latch that makes it one. Two
    // fingers on the chip are two `touchend`s, and two KeyF's on a start circle
    // would start the race and then quit it — guide.js's F is a toggle once
    // `S.portalRace` is up, and it does not clear the line synchronously the way
    // lift.js does. The first lift takes the latch and fires; the second finds it
    // gone and does nothing. The bounds test is the rest of what a button does:
    // touchend is delivered to the node the finger STARTED on, so a finger that
    // slid off the chip before lifting still arrives here, and a press you slid
    // out of is a press you changed your mind about.
    const inBox = (t) => {
      const r = promptEl.getBoundingClientRect();
      return t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
    };
    const liftFinger = (fire) => (e) => {
      e.stopPropagation(); e.preventDefault();
      const latched = promptEl.classList.contains('is-press');
      promptEl.classList.remove('is-press');
      const t = e.changedTouches && e.changedTouches[0];
      if (fire && latched && (!t || inBox(t))) firePrompt();
    };
    promptEl.addEventListener('touchend', liftFinger(true), { passive: false });
    promptEl.addEventListener('touchcancel', liftFinger(false), { passive: false });
    // A coarse pointer is not always a touchscreen (a TV remote, a trackpad in a
    // coarse-pointer emulation), so the click path exists for those. On a real
    // phone the preventDefault above suppresses the synthetic click, so this
    // cannot double-fire.
    promptEl.addEventListener('click', (e) => { e.stopPropagation(); firePrompt(); });
  }

  // ---- rocket fuel (G, boost.js). One slim bar, and it only exists when it has
  // something to say: you are wearing the rocket, and it is burning or refilling
  // after a burn. A permanently full gauge is furniture, and a gauge for a tank
  // the gear you are wearing cannot spend is a lie.
  const fuel = el('div', 'phud__fuel');
  fuel.hidden = true;
  const fuelLbl = el('span', 'phud__fuel-lbl', 'boost');
  const fuelBar = el('span', 'phud__fuel-bar');
  const fuelFill = el('i', 'phud__fuel-fill');
  // specs/0055 §4/§5 (W7, Greg 2026-09-06) — the picked A cell's two tick marks,
  // at ⅓ and ⅔. They are SIBLINGS OF THE FILL rather than pseudo-elements on
  // the trough for one reason: they have to sit ON TOP of the fill, and a
  // ::before on the parent paints under a positioned child. They carry no
  // state and are never touched again after this line.
  fuelBar.append(fuelFill, el('i', 'phud__fuel-tick is-t1'), el('i', 'phud__fuel-tick is-t2'));
  fuel.append(fuelLbl, fuelBar);
  root.append(fuel);
  let burning = false;
  let inRocket = false;         // the rocket is the equipped gear (setFuel tells us)

  // ---- gear toast (E)
  const toast = el('div', 'phud__toast pchip');
  toast.hidden = true;
  root.append(toast);
  let toastT = 0;

  // ---- trick toast: the big one. "360!" + degrees, or the wipeout stamp.
  // specs/0055 §4.7 — ...and the wipeout's TITLE CUT. Two more children, and
  // both are `.is-wipe`-only (a landed trick shows neither): the 2 px rule the
  // stats hang off, and the row that carries the joke on the left and the
  // numbers on the right, justified to the word's own width. The subtitle stays
  // the same element with the same copy table — it moves into the row so the
  // two halves can be justified against each other.
  const trick = el('div', 'phud__trick');
  trick.hidden = true;
  const trickBig = el('div', 'phud__trick-big');
  const trickRule = el('div', 'phud__trick-rule');
  const trickRow = el('div', 'phud__trick-row');
  const trickSub = el('div', 'phud__trick-sub');
  const trickNum = el('div', 'phud__trick-n');
  trickRow.append(trickSub, trickNum);
  trick.append(trickBig, trickRule, trickRow);
  root.append(trick);
  let trickT = 0, trickWipe = false;
  let spPeak = 0;                       // §4.7 — the speed the stamp reports

  // ---- THE PUMP ARC IS GONE — specs/0055 §4/§5 (W7, Greg 2026-09-06: "remove
  // pump arc"). What used to be built here: a `.phud__pump` div under the
  // crosshair holding a `.phud__pump-arc` conic ring, plus the `pumpVal` /
  // `pumpLast` drain clock that animated the release over 0.35 s because ski.js
  // has already spent the bank by the time the release is visible.
  //
  // Nothing replaces it — not the lookbook's B alternate (§1.10's shared 2 px
  // gauge under the crosshair), not a rule, nothing. The row was cut.
  //
  // The DATA SOURCE STAYS, because other things read it: ski.js still banks
  // `pumpQ`, scores each transition into `pumpEta` and pays out on `releasing`;
  // `skiState()` still reports all three; `tricks.pumpLink(eta)` on main.js's
  // paid-transition edge still links a combo across a clean turn (§4.4's seam);
  // and `tools/rider/pump-trace.mjs` / `pump-sheet.mjs` read `pumpPhase` and
  // `pumpN` off the same state. Only the drawing left.

  // ---- THE LIVE TIMER (specs/0048 §2). Air time in seconds, two decimals,
  // hero size, gradient, ticking every frame while you are up there. Greg:
  // "spins and flips work but you can't see the live timer and combo meter."
  //
  // Upper-centre and never over the speedometer: the gauge owns a 172 px box
  // 14 px in from the TOP LEFT, this owns the middle of the screen at 12.5 %,
  // and the two cannot meet at any viewport the build gate measures.
  //
  // It does not vanish on touchdown. It FREEZES for 0.6 s on the number you
  // actually landed — which is the only moment the number is worth reading,
  // because in the air you are busy — and then fades over 0.3 s.
  //
  // specs/0057 §4.4 — ...and it is the JIB clock too. Same slot, same hero, same
  // freeze-and-fade; only the 11-px unit beside it changes, AIR to JIB. Two
  // spans rather than one node, because the number is gradient and the unit is
  // flat and `textContent` on the parent would delete the unit every frame.
  //
  // specs/0055 §4.3 — ...and it grows a METER, vertical, 16 px off the block's
  // right edge. `.phud__atime-m` is the track (the five thresholds are notched
  // into it in CSS) and its `<i>` is the fill, rising. Two custom properties
  // are all the JS writes: `--af` how full and `--aw` how thick.
  const atime = el('div', 'phud__atime');
  const atimeN = el('span', 'phud__atime-n', '0.00');
  const atimeU = el('span', 'phud__atime-u', 'AIR');
  const atimeM = el('div', 'phud__atime-m');
  const atimeF = el('i');
  atimeM.append(atimeF);
  // specs/0055 §4.3 (fidelity 2026-09-06) — THE SEAM, and it is the whole of
  // pick B's surface: no plate, one 132 × 1 px hairline under the hero. A block
  // after the two inline spans, so the hero keeps its own line box and the seam
  // is centred in the 300 px box by `margin:… auto`.
  const atimeSeam = el('div', 'phud__atime-seam');
  atime.append(atimeN, atimeU, atimeM, atimeSeam);
  atime.hidden = true;
  root.append(atime);
  let atimeHold = 0, atimeFade = 0;
  // ...and whether the clock is LIVE, which is what §4.5's slot rule turns on:
  // a receipt arriving while this is ticking takes S3 instead of S1.
  let atimeLive = false;
  let atimeAf = '', atimeAw = '';                       // write only on change

  // ---- THE COMBO METER (specs/0048 §2). One line: `×3 · CORK 720 · SKETCHY`.
  //
  // It used to be the unbanked total and the multiplier, bottom-centre. The
  // total went because a running score is a number you cannot act on — the
  // three things you CAN act on mid-line are how big the multiplier already is,
  // what you have already thrown (variety decay: repeating a name is worth a
  // quarter), and whether the last landing was clean. So the line is those
  // three and nothing else.
  //
  // STILL `.phud__combo`, and that is deliberate: the build gate force-measures
  // this exact selector against the speedometer's box, and renaming it would
  // have quietly retired the check rather than moved it.
  //
  // specs/0055 §4.4 (fidelity 2026-09-06) — ...and it is the GATE POST. The
  // three values did not change and neither did their order; what changed is
  // that they now sit on the cell's TWO SURFACES instead of one plate: the
  // multiplier on a cream tile, the names and the verdict on an ink board, the
  // two welded into `.phud__combo-line` and hung off a 2 px post.
  const combo = el('div', 'phud__combo');
  combo.hidden = true;
  const comboPost = el('div', 'phud__combo-post');
  const comboLine = el('div', 'phud__combo-line');
  const comboTile = el('span', 'phud__combo-tile');
  const comboBoard = el('span', 'phud__combo-board');
  const comboMult = el('span', 'phud__combo-mult', '×1');
  const comboSep = el('span', 'phud__combo-sep', '·');
  const comboN = el('span', 'phud__combo-n', '');       // the trick names
  const comboSep2 = el('span', 'phud__combo-sep', '·');
  const comboQ = el('span', 'phud__combo-q', '');       // clean / sketchy
  comboTile.append(comboMult);
  comboBoard.append(comboSep, comboN, comboSep2, comboQ);
  comboLine.append(comboTile, comboBoard);
  // the grace countdown: `comboGraceT` draining full → empty, 2 px, under the
  // line. It is the whole of the "you have 2 s to link" read, and it is a bar
  // rather than a number because you are supposed to glance at it.
  const grace = el('div', 'phud__grace');
  const graceFill = el('i');
  grace.append(graceFill);
  // specs/0055 §4.6 — THE MARKS, between the ledger and the gauge: one severity
  // mark per landed trick, left to right, capped at 8. §1.8's alphabet, so a
  // black diamond on this row and a black diamond on a trail blade mean the
  // same thing about the same kind of fact.
  const marks = el('div', 'phud__marks');
  const marksMore = el('span', 'phud__marks-more', '');
  // specs/0055 §4.4 + §4.6 (fidelity 2026-09-06) — post, gate, MOUNTING RULE,
  // marks. The grace gauge moved up against the board because in the picked
  // cell it IS the board's mounting rule; the marks row keeps §4.6's place
  // "under the ledger" and is now under the whole gate.
  combo.append(comboPost, comboLine, grace, marks);
  root.append(combo);
  let marksKey = '';                                    // write only on change

  // specs/0055 §4.6 — QUANTITY IS THE COUNT OF MARKS, one per `c.tricks` entry,
  // left to right, CAPPED AT 8 (`tricks.js:278` already slices to 8 for the
  // record); past 8 the row reads `8 marks + ×N`. The multiplier is never
  // re-encoded here — it stays the 28 px gradient numeral on the ledger.
  //
  // Rebuilt only when the line changed, because this runs inside the same
  // once-a-frame `combo()` call the rest of the meter does.
  function paintMarks(names, quality, bailed) {
    const key = names.length + '|' + (quality || '') + '|' + (bailed ? 'x' : '') + '|' + names.join(',');
    if (key === marksKey) return;
    marksKey = key;
    marks.textContent = '';
    const list = names.slice(0, 8);
    list.forEach((n, i) => {
      // specs/0066 §7 — the class is the NAME's own count; the family-novelty
      // bookkeeping this row used to keep is gone with the rule that read it.
      const m = markEl(markClass(n));
      // the LAST landing is the one `quality` describes (tricks.js sends one
      // verdict for the line, not one per trick), so it is the one that can be
      // hollow — same shape, outline only, in `sketchy`.
      if (quality === 'sketchy' && i === list.length - 1) m.classList.add('is-hollow');
      marks.append(m);
    });
    // specs/0055 §4.6 (fidelity 2026-09-06) — NO RED X ON THIS ROW. Neither the
    // A nor the B cell of the combo panel draws one, the row is gone by the
    // frame the combo dies, and the bail's own picked mark is the receipt's
    // double diamond. `bailed` is kept in the key so a state that ever reaches
    // here still repaints; the mark itself is not appended.
    if (names.length > 8) {
      txt(marksMore, '+ ×' + (names.length - 8));
      marks.append(marksMore);
    }
    marks.classList.toggle('is-hidden', !marks.childElementCount);
  }
  let comboLast = -1;                                   // trick count, for the pop

  // ---- THE RECEIPT (specs/0048 §2). The score in gradient hero for 1.2 s,
  // `PB` flat beside it when it is one, then out. A bail shows the multiplier
  // crossed out in flat red-purple for 0.8 s instead: what a bail costs you is
  // the multiplier, and a struck-through number says that in one glyph.
  //
  // This replaced a four-line panel (cap / total / trick list / degrees) that
  // was on screen for 2.4 s. Every line of it was true and none of it was
  // readable at the moment it appeared, which is the end of a run you were
  // concentrating on. The score is the receipt; the list is what the secret
  // board (L L) is for.
  const cend = el('div', 'phud__cend');
  cend.hidden = true;
  const cendRow = el('div', 'phud__cend-row');
  const cendScore = el('span', 'phud__cend-score', '0');
  const cendMult = el('span', 'phud__cend-mult', '×1');
  const cendPb = el('span', 'phud__cend-pb', 'PB');
  // specs/0055 §4.4 + §4.6 (fidelity 2026-09-06) — THE MARK BESIDE THE STRUCK
  // MULTIPLIER IS THE DOUBLE DIAMOND, in the bail's own #ff5c8a: the picked
  // cell's mark is "the big trick you lost", not a red X. §1.8's shape, this
  // panel's colour and the cell's 34 × 17.
  const cendDia = el('span', 'pmark pmark--double phud__cend-dia');
  // ...and the provenance line (cell B): multiplier · best trick · the run.
  const cendHair = el('div', 'phud__cend-hair');
  const cendProv = el('div', 'phud__cend-prov', '');
  cendRow.append(cendDia, cendScore, cendMult, cendPb);
  cend.append(cendRow, cendHair, cendProv);
  root.append(cend);
  let cendT = 0;

  // ---- leaderboard breadcrumb (§4.3). One dim dot, and only once there is
  // something behind it. The board is not in the pause panel on purpose; this
  // dot is the whole of its discoverability, so its title carries the shortcut.
  const bdot = el('div', 'phud__bdot');
  bdot.hidden = true;
  bdot.title = 'L L';
  root.append(bdot);

  // ---- gear menu (hold E). Same panel language as pause; keyboard-first so it
  // works pointer-locked: W/S or ↑↓ move, ENTER equips, 1/2/3 equip directly,
  // E or ESC closes. main.js routes key input here while it is open.
  const gmenu = el('div', 'pgearmenu');
  gmenu.hidden = true;
  const gpanel = el('section', 'panel pgearmenu__panel');
  const ghd = el('div', 'panel__hd');
  ghd.append(el('span', 'lbl lbl--accent', 'gear'), el('span', 'spacer'), el('span', 'lbl', 'e / esc close'));
  const gbd = el('div', 'panel__bd pgearmenu__bd');
  gpanel.append(ghd, gbd);
  gmenu.append(gpanel);
  root.append(gmenu);
  let gRows = [], gSel = 0, gOnPick = null;

  function gearRender() {
    gRows.forEach((r, i) => r.el.classList.toggle('is-sel', i === gSel));
  }
  function gearClose() { gmenu.hidden = true; gOnPick = null; }
  function gearPick(i) {
    const r = gRows[i];
    if (!r || r.disabled) return;
    const cb = gOnPick;
    gearClose();
    if (cb) cb(r.gear);
  }

  const hudApiGear = {
    // { current, def, gears: ['boots','skis','bike',...], onPick(gear) }
    openGear({ current, def, gears, onPick }) {
      gbd.textContent = '';
      gRows = (gears || ['boots', 'skis']).map((gear, i) => {
        const row = el('div', 'pgearmenu__row');
        row.append(
          el('span', 'cap', String(i + 1)),
          el('span', 'name', gear),
          el('span', 'tag', gear === current ? 'equipped' : (gear === def ? 'default' : '')),
        );
        row.addEventListener('click', (e) => { e.stopPropagation(); gearPick(gRows.findIndex((r) => r.el === row)); });
        gbd.append(row);
        return { el: row, gear, disabled: false };
      });
      gSel = Math.max(0, gRows.findIndex((r) => r.gear === current));
      gOnPick = onPick;
      gmenu.hidden = false;
      gearRender();
    },
    closeGear: gearClose,
    gearOpen() { return !gmenu.hidden; },
    // returns true when the key was consumed by the menu
    gearKey(code) {
      if (gmenu.hidden) return false;
      if (code === 'KeyW' || code === 'ArrowUp') { gSel = (gSel + gRows.length - 1) % gRows.length; gearRender(); return true; }
      if (code === 'KeyS' || code === 'ArrowDown') { gSel = (gSel + 1) % gRows.length; gearRender(); return true; }
      if (code === 'Enter' || code === 'Space') { gearPick(gSel); return true; }
      if (code === 'Escape' || code === 'KeyE') { gearClose(); return true; }
      const num = /^(?:Digit|Numpad)([1-9])$/.exec(code);
      if (num) { gearPick(Number(num[1]) - 1); return true; }
      return true;   // anything else is swallowed while the menu is up
    },
  };

  // ---- reference bundle viewer (keyboard-driven so it works pointer-locked:
  //      B toggles, [ ] cycle through aerials + photos of this poi)
  //
  // specs/0003 — `debugHud`, and this one is not cosmetic. It fetches
  // `/api/poi/<poi>` from the BENCH SERVER. On a static host that route does not
  // exist, so building it there was a 404 on every single boot and then a "no
  // reference bundle" caption: a hidden feature that visibly fails is not
  // hidden. The whole thing — panel, fetch and key handler — now only exists
  // where the API it depends on does.
  if (DEBUG_HUD) {
    const ref = el('div', 'phud__ref pchip');
    ref.hidden = true;
    const refImg = el('img', 'phud__ref-img');
    refImg.alt = '';
    // specs/0055 §5.5, W5 hand-off 1 — REFERENCE **A**. The empty state is a
    // REFUSAL and not an error — there is simply no bundle for this poi — so it
    // takes §1.8's red X, the system's one "closed / nothing here" mark, and no
    // colour of its own. The words are unchanged; `is-empty` shows the mark.
    const refCap = el('div', 'phud__ref-cap');
    const refX = el('span', 'pmark pmark--x');
    refCap.append(refX);
    const refTxt = el('span', null, '');
    refCap.append(refTxt);
    ref.append(refImg, refCap);
    root.append(ref);
    labNodes.push(ref);
    let refItems = [], refIdx = 0;
    fetch('/api/poi/' + encodeURIComponent(poi))
      .then((r) => r.json())
      .then((p) => { refItems = [...(p.aerials || []), ...(p.photos || [])]; })
      .catch(() => {});
    const refShow = () => {
      if (!refItems.length) {
        ref.classList.add('is-empty');
        refTxt.textContent = 'no reference bundle';
        return;
      }
      ref.classList.remove('is-empty');
      refIdx = (refIdx + refItems.length) % refItems.length;
      const it = refItems[refIdx];
      refImg.src = it.url.replace('/files/', '/thumb/') + '?w=900';
      // specs/0057 §4.4 (B, Greg 2026-09-06) — N closes it, not B: B is the grab.
      refTxt.textContent = it.name.replace(/\.(jpe?g|png|webp)$/i, '') + ' · ' + (refIdx + 1) + '/' + refItems.length + ' · [ ] cycle · N close';
    };
    const typing = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    addEventListener('keydown', (e) => {
      if (!gmenu.hidden) return;                    // gear menu owns the keyboard
      if (typing(e.target)) return;                 // the dev note field
      if (document.body.classList.contains('is-dev')) return;   // dev.js owns [ ]
      // specs/0055 §5.3 (Greg 2026-09-06: hide poi-lab UI) — OFF MEANS OFF. N is
      // a lab key for a lab panel; with the switch down it does nothing at all,
      // and `labNodes` below has already closed the panel if it was open.
      if (!labUI()) return;
      // specs/0057 §4.4 (B, Greg 2026-09-06) — THE REFS VIEWER MOVED OFF B, which
      // is the grab key now (main.js KEYMAP → `keys.grab`). N took it because no
      // shipped row and no lab row used N: the full map is W A S D · SPACE ·
      // ← → ↑ ↓ · SHIFT · MOUSE · B · C · R · E · F · I · M · ESC shipped, and
      // G · H · J · L · P · Q · T · V · X · Z · [ ] · F8 in the lab. Nothing
      // else in this handler changes — [ ] still cycle, and they still only do
      // so while the panel is open.
      if (e.code === 'KeyN') { ref.hidden = !ref.hidden; if (!ref.hidden) refShow(); }
      else if (!ref.hidden && e.code === 'BracketRight') { refIdx++; refShow(); }
      else if (!ref.hidden && e.code === 'BracketLeft') { refIdx--; refShow(); }
    });
  }

  // ---- crosshair
  const cross = el('div', 'phud__cross');
  root.append(cross);

  // ---- pause
  const pause = el('div', 'ppause');
  pause.hidden = true;
  const panel = el('section', 'panel ppause__panel');
  const hd = el('div', 'panel__hd');
  // specs/0003 — `brand`. The bench names the run it is playing; the shareable
  // build names itself, because "palisades-front-A-merge-01" is an internal
  // identity string (D9) and nobody outside this repo can read it.
  hd.append(el('span', 'lbl lbl--accent', 'paused'), el('span', 'spacer'), el('span', 'lbl', pickBrand({ lab: run || '', 'RED DOG': 'red dog chair', SIBERIA: 'siberia express' })));
  const bd = el('div', 'panel__bd ppause__bd');
  const keys = el('div', 'ppause__keys');
  // 'lift' rows only exist for worlds that declare lifts[] — setLiftKey() below
  let liftCap = null, liftWhat = null;
  // specs/0061 §2 — and the same trick for F's OTHER meaning. Hidden until a
  // trail is equipped, because a row about unequipping something you have not
  // equipped is a row about nothing. setTrailKey() below.
  let trailCap = null, trailWhat = null;
  // THE PANEL LEADS WITH FIVE ROWS AND THEY ARE THE SAME FIVE, IN THE SAME
  // ORDER, as the intro controls card (intro.js). Two lists that differ by one
  // row is a worse outcome than either list on its own.
  //
  // ESC leads, and it is listed as SETTINGS rather than 'release cursor' or
  // 'pause': this panel IS the settings screen — it is the only screen the game
  // has — so the row names the destination, not the mechanism. It is also the
  // one row that is true of the panel you are reading it on.
  //
  // What is deliberately NOT in the five and why:
  //   SPACE / S / A D / W       still work, and a skier finds them in about four
  //                             seconds without being told
  //   SHIFT                     does nothing on skis in this build at all
  //   F  ride the chairlift     the contextual prompt under the crosshair at the
  //                             terminal says this at the moment it is true,
  //                             which beats a line in a panel nobody reopens
  //   E / I / G / N / [ ] / F8  hidden features stay undocumented (D34)
  //
  // ...and B LEFT that list on 2026-09-06. specs/0057 §4.4 ("Can you make b the
  // trick key instead of space") made it the grab, and a key you have to press
  // to throw a NOSE is not a hidden feature — it is the one key on the mountain
  // nobody would ever find by trying. So B is a SHIPPED row below, on both
  // lists, and the lab's reference viewer took N in its place.
  //
  // specs/0055 §5.1 — PAUSE **B**, "two columns GROUPED BY GEAR, severity marks
  // as group headers". The board, the columns and the hairlines are W4's
  // (play.css); the GROUPING is data and data lives here, which is why W4's D1
  // handed this one hunk over. Each row grew a third field — the group it
  // belongs to — and NOT ONE `cap` OR `what` STRING CHANGED: the copy is the
  // copy, the grouping is a new column beside it. `only` moved to fourth.
  //
  // The marks are §1.8's alphabet doing the job it does on the mountain: how
  // much you are taking on. Every run's five are a green circle; skis and the
  // bike are blue squares; the air and the wing are black diamonds; the rocket
  // pack is a double; and the lab's own keys take the red X, the mark the rest
  // of this spec spends on "closed / not shipping".
  const KEY_GROUPS = [
    ['core', 'every run', 'green'],
    ['foot', 'on foot', 'green'],
    ['ski', 'on skis', 'blue'],
    ['bike', 'on the bike', 'blue'],
    ['air', 'in the air', 'black'],
    ['glide', 'on the glider', 'black'],
    ['rocket', 'on the rocket pack', 'double'],
    ['lab', 'lab only', 'x'],
  ];
  const FIVE_ROWS = [
    ['ESC', 'settings', 'core'],
    ['W A S D', 'move', 'core'],
    ['← →', 'tricks in the air', 'core'],
    ['C', 'camera', 'core'],
    ['R', 'reset', 'core'],
  ];
  // specs/0003 — `debugHud`. The LAB keeps the full reference underneath the
  // five, because the lab is the superset: it has the bike, the glider and the
  // rocket pack on the gear menu, and a world builder who cannot look up the
  // glider's flare key has to go and read glider.js. The shareable build ships
  // the five and nothing else.
  const LAB_ROWS = [
    ['SHIFT', 'sprint', 'foot'], ['SPACE', 'jump', 'foot'], ['MOUSE', 'look', 'foot'],
    ['E', 'gear · tap toggles, hold for menu', 'foot'],
    ['I', 'inventory · the ski rack, and every other gear type', 'foot'],
    ['SPACE', 'hold to thrust · on the rocket pack — 6 s of fuel, refills itself at 1×', 'rocket'],
    ['F', 'ride the chairlift · at a base terminal', 'foot', 'lift'],
    ['A D', 'carve · on skis', 'ski'],
    // S and W are one signed push along the ski axis (§2.1): whichever one
    // opposes the way you are actually travelling is the brake, so the same key
    // is "stop" going forward and "go" going backward.
    //
    // There is NO SHIFT ROW FOR SKIS, on purpose: SHIFT does nothing on skis at
    // all now — not a brake, not a tuck — and a key listed here that does
    // nothing when you press it is worse than no line.
    ['S', 'stop · on skis; moving backward it drives instead', 'ski'],
    ['W', 'skate · on skis; moving backward it stops you', 'ski'],
    ['W S', 'pedal / pump · on bike', 'bike'], ['SHIFT', 'brake · on bike', 'bike'],
    ['SPACE', 'hold to preload, release on a lip to pop · on bike', 'bike'],
    ['MOUSE', 'aim where to fly — the wing banks and carves round to it · on glider', 'glide'],
    ['W S', 'nose down / nose up · on glider', 'glide'],
    ['SPACE', 'hold to flare — bleed speed for a clean landing · on glider', 'glide'],
    ['MOUSE', 'aim the motor — thrust goes exactly where you look · on the rocket pack', 'rocket'],
    ['SPACE', 'let go and you are a falling body; burn back down the way you came to land · on the rocket pack', 'rocket'],
    // the arrows are the two trick axes now (§3.1). specs/0065 — ↑ ↓ are no
    // longer W and S on the snow: they aim the view there, which the shipped
    // LOOK_ROWS row below says, so this one is air-only and says only that.
    ['← →', 'spin / flip · in the air', 'air'],
    ['↑ ↓', 'spin / flip · in the air', 'air'],
    // specs/0057 §4.4 (B, Greg 2026-09-06) — the shipped tier says "B · grab"
    // and stops; the lab is the superset, so it gets §5.1's whole table and the
    // release rule the shipped row cannot fit. B alone is the safety.
    ['B + W A S D', 'grab · nose / tail / mute / indy — W+S or A+D is a truck driver', 'air'],
    ['B', 'let go before you land — still held at touchdown is a wipeout', 'air'],
    ['← →', 'barrel roll · flying', 'glide'],
    // (no second C or R row: the five above already carry them)
    // specs/0057 §4.4 (B, Greg 2026-09-06) — refs moved B → N. B is the grab.
    ['N', 'reference photos', 'lab'], ['[ ]', 'cycle refs', 'lab'],
    ['F8', 'dev fly mode · noclip + reference compare', 'lab'],
  ];
  // specs/0061 §2 — THE F PRECEDENCE, and it is in BOTH tiers because equipping
  // a trail is a shipped feature and F's two meanings have to be readable in the
  // shipped panel. It is appended rather than written into FIVE_ROWS so that
  // list stays literally the five the intro card carries; it renders only while
  // `setTrailKey(true)` (the `lift` row's own precedent, four lines up).
  const TRAIL_ROWS = [
    ['F', 'clear the trail · away from a lift terminal; at one, F still boards', 'core', 'trail'],
    ['M', 'trail map', 'core'],   // specs/0061 (M opens the map, 2026-09-06) — no 4th field: always shown
  ];
  // ONE CODE PATH, BOTH TIERS (§5.1). The shipped tier is FIVE_ROWS, all of
  // which are group `core`, so it emits ONE group and the board renders as one
  // column exactly as it does today; the lab tier emits eight and W4's sheet
  // flows them into two. A group with no rows is never built, so `lift`'s world
  // check cannot leave an empty header behind, and the row order inside a group
  // is the order it is written above.
  // specs/0065 -- ONE MORE SHIPPED ROW, on TRAIL_ROWS' own mechanism: a separate
  // const spread into `allRows` rather than a sixth entry in FIVE_ROWS, so that
  // list stays literally the five. `core`, no 4th field: the arrows are on every
  // run. The `<- ->` row above stays -- it is the AIR half of the same two keys'
  // story, and this is the ground half.
  const LOOK_ROWS = [
    ['↑ ↓', 'look', 'core'],
  ];
  // specs/0057 §4.4 (B, Greg 2026-09-06) — AND ONE MORE, on LOOK_ROWS' own
  // mechanism and for LOOK_ROWS' own reason. B is a shipped key now: it is the
  // grab, and unlike SPACE (which a skier finds in four seconds) there is
  // nothing about B that announces itself. `core`, no 4th field — the grab is
  // on skis and skis are what this build ships you on. It sits after ↑ ↓ and
  // before M, which is where "newest, appended" has put every row since M.
  const GRAB_ROWS = [
    ['B', 'grab', 'core'],
  ];
  const allRows = DEBUG_HUD
    ? [...FIVE_ROWS, ...LAB_ROWS, ...LOOK_ROWS, ...GRAB_ROWS, ...TRAIL_ROWS]
    : [...FIVE_ROWS, ...LOOK_ROWS, ...GRAB_ROWS, ...TRAIL_ROWS];   // specs/0061 -- the conditional F row
  // specs/0055 5.3 -- FIVE_ROWS are all `core`, so every OTHER group this loop
  // emits is a LAB_ROWS group and nothing else. Collected rather than
  // recomputed: with the switch down the panel shows the shipped five, in one
  // column, which is the shipped panel exactly. (TRAIL_ROWS are `core` too.)
  const labGrps = [];
  for (const [gid, gname, gmark] of KEY_GROUPS) {
    const mine = allRows.filter((r) => r[2] === gid);
    if (!mine.length) continue;
    const grp = el('div', 'ppause__grp');
    if (gid !== 'core') labGrps.push(grp);
    const ghd2 = el('div', 'ppause__grp-hd');
    ghd2.append(el('span', 'pmark pmark--' + gmark), el('span', null, gname));
    const grows = el('div', 'ppause__grp-rows');
    for (const [cap, what, , only] of mine) {
      const c = el('div', 'cap', cap), w = el('div', 'what', what);
      if (only === 'lift') { c.classList.add('is-hidden'); w.classList.add('is-hidden'); liftCap = c; liftWhat = w; }
      // specs/0061 §2 — the same hidden-until-true row, for the trail
      if (only === 'trail') { c.classList.add('is-hidden'); w.classList.add('is-hidden'); trailCap = c; trailWhat = w; }
      grows.append(c, w);
    }
    grp.append(ghd2, grows);
    keys.append(grp);
  }
  // §5.1's "two columns" is a property of the LAB tier, which emits eight
  // groups; the shipped tier emits one and must not reserve a second column it
  // has nothing to put in. Read off what was actually built — no row count, no
  // flag, no second code path.
  if (keys.childElementCount > 1) keys.classList.add('is-cols');   // re-read live in paintInstruments (5.3)
  // specs/0055 §5.1 (any key, Greg 2026-09-06) — THE PLATE NAMES THE GESTURE THE
  // DEVICE ACTUALLY HAS. "click to resume" was a lie on two devices at once: on
  // a desktop the whole keyboard resumes now, and on a phone there is no click
  // to make. One media query decides which of the two sentences is true, and it
  // is read LIVE (a `change` listener) rather than latched at build time, so a
  // tablet that gains a mouse relabels itself instead of shipping the wrong
  // word until reload. Only the words change: the plate is the same ink plate
  // W1b's #k-pause-menu cell draws, at the same width.
  const coarse = (() => {
    try { return matchMedia('(pointer: coarse)'); } catch { return { matches: false, addEventListener() {} }; }
  })();
  const resumeWords = () => (coarse.matches ? 'touch to resume' : 'any key to resume');
  const resume = el('button', 'btn btn--accent ppause__big', resumeWords());
  resume.type = 'button';
  try { coarse.addEventListener('change', () => { resume.textContent = resumeWords(); }); } catch { /* older Safari */ }
  // The RESPAWN button and the RETURN TO BENCH link are the lab's (`debugHud`):
  // there is no bench to return to from a standalone build, and the panel there
  // already says "R  reset", so a button duplicating a listed key is one more
  // thing on a screen that is supposed to have five things on it. Both objects
  // still EXIST in every build, because `onRespawn` is part of this function's
  // contract with main.js; they are simply not appended.
  const back = el('a', 'btn btn--ghost', 'return to bench');
  back.href = '/#/run/' + encodeURIComponent(poi) + '/' + encodeURIComponent(run);
  const resp = el('button', 'btn btn--ghost', 'respawn');
  resp.type = 'button';
  const rowA = el('div', 'ppause__row'); rowA.append(resume);
  const rowB = el('div', 'ppause__row');
  if (DEBUG_HUD) rowB.append(back, resp, el('span', 'lbl', 'adapter · ' + adapter));
  // D6 — ODbL attribution travels with the artifact, not only with the repo.
  // One line on the intro card, one here. Unconditional: attribution is never
  // the wrong thing to be showing, and every world this player has ever loaded
  // is USGS 3DEP terrain with OpenStreetMap trails on it.
  const credit = el('div', 'ppause__credit', 'terrain USGS 3DEP · trails © OpenStreetMap contributors (ODbL)');
  bd.append(keys, rowA, rowB, credit);
  panel.append(hd, bd);
  pause.append(panel);
  root.append(pause);

  // ---- personal leaderboard (§4.3). Same panel language as pause and the gear
  // menu, and deliberately absent from the pause panel's key list — double-tap
  // L is the whole secret. main.js owns the keyboard for it; this is the panel.
  const board = el('div', 'pboard');
  board.hidden = true;
  const bpanel = el('section', 'panel pboard__panel');
  const bhd = el('div', 'panel__hd');
  bhd.append(el('span', 'lbl lbl--accent', 'personal best'), el('span', 'spacer'), el('span', 'lbl', 'l l · esc close'));
  const bbd = el('div', 'panel__bd pboard__bd');
  bpanel.append(bhd, bbd);
  board.append(bpanel);
  root.append(board);

  const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
  const boardCols = ['rk', 'sc', 'mu', 'bt', 'sk', 'tr', 'wh'];
  function boardRow(cls, cells) {
    const r = el('div', 'pboard__row' + (cls ? ' ' + cls : ''));
    cells.forEach((c, i) => r.append(el('span', boardCols[i], c)));
    return r;
  }
  function boardRender(list) {
    bbd.textContent = '';
    bbd.append(boardRow('pboard__row--hd', ['#', 'score', 'mult', 'best trick', 'ski', 'trail', 'when']));
    if (!list.length) { bbd.append(el('div', 'pboard__empty', 'no runs banked yet · land a combo')); return; }
    for (const r of list) {
      bbd.append(boardRow(r && r.you ? 'is-you' : '', [
        String(r.rank != null ? r.rank : '—'),
        num(r.score),
        '×' + (r.mult != null ? r.mult : 1),
        r.best || '—',
        r.ski || '—',
        r.trail || '—',            // a run with no trail is a run on the open hill
        r.when || '—',
      ]));
    }
  }
  function boardClose() { board.hidden = true; }
  board.style.pointerEvents = 'auto';
  board.addEventListener('click', (e) => { e.stopPropagation(); boardClose(); });

  pause.style.pointerEvents = 'auto';
  resume.addEventListener('click', (e) => { e.stopPropagation(); onResume && onResume(); });
  resp.addEventListener('click', (e) => { e.stopPropagation(); onRespawn && onRespawn(); });
  pause.addEventListener('click', () => onResume && onResume());
  // specs/0055 §5.1 (any key, Greg 2026-09-06) — AND TOUCH RESUMES ON THE FIRST
  // CONTACT, not on the click a phone only synthesises ~300 ms later after it has
  // finished deciding the tap was not a scroll. `click` above still fires and
  // still resumes; onResume() is enter(), which is idempotent, so the double
  // call costs nothing. Gated on `coarse.matches` AT FIRE TIME rather than at
  // registration: a desktop must keep resuming on the click it always did, and a
  // mouse `pointerdown` that resumed here would beat the RESPAWN and RETURN TO
  // BENCH buttons to their own clicks.
  const touchResume = (e) => {
    if (!coarse.matches) return;
    e.stopPropagation();
    onResume && onResume();
  };
  pause.addEventListener('pointerdown', touchResume);
  pause.addEventListener('touchstart', touchResume, { passive: true });

  document.body.appendChild(root);

  let fpsAcc = 0, fpsN = 0, fpsLast = performance.now();
  const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(1);

  // Instruments go dark behind the pause panel — one thing to read at a time —
  // and the player's own readout steps aside for the dev readout, which sits in
  // the same corner. Both switches land here so neither can undo the other.
  let devOn = false;
  function paintInstruments() {
    const paused = !pause.hidden;
    // specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI). `lab` is read HERE,
    // every paint, instead of DEBUG_HUD being read once at build time. Anything
    // that carries its own `hidden` (the reference viewer, the lip box) is also
    // CLOSED on the way down, so the switch cannot leave an open lab panel
    // behind an is-hidden that a later toggle would take off again.
    const lab = labUI();
    for (const n of labNodes) { n.classList.toggle('is-hidden', !lab); if (!lab) n.hidden = true; }
    for (const n of [fps, legend, toast, trick, promptEl, fuel, atime, combo, cend, bdot]) n.classList.toggle('is-hidden', paused);
    cross.classList.toggle('is-hidden', paused || devOn);
    read.classList.toggle('is-hidden', paused || devOn || !lab);
    keyEls.refs.classList.toggle('is-hidden', !lab);
    keyEls.dev.classList.toggle('is-hidden', !lab);
    for (const g of labGrps) g.hidden = !lab;
    keys.classList.toggle('is-cols', lab && keys.childElementCount > 1);
    rowB.classList.toggle('is-hidden', !lab);
    if (devRead) { devRead.classList.toggle('is-hidden', paused || !lab); devRead.hidden = !devOn || !lab; }
  }
  // ONE EVENT, from flags.js's setLabUI(). The locker writes the knob, flags.js
  // fires this, and the whole register appears or disappears on the next paint
  // -- no reload, and no per-panel subscription.
  addEventListener('play:labui', paintInstruments);
  // ...and once now, because the switch is PERSISTED: a page that boots with the
  // knob already down must not paint the register for one frame first.
  paintInstruments();

  return {
    root, pause,
    setPaused(on) {
      pause.hidden = !on;
      if (on) { gearClose(); boardClose(); }     // one modal at a time
      paintInstruments();
    },
    isPaused() { return !pause.hidden; },
    // ---- dev readout, driven by dev.js
    setDev(on) {
      devOn = !!on;
      keyEls.dev.classList.toggle('is-on', devOn);
      paintInstruments();
    },
    devTick(f) {
      // A build with no dev panel can still be handed a tick — nothing drives
      // one there today, but a no-op is the right answer either way.
      if (!devRead) return;
      for (const k of Object.keys(devRows)) if (f[k] != null) devRows[k].textContent = f[k];
      if (f.params != null) devParams.textContent = f.params;
      if (f.url != null) devFull = f.url;
    },
    // ---- LIP / COMPRESSION METER (lab only). main.js calls this every frame
    // while the skis are on, with the ski's live state, its tuning and the
    // one-shot takeoff record. Outside DEBUG_HUD `lipEls` is null and this
    // returns immediately, so the call site needs no branch of its own.
    //
    // Nothing here rounds in the physics' favour. `ramp x K` is printed with its
    // sign because the sign IS the diagnosis: on a descending surface it is
    // negative, and a charge that only exists because that negative was being
    // clamped away is the bug this meter was built to make visible.
    lipMeter(f) {
      if (!lipEls) return;
      const on = !!f && !!f.on && labUI();   // specs/0055 5.3 -- the bar is a lab surface
      lipEls.box.hidden = !on;
      if (!on) return;
      const s = f.s, T = f.T, R = lipEls.rows;
      const n = (v, d = 2) => (v >= 0 ? '+' : '') + Number(v || 0).toFixed(d);
      R['surface vy'].textContent = n(s.surfVy) + ' m/s ' + (s.surfVy > 0.05 ? 'UP' : (s.surfVy < -0.05 ? 'down' : 'flat'));
      R.reference.textContent = n(s.vyFloor) + ' m/s';
      R.compression.textContent = n(s.comp) + ' m/s';
      R['ramp x K'].textContent = n(s.lipRamp);
      R['comp x K'].textContent = n(s.lipComp);
      const sum = (s.lipRamp || 0) + (s.lipComp || 0);
      // "0.00 of 6.50, and here is why" — a charge held under lipMin and a charge
      // the surface never earned are different failures and the reason is named.
      R.charge.textContent = (s.lipVy > 0 ? Number(s.lipVy).toFixed(2) : '0.00')
        + ' / ' + Number(T.lipMax).toFixed(2)
        + (s.lipVy > 0 ? '' : (sum > 0 ? '  < lipMin' : (s.lipRamp < 0 ? '  ramp negative' : '')));
      const w = (v) => Math.max(0, Math.min(100, 100 * v / (T.lipMax || 1)));
      const rw = w(Math.max(0, s.lipRamp));
      lipEls.barR.style.width = rw.toFixed(1) + '%';
      lipEls.barC.style.left = rw.toFixed(1) + '%';
      lipEls.barC.style.width = w(s.lipComp).toFixed(1) + '%';
      lipEls.barMin.style.left = w(T.lipMin).toFixed(1) + '%';
      // the pop window, as the player experiences it: how long a pop is still
      // worth something, or how long until one would be
      const sp = s.sincePop == null ? 1e9 : s.sincePop;
      let pw;
      if (!f.grounded && s.airT > 0) {
        pw = s.popPaid ? 'spent'
          : (s.lipVy > 0 && s.airT <= T.popCoyote
            ? 'COYOTE ' + (T.popCoyote - s.airT).toFixed(2) + 's left'
            : 'closed');
      } else if (s.lipVy > 0) {
        pw = sp <= T.popWindow ? 'ARMED (popped ' + sp.toFixed(2) + 's ago)' : 'at lip · pop now';
      } else pw = 'no charge';
      // the drop-away half: how hard the ground is pulling the vertical around
      // (past free fall there is nothing left to stand on) and how much of the
      // snap is letting go because of it
      const dv = s.dVyS || 0, gv = s.gravity || 16;
      R['surface accel'].textContent = n(dv, 1) + ' / -' + gv.toFixed(0)
        + (dv < -gv ? '  PAST FREE FALL' : '');
      R['snap release'].textContent = s.dropK > 0
        ? (100 * s.dropK).toFixed(0) + '%  ' + Number(s.snapFull).toFixed(2)
          + ' -> ' + Number(s.snapCut).toFixed(2) + ' m'
        : 'glued  ' + Number(s.snapFull || 0).toFixed(2) + ' m';
      R['pop window'].textContent = pw;
      // WHAT A JUMP WOULD ACTUALLY PAY, this instant. Greg's ask, and the
      // reason it comes from ski.js rather than being recomputed here: the
      // number below is the return value of the same popPay() the real jump
      // spends, so a prediction that disagrees with the landing is impossible.
      const pv = f.pop;
      R['pop now'].textContent = pv
        ? Number(pv.total).toFixed(2) + ' m/s'
          + (pv.add > 0.005 ? '  (+' + pv.add.toFixed(2) + ')' : '')
          + (pv.add <= 0.005 && pv.compRaw > 0.5 ? '  ' + pv.gate.toUpperCase() : '')
        : '—';
      R.state.textContent = (f.grounded ? 'on snow' : 'air ' + Number(s.airT).toFixed(2) + 's')
        + (s.lipVy > 0 ? ' · charged' : '');
      // the takeoff readout, latched ~2 s
      if (f.launch) {
        const L = f.launch;
        // WHICH RULE FIRED is the first thing on the line, because that is the
        // whole point of the tag: DROP-AWAY and LIP feel alike in the air and are
        // completely different bugs when one of them misbehaves.
        lipEls.shot.textContent = 'takeoff '
          + (L.total > 0.01 ? '+' + L.total.toFixed(2) + ' m/s' : 'flat')
          + '  [' + L.src.toUpperCase() + ']'
          + (L.drop
            ? '\n  DROP-AWAY  snap ' + Number(L.snapFull).toFixed(2) + ' -> '
              + Number(L.snapCut).toFixed(2) + ' m (' + (100 * L.dropK).toFixed(0) + '% let go)'
              + '\n  surface ' + n(L.dVyS, 1) + ' vs -' + L.grav.toFixed(0) + ', past free fall'
            : '')
          + (L.total > 0.01
            ? '\n  ramp ' + n(L.ramp) + '  comp ' + n(L.comp) + '  -> charge ' + L.charge.toFixed(2)
              + (L.pop > 0 ? '\n  pop bonus +' + L.pop.toFixed(2) : '')
              + (L.restored > 0 ? '  (jump restored +' + L.restored.toFixed(2) + ')' : '')
            : (L.drop ? '' : '\n  no charge (ramp ' + n(L.ramp) + ' comp ' + n(L.comp) + ')'))
          + (L.eaten ? '\n  SWALLOWED, still on the snow next frame' : '');
        lipEls.shotT = 2.0;
      } else if (lipEls.shotT > 0) {
        lipEls.shotT -= (f.dt || 0.016);
        if (lipEls.shotT <= 0) lipEls.shot.textContent = 'takeoff —';
      }
    },
    // ---- chairlifts (lift.js). setLiftKey decides whether F is even mentioned;
    // setPrompt({ key, text }) / setPrompt(null) is the contextual offer.
    setLiftKey(on) {
      hasLifts = !!on;
      keyEls.lift.classList.toggle('is-hidden', !hasLifts);
      // A panel with no F row has no liftCap/liftWhat — that is the five-row
      // panel, and main.js calls setLiftKey() the moment a lift comes into
      // range, so unguarded this is a TypeError on the first approach to a base
      // terminal, i.e. exactly where a first-time player goes. The legend chip
      // and the contextual prompt still do the work.
      if (liftCap) liftCap.classList.toggle('is-hidden', !hasLifts);
      if (liftWhat) liftWhat.classList.toggle('is-hidden', !hasLifts);
    },
    // specs/0061 §2 — the F-precedence row, on while a trail is equipped and off
    // otherwise. main.js calls it from the one place that knows: the locker's
    // equip/clear and F itself.
    setTrailKey(on) {
      if (trailCap) trailCap.classList.toggle('is-hidden', !on);
      if (trailWhat) trailWhat.classList.toggle('is-hidden', !on);
      return !!on;
    },
    setPrompt(p) {
      if (!p) {
        promptEl.hidden = true;
        promptEl.classList.remove('is-press');
        keyEls.lift.classList.remove('is-on');
        return;
      }
      promptCap = p.key || 'F';
      // On a phone the cap names the GESTURE, because there is no F to press.
      // Only the <b> changes: guide.js's readPrompt() reads the <span>, so the
      // shared-line handoff between the chair and the race is untouched.
      promptKey.textContent = COARSE ? 'TAP' : promptCap;
      // The element states, on itself, which key a tap would send and how many
      // it has sent. Deliberately NOT a `window.__player` key: the rider
      // contract (C18) owns that object's shape, and a probe can read a data
      // attribute off the DOM without anybody widening an allowlist for it.
      promptEl.dataset.key = capCode(promptCap);
      promptEl.dataset.tap = COARSE ? '1' : '0';
      promptEl.dataset.fires = String(promptFires);
      promptTxt.textContent = ' ' + (p.text || '');
      promptEl.hidden = false;
      keyEls.lift.classList.add('is-on');
    },
    promptText() { return promptEl.hidden ? null : promptTxt.textContent.trim(); },
    // ---- rocket fuel (boost.js), called every frame. frac 0..1. `worn` is
    // whether the rocket is the equipped gear: it is the only gear that can
    // spend the tank, so it is the only gear that gets a gauge.
    setFuel(frac, isBurning, isDry, worn = true) {
      const f = Math.max(0, Math.min(1, Number(frac) || 0));
      burning = !!isBurning && !!worn;
      inRocket = !!worn;
      fuel.hidden = !worn || (f > 0.999 && !burning);
      if (fuel.hidden) { keyEls.boost.classList.remove('is-on'); return; }
      fuelFill.style.width = (f * 100).toFixed(1) + '%';
      fuel.classList.toggle('is-burn', burning);
      // dry = ran the tank out; the bar stays dim until there is enough to relight
      fuel.classList.toggle('is-dry', !!isDry);
      keyEls.boost.classList.toggle('is-on', burning);
    },
    fuelShown() { return !fuel.hidden; },
    flashGear(mode) {
      toast.classList.remove('is-refusal');
      toast.textContent = 'gear · ' + mode;
      toast.hidden = false;
      toastT = 1.4;
    },
    ...hudApiGear,
    // specs/0055 §5.5, W5 hand-off 2 — THE MATCH DIALOG'S FLASH LINE. This one
    // line is everything dev.js says when it refuses: `drop a reference photo
    // first`, `snapshot failed`, `ref failed · …`. A refusal is not an error
    // and not a warning — it is the closed sign — so it takes §1.8's red X and
    // the copy stays verbatim. Detected rather than parameterised, because
    // every caller is in dev.js and none of them should have to learn a flag.
    flash(text) {
      const s = String(text == null ? '' : text);
      const refusal = /\b(first|failed|blank|empty)\b/i.test(s);
      toast.textContent = '';
      if (refusal) toast.append(el('span', 'pmark pmark--x'));
      toast.append(el('span', null, s));
      toast.classList.toggle('is-refusal', refusal);
      toast.hidden = false;
      toastT = 1.4;
    },
    // { name: '360'|'720'|'1080'|'wipeout', deg, why? } — the big centre-screen
    // stamp. `why` is the gear's own verdict: 'landing' when the gear judged the
    // arrival (the wing, the rocket), 'crossed' when the skis went sideways.
    trick(t) {
      const wipe = t.name === 'wipeout';
      // ---- specs/0055 §4.4 + §4.7 (fidelity 2026-09-06) — ONE VOICE PER EVENT
      //
      // Greg, 2026-09-06: "we still have old claudish text showing up
      // describing the trick even though banners are coming."
      //
      // A LANDED TRICK ALREADY SPEAKS TWICE in the picked register, and both
      // times are panels Greg chose: the combo gate names it while the line is
      // live (§4.4's board carries the trick names and the verdict) and the
      // receipt banks it when the line ends (§4.4's provenance line carries the
      // best trick by name). 0048's centre-screen `CORK 720! / 720°` stamp is a
      // THIRD voice for the same event, in pre-0055 copy, on no picked surface
      // — so it goes silent. The panel is not deleted: it is §4.7's wipeout
      // stamp, which IS a picked panel (cell C), and the build gate
      // force-probes `.phud__trick` against the dial.
      if (!wipe) { trick.hidden = true; trickT = 0; trickWipe = false; return; }
      trickBig.textContent = 'WIPEOUT';
      // specs/0055 §4.7 — WIPEOUT **C**, the title cut. The right-hand token is
      // the game's own numbers and nothing invented: the speed you carried in,
      // in the unit the dial now speaks (§4.2), and the rotation if there was
      // one. `spPeak` is a 0.5 s peak-hold, because by the frame the stamp
      // fires the controller has already taken the speed away.
      const kmh = Math.round(spPeak * 3.6);
      txt(trickNum, kmh + ' KM/H' + (t.deg ? ' · ' + t.deg + '°' : ''));
      // ...'tree' / 'rock' are the solids (specs/0012), and specs/0018 adds the
      // four the world built and never made solid: a lodge wall, a lift tower or
      // a sign post, somebody standing there, and the furniture. ONE subtitle,
      // and it is the only prose this event is allowed (fidelity 2026-09-06).
      trickSub.textContent = WIPE_SUB[t.why]
        || (t.deg ? t.deg + '° · unfinished' : 'skis crossed');
      trick.classList.add('is-wipe');
      trick.hidden = false;
      // specs/0055 §4.7 — ARRIVAL IS **SNAP** on a wipeout (§6's table), 90 ms
      // of `scale .96 → 1`, and 0048's 450 ms overshoot `ptrick` stays on the
      // landed-trick stamp it was built for. The beat — rule and stats RISE at
      // +0.40 s, then the word FALLs 160 ms before them — is run off `trickT`
      // in tick(), so a paused game does not eat it.
      trick.classList.remove('is-pop', 'is-snap', 'is-late', 'is-gone-word', 'is-gone-line');
      void trick.offsetWidth;               // restart the arrival animation
      trick.classList.add('is-snap');
      trickWipe = true;
      // 1.96 s: the word holds to 1.60 and falls over 160 ms, the line to 1.76
      // and falls over 160 ms — the only staggered exit in the system, and it
      // exists so the last thing on screen is the punchline.
      trickT = 1.96;
    },
    // `pump()` and `pumpShown()` are GONE — specs/0055 §4/§5 (W7, Greg
    // 2026-09-06). The arc they drove no longer exists, and main.js no longer
    // calls them; the bank itself is still ski.js's and is still read by
    // `tricks.pumpLink()` on the same frame.
    // ---- THE LIVE TIMER (specs/0048 §2). { air, t } every frame: `air` is
    // whether the rider is off the snow, `t` the air time in seconds.
    //
    // The hold/fade clocks live HERE rather than in tricks.js because they are
    // a property of the readout and not of the trick — tricks.js has no opinion
    // about how long a number stays legible after it stops changing, and giving
    // it one would put two files in charge of the same 0.9 s.
    // specs/0057 §4.4 — `{ air, t, unit }`. `unit` is 'AIR' or 'JIB' and is the
    // ONLY thing a jib adds to this readout; it defaults to AIR, so every 0048
    // caller that does not pass one gets exactly what it always got.
    airTimer(a) {
      const on = !!(a && a.air);
      if (on) {
        const t = Number(a.t) || 0;
        txt(atimeN, t.toFixed(2));
        txt(atimeU, a && a.unit === 'JIB' ? 'JIB' : 'AIR');   // specs/0057 §4.4
        // specs/0055 §4.3 — THE METER, and it is two numbers: how full, and how
        // thick. The fill is the clock against the top threshold (4.0 s, which
        // is `T_ROCKET` read as deciseconds) and the thickness is 10 px plus
        // 2 px per threshold crossed — 10 · 12 · 14 · 16 · 18. Both are written
        // as custom properties, so the meter costs no layout read and no class.
        const tier = airTier(t);
        const fill = Math.min(1, (t * 10) / TIERS[TIERS.length - 1]);
        const af = (fill * 100).toFixed(1) + '%';
        const aw = (10 + tier * 2) + 'px';
        if (af !== atimeAf) { atimeM.style.setProperty('--af', af); atimeAf = af; }
        if (aw !== atimeAw) { atimeM.style.setProperty('--aw', aw); atimeAw = aw; }
        if (atime.classList.contains('is-out')) atime.classList.remove('is-out');
        atime.hidden = false;
        atimeHold = 0.6; atimeFade = 0;
        atimeLive = true;                                     // §4.5 — S1 is busy
        return;
      }
      // ...on the ground: freeze on the landed number, then fade. `atimeHold`
      // counts down in tick(), so a paused game does not eat the freeze.
      atimeLive = false;
      if (atime.hidden) return;
      if (atimeHold <= 0 && atimeFade <= 0) { atimeFade = 0.3; atime.classList.add('is-out'); }
    },
    airTimerShown() { return !atime.hidden; },
    // ---- THE COMBO METER (specs/0048 §2).
    // { on, mult, names: ['Cork 720', ...], quality: 'clean'|'sketchy', grace,
    //   graceMax, count }.
    combo(c) {
      if (!c || !c.on) { combo.hidden = true; comboLast = -1; marksKey = ''; return; }
      txt(comboMult, '×' + (c.mult != null ? c.mult : 1));
      // THE LAST TWO NAMES AND NOT ALL OF THEM. A ten-trick line would run off
      // both edges of a 390 px phone, and the only two a player can still act
      // on are the one just landed and the one before it (variety decay keys on
      // the NAME, so "what did I just throw" is the actionable half).
      const names = Array.isArray(c.names) ? c.names.filter(Boolean) : [];
      const shown = names.slice(-2).join(' · ');
      txt(comboN, shown);
      comboN.classList.toggle('is-hidden', !shown);
      comboSep.classList.toggle('is-hidden', !shown);
      const q = c.quality === 'sketchy' ? 'SKETCHY' : (c.quality === 'clean' ? 'CLEAN' : '');
      txt(comboQ, q);
      comboQ.classList.toggle('is-hidden', !q);
      comboSep2.classList.toggle('is-hidden', !q || !shown);
      comboQ.classList.toggle('is-clean', c.quality === 'clean');
      comboQ.classList.toggle('is-sketchy', c.quality === 'sketchy');
      // specs/0055 §4.6 — the marks under the ledger, rebuilt only when the
      // line actually changed. One per trick in order, capped at 8.
      paintMarks(names, c.quality, false);
      // the grace bar: full while airborne (there is no clock running up there),
      // draining once you are back on the snow
      const gm = Number(c.graceMax) || 2;
      const left = Math.max(0, Math.min(1, 1 - (Number(c.grace) || 0) / gm));
      graceFill.style.width = (left * 100).toFixed(1) + '%';
      // each ADDED trick pops the line — the count is the edge, not the score,
      // because a pump link raises the score without landing anything
      const n = Number(c.count) || 0;
      if (n !== comboLast) {
        if (comboLast >= 0 && n > comboLast) {
          comboLine.classList.remove('is-pop');
          void comboLine.offsetWidth;         // restart it, same as the trick stamp
          comboLine.classList.add('is-pop');  // §4.4 — SNAP, 90 ms (the sheet)
        }
        comboLast = n;
      }
      combo.hidden = false;
    },
    comboShown() { return !combo.hidden; },
    // ---- THE RECEIPT (specs/0048 §2). { score, mult, tricks, best, deg, pb,
    // bailed }. Landed: the score in gradient hero, 1.2 s. Bailed: the
    // multiplier crossed out, flat red-purple, 0.8 s.
    comboEnd(c) {
      if (!c) return;
      const bail = !!c.bailed;
      const pb = !!c.pb && !bail;
      cendScore.textContent = '+' + num(c.score);
      cendScore.classList.toggle('is-hidden', bail);
      cendMult.textContent = '×' + (c.mult != null ? c.mult : 1);
      cendMult.classList.toggle('is-hidden', !bail);
      cendPb.classList.toggle('is-hidden', !pb);
      cendDia.classList.toggle('is-hidden', !bail);     // §4.6 — the trick you lost
      cend.classList.toggle('is-bail', bail);
      // specs/0055 §4.4 (fidelity 2026-09-06) — THE PROVENANCE LINE, cell B.
      // Three tokens, and every one of them is a fact the receipt already has
      // or the world already knows: the multiplier, the best trick of the line
      // (`tricks.js` sends `best`), and the run it happened on. A bail has no
      // provenance to print — the cell's bail draws none — and a missing run
      // drops its own token rather than printing a placeholder.
      const prov = bail ? '' : [
        '×' + (c.mult != null ? c.mult : 1),
        c.best ? String(c.best) : '',
        runName(),
      ].filter(Boolean).join(' · ');
      // specs/0066 §marks — and the BEST TRICK'S MARK in front of it, off the
      // same `markClass()` the ledger row uses, so a Quad Cork's triple diamond
      // and a Quint's gold death sign land on the receipt too. Built rather than
      // `txt()`-ed because the line now has an element in it; `comboEnd` runs
      // once per receipt, so there is no per-frame write to spare here.
      cendProv.textContent = '';
      if (prov && c.best) cendProv.append(markEl(markClass(String(c.best)), 'phud__cend-mark'));
      if (prov) cendProv.append(document.createTextNode(prov));
      cendHair.classList.toggle('is-hidden', !prov);
      cendProv.classList.toggle('is-hidden', !prov);
      // ---- specs/0055 §4.5 — THE SLOT RULE. "It should move to the side if a
      // new timer or something is ticking there" (D10). The receipt owns S1 —
      // the timer's own pixels — UNLESS a clock is live in there, and a clock
      // is live whenever the rider is still off the snow or still on a rail
      // (0057's seam: air and jib are the SAME clock in S1, never two). Then it
      // takes S3, 232 px to the right, and arrives RISE instead of SNAP,
      // because a panel that lands beside something you are already reading has
      // to announce itself rather than punch.
      const s3 = atimeLive && !atime.hidden;
      cend.classList.toggle('is-s3', s3);
      if (!s3) { atime.hidden = true; atimeHold = 0; atimeFade = 0; atimeLive = false; }
      cend.classList.remove('is-snap', 'is-rise');
      void cend.offsetWidth;                  // restart the arrival, either one
      cend.classList.add(s3 ? 'is-rise' : 'is-snap');
      cend.hidden = false;
      cendT = bail ? 0.8 : 1.2;
    },
    // ---- the secret board (§4.3). An array opens it, null closes it.
    board(list) {
      if (!list) { boardClose(); return; }
      boardRender(Array.isArray(list) ? list : []);
      board.hidden = false;
    },
    boardOpen() { return !board.hidden; },
    closeBoard: boardClose,
    // the breadcrumb: nothing on screen for a new player, a dot for a returning
    // one. Its title is the shortcut, so hovering it is the whole tutorial.
    setBoardDot(on) { bdot.hidden = !on; },
    tick(ctrl, dt, camMode) {
      const p = ctrl.position;
      const gear = ctrl.mode;
      const ski = gear === 'skis', bike = gear === 'bike', glide = gear === 'glider';
      const rocket = gear === 'rocket';
      const riding = gear !== 'boots';
      const sp = ctrl.speed();
      // specs/0055 §4.7 — A 0.5 s PEAK HOLD, and it is one line because the
      // wipeout stamp needs the speed you were CARRYING and the controller has
      // already taken it away by the frame the stamp fires. Rises instantly,
      // decays over half a second: on the impact frame it still reads the run.
      spPeak = sp > spPeak ? sp : Math.max(0, spPeak - spPeak * (dt / 0.5));
      rows.pos.textContent = `${fmt(p.x)} ${fmt(p.y)} ${fmt(p.z)}`;
      rows.spd.textContent = sp.toFixed(2) + ' m/s';
      rows.gear.textContent = gear;
      rows.gear.classList.toggle('is-hot', riding);
      rows.cam.textContent = camMode === 'tp' ? 'chase' : 'first person';
      if (burning) rows.state.textContent = 'BOOST';   // the rocket owns the frame
      else if (glide && !ctrl.grounded) {
        // the wing has five things worth knowing and no room for a panel: which
        // one is currently deciding your fate is the one that gets shown
        const g = gliderState();
        const vy = ctrl.velocity ? ctrl.velocity.y : 0;
        rows.state.textContent =
          g.stall > 0.35 ? 'STALL'
            : g.flare ? 'flare'
              : g.updraft > 0.8 ? 'lift +' + g.updraft.toFixed(1)
                : vy > 0.5 ? 'climb'
                  : vy < -6 ? 'dive'
                    : 'glide · ' + g.airspeed.toFixed(0);
      }
      // coasting the rocket is its own state: no wing, no steering, just the
      // sink rate you are going to have to burn off before you arrive
      else if (rocket && !ctrl.grounded) {
        const vy = ctrl.velocity ? ctrl.velocity.y : 0;
        rows.state.textContent = 'coast · ' + (vy < 0 ? '−' : '+') + Math.abs(vy).toFixed(0);
      }
      else if (!ctrl.grounded) {
        const spin = Math.abs(ctrl.airSpinDeg || 0);
        rows.state.textContent = spin > 45 ? 'air · ' + Math.round(spin) + '°' : 'air';
      }
      else if (ctrl.wipeT > 0) rows.state.textContent = 'wipeout';
      else if (ski) {
        // chatter outranks everything a ski can be doing: it is the ski telling
        // you it has run out of ski, and it is why you would ever pick a longer one
        // ...and everything under it is a detected state rather than a key:
        // S only brakes when it opposes travel (§2.1), and SHIFT is not a ski
        // key at all, so reading the keys would lie on both counts.
        const s = skiState();
        rows.state.textContent = s.chatter > 0.35 ? 'CHATTER'
          : s.stop === 2 ? 'HOCKEY'
            : s.stop === 1 ? 'plow'
              : s.stivoting ? 'stivot'
                : s.releasing ? 'PUMP'
                  : (sp > 3 ? 'carve' : 'skate');
      }
      else if (bike) rows.state.textContent = ctrl.keys.sprint ? 'brake' : (ctrl.keys.jumpHeld ? 'preload' : (ctrl.keys.back ? 'pump' : (sp > 3 ? 'ride' : 'pedal')));
      else rows.state.textContent = ctrl.keys.sprint && sp > 5 ? 'sprint' : 'ground';
      keyEls.move.classList.toggle('is-on', ctrl.keys.forward || ctrl.keys.back || ctrl.keys.left || ctrl.keys.right);
      keyEls.sprint.classList.toggle('is-on', !!ctrl.keys.sprint);
      // SHIFT is the brake on the bike and the sprint on foot — and on SKIS it
      // is nothing at all, so the chip leaves the legend entirely rather than
      // sitting there claiming a job it no longer has.
      keyEls.sprint.classList.toggle('is-hidden', ski);
      keyEls.sprint.lastChild.nodeValue = bike ? 'brake' : 'sprint';
      keyEls.jump.classList.toggle('is-on', !ctrl.grounded);
      keyEls.gear.classList.toggle('is-on', riding);
      // G is the rocket's key and nobody else's, so it is only in the legend
      // when the rocket is on your back
      keyEls.boost.classList.toggle('is-hidden', !(rocket || inRocket));
      keyEls.spin.classList.toggle('is-on', !!(ctrl.keys.spinLeft || ctrl.keys.spinRight));
      keyEls.cam.classList.toggle('is-on', camMode === 'tp');

      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.hidden = true; }
      if (trickT > 0) {
        trickT -= dt;
        // specs/0055 §4.7 — THE BEAT, on the stamp's own clock. The word cuts
        // in at 1.96 left; the rule and the stats RISE 0.40 s later (1.56
        // left); the word FALLs at 1.60 elapsed (0.36 left) and the line 160 ms
        // after it (0.20 left), so the joke is the last thing on screen.
        if (trickWipe) {
          if (trickT <= 1.56) trick.classList.add('is-late');
          if (trickT <= 0.36) trick.classList.add('is-gone-word');
          if (trickT <= 0.20) trick.classList.add('is-gone-line');
        }
        if (trickT <= 0) { trick.hidden = true; trickWipe = false; }
      }
      if (cendT > 0) { cendT -= dt; if (cendT <= 0) cend.hidden = true; }
      // specs/0048 — the timer's landing: 0.6 s frozen on the final number,
      // then 0.3 s of fade. Two clocks and not one, because the freeze is the
      // half that has to be legible and the fade is the half that must not be.
      if (!atime.hidden && atimeHold > 0) {
        atimeHold -= dt;
        if (atimeHold <= 0) { atimeHold = 0; atimeFade = 0.3; atime.classList.add('is-out'); }
      } else if (!atime.hidden && atimeFade > 0) {
        atimeFade -= dt;
        if (atimeFade <= 0) { atimeFade = 0; atime.hidden = true; atime.classList.remove('is-out'); }
      }
      fpsAcc += dt; fpsN++;
      const now = performance.now();
      if (now - fpsLast > 400) {
        fpsVal.textContent = fpsAcc > 0 ? String(Math.round(fpsN / fpsAcc)) : '—';
        fpsAcc = 0; fpsN = 0; fpsLast = now;
      }
    },
  };
}
