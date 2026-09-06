import{gliderState as Ut}from"./glider.js";import{skiState as Bt}from"./ski.js";import{DEBUG_HUD as B,BRAND as jt,pick as Wt,pickBrand as zt}from"./flags.js";const De={family:'"Avenir Next", Avenir, "Nunito Sans", "Segoe UI", system-ui, sans-serif',weight:500,obliqueDeg:12,track:.06,hero:68,heroDial:64,heroSmall:28,secondary:13.5,unit:11,gradFrom:"#7b3fe4",gradTo:"#3b6cff",flat:"rgba(42,36,86,0.90)",dim:"rgba(42,36,86,0.35)",clean:"rgba(42,36,86,0.90)",sketchy:"#c77a1a",bailed:"#ff5c8a"};function ia(d,n=De.weight){return n+" "+d+"px "+De.family}const Kt={cream:"#f4f1ea",ink:"#171614",sub:"#726c60",seam:"#c8c2b3",plate:"rgba(23,22,20,0.34)",hair:"rgba(244,241,234,0.16)",hazard:"#ff4d00",rule:"2px",radius:"2px"},Gt={run:"#f4f1ea",lift:"#ff4d00",bike:"#8ec63f",landmark:"#7fd4e8",venue:"#ffab00"},qt={green:"#217a3c",blue:"#1d5fb4",black:"#141414",red:"#ff5c8a"},Vt={rise:"220ms",riseEase:"cubic-bezier(.16,1,.3,1)",wipeRule:"110ms",wipeBody:"260ms",hold:"3s",fall:"160ms",snap:"90ms"};(function(){const n=De,E=`font-family:${n.family};font-weight:${n.weight};font-style:oblique ${n.obliqueDeg}deg;text-transform:uppercase;letter-spacing:${n.track}em;`,w=`background-image:linear-gradient(96deg,${n.gradFrom},${n.gradTo});-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;`,L=Kt,u=Gt,I=qt,A=Vt,be=`
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
     gutter), and it is the width §4.4's ledger justifies its three tokens to */
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
  --p-cream:${L.cream}; --p-ink:${L.ink}; --p-sub:${L.sub}; --p-seam:${L.seam};
  --p-plate:${L.plate}; --p-hair:${L.hair};

  /* §1.7 kind dialects, mirroring markers.js KINDS */
  --p-k-run:${u.run}; --p-k-lift:${u.lift}; --p-k-bike:${u.bike};
  --p-k-land:${u.landmark}; --p-k-venue:${u.venue};

  /* §1.8 severity alphabet */
  --p-diff-green:${I.green}; --p-diff-blue:${I.blue};
  --p-diff-black:${I.black}; --p-diff-red:${I.red};

  /* §1.9 the hazard stripe, and §1.10's rules and radii */
  --p-hazard:${L.hazard}; --p-stripe:4px;
  --p-rule:${L.rule}; --p-hairline:1px; --p-spine:3px;
  --p-r:${L.radius}; --p-gauge:2px;

  /* §1.11 motion — no panel invents a duration */
  --p-rise:${A.rise}; --p-rise-ease:${A.riseEase};
  --p-wipe-rule:${A.wipeRule}; --p-wipe-body:${A.wipeBody};
  --p-hold:${A.hold}; --p-fall:${A.fall}; --p-snap:${A.snap};
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
  ${E}
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
.phud__atime, .phud__combo, .phud__cend { ${E}pointer-events:none; }

/* ================================================= specs/0055 §4.5 — THE SLOTS
   "It should move to the side if a new timer or something is ticking there"
   (D10). THREE SLOTS, ONE OCCUPANT EACH:

     S1  left:50%  top:12.5%   the live timer (.phud__atime) > the receipt
     S2  left:50%  top:21.5%   the combo meter (.phud__combo)
     S3  left:calc(50% + 232px) top:12.5%, left-aligned — whichever of S1's
                               two got displaced

   S1 and S3 are the same hero box, S3's left edge at \`calc(50% + 232px)\` — the
   spec's own coordinate. \`--p-hero-box\` is **300 px**, the width of the ledger
   cell in the lookbook row this pick came from, and NOT the 208 px that reading
   "232 px apart" as "the hero's width + a 24 px gutter" would give: measured,
   the shortest possible ledger — a 28 px multiplier, ONE eight-character trick
   name, one verdict word, two gaps and the padding — is 214 px, so at 208 the
   middle token ellipsises its own trick name and §4.4's justification has
   nothing to justify. At 300 the three tokens sit as the lookbook drew them and
   S1 (490-790) still clears S3 (872) by 82 px. The receipt owns S1 UNLESS a timer is live there,
   and then it takes S3 and arrives RISE instead of SNAP. This is also 0057's
   seam (§4.9): air time and jib time are the SAME clock in S1, never two.

   THE 208 px BOX IS WHAT MAKES THE LEDGER JUSTIFIABLE. §4.4 wants the combo's
   three tokens justified to the hero's full width rather than a line that grows
   sideways, and "the hero's full width" has to be a number for that to mean
   anything. It is this one, and the receipt and the bail are the same box, so
   the receipt really does land in the pixels the timer vacated.

   AND THE BLOCKS DO NOT TOUCH — §8's P4. 12.5 % and 21.5 % of 720 are 90 px and
   154.8 px, so S1 has 64.8 px of room and a 68 px hero on a \`line-height:1\` box
   is 3.2 px too tall for it: with a live timer and a live combo on screen at
   once the two rectangles have overlapped since 0048, which is the defect P4
   exists to catch. \`line-height:.9\` gives the same glyphs a 61.2 px box — the
   ink is untouched, the half-leading is what shrinks — and S1 clears S2 by
   3.6 px with the plate on. Nothing here is a nudge: every number is either the
   spec's or arithmetic on it. */
.phud__atime, .phud__cend {
  position:absolute; left:50%; top:12.5%; transform:translateX(-50%);
  box-sizing:border-box; width:var(--p-hero-box); padding:0 14px;
  background:var(--p-plate);
  border-bottom:var(--p-rule) solid var(--p-grad-to);
  border-radius:var(--p-r);
}
/* S3 — left-aligned, the gutter's width to the right of S1's own left edge */
.phud__cend.is-s3 { left:calc(50% + 232px); transform:none; text-align:left; }
.phud__atime {
  font-size:${n.hero}px; line-height:.9; white-space:nowrap; text-align:center;
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
  position:absolute; left:100%; margin-left:16px; top:0; bottom:0;
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

/* ------------------------------------- specs/0055 §4.4 — THE COMBO LEDGER **B**
   S2, and the line stops growing sideways. The three tokens — multiplier, trick
   names, quality word — are JUSTIFIED to the hero's own 208 px, each with a
   fixed job by POSITION rather than by the middot between it and the next:
   gradient left = the multiplier, flat centre = what you threw, verdict right.
   A ten-trick line and a one-trick line are now the same width and the same
   shape, which is the whole read at speed. The two \`.phud__combo-sep\` middots
   are not deleted (0057/R2 owns the tail's content and §4.9 renames nothing) —
   justification does their job, so they stop being drawn. */
.phud__combo {
  position:absolute; left:50%; top:21.5%; bottom:auto; transform:translateX(-50%);
  box-sizing:border-box; width:var(--p-hero-box); padding:5px 14px 6px;
  background:var(--p-plate);
  border-bottom:var(--p-rule) solid var(--p-grad-to);
  border-radius:var(--p-r);
  display:flex; flex-direction:column; align-items:stretch; gap:5px;
  white-space:nowrap; text-shadow:none;
}
.phud__combo[hidden], .phud__combo.is-hidden { display:none; }
.phud__combo-line {
  display:flex; align-items:baseline; justify-content:space-between; gap:8px;
}
.phud__combo-mult { flex:none; font-size:${n.heroSmall}px; line-height:1; ${w} }
.phud__combo-sep { display:none; }
.phud__combo-n, .phud__combo-q { font-size:${n.secondary}px; color:var(--p-cream); }
.phud__combo-n {
  flex:1 1 auto; min-width:0; text-align:center;
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
  display:flex; align-items:center; gap:5px; min-height:11px;
}
.phud__marks.is-hidden { display:none; }
.pmark.is-hidden { display:none; }
.phud__marks-more {
  font-size:${n.unit}px; line-height:1; color:var(--p-cream); opacity:.8;
}

/* comboGraceT, drained full -> empty: the "you have 2 s to link" read, and it
   is §1.10's ONE 2 px gauge at the block's own width — no second component. */
.phud__grace { width:auto; height:var(--p-gauge); background:var(--p-dim); }
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
  display:flex; align-items:baseline; justify-content:center; gap:14px;
  text-align:center; text-shadow:none; white-space:nowrap;
  /* the timer's box is a FLOOR here, not a cap: a six-figure score at 68 px is
     wider than 300 px, and a receipt that clipped its own number to land in the
     timer's pixels would be keeping the wrong promise. Every ordinary score
     sits in exactly the timer's box; a huge one grows out of it. */
  width:auto; min-width:var(--p-hero-box);
}
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
.phud__trick.is-wipe { top:34%; width:min(760px,86vw); }
.phud__trick.is-wipe .phud__trick-big {
  ${E}font-size:96px; line-height:.94; font-weight:${n.weight};
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
  ${E}font-size:14px; line-height:1; color:rgba(244,241,234,.72);
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
`,x=document.createElement("style");x.id="phud-type",x.textContent=be,document.head.appendChild(x)})();const Yt={landing:"came in too hot",tree:"met a tree",rock:"that was rock",building:"that wall was load-bearing",tower:"the lift is not a slalom gate",person:"sorry. so sorry.",bench:"the bench had it coming"},Me=[10,20,28,30,40],Xt=d=>Me.filter(n=>d*10>=n).length,Jt=[[180,1.5],[360,2],[540,3],[720,4],[900,6],[1080,8],[1260,10],[1440,13]];function Zt(d){let n=1;for(const[E,w]of Jt)if(d+1e-6>=E)n=w;else break;return d>1440?13+(d-1440)/180*3:n}function Qt(d){const n=/(\d{3,4})/.exec(d);return n?+n[1]:/triple/i.test(d)?1080:/double/i.test(d)?720:/flip/i.test(d)?360:0}function ea(d){return/cork|d-spin/i.test(d)?"cork":/underflip/i.test(d)?"underflip":/bio/i.test(d)?"bio":/misty/i.test(d)?"misty":/rodeo/i.test(d)?"rodeo":/flip/i.test(d)?"flip":/50-50|slide|switch-up|press/i.test(d)?"jib":/^\d+$/.test(d.trim())?"spin":"grab"}function ta(d,n){const E=Zt(Qt(d));return E>=4?n?"double":"black":E>=2?"blue":"green"}const q=(d,n)=>{d.textContent!==n&&(d.textContent=n)},t=(d,n,E)=>{const w=document.createElement(d);return n&&(w.className=n),E!=null&&(w.textContent=E),w};function sa({poi:d,run:n,adapter:E,onResume:w,onRespawn:L}){const u=t("div","phud"),I=t("div","phud__read pchip"),A=t("div","phud__title");A.append(t("span","dot"),t("b",null,Wt((d||"world").toUpperCase(),jt))),I.append(A);const be=t("span","spacer"),x={};for(const[e,a]of[["pos","x / y / z"],["spd","speed"],["state","state"],["gear","gear"],["cam","cam"]]){const o=t("div","r");o.append(t("span","k",a),t("span","v","—")),x[e]=o.lastChild,I.append(o)}B&&u.append(I);let T=null;if(B){const e=t("div","phud__lip pchip");e.style.cssText="position:absolute;left:12px;top:190px;min-width:236px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:8px 10px;pointer-events:none;white-space:pre;";const a=t("div","phud__title");a.append(t("span","dot"),t("b",null,"LIP · COMPRESSION")),e.append(a);const o=_=>{const m=t("div");m.style.cssText="display:flex;justify-content:space-between;gap:10px";const C=t("span",null,_);C.style.opacity=".55";const c=t("span",null,"—");return m.append(C,c),e.append(m),c},i={};for(const _ of["surface vy","reference","compression"])i[_]=o(_);const s=t("div");s.style.cssText="height:1px;margin:5px 0;opacity:.25;background:currentColor",e.append(s);for(const _ of["ramp x K","comp x K","charge"])i[_]=o(_);const r=t("div");r.style.cssText="position:relative;height:6px;margin:4px 0 6px;border:1px solid currentColor;opacity:.9";const p=t("i");p.style.cssText="position:absolute;left:0;top:0;bottom:0;width:0;background:currentColor;opacity:.95";const l=t("i");l.style.cssText="position:absolute;top:0;bottom:0;width:0;background:currentColor;opacity:.45";const b=t("i");b.style.cssText="position:absolute;top:-2px;bottom:-2px;width:1px;background:currentColor",r.append(p,l,b),e.append(r);const h=t("div");h.style.cssText="height:1px;margin:5px 0;opacity:.25;background:currentColor",e.append(h);for(const _ of["surface accel","snap release","pop window","pop now","state"])i[_]=o(_);const f=t("div");f.style.cssText="margin-top:6px;padding-top:5px;border-top:1px solid currentColor;opacity:.85;white-space:pre-wrap",f.textContent="takeoff —",e.append(f),u.append(e),T={box:e,rows:i,barR:p,barC:l,barMin:b,shot:f,shotT:0}}const ie=t("div","phud__fps");ie.append(t("span","k","fps "),t("span","v","—"));const Ct=ie.lastChild;A.append(be,ie);let O=null,_e={},J=null,Ue="";if(B){O=t("div","phud__dev pchip"),O.hidden=!0;const e=t("div","phud__title");e.append(t("span","dot"),t("b",null,"FLY CAMERA")),O.append(e);for(const[r,p]of[["pos","x / y / z"],["ang","yaw / pitch"],["fov","fov"],["spd","speed"],["cmp","compare"]]){const l=t("div","r");l.append(t("span","k",p),t("span","v","—")),_e[r]=l.lastChild,O.append(l)}J=t("div","phud__dev-url"),J.textContent="?spawn=",O.append(J);const a=t("div","phud__dev-btns"),o=t("button","pdev-btn pdev-btn--sm","copy params"),i=t("button","pdev-btn pdev-btn--sm","copy url");o.type=i.type="button",a.append(o,i),O.append(a),u.append(O);const s=(r,p)=>{const l=()=>{y.classList.remove("is-refusal"),y.textContent="copied · "+p,y.hidden=!1,Y=1.2};navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(r).then(l,()=>{}):l()};o.addEventListener("click",r=>{r.stopPropagation(),s(J.textContent,"spawn params")}),i.addEventListener("click",r=>{r.stopPropagation(),s(Ue,"play url")})}const se=t("div","phud__legend"),F=(e,a)=>{const o=t("span","pkey");return o.append(t("b",null,e),document.createTextNode(a)),se.append(o),o},V=(e,a)=>{const o=t("span","pkey is-hidden");return o.append(t("b",null,e),document.createTextNode(a)),o},k={move:F("WASD","move"),sprint:V("SHIFT","sprint"),jump:F("SPACE","jump"),gear:V("E","gear"),inv:V("I","locker"),boost:F("HOLD SPACE","boost"),lift:V("F","lift"),spin:F("← →","spin"),cam:F("C","camera"),reset:F("R","reset"),refs:B?F("B","refs"):V("B","refs"),dev:B?F("F8","dev"):V("F8","dev"),pause:F("ESC","pause")};k.lift.classList.add("is-hidden"),k.boost.classList.add("is-hidden"),k.pause.classList.add("is-out"),u.append(se),matchMedia("(pointer: coarse)").matches&&(se.style.display="none");const xe=matchMedia("(pointer: coarse)").matches,g=t("div","phud__prompt pchip");g.hidden=!0;const Be=t("b",null,"F"),ke=t("span",null,"");g.append(Be,ke),u.append(g);let re=!1,pe="F",ve=0;const je={SPACE:"Space",ENTER:"Enter",ESC:"Escape",TAB:"Tab"},We=e=>{const a=String(e??"F").trim().toUpperCase();return je[a]?je[a]:/^[A-Z]$/.test(a)?"Key"+a:/^[0-9]$/.test(a)?"Digit"+a:"Key"+(a[0]||"F")};function ze(){if(g.hidden)return null;const e=We(pe),a={code:e,key:e.startsWith("Key")?e.slice(3).toLowerCase():e,bubbles:!0,cancelable:!0};return ve++,g.dataset.fires=String(ve),dispatchEvent(new KeyboardEvent("keydown",a)),dispatchEvent(new KeyboardEvent("keyup",a)),e}if(xe){g.classList.add("phud__prompt--tap"),g.addEventListener("touchstart",o=>{o.stopPropagation(),o.preventDefault(),g.classList.add("is-press")},{passive:!1});const e=o=>{const i=g.getBoundingClientRect();return o.clientX>=i.left&&o.clientX<=i.right&&o.clientY>=i.top&&o.clientY<=i.bottom},a=o=>i=>{i.stopPropagation(),i.preventDefault();const s=g.classList.contains("is-press");g.classList.remove("is-press");const r=i.changedTouches&&i.changedTouches[0];o&&s&&(!r||e(r))&&ze()};g.addEventListener("touchend",a(!0),{passive:!1}),g.addEventListener("touchcancel",a(!1),{passive:!1}),g.addEventListener("click",o=>{o.stopPropagation(),ze()})}const P=t("div","phud__fuel");P.hidden=!0;const Lt=t("span","phud__fuel-lbl","boost"),Ke=t("span","phud__fuel-bar"),Ge=t("i");Ke.append(Ge),P.append(Lt,Ke),u.append(P);let Z=!1,qe=!1;const y=t("div","phud__toast pchip");y.hidden=!0,u.append(y);let Y=0;const S=t("div","phud__trick");S.hidden=!0;const Ve=t("div","phud__trick-big"),At=t("div","phud__trick-rule"),Ye=t("div","phud__trick-row"),Xe=t("div","phud__trick-sub"),Je=t("div","phud__trick-n");Ye.append(Xe,Je),S.append(Ve,At,Ye),u.append(S);let j=0,we=!1,Q=0;const N=t("div","phud__pump");N.hidden=!0;const Ze=t("i","phud__pump-arc");N.append(Ze),u.append(N);let X=0,ye=0;const v=t("div","phud__atime"),Qe=t("span","phud__atime-n","0.00"),et=t("span","phud__atime-u","AIR"),de=t("div","phud__atime-m"),Ot=t("i");de.append(Ot),v.append(Qe,et,de),v.hidden=!0,u.append(v);let W=0,H=0,le=!1,tt="",at="";const z=t("div","phud__combo");z.hidden=!0;const ee=t("div","phud__combo-line"),ot=t("span","phud__combo-mult","×1"),nt=t("span","phud__combo-sep","·"),Ee=t("span","phud__combo-n",""),it=t("span","phud__combo-sep","·"),te=t("span","phud__combo-q","");ee.append(ot,nt,Ee,it,te);const st=t("div","phud__grace"),rt=t("i");st.append(rt);const K=t("div","phud__marks"),pt=t("span","phud__marks-more","");z.append(ee,K,st),u.append(z);let Te="";function Nt(e,a,o){const i=e.length+"|"+(a||"")+"|"+(o?"x":"")+"|"+e.join(",");if(i===Te)return;Te=i,K.textContent="";const s=e.slice(0,8),r=new Set;s.forEach((p,l)=>{const b=ea(p),h=!r.has(b);r.add(b);const f=t("span","pmark pmark--"+ta(p,h));a==="sketchy"&&l===s.length-1&&f.classList.add("is-hollow"),K.append(f)}),o&&K.append(t("span","pmark pmark--x")),e.length>8&&(q(pt,"+ ×"+(e.length-8)),K.append(pt)),K.classList.toggle("is-hidden",!K.childElementCount)}let ae=-1;const R=t("div","phud__cend");R.hidden=!0;const Se=t("span","phud__cend-score","0"),Ce=t("span","phud__cend-mult","×1"),dt=t("span","phud__cend-pb","PB"),lt=t("span","pmark pmark--x");R.append(lt,Se,Ce,dt),u.append(R);let he=0;const oe=t("div","phud__bdot");oe.hidden=!0,oe.title="L L",u.append(oe);const D=t("div","pgearmenu");D.hidden=!0;const ht=t("section","panel pgearmenu__panel"),ct=t("div","panel__hd");ct.append(t("span","lbl lbl--accent","gear"),t("span","spacer"),t("span","lbl","e / esc close"));const Le=t("div","panel__bd pgearmenu__bd");ht.append(ct,Le),D.append(ht),u.append(D);let M=[],G=0,Ae=null;function Oe(){M.forEach((e,a)=>e.el.classList.toggle("is-sel",a===G))}function ce(){D.hidden=!0,Ae=null}function Ne(e){const a=M[e];if(!a||a.disabled)return;const o=Ae;ce(),o&&o(a.gear)}const Rt={openGear({current:e,def:a,gears:o,onPick:i}){Le.textContent="",M=(o||["boots","skis"]).map((s,r)=>{const p=t("div","pgearmenu__row");return p.append(t("span","cap",String(r+1)),t("span","name",s),t("span","tag",s===e?"equipped":s===a?"default":"")),p.addEventListener("click",l=>{l.stopPropagation(),Ne(M.findIndex(b=>b.el===p))}),Le.append(p),{el:p,gear:s,disabled:!1}}),G=Math.max(0,M.findIndex(s=>s.gear===e)),Ae=i,D.hidden=!1,Oe()},closeGear:ce,gearOpen(){return!D.hidden},gearKey(e){if(D.hidden)return!1;if(e==="KeyW"||e==="ArrowUp")return G=(G+M.length-1)%M.length,Oe(),!0;if(e==="KeyS"||e==="ArrowDown")return G=(G+1)%M.length,Oe(),!0;if(e==="Enter"||e==="Space")return Ne(G),!0;if(e==="Escape"||e==="KeyE")return ce(),!0;const a=/^(?:Digit|Numpad)([1-9])$/.exec(e);return a&&Ne(Number(a[1])-1),!0}};if(B){const e=t("div","phud__ref pchip");e.hidden=!0;const a=t("img","phud__ref-img");a.alt="";const o=t("div","phud__ref-cap"),i=t("span","pmark pmark--x");o.append(i);const s=t("span",null,"");o.append(s),e.append(a,o),u.append(e);let r=[],p=0;fetch("/api/poi/"+encodeURIComponent(d)).then(h=>h.json()).then(h=>{r=[...h.aerials||[],...h.photos||[]]}).catch(()=>{});const l=()=>{if(!r.length){e.classList.add("is-empty"),s.textContent="no reference bundle";return}e.classList.remove("is-empty"),p=(p+r.length)%r.length;const h=r[p];a.src=h.url.replace("/files/","/thumb/")+"?w=900",s.textContent=h.name.replace(/\.(jpe?g|png|webp)$/i,"")+" · "+(p+1)+"/"+r.length+" · [ ] cycle · B close"},b=h=>!!h&&(h.tagName==="INPUT"||h.tagName==="TEXTAREA"||h.isContentEditable);addEventListener("keydown",h=>{D.hidden&&(b(h.target)||document.body.classList.contains("is-dev")||(h.code==="KeyB"?(e.hidden=!e.hidden,e.hidden||l()):!e.hidden&&h.code==="BracketRight"?(p++,l()):!e.hidden&&h.code==="BracketLeft"&&(p--,l())))})}const ut=t("div","phud__cross");u.append(ut);const $=t("div","ppause");$.hidden=!0;const mt=t("section","panel ppause__panel"),ft=t("div","panel__hd");ft.append(t("span","lbl lbl--accent","paused"),t("span","spacer"),t("span","lbl",zt({lab:n||"","RED DOG":"red dog chair",SIBERIA:"siberia express"})));const gt=t("div","panel__bd ppause__bd"),ue=t("div","ppause__keys");let Re=null,Ie=null;const It=[["core","every run","green"],["foot","on foot","green"],["ski","on skis","blue"],["bike","on the bike","blue"],["air","in the air","black"],["glide","on the glider","black"],["rocket","on the rocket pack","double"],["lab","lab only","x"]],bt=[["ESC","settings","core"],["W A S D","move","core"],["← →","tricks in the air","core"],["C","camera","core"],["R","reset","core"]],Ft=[["SHIFT","sprint","foot"],["SPACE","jump","foot"],["MOUSE","look","foot"],["E","gear · tap toggles, hold for menu","foot"],["I","inventory · the ski rack, and every other gear type","foot"],["SPACE","hold to thrust · on the rocket pack — 6 s of fuel, refills itself at 1×","rocket"],["F","ride the chairlift · at a base terminal","foot","lift"],["A D","carve · on skis","ski"],["S","stop · on skis; moving backward it drives instead","ski"],["W","skate · on skis; moving backward it stops you","ski"],["W S","pedal / pump · on bike","bike"],["SHIFT","brake · on bike","bike"],["SPACE","hold to preload, release on a lip to pop · on bike","bike"],["MOUSE","aim where to fly — the wing banks and carves round to it · on glider","glide"],["W S","nose down / nose up · on glider","glide"],["SPACE","hold to flare — bleed speed for a clean landing · on glider","glide"],["MOUSE","aim the motor — thrust goes exactly where you look · on the rocket pack","rocket"],["SPACE","let go and you are a falling body; burn back down the way you came to land · on the rocket pack","rocket"],["← →","spin / flip · in the air","air"],["↑ ↓","spin / flip · in the air; on the snow they are W and S","air"],["← →","barrel roll · flying","glide"],["B","reference photos","lab"],["[ ]","cycle refs","lab"],["F8","dev fly mode · noclip + reference compare","lab"]],Pt=B?[...bt,...Ft]:bt;for(const[e,a,o]of It){const i=Pt.filter(l=>l[2]===e);if(!i.length)continue;const s=t("div","ppause__grp"),r=t("div","ppause__grp-hd");r.append(t("span","pmark pmark--"+o),t("span",null,a));const p=t("div","ppause__grp-rows");for(const[l,b,,h]of i){const f=t("div","cap",l),_=t("div","what",b);h==="lift"&&(f.classList.add("is-hidden"),_.classList.add("is-hidden"),Re=f,Ie=_),p.append(f,_)}s.append(r,p),ue.append(s)}ue.childElementCount>1&&ue.classList.add("is-cols");const Fe=t("button","btn btn--accent ppause__big","click to resume");Fe.type="button";const _t=t("a","btn btn--ghost","return to bench");_t.href="/#/run/"+encodeURIComponent(d)+"/"+encodeURIComponent(n);const Pe=t("button","btn btn--ghost","respawn");Pe.type="button";const xt=t("div","ppause__row");xt.append(Fe);const kt=t("div","ppause__row");B&&kt.append(_t,Pe,t("span","lbl","adapter · "+E));const Ht=t("div","ppause__credit","terrain USGS 3DEP · trails © OpenStreetMap contributors (ODbL)");gt.append(ue,xt,kt,Ht),mt.append(ft,gt),$.append(mt),u.append($);const U=t("div","pboard");U.hidden=!0;const vt=t("section","panel pboard__panel"),wt=t("div","panel__hd");wt.append(t("span","lbl lbl--accent","personal best"),t("span","spacer"),t("span","lbl","l l · esc close"));const ne=t("div","panel__bd pboard__bd");vt.append(wt,ne),U.append(vt),u.append(U);const yt=e=>Math.round(Number(e)||0).toLocaleString("en-US"),$t=["rk","sc","mu","bt","sk","tr","wh"];function Et(e,a){const o=t("div","pboard__row"+(e?" "+e:""));return a.forEach((i,s)=>o.append(t("span",$t[s],i))),o}function Dt(e){if(ne.textContent="",ne.append(Et("pboard__row--hd",["#","score","mult","best trick","ski","trail","when"])),!e.length){ne.append(t("div","pboard__empty","no runs banked yet · land a combo"));return}for(const a of e)ne.append(Et(a&&a.you?"is-you":"",[String(a.rank!=null?a.rank:"—"),yt(a.score),"×"+(a.mult!=null?a.mult:1),a.best||"—",a.ski||"—",a.trail||"—",a.when||"—"]))}function me(){U.hidden=!0}U.style.pointerEvents="auto",U.addEventListener("click",e=>{e.stopPropagation(),me()}),$.style.pointerEvents="auto",Fe.addEventListener("click",e=>{e.stopPropagation(),w&&w()}),Pe.addEventListener("click",e=>{e.stopPropagation(),L&&L()}),$.addEventListener("click",()=>w&&w()),document.body.appendChild(u);let fe=0,He=0,Tt=performance.now();const $e=e=>(e>=0?" ":"")+e.toFixed(1);let ge=!1;function St(){const e=!$.hidden;for(const a of[ie,se,y,S,g,P,N,v,z,R,oe])a.classList.toggle("is-hidden",e);for(const a of[ut,I])a.classList.toggle("is-hidden",e||ge);O&&(O.classList.toggle("is-hidden",e),O.hidden=!ge)}return{root:u,pause:$,setPaused(e){$.hidden=!e,e&&(ce(),me()),St()},isPaused(){return!$.hidden},setDev(e){ge=!!e,k.dev.classList.toggle("is-on",ge),St()},devTick(e){if(O){for(const a of Object.keys(_e))e[a]!=null&&(_e[a].textContent=e[a]);e.params!=null&&(J.textContent=e.params),e.url!=null&&(Ue=e.url)}},lipMeter(e){if(!T)return;const a=!!e&&!!e.on;if(T.box.hidden=!a,!a)return;const o=e.s,i=e.T,s=T.rows,r=(c,Mt=2)=>(c>=0?"+":"")+Number(c||0).toFixed(Mt);s["surface vy"].textContent=r(o.surfVy)+" m/s "+(o.surfVy>.05?"UP":o.surfVy<-.05?"down":"flat"),s.reference.textContent=r(o.vyFloor)+" m/s",s.compression.textContent=r(o.comp)+" m/s",s["ramp x K"].textContent=r(o.lipRamp),s["comp x K"].textContent=r(o.lipComp);const p=(o.lipRamp||0)+(o.lipComp||0);s.charge.textContent=(o.lipVy>0?Number(o.lipVy).toFixed(2):"0.00")+" / "+Number(i.lipMax).toFixed(2)+(o.lipVy>0?"":p>0?"  < lipMin":o.lipRamp<0?"  ramp negative":"");const l=c=>Math.max(0,Math.min(100,100*c/(i.lipMax||1))),b=l(Math.max(0,o.lipRamp));T.barR.style.width=b.toFixed(1)+"%",T.barC.style.left=b.toFixed(1)+"%",T.barC.style.width=l(o.lipComp).toFixed(1)+"%",T.barMin.style.left=l(i.lipMin).toFixed(1)+"%";const h=o.sincePop==null?1e9:o.sincePop;let f;!e.grounded&&o.airT>0?f=o.popPaid?"spent":o.lipVy>0&&o.airT<=i.popCoyote?"COYOTE "+(i.popCoyote-o.airT).toFixed(2)+"s left":"closed":o.lipVy>0?f=h<=i.popWindow?"ARMED (popped "+h.toFixed(2)+"s ago)":"at lip · pop now":f="no charge";const _=o.dVyS||0,m=o.gravity||16;s["surface accel"].textContent=r(_,1)+" / -"+m.toFixed(0)+(_<-m?"  PAST FREE FALL":""),s["snap release"].textContent=o.dropK>0?(100*o.dropK).toFixed(0)+"%  "+Number(o.snapFull).toFixed(2)+" -> "+Number(o.snapCut).toFixed(2)+" m":"glued  "+Number(o.snapFull||0).toFixed(2)+" m",s["pop window"].textContent=f;const C=e.pop;if(s["pop now"].textContent=C?Number(C.total).toFixed(2)+" m/s"+(C.add>.005?"  (+"+C.add.toFixed(2)+")":"")+(C.add<=.005&&C.compRaw>.5?"  "+C.gate.toUpperCase():""):"—",s.state.textContent=(e.grounded?"on snow":"air "+Number(o.airT).toFixed(2)+"s")+(o.lipVy>0?" · charged":""),e.launch){const c=e.launch;T.shot.textContent="takeoff "+(c.total>.01?"+"+c.total.toFixed(2)+" m/s":"flat")+"  ["+c.src.toUpperCase()+"]"+(c.drop?`
  DROP-AWAY  snap `+Number(c.snapFull).toFixed(2)+" -> "+Number(c.snapCut).toFixed(2)+" m ("+(100*c.dropK).toFixed(0)+`% let go)
  surface `+r(c.dVyS,1)+" vs -"+c.grav.toFixed(0)+", past free fall":"")+(c.total>.01?`
  ramp `+r(c.ramp)+"  comp "+r(c.comp)+"  -> charge "+c.charge.toFixed(2)+(c.pop>0?`
  pop bonus +`+c.pop.toFixed(2):"")+(c.restored>0?"  (jump restored +"+c.restored.toFixed(2)+")":""):c.drop?"":`
  no charge (ramp `+r(c.ramp)+" comp "+r(c.comp)+")")+(c.eaten?`
  SWALLOWED, still on the snow next frame`:""),T.shotT=2}else T.shotT>0&&(T.shotT-=e.dt||.016,T.shotT<=0&&(T.shot.textContent="takeoff —"))},setLiftKey(e){re=!!e,k.lift.classList.toggle("is-hidden",!re),Re&&Re.classList.toggle("is-hidden",!re),Ie&&Ie.classList.toggle("is-hidden",!re)},setPrompt(e){if(!e){g.hidden=!0,g.classList.remove("is-press"),k.lift.classList.remove("is-on");return}pe=e.key||"F",Be.textContent=xe?"TAP":pe,g.dataset.key=We(pe),g.dataset.tap=xe?"1":"0",g.dataset.fires=String(ve),ke.textContent=" "+(e.text||""),g.hidden=!1,k.lift.classList.add("is-on")},promptText(){return g.hidden?null:ke.textContent.trim()},setFuel(e,a,o,i=!0){const s=Math.max(0,Math.min(1,Number(e)||0));if(Z=!!a&&!!i,qe=!!i,P.hidden=!i||s>.999&&!Z,P.hidden){k.boost.classList.remove("is-on");return}Ge.style.width=(s*100).toFixed(1)+"%",P.classList.toggle("is-burn",Z),P.classList.toggle("is-dry",!!o),k.boost.classList.toggle("is-on",Z)},fuelShown(){return!P.hidden},flashGear(e){y.classList.remove("is-refusal"),y.textContent="gear · "+e,y.hidden=!1,Y=1.4},...Rt,flash(e){const a=String(e??""),o=/\b(first|failed|blank|empty)\b/i.test(a);y.textContent="",o&&y.append(t("span","pmark pmark--x")),y.append(t("span",null,a)),y.classList.toggle("is-refusal",o),y.hidden=!1,Y=1.4},trick(e){const a=e.name==="wipeout";if(Ve.textContent=a?"WIPEOUT":e.name+"!",a){const o=Math.round(Q*3.6);q(Je,o+" KM/H"+(e.deg?" · "+e.deg+"°":""))}Xe.textContent=a?Yt[e.why]||(e.deg?e.deg+"° · unfinished":"skis crossed"):e.deg+"°",S.classList.toggle("is-wipe",a),S.hidden=!1,S.classList.remove("is-pop","is-snap","is-late","is-gone-word","is-gone-line"),S.offsetWidth,S.classList.add(a?"is-snap":"is-pop"),we=a,j=a?1.96:1.8},pump(e){const a=!!(e&&e.on),o=performance.now(),i=ye?Math.min(.1,(o-ye)/1e3):.016;if(ye=o,!a){X=0,N.hidden=!0;return}const s=Math.max(.001,Number(e.max)||4),r=Math.max(0,Math.min(1,(Number(e.q)||0)/s)),p=!!e.releasing;if(p?X=Math.max(r,X-i/.35):X=r,X<.004&&!p){N.hidden=!0;return}Ze.style.setProperty("--pf",(X*100).toFixed(1)+"deg");const l=Number(e.eta),b=!(l<1.2),h=l<.8;N.classList.toggle("is-hot",b&&Number.isFinite(l)),N.classList.toggle("is-cold",h),N.classList.toggle("is-rel",p),N.hidden=!1},pumpShown(){return!N.hidden},airTimer(e){if(!!(e&&e.air)){const o=Number(e.t)||0;q(Qe,o.toFixed(2)),q(et,e&&e.unit==="JIB"?"JIB":"AIR");const i=Xt(o),r=(Math.min(1,o*10/Me[Me.length-1])*100).toFixed(1)+"%",p=10+i*2+"px";r!==tt&&(de.style.setProperty("--af",r),tt=r),p!==at&&(de.style.setProperty("--aw",p),at=p),v.classList.contains("is-out")&&v.classList.remove("is-out"),v.hidden=!1,W=.6,H=0,le=!0;return}le=!1,!v.hidden&&W<=0&&H<=0&&(H=.3,v.classList.add("is-out"))},airTimerShown(){return!v.hidden},combo(e){if(!e||!e.on){z.hidden=!0,ae=-1,Te="";return}q(ot,"×"+(e.mult!=null?e.mult:1));const a=Array.isArray(e.names)?e.names.filter(Boolean):[],o=a.slice(-2).join(" · ");q(Ee,o),Ee.classList.toggle("is-hidden",!o),nt.classList.toggle("is-hidden",!o);const i=e.quality==="sketchy"?"SKETCHY":e.quality==="clean"?"CLEAN":"";q(te,i),te.classList.toggle("is-hidden",!i),it.classList.toggle("is-hidden",!i||!o),te.classList.toggle("is-clean",e.quality==="clean"),te.classList.toggle("is-sketchy",e.quality==="sketchy"),Nt(a,e.quality,!1);const s=Number(e.graceMax)||2,r=Math.max(0,Math.min(1,1-(Number(e.grace)||0)/s));rt.style.width=(r*100).toFixed(1)+"%";const p=Number(e.count)||0;p!==ae&&(ae>=0&&p>ae&&(ee.classList.remove("is-pop"),ee.offsetWidth,ee.classList.add("is-pop")),ae=p),z.hidden=!1},comboShown(){return!z.hidden},comboEnd(e){if(!e)return;const a=!!e.bailed,o=!!e.pb&&!a;Se.textContent="+"+yt(e.score),Se.classList.toggle("is-hidden",a),Ce.textContent="×"+(e.mult!=null?e.mult:1),Ce.classList.toggle("is-hidden",!a),dt.classList.toggle("is-hidden",!o),lt.classList.toggle("is-hidden",!a),R.classList.toggle("is-bail",a);const i=le&&!v.hidden;R.classList.toggle("is-s3",i),i||(v.hidden=!0,W=0,H=0,le=!1),R.classList.remove("is-snap","is-rise"),R.offsetWidth,R.classList.add(i?"is-rise":"is-snap"),R.hidden=!1,he=a?.8:1.2},board(e){if(!e){me();return}Dt(Array.isArray(e)?e:[]),U.hidden=!1},boardOpen(){return!U.hidden},closeBoard:me,setBoardDot(e){oe.hidden=!e},tick(e,a,o){const i=e.position,s=e.mode,r=s==="skis",p=s==="bike",l=s==="glider",b=s==="rocket",h=s!=="boots",f=e.speed();if(Q=f>Q?f:Math.max(0,Q-Q*(a/.5)),x.pos.textContent=`${$e(i.x)} ${$e(i.y)} ${$e(i.z)}`,x.spd.textContent=f.toFixed(2)+" m/s",x.gear.textContent=s,x.gear.classList.toggle("is-hot",h),x.cam.textContent=o==="tp"?"chase":"first person",Z)x.state.textContent="BOOST";else if(l&&!e.grounded){const m=Ut(),C=e.velocity?e.velocity.y:0;x.state.textContent=m.stall>.35?"STALL":m.flare?"flare":m.updraft>.8?"lift +"+m.updraft.toFixed(1):C>.5?"climb":C<-6?"dive":"glide · "+m.airspeed.toFixed(0)}else if(b&&!e.grounded){const m=e.velocity?e.velocity.y:0;x.state.textContent="coast · "+(m<0?"−":"+")+Math.abs(m).toFixed(0)}else if(e.grounded)if(e.wipeT>0)x.state.textContent="wipeout";else if(r){const m=Bt();x.state.textContent=m.chatter>.35?"CHATTER":m.stop===2?"HOCKEY":m.stop===1?"plow":m.stivoting?"stivot":m.releasing?"PUMP":f>3?"carve":"skate"}else p?x.state.textContent=e.keys.sprint?"brake":e.keys.jumpHeld?"preload":e.keys.back?"pump":f>3?"ride":"pedal":x.state.textContent=e.keys.sprint&&f>5?"sprint":"ground";else{const m=Math.abs(e.airSpinDeg||0);x.state.textContent=m>45?"air · "+Math.round(m)+"°":"air"}k.move.classList.toggle("is-on",e.keys.forward||e.keys.back||e.keys.left||e.keys.right),k.sprint.classList.toggle("is-on",!!e.keys.sprint),k.sprint.classList.toggle("is-hidden",r),k.sprint.lastChild.nodeValue=p?"brake":"sprint",k.jump.classList.toggle("is-on",!e.grounded),k.gear.classList.toggle("is-on",h),k.boost.classList.toggle("is-hidden",!(b||qe)),k.spin.classList.toggle("is-on",!!(e.keys.spinLeft||e.keys.spinRight)),k.cam.classList.toggle("is-on",o==="tp"),Y>0&&(Y-=a,Y<=0&&(y.hidden=!0)),j>0&&(j-=a,we&&(j<=1.56&&S.classList.add("is-late"),j<=.36&&S.classList.add("is-gone-word"),j<=.2&&S.classList.add("is-gone-line")),j<=0&&(S.hidden=!0,we=!1)),he>0&&(he-=a,he<=0&&(R.hidden=!0)),!v.hidden&&W>0?(W-=a,W<=0&&(W=0,H=.3,v.classList.add("is-out"))):!v.hidden&&H>0&&(H-=a,H<=0&&(H=0,v.hidden=!0,v.classList.remove("is-out"))),fe+=a,He++;const _=performance.now();_-Tt>400&&(Ct.textContent=fe>0?String(Math.round(He/fe)):"—",fe=0,He=0,Tt=_)}}}export{sa as createHud,ia as hudFont,Gt as hudKind,qt as hudMark,Vt as hudMotion,Kt as hudSurf,De as hudType};
