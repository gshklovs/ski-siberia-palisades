// Siberia / the Palisades, Palisades Tahoe — scene assembly.
// PLAYABLE.md contract: buildWorld(THREE) -> { scene, spawn, colliders, up, gear, update }
//
// FRAME: ENU metres, +X east, +Y north, +Z up. Origin = centre of the
// dem-tight.tif / aerial.jpg frame (39.18375, -120.26625); z = 0 at 2366.0 m
// ASL (the Siberia Express base terminal). up:'z' is declared, so the player
// converts (x,y,z)_ENU -> (x,z,-y)_three. gear: 'skis'.
//
// COLLIDERS. The bench player now sizes its collision grid from the declared
// colliders[], so this list is the contract, not a hint: every terrain grid
// (cliff, piste, core, mid, wide, rim), the rock, the lift structures and the
// ridge furniture are all in it. Everything skiable is covered — including the
// Reverse Traverse bench, which is a ski test in its own right.

import {
  buf, appendBuf, toGeo, tri, quad, box, tube, prism, plate, makeRng, rr, ri, pick,
  lin, mixc, scalec, clamp, lerp, smooth, fbm,
} from './lib/core.mjs';
import { RUNS, LIFTS, BUILDINGS, RIDGE_KIT, A, CORE, TIGHT, SUMMIT_M } from './layout.mjs';
import { groundZ, demAt, masksAt, slopeAt, normalAt, rockAt, cliffAt, eastAt, screeAt,
         RUN_PREP, DEM_Z0 } from './ground.mjs';
import { buildTerrain, SUN_DIR, SUN_AZ, SUN_EL } from './terrain.mjs';
import { placeForest, forestDensity, distToRuns } from './forest.mjs';
import {
  PAL, firGeo, snagGeo, ribGeo, boulderGeo, talusGeo, skierGeo, lodgeGeo, hutGeo,
  warningBoards, ropeLine, signPost, snowFence, timberFrame, wand,
} from './kit.mjs';
import { lineFrame, terminal, tower, cable, makeCablePath, chairGeo } from './lift.mjs';
import { trailBoardTexture, terminalTexture, boardMesh, faceBoard } from './signs.mjs';
import { SUN, buildSky, buildClouds } from './env.mjs';
import { SCREE_RIDGE, CLIFF_STATS } from './cliff.mjs';

const rad = (d) => d * Math.PI / 180;

export async function buildWorld(THREE, opts = {}) {
  const t0 = (globalThis.performance || Date).now();
  const scene = new THREE.Scene();
  const report = { stats: {}, runs: [], notes: [] };
  const colliders = [];
  const gz = groundZ;
  const rng = makeRng('siberia');

  const SOLID = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const SMOOTH = new THREE.MeshLambertMaterial({ vertexColors: true });
  const SHEET = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const BACKDROP = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });

  // ----------------------------------------------------------- atmosphere
  // annotations.md palette, winter: "deep blue high-altitude sky". At 2400-2700 m
  // the sky is darker and the air clearer than at Red Dog's 1900 m, so the fog
  // starts further out.
  scene.background = new THREE.Color(0x8ab4e0);
  scene.fog = new THREE.Fog(0xbcd2ec, 2200, 15000);
  scene.add(buildSky(THREE));
  scene.add(buildClouds(THREE));

  // ---------------------------------------------------------------- light
  const S = SUN_DIR;
  const sun = new THREE.DirectionalLight(SUN.color, SUN.intensity);
  const FOCUS = new THREE.Vector3(-190, -180, groundZ(-190, -180));
  sun.position.set(FOCUS.x + S[0] * 1500, FOCUS.y + S[1] * 1500, FOCUS.z + S[2] * 1500);
  sun.target.position.copy(FOCUS);
  sun.castShadow = opts.shadows !== false;
  if (sun.castShadow) {
    sun.shadow.mapSize.set(2048, 2048);
    const d = 470;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 800; sun.shadow.camera.far = 2500;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 1.2;
    sun.shadow.radius = 4;
  }
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(SUN.ambSky, SUN.ambGround, SUN.ambIntensity));

  // -------------------------------------------------------------- terrain
  const T = buildTerrain(THREE, SMOOTH, BACKDROP);
  scene.add(T.cliff, T.piste, T.core, T.mid, T.wide, T.rim, T.far);
  // the floor, finest first: the escarpment, the corridors, the sector, the
  // dem-tight surround, the dem-wide surround, the end-of-data rim.
  colliders.push(T.cliff, T.piste, T.core, T.mid, T.wide, T.rim);

  // ----------------------------------------------------------------- lifts
  const Bl = buf();
  const liftState = [];
  for (const L of LIFTS) {
    // Headwall Express climbs 533 m out of Squaw Creek from x = +1506, far
    // outside this frame. Only the part inside the core is built; the cable
    // leaves east, which is exactly what views 31-33 show.
    let pts = L.pts;
    if (L.clipX != null) {
      const keep = pts.filter((p) => p[0] <= L.clipX);
      pts = keep.length >= 2 ? keep : pts;
    }
    const fr = lineFrame(pts, gz);
    const b0 = fr.at(0), bN = fr.at(fr.L);
    const yaw0 = Math.atan2(b0.uy, b0.ux);
    const yawN = Math.atan2(bN.uy, bN.ux);
    const DECK_B = 4.9, DECK_T = 4.7;
    // TERMINALS SIT EXACTLY ON THE OSM END NODES. For Siberia Express those are
    // 39.187488,-120.260520 (base) and 39.182764,-120.272179 (top); the DEM
    // under them reads 2366.3 m and 2645.1 m against annotations.md's stated
    // 2366.3 and 2645.1. Nothing is nudged by eye.
    const term0 = L.topOnly ? null
      : terminal(Bl, 11, { x: b0.x, y: b0.y, z: b0.z, yaw: yaw0, len: 26, w: 7.2, deck: DECK_B });
    const term1 = terminal(Bl, 12, { x: bN.x, y: bN.y, z: bN.z, yaw: yawN, len: 24, w: 7.0, deck: DECK_T });
    // Tower heights are set from the grade (a convex roll wants a short
    // depression tower, a concave one a tall compression tower) and then
    // CORRECTED FOR GROUND CLEARANCE. That second pass is not cosmetic: this
    // sector's lift lines cross real ridge crests — the Headwall Express corridor
    // runs straight over the scree spine of view-27 — and without it the cable
    // sagged into the hillside and the chairs skimmed the snow in the match-view-27
    // frame. Every span is sampled every 12 m and both its towers are raised
    // until the strand clears the built ground by 6 m.
    const S0 = L.topOnly ? 12 : 26, S1 = fr.L - 26;
    const twr = [];
    for (let i = 1; i <= L.towers; i++) {
      const s = S0 + (S1 - S0) * (i / (L.towers + 1));
      const p = fr.at(s);
      const ahead = fr.at(Math.min(fr.L, s + 30)), behind = fr.at(Math.max(0, s - 30));
      const conv = (ahead.z - p.z) / 30 - (p.z - behind.z) / 30;
      twr.push({ s, p, yaw: Math.atan2(p.uy, p.ux), h: 10.5 + clamp(-conv * 46, -3.0, 9) });
    }
    const ends = [{ s: 0, p: b0, h: (L.topOnly ? 9.5 : DECK_B) - 1.5, fixed: true },
                  ...twr,
                  { s: fr.L, p: bN, h: DECK_T - 1.5, fixed: true }];
    for (let pass = 0; pass < 6; pass++) {
      let worst = 0;
      for (let i = 0; i < ends.length - 1; i++) {
        const a = ends[i], b = ends[i + 1];
        const za = a.p.z + a.h, zb = b.p.z + b.h;
        const span = b.s - a.s;
        const sag = 0.010 * span;
        let need = 0;
        for (let t = 0.08; t < 0.99; t += 12 / Math.max(span, 12)) {
          const q = fr.at(a.s + span * t);
          const zc = lerp(za, zb, t) - 4 * sag * t * (1 - t);
          need = Math.max(need, (q.z + 6.0) - zc);
        }
        if (need > 0.05) {
          worst = Math.max(worst, need);
          if (!a.fixed) a.h += need * 0.75;
          if (!b.fixed) b.h += need * 0.75;
        }
      }
      if (worst < 0.05) break;
    }
    const nodes = [[b0.x, b0.y, b0.z + ends[0].h]];
    for (let i = 0; i < twr.length; i++) {
      const T2 = twr[i];
      const h = Math.min(T2.h, 34);
      const tw = tower(Bl, 100 + i * 7, { x: T2.p.x, y: T2.p.y, z: T2.p.z, yaw: T2.yaw,
                                          h, kind: h > 18 ? 'tall' : 'std', n: i + 1 });
      nodes.push(tw.top);
      report.notes.push(`${L.name} tower ${i + 1}: s=${T2.s.toFixed(0)} m (${(T2.s / fr.L * 100).toFixed(0)}%) h=${h.toFixed(1)} ground=${(T2.p.z + DEM_Z0).toFixed(1)} m`);
    }
    nodes.push([bN.x, bN.y, bN.z + ends[ends.length - 1].h]);
    const armW = 3.0;
    cable(Bl, nodes, armW, { sagK: 0.010 });
    liftState.push({ L, path: makeCablePath(nodes, armW, 0.010), term0, term1, fr });
    report.runs.push({ lift: L.name, osmWay: L.osmWay, plan: Math.round(fr.L),
                       base: [Math.round(b0.x), Math.round(b0.y), +(b0.z + DEM_Z0).toFixed(1)],
                       top: [Math.round(bN.x), Math.round(bN.y), +(bN.z + DEM_Z0).toFixed(1)],
                       towers: L.towers, topOnly: !!L.topOnly });
  }
  const liftMesh = new THREE.Mesh(toGeo(THREE, Bl), SHEET);
  liftMesh.name = 'lift-structures';
  liftMesh.castShadow = true; liftMesh.receiveShadow = true;
  scene.add(liftMesh); colliders.push(liftMesh);

  // terminal lettering on both Siberia Express sheds and the Headwall top shed
  for (const st of liftState) {
    const termTex = terminalTexture(THREE, st.L.name);
    if (!termTex) continue;
    for (const term of [st.term0, st.term1]) {
      if (!term) continue;
      for (const side of [1, -1]) {
        // stand the board off the shed's OWN half-width; the 12:1 band matches
        // the pale strip built into the flank in lift.mjs, so it reads instead
        // of z-fighting into a black panel
        const p = term.signAt(side * (term.w / 2 + 0.20));
        const bw = term.len * 0.68;
        const m = boardMesh(THREE, termTex, bw, bw * 128 / 1536, { doubleSided: false });
        const c = Math.cos(term.signYaw), s = Math.sin(term.signYaw);
        faceBoard(THREE, m, p, -s * side, c * side);
        m.name = 'terminal-sign';
        scene.add(m);
      }
    }
  }

  // ------------------------------------------------------------ base block
  // Gold Coast / High Camp at the frame's north edge — massing only.
  const Bv = buf();
  function place(B, g, x, y, z, yaw, sc = 1) {
    const c = Math.cos(yaw) * sc, s = Math.sin(yaw) * sc;
    for (let i = 0; i < g.pos.length; i += 3) {
      const px = g.pos[i], py = g.pos[i + 1];
      B.pos.push(x + px * c - py * s, y + px * s + py * c, g.pos[i + 2] * sc + z);
    }
    for (let i = 0; i < g.col.length; i++) B.col.push(g.col[i]);
  }
  for (const b of BUILDINGS) {
    const [x, y, sx, sy, st, yawDeg, kind] = b;
    const g = kind === 'hut' ? hutGeo(x * 7 + y, sx, sy, 3.0) : lodgeGeo(x * 3 + y * 5, sx, sy, st, kind);
    place(Bv, g, x, y, gz(x, y) - 0.4, rad(yawDeg));
  }
  const villageMesh = new THREE.Mesh(toGeo(THREE, Bv), SHEET);
  villageMesh.name = 'gold-coast-buildings';
  villageMesh.castShadow = true; villageMesh.receiveShadow = true;
  scene.add(villageMesh); colliders.push(villageMesh);

  // ==========================================================================
  // THE RIDGE FURNITURE — the ONLY man-made kit above the treeline
  // ==========================================================================
  // annotations.md, fill kit: "Signage and closure furniture ... Build these —
  // they are the only man-made objects on the whole upper ridge and they read
  // from a long way off." Every item cites its view; the register is
  // layout.mjs RIDGE_KIT.
  const Bs = buf();
  const signMeshes = [];
  for (const K of RIDGE_KIT) {
    const [x, y] = K.at;
    const z = gz(x, y), yaw = rad(K.yaw);
    if (K.kind === 'warningBoards') {
      warningBoards(Bs, x, y, z, yaw, gz, { n: 3 });
    } else if (K.kind === 'signboard' || K.kind === 'gate') {
      signPost(Bs, x, y, z, yaw);
      if (K.kind === 'gate') {
        // the gate itself: a rope line either side of a 6 m opening (view-40)
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const dir of [-1, 1]) {
          const line = [];
          for (let i = 1; i <= 4; i++) {
            const u = dir * (3 + i * 4.5);
            line.push([x - s * u, y + c * u]);
          }
          ropeLine(Bs, line, gz, { h: 1.05, col: PAL.red });
        }
      }
    } else if (K.kind === 'snowFence') {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const line = [];
      for (let i = -5; i <= 5; i++) line.push([x + c * i * 5 - s * 15, y + s * i * 5 + c * 15]);
      snowFence(Bs, line, gz, { h: 1.25, col: PAL.orange });
    } else if (K.kind === 'timberFrame') {
      timberFrame(Bs, x, y, z, yaw);
    }
    report.notes.push(`ridge kit ${K.id} (${K.kind}) at (${x}, ${y}) from ${K.view}`);
  }

  // ------------------------------------------------------------ trail signs
  // One board at the top entrance of every run whose NAME is corroborated.
  // The four Palisades chutes are the delicate case and are handled in
  // layout.mjs: Chimney / Main / Extra carry `sign: true` (three sources each,
  // including the resort's own labels in view-16); National Chute carries
  // `sign: false` because its name rests on two weak votes; and the fifteen
  // features view-19 alone names are not features here at all.
  for (const r of RUNS) {
    const p0 = r.pts[0], p1 = r.pts[Math.min(2, r.pts.length - 1)];
    const dirx = p1[0] - p0[0], diry = p1[1] - p0[1];
    const dl = Math.hypot(dirx, diry) || 1;
    report.runs.push({ run: r.name, id: r.id, style: r.style, width: r.width,
                       inferred: !!r.inferred, sparse: !!r.sparse, signed: !!r.sign,
                       widthSrc: r.widthSrc,
                       top: [Math.round(p0[0]), Math.round(p0[1]), Math.round(p0[2] + DEM_Z0)] });
    if (!r.sign) continue;
    const ox = -diry / dl * (Math.min(r.width, 40) * 0.5 + 3.5), oy = dirx / dl * (Math.min(r.width, 40) * 0.5 + 3.5);
    const x = p0[0] + ox - dirx / dl * 4, y = p0[1] + oy - diry / dl * 4;
    const z = gz(x, y);
    const H = 2.35, W = 2.05, BH = 0.68;
    for (const s of [-1, 1]) {
      const px = x - diry / dl * s * (W / 2 - 0.15), py = y + dirx / dl * s * (W / 2 - 0.15);
      tube(Bs, [px, py, z], [px, py, z + H], 0.055, PAL.dark, 4);
    }
    const tex = trailBoardTexture(THREE, r.name, r.diff);
    if (tex) {
      const m = boardMesh(THREE, tex, W, BH);
      faceBoard(THREE, m, [x, y, z + H - BH / 2 - 0.12], -dirx / dl, -diry / dl);
      m.name = 'sign-' + r.id;
      scene.add(m);
      signMeshes.push(m);
    }
  }
  // bamboo wands down the throats of the three confirmed chutes only
  for (const id of ['chimney', 'main-chute', 'extra-chute']) {
    const r = RUNS.find((q) => q.id === id);
    if (!r) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
      for (const s of [-1, 1]) {
        const x = a[0] - dy / dl * s * (r.width / 2 + 2), y = a[1] + dx / dl * s * (r.width / 2 + 2);
        wand(Bs, x, y, gz(x, y), { h: 1.4, col: s > 0 ? PAL.yellow : PAL.orange });
      }
    }
  }
  const signPosts = new THREE.Mesh(toGeo(THREE, Bs), SHEET);
  signPosts.name = 'ridge-furniture';
  signPosts.castShadow = true;
  scene.add(signPosts); colliders.push(signPosts);

  // ------------------------------------------------------------------ trees
  const F = placeForest();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(),
        _v = new THREE.Vector3(), _s = new THREE.Vector3();
  function instance(name, geoBuf, pts, mat, { castShadow = true, zScale = true, sink = 0 } = {}) {
    const g = toGeo(THREE, geoBuf);
    const im = new THREE.InstancedMesh(g, mat, Math.max(1, pts.length));
    im.name = name;
    im.castShadow = castShadow; im.receiveShadow = false;
    pts.forEach((p, i) => {
      _v.set(p[0], p[1], p[2] - sink); _e.set(0, 0, p[3], 'XYZ'); _q.setFromEuler(_e);
      const k = p[4];
      _s.set(k, k, zScale ? k * (0.9 + 0.25 * ((i * 37) % 7) / 7) : k);
      _m4.compose(_v, _q, _s);
      im.setMatrixAt(i, _m4);
    });
    im.instanceMatrix.needsUpdate = true;
    scene.add(im);
    return im;
  }
  instance('firs-big', firGeo(3, { h: 27, tiers: 7, sides: 7, flock: 0.36 }), F.big, SOLID, { sink: 0.9 });
  instance('firs-mid', firGeo(9, { h: 22, tiers: 5, sides: 5, flock: 0.32 }), F.mid, SOLID, { sink: 0.8 });
  instance('firs-far', firGeo(21, { h: 20, tiers: 4, sides: 4, flock: 0.28, lite: true }), F.small, SOLID, { castShadow: false, sink: 1.2 });
  instance('snags', snagGeo(5, { h: 16 }), F.snags, SOLID, { castShadow: false, sink: 0.6 });
  instance('boulders', boulderGeo(31, 1.1), F.boulders, SOLID, { castShadow: false, sink: 0.5 });
  // view-27's rubble spine: hundreds of small angular blocks, no snow lace
  instance('talus', talusGeo(17, 1.0), F.talus, SOLID, { castShadow: false, sink: 0.35 });

  // ---------------------------------------------------------------- the rock
  // Granite ribs, merged so they are COLLIDABLE. These sit on top of the
  // sculpted heightfield in cliff.mjs — the field gives the escarpment its
  // massing and bedding, and these give it the blocky, jointed silhouette the
  // photographs show at close range on the crest and along the ribs.
  const Br = buf();
  for (const [x, y, z, yaw, sc] of F.rocks) {
    // squat FINS, not spires: iter5 shipped 8 m x 2.6 m stacks and they read as
    // a row of burnt stumps along the crest. A Palisades rib in view-20 is
    // wider than it is tall at this range.
    const g = ribGeo(Math.round(x * 13 + y * 7), { r: 3.6 * sc, h: 4.6 * sc, ledges: 2 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < g.pos.length; i += 3) {
      const px = g.pos[i], py = g.pos[i + 1];
      Br.pos.push(x + px * c - py * s, y + px * s + py * c, g.pos[i + 2] + z);
    }
    for (let i = 0; i < g.col.length; i++) Br.col.push(g.col[i]);
  }
  const rockMesh = new THREE.Mesh(toGeo(THREE, Br), SOLID);
  rockMesh.name = 'granite-ribs';
  rockMesh.castShadow = true; rockMesh.receiveShadow = true;
  scene.add(rockMesh); colliders.push(rockMesh);

  // ---------------------------------------------------- static people/props
  const Bp = buf();
  const TT = liftState[0].fr.at(liftState[0].fr.L);
  // unloading at the Siberia Express top terminal (views 8, 9, 25)
  for (const [du, dv, yaw] of [[14, 9, 2.1], [22, 3, 2.6], [8, -7, 0.4], [28, 14, 3.0], [-7, 12, 1.4]]) {
    const x = TT.x + du, y = TT.y + dv;
    place(Bp, skierGeo(ri(rng, 1, 999), null, {}), x, y, gz(x, y), yaw);
  }
  // THE SCALE CUE. annotations.md, landmarks: from the bowl the cliff "reads as
  // a dark horizontal band with a bright snow apron under it and A LINE OF
  // PEOPLE STANDING ON TOP OF IT — the human silhouettes on the crest in views
  // 19 and 20 are the scale cue that makes the whole thing legible. Get this and
  // the place reads." view-20 counts EIGHT skiers on the crest, so there are
  // eight, placed along the top of the main wall under the summit.
  {
    const crest = [];
    for (let x = -300; x <= -140; x += 22) {
      // walk north from the plateau until the ground starts to fall away hard —
      // that edge is the crest, and it is found on the built surface, not typed
      let y = -400, best = y;
      for (let yy = -400; yy < -180; yy += 2) {
        if (slopeAt(x, yy, 4) > 34) { best = yy; break; }
      }
      crest.push([x, best - 3]);
    }
    for (const [x, y] of crest) {
      place(Bp, skierGeo(ri(rng, 1, 999), null, {}), x + rr(rng, -3, 3), y + rr(rng, -2, 2),
            gz(x, y), rr(rng, 1.2, 2.2));
    }
    report.notes.push(`crest scale group: ${crest.length} figures on the Palisades crest (view-20 counts 8)`);
  }
  // the Headwall Express top terminal crossroads — views 31/32/36 all show a
  // crowd here; it is the sector's real junction
  {
    const H = liftState[1].fr.at(liftState[1].fr.L);
    for (let i = 0; i < 9; i++) {
      const x = H.x + rr(rng, -26, 26), y = H.y + rr(rng, -20, 20);
      place(Bp, skierGeo(ri(rng, 1, 999), null, {}), x, y, gz(x, y), rr(rng, 0, 6.28));
    }
  }
  // skiers waiting at the Sun Bowl gate (view-37)
  for (let i = 0; i < 6; i++) {
    const x = 10 + rr(rng, -9, 9), y = -178 + rr(rng, -7, 4);
    place(Bp, skierGeo(ri(rng, 1, 999), null, {}), x, y, gz(x, y), rr(rng, 2.0, 4.0));
  }
  const propMesh = new THREE.Mesh(toGeo(THREE, Bp), SHEET);
  propMesh.name = 'people-props';
  propMesh.castShadow = true;
  scene.add(propMesh);

  // ---------------------------------------------------- moving chairs
  const chairIms = liftState.map((st, k) => {
    const n = Math.max(4, Math.floor(st.path.L * 2 / st.L.chairSpacing));
    const im = new THREE.InstancedMesh(toGeo(THREE, chairGeo(k, st.L.seats)), SHEET, n);
    im.name = 'chairs-' + st.L.id;
    im.castShadow = true; im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(im);
    return { im, n, st };
  });
  const riderIms = liftState.map((st, k) => {
    const n = Math.max(2, Math.floor(st.path.L * 2 / st.L.chairSpacing / 2));
    const im = new THREE.InstancedMesh(toGeo(THREE, skierGeo(70 + k, PAL.jacket[k % 6], { sit: true })), SHEET, n);
    im.name = 'riders-' + st.L.id;
    im.castShadow = false; im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(im);
    return { im, n, st };
  });
  function placeChairs(t) {
    for (let k = 0; k < chairIms.length; k++) {
      const { im, n, st } = chairIms[k];
      const half = n / 2, L = st.path.L;
      for (let i = 0; i < n; i++) {
        const side = i < half ? 1 : -1;
        const j = i < half ? i : i - half;
        const s = (j * (L / half) + t * st.L.speed * (side > 0 ? 1 : -1)) % L;
        const p = st.path.at(s, side);
        _v.set(p.x, p.y, p.z);
        _e.set(0, 0, p.yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 'XYZ'); _q.setFromEuler(_e);
        _s.set(1, 1, 1); _m4.compose(_v, _q, _s);
        im.setMatrixAt(i, _m4);
      }
      im.instanceMatrix.needsUpdate = true;
      const R = riderIms[k];
      for (let i = 0; i < R.n; i++) {
        const s = ((i * 2) * (L / half) + t * st.L.speed) % L;
        const p = st.path.at(s, 1);
        _v.set(p.x, p.y, p.z - 2.55);
        _e.set(0, 0, p.yaw - Math.PI / 2, 'XYZ'); _q.setFromEuler(_e);
        _s.set(1, 1, 1); _m4.compose(_v, _q, _s);
        R.im.setMatrixAt(i, _m4);
      }
      R.im.instanceMatrix.needsUpdate = true;
    }
  }
  placeChairs(0);

  // ------------------------------------------------------ skiers descending
  const skiPaths = ['siberia-bowl', 'north-bowl', 'headwall-face'].map((id) => {
    const r = RUNS.find((q) => q.id === id);
    const cum = [0];
    for (let i = 1; i < r.pts.length; i++)
      cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    return { r, cum, L: cum[cum.length - 1] };
  });
  const skiIm = new THREE.InstancedMesh(toGeo(THREE, skierGeo(88, PAL.jacket[0], {})), SHEET, 9);
  skiIm.name = 'skiers-moving';
  skiIm.castShadow = true; skiIm.frustumCulled = false;
  skiIm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(skiIm);
  function placeSkiers(t) {
    let n = 0;
    for (let k = 0; k < skiPaths.length; k++) {
      const P = skiPaths[k];
      for (let q = 0; q < 3; q++) {
        const s = ((t * (9 + q * 2) + q * P.L / 3 + k * 40) % P.L);
        let i = 1;
        while (i < P.cum.length - 1 && P.cum[i] < s) i++;
        const f = (s - P.cum[i - 1]) / ((P.cum[i] - P.cum[i - 1]) || 1);
        const a = P.r.pts[i - 1], b = P.r.pts[i];
        const carve = Math.sin(t * 1.5 + q * 2 + k) * (Math.min(P.r.width, 50) * 0.22);
        const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
        const x = lerp(a[0], b[0], f) - dy / dl * carve;
        const y = lerp(a[1], b[1], f) + dx / dl * carve;
        _v.set(x, y, gz(x, y) + 0.05);
        _e.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2 + Math.sin(t * 1.5 + q * 2 + k) * 0.5, 'XYZ');
        _q.setFromEuler(_e);
        _s.set(1, 1, 1); _m4.compose(_v, _q, _s);
        skiIm.setMatrixAt(n++, _m4);
      }
    }
    skiIm.instanceMatrix.needsUpdate = true;
  }
  placeSkiers(0);

  // ----------------------------------------------------------------- spawn
  // On the unload flat at the SIBERIA EXPRESS TOP TERMINAL — the west end of
  // the Reverse Traverse and the "Start Hike" of view-15 — facing S/SE at the
  // dark rocky Washeshu / Palisades knoll. That is view-9 exactly: the one
  // ground frame in the bundle holding the lift and the cliff together.
  const sp = [TT.x + 16, TT.y + 8];
  const spawn = {
    position: [sp[0], sp[1], gz(sp[0], sp[1]) + 0.05],
    lookAt: [A.washeshuDem[0] + 40, A.washeshuDem[1] + 60, SUMMIT_M - DEM_Z0],
    eyeHeight: 0,
  };

  // ----------------------------------------------------------------- stats
  let draws = 0, tris = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    draws++;
    const g = o.geometry;
    if (!g || !g.attributes.position) return;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : 1);
  });
  report.stats.drawCalls = draws;
  report.stats.triangles = Math.round(tris);
  report.stats.collidableTriangles = Math.round(colliders.reduce(
    (a, m) => a + (m.geometry ? (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 : 0), 0));
  report.stats.trees = F.big.length + F.mid.length + F.small.length;
  report.stats.rocks = F.rocks.length + F.boulders.length;
  report.stats.talus = F.talus.length;
  report.stats.buildMs = Math.round((globalThis.performance || Date).now() - t0);
  report.sun = { az: SUN_AZ, el: SUN_EL };
  report.cliff = CLIFF_STATS;
  report.terrainTris = {};
  for (const [k, m] of Object.entries(T)) {
    if (m && m.geometry) report.terrainTris[k] = Math.round((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3);
  }

  const landmarks = {
    siberiaTop: [TT.x, TT.y, gz(TT.x, TT.y)],
    siberiaBase: [A.siberiaBase[0], A.siberiaBase[1], gz(A.siberiaBase[0], A.siberiaBase[1])],
    headwallTop: [A.headwallTop[0], A.headwallTop[1], gz(A.headwallTop[0], A.headwallTop[1])],
    washeshu: [A.washeshuDem[0], A.washeshuDem[1], gz(A.washeshuDem[0], A.washeshuDem[1])],
    highCamp: [A.highCamp[0], A.highCamp[1], gz(A.highCamp[0], A.highCamp[1])],
  };
  for (const r of RUNS) {
    landmarks[r.id + '-top'] = [r.pts[0][0], r.pts[0][1], gz(r.pts[0][0], r.pts[0][1])];
    const e = r.pts[r.pts.length - 1];
    landmarks[r.id + '-bot'] = [e[0], e[1], gz(e[0], e[1])];
  }

  return {
    scene, spawn, colliders,
    up: 'z',
    gear: 'skis',
    update: (t) => { placeChairs(t); placeSkiers(t); },
    report, landmarks,
    terrainHeight: gz,
    demAt, slopeAt, masksAt, rockAt, cliffAt, eastAt, screeAt,
    screeRidge: SCREE_RIDGE,
    // ------------------------------------------------------- lifts (contract)
    // PLAYABLE.md's Lifts section: NEITHER declared point is the terminal node.
    // The OSM end node is inside the shed built on it, so a load point there is
    // unreachable and an unload point there drops the player on a roof. The
    // load point steps 13 m out to the skier's-right of the base shed (the
    // queue side in the aerial) and 8 m along; the unload point stands 22 m
    // back DOWN the line from the top shed, on the flat the Reverse Traverse
    // starts from. Both are re-grounded on groundZ().
    //
    // HEADWALL EXPRESS IS NOT DECLARED. Its top terminal is in this world as a
    // landmark and the east end of the traverse, but its base is 533 m below in
    // Squaw Creek at x = +1506 — outside the frame entirely. The point the line
    // is clipped at (x = 685) is a span between towers, not a station: offering
    // it as a load point would invent a lift terminal that does not exist.
    // `liftLines` still carries both lines for the numeric verification.
    lifts: liftState.filter((st) => !st.L.topOnly).map((st) => {
      const b = st.fr.at(8), t = st.fr.at(Math.max(0, st.fr.L - 22));
      const off = (p, d) => [p.x - p.uy * d, p.y + p.ux * d];
      const bp = off(b, -13), tp = off(t, 4);
      return {
        id: st.L.id, name: st.L.name + ' EXPRESS', radius: 6,
        speed: st.L.speed, chairSpacing: st.L.chairSpacing,
        base: [bp[0], bp[1], gz(bp[0], bp[1])],
        top: [tp[0], tp[1], gz(tp[0], tp[1])],
      };
    }),
    liftLines: liftState.map((st) => ({ id: st.L.id, name: st.L.name, osmWay: st.L.osmWay,
      topOnly: !!st.L.topOnly,
      base: [st.fr.at(0).x, st.fr.at(0).y, st.fr.at(0).z],
      top: [st.fr.at(st.fr.L).x, st.fr.at(st.fr.L).y, st.fr.at(st.fr.L).z],
      plan: st.fr.L })),
    runs: RUNS.map((r) => ({ id: r.id, name: r.name, style: r.style, width: r.width,
      inferred: !!r.inferred, sparse: !!r.sparse, signed: !!r.sign, pts: r.pts })),
  };
}

export default buildWorld;
