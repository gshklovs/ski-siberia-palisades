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
//   * SNOW FALL. The load the branches dropped on you. One pooled THREE.Points
//     with a fixed 120-point buffer, `visible` only while something is alive,
//     so it is +1 draw call during a hit and exactly 0 the rest of the time.
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

export const RUSTLE_DEG = 3.0;      // deg — peak sway angle at the base
export const RUSTLE_T = 0.5;        // s — how long one sway lasts
export const RUSTLE_HZ = 4.0;       // Hz — and how fast it wobbles
export const RUSTLE_DAMP = 4.5;     // 1/s — envelope decay
export const RUSTLE_MAX = 4;        // trees allowed to be swaying at once

export const SNOWFALL_N = 30;       // points spawned per hit
export const SNOWFALL_CAP = 120;    // ...and the pool they come out of
export const SNOWFALL_G = 6.0;      // m/s^2 — a shaken-loose clump is not a rock
export const SNOWFALL_LIFE = 1.5;   // s
export const SNOWFALL_DISC = 1.2;   // m — radius of the disc they spawn in
export const SNOWFALL_UP = 1.2;     // m — how far above the head that disc sits
export const SNOWFALL_DRIFT = 0.7;  // m/s — lateral scatter
export const SNOWFALL_SIZE = 0.09;  // scene units — ~6 px at 5 m in a 720-tall
                                    // viewport (three's point size is
                                    // size * (height/2) / distance)

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
  }

  // ---- specs/0012 §E3. `i` is the stem index the controller hit; (x, y, z) is
  // the rider's HEAD. The snow comes off the TREE, not the head: the disc is
  // centred on the stem and as wide as the cone is at head height, so a wide
  // fir sheds across its whole skirt and a sapling drops a handful. (It used to
  // be a 1.2 m disc over the rider — Greg, 2026-09-01: "snow effect should be
  // more of the tree".) Falls back to the head when the stem has no cone.
  hit(i, x, y, z) {
    this.hits++;
    const S = this.stems;
    let cx = x, cz = z, r = SNOWFALL_DISC * this.unit;
    if (S && S.cr && i >= 0 && S.cr[i] > 0) {
      const y0 = S.cy[i], top = S.st[i], hy = y + SNOWFALL_UP * this.unit;
      const cone = S.cr[i] * Math.max(0, Math.min(1, (top - hy) / (top - y0)));
      cx = S.sx[i]; cz = S.sz[i]; r = Math.max(r, cone);
    }
    this.snow(cx, y, cz, r);
    this.rustle(i);
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

  snow(x, y, z, disc = SNOWFALL_DISC * this.unit) {
    // a wider skirt sheds more — N scales with the disc, capped by the pool
    const N = Math.min(SNOWFALL_CAP, Math.round(SNOWFALL_N * Math.max(1, disc / (SNOWFALL_DISC * this.unit))));
    for (let k = 0; k < N; k++) {
      if (this.live >= SNOWFALL_CAP) break;      // the pool is the pool
      const i = this.live++;
      // a disc, not a square: sqrt keeps the sample uniform over the area
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * disc;
      this.px[i] = x + Math.cos(a) * r;
      // from the branches above, not one shelf: 0.7-3x SNOWFALL_UP so the
      // clumps keep arriving for the whole life of the burst
      this.py[i] = y + SNOWFALL_UP * this.unit * (0.7 + Math.random() * 2.3);
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

  update(dt) {
    if (dt > 0.1) dt = 0.1;            // a tab that was in the background
    this.stepRustle(dt);
    this.stepSnow(dt);
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
    this.hits = 0;
    this.flush();
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
