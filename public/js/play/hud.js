// TE-styled instrument overlay for the player: readout, legend, crosshair,
// pause panel. Deliberately small — the world is the thing.

import { gliderState } from './glider.js';
import { skiState } from './ski.js';
import { DEBUG_HUD, BRAND, pick, pickBrand } from './flags.js';

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

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function createHud({ poi, run, adapter, onResume, onRespawn }) {
  const root = el('div', 'phud');

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
    lipEls = { box, rows: rows2, barR, barC, barMin, shot, shotT: 0 };
  }

  // ---- fps
  const fps = el('div', 'phud__fps pchip');
  fps.append(el('span', 'k', 'fps '), el('span', 'v', '—'));
  const fpsVal = fps.lastChild;
  if (DEBUG_HUD) root.append(fps);

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
    devTitle.append(el('span', 'dot'), el('b', null, 'DEV FLY'));
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
      const done = () => { toast.textContent = 'copied · ' + what; toast.hidden = false; toastT = 1.2; };
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
  // B refs and F8 dev are the LAB's own instruments (`debugHud`), so they are on
  // the strip in the bench and dark in the shareable build.
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
    refs: DEBUG_HUD ? mk('B', 'refs') : dark('B', 'refs'),
    dev: DEBUG_HUD ? mk('F8', 'dev') : dark('F8', 'dev'),
    pause: mk('ESC', 'pause'),
  };
  keyEls.lift.classList.add('is-hidden');       // shown only if the world has lifts
  keyEls.boost.classList.add('is-hidden');      // shown only in the rocket gear
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
  const promptEl = el('div', 'phud__prompt pchip');
  promptEl.hidden = true;
  const promptKey = el('b', null, 'F');
  const promptTxt = el('span', null, '');
  promptEl.append(promptKey, promptTxt);
  root.append(promptEl);
  let hasLifts = false;

  // ---- rocket fuel (G, boost.js). One slim bar, and it only exists when it has
  // something to say: you are wearing the rocket, and it is burning or refilling
  // after a burn. A permanently full gauge is furniture, and a gauge for a tank
  // the gear you are wearing cannot spend is a lie.
  const fuel = el('div', 'phud__fuel');
  fuel.hidden = true;
  const fuelLbl = el('span', 'phud__fuel-lbl', 'boost');
  const fuelBar = el('span', 'phud__fuel-bar');
  const fuelFill = el('i');
  fuelBar.append(fuelFill);
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
  const trick = el('div', 'phud__trick');
  trick.hidden = true;
  const trickBig = el('div', 'phud__trick-big');
  const trickSub = el('div', 'phud__trick-sub');
  trick.append(trickBig, trickSub);
  root.append(trick);
  let trickT = 0;

  // ---- pump arc (§1.10). A thin arc sitting just under the crosshair: the
  // carve bank filling, then emptying into the release. Same rule as setFuel —
  // it only exists when it has something to say. A gauge that is permanently
  // empty is furniture, and the pump is empty for most of a run (every
  // transition zeroes the bank), so an always-on arc would read as broken.
  const pump = el('div', 'phud__pump');
  pump.hidden = true;
  const pumpArc = el('i', 'phud__pump-arc');
  pump.append(pumpArc);
  root.append(pump);
  // ski.js zeroes the bank AT the transition and then pays out over 0.35 s, so
  // by the time the release is visible there is no `q` left to draw. The drain
  // is therefore ours to animate — otherwise the arc snaps to nothing at the one
  // instant the player is actually looking at it for feedback.
  let pumpVal = 0, pumpLast = 0;

  // ---- combo strip (§3.7). Live, bottom-centre, only during a combo: the
  // unbanked total and the multiplier. Deliberately NOT the panel-chip
  // language the banked readout uses — an unbanked score is a thing you can
  // still lose, and it should not look like something you own.
  const combo = el('div', 'phud__combo');
  combo.hidden = true;
  const comboScore = el('span', 'phud__combo-score', '0');
  const comboX = el('span', 'phud__combo-x', '×');
  const comboMult = el('span', 'phud__combo-mult', '1');
  const comboN = el('span', 'phud__combo-n', '');
  combo.append(comboScore, comboX, comboMult, comboN);
  root.append(combo);

  // ---- end-of-combo banner (§3.7). 2.4 s, on the same decay clock as the
  // trick stamp and the gear toast. This is the receipt: what the line was
  // worth, what it was multiplied by, and every trick that went into it.
  const cend = el('div', 'phud__cend');
  cend.hidden = true;
  const cendCap = el('div', 'phud__cend-cap', 'combo');
  const cendTot = el('div', 'phud__cend-tot');
  const cendScore = el('span', 'phud__cend-score', '0');
  const cendMult = el('span', 'phud__cend-mult', '×1');
  cendTot.append(cendScore, cendMult);
  const cendList = el('div', 'phud__cend-list', '');
  const cendSub = el('div', 'phud__cend-sub', '');
  cend.append(cendCap, cendTot, cendList, cendSub);
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
    const refCap = el('div', 'phud__ref-cap');
    ref.append(refImg, refCap);
    root.append(ref);
    let refItems = [], refIdx = 0;
    fetch('/api/poi/' + encodeURIComponent(poi))
      .then((r) => r.json())
      .then((p) => { refItems = [...(p.aerials || []), ...(p.photos || [])]; })
      .catch(() => {});
    const refShow = () => {
      if (!refItems.length) { refCap.textContent = 'no reference bundle'; return; }
      refIdx = (refIdx + refItems.length) % refItems.length;
      const it = refItems[refIdx];
      refImg.src = it.url.replace('/files/', '/thumb/') + '?w=900';
      refCap.textContent = it.name.replace(/\.(jpe?g|png|webp)$/i, '') + ' · ' + (refIdx + 1) + '/' + refItems.length + ' · [ ] cycle · B close';
    };
    const typing = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    addEventListener('keydown', (e) => {
      if (!gmenu.hidden) return;                    // gear menu owns the keyboard
      if (typing(e.target)) return;                 // the dev note field
      if (document.body.classList.contains('is-dev')) return;   // dev.js owns [ ]
      if (e.code === 'KeyB') { ref.hidden = !ref.hidden; if (!ref.hidden) refShow(); }
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
  //   E / I / G / B / [ ] / F8  hidden features stay undocumented (D34)
  const FIVE_ROWS = [
    ['ESC', 'settings'],
    ['W A S D', 'move'],
    ['← →', 'tricks in the air'],
    ['C', 'camera'],
    ['R', 'reset'],
  ];
  // specs/0003 — `debugHud`. The LAB keeps the full reference underneath the
  // five, because the lab is the superset: it has the bike, the glider and the
  // rocket pack on the gear menu, and a world builder who cannot look up the
  // glider's flare key has to go and read glider.js. The shareable build ships
  // the five and nothing else.
  const LAB_ROWS = [
    ['SHIFT', 'sprint'], ['SPACE', 'jump'], ['MOUSE', 'look'],
    ['E', 'gear · tap toggles, hold for menu'],
    ['I', 'inventory · the ski rack, and every other gear type'],
    ['SPACE', 'hold to thrust · on the rocket pack — 6 s of fuel, refills itself at 1×'],
    ['F', 'ride the chairlift · at a base terminal', 'lift'],
    ['A D', 'carve · on skis'],
    // S and W are one signed push along the ski axis (§2.1): whichever one
    // opposes the way you are actually travelling is the brake, so the same key
    // is "stop" going forward and "go" going backward.
    //
    // There is NO SHIFT ROW FOR SKIS, on purpose: SHIFT does nothing on skis at
    // all now — not a brake, not a tuck — and a key listed here that does
    // nothing when you press it is worse than no line.
    ['S', 'stop · on skis; moving backward it drives instead'],
    ['W', 'skate · on skis; moving backward it stops you'],
    ['W S', 'pedal / pump · on bike'], ['SHIFT', 'brake · on bike'],
    ['SPACE', 'hold to preload, release on a lip to pop · on bike'],
    ['MOUSE', 'aim where to fly — the wing banks and carves round to it · on glider'],
    ['W S', 'nose down / nose up · on glider'],
    ['SPACE', 'hold to flare — bleed speed for a clean landing · on glider'],
    ['MOUSE', 'aim the motor — thrust goes exactly where you look · on the rocket pack'],
    ['SPACE', 'let go and you are a falling body; burn back down the way you came to land · on the rocket pack'],
    // the arrows are the two trick axes now (§3.1). On the snow ↑ ↓ are still
    // exact aliases of W and S, so the row says so rather than pretending they
    // are air-only keys.
    ['← →', 'spin / flip · in the air'],
    ['↑ ↓', 'spin / flip · in the air; on the snow they are W and S'],
    ['← →', 'barrel roll · flying'],
    // (no second C or R row: the five above already carry them)
    ['B', 'reference photos'], ['[ ]', 'cycle refs'],
    ['F8', 'dev fly mode · noclip + reference compare'],
  ];
  for (const [cap, what, only] of (DEBUG_HUD ? [...FIVE_ROWS, ...LAB_ROWS] : FIVE_ROWS)) {
    const c = el('div', 'cap', cap), w = el('div', 'what', what);
    if (only === 'lift') { c.classList.add('is-hidden'); w.classList.add('is-hidden'); liftCap = c; liftWhat = w; }
    keys.append(c, w);
  }
  const resume = el('button', 'btn btn--accent ppause__big', 'click to resume');
  resume.type = 'button';
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

  document.body.appendChild(root);

  let fpsAcc = 0, fpsN = 0, fpsLast = performance.now();
  const fmt = (v) => (v >= 0 ? ' ' : '') + v.toFixed(1);

  // Instruments go dark behind the pause panel — one thing to read at a time —
  // and the player's own readout steps aside for the dev readout, which sits in
  // the same corner. Both switches land here so neither can undo the other.
  let devOn = false;
  function paintInstruments() {
    const paused = !pause.hidden;
    for (const n of [fps, legend, toast, trick, promptEl, fuel, pump, combo, cend, bdot]) n.classList.toggle('is-hidden', paused);
    for (const n of [cross, read]) n.classList.toggle('is-hidden', paused || devOn);
    if (devRead) { devRead.classList.toggle('is-hidden', paused); devRead.hidden = !devOn; }
  }

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
      const on = !!f && !!f.on;
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
    setPrompt(p) {
      if (!p) { promptEl.hidden = true; keyEls.lift.classList.remove('is-on'); return; }
      promptKey.textContent = p.key || 'F';
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
      toast.textContent = 'gear · ' + mode;
      toast.hidden = false;
      toastT = 1.4;
    },
    ...hudApiGear,
    flash(text) {
      toast.textContent = text;
      toast.hidden = false;
      toastT = 1.4;
    },
    // { name: '360'|'720'|'1080'|'wipeout', deg, why? } — the big centre-screen
    // stamp. `why` is the gear's own verdict: 'landing' when the gear judged the
    // arrival (the wing, the rocket), 'crossed' when the skis went sideways.
    trick(t) {
      const wipe = t.name === 'wipeout';
      trickBig.textContent = wipe ? 'WIPEOUT' : t.name + '!';
      // ...'tree' / 'rock' are the solids (specs/0012), and specs/0018 adds the
      // four the world built and never made solid: a lodge wall, a lift tower or
      // a sign post, somebody standing there, and the furniture.
      trickSub.textContent = wipe
        ? (WIPE_SUB[t.why] || (t.deg ? t.deg + '° · unfinished' : 'skis crossed'))
        : t.deg + '°';
      trick.classList.toggle('is-wipe', wipe);
      trick.hidden = false;
      trick.classList.remove('is-pop');
      void trick.offsetWidth;               // restart the pop animation
      trick.classList.add('is-pop');
      trickT = 1.8;
    },
    // ---- pump arc (§1.10). { on, q, max, eta, releasing }, every frame.
    // `eta` is last transition's efficiency, so the colour is a verdict on the
    // turn you just finished, not a prediction of the one you are in — which is
    // the only thing that can actually be shown, and the thing worth learning.
    pump(p) {
      const on = !!(p && p.on);
      const now = performance.now();
      const dt = pumpLast ? Math.min(0.1, (now - pumpLast) / 1000) : 0.016;
      pumpLast = now;
      if (!on) { pumpVal = 0; pump.hidden = true; return; }
      const max = Math.max(1e-3, Number(p.max) || 4);
      const raw = Math.max(0, Math.min(1, (Number(p.q) || 0) / max));
      const rel = !!p.releasing;
      // charge tracks the bank exactly; the release drains what was there over
      // pumpReleaseT (0.35 s), because ski.js has already spent it by then
      if (rel) pumpVal = Math.max(raw, pumpVal - dt / 0.35);
      else pumpVal = raw;
      if (pumpVal < 0.004 && !rel) { pump.hidden = true; return; }
      pumpArc.style.setProperty('--pf', (pumpVal * 100).toFixed(1) + 'deg');
      const eta = Number(p.eta);
      const hot = !(eta < 1.2), cold = eta < 0.8;      // NaN before the first transition reads neutral-high
      pump.classList.toggle('is-hot', hot && Number.isFinite(eta));
      pump.classList.toggle('is-cold', cold);
      pump.classList.toggle('is-rel', rel);
      pump.hidden = false;
    },
    pumpShown() { return !pump.hidden; },
    // ---- live combo strip (§3.7). { on, score, mult, count }.
    combo(c) {
      if (!c || !c.on) { combo.hidden = true; return; }
      comboScore.textContent = num(c.score);
      comboMult.textContent = String(c.mult != null ? c.mult : 1);
      const n = Number(c.count) || 0;
      comboN.textContent = n > 0 ? n + (n === 1 ? ' trick' : ' tricks') : '';
      comboN.classList.toggle('is-hidden', n <= 0);
      combo.hidden = false;
    },
    comboShown() { return !combo.hidden; },
    // ---- end-of-combo banner (§3.7). { score, mult, tricks, best, deg, pb }.
    comboEnd(c) {
      if (!c) return;
      const pb = !!c.pb;
      cendCap.textContent = pb ? 'personal best' : (c.best || 'combo');
      cendScore.textContent = num(c.score);
      cendMult.textContent = '×' + (c.mult != null ? c.mult : 1);
      const list = Array.isArray(c.tricks) ? c.tricks.filter(Boolean) : [];
      cendList.textContent = list.join(' · ');
      cendList.classList.toggle('is-hidden', !list.length);
      const deg = Math.round(Number(c.deg) || 0);
      cendSub.textContent = deg ? num(deg) + '°' + (pb && c.best ? ' · ' + c.best : '') : (pb && c.best ? c.best : '');
      cendSub.classList.toggle('is-hidden', !cendSub.textContent);
      cend.classList.toggle('is-pb', pb);
      cend.hidden = false;
      cend.classList.remove('is-pop');
      void cend.offsetWidth;                 // restart the pop, same as the trick stamp
      cend.classList.add('is-pop');
      cendT = 2.4;
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
      if (trickT > 0) { trickT -= dt; if (trickT <= 0) trick.hidden = true; }
      if (cendT > 0) { cendT -= dt; if (cendT <= 0) cend.hidden = true; }
      fpsAcc += dt; fpsN++;
      const now = performance.now();
      if (now - fpsLast > 400) {
        fpsVal.textContent = fpsAcc > 0 ? String(Math.round(fpsN / fpsAcc)) : '—';
        fpsAcc = 0; fpsN = 0; fpsLast = now;
      }
    },
  };
}
