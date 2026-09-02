// Collision for the first-person player.
//
// No physics library. At load we flatten the scene's collidable meshes into a
// flat world-space triangle soup and bin it into a uniform XZ grid; queries are
// then plain Möller–Trumbore against the handful of triangles in one cell.
// That is enough for "walk on a beach, climb a rock, bump into a tree", and it
// is fast enough to run three rays a frame against a 500k-triangle scene.

const EPS = 1e-7;

// A collider is anything a body could stand on or walk into. Backdrops are
// not: sky domes, distant ridge rings, clouds and water are geometry the
// author put there to be looked at, and standing on them is always a bug.
function isBackdrop(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (!m) continue;
    if (m.transparent && (m.opacity ?? 1) < 0.98) return true;   // water, clouds
    if (m.side === 1 /* THREE.BackSide */) return true;          // sky dome
    if (m.fog === false && (m.isMeshBasicMaterial || m.isShaderMaterial)) return true; // hazed ridges
    if (m.depthWrite === false) return true;
  }
  return /sky|cloud|ridge|haze|water|backdrop|fog|helper|grid/i.test(mesh.name || '');
}

// World-space bounds of everything a body could touch. Used to sanity check
// the scene's units before any tuning number is trusted.
export function collidableBox(THREE, root) {
  const box = new THREE.Box3();
  const one = new THREE.Box3();
  root.updateMatrixWorld(true);
  let n = 0;
  root.traverse((o) => {
    if (!o.visible || !o.isMesh || isBackdrop(o)) return;
    one.setFromObject(o);
    if (one.isEmpty()) return;
    box.union(one); n++;
  });
  return { box, meshes: n };
}

function growF32(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Float32Array(n);
  out.set(buf);
  return out;
}
function growI32(buf, need) {
  if (need <= buf.length) return buf;
  let n = buf.length || 1024;
  while (n < need) n *= 2;
  const out = new Int32Array(n);
  out.set(buf);
  return out;
}

export function buildCollision(THREE, root, opts = {}) {
  const cell = opts.cell || 6;
  const half = opts.halfExtent || 620;
  const center = opts.center || new THREE.Vector3();
  const maxCellsPerTri = opts.maxCellsPerTri || 64;   // rejects backdrop-sized triangles
  const triBudget = opts.triBudget || 900000;

  const x0 = center.x - half, z0 = center.z - half;
  const nx = Math.max(1, Math.ceil((half * 2) / cell));
  const nz = nx;

  root.updateMatrixWorld(true);

  let V = new Float32Array(1 << 16);   // 9 floats per triangle, world space
  let B = new Int32Array(1 << 14);     // 4 ints per triangle: i0,j0,i1,j1
  let nTri = 0, nEntries = 0;
  let skippedOversize = 0, skippedOutside = 0, meshesUsed = 0, meshesSkipped = 0;
  let minY = Infinity, maxY = -Infinity;

  const m4 = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ipos = new THREE.Vector3();

  function pushTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    if (nTri >= triBudget) return;
    const lox = Math.min(ax, bx, cx), hix = Math.max(ax, bx, cx);
    const loz = Math.min(az, bz, cz), hiz = Math.max(az, bz, cz);
    if (hix < x0 || lox > x0 + nx * cell || hiz < z0 || loz > z0 + nz * cell) { skippedOutside++; return; }
    const i0 = Math.max(0, Math.floor((lox - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((hix - x0) / cell));
    const j0 = Math.max(0, Math.floor((loz - z0) / cell)), j1 = Math.min(nz - 1, Math.floor((hiz - z0) / cell));
    const cells = (i1 - i0 + 1) * (j1 - j0 + 1);
    if (cells > maxCellsPerTri) { skippedOversize++; return; }

    V = growF32(V, (nTri + 1) * 9);
    const o = nTri * 9;
    V[o] = ax; V[o + 1] = ay; V[o + 2] = az;
    V[o + 3] = bx; V[o + 4] = by; V[o + 5] = bz;
    V[o + 6] = cx; V[o + 7] = cy; V[o + 8] = cz;
    B = growI32(B, (nTri + 1) * 4);
    const p = nTri * 4;
    B[p] = i0; B[p + 1] = j0; B[p + 2] = i1; B[p + 3] = j1;
    nEntries += cells;
    nTri++;
    if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
    if (by < minY) minY = by; if (by > maxY) maxY = by;
    if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
  }

  function eatGeometry(geo, mat) {
    const pos = geo.getAttribute && geo.getAttribute('position');
    if (!pos) return;
    const idx = geo.index;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      va.set(pos.getX(a), pos.getY(a), pos.getZ(a)).applyMatrix4(mat);
      vb.set(pos.getX(b), pos.getY(b), pos.getZ(b)).applyMatrix4(mat);
      vc.set(pos.getX(c), pos.getY(c), pos.getZ(c)).applyMatrix4(mat);
      pushTri(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
    }
  }

  const explicit = opts.colliders && opts.colliders.length ? opts.colliders : null;
  const roots = explicit || [root];
  for (const r of roots) {
    r.traverse((o) => {
      if (!o.visible || !o.isMesh) return;
      if (!explicit && isBackdrop(o)) { meshesSkipped++; return; }
      const geo = o.geometry;
      if (!geo || !geo.getAttribute || !geo.getAttribute('position')) return;
      meshesUsed++;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, inst);
          ipos.setFromMatrixPosition(inst).applyMatrix4(o.matrixWorld);
          if (Math.abs(ipos.x - center.x) > half + 80 || Math.abs(ipos.z - center.z) > half + 80) continue;
          m4.multiplyMatrices(o.matrixWorld, inst);
          eatGeometry(geo, m4);
        }
      } else {
        eatGeometry(geo, o.matrixWorld);
      }
    });
  }

  // counting sort of triangles into cells
  const nCells = nx * nz;
  const start = new Int32Array(nCells + 1);
  for (let t = 0; t < nTri; t++) {
    const p = t * 4;
    for (let j = B[p + 1]; j <= B[p + 3]; j++) {
      const row = j * nx;
      for (let i = B[p]; i <= B[p + 2]; i++) start[row + i + 1]++;
    }
  }
  for (let c = 0; c < nCells; c++) start[c + 1] += start[c];
  const items = new Int32Array(nEntries);
  const cursor = start.slice(0, nCells);
  for (let t = 0; t < nTri; t++) {
    const p = t * 4;
    for (let j = B[p + 1]; j <= B[p + 3]; j++) {
      const row = j * nx;
      for (let i = B[p]; i <= B[p + 2]; i++) items[cursor[row + i]++] = t;
    }
  }
  B = null;

  const tris = V.subarray(0, nTri * 9);
  const stamp = new Int32Array(nTri);
  let stampGen = 0;

  // ---- queries -------------------------------------------------------------

  // Ray/triangle, double sided: geometry we walk on is authored with all sorts
  // of winding, and a one-sided test silently drops floors.
  function hitTri(t, ox, oy, oz, dx, dy, dz, maxDist, out) {
    const o = t * 9;
    const ax = tris[o], ay = tris[o + 1], az = tris[o + 2];
    const e1x = tris[o + 3] - ax, e1y = tris[o + 4] - ay, e1z = tris[o + 5] - az;
    const e2x = tris[o + 6] - ax, e2y = tris[o + 7] - ay, e2z = tris[o + 8] - az;
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -EPS && det < EPS) return false;
    const inv = 1 / det;
    const tx = ox - ax, ty = oy - ay, tz = oz - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-6 || u > 1 + 1e-6) return false;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < -1e-6 || u + v > 1 + 1e-6) return false;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist < 0 || dist > maxDist) return false;
    out.dist = dist;
    // geometric normal, flipped to oppose the ray
    let nxv = e1y * e2z - e1z * e2y, nyv = e1z * e2x - e1x * e2z, nzv = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nxv, nyv, nzv) || 1;
    nxv /= len; nyv /= len; nzv /= len;
    if (nxv * dx + nyv * dy + nzv * dz > 0) { nxv = -nxv; nyv = -nyv; nzv = -nzv; }
    out.nx = nxv; out.ny = nyv; out.nz = nzv;
    return true;
  }

  const scratch = { dist: 0, nx: 0, ny: 0, nz: 0 };
  const best = { dist: 0, nx: 0, ny: 1, nz: 0, y: 0, hit: false };
  // ground normal from the last groundAt(), kept apart from `best` so a raycast
  // in between cannot overwrite it (skiing reads it a few lines later)
  const gn = { x: 0, y: 1, z: 0 };

  function cellOf(x, z) {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return -1;
    return j * nx + i;
  }

  // Highest surface strictly below `fromY` at (x,z). null = nothing under you.
  function groundAt(x, z, fromY) {
    const c = cellOf(x, z);
    if (c < 0) return null;
    const s = start[c], e = start[c + 1];
    let hitY = -Infinity, hnx = 0, hn = 1, hnz = 0;
    for (let k = s; k < e; k++) {
      const t = items[k];
      if (hitTri(t, x, fromY, z, 0, -1, 0, 1e5, scratch)) {
        const y = fromY - scratch.dist;
        if (y > hitY) { hitY = y; hnx = scratch.nx; hn = scratch.ny; hnz = scratch.nz; }
      }
    }
    if (hitY === -Infinity) return null;
    best.y = hitY; best.ny = hn;
    gn.x = hnx; gn.y = hn; gn.z = hnz;   // always points up: the probe ray is -Y
    return hitY;
  }
  function groundNormalY() { return best.ny; }
  // The surface you are standing on, as of the last groundAt() that hit. Live
  // object — copy it if you need to keep it.
  function groundNormal() { return gn; }

  // Short arbitrary ray. Distances here are sub-metre, so sampling the cells
  // along the segment beats a full grid DDA and cannot miss at this length.
  function raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    const steps = Math.max(1, Math.ceil(maxDist / (cell * 0.5)));
    stampGen++;
    let found = false, bd = maxDist;
    for (let s = 0; s <= steps; s++) {
      const f = (s / steps) * maxDist;
      const c = cellOf(ox + dx * f, oz + dz * f);
      if (c < 0) continue;
      const a = start[c], b = start[c + 1];
      for (let k = a; k < b; k++) {
        const t = items[k];
        if (stamp[t] === stampGen) continue;
        stamp[t] = stampGen;
        if (hitTri(t, ox, oy, oz, dx, dy, dz, bd, scratch) && scratch.dist < bd) {
          bd = scratch.dist; found = true;
          best.dist = scratch.dist; best.nx = scratch.nx; best.ny = scratch.ny; best.nz = scratch.nz;
        }
      }
    }
    if (!found) return null;
    best.hit = true;
    return best;
  }

  return {
    groundAt, groundNormalY, groundNormal, raycast,
    inBounds: (x, z) => cellOf(x, z) >= 0,
    bounds: { x0, z0, x1: x0 + nx * cell, z1: z0 + nz * cell, minY, maxY },
    stats: {
      triangles: nTri, cellEntries: nEntries, cells: nCells, cell,
      meshesUsed, meshesSkipped, skippedOversize, skippedOutside,
      bytes: nTri * 36 + nEntries * 4,
    },
  };
}
