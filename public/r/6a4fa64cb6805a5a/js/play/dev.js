// Dev mode — the world-builder's view. F8 detaches a noclip fly camera from the
// player body, drag a reference photo onto the window to compare against it, and
// once the virtual view lines up with the photo, M files a tuning request the
// orchestrator can hand to a builder agent (see harness/TUNING.md).
//
// Physics and gear are frozen while this is on; F8 puts you back exactly where
// the player was standing.
//
// P freezes the frame instead: the exact render at the current pose, painted on
// with three colours, given a prompt, and filed into the same queue with the
// stroke geometry raycast back into the world (specs/0004).
//
// Keys (dev mode only — everything else is swallowed so the world holds still):
//   WASD / arrows  fly, relative to where you are looking
//   SPACE / CTRL   up / down          SHIFT  5x
//   wheel          base speed         [ ]    fov -/+ 2°
//   V              cycle compare · side | overlay | wipe | off
//   M              match this view    ESC    close the dialog
//   P              snapshot + annotate
//
// ...and inside the annotator, where nothing else exists:
//   drag           draw a stroke      1..5   colour (specs/0055 §5.5 — the five
//                                            kind colours, lift/venue/bike/
//                                            landmark/run)
//   Z              undo last stroke   ENTER  file it   ESC  discard
//
// Mouse look is drag-on-canvas (the cursor stays free for the compare UI); if
// something else already holds the pointer lock, raw movement is used instead.

// specs/0055 §1.7 — the kind dialects, imported rather than mirrored. See INK.
import { KINDS } from './markers.js';
// specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI) -- `available()` below.
import { labUI } from './flags.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const MODES = ['side', 'overlay', 'wipe', 'off'];
const MODE_OPACITY = { side: 1, overlay: 0.5, wipe: 1, off: 1 };
const LOOK_SENS = 0.0022;             // same as the player's mouselook

// ---- specs/0004 · snapshot annotations
// specs/0055 §5.5 (D17, "snapshot + annotate: A") + §1.7 — the three free-form
// inks become the FIVE KIND COLOURS the game already owns, so an annotation
// drawn in green reads as a trail note and one in orange as a lift note without
// anyone agreeing a convention. They still carry no ENFORCED meaning — the
// prompt can still say "the orange ones" — and they still have to survive snow,
// rock and sky, which the kind palette was built to do on the boards.
//
// specs/0055 §1.7, W5 hand-off 6 — THE LIST **IS** `markers.js KINDS` NOW.
// W5 mirrored the five colours off te.css's custom properties because W3's
// export had not merged yet; it has, so the mirror is gone and this file reads
// the constants the atlas reads. §10.3's "no panel types a hex after KINDS" is
// literally true here: there is no hex in this file at all.
//
// No cycle: dev.js -> markers.js -> hud.js is a chain, not a ring. (hud.js
// cannot make the same import — markers.js reads `hudType` at module top level,
// so hud.js -> markers.js would evaluate markers.js first, into a dead zone.)
const INK = [
  { name: 'lift', kind: 'lift', hex: KINDS.lift.plate },
  { name: 'venue', kind: 'venue', hex: KINDS.venue.panel },
  { name: 'bike', kind: 'bike-trail', hex: KINDS['bike-trail'].plate },
  { name: 'landmark', kind: 'landmark', hex: KINDS.landmark.plate },
  { name: 'run', kind: 'ski-run', hex: KINDS['ski-run'].panel },
];
// Kept as a no-op call site rather than deleted: every ink now arrives resolved
// from KINDS, so there is nothing left to look up, and the one caller
// (`createDev`) does not have to learn that.
function resolveInk() {}
const ANNOTATE_KEY = 'KeyP';
const INK_W = 4;                      // css px
const SAMPLE_EVERY = 4;               // ray every Nth path point...
const MAX_RAYS = 100;                 // ...but never more than this per stroke
const MIN_STEP = 1.25;                // css px between recorded path points

// A 4K screen at devicePixelRatio 2 gives a 7680x4320 drawing buffer, and a
// PNG of a render that size is tens of megabytes before base64 — over the
// queue's per-image cap, which comes back as "image missing or not base64" and
// loses the strokes. The frame you PAINT on stays native; the frame that is
// FILED is bounded, and steps down again if the encoded payload is still too
// big for the endpoint.
const FILE_MAX_EDGE = 2560;
const FILE_STEPS = [2560, 1920, 1440, 1080, 800];
const B64_OK = /^[A-Za-z0-9+/]+={0,2}$/;    // exactly what the server accepts
let FILE_B64_BUDGET = 20 * 1024 * 1024;     // per image, under the server's 24 MB

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

const PAINT_CSS = `
.pdev-paint {
  position: fixed; inset: 0; z-index: 40; background: #0b0b0a;
  user-select: none; -webkit-user-select: none;
}
.pdev-paint__base, .pdev-paint__ink, .pdev-paint__live {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
}
/* the live layer sits ON TOP but is invisible to hit-testing, so the ink
   canvas below it stays the one element that owns the pointer */
.pdev-paint__live { pointer-events: none; }
.pdev-paint__ink { touch-action: none; cursor: crosshair; }
/* specs/0055 §1.9 + §5.5 (D17, annotate A) — dev-tuning-annotate is one of
   the eight lab surfaces: register 3's board in mono, no gradient, and the 4 px
   --accent hazard rule on the top edge. Stripe = not shipping. The header
   carries the panel's name and its key the way every other lab slate does; the
   copy (ANNOTATE, UNDO, CLEAR, the placeholder, FILE IT · ENTER, DISCARD · ESC)
   is untouched. */
.pdev-paint__panel {
  position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 42;
  width: min(560px, 94vw); pointer-events: auto;
  background: rgba(23, 22, 20, .93); color: var(--panel);
  border: 0; border-top: 4px solid var(--accent); border-radius: 0 0 2px 2px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, .5);
}
.pdev-paint__hd {
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  padding: 6px 11px 5px; border-bottom: 1px solid rgba(244, 241, 234, .16);
  font-family: var(--mono); font-size: 9.5px; font-weight: 700;
  letter-spacing: .18em; text-transform: uppercase; color: #ff9153;
}
.pdev-paint__hd .pdev-paint__key { color: #6f7891; }
.pdev-paint__bd { display: grid; gap: 9px; padding: 9px 11px 11px; }
.pdev-paint__row { display: flex; align-items: center; gap: 6px; }
.pdev-paint__row--grow > .pdev-lbl:first-child { flex: 1; }
/* specs/0055 §1.10 — 2 px radius, 0 on plates: the swatch IS a plate, so it is
   square, and the selected one is marked by a cream outline, not a glow. */
.pdev-sw {
  width: 18px; height: 18px; padding: 0; cursor: pointer; flex: none;
  border: 0; border-radius: 0; outline: 2px solid transparent; outline-offset: 1px;
}
.pdev-sw.is-on { outline-color: var(--panel); }   /* specs/0055 §10.3 — cream by name, never by hex */
.pdev-paint__prompt {
  width: 100%; box-sizing: border-box; resize: vertical;
  font-family: var(--mono); font-size: 11.5px; line-height: 1.5; color: var(--panel);
  background: rgba(244, 241, 234, .08); border: 1px solid rgba(244, 241, 234, .22);
  border-radius: 2px; padding: 7px 8px;
}
.pdev-paint__prompt:focus { outline: none; border-color: var(--accent); }
.pdev-paint__hint { color: #a49d90; font-size: 9px; letter-spacing: .06em; text-transform: none; }
.pdev-paint__stat { flex: 1; text-align: right; text-transform: none; letter-spacing: .04em; }
`;

// re-encode anything droppable as a JPEG we can post and the server can store
function toJpeg(img, maxEdge = 2048, q = 0.9) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const k = Math.min(1, maxEdge / Math.max(w, h || 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
const stripDataUrl = (s) => String(s || '').replace(/^data:[^,]*,/, '');

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('could not read ' + file.name));
    fr.readAsDataURL(file);
  });
}

/**
 * @param THREE       the shared three module
 * @param camera      the live camera (we write straight into it)
 * @param canvas      renderer.domElement
 * @param cfg         window.__PLAY (poi, run, qs)
 * @param hud         createHud()'s handle — we use flash() and the dev readout
 * @param unitScale   scene units per metre, so fly speed means something
 * @param renderNow   render one frame right now (for the snapshot)
 * @param collision   the player's own collision grid (collision.js) — its
 *                    raycast() is what the annotator's hitscan uses. Optional:
 *                    without it we fall back to a THREE.Raycaster over the
 *                    scene root, which is correct but far slower.
 * @param upAxis      'z' when the scene was authored ENU and main.js tipped it
 *                    into the Y-up wrapper; that tip is what makes an ENU
 *                    reading of a hit point possible at all.
 */
export function createDev({ THREE, camera, canvas, cfg, hud, unitScale = 1, renderNow, collision = null, upAxis = 'y' }) {
  // specs/0058 — the ride recorder, read off its own lab handle rather than
  // passed in, the way touch.js reads `window.__playMarkers`. main.js builds it
  // before this module and specs/0037's C18 locks main.js's edit ranges, so a
  // parameter here would cost that contract a hunk to buy nothing: the handle
  // is already published, and a build without the recorder simply has none.
  const trace = () => { try { return window.__trace || null; } catch { return null; } };
  const u = unitScale || 1;
  let on = false;
  let simTime = 0;
  const zUp = upAxis === 'z';
  // (x, y, z)_ENU -> (x, z, -y)_three, so back the other way is (X, -Z, Y).
  const toEnu = (x, y, z) => (zUp ? [r3(x), r3(-z), r3(y)] : null);

  // ---- fly state
  const pos = new THREE.Vector3();
  let yaw = 0, pitch = 0, fov = 72;
  let base = 12 * u;                              // m/s before the SHIFT multiplier
  const keys = { fwd: 0, back: 0, left: 0, right: 0, up: 0, down: 0, fast: 0 };
  const clearKeys = () => { for (const k of Object.keys(keys)) keys[k] = 0; };

  // ---- compare state
  let refUrl = null;          // what we display (the file as dropped)
  let refJpeg = null;         // what we post (jpeg data url)
  let refName = '';
  let mode = 'side';
  let opacity = MODE_OPACITY.side;
  let wipeX = 50;             // %

  // ---- pointer state
  let lookDrag = false, wipeDrag = false, lastX = 0, lastY = 0;

  // ---- request state
  let shot = null;            // pending snapshot data url
  let lastRequest = null;

  // ---- annotate state (specs/0004). Nothing here exists until P is pressed:
  // no canvas, no stylesheet, no listener. `paintUi` is the whole footprint and
  // it is torn out of the document again on submit or discard.
  let paintOn = false;
  let paintUi = null;
  let paintFrame = null;      // { clean, w, h, viewport, pose }
  let strokes = [];
  resolveInk();                 // specs/0055 §1.7 — kind colours, off the sheet
  let inkColor = INK[0];
  let drawing = null;
  let filing = false;         // ENTER is a key, and a key repeats

  // ================================================================== DOM
  // compare layer sits under the HUD chips (z 20) but over the canvas
  const layer = el('div', 'pdev-compare');
  layer.hidden = true;
  const refBox = el('div', 'pdev-compare__ref');
  const refImg = el('img', 'pdev-compare__img');
  refImg.alt = '';
  refBox.append(refImg);
  const handle = el('div', 'pdev-compare__handle');
  handle.hidden = true;
  const seam = el('div', 'pdev-compare__seam');
  seam.hidden = true;
  layer.append(refBox, seam, handle);
  document.body.appendChild(layer);

  // toolbar — specs/0055 §5.5 (D17): "F8 dev bar: style B". ONE full-bleed band
  // across the TOP edge under a single hazard rule, holding the mode, the
  // reference state and every action. Nothing shipped ever paints the top edge,
  // so the band itself is the "you are in dev mode" signal. Every control §0
  // pins survives verbatim: the four MODES, the opacity slider, match · M,
  // snapshot + annotate · P, file trace · J.
  const bar = el('div', 'pdev-bar');
  bar.hidden = true;
  // key -> verb, register 2's grammar (specs/0055 §5.5)
  const keyed = (cls, key, verb, onClick) => {
    const b = el('button', cls);
    b.type = 'button';
    b.append(el('span', 'pdev-key', key), el('span', null, verb));
    if (onClick) b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  };
  const barTitle = el('div', 'pdev-bar__title');
  barTitle.append(el('b', null, 'DEV FLY'), el('span', 'pdev-key', 'F8'), el('span', null, 'fly back'));
  // specs/0055 §5.5, reference A — the honest empty state. `no reference` is a
  // refusal, not an error, so it gets §1.8's red X and no colour of its own.
  const barRef = el('div', 'pdev-bar__ref');
  const barRefX = el('i', 'pdev-x');
  const barRefName = el('b', null, 'no reference');
  barRef.append(barRefX, barRefName);
  const barRow = el('div', 'pdev-bar__row');
  barRow.append(el('span', 'pdev-key', 'V'));
  const modeBtns = {};
  for (const m of MODES) {
    const b = el('button', 'pdev-btn', m);
    b.type = 'button';
    b.addEventListener('click', (e) => { e.stopPropagation(); setCompare(m); });
    modeBtns[m] = b;
    barRow.append(b);
  }
  const opRow = el('div', 'pdev-bar__row');
  opRow.append(el('span', 'pdev-lbl', 'opacity'));
  const opSlider = el('input', 'pdev-slider');
  opSlider.type = 'range'; opSlider.min = '0'; opSlider.max = '100'; opSlider.value = '100';
  opSlider.addEventListener('input', (e) => { e.stopPropagation(); opacity = Number(opSlider.value) / 100; paint(); });
  const opVal = el('span', 'pdev-lbl pdev-lbl--v', '100%');
  opRow.append(opSlider, opVal);
  // specs/0055 §5.5 — the three actions become key plates. The KEY is the plate
  // and the VERB reads beside it; the words themselves are §0-pinned copy.
  const matchBtn = keyed('pdev-btn pdev-btn--key pdev-btn--accent', 'M', 'match this view', () => match());
  // specs/0004 — the second input. Dev mode advertises its own keys (D34 only
  // binds the public build), so the key lives on the button.
  const annBtn = keyed('pdev-btn pdev-btn--key', 'P', 'snapshot + annotate', () => annotate());
  // specs/0058 — the third input. Dev mode advertises its own keys (D34 only
  // binds the public build), so the key lives on the button, exactly as P's does.
  const rec0 = trace();
  const traceBtn = keyed('pdev-btn pdev-btn--key',
    (rec0 && rec0.fileKey ? rec0.fileKey().replace(/^Key/, '') : 'J'), 'file trace',
    () => { const r = trace(); if (r) r.open(); });
  traceBtn.hidden = !(rec0 && rec0.armed && rec0.armed());
  bar.append(barTitle, barRef, barRow, opRow, matchBtn, annBtn, traceBtn);
  document.body.appendChild(bar);

  // confirm dialog
  const modal = el('div', 'pdev-modal');
  modal.hidden = true;
  const mpanel = el('section', 'panel pdev-modal__panel');
  const mhd = el('div', 'panel__hd');
  mhd.append(el('span', 'lbl lbl--accent', 'match this view'), el('span', 'spacer'), el('span', 'lbl', cfg.run || ''));
  const mbd = el('div', 'panel__bd pdev-modal__bd');
  const shots = el('div', 'pdev-modal__shots');
  const mkShot = (cap) => {
    const w = el('figure', 'pdev-shot');
    const i = el('img', 'pdev-shot__img');
    i.alt = '';
    w.append(i, el('figcaption', 'pdev-shot__cap', cap));
    shots.append(w);
    return i;
  };
  const shotRef = mkShot('reference');
  const shotVirt = mkShot('virtual · current view');
  const ask = el('div', 'pdev-modal__ask', 'Alter this view to match this image?');
  const noteWrap = el('label', 'pdev-modal__note');
  noteWrap.append(el('span', 'pdev-lbl', 'note for the builder'));
  const noteEl = el('textarea', 'pdev-note');
  noteEl.rows = 4;
  noteEl.placeholder = 'extra instructions for the builder (optional)';
  noteWrap.append(noteEl);
  const mrow = el('div', 'pdev-modal__row');
  const okBtn = el('button', 'btn btn--accent', 'confirm');
  okBtn.type = 'button';
  const noBtn = el('button', 'btn btn--ghost', 'cancel');
  noBtn.type = 'button';
  const mstat = el('span', 'lbl pdev-modal__stat', '');
  mrow.append(okBtn, noBtn, mstat);
  mbd.append(shots, ask, noteWrap, mrow);
  mpanel.append(mhd, mbd);
  modal.append(mpanel);
  document.body.appendChild(modal);

  okBtn.addEventListener('click', (e) => { e.stopPropagation(); confirmMatch(); });
  noBtn.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });

  // ================================================================ compare
  function setCompare(m) {
    mode = MODES.includes(m) ? m : 'side';
    opacity = MODE_OPACITY[mode];
    opSlider.value = String(Math.round(opacity * 100));
    paint();
    return mode;
  }
  function cycleCompare() {
    return setCompare(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  }

  function paint() {
    for (const m of MODES) modeBtns[m].classList.toggle('is-on', m === mode);
    opVal.textContent = Math.round(opacity * 100) + '%';
    // specs/0055 §5.5, reference A — the same slot carries the two truths: the
    // red X + `no reference` when nothing is dropped, the file's own name once
    // one is. The copy stays verbatim rather than becoming an apology.
    barRefName.textContent = refName || 'no reference';
    barRefX.hidden = !!refName;
    matchBtn.disabled = !refJpeg;
    const show = on && !!refUrl && mode !== 'off';
    layer.hidden = !show;
    if (!show) return;
    refBox.className = 'pdev-compare__ref pdev-compare__ref--' + mode;
    refBox.style.opacity = String(opacity);
    if (mode === 'wipe') {
      refBox.style.clipPath = `inset(0 ${(100 - wipeX).toFixed(2)}% 0 0)`;
      handle.hidden = false; seam.hidden = false;
      handle.style.left = wipeX + '%';
      seam.style.left = wipeX + '%';
    } else {
      refBox.style.clipPath = '';
      handle.hidden = true; seam.hidden = true;
    }
  }

  async function loadRefUrl(url, name = 'dropped image') {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('not an image the browser can decode'));
      img.src = url;
    });
    refUrl = url;
    refJpeg = toJpeg(img);
    refName = name;
    refImg.src = url;
    if (mode === 'off') setCompare('side'); else paint();
    hud.flash('ref · ' + name);
    return { name, width: img.naturalWidth, height: img.naturalHeight };
  }

  async function loadRefFile(file) {
    if (!file || !/^image\//.test(file.type || '')) throw new Error('not an image file');
    return loadRefUrl(await readFileAsDataUrl(file), file.name || 'dropped image');
  }

  // drag & drop, dev mode only
  addEventListener('dragover', (e) => { if (on) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  addEventListener('drop', (e) => {
    if (!on) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    loadRefFile(f).catch((err) => hud.flash('ref failed · ' + (err.message || err)));
  });

  // ================================================================== match
  function snapshot() {
    try { if (renderNow) renderNow(); } catch (e) { console.warn('[dev] render for snapshot failed', e); }
    try { return canvas.toDataURL('image/jpeg', 0.9); }
    catch (e) { console.error('[dev] toDataURL failed', e); return null; }
  }

  function match() {
    if (!refJpeg) { hud.flash('drop a reference photo first'); return false; }
    if (!modal.hidden) return false;
    shot = snapshot();
    if (!shot) { hud.flash('snapshot failed'); return false; }
    clearKeys();
    shotRef.src = refJpeg;
    shotVirt.src = shot;
    mstat.textContent = '';
    okBtn.disabled = false;
    modal.hidden = false;
    setTimeout(() => { try { noteEl.focus(); } catch {} }, 0);
    return true;
  }

  function closeModal() {
    modal.hidden = true;
    shot = null;
    noteEl.value = '';
  }

  async function confirmMatch() {
    if (modal.hidden || !shot) return null;
    okBtn.disabled = true;
    mstat.textContent = 'filing…';
    const body = {
      poi: cfg.poi, run: cfg.run,
      ref: stripDataUrl(refJpeg),
      virtual: stripDataUrl(shot),
      view: { position: [pos.x, pos.y, pos.z], yaw, pitch, fov },
      note: noteEl.value.trim(),
    };
    try {
      const r = await fetch('/api/tuning/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
      lastRequest = j;
      closeModal();
      hud.flash('tuning request · ' + j.id);
      return j;
    } catch (e) {
      okBtn.disabled = false;
      mstat.textContent = 'failed · ' + (e.message || e);
      console.error('[dev] tuning request failed', e);
      return null;
    }
  }

  // =============================================================== annotate
  // specs/0004. The frame freezes, you draw on it, you say what you want, and
  // the strokes are raycast back into the world so the builder gets coordinates
  // and not just a picture of a circle.

  function buildPaintUi() {
    const style = el('style');
    style.id = 'pdev-paint-style';
    style.textContent = PAINT_CSS;
    document.head.appendChild(style);

    const root = el('div', 'pdev-paint');
    const base = el('canvas', 'pdev-paint__base');   // the frame, painted once
    const ink = el('canvas', 'pdev-paint__ink');     // committed strokes
    const live = el('canvas', 'pdev-paint__live');   // the stroke under the cursor
    root.append(base, ink, live);

    const panel = el('div', 'pdev-paint__panel');
    // specs/0055 §5.5 (annotate A) — the lab slate's own header grammar: the
    // panel's name on the left, the key that opened it on the right, exactly
    // where the readout puts FPS. The swatch row moves into the body with it.
    const hd = el('div', 'pdev-paint__hd');
    hd.append(el('span', null, 'annotate'), el('span', 'pdev-paint__key', 'snapshot · P'));
    const body = el('div', 'pdev-paint__bd');
    const head = el('div', 'pdev-paint__row');
    const swatches = [];
    for (const c of INK) {
      const b = el('button', 'pdev-sw');
      b.type = 'button';
      b.style.background = c.hex;
      b.title = c.name;
      b.dataset.ink = c.name;
      b.addEventListener('click', (e) => { e.stopPropagation(); setInk(c.name); });
      swatches.push(b);
      head.append(b);
    }
    const undoBtn = el('button', 'pdev-btn pdev-btn--sm', 'undo · Z');
    undoBtn.type = 'button';
    undoBtn.addEventListener('click', (e) => { e.stopPropagation(); undoStroke(); });
    const clearBtn = el('button', 'pdev-btn pdev-btn--sm', 'clear');
    clearBtn.type = 'button';
    clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearStrokes(); });
    const count = el('span', 'pdev-lbl pdev-paint__stat', '0 strokes');
    // specs/0055 §5.5 — the swatch row sits left, UNDO / CLEAR right, the way
    // the lookbook's A row reads; the spacer is what pushes them apart.
    const gap = el('span');
    gap.style.flex = '1';
    head.append(gap, undoBtn, clearBtn, count);

    const promptEl = el('textarea', 'pdev-paint__prompt');
    promptEl.rows = 2;
    promptEl.placeholder = 'what should change here? ("remove these trees", "add a tower here")';
    promptEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnnotation(); }
      else if (e.key === 'Escape') { e.preventDefault(); endAnnotate(true); }
    });

    const foot = el('div', 'pdev-paint__row');
    const fileBtn = el('button', 'pdev-btn pdev-btn--accent', 'file it · ENTER');
    fileBtn.type = 'button';
    fileBtn.addEventListener('click', (e) => { e.stopPropagation(); submitAnnotation(); });
    const dropBtn = el('button', 'pdev-btn pdev-btn--sm', 'discard · ESC');
    dropBtn.type = 'button';
    dropBtn.addEventListener('click', (e) => { e.stopPropagation(); endAnnotate(true); });
    // specs/0055 §5.5 — five kind colours, so the digit hint runs 1..5
    const stat = el('span', 'pdev-lbl pdev-paint__stat', 'drag to draw · 1 2 3 4 5 colour');
    foot.append(fileBtn, dropBtn, stat);

    // specs/0055 §1.9 — head/body under one hazard rule (the lab slate)
    body.append(head, promptEl, foot);
    panel.append(hd, body);
    document.body.append(root, panel);

    ink.addEventListener('pointerdown', onInkDown);
    ink.addEventListener('pointermove', onInkMove);
    ink.addEventListener('pointerup', onInkUp);
    ink.addEventListener('pointercancel', onInkUp);

    return { style, root, base, ink, live, panel, swatches, undoBtn, clearBtn, count, promptEl, fileBtn, stat };
  }

  function teardownPaintUi() {
    if (!paintUi) return;
    for (const n of [paintUi.style, paintUi.root, paintUi.panel]) {
      if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    paintUi = null;
  }

  // The renderer runs with preserveDrawingBuffer:false, so a readback is only
  // valid in the SAME TASK as a render. Every capture path goes through here:
  // render, then drawImage, then check the result is not blank — a lost context
  // or a swallowed render would otherwise hand the queue a black rectangle.
  function grabFrame(g, w, h) {
    try { if (renderNow) renderNow(); } catch (e) { console.warn('[dev] render for snapshot failed', e); }
    g.clearRect(0, 0, w, h);
    g.drawImage(canvas, 0, 0, w, h);
    return !isBlank(g, w, h);
  }

  // Downsample to 24x24 and look for any variation at all. A frame that is one
  // flat colour edge to edge is not a photograph of anything.
  function isBlank(g, w, h) {
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 24;
      const pg = probe.getContext('2d');
      pg.drawImage(g.canvas, 0, 0, w, h, 0, 0, 24, 24);
      const d = pg.getImageData(0, 0, 24, 24).data;
      for (let i = 4; i < d.length; i += 4) {
        if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
      }
      return true;
    } catch { return false; }   // a readback we cannot do is not evidence of blankness
  }

  // Freeze the frame. Straight off the drawing buffer in the same task as the
  // render — an Image round trip would be a frame late and asynchronous.
  function annotate() {
    if (!on || paintOn || !modal.hidden) return false;
    const bw = canvas.width, bh = canvas.height;
    if (!bw || !bh) { hud.flash('snapshot failed · empty canvas'); return false; }
    const rect = canvas.getBoundingClientRect();
    const vw = Math.max(1, Math.round(rect.width || innerWidth));
    const vh = Math.max(1, Math.round(rect.height || innerHeight));

    paintUi = buildPaintUi();
    for (const c of [paintUi.base, paintUi.ink, paintUi.live]) { c.width = bw; c.height = bh; }
    try {
      const g = paintUi.base.getContext('2d');
      // one retry: a single dropped readback is a hiccup, two is a real fault
      if (!grabFrame(g, bw, bh) && !grabFrame(g, bw, bh)) {
        teardownPaintUi();
        hud.flash('snapshot failed · the frame came back blank');
        return false;
      }
    } catch (e) {
      console.error('[dev] snapshot failed', e);
      teardownPaintUi();
      hud.flash('snapshot failed · ' + (e.message || e));
      return false;
    }
    // NOTE: no toDataURL here. The base canvas IS the clean frame and it lives
    // as long as the annotator does; encoding a full-resolution PNG inside the
    // keypress that opens the tool is hundreds of milliseconds on a 4K screen,
    // paid for a string that would then be held until submit.
    paintFrame = {
      w: bw, h: bh,
      viewport: { w: vw, h: vh, dpr: r3(bw / vw) },
      pose: { position: [pos.x, pos.y, pos.z], yaw, pitch, fov, aspect: camera.aspect || (vw / vh) },
    };
    strokes = [];
    drawing = null;
    inkRect = null;
    paintOn = true;
    clearKeys();
    lookDrag = wipeDrag = false;
    setInk(inkColor.name);
    redrawInk();
    setTimeout(() => { try { paintUi && paintUi.promptEl.focus(); } catch {} }, 0);
    hud.flash('snapshot · draw, write the prompt, ENTER');
    return true;
  }

  function endAnnotate(discard) {
    if (!paintOn) return false;
    paintOn = false;
    drawing = null;
    strokes = [];
    paintFrame = null;
    teardownPaintUi();
    if (discard) hud.flash('annotation discarded');
    return true;
  }

  function setInk(name) {
    inkColor = INK.find((c) => c.name === name) || INK[0];
    if (paintUi) for (const b of paintUi.swatches) b.classList.toggle('is-on', b.dataset.ink === inkColor.name);
    return inkColor.name;
  }

  function paintStat() {
    if (!paintUi) return;
    const n = strokes.length;
    paintUi.count.textContent = n === 1 ? '1 stroke' : n + ' strokes';
    paintUi.undoBtn.disabled = !n;
    paintUi.clearBtn.disabled = !n;
  }

  // ---- the drawing engine
  //
  // THE BUG THIS SHAPE EXISTS TO KILL: the first version redrew every stroke,
  // both passes, over a cleared full-resolution canvas on EVERY pointermove.
  // At the fourth 600-point stroke that is ~4,800 line segments per mouse move,
  // and the browser has to re-raster and re-composite a 2560x1600 layer behind
  // each one. The line falls behind the cursor and never catches up.
  //
  // So: three layers. `base` is the frame, painted once. `ink` holds committed
  // strokes and is only ever touched when the stroke list changes. `live` holds
  // the stroke under the cursor and takes ONE segment per event.
  //
  // The halo is drawn with `destination-over` so it lands BEHIND everything
  // already on the layer. That is what makes a segment-at-a-time legal: drawn
  // the naive way, segment n+1's dark halo would paint over segment n's colour
  // and leave a speckled edge down the line.
  const strokeW = () => INK_W * inkScale();
  const haloW = () => (INK_W + 2.5) * inkScale();
  function inkScale() { return paintFrame ? paintFrame.w / paintFrame.viewport.w : 1; }

  function ctxOf(c) {
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    return g;
  }
  function clearCanvas(c) { c.getContext('2d').clearRect(0, 0, c.width, c.height); }

  // one segment (or the opening dot) — the whole per-move cost
  function inkSegment(g, hex, from, to) {
    const k = inkScale();
    const sw = strokeW(), hw = haloW();
    for (const pass of [{ c: hex, w: sw, op: 'source-over' }, { c: 'rgba(0,0,0,.5)', w: hw, op: 'destination-over' }]) {
      g.globalCompositeOperation = pass.op;
      g.strokeStyle = pass.c;
      g.fillStyle = pass.c;
      g.lineWidth = pass.w;
      g.beginPath();
      if (!from) { g.arc(to[0] * k, to[1] * k, pass.w / 2, 0, Math.PI * 2); g.fill(); }
      else { g.moveTo(from[0] * k, from[1] * k); g.lineTo(to[0] * k, to[1] * k); g.stroke(); }
    }
    g.globalCompositeOperation = 'source-over';
  }

  // a whole stroke, by the same rules, so a redraw is pixel-for-pixel what the
  // drag looked like
  function strokeOnto(g, s) {
    const p = s.path;
    if (!p.length) return;
    inkSegment(g, s.hex, null, p[0]);
    for (let i = 1; i < p.length; i++) inkSegment(g, s.hex, p[i - 1], p[i]);
  }

  // Only ever called when the LIST changes — undo, clear, addStroke, commit.
  function redrawInk() {
    if (!paintUi) return;
    clearCanvas(paintUi.ink);
    const g = ctxOf(paintUi.ink);
    for (const s of strokes) strokeOnto(g, s);
    paintStat();
  }

  // The rect is a forced layout; read it once per drag, not once per move. It is
  // also where a window resized mid-annotation is corrected for: paths are
  // always in the viewport the SNAPSHOT was taken in, which is the frame the
  // raycaster and the filed PNGs both speak.
  let inkRect = null;
  function inkPoint(e) {
    const r = inkRect || (inkRect = paintUi.ink.getBoundingClientRect());
    const k = r.width ? paintFrame.viewport.w / r.width : 1;
    return [r2((e.clientX - r.left) * k), r2((e.clientY - r.top) * k)];
  }

  function onInkDown(e) {
    if (!paintOn) return;
    e.preventDefault();
    e.stopPropagation();
    try { paintUi.ink.setPointerCapture(e.pointerId); } catch {}
    inkRect = paintUi.ink.getBoundingClientRect();
    const p = inkPoint(e);
    drawing = { color: inkColor.name, hex: inkColor.hex, path: [p] };
    clearCanvas(paintUi.live);
    inkSegment(ctxOf(paintUi.live), drawing.hex, null, p);   // ink under the cursor NOW
  }

  function onInkMove(e) {
    if (!paintOn || !drawing) return;
    e.preventDefault();
    const g = ctxOf(paintUi.live);
    // A 1000 Hz mouse delivers several positions per frame and the browser hands
    // them over as one coalesced event. Without this the fast parts of a drag
    // get corner-cut and the line visibly lags behind the pointer.
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [e];
    for (const ce of (evs.length ? evs : [e])) {
      const p = inkPoint(ce);
      const last = drawing.path[drawing.path.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) continue;
      drawing.path.push(p);
      inkSegment(g, drawing.hex, last, p);
    }
  }

  function onInkUp(e) {
    if (!paintOn || !drawing) return;
    e.preventDefault();
    try { paintUi.ink.releasePointerCapture(e.pointerId); } catch {}
    const s = drawing;
    drawing = null;
    strokes.push(s);
    strokeOnto(ctxOf(paintUi.ink), s);      // commit: once, not once per move
    clearCanvas(paintUi.live);
    paintStat();
  }

  // programmatic stroke — the headless path, and the same list the mouse writes
  function addStroke(path, color) {
    if (!paintOn || !Array.isArray(path) || !path.length) return null;
    const c = INK.find((x) => x.name === color) || inkColor;
    const s = { color: c.name, hex: c.hex, path: path.map((p) => [r2(p[0]), r2(p[1])]) };
    strokes.push(s);
    strokeOnto(ctxOf(paintUi.ink), s);
    paintStat();
    return strokes.length;
  }
  function undoStroke() {
    if (!paintOn || !strokes.length) return 0;
    strokes.pop();
    redrawInk();
    return strokes.length;
  }
  function clearStrokes() {
    if (!paintOn) return 0;
    strokes = [];
    drawing = null;
    if (paintUi) clearCanvas(paintUi.live);
    redrawInk();
    return 0;
  }

  // ---- hitscan (specs/0004). Cheap and useful, with the ambiguity reported
  // rather than hidden: a circle drawn round a tree can perfectly well land on
  // the ridge two kilometres behind it, and the depth spread is how a consumer
  // notices that happened.
  function rayCam() {
    const p = paintFrame.pose;
    const cam = new THREE.PerspectiveCamera(p.fov, p.aspect, 0.05 * u, 1e6);
    cam.position.set(p.position[0], p.position[1], p.position[2]);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(p.pitch, p.yaw, 0);
    cam.updateMatrixWorld();
    return cam;
  }

  function maxRayDist() {
    const b = collision && collision.bounds;
    if (b) return Math.hypot(b.x1 - b.x0, b.z1 - b.z0) + (b.maxY - b.minY);
    return 20000 * u;
  }

  function probeName() {
    if (collision && collision.raycast) return 'collision-grid';
    return sceneRoot() ? 'three-raycaster' : 'none';
  }
  function sceneRoot() {
    try { return (window.__player && window.__player.sceneRoot && window.__player.sceneRoot()) || null; }
    catch { return null; }
  }

  function hitAt(px, py, cam, rc, ndc, far) {
    const v = paintFrame.viewport;
    ndc.set((px / v.w) * 2 - 1, -(py / v.h) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    const o = rc.ray.origin, d = rc.ray.direction;
    if (collision && collision.raycast) {
      const h = collision.raycast(o.x, o.y, o.z, d.x, d.y, d.z, far);
      if (!h) return null;
      const dist = h.dist;                 // `best` is shared and mutable — read it now
      return mkHit(o.x + d.x * dist, o.y + d.y * dist, o.z + d.z * dist, dist);
    }
    const root = sceneRoot();
    if (!root) return null;
    rc.far = far;
    const hits = rc.intersectObject(root, true);
    if (!hits.length) return null;
    const p = hits[0].point;
    return mkHit(p.x, p.y, p.z, hits[0].distance);
  }
  function mkHit(x, y, z, dist) {
    return { xyz: [r3(x), r3(y), r3(z)], enu: toEnu(x, y, z), dist: r3(dist) };
  }

  function sampleIndices(n) {
    const step = Math.max(SAMPLE_EVERY, Math.ceil(n / MAX_RAYS));
    const idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    return idx;
  }

  function strokesDoc() {
    const cam = rayCam();
    const rc = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const far = maxRayDist();
    const p = paintFrame.pose;
    const out = {
      kind: 'annotation',
      poi: cfg.poi || null,
      run: cfg.run || null,
      created: new Date().toISOString(),
      frame: { w: paintFrame.w, h: paintFrame.h },
      viewport: paintFrame.viewport,
      camera: {
        frame: zUp ? 'enu-z-up (scene tipped to y-up by the player)' : 'y-up (scene declared no ENU frame)',
        position: p.position.map(r3),
        positionEnu: toEnu(p.position[0], p.position[1], p.position[2]),
        yaw: r3(p.yaw), pitch: r3(p.pitch),
        yawDeg: r2(p.yaw * 180 / Math.PI), pitchDeg: r2(p.pitch * 180 / Math.PI),
        fov: p.fov, aspect: r3(p.aspect), unitScale: r3(u),
      },
      probe: probeName(),
      maxRayDist: r2(far),
      strokes: [],
    };
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      const idx = sampleIndices(s.path.length);
      const samples = [];
      let hits = 0, dmin = Infinity, dmax = -Infinity;
      let sx = 0, sy = 0, sz = 0;
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const j of idx) {
        const px = s.path[j];
        const h = hitAt(px[0], px[1], cam, rc, ndc, far);
        samples.push({ i: j, px, hit: h });
        if (!h) continue;                       // misses are recorded, never dropped
        hits++;
        sx += h.xyz[0]; sy += h.xyz[1]; sz += h.xyz[2];
        for (let k = 0; k < 3; k++) { if (h.xyz[k] < lo[k]) lo[k] = h.xyz[k]; if (h.xyz[k] > hi[k]) hi[k] = h.xyz[k]; }
        if (h.dist < dmin) dmin = h.dist;
        if (h.dist > dmax) dmax = h.dist;
      }
      const c = hits ? [sx / hits, sy / hits, sz / hits] : null;
      // the ENU box is the component-wise box of the CONVERTED corners: the
      // conversion flips y's sign, so passing min and max through it straight
      // would hand a consumer a "min" that is larger than its "max"
      const loE = hits ? toEnu(lo[0], lo[1], lo[2]) : null;
      const hiE = hits ? toEnu(hi[0], hi[1], hi[2]) : null;
      out.strokes.push({
        i, color: s.color, hex: s.hex, widthPx: INK_W,
        points: s.path.length, sampled: samples.length,
        hits, misses: samples.length - hits,
        hitRatio: samples.length ? r3(hits / samples.length) : 0,
        centroid: c ? { xyz: c.map(r3), enu: toEnu(c[0], c[1], c[2]) } : null,
        aabb: hits ? {
          min: lo.map(r3), max: hi.map(r3),
          minEnu: loE && loE.map((v, k) => Math.min(v, hiE[k])),
          maxEnu: hiE && hiE.map((v, k) => Math.max(v, loE[k])),
        } : null,
        depth: hits ? { min: r3(dmin), max: r3(dmax), spread: r3(dmax - dmin) } : null,
        path: s.path,
        samples,
      });
    }
    return out;
  }

  // ---- what actually gets filed
  // The painted frame can be 33 megapixels on a 4K screen at dpr 2, and a PNG of
  // that is tens of megabytes before base64 — past the queue's per-image cap,
  // which comes back as "image missing or not base64". So the filed pair is
  // bounded here, and steps down until it fits, and says which size it used.
  // draws base (+ ink, +live) into a canvas of the given size
  function renderFrame(w, h, withInk) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(paintUi.base, 0, 0, w, h);
    if (withInk) {
      g.drawImage(paintUi.ink, 0, 0, w, h);
      g.drawImage(paintUi.live, 0, 0, w, h);   // a stroke still under the cursor
    }
    return c;
  }

  // Encode both PNGs at the largest size whose base64 fits the endpoint. Both
  // are re-encoded together at the same size so their pixels stay comparable.
  function encodePair() {
    const long = Math.max(paintFrame.w, paintFrame.h);
    const edges = FILE_STEPS.filter((e) => e < long);
    edges.unshift(Math.min(FILE_MAX_EDGE, long));
    let last = null;
    for (const edge of edges) {
      const k = edge / long;
      const w = Math.max(1, Math.round(paintFrame.w * k)), h = Math.max(1, Math.round(paintFrame.h * k));
      const painted = stripDataUrl(renderFrame(w, h, true).toDataURL('image/png'));
      const clean = stripDataUrl(renderFrame(w, h, false).toDataURL('image/png'));
      last = { w, h, painted, clean, edge };
      if (painted.length <= FILE_B64_BUDGET && clean.length <= FILE_B64_BUDGET) return last;
    }
    return last;   // smallest step; the preflight below decides whether it flies
  }

  // Exactly the server's own test, run before the strokes can be lost to it.
  function badImage(name, b64) {
    if (!b64) return `${name} came back empty — the frame did not read back`;
    if (!B64_OK.test(b64)) return `${name} is not clean base64 (${b64.length} chars)`;
    if (b64.length > FILE_B64_BUDGET) return `${name} is ${(b64.length / 1048576).toFixed(1)} MB, over the ${(FILE_B64_BUDGET / 1048576).toFixed(0)} MB cap`;
    return null;
  }

  async function submitAnnotation() {
    if (!paintOn || !paintUi || filing) return null;
    filing = true;
    try { return await fileAnnotation(); } finally { filing = false; }
  }

  // NOTHING in here may lose a painted stroke. Every failure path leaves the
  // annotator open with the strokes and the prompt exactly as they were, and
  // says what went wrong in words that name the thing that went wrong.
  async function fileAnnotation() {
    const text = paintUi.promptEl.value.trim();
    paintUi.fileBtn.disabled = true;
    paintUi.stat.textContent = 'raycasting…';
    let body;
    try {
      const doc = strokesDoc();
      paintUi.stat.textContent = 'encoding…';
      let pair = encodePair();
      let bad = badImage('snapshot', pair.painted) || badImage('snapshot-clean', pair.clean);
      // a blank base canvas means the readback was lost after all — take it again
      if (!bad && isBlank(paintUi.base.getContext('2d'), paintFrame.w, paintFrame.h)) {
        paintUi.stat.textContent = 're-capturing…';
        grabFrame(paintUi.base.getContext('2d'), paintFrame.w, paintFrame.h);
        pair = encodePair();
        bad = badImage('snapshot', pair.painted) || badImage('snapshot-clean', pair.clean);
      }
      if (bad) throw new Error(bad);
      doc.filedFrame = { w: pair.w, h: pair.h, scaledFromNative: pair.w !== paintFrame.w };
      body = {
        kind: 'annotation',
        poi: cfg.poi, run: cfg.run,
        snapshot: pair.painted,
        snapshotClean: pair.clean,
        prompt: text,
        note: text,
        strokes: doc,
        view: { position: paintFrame.pose.position, yaw: paintFrame.pose.yaw, pitch: paintFrame.pose.pitch, fov: paintFrame.pose.fov },
      };
    } catch (e) {
      paintUi.fileBtn.disabled = false;
      paintUi.stat.textContent = 'failed · ' + (e.message || e) + ' — strokes kept';
      console.error('[dev] annotation build failed', e);
      return null;
    }
    paintUi.stat.textContent = 'filing…';
    try {
      const r = await fetch('/api/tuning/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
      lastRequest = j;
      endAnnotate(false);
      hud.flash('annotation · ' + j.id);
      return j;
    } catch (e) {
      if (paintUi) {
        paintUi.fileBtn.disabled = false;
        paintUi.stat.textContent = 'failed · ' + (e.message || e) + ' — strokes kept';
      }
      console.error('[dev] annotation request failed', e);
      return null;
    }
  }

  // ==================================================================== fly
  function enter() {
    camera.updateMatrixWorld();
    pos.setFromMatrixPosition(camera.matrixWorld);
    const d = camera.getWorldDirection(new THREE.Vector3());
    yaw = Math.atan2(-d.x, -d.z);
    pitch = Math.asin(clamp(d.y, -1, 1));
    fov = camera.fov;
    clearKeys();
    lookDrag = wipeDrag = false;
    on = true;
    document.body.classList.add('is-dev');
    // specs/0055 §5.5 — style B's band owns the top edge, so the lab surfaces
    // anchored at 14,14 (the fly readout, the DEBUG_HUD readout, the FPS value)
    // drop below it while it is up. play.css:`body.play.is-devbar`.
    document.body.classList.add('is-devbar');
    bar.hidden = false;
    hud.setDev(true);
    paint();
    // hand the cursor back — the compare UI wants it
    if (document.pointerLockElement) { try { document.exitPointerLock(); } catch {} }
    // specs/0055 §5.5, W5 hand-off 3 — SAID ONCE. The band's own head prints
    // `DEV FLY · F8 · fly back` across the top edge for as long as dev mode is
    // up; a centre-screen toast saying the same words for 1.4 s was the second
    // time, over the frame the builder came here to look at.
  }

  function leave() {
    on = false;
    clearKeys();
    lookDrag = wipeDrag = false;
    document.body.classList.remove('is-dev');
    document.body.classList.remove('is-devbar');   // specs/0055 §5.5
    bar.hidden = true;
    layer.hidden = true;
    endAnnotate(false);     // F8 out of a half-painted snapshot files nothing
    closeModal();
    hud.setDev(false);
    hud.flash('play mode');
  }

  function setActive(v) {
    const want = !!v;
    if (want === on) return on;
    if (want) enter(); else leave();
    return on;
  }

  function update(dt) {
    if (!on) return;
    if (paintOn) return;      // the world holds still while you draw on it
    simTime += dt;
    const sp = base * (keys.fast ? 5 : 1);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp2 = Math.sin(pitch);
    // three.js forward for (pitch, yaw) in YXZ order
    const fx = -sy * cp, fy = sp2, fz = -cy * cp;
    const rx = cy, rz = -sy;
    const f = keys.fwd - keys.back, r = keys.right - keys.left, v = keys.up - keys.down;
    let dx = fx * f + rx * r, dy = fy * f + v, dz = fz * f + rz * r;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-6) {
      const k = (sp * dt) / len;
      pos.x += dx * k; pos.y += dy * k; pos.z += dz * k;
    }
  }

  function applyTo(cam) {
    cam.position.copy(pos);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(pitch, yaw, 0);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  function look(dx, dy) {
    yaw -= dx * LOOK_SENS;
    pitch = clamp(pitch - dy * LOOK_SENS, -1.5533, 1.5533);
  }

  function setSpeed(v) { base = clamp(v, 0.1 * u, 600 * u); return base; }

  // ================================================================== input
  const MOVE = {
    KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
    Space: 'up', ControlLeft: 'down', ControlRight: 'down',
    ShiftLeft: 'fast', ShiftRight: 'fast',
  };

  // returns true when dev consumed the key (main.js swallows everything while
  // dev is on either way — this only decides preventDefault)
  function key(code, down) {
    if (!on) return false;
    // The annotator eats the whole keyboard. Painting must not carve the
    // mountain: a stray W here would fly the camera out from under the frame
    // the strokes were measured against.
    if (paintOn) {
      if (!down) return true;
      if (code === 'Escape') { endAnnotate(true); return true; }
      if (code === 'Enter' || code === 'NumpadEnter') { submitAnnotation(); return true; }
      if (code === 'KeyZ') { undoStroke(); return true; }
      // specs/0055 §5.5 — five kind colours, so the digit row runs 1..5
      const d = /^Digit([12345])$/.exec(code) || /^Numpad([12345])$/.exec(code);
      if (d) { hud.flash('ink · ' + setInk(INK[Number(d[1]) - 1].name)); return true; }
      return true;
    }
    if (!modal.hidden) {
      if (code === 'Escape' && !down) { closeModal(); return true; }
      return code === 'Escape';
    }
    // specs/0058 — J files the ride you flew back to look at. Asked BEFORE the
    // fly keys, because dev mode swallows the whole keyboard and a trace key
    // that only works with dev off is a trace key you cannot reach from the
    // place you noticed the bug.
    const r = trace();
    if (r && r.key && r.key(code, down)) return true;
    const m = MOVE[code];
    if (m) { keys[m] = down ? 1 : 0; return true; }
    if (!down) return false;
    if (code === 'KeyV') { hud.flash('compare · ' + cycleCompare()); return true; }
    if (code === 'KeyM') { match(); return true; }
    if (code === ANNOTATE_KEY) { annotate(); return true; }
    if (code === 'BracketLeft') { fov = clamp(fov - 2, 10, 130); return true; }
    if (code === 'BracketRight') { fov = clamp(fov + 2, 10, 130); return true; }
    if (code === 'Escape') { if (!layer.hidden) { setCompare('off'); return true; } return false; }
    return false;
  }

  // every pointer event in dev mode arrives here (main.js routes them)
  function pointer(e, onCanvas) {
    if (!on) return;
    if (paintOn) return;      // the ink canvas has its own listeners
    if (e.type === 'pointerdown') {
      if (e.target === handle) { wipeDrag = true; try { handle.setPointerCapture(e.pointerId); } catch {} return; }
      if (onCanvas) { lookDrag = true; lastX = e.clientX; lastY = e.clientY; }
      return;
    }
    if (e.type === 'pointermove') {
      if (wipeDrag) { wipeX = clamp((e.clientX / Math.max(1, innerWidth)) * 100, 0, 100); paint(); return; }
      if (document.pointerLockElement === canvas) { look(e.movementX || 0, e.movementY || 0); return; }
      if (lookDrag) {
        look(e.clientX - lastX, e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
      }
      return;
    }
    if (e.type === 'pointerup' || e.type === 'pointercancel') { lookDrag = false; wipeDrag = false; return; }
    if (e.type === 'wheel' && onCanvas) {
      setSpeed(base * Math.exp(-(e.deltaY || 0) * 0.0015));
      e.preventDefault();
    }
  }

  // ================================================================ readout
  const f1 = (v) => (v >= 0 ? ' ' : '') + v.toFixed(1);
  const deg = (r) => (r * 180 / Math.PI);
  function spawnParams() {
    return `?spawn=${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`
      + `&yaw=${deg(yaw).toFixed(1)}`;
  }
  function spawnUrl() {
    return location.origin + '/play?poi=' + encodeURIComponent(cfg.poi)
      + '&run=' + encodeURIComponent(cfg.run)
      + '&spawn=' + [pos.x, pos.y, pos.z].map((n) => n.toFixed(1)).join(',')
      + '&yaw=' + deg(yaw).toFixed(1);
  }

  function tick() {
    if (!on) return;
    hud.devTick({
      pos: `${f1(pos.x)} ${f1(pos.y)} ${f1(pos.z)}`,
      ang: `${deg(yaw).toFixed(1)}° / ${deg(pitch).toFixed(1)}°`,
      fov: fov.toFixed(0) + '°',
      spd: base.toFixed(1) + ' m/s' + (keys.fast ? ' ×5' : ''),
      cmp: refUrl ? mode : 'no ref',
      params: spawnParams(),
      url: spawnUrl(),
    });
  }

  const api = {
    // specs/0003 §A2 — IS DEV MODE IN THIS BUILD AT ALL. The public build gets a
    // stub of this module (manifest.json, transform "stub-module") whose
    // `available()` answers false, and main.js checks it before F8 does anything
    // — because "toggle() returned false" is ALSO what turning dev mode off looks
    // like, so it cannot tell the two apart. This can.
    // specs/0055 5.3 (Greg 2026-09-06: hide poi-lab UI) -- "off means off":
    // with the LAB UI switch down this answers false exactly the way the
    // stubbed module does, so main.js's F8 branch returns before it clears a
    // key, swallows the stroke or enters. One seam, both reasons.
    available: () => labUI(),
    active: () => on,
    toggle: () => setActive(!on),
    setActive,
    update, applyTo, look, key, pointer, tick,
    setCompare, cycleCompare, match, confirmMatch, closeModal,
    loadRefUrl, loadRefFile,
    // ---- specs/0004 annotator
    annotateKey: () => ANNOTATE_KEY,
    annotate, annotating: () => paintOn,
    endAnnotate,
    inkColors: () => INK.map((c) => ({ ...c })),
    setInk, ink: () => inkColor.name,
    addStroke, undoStroke, clearStrokes,
    strokeCount: () => strokes.length,
    strokeList: () => strokes.map((s) => ({ color: s.color, points: s.path.length })),
    strokesDoc: () => (paintOn ? strokesDoc() : null),
    setPrompt: (t) => { if (paintUi) paintUi.promptEl.value = String(t == null ? '' : t); return paintUi ? paintUi.promptEl.value : null; },
    prompt: () => (paintUi ? paintUi.promptEl.value : null),
    submitAnnotation,
    annotateStatus: () => (paintUi ? paintUi.stat.textContent : null),
    // the two failure modes that ate a submit in the field, on tap so the
    // headless proof can hold each one and watch the strokes survive it
    _fault: {
      budget: (n) => { if (n != null) FILE_B64_BUDGET = Number(n); return FILE_B64_BUDGET; },
      blankFrame: () => {
        if (!paintUi) return false;
        paintUi.base.getContext('2d').clearRect(0, 0, paintUi.base.width, paintUi.base.height);
        return true;
      },
      isBlank: () => (paintUi ? isBlank(paintUi.base.getContext('2d'), paintFrame.w, paintFrame.h) : null),
    },
    spawnParams, spawnUrl,
    pose: () => ({ position: [pos.x, pos.y, pos.z], yaw, pitch, fov, speed: base }),
    compareMode: () => mode,
    modalOpen: () => !modal.hidden,
    hasRef: () => !!refJpeg,
    lastRequest: () => lastRequest,
    setNote: (t) => { noteEl.value = String(t == null ? '' : t); return noteEl.value; },
    note: () => noteEl.value,
    setSpeed,
    // hold a key set for `ms` of simulated dev time — frame-rate independent,
    // the same trick __player.simulateKeys uses
    simulate: (codes, ms) => new Promise((resolve) => {
      const before = [pos.x, pos.y, pos.z];
      for (const c of [].concat(codes || [])) key(c, true);
      const t0 = simTime, w0 = performance.now();
      const step = () => {
        if ((simTime - t0) * 1000 >= ms || performance.now() - w0 > 30000) {
          for (const c of [].concat(codes || [])) key(c, false);
          const after = [pos.x, pos.y, pos.z];
          resolve({
            before, after,
            d: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]),
            simMs: (simTime - t0) * 1000, wallMs: performance.now() - w0,
          });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }),
  };

  window.__devDebug = api;
  setCompare('side');
  paint();
  return api;
}
