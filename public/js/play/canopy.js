// Canopy effects — what a tree DOES when you crash through it (specs/0012 §E3).
//
// solids.js decides that you are in the foliage and controller.js pays the
// speed for it. Neither of them should be drawing anything, so the two visible
// halves of a canopy hit live here:
//
//   * RUSTLE. The one instance you hit sways for half a second and settles. It
//     is written straight into the InstancedMesh's matrix buffer — the tree is
//     already being drawn, so a sway costs no draw call, no new object and no
//     material. The original 16 floats are kept and put back bit-exact at the
//     end, because this is the WORLD's geometry: a rounding drift left behind
//     on every tree you ever brushed would be a slow corruption of the scene.
//     `addUpdateRange` keeps the re-upload to the one matrix that moved rather
//     than the whole 8,000-instance buffer.
//
//   * LEAVES. specs/0032 §2 — the needles the branches themselves lost. A
//     SECOND pooled THREE.Points beside the snow, spawned in the same two discs
//     but green, bigger, slower and longer-lived, so what comes down through the
//     chase seat is snow AND tree rather than snow twice.
//
//   * SNOW FALL. The load the branches dropped on you. TWO discs per hit — one
//     centred on the stem, as wide as the cone is at head height, so a wide fir
//     sheds across its whole skirt; and one 1.2 m disc directly over the rider's
//     head, so the clumps also come down through his own frame and you can see
//     them from the chase seat. One pooled THREE.Points with a fixed 200-point
//     buffer serves both, `visible` only while something is alive, so it is +1
//     draw call during a hit and exactly 0 the rest of the time.
//     Per-point alpha rides in a 4-component colour attribute (three r150+
//     lights up USE_COLOR_ALPHA when a PointsMaterial's colour attribute has
//     four components), which is how each flake fades on its own without a
//     custom shader.
//
// NOT fx.js. That module is the trail agent's; this is a sibling with its own
// object, its own buffer and its own update, and the two never meet.
//
// The whole thing is driven from controller.update() rather than main.js: the
// controller is the only caller that has a dt for every step the body takes,
// including stepFixed()'s, which is what makes a rustle reproducible in a
// headless gate.

// specs/0031 §2 — a rustle you can SEE from four metres astern. 3° was a
// twitch: on a 20 m fir it threw the crown 0.4 m and it was behind you before
// the envelope peaked. 8° throws that crown ~2.8 m, and the slower decay (3.0
// instead of 4.5) leaves the second and third swings on screen instead of
// burying them — at 4 Hz over 0.9 s that is three and a half visible swings.
//
// 8.5 and not the 8.0 the spec asked for, because the AMPLITUDE is not the
// angle you get. The envelope and the sine peak at different times: the sine's
// first crest is at t = 1/16 s, by which point exp(-3.0 t) has already taken
// 16 % off, so a nominal 8.0 only ever tips the trunk 6.68° and specs/0031 §4.3
// wants ≥ 7°. 8.5 realises 7.10° at t = 0.058 s — 4.96 m of crown on the 39.82 m
// reference fir, 2.49 m on a 20 m one. (Measured: probe-0031-after.json.)
export const RUSTLE_DEG = 8.5;      // deg — peak sway AMPLITUDE at the base
export const RUSTLE_T = 0.9;        // s — how long one sway lasts
export const RUSTLE_HZ = 4.0;       // Hz — and how fast it wobbles
export const RUSTLE_DAMP = 3.0;     // 1/s — envelope decay
export const RUSTLE_MAX = 6;        // trees allowed to be swaying at once

export const SNOWFALL_N = 30;       // points spawned per hit, PER DISC
export const SNOWFALL_CAP = 200;    // ...and the pool both discs come out of
export const SNOWFALL_G = 6.0;      // m/s^2 — a shaken-loose clump is not a rock
export const SNOWFALL_LIFE = 1.5;   // s
export const SNOWFALL_DISC = 1.2;   // m — radius of the disc they spawn in
export const SNOWFALL_UP = 1.2;     // m — how far above the head that disc sits
export const SNOWFALL_DRIFT = 0.7;  // m/s — lateral scatter
export const SNOWFALL_SIZE = 0.09;  // scene units — ~6 px at 5 m in a 720-tall
                                    // viewport (three's point size is
                                    // size * (height/2) / distance)

// ---------------------------------------------------------- specs/0032 §2
// LEAVES. Points and not an InstancedMesh of quads, deliberately: a tumble
// wants a per-particle rotation, which means 160 makeRotation + setMatrixAt
// calls and a 160x64-byte instanceMatrix re-upload EVERY frame, against a
// budget of 0.15 ms for both pools together — and at 0.14 scene units the
// sprite is ~9 px at 5 m, where a tumble is a sub-pixel event nobody sees.
// What actually reads as "a needle, not a flake" is the FALL: a slow terminal
// velocity and a sideways wobble, and both of those are per-particle scalars a
// Points pool carries for free. So the flutter is in the motion, not the mesh,
// and the pool stays one draw call.
export const LEAF_N = 40;           // spawned per HIT, split across the discs
export const LEAF_CAP = 160;        // ...and the pool they come out of
export const LEAF_G = 2.5;          // m/s^2 — a needle is not a snow clump
export const LEAF_VT_MIN = 1.2;     // m/s — per-particle terminal fall, low end
export const LEAF_VT_MAX = 1.8;     // ...and high end. It flutters down; it does
                                    // not drop.
export const LEAF_LIFE = 2.2;       // s — outlasts the snow by 0.7 s
export const LEAF_FADE = 0.5;       // s — ...and fades over the last half of it
export const LEAF_DRIFT = 1.2;      // m/s — lateral drift, peak
export const LEAF_WOBBLE = 0.3;     // m — +/- of the sideways sway on top of it
export const LEAF_HZ_MIN = 0.5;     // Hz — how slowly that sway goes round,
export const LEAF_HZ_MAX = 1.0;     // ...per particle
export const LEAF_SIZE = 0.14;      // scene units — ~1.5x a snow clump
// The fallback foliage colours, for a fir whose InstancedMesh carries no
// instanceColor: a shadow green and a lit green, picked per particle.
export const LEAF_COLORS = [0x2f5d3a, 0x4b7a4a];
export const LEAF_VALUE_JITTER = 0.08;  // +/- on the value, per particle

const DEG = Math.PI / 180;

class CanopyFx {
  constructor(THREE, root, unit = 1) {
    this.THREE = THREE;
    this.root = root;
    this.unit = unit;
    this.hits = 0;
    this.rustles = [];               // { mesh, idx, t, ax, ay, az, m0 }
    this._M = new THREE.Matrix4();
    this._A = new THREE.Matrix4();
    this._axis = new THREE.Vector3();

    // ---- the snow pool. Fixed length: nothing here ever allocates again.
    const N = SNOWFALL_CAP;
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.age = new Float32Array(N);
    this.live = 0;                   // points [0, live) are alive; kill = swap with the last

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(N * 4), 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      size: SNOWFALL_SIZE * unit,
      sizeAttenuation: true,
      vertexColors: true,            // 4 components -> per-point alpha
      transparent: true,
      depthWrite: false,
      // snow-white, and white on purpose: the accent colour is the HUD's, and a
      // tree dropping orange would read as a pickup
      color: 0xffffff,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.name = 'play:canopy-snow';   // solids.js skips 'play:' when it scans
    this.points.frustumCulled = false;       // the bounds move every frame; a stale
                                             // sphere would blink the burst out
    this.points.renderOrder = 3;
    this.points.visible = false;             // 0 draw calls until something falls
    this.points.matrixAutoUpdate = false;    // world-space positions, identity matrix
    root.add(this.points);

    // ---- the leaf pool (specs/0032 §2). Same discipline, its own everything:
    // its own arrays, its own object, its own draw call. `lcx/lcy/lcz` is the
    // CORE the drift and gravity advect; the wobble is added on top at flush
    // time, so the sway never integrates into the trajectory and a needle that
    // has fluttered for two seconds is still where the drift put it.
    const L = LEAF_CAP;
    this.lcx = new Float32Array(L); this.lcy = new Float32Array(L); this.lcz = new Float32Array(L);
    this.lvx = new Float32Array(L); this.lvy = new Float32Array(L); this.lvz = new Float32Array(L);
    this.lage = new Float32Array(L);
    this.lvt = new Float32Array(L);          // per-particle terminal fall
    this.lw = new Float32Array(L);           // wobble phase (rad)
    this.lhz = new Float32Array(L);          // ...and its frequency
    this.lwx = new Float32Array(L); this.lwz = new Float32Array(L);  // wobble direction, xz unit
    this.lr = new Float32Array(L); this.lg = new Float32Array(L); this.lb = new Float32Array(L);
    this.leaves = 0;

    const lgeo = new THREE.BufferGeometry();
    this.lposAttr = new THREE.BufferAttribute(new Float32Array(L * 3), 3);
    this.lcolAttr = new THREE.BufferAttribute(new Float32Array(L * 4), 4);
    this.lposAttr.setUsage(THREE.DynamicDrawUsage);
    this.lcolAttr.setUsage(THREE.DynamicDrawUsage);
    lgeo.setAttribute('position', this.lposAttr);
    lgeo.setAttribute('color', this.lcolAttr);
    lgeo.setDrawRange(0, 0);
    const lmat = new THREE.PointsMaterial({
      size: LEAF_SIZE * unit,
      sizeAttenuation: true,
      vertexColors: true,            // rgb per needle + the fade in .a
      transparent: true,
      depthWrite: false,
      color: 0xffffff,               // white BASE: the tint is entirely per-point
    });
    this.leafPoints = new THREE.Points(lgeo, lmat);
    this.leafPoints.name = 'play:canopy-leaves';
    this.leafPoints.frustumCulled = false;
    this.leafPoints.renderOrder = 3;
    this.leafPoints.visible = false;         // 0 draw calls until something falls
    this.leafPoints.matrixAutoUpdate = false;
    root.add(this.leafPoints);
    this._col = new THREE.Color();
  }

  // ---- specs/0012 §E3, retuned by specs/0031 §3. `i` is the stem index the
  // controller hit; (x, y, z) is the rider's HEAD. TWO discs, because the two
  // readings of "where does the snow come from" are both right and neither one
  // covers the other:
  //
  //   * the TREE disc — centred on the stem and as wide as the cone is at head
  //     height, so a wide fir sheds across its whole skirt and a sapling drops
  //     a handful, falling from 0.7-3x SNOWFALL_UP so it keeps arriving. Greg,
  //     2026-09-01: "snow effect should be more of the tree".
  //   * the HEAD disc — the original 1.2 m one, SNOWFALL_UP above the head and
  //     0.6-1.4x of it, so the clumps come down through the rider's own frame.
  //     The tree disc alone put them all round the trunk, which from four
  //     metres astern is snow falling somewhere ELSE. Greg, 2026-09-02: "snow
  //     yes".
  //
  // With the pool at 200 the two never starve each other. A stem with no cone
  // (a merged forest, a sapling) spawns the head disc only, which is exactly
  // what the pre-54dec5e build did.
  hit(i, x, y, z) {
    this.hits++;
    const S = this.stems;
    let treeR = 0;
    if (S && S.cr && i >= 0 && S.cr[i] > 0) {
      const y0 = S.cy[i], top = S.st[i], hy = y + SNOWFALL_UP * this.unit;
      const cone = S.cr[i] * Math.max(0, Math.min(1, (top - hy) / (top - y0)));
      treeR = Math.max(SNOWFALL_DISC * this.unit, cone);
      this.snow(S.sx[i], y, S.sz[i], treeR, 0.7, 2.3);
    }
    this.snow(x, y, z, SNOWFALL_DISC * this.unit, 0.6, 0.8);

    // specs/0032 §2 — the needles, in the SAME two discs and always LEAF_N of
    // them per hit: 20 off the skirt and 20 over the head when the stem has a
    // cone, all 40 over the head when it does not. Unlike the snow this does
    // NOT scale with the disc — Greg asked for a fixed handful shaken loose,
    // and 160 in the pool is four hits' worth.
    const tint = this.foliageColor(i);
    if (treeR > 0) {
      this.leaf(S.sx[i], y, S.sz[i], treeR, LEAF_N >> 1, tint);
      this.leaf(x, y, z, SNOWFALL_DISC * this.unit, LEAF_N - (LEAF_N >> 1), tint);
    } else {
      this.leaf(x, y, z, SNOWFALL_DISC * this.unit, LEAF_N, tint);
    }
    this.rustle(i);
  }

  // The colour a needle off stem `i` should be. If the InstancedMesh the stem
  // lives in carries an instanceColor, that IS the tree's own foliage and it is
  // read straight off the buffer; otherwise the two fir greens. Returns a plain
  // {r,g,b} in linear-ish 0-1, which `leaf()` then jitters per particle.
  foliageColor(i) {
    const S = this.stems;
    try {
      if (S && S.meshes && S.sm && S.sm[i] >= 0) {
        const mesh = S.meshes[S.sm[i]];
        const idx = S.si[i];
        if (mesh && mesh.instanceColor && idx >= 0 && idx < mesh.count && mesh.getColorAt) {
          mesh.getColorAt(idx, this._col);
          // a white/near-black instanceColor is a tint multiplier, not a
          // foliage colour; fall back rather than shed grey needles
          const m = Math.max(this._col.r, this._col.g, this._col.b);
          const mn = Math.min(this._col.r, this._col.g, this._col.b);
          if (m > 0.04 && (m - mn) > 0.02) return { r: this._col.r, g: this._col.g, b: this._col.b };
        }
      }
    } catch { /* an older three, or a mesh mid-dispose */ }
    return null;
  }

  // One burst of needles into a disc of radius `disc` centred on (x, z), at the
  // rider's head height `y`. `n` is how many; `tint` is the tree's colour or
  // null for the fir greens.
  leaf(x, y, z, disc, n, tint) {
    const up = SNOWFALL_UP * this.unit;
    for (let k = 0; k < n; k++) {
      if (this.leaves >= LEAF_CAP) break;          // the pool is the pool
      const i = this.leaves++;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * disc;   // uniform over the area
      this.lcx[i] = x + Math.cos(a) * r;
      this.lcy[i] = y + up * (0.6 + Math.random() * 0.8);   // 0.6-1.4x SNOWFALL_UP
      this.lcz[i] = z + Math.sin(a) * r;
      // drift: a random compass direction, up to LEAF_DRIFT
      const da = Math.random() * Math.PI * 2, ds = Math.random() * LEAF_DRIFT * this.unit;
      this.lvx[i] = Math.cos(da) * ds;
      this.lvz[i] = Math.sin(da) * ds;
      this.lvy[i] = -Math.random() * 0.2 * this.unit;       // barely moving yet
      this.lvt[i] = (LEAF_VT_MIN + Math.random() * (LEAF_VT_MAX - LEAF_VT_MIN)) * this.unit;
      this.lage[i] = 0;
      // the wobble rides ACROSS the drift, so a needle scribbles sideways
      // instead of pumping its own speed up and down
      this.lw[i] = Math.random() * Math.PI * 2;
      this.lhz[i] = LEAF_HZ_MIN + Math.random() * (LEAF_HZ_MAX - LEAF_HZ_MIN);
      const wa = da + Math.PI / 2;
      this.lwx[i] = Math.cos(wa); this.lwz[i] = Math.sin(wa);
      // colour: the tree's own, or one of the two greens, +/- 8 % of value
      let cr, cg, cb;
      if (tint) { cr = tint.r; cg = tint.g; cb = tint.b; }
      else {
        const hex = LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0];
        cr = ((hex >> 16) & 255) / 255; cg = ((hex >> 8) & 255) / 255; cb = (hex & 255) / 255;
      }
      const j = 1 + (Math.random() * 2 - 1) * LEAF_VALUE_JITTER;
      this.lr[i] = Math.min(1, cr * j); this.lg[i] = Math.min(1, cg * j); this.lb[i] = Math.min(1, cb * j);
    }
    this.leafFlush();       // on screen on the NEXT rendered frame, as the snow is
  }

  // Which InstancedMesh instance is stem `i`? solids.js records it at harvest;
  // a set that did not record one (a merged forest has no instance to sway)
  // simply does not rustle.
  rustle(i) {
    const S = this.stems;
    if (!S || !S.meshes || !S.meshes.length) return false;
    if (this.rustles.length >= RUSTLE_MAX) return false;      // four is the crowd
    const mi = S.sm ? S.sm[i] : -1;
    if (mi < 0) return false;
    const mesh = S.meshes[mi];
    const idx = S.si[i];
    if (!mesh || !mesh.isInstancedMesh || idx < 0 || idx >= mesh.count) return false;
    for (const r of this.rustles) if (r.mesh === mesh && r.idx === idx) return false;

    // the ORIGINAL matrix, kept verbatim. instanceMatrix.array is a Float32Array
    // and Matrix4.toArray writes the same floats back, so the restore at the end
    // is bit-for-bit and not merely close.
    const m0 = new Float32Array(16);
    mesh.getMatrixAt(idx, this._M);
    this._M.toArray(m0);

    // Sway about a HORIZONTAL axis through the base, in the mesh's own frame:
    // a z-up world's firs stand along local Z, so the axis has to be picked
    // from the two axes that are not the mesh frame's up. `phase` scatters the
    // direction so two trees in the same glade do not lean the same way.
    const up = upAxisOf(mesh.matrixWorld);
    const a = (up + 1) % 3, b = (up + 2) % 3;
    const phase = ((i * 2654435761) % 1000) / 1000 * Math.PI * 2;
    const ax = [0, 0, 0];
    ax[a] = Math.cos(phase); ax[b] = Math.sin(phase);
    this.rustles.push({ mesh, idx, t: 0, ax: ax[0], ay: ax[1], az: ax[2], m0 });
    return true;
  }

  // `lo`/`span` are the spawn height above `y`, in multiples of SNOWFALL_UP:
  // the tree disc uses 0.7-3x so the skirt keeps letting go for the whole life
  // of the burst, the head disc the original 0.6-1.4x so those clumps are
  // already in frame on the shutter you actually see.
  snow(x, y, z, disc = SNOWFALL_DISC * this.unit, lo = 0.7, span = 2.3) {
    // a wider skirt sheds more — N scales with the disc, capped by the pool
    const N = Math.min(SNOWFALL_CAP, Math.round(SNOWFALL_N * Math.max(1, disc / (SNOWFALL_DISC * this.unit))));
    for (let k = 0; k < N; k++) {
      if (this.live >= SNOWFALL_CAP) break;      // the pool is the pool
      const i = this.live++;
      // a disc, not a square: sqrt keeps the sample uniform over the area
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * disc;
      this.px[i] = x + Math.cos(a) * r;
      // from the branches above, not one shelf
      this.py[i] = y + SNOWFALL_UP * this.unit * (lo + Math.random() * span);
      this.pz[i] = z + Math.sin(a) * r;
      this.vx[i] = (Math.random() - 0.5) * SNOWFALL_DRIFT * this.unit;
      this.vy[i] = -Math.random() * 0.4 * this.unit;   // already letting go
      this.vz[i] = (Math.random() - 0.5) * SNOWFALL_DRIFT * this.unit;
      this.age[i] = 0;
    }
    // The burst has to be on screen on the NEXT rendered frame, not the next
    // physics step: controller.update() calls update(dt) at the top and the
    // canopy guard fires at the bottom, so a spawn that waited for the next
    // update would miss a frame — visible at 60 fps as a hole in the hit.
    this.flush();
  }

  // write the live points into the GPU buffers and take the object in or out of
  // the render list. The only place `visible` is ever set.
  flush() {
    const pa = this.posAttr.array, ca = this.colAttr.array;
    const n = this.live;
    for (let i = 0; i < n; i++) {
      const o = i * 3, c = i * 4;
      pa[o] = this.px[i]; pa[o + 1] = this.py[i]; pa[o + 2] = this.pz[i];
      const f = this.age[i] / SNOWFALL_LIFE;
      ca[c] = 1; ca[c + 1] = 1; ca[c + 2] = 1;
      ca[c + 3] = f < 0.3 ? 1 : Math.max(0, 1 - (f - 0.3) / 0.7);
    }
    this.points.geometry.setDrawRange(0, n);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.points.visible = n > 0;
  }

  // The leaf pool's half of flush(): core position + the wobble offset, and the
  // per-needle colour with the fade in alpha. Same `visible` discipline — the
  // ONLY place leafPoints.visible is ever set, so "+1 draw call while a leaf is
  // alive, 0 at rest" is a property of one line.
  leafFlush() {
    const pa = this.lposAttr.array, ca = this.lcolAttr.array;
    const n = this.leaves;
    const hold = LEAF_LIFE - LEAF_FADE;
    const amp = LEAF_WOBBLE * this.unit;
    for (let i = 0; i < n; i++) {
      const o = i * 3, c = i * 4;
      const s = Math.sin(2 * Math.PI * this.lhz[i] * this.lage[i] + this.lw[i]) * amp;
      pa[o] = this.lcx[i] + this.lwx[i] * s;
      pa[o + 1] = this.lcy[i];
      pa[o + 2] = this.lcz[i] + this.lwz[i] * s;
      ca[c] = this.lr[i]; ca[c + 1] = this.lg[i]; ca[c + 2] = this.lb[i];
      const t = this.lage[i];
      ca[c + 3] = t < hold ? 1 : Math.max(0, 1 - (t - hold) / LEAF_FADE);
    }
    this.leafPoints.geometry.setDrawRange(0, n);
    this.lposAttr.needsUpdate = true;
    this.lcolAttr.needsUpdate = true;
    this.leafPoints.visible = n > 0;
  }

  stepLeaves(dt) {
    if (!this.leaves) return;                // nothing alive: not one instruction
    const g = LEAF_G * this.unit;
    let n = this.leaves;
    for (let i = 0; i < n; i++) {
      this.lage[i] += dt;
      if (this.lage[i] >= LEAF_LIFE) {
        const j = --n;                       // swap-remove: the pool stays packed
        if (j !== i) {
          this.lcx[i] = this.lcx[j]; this.lcy[i] = this.lcy[j]; this.lcz[i] = this.lcz[j];
          this.lvx[i] = this.lvx[j]; this.lvy[i] = this.lvy[j]; this.lvz[i] = this.lvz[j];
          this.lage[i] = this.lage[j]; this.lvt[i] = this.lvt[j];
          this.lw[i] = this.lw[j]; this.lhz[i] = this.lhz[j];
          this.lwx[i] = this.lwx[j]; this.lwz[i] = this.lwz[j];
          this.lr[i] = this.lr[j]; this.lg[i] = this.lg[j]; this.lb[i] = this.lb[j];
        }
        i--;
        continue;
      }
      // gravity, but CLAMPED: a needle reaches its own terminal fall in under
      // a second and then descends at it. This is the whole difference between
      // a leaf and the snow clump, which is on a free 6 m/s^2 fall.
      let vy = this.lvy[i] - g * dt;
      if (vy < -this.lvt[i]) vy = -this.lvt[i];
      this.lvy[i] = vy;
      this.lcx[i] += this.lvx[i] * dt;
      this.lcy[i] += vy * dt;
      this.lcz[i] += this.lvz[i] * dt;
    }
    this.leaves = n;
    this.leafFlush();
  }

  update(dt) {
    if (dt > 0.1) dt = 0.1;            // a tab that was in the background
    this.stepRustle(dt);
    this.stepSnow(dt);
    this.stepLeaves(dt);
  }

  stepRustle(dt) {
    const R = this.rustles;
    for (let k = R.length - 1; k >= 0; k--) {
      const r = R[k];
      r.t += dt;
      if (r.t >= RUSTLE_T) {
        // settled: put the world back exactly as it was found
        this._M.fromArray(r.m0);
        r.mesh.setMatrixAt(r.idx, this._M);
        markInstance(r.mesh, r.idx);
        R.splice(k, 1);
        continue;
      }
      const ang = RUSTLE_DEG * DEG * Math.exp(-RUSTLE_DAMP * r.t)
                * Math.sin(2 * Math.PI * RUSTLE_HZ * r.t);
      this._axis.set(r.ax, r.ay, r.az);
      this._A.makeRotationAxis(this._axis, ang);
      // rotate ABOUT THE BASE: M0 is [basis | p], so A applied to the basis with
      // p left alone is exactly T(p)·A·T(-p)·M0 and the trunk stays planted.
      this._M.fromArray(r.m0);
      const e = this._M.elements;
      const px = e[12], py = e[13], pz = e[14];
      this._M.setPosition(0, 0, 0);
      this._M.premultiply(this._A);
      this._M.setPosition(px, py, pz);
      r.mesh.setMatrixAt(r.idx, this._M);
      markInstance(r.mesh, r.idx);
    }
  }

  stepSnow(dt) {
    if (!this.live) return;                  // nothing alive: not one instruction
    const g = SNOWFALL_G * this.unit;
    let n = this.live;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= SNOWFALL_LIFE) {
        // swap-remove: the pool stays packed, so the draw range is [0, live)
        const j = --n;
        if (j !== i) {
          this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
          this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
          this.age[i] = this.age[j];
        }
        i--;
        continue;
      }
      this.vy[i] -= g * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
    }
    this.live = n;
    this.flush();
  }

  stats() {
    return {
      hits: this.hits,
      snowLive: this.live,
      rustling: this.rustles.length,
      draws: this.points.visible ? 1 : 0,
      // specs/0032 §2 — the leaf pool's two numbers, alongside the snow's
      leaves: this.leaves,
      leafDraws: this.leafPoints.visible ? 1 : 0,
    };
  }

  // A rustling tree's 16 floats, for a gate that wants to prove the restore is
  // exact rather than approximately exact.
  matrixOf(meshIndex, idx) {
    const S = this.stems;
    const mesh = S && S.meshes ? S.meshes[meshIndex] : null;
    if (!mesh) return null;
    mesh.getMatrixAt(idx, this._M);
    return this._M.toArray([]);
  }

  matrixOfStem(i) {
    const S = this.stems;
    if (!S || !S.sm || S.sm[i] < 0) return null;
    return this.matrixOf(S.sm[i], S.si[i]);
  }

  // Put every tree back and drop every flake. A teleport or a gate that wants a
  // clean baseline calls this; nothing in normal play does.
  reset() {
    for (const r of this.rustles) {
      this._M.fromArray(r.m0);
      r.mesh.setMatrixAt(r.idx, this._M);
      markInstance(r.mesh, r.idx);
    }
    this.rustles.length = 0;
    this.live = 0;
    this.leaves = 0;
    this.hits = 0;
    this.flush();
    this.leafFlush();
  }

  dispose() {
    for (const r of this.rustles) {
      this._M.fromArray(r.m0);
      r.mesh.setMatrixAt(r.idx, this._M);
      markInstance(r.mesh, r.idx);
    }
    this.rustles.length = 0;
    if (this.points.parent) this.points.parent.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    if (this.leafPoints.parent) this.leafPoints.parent.remove(this.leafPoints);
    this.leafPoints.geometry.dispose();
    this.leafPoints.material.dispose();
  }
}

// Re-upload ONE instance matrix, not the whole buffer: a `needsUpdate` with no
// range re-sends every fir in the mesh (8,000 x 64 bytes) to move one of them.
// three r159+ takes an explicit range; older builds only understand "the lot",
// which still works, just expensively.
//
// The renderer CLEARS the range list once it has uploaded it, so in any frame
// that actually draws this list is one entry long and nothing here may clear it
// itself — two trees swaying in the same InstancedMesh would then overwrite
// each other's range and only the second would move. A headless stepFixed()
// never draws, so the list has nothing to clear it: the cap below bounds that
// case, and dropping ranges there costs nothing because nothing is uploading.
function markInstance(mesh, idx) {
  const a = mesh.instanceMatrix;
  if (a.addUpdateRange) {
    if (a.updateRanges && a.updateRanges.length >= 32) a.clearUpdateRanges();
    a.addUpdateRange(idx * 16, 16);
  }
  a.needsUpdate = true;
}

// Which LOCAL axis of `M` points at world up (the same reading solids.js takes).
function upAxisOf(M) {
  const e = M.elements;
  const ax = Math.abs(e[1]), ay = Math.abs(e[5]), az = Math.abs(e[9]);
  return ax > ay ? (ax > az ? 0 : 2) : (ay > az ? 1 : 2);
}

const CACHE = new WeakMap();

/**
 * The canopy effects for `root`, cached on it the way the stem scan is.
 * `stems` is the StemSet from solids.js — the fx read `meshes`/`sm`/`si` off it
 * to find the InstancedMesh instance behind a stem index.
 */
export function createCanopyFx(THREE, root, stems, opts = {}) {
  if (!THREE || !root) return null;
  const hit = CACHE.get(root);
  if (hit) { hit.stems = stems || hit.stems; return hit; }
  const fx = new CanopyFx(THREE, root, opts.unit || 1);
  fx.stems = stems;
  CACHE.set(root, fx);
  // Lab handle, the same convention as window.__playCollision: a gate needs to
  // read the live point count and the swaying count without main.js growing a
  // test hook for a module main.js does not import.
  try { if (typeof window !== 'undefined') window.__playCanopy = fx; } catch { /* not a browser */ }
  return fx;
}

export default createCanopyFx;
