import{gliderState as ea}from"./glider.js";import{skiState as ta}from"./ski.js";import{DEBUG_HUD as W,labUI as ze,BRAND as aa,pick as ia,pickBrand as na}from"./flags.js";const Ke={family:'"Avenir Next", Avenir, "Nunito Sans", "Segoe UI", system-ui, sans-serif',weight:500,obliqueDeg:12,track:.06,hero:68,heroDial:64,heroSmall:28,secondary:13.5,unit:11,gradFrom:"#7b3fe4",gradTo:"#3b6cff",flat:"rgba(42,36,86,0.90)",dim:"rgba(42,36,86,0.35)",clean:"rgba(42,36,86,0.90)",sketchy:"#c77a1a",bailed:"#ff5c8a"};function ka(p,n=Ke.weight){return n+" "+p+"px "+Ke.family}const oa={cream:"#f4f1ea",ink:"#171614",sub:"#726c60",seam:"#c8c2b3",plate:"rgba(23,22,20,0.34)",hair:"rgba(244,241,234,0.16)",hazard:"#ff4d00",rule:"2px",radius:"2px"},sa={run:"#f4f1ea",lift:"#ff4d00",bike:"#8ec63f",landmark:"#7fd4e8",venue:"#ffab00"},ra={green:"#217a3c",blue:"#1d5fb4",black:"#141414",red:"#ff5c8a"},da={rise:"220ms",riseEase:"cubic-bezier(.16,1,.3,1)",wipeRule:"110ms",wipeBody:"260ms",hold:"3s",fall:"160ms",snap:"90ms"};(function(){const n=Ke,k=`font-family:${n.family};font-weight:${n.weight};font-style:oblique ${n.obliqueDeg}deg;text-transform:uppercase;letter-spacing:${n.track}em;`,w=`background-image:linear-gradient(96deg,${n.gradFrom},${n.gradTo});-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;`,v=oa,u=sa,D=ra,O=da,Z=`
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
  --p-fam:${n.family};
  --p-weight:${n.weight};
  --p-oblique:oblique ${n.obliqueDeg}deg;
  --p-track:${n.track}em;
  --p-mono:ui-monospace,Menlo,Consolas,"Segoe UI Mono",monospace;

  /* §1.3 sizes, px */
  --p-hero:${n.hero}px;         --p-hero-dial:${n.heroDial}px;
  /* §4.5 — the hero BOX: S1 and S3 are this wide, 232 px apart (208 + a 24 px
     gutter). specs/0055 §4.4 (fidelity 2026-09-06): it is no longer a width the
     ledger justifies to — the picked combo is the CONTENT-SIZED gate post — it
     is the timer's box, the receipt's floor, and the gate's cap. */
  --p-hero-box:300px;
  --p-hero-sm:${n.heroSmall}px; --p-board-name:30px;
  --p-blade:15px;               --p-secondary:${n.secondary}px;
  --p-unit:${n.unit}px;         --p-kind:10px;   --p-prose:13px;

  /* §1.4 the gradient — TWO STOPS, 96deg, NO BORDER (D18) */
  --p-grad:linear-gradient(96deg,${n.gradFrom},${n.gradTo});
  --p-grad-from:${n.gradFrom}; --p-grad-to:${n.gradTo};

  /* §1.5 flat colour */
  --p-flat:${n.flat}; --p-dim:${n.dim};
  --p-clean:${n.clean}; --p-sketchy:${n.sketchy}; --p-bailed:${n.bailed};

  /* §1.6 surfaces — TWO, and a third needs Greg (D19) */
  --p-cream:${v.cream}; --p-ink:${v.ink}; --p-sub:${v.sub}; --p-seam:${v.seam};
  --p-plate:${v.plate}; --p-hair:${v.hair};

  /* §1.7 kind dialects, mirroring markers.js KINDS */
  --p-k-run:${u.run}; --p-k-lift:${u.lift}; --p-k-bike:${u.bike};
  --p-k-land:${u.landmark}; --p-k-venue:${u.venue};

  /* §1.8 severity alphabet */
  --p-diff-green:${D.green}; --p-diff-blue:${D.blue};
  --p-diff-black:${D.black}; --p-diff-red:${D.red};

  /* §1.9 the hazard stripe, and §1.10's rules and radii */
  --p-hazard:${v.hazard}; --p-stripe:4px;
  --p-rule:${v.rule}; --p-hairline:1px; --p-spine:3px;
  --p-r:${v.radius}; --p-gauge:2px;

  /* §1.11 motion — no panel invents a duration */
  --p-rise:${O.rise}; --p-rise-ease:${O.riseEase};
  --p-wipe-rule:${O.wipeRule}; --p-wipe-body:${O.wipeBody};
  --p-hold:${O.hold}; --p-fall:${O.fall}; --p-snap:${O.snap};
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
  ${k}
}
.hudblk__lbl {
  display:block; font-family:var(--p-mono); font-size:var(--p-kind);
  font-style:normal; font-weight:700; letter-spacing:.22em;
  color:var(--p-cream); opacity:.72; margin-bottom:2px;
}
.hudblk__hero {
  display:block; font-size:var(--p-hero); line-height:1; white-space:nowrap; ${w}
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
.phud__atime, .phud__combo, .phud__cend { ${k}pointer-events:none; }

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
  font-size:${n.hero}px; line-height:.9; white-space:nowrap; text-align:center;
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
.phud__atime-n { ${w} }
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
  font-size:${n.unit}px; line-height:1; margin-left:8px;
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
.phud__combo-mult { flex:none; font-size:${n.heroSmall}px; line-height:1; ${w} }
.phud__combo-sep { display:none; }
.phud__combo-n, .phud__combo-q { font-size:${n.secondary}px; color:var(--p-cream); }
.phud__combo-n {
  flex:0 1 auto; min-width:0;
  overflow:hidden; text-overflow:ellipsis;
}
.phud__combo-q { flex:none; }
.phud__combo-n.is-hidden, .phud__combo-q.is-hidden { display:none; }
.phud__combo-q.is-clean { color:var(--p-cream); }
.phud__combo-q.is-sketchy { color:${n.sketchy}; }
.phud__combo-q.is-bailed { color:${n.bailed}; }
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
  font-size:${n.unit}px; line-height:1; color:var(--p-cream); opacity:.8;
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
.phud__cend-score, .phud__cend-mult { font-size:${n.hero}px; line-height:.9; }
.phud__cend-score { ${w} }
.phud__cend-pb { font-size:${n.secondary}px; color:var(--p-cream); }
/* a bail shows the MULTIPLIER, crossed out, flat red-purple — the thing you
   lost, not a score you never banked. No gradient: you did not earn one. */
.phud__cend-mult {
  color:${n.bailed};
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
  ${k}font-size:96px; line-height:.94; font-weight:${n.weight};
  letter-spacing:${n.track}em; color:var(--p-cream);
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
  margin:0; font-family:var(--p-fam); font-style:normal; font-weight:${n.weight};
  font-size:14px; letter-spacing:normal; text-transform:none;
  color:#f0ece0; text-shadow:0 1px 8px rgba(0,0,0,.8);
}
.phud__trick.is-wipe .phud__trick-n {
  ${k}font-size:14px; line-height:1; color:rgba(244,241,234,.72);
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
`,Q=document.createElement("style");Q.id="phud-type",Q.textContent=Z,document.head.appendChild(Q)})();const pa={landing:"came in too hot",tree:"met a tree",rock:"that was rock",building:"that wall was load-bearing",tower:"the lift is not a slalom gate",person:"sorry. so sorry.",bench:"the bench had it coming"},Ge=[10,20,28,30,40],la=p=>Ge.filter(n=>p*10>=n).length;function ha(){try{const p=window.__guide,n=p&&typeof p.equipped=="function"?p.equipped():null;if(n&&n.name)return String(n.name);const k=window.__playMarkers,w=k&&typeof k.stats=="function"?k.stats():null,v=w&&w.nearest;if(v&&v.kind==="run"&&v.name)return String(v.name)}catch{}return""}const ca=[[180,1.5],[360,2],[540,3],[720,4],[900,6],[1080,8],[1260,10],[1440,13]];function ua(p){let n=1;for(const[k,w]of ca)if(p+1e-6>=k)n=w;else break;return p>1440?13+(p-1440)/180*3:n}function ma(p){const n=/(\d{3,4})/.exec(p);return n?+n[1]:/triple/i.test(p)?1080:/double/i.test(p)?720:/flip/i.test(p)?360:0}function fa(p){return/cork|d-spin/i.test(p)?"cork":/underflip/i.test(p)?"underflip":/bio/i.test(p)?"bio":/misty/i.test(p)?"misty":/rodeo/i.test(p)?"rodeo":/flip/i.test(p)?"flip":/50-50|slide|switch-up|press/i.test(p)?"jib":/^\d+$/.test(p.trim())?"spin":"grab"}function ga(p,n){const k=ua(ma(p));return k>=4?n?"double":"black":k>=2?"blue":"green"}const j=(p,n)=>{p.textContent!==n&&(p.textContent=n)},t=(p,n,k)=>{const w=document.createElement(p);return n&&(w.className=n),k!=null&&(w.textContent=k),w};function wa({poi:p,run:n,adapter:k,onResume:w,onRespawn:v}){const u=t("div","phud"),D=[],O=t("div","phud__read pchip"),Z=t("div","phud__title");Z.append(t("span","dot"),t("b",null,ia((p||"world").toUpperCase(),aa))),O.append(Z);const Q=t("span","spacer"),T={};for(const[e,i]of[["pos","x / y / z"],["spd","speed"],["state","state"],["gear","gear"],["cam","cam"]]){const a=t("div","r");a.append(t("span","k",i),t("span","v","—")),T[e]=a.lastChild,O.append(a)}W&&u.append(O);let S=null;if(W){const e=t("div","phud__lip pchip");e.style.cssText="position:absolute;left:12px;top:190px;min-width:236px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;pointer-events:none;white-space:pre;";const i=t("div","phud__title");i.append(t("span","dot"),t("b",null,"LIP · COMPRESSION")),e.append(i);const a=b=>{const f=t("div");f.style.cssText="display:flex;justify-content:space-between;gap:10px";const C=t("span",null,b);C.style.opacity=".55";const c=t("span",null,"—");return f.append(C,c),e.append(f),c},s={};for(const b of["surface vy","reference","compression"])s[b]=a(b);const o=t("div");o.style.cssText="height:1px;margin:5px 0;opacity:.25;background:currentColor",e.append(o);for(const b of["ramp x K","comp x K","charge"])s[b]=a(b);const r=t("div");r.style.cssText="position:relative;height:6px;margin:4px 0 6px;border:1px solid currentColor;opacity:.9";const d=t("i");d.style.cssText="position:absolute;left:0;top:0;bottom:0;width:0;background:currentColor;opacity:.95";const h=t("i");h.style.cssText="position:absolute;top:0;bottom:0;width:0;background:currentColor;opacity:.45";const _=t("i");_.style.cssText="position:absolute;top:-2px;bottom:-2px;width:1px;background:currentColor",r.append(d,h,_),e.append(r);const l=t("div");l.style.cssText="height:1px;margin:5px 0;opacity:.25;background:currentColor",e.append(l);for(const b of["surface accel","snap release","pop window","pop now","state"])s[b]=a(b);const m=t("div");m.style.cssText="margin-top:6px;padding-top:5px;border-top:1px solid currentColor;opacity:.85;white-space:pre-wrap",m.textContent="takeoff —",e.append(m),u.append(e),D.push(e),S={box:e,rows:s,barR:d,barC:h,barMin:_,shot:m,shotT:0}}const pe=t("div","phud__fps");pe.append(t("span","k","fps "),t("span","v","—"));const $t=pe.lastChild;Z.append(Q,pe);let A=null,we={},ee=null,qe="";if(W){A=t("div","phud__dev pchip"),A.hidden=!0;const e=t("div","phud__title");e.append(t("span","dot"),t("b",null,"FLY CAMERA")),A.append(e);for(const[r,d]of[["pos","x / y / z"],["ang","yaw / pitch"],["fov","fov"],["spd","speed"],["cmp","compare"]]){const h=t("div","r");h.append(t("span","k",d),t("span","v","—")),we[r]=h.lastChild,A.append(h)}ee=t("div","phud__dev-url"),ee.textContent="?spawn=",A.append(ee);const i=t("div","phud__dev-btns"),a=t("button","pdev-btn pdev-btn--sm","copy params"),s=t("button","pdev-btn pdev-btn--sm","copy url");a.type=s.type="button",i.append(a,s),A.append(i),u.append(A);const o=(r,d)=>{const h=()=>{E.classList.remove("is-refusal"),E.textContent="copied · "+d,E.hidden=!1,V=1.2};navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(r).then(h,()=>{}):h()};a.addEventListener("click",r=>{r.stopPropagation(),o(ee.textContent,"spawn params")}),s.addEventListener("click",r=>{r.stopPropagation(),o(qe,"play url")})}const le=t("div","phud__legend"),I=(e,i)=>{const a=t("span","pkey");return a.append(t("b",null,e),document.createTextNode(i)),le.append(a),a},q=(e,i)=>{const a=t("span","pkey is-hidden");return a.append(t("b",null,e),document.createTextNode(i)),a},x={move:I("WASD","move"),sprint:q("SHIFT","sprint"),jump:I("SPACE","jump"),gear:q("E","gear"),inv:q("I","locker"),boost:I("HOLD SPACE","boost"),lift:q("F","lift"),spin:I("← →","spin"),cam:I("C","camera"),reset:I("R","reset"),refs:W?I("B","refs"):q("B","refs"),dev:W?I("F8","dev"):q("F8","dev"),pause:I("ESC","pause")};x.lift.classList.add("is-hidden"),x.boost.classList.add("is-hidden"),x.pause.classList.add("is-out"),u.append(le),matchMedia("(pointer: coarse)").matches&&(le.style.display="none");const ve=matchMedia("(pointer: coarse)").matches,g=t("div","phud__prompt pchip");g.hidden=!0;const Ve=t("b",null,"F"),ye=t("span",null,"");g.append(Ve,ye),u.append(g);let he=!1,ce="F",Ee=0;const Xe={SPACE:"Space",ENTER:"Enter",ESC:"Escape",TAB:"Tab"},Ye=e=>{const i=String(e??"F").trim().toUpperCase();return Xe[i]?Xe[i]:/^[A-Z]$/.test(i)?"Key"+i:/^[0-9]$/.test(i)?"Digit"+i:"Key"+(i[0]||"F")};function Je(){if(g.hidden)return null;const e=Ye(ce),i={code:e,key:e.startsWith("Key")?e.slice(3).toLowerCase():e,bubbles:!0,cancelable:!0};return Ee++,g.dataset.fires=String(Ee),dispatchEvent(new KeyboardEvent("keydown",i)),dispatchEvent(new KeyboardEvent("keyup",i)),e}if(ve){g.classList.add("phud__prompt--tap"),g.addEventListener("touchstart",a=>{a.stopPropagation(),a.preventDefault(),g.classList.add("is-press")},{passive:!1});const e=a=>{const s=g.getBoundingClientRect();return a.clientX>=s.left&&a.clientX<=s.right&&a.clientY>=s.top&&a.clientY<=s.bottom},i=a=>s=>{s.stopPropagation(),s.preventDefault();const o=g.classList.contains("is-press");g.classList.remove("is-press");const r=s.changedTouches&&s.changedTouches[0];a&&o&&(!r||e(r))&&Je()};g.addEventListener("touchend",i(!0),{passive:!1}),g.addEventListener("touchcancel",i(!1),{passive:!1}),g.addEventListener("click",a=>{a.stopPropagation(),Je()})}const H=t("div","phud__fuel");H.hidden=!0;const Bt=t("span","phud__fuel-lbl","boost"),Ze=t("span","phud__fuel-bar"),Qe=t("i");Ze.append(Qe),H.append(Bt,Ze),u.append(H);let te=!1,et=!1;const E=t("div","phud__toast pchip");E.hidden=!0,u.append(E);let V=0;const L=t("div","phud__trick");L.hidden=!0;const tt=t("div","phud__trick-big"),Ut=t("div","phud__trick-rule"),at=t("div","phud__trick-row"),it=t("div","phud__trick-sub"),nt=t("div","phud__trick-n");at.append(it,nt),L.append(tt,Ut,at),u.append(L);let M=0,ue=!1,ae=0;const N=t("div","phud__pump");N.hidden=!0;const ot=t("i","phud__pump-arc");N.append(ot),u.append(N);let X=0,Te=0;const y=t("div","phud__atime"),st=t("span","phud__atime-n","0.00"),rt=t("span","phud__atime-u","AIR"),me=t("div","phud__atime-m"),Wt=t("i");me.append(Wt);const jt=t("div","phud__atime-seam");y.append(st,rt,me,jt),y.hidden=!0,u.append(y);let z=0,P=0,fe=!1,dt="",pt="";const K=t("div","phud__combo");K.hidden=!0;const zt=t("div","phud__combo-post"),ie=t("div","phud__combo-line"),lt=t("span","phud__combo-tile"),ht=t("span","phud__combo-board"),ct=t("span","phud__combo-mult","×1"),ut=t("span","phud__combo-sep","·"),Se=t("span","phud__combo-n",""),mt=t("span","phud__combo-sep","·"),ne=t("span","phud__combo-q","");lt.append(ct),ht.append(ut,Se,mt,ne),ie.append(lt,ht);const ft=t("div","phud__grace"),gt=t("i");ft.append(gt);const Y=t("div","phud__marks"),bt=t("span","phud__marks-more","");K.append(zt,ie,ft,Y),u.append(K);let Le="";function Kt(e,i,a){const s=e.length+"|"+(i||"")+"|"+(a?"x":"")+"|"+e.join(",");if(s===Le)return;Le=s,Y.textContent="";const o=e.slice(0,8),r=new Set;o.forEach((d,h)=>{const _=fa(d),l=!r.has(_);r.add(_);const m=t("span","pmark pmark--"+ga(d,l));i==="sketchy"&&h===o.length-1&&m.classList.add("is-hollow"),Y.append(m)}),e.length>8&&(j(bt,"+ ×"+(e.length-8)),Y.append(bt)),Y.classList.toggle("is-hidden",!Y.childElementCount)}let oe=-1;const R=t("div","phud__cend");R.hidden=!0;const xt=t("div","phud__cend-row"),Ce=t("span","phud__cend-score","0"),Oe=t("span","phud__cend-mult","×1"),_t=t("span","phud__cend-pb","PB"),kt=t("span","pmark pmark--double phud__cend-dia"),wt=t("div","phud__cend-hair"),Ae=t("div","phud__cend-prov","");xt.append(kt,Ce,Oe,_t),R.append(xt,wt,Ae),u.append(R);let ge=0;const se=t("div","phud__bdot");se.hidden=!0,se.title="L L",u.append(se);const $=t("div","pgearmenu");$.hidden=!0;const vt=t("section","panel pgearmenu__panel"),yt=t("div","panel__hd");yt.append(t("span","lbl lbl--accent","gear"),t("span","spacer"),t("span","lbl","e / esc close"));const Ne=t("div","panel__bd pgearmenu__bd");vt.append(yt,Ne),$.append(vt),u.append($);let B=[],G=0,Re=null;function Ie(){B.forEach((e,i)=>e.el.classList.toggle("is-sel",i===G))}function be(){$.hidden=!0,Re=null}function He(e){const i=B[e];if(!i||i.disabled)return;const a=Re;be(),a&&a(i.gear)}const Gt={openGear({current:e,def:i,gears:a,onPick:s}){Ne.textContent="",B=(a||["boots","skis"]).map((o,r)=>{const d=t("div","pgearmenu__row");return d.append(t("span","cap",String(r+1)),t("span","name",o),t("span","tag",o===e?"equipped":o===i?"default":"")),d.addEventListener("click",h=>{h.stopPropagation(),He(B.findIndex(_=>_.el===d))}),Ne.append(d),{el:d,gear:o,disabled:!1}}),G=Math.max(0,B.findIndex(o=>o.gear===e)),Re=s,$.hidden=!1,Ie()},closeGear:be,gearOpen(){return!$.hidden},gearKey(e){if($.hidden)return!1;if(e==="KeyW"||e==="ArrowUp")return G=(G+B.length-1)%B.length,Ie(),!0;if(e==="KeyS"||e==="ArrowDown")return G=(G+1)%B.length,Ie(),!0;if(e==="Enter"||e==="Space")return He(G),!0;if(e==="Escape"||e==="KeyE")return be(),!0;const i=/^(?:Digit|Numpad)([1-9])$/.exec(e);return i&&He(Number(i[1])-1),!0}};if(W){const e=t("div","phud__ref pchip");e.hidden=!0;const i=t("img","phud__ref-img");i.alt="";const a=t("div","phud__ref-cap"),s=t("span","pmark pmark--x");a.append(s);const o=t("span",null,"");a.append(o),e.append(i,a),u.append(e),D.push(e);let r=[],d=0;fetch("/api/poi/"+encodeURIComponent(p)).then(l=>l.json()).then(l=>{r=[...l.aerials||[],...l.photos||[]]}).catch(()=>{});const h=()=>{if(!r.length){e.classList.add("is-empty"),o.textContent="no reference bundle";return}e.classList.remove("is-empty"),d=(d+r.length)%r.length;const l=r[d];i.src=l.url.replace("/files/","/thumb/")+"?w=900",o.textContent=l.name.replace(/\.(jpe?g|png|webp)$/i,"")+" · "+(d+1)+"/"+r.length+" · [ ] cycle · B close"},_=l=>!!l&&(l.tagName==="INPUT"||l.tagName==="TEXTAREA"||l.isContentEditable);addEventListener("keydown",l=>{$.hidden&&(_(l.target)||document.body.classList.contains("is-dev")||ze()&&(l.code==="KeyB"?(e.hidden=!e.hidden,e.hidden||h()):!e.hidden&&l.code==="BracketRight"?(d++,h()):!e.hidden&&l.code==="BracketLeft"&&(d--,h())))})}const Et=t("div","phud__cross");u.append(Et);const F=t("div","ppause");F.hidden=!0;const Tt=t("section","panel ppause__panel"),St=t("div","panel__hd");St.append(t("span","lbl lbl--accent","paused"),t("span","spacer"),t("span","lbl",na({lab:n||"","RED DOG":"red dog chair",SIBERIA:"siberia express"})));const Lt=t("div","panel__bd ppause__bd"),J=t("div","ppause__keys");let Pe=null,Fe=null,De=null,Me=null;const qt=[["core","every run","green"],["foot","on foot","green"],["ski","on skis","blue"],["bike","on the bike","blue"],["air","in the air","black"],["glide","on the glider","black"],["rocket","on the rocket pack","double"],["lab","lab only","x"]],Ct=[["ESC","settings","core"],["W A S D","move","core"],["← →","tricks in the air","core"],["C","camera","core"],["R","reset","core"]],Vt=[["SHIFT","sprint","foot"],["SPACE","jump","foot"],["MOUSE","look","foot"],["E","gear · tap toggles, hold for menu","foot"],["I","inventory · the ski rack, and every other gear type","foot"],["SPACE","hold to thrust · on the rocket pack — 6 s of fuel, refills itself at 1×","rocket"],["F","ride the chairlift · at a base terminal","foot","lift"],["A D","carve · on skis","ski"],["S","stop · on skis; moving backward it drives instead","ski"],["W","skate · on skis; moving backward it stops you","ski"],["W S","pedal / pump · on bike","bike"],["SHIFT","brake · on bike","bike"],["SPACE","hold to preload, release on a lip to pop · on bike","bike"],["MOUSE","aim where to fly — the wing banks and carves round to it · on glider","glide"],["W S","nose down / nose up · on glider","glide"],["SPACE","hold to flare — bleed speed for a clean landing · on glider","glide"],["MOUSE","aim the motor — thrust goes exactly where you look · on the rocket pack","rocket"],["SPACE","let go and you are a falling body; burn back down the way you came to land · on the rocket pack","rocket"],["← →","spin / flip · in the air","air"],["↑ ↓","spin / flip · in the air","air"],["← →","barrel roll · flying","glide"],["B","reference photos","lab"],["[ ]","cycle refs","lab"],["F8","dev fly mode · noclip + reference compare","lab"]],Ot=[["F","clear the trail · away from a lift terminal; at one, F still boards","core","trail"],["M","trail map","core"]],At=[["↑ ↓","look","core"]],Xt=W?[...Ct,...Vt,...At,...Ot]:[...Ct,...At,...Ot],Nt=[];for(const[e,i,a]of qt){const s=Xt.filter(h=>h[2]===e);if(!s.length)continue;const o=t("div","ppause__grp");e!=="core"&&Nt.push(o);const r=t("div","ppause__grp-hd");r.append(t("span","pmark pmark--"+a),t("span",null,i));const d=t("div","ppause__grp-rows");for(const[h,_,,l]of s){const m=t("div","cap",h),b=t("div","what",_);l==="lift"&&(m.classList.add("is-hidden"),b.classList.add("is-hidden"),Pe=m,Fe=b),l==="trail"&&(m.classList.add("is-hidden"),b.classList.add("is-hidden"),De=m,Me=b),d.append(m,b)}o.append(r,d),J.append(o)}J.childElementCount>1&&J.classList.add("is-cols");const $e=t("button","btn btn--accent ppause__big","click to resume");$e.type="button";const Rt=t("a","btn btn--ghost","return to bench");Rt.href="/#/run/"+encodeURIComponent(p)+"/"+encodeURIComponent(n);const Be=t("button","btn btn--ghost","respawn");Be.type="button";const It=t("div","ppause__row");It.append($e);const Ue=t("div","ppause__row");W&&Ue.append(Rt,Be,t("span","lbl","adapter · "+k));const Yt=t("div","ppause__credit","terrain USGS 3DEP · trails © OpenStreetMap contributors (ODbL)");Lt.append(J,It,Ue,Yt),Tt.append(St,Lt),F.append(Tt),u.append(F);const U=t("div","pboard");U.hidden=!0;const Ht=t("section","panel pboard__panel"),Pt=t("div","panel__hd");Pt.append(t("span","lbl lbl--accent","personal best"),t("span","spacer"),t("span","lbl","l l · esc close"));const re=t("div","panel__bd pboard__bd");Ht.append(Pt,re),U.append(Ht),u.append(U);const Ft=e=>Math.round(Number(e)||0).toLocaleString("en-US"),Jt=["rk","sc","mu","bt","sk","tr","wh"];function Dt(e,i){const a=t("div","pboard__row"+(e?" "+e:""));return i.forEach((s,o)=>a.append(t("span",Jt[o],s))),a}function Zt(e){if(re.textContent="",re.append(Dt("pboard__row--hd",["#","score","mult","best trick","ski","trail","when"])),!e.length){re.append(t("div","pboard__empty","no runs banked yet · land a combo"));return}for(const i of e)re.append(Dt(i&&i.you?"is-you":"",[String(i.rank!=null?i.rank:"—"),Ft(i.score),"×"+(i.mult!=null?i.mult:1),i.best||"—",i.ski||"—",i.trail||"—",i.when||"—"]))}function xe(){U.hidden=!0}U.style.pointerEvents="auto",U.addEventListener("click",e=>{e.stopPropagation(),xe()}),F.style.pointerEvents="auto",$e.addEventListener("click",e=>{e.stopPropagation(),w&&w()}),Be.addEventListener("click",e=>{e.stopPropagation(),v&&v()}),F.addEventListener("click",()=>w&&w()),document.body.appendChild(u);let _e=0,We=0,Mt=performance.now();const je=e=>(e>=0?" ":"")+e.toFixed(1);let de=!1;function ke(){const e=!F.hidden,i=ze();for(const a of D)a.classList.toggle("is-hidden",!i),i||(a.hidden=!0);for(const a of[pe,le,E,L,g,H,N,y,K,R,se])a.classList.toggle("is-hidden",e);Et.classList.toggle("is-hidden",e||de),O.classList.toggle("is-hidden",e||de||!i),x.refs.classList.toggle("is-hidden",!i),x.dev.classList.toggle("is-hidden",!i);for(const a of Nt)a.hidden=!i;J.classList.toggle("is-cols",i&&J.childElementCount>1),Ue.classList.toggle("is-hidden",!i),A&&(A.classList.toggle("is-hidden",e||!i),A.hidden=!de||!i)}return addEventListener("play:labui",ke),ke(),{root:u,pause:F,setPaused(e){F.hidden=!e,e&&(be(),xe()),ke()},isPaused(){return!F.hidden},setDev(e){de=!!e,x.dev.classList.toggle("is-on",de),ke()},devTick(e){if(A){for(const i of Object.keys(we))e[i]!=null&&(we[i].textContent=e[i]);e.params!=null&&(ee.textContent=e.params),e.url!=null&&(qe=e.url)}},lipMeter(e){if(!S)return;const i=!!e&&!!e.on&&ze();if(S.box.hidden=!i,!i)return;const a=e.s,s=e.T,o=S.rows,r=(c,Qt=2)=>(c>=0?"+":"")+Number(c||0).toFixed(Qt);o["surface vy"].textContent=r(a.surfVy)+" m/s "+(a.surfVy>.05?"UP":a.surfVy<-.05?"down":"flat"),o.reference.textContent=r(a.vyFloor)+" m/s",o.compression.textContent=r(a.comp)+" m/s",o["ramp x K"].textContent=r(a.lipRamp),o["comp x K"].textContent=r(a.lipComp);const d=(a.lipRamp||0)+(a.lipComp||0);o.charge.textContent=(a.lipVy>0?Number(a.lipVy).toFixed(2):"0.00")+" / "+Number(s.lipMax).toFixed(2)+(a.lipVy>0?"":d>0?"  < lipMin":a.lipRamp<0?"  ramp negative":"");const h=c=>Math.max(0,Math.min(100,100*c/(s.lipMax||1))),_=h(Math.max(0,a.lipRamp));S.barR.style.width=_.toFixed(1)+"%",S.barC.style.left=_.toFixed(1)+"%",S.barC.style.width=h(a.lipComp).toFixed(1)+"%",S.barMin.style.left=h(s.lipMin).toFixed(1)+"%";const l=a.sincePop==null?1e9:a.sincePop;let m;!e.grounded&&a.airT>0?m=a.popPaid?"spent":a.lipVy>0&&a.airT<=s.popCoyote?"COYOTE "+(s.popCoyote-a.airT).toFixed(2)+"s left":"closed":a.lipVy>0?m=l<=s.popWindow?"ARMED (popped "+l.toFixed(2)+"s ago)":"at lip · pop now":m="no charge";const b=a.dVyS||0,f=a.gravity||16;o["surface accel"].textContent=r(b,1)+" / -"+f.toFixed(0)+(b<-f?"  PAST FREE FALL":""),o["snap release"].textContent=a.dropK>0?(100*a.dropK).toFixed(0)+"%  "+Number(a.snapFull).toFixed(2)+" -> "+Number(a.snapCut).toFixed(2)+" m":"glued  "+Number(a.snapFull||0).toFixed(2)+" m",o["pop window"].textContent=m;const C=e.pop;if(o["pop now"].textContent=C?Number(C.total).toFixed(2)+" m/s"+(C.add>.005?"  (+"+C.add.toFixed(2)+")":"")+(C.add<=.005&&C.compRaw>.5?"  "+C.gate.toUpperCase():""):"—",o.state.textContent=(e.grounded?"on snow":"air "+Number(a.airT).toFixed(2)+"s")+(a.lipVy>0?" · charged":""),e.launch){const c=e.launch;S.shot.textContent="takeoff "+(c.total>.01?"+"+c.total.toFixed(2)+" m/s":"flat")+"  ["+c.src.toUpperCase()+"]"+(c.drop?`
  DROP-AWAY  snap `+Number(c.snapFull).toFixed(2)+" -> "+Number(c.snapCut).toFixed(2)+" m ("+(100*c.dropK).toFixed(0)+`% let go)
  surface `+r(c.dVyS,1)+" vs -"+c.grav.toFixed(0)+", past free fall":"")+(c.total>.01?`
  ramp `+r(c.ramp)+"  comp "+r(c.comp)+"  -> charge "+c.charge.toFixed(2)+(c.pop>0?`
  pop bonus +`+c.pop.toFixed(2):"")+(c.restored>0?"  (jump restored +"+c.restored.toFixed(2)+")":""):c.drop?"":`
  no charge (ramp `+r(c.ramp)+" comp "+r(c.comp)+")")+(c.eaten?`
  SWALLOWED, still on the snow next frame`:""),S.shotT=2}else S.shotT>0&&(S.shotT-=e.dt||.016,S.shotT<=0&&(S.shot.textContent="takeoff —"))},setLiftKey(e){he=!!e,x.lift.classList.toggle("is-hidden",!he),Pe&&Pe.classList.toggle("is-hidden",!he),Fe&&Fe.classList.toggle("is-hidden",!he)},setTrailKey(e){return De&&De.classList.toggle("is-hidden",!e),Me&&Me.classList.toggle("is-hidden",!e),!!e},setPrompt(e){if(!e){g.hidden=!0,g.classList.remove("is-press"),x.lift.classList.remove("is-on");return}ce=e.key||"F",Ve.textContent=ve?"TAP":ce,g.dataset.key=Ye(ce),g.dataset.tap=ve?"1":"0",g.dataset.fires=String(Ee),ye.textContent=" "+(e.text||""),g.hidden=!1,x.lift.classList.add("is-on")},promptText(){return g.hidden?null:ye.textContent.trim()},setFuel(e,i,a,s=!0){const o=Math.max(0,Math.min(1,Number(e)||0));if(te=!!i&&!!s,et=!!s,H.hidden=!s||o>.999&&!te,H.hidden){x.boost.classList.remove("is-on");return}Qe.style.width=(o*100).toFixed(1)+"%",H.classList.toggle("is-burn",te),H.classList.toggle("is-dry",!!a),x.boost.classList.toggle("is-on",te)},fuelShown(){return!H.hidden},flashGear(e){E.classList.remove("is-refusal"),E.textContent="gear · "+e,E.hidden=!1,V=1.4},...Gt,flash(e){const i=String(e??""),a=/\b(first|failed|blank|empty)\b/i.test(i);E.textContent="",a&&E.append(t("span","pmark pmark--x")),E.append(t("span",null,i)),E.classList.toggle("is-refusal",a),E.hidden=!1,V=1.4},trick(e){if(!(e.name==="wipeout")){L.hidden=!0,M=0,ue=!1;return}tt.textContent="WIPEOUT";const a=Math.round(ae*3.6);j(nt,a+" KM/H"+(e.deg?" · "+e.deg+"°":"")),it.textContent=pa[e.why]||(e.deg?e.deg+"° · unfinished":"skis crossed"),L.classList.add("is-wipe"),L.hidden=!1,L.classList.remove("is-pop","is-snap","is-late","is-gone-word","is-gone-line"),L.offsetWidth,L.classList.add("is-snap"),ue=!0,M=1.96},pump(e){const i=!!(e&&e.on),a=performance.now(),s=Te?Math.min(.1,(a-Te)/1e3):.016;if(Te=a,!i){X=0,N.hidden=!0;return}const o=Math.max(.001,Number(e.max)||4),r=Math.max(0,Math.min(1,(Number(e.q)||0)/o)),d=!!e.releasing;if(d?X=Math.max(r,X-s/.35):X=r,X<.004&&!d){N.hidden=!0;return}ot.style.setProperty("--pf",(X*100).toFixed(1)+"deg");const h=Number(e.eta),_=!(h<1.2),l=h<.8;N.classList.toggle("is-hot",_&&Number.isFinite(h)),N.classList.toggle("is-cold",l),N.classList.toggle("is-rel",d),N.hidden=!1},pumpShown(){return!N.hidden},airTimer(e){if(!!(e&&e.air)){const a=Number(e.t)||0;j(st,a.toFixed(2)),j(rt,e&&e.unit==="JIB"?"JIB":"AIR");const s=la(a),r=(Math.min(1,a*10/Ge[Ge.length-1])*100).toFixed(1)+"%",d=10+s*2+"px";r!==dt&&(me.style.setProperty("--af",r),dt=r),d!==pt&&(me.style.setProperty("--aw",d),pt=d),y.classList.contains("is-out")&&y.classList.remove("is-out"),y.hidden=!1,z=.6,P=0,fe=!0;return}fe=!1,!y.hidden&&z<=0&&P<=0&&(P=.3,y.classList.add("is-out"))},airTimerShown(){return!y.hidden},combo(e){if(!e||!e.on){K.hidden=!0,oe=-1,Le="";return}j(ct,"×"+(e.mult!=null?e.mult:1));const i=Array.isArray(e.names)?e.names.filter(Boolean):[],a=i.slice(-2).join(" · ");j(Se,a),Se.classList.toggle("is-hidden",!a),ut.classList.toggle("is-hidden",!a);const s=e.quality==="sketchy"?"SKETCHY":e.quality==="clean"?"CLEAN":"";j(ne,s),ne.classList.toggle("is-hidden",!s),mt.classList.toggle("is-hidden",!s||!a),ne.classList.toggle("is-clean",e.quality==="clean"),ne.classList.toggle("is-sketchy",e.quality==="sketchy"),Kt(i,e.quality,!1);const o=Number(e.graceMax)||2,r=Math.max(0,Math.min(1,1-(Number(e.grace)||0)/o));gt.style.width=(r*100).toFixed(1)+"%";const d=Number(e.count)||0;d!==oe&&(oe>=0&&d>oe&&(ie.classList.remove("is-pop"),ie.offsetWidth,ie.classList.add("is-pop")),oe=d),K.hidden=!1},comboShown(){return!K.hidden},comboEnd(e){if(!e)return;const i=!!e.bailed,a=!!e.pb&&!i;Ce.textContent="+"+Ft(e.score),Ce.classList.toggle("is-hidden",i),Oe.textContent="×"+(e.mult!=null?e.mult:1),Oe.classList.toggle("is-hidden",!i),_t.classList.toggle("is-hidden",!a),kt.classList.toggle("is-hidden",!i),R.classList.toggle("is-bail",i);const s=i?"":["×"+(e.mult!=null?e.mult:1),e.best?String(e.best):"",ha()].filter(Boolean).join(" · ");j(Ae,s),wt.classList.toggle("is-hidden",!s),Ae.classList.toggle("is-hidden",!s);const o=fe&&!y.hidden;R.classList.toggle("is-s3",o),o||(y.hidden=!0,z=0,P=0,fe=!1),R.classList.remove("is-snap","is-rise"),R.offsetWidth,R.classList.add(o?"is-rise":"is-snap"),R.hidden=!1,ge=i?.8:1.2},board(e){if(!e){xe();return}Zt(Array.isArray(e)?e:[]),U.hidden=!1},boardOpen(){return!U.hidden},closeBoard:xe,setBoardDot(e){se.hidden=!e},tick(e,i,a){const s=e.position,o=e.mode,r=o==="skis",d=o==="bike",h=o==="glider",_=o==="rocket",l=o!=="boots",m=e.speed();if(ae=m>ae?m:Math.max(0,ae-ae*(i/.5)),T.pos.textContent=`${je(s.x)} ${je(s.y)} ${je(s.z)}`,T.spd.textContent=m.toFixed(2)+" m/s",T.gear.textContent=o,T.gear.classList.toggle("is-hot",l),T.cam.textContent=a==="tp"?"chase":"first person",te)T.state.textContent="BOOST";else if(h&&!e.grounded){const f=ea(),C=e.velocity?e.velocity.y:0;T.state.textContent=f.stall>.35?"STALL":f.flare?"flare":f.updraft>.8?"lift +"+f.updraft.toFixed(1):C>.5?"climb":C<-6?"dive":"glide · "+f.airspeed.toFixed(0)}else if(_&&!e.grounded){const f=e.velocity?e.velocity.y:0;T.state.textContent="coast · "+(f<0?"−":"+")+Math.abs(f).toFixed(0)}else if(e.grounded)if(e.wipeT>0)T.state.textContent="wipeout";else if(r){const f=ta();T.state.textContent=f.chatter>.35?"CHATTER":f.stop===2?"HOCKEY":f.stop===1?"plow":f.stivoting?"stivot":f.releasing?"PUMP":m>3?"carve":"skate"}else d?T.state.textContent=e.keys.sprint?"brake":e.keys.jumpHeld?"preload":e.keys.back?"pump":m>3?"ride":"pedal":T.state.textContent=e.keys.sprint&&m>5?"sprint":"ground";else{const f=Math.abs(e.airSpinDeg||0);T.state.textContent=f>45?"air · "+Math.round(f)+"°":"air"}x.move.classList.toggle("is-on",e.keys.forward||e.keys.back||e.keys.left||e.keys.right),x.sprint.classList.toggle("is-on",!!e.keys.sprint),x.sprint.classList.toggle("is-hidden",r),x.sprint.lastChild.nodeValue=d?"brake":"sprint",x.jump.classList.toggle("is-on",!e.grounded),x.gear.classList.toggle("is-on",l),x.boost.classList.toggle("is-hidden",!(_||et)),x.spin.classList.toggle("is-on",!!(e.keys.spinLeft||e.keys.spinRight)),x.cam.classList.toggle("is-on",a==="tp"),V>0&&(V-=i,V<=0&&(E.hidden=!0)),M>0&&(M-=i,ue&&(M<=1.56&&L.classList.add("is-late"),M<=.36&&L.classList.add("is-gone-word"),M<=.2&&L.classList.add("is-gone-line")),M<=0&&(L.hidden=!0,ue=!1)),ge>0&&(ge-=i,ge<=0&&(R.hidden=!0)),!y.hidden&&z>0?(z-=i,z<=0&&(z=0,P=.3,y.classList.add("is-out"))):!y.hidden&&P>0&&(P-=i,P<=0&&(P=0,y.hidden=!0,y.classList.remove("is-out"))),_e+=i,We++;const b=performance.now();b-Mt>400&&($t.textContent=_e>0?String(Math.round(We/_e)):"—",_e=0,We=0,Mt=b)}}}export{wa as createHud,ka as hudFont,sa as hudKind,ra as hudMark,da as hudMotion,oa as hudSurf,Ke as hudType};
