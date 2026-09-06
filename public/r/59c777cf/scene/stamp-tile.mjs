/**
 * stamp-tile.mjs — specs/0051 §7.4 check 2, §8.7, §9.2 #6.  D-2.
 *
 * A MEASUREMENT, NOT A RUNTIME PATH.  Nothing in the player, the bench or the
 * export imports this file; it is not listed in `tools/export-red-dog/worlds/
 * *.json` `entries[]`, so it does not ship, and every entry point below throws
 * unless `STAMP_TILE=1` is in the environment.  0051 has no consequence either
 * way (D-2, critic A.18); 0052's per-tile raster is what the answer sizes.
 *
 * THE QUESTION.  `buildGround()` (ground.mjs) stamps twenty (red-dog) / fourteen
 * (siberia) whole-map Float32 channels.  0052 wants to stamp ONE TILE's cells and
 * get bit-identical values.  That is only true if every stamp writes a cell from
 * inputs that are either global (run geometry, `demAt`) or local to that cell.
 * Where a stamp READS the raster back — red-dog's `stampChute`/`stampGully` call
 * `groundZ0`, which is `bil0`, which is bilinear — a tile-local replay needs an
 * APRON of neighbouring cells stamped too, or the read falls off the edge of what
 * was replayed.  This file measures the apron depth at which the answer is 0 ULP.
 *
 * HOW.  The tile-local replay is the world's own `ground.mjs`, unmodified in
 * meaning, with exactly two source edits applied to a COPY written beside it:
 *
 *   1. `forCells`' cell range is intersected with `globalThis.__STAMP_TILE_CLIP`.
 *      Every write to every channel goes through `forCells`, so clipping it is
 *      the whole of "replay this tile only".  Nothing else is touched: the same
 *      stamps run in the same order, over a smaller cell window.
 *   2. the channel arrays and the raster dimensions are re-exported, because
 *      they are module-private.
 *
 * Both edits must match EXACTLY ONCE or `instrument()` throws (the D40 rule for
 * `patches/*.patch.mjs`, applied here).  The reference — "the whole-map raster" —
 * is the SAME instrumented module with no clip, so the two sides differ in the
 * clip and in nothing else.
 *
 * WHAT IT IS RUN AGAINST.  The export build only (§0.3, D-2), produced with
 * `--no-minify` so the two source edits have identifiers to match; `--no-minify`
 * is documented in build.mjs:51-55 as the same tree and the same file set.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// --------------------------------------------------------------------- flag
export const FLAG = 'STAMP_TILE';
export const enabled = () => process.env[FLAG] === '1';
function gate() {
  if (!enabled()) {
    throw new Error('stamp-tile.mjs is a flagged measurement (specs/0051 D-2): '
      + `set ${FLAG}=1. It is never wired into the runtime.`);
  }
}

// ------------------------------------------------------------- tile lattice
/** §1.3 spans. The lattice is anchored on the raster origin RX0/RY0 (§1.1). */
export const LEVEL_SPAN = { L0: 64, L1: 128, L2: 256, L3: 512, LF: 1024 };

/** `${frame}/${level}/${tx}/${ty}`, signed tx/ty (§1.1). */
export function parseTileId(id) {
  const p = String(id).split('/');
  if (p.length !== 4) throw new Error(`bad tile id ${id} — want frame/level/tx/ty`);
  const [frame, level, tx, ty] = p;
  if (!(level in LEVEL_SPAN)) throw new Error(`bad level ${level} in ${id}`);
  return { frame, level, tx: Number(tx), ty: Number(ty), span: LEVEL_SPAN[level] };
}
export const tileId = (frame, level, tx, ty) => `${frame}/${level}/${tx}/${ty}`;

/**
 * The tile's cell window, INCLUSIVE of the shared boundary column/row — a tile
 * owns its boundary vertices, so a 64 m L0 tile on a 2.0 m raster is 33 x 33
 * cells and its east neighbour re-stamps the shared column.  A per-tile raster
 * that got the boundary from only one side would seam.
 */
export function tileCells(t, R, halfOpen = false) {
  const s = t.span / R.RES;
  if (!Number.isInteger(s)) throw new Error(`span ${t.span} is not a whole number of ${R.RES} m cells`);
  const e = halfOpen ? s - 1 : s;
  return { i0: t.tx * s, i1: t.tx * s + e, j0: t.ty * s, j1: t.ty * s + e };
}

/**
 * tile window grown by `apron` cells and clamped to the raster (cix/ciy clamp).
 * `halfOpen` measures the other window shape 0052 could choose — a tile that does
 * NOT own its east/north boundary cell.  It is a different question and it gets a
 * different answer, so it is a parameter and not a comment.
 */
export function clipFor(t, R, apron, halfOpen = false) {
  const c = tileCells(t, R, halfOpen);
  return {
    i0: Math.max(0, c.i0 - apron), i1: Math.min(R.RNX - 1, c.i1 + apron),
    j0: Math.max(0, c.j0 - apron), j1: Math.min(R.RNY - 1, c.j1 + apron),
    tile: {
      i0: Math.max(0, c.i0), i1: Math.min(R.RNX - 1, c.i1),
      j0: Math.max(0, c.j0), j1: Math.min(R.RNY - 1, c.j1),
    },
  };
}

/** every tile of `level` that intersects the raster extent, in row order. */
export function tilesCovering(R, level, frame = 'w') {
  const s = LEVEL_SPAN[level] / R.RES;
  const out = [];
  for (let ty = 0; ty * s < R.RNY; ty++) for (let tx = 0; tx * s < R.RNX; tx++) out.push(tileId(frame, level, tx, ty));
  return out;
}

// -------------------------------------------------------- source instrument
/**
 * `const|let NAME = new Float32Array(RNX * RNY)` — the raster channels, in order.
 *
 * WHY `let` IS IN THE PATTERN (specs/0051 wave 2b). Wave 0b's reclaim converts
 * eight red-dog / five siberia channels to Uint8Array or Uint16Array AFTER
 * buildGround by reassignment, which means their DECLARATIONS became `let`. A
 * `const`-only pattern therefore stopped seeing them the day 0b landed and
 * quietly measured 11 of 20 channels instead of 20 — a coverage loss that reads
 * as a green measurement. The declaration is still `new Float32Array(RNX*RNY)`
 * in both cases; only the binding changed.
 */
const CHANNEL_RE = /^(?:const|let) ([A-Za-z_$][\w$]*) = new Float32Array\(RNX \* RNY\)/gm;

export function channelNames(src) {
  const out = [];
  for (const m of src.matchAll(CHANNEL_RE)) out.push(m[1]);
  if (!out.length) throw new Error('no RNX*RNY Float32Array channels found — is this ground.mjs?');
  return out;
}

/**
 * The `forCells` emit loop, matched on the loop itself and not on the line that
 * computes `i0..j1` — the CROPPED export build rewrites that line (the
 * `forcells-guard` hunk of `patches/scene-ground.patch.mjs`) while both worlds,
 * cropped and uncropped, emit through this identical four lines.  One match in
 * each of the four `ground.mjs` this file is ever pointed at.
 */
const FORCELLS_LOOP =
  '  for (let j = j0; j <= j1; j++) {\n'
  + '    const y = RY0 + j * RES;\n'
  + '    for (let i = i0; i <= i1; i++) cb(RX0 + i * RES, y, j * RNX + i);\n'
  + '  }\n';
const FORCELLS_CLIPPED =
  '  const __C = globalThis.__STAMP_TILE_CLIP;\n'
  + '  const __i0 = __C ? Math.max(i0, __C.i0) : i0, __i1 = __C ? Math.min(i1, __C.i1) : i1;\n'
  + '  const __j0 = __C ? Math.max(j0, __C.j0) : j0, __j1 = __C ? Math.min(j1, __C.j1) : j1;\n'
  + '  for (let j = __j0; j <= __j1; j++) {\n'
  + '    const y = RY0 + j * RES;\n'
  + '    for (let i = __i0; i <= __i1; i++) cb(RX0 + i * RES, y, j * RNX + i);\n'
  + '  }\n';

function once(src, needle, what) {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error(`stamp-tile: ${what} matched ${n} times, want exactly 1`);
}

export function instrument(raw) {
  // The export build writes LF; a git checkout on Windows hands back CRLF. The
  // two source edits are matched on LF text, and the copy that node imports is
  // LF — which changes no token and no value, only the bytes between them.
  const src = raw.replace(/\r\n/g, '\n');
  once(src, FORCELLS_LOOP, 'the forCells emit loop');
  const names = channelNames(src);
  const out = src.replace(FORCELLS_LOOP, FORCELLS_CLIPPED)
    + '\n// ---- appended by runs/*/scene/stamp-tile.mjs (specs/0051 check 2) ----\n'
    + `export const __RASTER = { RES, RX0, RY0, RNX, RNY };\n`
    + `export const __CHANNELS = { ${names.join(', ')} };\n`;
  return { text: out, channels: names };
}

/** write the instrumented copy beside ground.mjs so its relative imports resolve. */
export function prepare(sceneDir) {
  gate();
  const srcPath = path.join(sceneDir, 'ground.mjs');
  const src = fs.readFileSync(srcPath, 'utf8');
  const { text, channels } = instrument(src);
  const modPath = path.join(sceneDir, 'ground.__stamp-tile.mjs');
  fs.writeFileSync(modPath, text);
  return { modPath, channels, srcPath };
}

// ----------------------------------------------------------------- replay
let SEQ = 0;
/**
 * One full `buildGround()` under `clip` (null = the whole map).  Node caches a
 * module by URL, so each replay gets its own query string and therefore its own
 * fresh set of channel arrays; the SIBLING imports (dem-data, layout) resolve to
 * the same URLs and stay cached, so the DEM is decoded once per process.
 */
export async function replay(modPath, clip) {
  gate();
  globalThis.__STAMP_TILE_CLIP = clip || null;
  const href = pathToFileURL(modPath).href + `?stamp=${++SEQ}`;
  const M = await import(href);
  globalThis.__STAMP_TILE_CLIP = null;
  return { R: M.__RASTER, channels: M.__CHANNELS, mod: M };
}

/**
 * stampTile(tileId) — specs/0051 §9.1 row 0c.  Replays the ground stamps for one
 * tile with an apron, and returns the tile's own cells per channel.  The
 * BASIS_BOXES snapshot (`snapshotBasis`, ground.mjs) is taken inside this replay
 * exactly where `buildGround` takes it, so epoch B/C read the same frozen basis
 * they read whole-map — over the replayed window.  That is the reason the apron
 * has to cover `bil0`'s bilinear reach and not merely the cell being written.
 */
export async function stampTile(id, { sceneDir, modPath, apron = 4, R = null, halfOpen = false } = {}) {
  gate();
  const mp = modPath || prepare(sceneDir).modPath;
  const t = parseTileId(id);
  let dims = R;
  if (!dims) dims = (await replay(mp, { i0: 0, i1: 0, j0: 0, j1: 0 })).R;
  const clip = clipFor(t, dims, apron, halfOpen);
  const { channels } = await replay(mp, clip);
  const win = clip.tile;
  const w = win.i1 - win.i0 + 1, h = win.j1 - win.j0 + 1;
  const out = {};
  for (const [name, A] of Object.entries(channels)) {
    // a RELEASED channel (wave 0b nulls GUARDF once buildGround has returned,
    // §3.3) is not a measurement failure — it is a channel that no longer
    // exists to compare, and it is named in the result rather than crashed on.
    if (!A || typeof A.subarray !== 'function') { out[name] = null; continue; }
    const o = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      const rs = (win.j0 + j) * dims.RNX + win.i0;
      o.set(A.subarray(rs, rs + w), j * w);
    }
    out[name] = o;
  }
  return { id, tile: t, apron, clip, R: dims, w, h, channels: out };
}

// -------------------------------------------------------------- ULP compare
const _f = new Float32Array(1), _i = new Int32Array(_f.buffer);
const ord = (v) => { _f[0] = v; const b = _i[0]; return b < 0 ? 0x80000000 - b : b; };
/** monotonic-ordinal distance between two f32s; NaN-safe, ±0 are equal. */
export function ulp(a, b) {
  if (Object.is(a, b)) return 0;
  if (a === b) return 0;                       // +0 vs -0
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return Math.abs(ord(a) - ord(b));
}

/**
 * check 2 for one tile: `stampTile(t) === slice(buildGround(), t)`, cell for
 * cell, every channel.  `ref` is the whole-map replay's `channels` (same module,
 * no clip).  Returns per channel `{ maxUlp, cells, worst }` — `maxUlp === 0` is
 * the pass.  Failure is a REPORT (D-2): it names the channel and the cell.
 */
export function compareChannels(ref, got) {
  const { R, clip, w, h } = got;
  const win = clip.tile;
  const rows = [];
  for (const [name, A] of Object.entries(got.channels)) {
    const B = ref[name];
    if (!A || !B) { rows.push({ channel: name, maxUlp: 0, bad: 0, cells: 0, worst: null, released: true }); continue; }
    let maxUlp = 0, bad = 0, worst = null;
    for (let j = 0; j < h; j++) {
      const rs = (win.j0 + j) * R.RNX + win.i0, ws = j * w;
      for (let i = 0; i < w; i++) {
        const u = ulp(A[ws + i], B[rs + i]);
        if (u === 0) continue;
        bad++;
        if (u > maxUlp) {
          maxUlp = u;
          worst = { i: win.i0 + i, j: win.j0 + j, tile: A[ws + i], map: B[rs + i], ulp: u };
        }
      }
    }
    rows.push({ channel: name, maxUlp, bad, cells: w * h, worst });
  }
  return rows;
}

/** the whole-map replay — the reference side of check 2. */
export async function wholeMap(modPath) {
  gate();
  return replay(modPath, null);
}

/**
 * Flat binary dump of the reference, so a child process need not rebuild it.
 *
 * PER-CHANNEL TYPE, not one width for all (specs/0051 wave 2b): after wave 0b's
 * reclaim a red-dog raster is 11 Float32 + 2 Uint16 + 6 Uint8 channels and
 * GUARDF is released to null. The header therefore records each channel's
 * constructor name and byte length, and a released channel is written as a row
 * with no bytes rather than crashing the dump.
 */
const REF_TYPES = { Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array };

export function writeRef(file, R, channels) {
  const rows = Object.entries(channels).map(([name, A]) => ({
    name, type: A ? A.constructor.name : null, bytes: A ? A.byteLength : 0,
  }));
  const head = Buffer.from(JSON.stringify({ R, rows, names: rows.map((r) => r.name) }) + String.fromCharCode(10), 'utf8');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, head);
  let bytes = head.length;
  for (const r of rows) {
    if (!r.bytes) continue;
    const A = channels[r.name];
    fs.writeSync(fd, Buffer.from(A.buffer, A.byteOffset, A.byteLength));
    bytes += A.byteLength;
  }
  fs.closeSync(fd);
  return { names: rows.map((r) => r.name), rows, bytes };
}

export function readRef(file) {
  const buf = fs.readFileSync(file);
  const nl = buf.indexOf(0x0a);
  const head = JSON.parse(buf.subarray(0, nl).toString('utf8'));
  const rows = head.rows || head.names.map((name) => ({ name, type: 'Float32Array', bytes: head.R.RNX * head.R.RNY * 4 }));
  const channels = {};
  let off = nl + 1;
  for (const r of rows) {
    if (!r.bytes) { channels[r.name] = null; continue; }
    const T = REF_TYPES[r.type] || Float32Array;
    channels[r.name] = new T(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + r.bytes));
    off += r.bytes;
  }
  return { R: head.R, channels };
}

// ------------------------------------------------- the SAMPLING apron (§9.2 #6)
/**
 * Check 2 as written compares CELLS.  A per-tile raster also has to answer the
 * whole-map SAMPLERS — `groundZ`, `groundZ0`, `slopeAt0`, `masksAt`/`masksAt0`,
 * `slopeAt`, `normalAt` — bit-identically at every point inside the tile, and
 * those read at arbitrary positions, not at cell centres:
 *
 *   `bil`/`bil0` are bilinear, so a sample inside the tile reaches the cell one
 *   past the tile's last cell;  `slopeAt`/`slopeAt0`/`normalAt` are central
 *   differences at h = 3.0 m = 1.5 cells (`ground.mjs`), so they reach 1.5 cells
 *   outside the tile BEFORE that bilinear.  `terrain.mjs:783`'s per-vertex
 *   `normal(x, y, H)` uses the grid step, H = 1.00 m at L0 = 0.5 cells, which is
 *   inside slopeAt's reach and adds nothing.
 *
 * This probe measures the composite instead of asserting it: the tile's L0 vertex
 * lattice (65 x 65 at 1.00 m, boundary inclusive) is sampled through every
 * exported sampler on the clipped module and on the whole-map module, and the ULP
 * distance is reported per sampler and per mask key.
 */
export const SAMPLERS = {
  scalar: ['groundZ', 'groundZ0', 'rockAt', 'slopeAt', 'slopeAt0'],
  vector: ['normalAt'],
  object: ['masksAt', 'masksAt0', 'ktMasksAt'],
};

export function sampleGrid(t, R, step = 1.0) {
  const x0 = R.RX0 + t.tx * t.span, y0 = R.RY0 + t.ty * t.span;
  const n = Math.round(t.span / step) + 1;
  return { x0, y0, n, step };
}

/** ULP diff of every sampler between two evaluated modules, over one tile. */
export function compareSamplers(M0, M1, t, R, step = 1.0) {
  const g = sampleGrid(t, R, step);
  const rows = {};
  const bump = (key, u) => {
    const a = rows[key] || (rows[key] = { maxUlp: 0, bad: 0, n: 0 });
    a.n++; if (u > 0) { a.bad++; if (u > a.maxUlp) a.maxUlp = u; }
  };
  for (let j = 0; j < g.n; j++) {
    const y = g.y0 + j * g.step;
    for (let i = 0; i < g.n; i++) {
      const x = g.x0 + i * g.step;
      for (const f of SAMPLERS.scalar) if (typeof M0[f] === 'function') bump(f, ulp(M1[f](x, y), M0[f](x, y)));
      for (const f of SAMPLERS.vector) if (typeof M0[f] === 'function') {
        const a = M1[f](x, y), b = M0[f](x, y);
        let u = 0; for (let c = 0; c < b.length; c++) u = Math.max(u, ulp(a[c], b[c]));
        bump(f, u);
      }
      for (const f of SAMPLERS.object) if (typeof M0[f] === 'function') {
        const a = M1[f](x, y), b = M0[f](x, y);
        for (const k of Object.keys(b)) bump(`${f}.${k}`, ulp(a[k], b[k]));
      }
    }
  }
  return rows;
}

// ===========================================================================
// specs/0051 D-9 carry-over, wave 2b — THE SURFACE `lib/chunkgate.mjs` CALLS.
//
// Check 2 is wired as `await mod.compareTile({ apron })` against the SHIPPED
// module in an export build (`ctx.fileUrl('scene/stamp-tile.mjs')`), so this
// file now ships (dev-flagged) and carries a one-argument entry point that
// needs no scratch scripts, no reference dump and no caller-side plumbing: it
// finds `ground.mjs` beside itself, replays the whole map once, replays a
// sample of tiles under the clip, and reports per channel.
//
// `compareTile` keeps BOTH shapes. Two arguments is 0c's original cell-for-cell
// compare (`compareChannels`, unchanged); one options object is the gate's
// measurement and returns a promise.
//
// WHAT A MINIFIED BUILD DOES TO IT. The replay works by matching two exact
// source edits in the built `ground.mjs` (the D40 rule). A minified build has
// no such text, so the honest answer there is "not measurable from this build",
// reported as a row rather than thrown as an error — check 2 has no 0051
// consequence either way (D-2) and a REPORT that says why is worth more than a
// stack trace. Build with `--no-minify` for the numbers.
// ===========================================================================

export const sceneDirOf = () => path.dirname(fileURLToPath(import.meta.url));

/** the tiles a gate run samples: `n` L0 tiles spread across the raster extent. */
export function sampleTiles(R, n = 4, level = 'L0', frame = 'w') {
  const s = LEVEL_SPAN[level] / R.RES;
  const nx = Math.max(1, Math.ceil(R.RNX / s)), ny = Math.max(1, Math.ceil(R.RNY / s));
  const out = [];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n;
    out.push(tileId(frame, level, Math.min(nx - 1, Math.floor(u * nx)), Math.min(ny - 1, Math.floor(u * ny))));
  }
  return out;
}

// ---------------------------------------------------------- ONE REPLAY, ONE PROCESS
// A REPLAY LEAVES STATE BEHIND, AND THAT IS THE WHOLE REASON THIS FORKS.
// `replay()` gives each run a fresh copy of the instrumented `ground.mjs` (a new
// query string), but node caches its SIBLINGS — `layout.mjs`, `dem-data.mjs`,
// `lib/*` — deliberately, so the DEM is decoded once. Anything a stamp mutates
// through one of those siblings therefore survives into the next replay in the
// same process. Measured, 2026-09-05, red-dog tile w/L0/6/9 at apron 4:
// whole-map-then-tile IN ONE PROCESS reports 821 of 1,089 FZ cells differing
// (worst −22.31 vs 173.25) and every other channel clean; the SAME tile against
// the SAME reference read from a dump in a FRESH process reports 0 ULP on all
// eleven. The contamination is the measurement's, not the world's — which is
// exactly the kind of false red D-2 says check 2 must not manufacture.
//
// So: one child process per replay, the reference passed between them as the
// flat dump `writeRef`/`readRef` already existed for. `--ref` and `--tile` below
// are that child.
const selfPath = () => fileURLToPath(import.meta.url);
function child(args, cwd) {
  const r = spawnSync(process.execPath, [selfPath(), ...args], {
    cwd, encoding: 'utf8', maxBuffer: 1 << 28,
    env: { ...process.env, [FLAG]: '1' },
  });
  if (r.status !== 0) throw new Error(`stamp-tile child ${args[0]} failed (${r.status}): ${(r.stderr || '').slice(-800)}`);
  const lines = r.stdout.trim().split(String.fromCharCode(10));
  return JSON.parse(lines[lines.length - 1]);
}

export async function compareTileMeasurement(opts = {}) {
  process.env[FLAG] = process.env[FLAG] || '1';   // the gate's own invocation IS the flag
  const apron = opts.apron == null ? 4 : opts.apron;
  const tiles = opts.tiles == null ? 4 : opts.tiles;
  const sceneDir = opts.sceneDir || sceneDirOf();
  const t0 = Date.now();
  let prepared = null;
  try {
    prepared = prepare(sceneDir);
  } catch (e) {
    return { apron, tiles: 0, channels: [], measurable: false,
             note: `this build's ground.mjs could not be instrumented (${e.message}). `
                 + 'A minified build has no matchable source; re-run build.mjs --no-minify for check 2 '
                 + '(specs/0051 D-2: a measurement, no gate consequence).' };
  }
  const refFile = path.join(sceneDir, 'ground.__stamp-tile.ref');
  try {
    const head = child(['--ref', prepared.modPath, refFile]);
    const R = head.R;
    const ids = opts.ids || sampleTiles(R, tiles, opts.level || 'L0');
    const acc = new Map();
    for (const id of ids) {
      const rows = child(['--tile', prepared.modPath, refFile, id, String(apron), opts.halfOpen ? '1' : '0']).rows;
      for (const row of rows) {
        const a = acc.get(row.channel) || { name: row.channel, diff: 0, maxUlp: 0, cells: 0, tiles: 0, worst: null, released: false };
        a.diff += row.bad; a.cells += row.cells; a.tiles++;
        a.released = a.released || !!row.released;
        if (row.maxUlp > a.maxUlp) { a.maxUlp = row.maxUlp; a.worst = row.worst; }
        acc.set(row.channel, a);
      }
    }
    return { apron, tiles: ids.length, ids, measurable: true, ms: Date.now() - t0,
             channelsFound: head.names.length,
             raster: { RNX: R.RNX, RNY: R.RNY, RES: R.RES, RX0: R.RX0, RY0: R.RY0 },
             channels: [...acc.values()] };
  } finally {
    for (const f of [prepared.modPath, refFile]) { try { fs.unlinkSync(f); } catch { /* disposable */ } }
  }
}

// -------------------------------------------------------------------- the child
// `node stamp-tile.mjs --ref <mod> <out>` and
// `node stamp-tile.mjs --tile <mod> <ref> <id> <apron> <halfOpen>`. Each prints
// one JSON line and exits, which is what makes it a clean replay.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(selfPath())) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--ref') {
    const ref = await wholeMap(rest[0]);
    const w = writeRef(rest[1], ref.R, ref.channels);
    console.log(JSON.stringify({ R: ref.R, names: w.names, bytes: w.bytes }));
  } else if (mode === '--tile') {
    const [modPath, refFile, id, apron, halfOpen] = rest;
    const { R, channels } = readRef(refFile);
    const got = await stampTile(id, { modPath, apron: Number(apron), R, halfOpen: halfOpen === '1' });
    console.log(JSON.stringify({ id, rows: compareChannels(channels, got) }));
  } else {
    console.error('usage: stamp-tile.mjs --ref <mod> <out> | --tile <mod> <ref> <id> <apron> <halfOpen>');
    process.exit(2);
  }
}

/** two args → 0c's cell-for-cell compare; one options object → the gate's run. */
export function compareTile(a, b) {
  if (b === undefined || b === null) return compareTileMeasurement(a || {});
  return compareChannels(a, b);
}
