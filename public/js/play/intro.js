// The public boot flow: one title card, one controls card, then you are skiing.
//
// PROMOTED to bench source by specs/0003 (was tools/export-red-dog/templates/).
// It is ordinary player source now: edit it HERE, commit, bump the exporter pin.
//
// It deliberately owns nothing: the world is already built and rendering behind
// it (main.js starts the frame loop before this module is imported), the cards
// are two absolutely-positioned divs, and dismissing them calls the player's own
// `enter()` — the exact path a click on the canvas has always taken.
//
// Attribution (ODbL) is rendered HERE, in the product, not only in the repo.

// specs/0027 — the venue name is per-world, so it comes from the one table the
// D9 audit reads. The CREDIT below is NOT: USGS 3DEP and OpenStreetMap are
// every world's sources, word for word.
import { pickBrand } from './flags.js';

const CREDIT = 'terrain USGS 3DEP · trails © OpenStreetMap contributors (ODbL)';
const HOLD_MS = 2400;          // how long the title card sits before the controls
const COARSE = matchMedia('(pointer: coarse)').matches;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// Belt and braces: index.html ships `intro-up` in the static markup so the
// legacy pause panel and the instrument HUD never paint behind these cards.
// Re-assert it here in case this module is ever loaded against a stale page.
document.body.classList.add('intro-up');

const root = el('div', 'intro');
root.setAttribute('role', 'dialog');
root.setAttribute('aria-label', pickBrand({ lab: 'Red Dog Chair', 'RED DOG': 'Red Dog Chair', SIBERIA: 'Siberia Express' }));

// ---- card 1: where you are
const title = el('section', 'intro__card intro__card--title');
title.append(
  el('h1', 'intro__h1', pickBrand({ lab: 'RED DOG CHAIR', 'RED DOG': 'RED DOG CHAIR', SIBERIA: 'SIBERIA EXPRESS' })),
  el('p', 'intro__sub', 'Palisades Tahoe · Olympic Valley, California'),
  el('p', 'intro__credit', CREDIT),
);

// ---- card 2: the only controls anyone needs
//
// The desktop list is FIVE rows and it is the same five, in the same order, as
// the ESC panel (hud.js). Two lists that differ by one row is worse than either
// list on its own, so the gate asserts they match. ESC comes first because it is
// the row that tells you the other four are still findable after this card is
// gone.
//
// THE PHONE DOES NOT GET A LIST AT ALL (Greg, 2026-09-01). A key list is the
// wrong object on a device with no keys: the old four rows read "DRAG LEFT =
// carve", which is a sentence about a gesture, and a sentence about a gesture is
// a worse teacher than a picture of one. touch.js's left half is an anchored
// stick now, and a stick is drawn, not spelled. So the touch card is a DIAGRAM
// of the two halves of the glass — the thing the player is about to be holding —
// with three captions on it and nothing else.
//
// Same card furniture either way (the h2, the go line, the ODbL credit), because
// the guided run's skip line below inserts itself before `.intro__credit` and
// the gate reads that credit on both screens.
const controls = el('section', 'intro__card intro__card--' + (COARSE ? 'touch' : 'keys'));
controls.hidden = true;
const cardBody = COARSE ? touchDiagram() : keyList();
controls.append(
  el('h2', 'intro__h2', 'CONTROLS'),
  cardBody,
  el('p', 'intro__go', COARSE ? 'tap to drop in' : 'click to drop in'),
  el('p', 'intro__credit', CREDIT),
);

function keyList() {
  const keys = el('div', 'intro__keys');
  const ROWS = [
    ['ESC', 'settings'], ['W A S D', 'move'], ['← →', 'tricks in the air'],
    ['C', 'camera'], ['R', 'reset'],
  ];
  for (const [cap, what] of ROWS) keys.append(el('div', 'intro__cap', cap), el('div', 'intro__what', what));
  return keys;
}

// ---- the phone diagram.
//
// One frame the shape of the glass, split down the middle by the same line
// touch.js splits it on (`x < innerWidth / 2`), with a glyph and a caption in
// each half and the one gesture that belongs to neither underneath. It is drawn
// in the HUD's own language — the instrument plate, the #ff4d00 accent, the
// hairline — so the first screen and the game look like the same object.
//
// The captions are HTML, not SVG <text>: `document.body.innerText` is what the
// export gate reads for banned strings and for what a player can actually read,
// and it does not see inside an <svg>. A control card whose words are invisible
// to that check is a control card nobody is checking.
//
// The CSS is injected FROM HERE rather than added to css/intro.css because this
// card only ever exists on a coarse pointer; a desktop build should not carry
// rules for an element it can never build. It is also why the whole thing is
// scoped under `.intro__card--touch`.
function touchDiagram() {
  document.head.appendChild(el('style', null, `
.intro__card--touch .intro__td {
  display: grid; grid-template-columns: 1fr 1fr;
  width: min(300px, 84vw); margin: 0 auto;
  border: 1px solid rgba(244, 241, 234, .20); border-radius: 14px;
  background: rgba(23, 22, 20, .34);
  box-shadow: inset 0 0 0 1px rgba(23, 22, 20, .35);
  overflow: hidden;
}
.intro__card--touch .intro__tz {
  display: flex; flex-direction: column; align-items: center; gap: 9px;
  padding: 15px 9px 14px;
}
.intro__card--touch .intro__tz + .intro__tz { border-left: 1px dashed rgba(244, 241, 234, .22); }
.intro__card--touch .intro__tg { display: block; width: 54px; height: 54px; }
.intro__card--touch .intro__tk {
  font: 700 0.64rem / 1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .13em; text-transform: uppercase; color: #ffd9c4;
  text-align: center; text-wrap: balance;
}
.intro__card--touch .intro__tf {
  margin: 0.85rem 0 0;
  font: 700 0.62rem / 1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: .2em; text-transform: uppercase; opacity: .8;
}
`));

  const svg = (inner) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'intro__tg');
    s.setAttribute('viewBox', '0 0 56 56');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = inner;
    return s;
  };
  const FAINT = 'rgba(244,241,234,.42)';
  const LINE = 'rgba(244,241,234,.34)';

  // LEFT — the stick, drawn deflected so it reads as a thing that moves, with
  // the four directions ticked round it.
  const stick = svg(`
    <circle cx="28" cy="28" r="18.5" fill="rgba(23,22,20,.34)" stroke="${LINE}" stroke-width="1.5"/>
    <circle cx="28" cy="28" r="1.6" fill="${FAINT}"/>
    <circle cx="34.5" cy="22.5" r="7.5" fill="#ff4d00"/>
    <path d="M28 1.5 L31.6 8 L24.4 8 Z" fill="${FAINT}"/>
    <path d="M28 54.5 L24.4 48 L31.6 48 Z" fill="${FAINT}"/>
    <path d="M1.5 28 L8 24.4 L8 31.6 Z" fill="${FAINT}"/>
    <path d="M54.5 28 L48 31.6 L48 24.4 Z" fill="${FAINT}"/>`);

  // RIGHT — a tap (the ripple) and a drag (the arrow), in one glyph, because
  // they are one finger doing two things depending on whether it moves.
  const look = svg(`
    <circle cx="19" cy="20" r="5.5" fill="#ff4d00"/>
    <circle cx="19" cy="20" r="10.5" fill="none" stroke="${LINE}" stroke-width="1.5"/>
    <circle cx="19" cy="20" r="15.5" fill="none" stroke="rgba(244,241,234,.17)" stroke-width="1.5"/>
    <path d="M14 41 C 24 47, 36 45, 44 36" fill="none" stroke="${FAINT}" stroke-width="2"
          stroke-linecap="round" stroke-dasharray="0.1 5.4"/>
    <path d="M45.5 30.5 L47 38.5 L39.5 36 Z" fill="${FAINT}"/>`);

  const zone = (glyph, cap) => {
    const z = el('div', 'intro__tz');
    z.append(glyph, el('b', 'intro__tk', cap));
    return z;
  };

  const wrap = el('div');
  const td = el('div', 'intro__td');
  // Written in the case they are RENDERED in. `text-transform: uppercase` means
  // innerText — what the gate reads and what a player reads — is upper either
  // way, and a source string that differs from the screen string only sets a
  // trap for the next person writing an assertion (verify.mjs already carries
  // that scar for the idle banner).
  td.append(zone(stick, 'MOVE'), zone(look, 'TAP JUMP · DRAG LOOK'));
  wrap.append(td, el('p', 'intro__tf', 'DOUBLE-TAP · RESET'));
  return wrap;
}

// ---- ONE LINE about the way out. Greg: the tutorial "tells you when you
// start" that it can be skipped.
//
// It is a LINE, not a sixth row. The five control rows are asserted here and in
// the ESC panel against one shared constant precisely so the two lists cannot
// drift, and buying this sentence with a row would have cost that. It sits with
// the go/credit lines instead, where the card already puts the things that are
// about the card rather than about the mountain.
//
// ...and it is only printed if there is actually something to skip. guide.js
// has already run by the time this module is imported (main.js sets
// __playerReady at the end of itself, and index.html chains this after), so
// "did the guided run build a course" is a question with an answer here — and
// promising a skip key on a boot where the tutorial never started would be
// worse than saying nothing.
try {
  const g = window.__guide;
  const st = g && typeof g.state === 'function' ? g.state() : null;
  const key = g && typeof g.skipKey === 'function' ? g.skipKey() : null;
  if (st && st.ok && Array.isArray(st.stages) && st.stages.length && key) {
    controls.insertBefore(
      el('p', 'intro__go', `guided run · hold ${key.cap} any time to skip it`),
      controls.querySelector('.intro__credit'),
    );
  }
} catch { /* no guided run in this build — the card is the card */ }

root.append(title, controls);
document.body.appendChild(root);
requestAnimationFrame(() => root.classList.add('is-in'));

let stage = 0;              // 0 = title, 1 = controls, 2 = gone
let timer = setTimeout(() => advance(), HOLD_MS);

function advance() {
  clearTimeout(timer);
  if (stage === 0) {
    stage = 1;
    title.hidden = true;
    controls.hidden = false;
    return;
  }
  if (stage === 1) {
    stage = 2;
    root.classList.remove('is-in');
    root.classList.add('is-out');
    setTimeout(() => root.remove(), 320);
    // hand the screen back to the player exactly the way a canvas click does.
    // enter() first, THEN un-suppress: on the desktop it un-pauses, so the
    // pause panel is already hidden by the time the class comes off and the
    // panel never flashes on its way out either.
    const p = window.__player;
    if (p && typeof p.enter === 'function') p.enter();
    document.body.classList.remove('intro-up');
    detach();
  }
}

function onKey(e) {
  if (e.key === 'F5' || e.key === 'F12' || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  advance();
}
function onTap(e) { e.preventDefault(); e.stopPropagation(); advance(); }

function detach() {
  removeEventListener('keydown', onKey, true);
  root.removeEventListener('pointerdown', onTap);
}
addEventListener('keydown', onKey, true);
root.addEventListener('pointerdown', onTap);

// so a test (and the pause panel's own resume) can skip it deterministically.
// `card` is which controls card this boot built — the five-row key list, or the
// phone diagram — so a gate can assert the branch rather than infer it from a
// count of `.intro__cap` nodes that the touch card deliberately no longer has.
window.__intro = {
  skip: () => { while (stage < 2) advance(); },
  stage: () => stage,
  card: () => (COARSE ? 'touch' : 'keys'),
};
