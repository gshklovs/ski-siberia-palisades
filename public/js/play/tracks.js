// tracks.js — persistent ski tracks: the splat map. specs/0013 (specs/0005 L3).
//
// SKIS LEAVE TWO LINES IN THE SNOW AND THE LINES STAY. They do not fade; they
// last until they scroll out of a 64 m window that follows the player, which is
// the documented persistence limit — ride 40 m away and back and they are still
// there, ride 100 m and they are gone.
//
// THIS FILE IS THE ONLY THING THAT EVER DRAWS INTO THE MAP. The snow shader
// only READS it: `runs/<run>/scene/terrain.mjs`, the `L3-tracks` look layer,
// four uniforms and ten lines of GLSL. The two halves talk through exactly
// three handles on `window.__look`, all installed by that layer:
//
//     __look.tracksMap( texture )        which render target the world samples
//     __look.tracksWindow( cx, cz, span )  where that target is, in world metres
//     __look.TRACKS_GAIN = 0 | 1         the read's gate 0
//
// so a world whose scene never registered L3 (any POI but this one) gets a
// tracks module that notices there is nothing to talk to and turns itself off.
//
// ===========================================================================
// 1. WHY A RENDER TARGET AND NOT GEOMETRY
// ===========================================================================
// A ribbon mesh trailing the player is the obvious build and it is the wrong
// one three times over: it needs a vertex budget that grows with how long you
// have been skiing, it z-fights the snow it lies on across 400 m of relief, and
// it cannot be crossed by a later track without sorting artefacts. A splat map
// has a FIXED cost — one 512² texture, one extra draw per frame — and "ride
// over your own track" is a `max` blend rather than a sorting problem.
//
// ===========================================================================
// 2. THE FORMAT, AND WHY RG8 AND NOT RGBA8
// ===========================================================================
// TWO channels are needed and only two: R is INK (how dark the rut is) and G is
// RIM (the bright lip of thrown snow on the downhill edge of the stroke). RG8
// at 512² is 0.25 MB per target, 0.5 MB for the ping-pong pair — half what
// RGBA8 would cost, and specs/0005's L3 budget line ("~1 MB at 512²") covers
// the pair with room to spare. ZERO TRANSFER BYTES either way: there is no
// asset here, the map is drawn at runtime and never shipped (gate D23 is
// untouched).
//
// The one thing RG8 costs is readback. `renderer.readRenderTargetPixels()` asks
// the driver for `readPixels(..., RG, UNSIGNED_BYTE, ...)`, which ES 3.0 only
// has to support when it happens to be the implementation's preferred pair. So
// the test hooks at the bottom read the framebuffer directly as
// RGBA/UNSIGNED_BYTE, which the spec DOES guarantee for any normalised
// fixed-point colour buffer, and throw away B and A. Nothing on the render path
// reads pixels back at all.
//
// ===========================================================================
// 3. THE WINDOW, AND WHAT "PERSISTENT" ACTUALLY MEANS
// ===========================================================================
// TRACKS_SPAN metres square, centred near the player, TRACKS_RT_SIZE texels
// across — 64 m over 512 texels, 12.5 cm per texel. When the player has drifted
// TRACKS_RECENTRE metres from the centre the window is re-centred: the old
// target is blitted into the spare one at the offset, they swap, and the world
// is told the new centre. The offset is SNAPPED TO WHOLE TEXELS (12.5 cm), so
// the copy lands texel-on-texel and nothing smears — that is the whole reason
// the recentre is invisible, and acceptance §3.3 measures it.
//
// The swap is why `registerLookLayer` grew a `shared:` bag (see lib/core.mjs):
// on r180 a render-target texture put through `cloneUniforms` is replaced by
// `null` in every material's copy, so "point the world at the other target" had
// to become one write to one holder object rather than fourteen.
//
// ===========================================================================
// 4. WHY update() IS CALLED FROM playerSystems() AND NOT OFF THE rAF LINE
// ===========================================================================
// specs/0013's Territory block says "one call per frame next to the existing
// render". It goes one function earlier than that, inside `playerSystems()`,
// because that is the ONLY per-frame set that `__player.stepFixed()` also
// drives (main.js: the deterministic stepper calls `ctrl.update()` and
// `playerSystems()` and nothing else, and never renders). Acceptance §3.1 and
// §3.3 are scripted stepFixed rides, so a splat hung off the rAF loop would lay
// no track in the very test that has to prove it lays one. Same one call, same
// one import; just a call site that both clocks reach.
//
// It also means update() can be called hundreds of times between two actual
// frames. So splats are QUEUED into a pooled buffer and the render target is
// touched at most once per real frame (or when the pool fills) — see `flush()`.
// A 600-step stepFixed ride costs ~5 target renders, not 600.

// specs/0019 — the clean-frame knob. tracks.js reads the CLASS rather than
// asking clean.js for a hook, deliberately: clean.js's whole defence is that it
// creates no DOM and no text, so the read belongs on this side of the line. The
// gate it drives is the READ's gain, never the map — see hideForCleanFrame().
import { get as setting } from './settings.js';

// ------------------------------------------------------------ boot constants
// (specs/0013 §2.4: size / span / recentre are boot constants, everything else
// is a named dial on __look.)
const TRACKS_RT_SIZE = 512;      // texels square. 256 is the mobile step-down.
const TRACKS_SPAN = 64;          // metres square -> 12.5 cm/texel at 512
const TRACKS_RECENTRE = 12;      // metres of drift before the window moves
// ...and how far BEHIND the player the new centre lands. specs/0013 §2.2 says
// "recentre" without saying where to, and the obvious reading — put the centre
// on the player — makes the spec's OWN worked example impossible: with a 64 m
// window a centre snapped onto the player leaves exactly 32 m of track behind
// you, so "ride 40 m away and back: still there" is false by 8 m. Landing the
// centre LAG metres back along the direction of drift makes the trailing
// coverage 32 + drift, and drift then lives in [LAG, TRACKS_RECENTRE]:
//
//     behind the player   32 + 10 .. 32 + 12  =  42 .. 44 m   (the persistence)
//     ahead of the player 32 - 12 .. 32 - 10  =  20 .. 22 m   (tracks you left
//                                                 earlier and are riding back to)
//
// The cost is that a recentre now fires every (TRACKS_RECENTRE - LAG) = 2 m of
// travel instead of every 12 — one extra full-screen blit roughly every 5
// frames at 25 m/s, which is what §3.7's "+1 on a recentre frame" prices.
const TRACKS_RECENTRE_LAG = 10;
const TRACKS_MOBILE_MS = 0.8;    // the coarse-pointer budget (§2.4)
const TRACKS_MOBILE_FRAMES = 60; // frames in the boot measurement (§2.4)
const TRACKS_RT_SIZE_LOW = 256;  // the step-down

// geometry of the rig, metres. Not on __look: they describe where the skis ARE,
// which is a fact about main.js's rig and not a look choice.
const TRACKS_BACK = 0.55;        // tail contact, behind the boots (fx.js's number)
const TRACKS_STANCE = 0.15;      // half-stance: mSkiL/mSkiR sit at +/-0.15 (main.js)
const TRACKS_LEAN_FULL = 0.26;   // rad. ctrl.lean is clamped here (ski.js maxRoll)
const TRACKS_MAX_STEP = 8;       // metres in one update -> a teleport, not a turn
const TRACKS_FEATHER = 0.35;     // fraction of the half-width the edge softens over
const TRACKS_RIM_WIDTH = 0.45;   // fraction of the half-width the bright lip occupies
const SEG_CAP = 256;             // pooled segments (2 per update -> 128 updates)

// ------------------------------------------------------------- the dials
// Live on __look by name, exactly like every other look tunable, so Greg tunes
// this layer the same way he tunes the other three. TRACKS_GAIN / TRACKS_DARK /
// TRACKS_RIM / TRACKS_SNOW_EDGE belong to the READ and are declared in
// terrain.mjs; these three belong to the SPLAT and are declared here.
const D = {
  // 0.14 AND NOT specs/0013's 0.09 (orchestrator, 2026-09-02, after reading the
  // compares). This is a RESOLUTION argument, not a taste one: the window is
  // TRACKS_SPAN / TRACKS_RT_SIZE = 12.5 cm per texel, so a 0.09 half-width is a
  // stroke 1.44 texels wide — thinner than the grid can hold, so most of it is
  // averaged away before TRACKS_DARK ever multiplies it. Measured, top-down:
  //     0.09 -> 1.44 texels,  629 ink texels, 0.462 % of the screen changed
  //     0.14 -> 2.24 texels,  996 ink texels, 0.797 %
  //     0.20 -> 3.20 texels, 1313 ink texels, 0.932 %
  // 0.14 is where a ski track stops being a suggestion. It is also honest
  // geometry: a 28 cm wide rut is about what a carving ski actually leaves.
  TRACKS_W: 0.14,          // metres, half-width of one ski's stroke
  TRACKS_INK_MIN: 0.35,    // ink at |lean| = 0. Full carve reaches 1.0.
  TRACKS_MIN_V: 1.5,       // m/s below which a ski leaves nothing
};

const S = {
  on: false, why: 'not started', size: TRACKS_RT_SIZE, span: TRACKS_SPAN,
  THREE: null, renderer: null, look: null, ctrl: null, u: 1, test: false,
  rtA: null, rtB: null, scene: null, cam: null, mesh: null, geo: null,
  blitScene: null, blitMesh: null, blitU: null,
  pos: null, aq: null, ink: null,      // the pooled attributes
  n: 0,                                 // segments queued
  cx: 0, cz: 0,                         // window centre, world xz
  prevL: null, prevR: null,             // last tail contacts (world xz)
  lastFlushFrame: -1,
  draws: 0, recentres: 0, splats: 0, flushes: 0,
  decision: null,                       // the §2.4 step-down record
  hidden: false, gainHeld: null,        // specs/0019, see hideForCleanFrame()
};

// ============================================================ the splat shader
// Positions arrive in WINDOW UNITS (+/-0.5 across the span) and the orthographic
// camera below maps that straight to clip space, so the CPU side never has to
// know about projection: a world point is (world - centre) / span and that is
// the whole transform.
//
// `aQ.x` runs -1..1 ACROSS the stroke and `aQ.y` 0..1 ALONG it. The profile is
// therefore a 1-D function of aQ.x and nothing else, which is what keeps a
// stroke the same width whether the frame moved 2 cm or 2 m.
const SPLAT_VS = `
attribute vec2 aQ;
attribute vec2 aInk;      // x ink strength, y signed rim (sign = which edge)
varying vec2 vQ;
varying vec2 vInk;
void main() {
  vQ = aQ; vInk = aInk;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// THE RIM IS DERIVED HERE, NOT IN THE READ. specs/0013 §2.3 is explicit about
// that and it is also the only place it can be done cheaply: "which edge of the
// stroke is downhill" is a per-segment fact the CPU already has (the ground
// normal), and pushing it into the fragment read would mean a second fetch and
// a derivative per snow pixel for something that never changes once drawn.
// (no `precision` line on purpose: three's own prefix sets highp, and the blit
// below NEEDS it — a mediump `vUv` quantises to coarser than one texel of a
// 512 map and the "exact copy" the recentre depends on stops being exact.)
const SPLAT_FS = `
varying vec2 vQ;
varying vec2 vInk;
uniform vec2 uShape;      // x 1/FEATHER, y 1/RIM_WIDTH
void main() {
  float a = 1.0 - abs( vQ.x );                       // 0 at the edge, 1 at the spine
  float ink = vInk.x * clamp( a * uShape.x, 0.0, 1.0 );
  // the lip: a band just inside ONE edge, the one the segment said is downhill
  float side = vQ.x * sign( vInk.y );                // +1 toward the lit edge
  float rim = abs( vInk.y ) * clamp( ( side - ( 1.0 - 1.0 / uShape.y ) ) * uShape.y, 0.0, 1.0 )
                            * clamp( a * uShape.x * 2.0, 0.0, 1.0 );
  gl_FragColor = vec4( ink, rim, 0.0, 1.0 );
}`;

// the recentre blit (§2.2). One full-screen quad, one fetch, and a window test
// so the newly-exposed margin comes back BLANK rather than smeared.
const BLIT_VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy * 2.0, 0.0, 1.0 ); }`;
const BLIT_FS = `
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uShift;
void main() {
  vec2 s = vUv + uShift;
  gl_FragColor = ( s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 )
    ? vec4( 0.0 ) : texture2D( tSrc, s );
}`;

// ==================================================================== setup
function makeTarget(THREE, n) {
  const rt = new THREE.WebGLRenderTarget(n, n, {
    format: THREE.RGFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.name = 'tracks:splat';
  return rt;
}

// The clear colour is the RENDERER's, not the target's, so it is borrowed and
// handed straight back — a module that quietly left the page's clear colour at
// black would repaint the sky on the first frame that clears without a
// scene.background.
const _clr = { c: null, a: 1 };
function clearTarget(rt) {
  const r = S.renderer, prev = r.getRenderTarget();
  if (!_clr.c) _clr.c = new S.THREE.Color();
  r.getClearColor(_clr.c);
  _clr.a = r.getClearAlpha();
  r.setRenderTarget(rt);
  r.setClearColor(0x000000, 0);
  r.clear(true, false, false);
  r.setClearColor(_clr.c, _clr.a);
  r.setRenderTarget(prev);
}

function build(size) {
  const THREE = S.THREE;
  S.size = size;
  S.rtA = makeTarget(THREE, size);
  S.rtB = makeTarget(THREE, size);

  // ---- the pooled splat mesh. ONE mesh, one draw, `drawRange` doing the work:
  // a fresh BufferGeometry per frame would allocate and re-upload the whole
  // pool, and an InstancedMesh would need a second attribute stream for what is
  // already only six vertices.
  const geo = new THREE.BufferGeometry();
  S.pos = new Float32Array(SEG_CAP * 6 * 3);
  S.aq = new Float32Array(SEG_CAP * 6 * 2);
  S.ink = new Float32Array(SEG_CAP * 6 * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(S.pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aQ', new THREE.BufferAttribute(S.aq, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aInk', new THREE.BufferAttribute(S.ink, 2).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  S.geo = geo;

  const mat = new THREE.ShaderMaterial({
    vertexShader: SPLAT_VS, fragmentShader: SPLAT_FS,
    uniforms: { uShape: { value: new THREE.Vector2(1 / TRACKS_FEATHER, 1 / TRACKS_RIM_WIDTH) } },
    // MAX, not ADD. Riding the same line twice must not walk the rut past 1.0
    // and turn a traverse into a black stripe; with `max` a second pass over an
    // old track simply cannot make it darker than one pass at the same edge
    // angle. (GL ignores the blend FACTORS under MIN/MAX, which is why they are
    // not set here — setting them would be a lie about what runs.)
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    depthTest: false, depthWrite: false,
    transparent: true,
    // DOUBLE-SIDED, and it is not paranoia: a stroke's two triangles are wound
    // from its own direction of travel, so a segment heading one way is
    // front-facing and the same segment heading back is not. With the default
    // FrontSide the map comes back completely blank in one direction and
    // half-drawn in a turn — which is exactly what the first ride did.
    side: THREE.DoubleSide,
  });
  S.mesh = new THREE.Mesh(geo, mat);
  S.mesh.frustumCulled = false;
  S.mesh.name = 'tracks:splats';
  S.scene = new THREE.Scene();
  S.scene.add(S.mesh);
  // straight down at a unit square of window units. Nothing here is in metres,
  // so the camera never changes — not on a recentre, not on a step-down.
  S.cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, -1, 1);

  // ---- the blit rig
  S.blitU = { tSrc: { value: null }, uShift: { value: new THREE.Vector2(0, 0) } };
  S.blitMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      vertexShader: BLIT_VS, fragmentShader: BLIT_FS, uniforms: S.blitU,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.NoBlending,      // an exact COPY, not a composite
    }),
  );
  S.blitMesh.frustumCulled = false;
  S.blitScene = new THREE.Scene();
  S.blitScene.add(S.blitMesh);

  clearTarget(S.rtA);
  clearTarget(S.rtB);
  S.look.tracksMap(S.rtA.texture);
  S.look.tracksWindow(S.cx, S.cz, TRACKS_SPAN);
}

function teardown() {
  if (S.rtA) S.rtA.dispose();
  if (S.rtB) S.rtB.dispose();
  if (S.geo) S.geo.dispose();
  if (S.mesh && S.mesh.material) S.mesh.material.dispose();
  if (S.blitMesh) { S.blitMesh.geometry.dispose(); S.blitMesh.material.dispose(); }
  S.rtA = S.rtB = S.geo = S.mesh = S.blitMesh = null;
  if (S.look) { S.look.tracksMap(null); S.look.TRACKS_GAIN = 0; }
}

// =============================================================== the splats
/**
 * Queue one stroke, from world (ax, az) to world (bx, bz).
 * `ink` 0..1, `rim` signed — its magnitude is the lip's strength and its sign
 * says which edge of the stroke the lip sits on.
 */
function push(ax, az, bx, bz, ink, rim) {
  if (S.n >= SEG_CAP) return;
  const span = TRACKS_SPAN;
  const w = D.TRACKS_W * S.u / span;               // half-width, window units
  let dx = bx - ax, dz = bz - az;
  let L = Math.hypot(dx, dz);
  if (L < 1e-6) { dx = 1; dz = 0; L = 1; }
  dx /= L; dz /= L;
  const nx = -dz, nz = dx;                          // across the stroke
  // ...extended by a half-width at each end. Consecutive segments then OVERLAP
  // by one half-width instead of meeting exactly, which is what stops a fast
  // carve from showing a notch at every frame boundary where the direction
  // turned a few degrees. `max` blending makes the overlap free.
  const a0x = (ax - S.cx) / span - dx * w, a0z = (az - S.cz) / span - dz * w;
  const b0x = (bx - S.cx) / span + dx * w, b0z = (bz - S.cz) / span + dz * w;
  const ox = nx * w, oz = nz * w;

  const i = S.n * 6;
  const P = S.pos, Q = S.aq, K = S.ink;
  // two triangles: (A-,A+,B+) (A-,B+,B-)
  const put = (k, x, z, qx, qy) => {
    P[k * 3] = x; P[k * 3 + 1] = z; P[k * 3 + 2] = 0;
    Q[k * 2] = qx; Q[k * 2 + 1] = qy;
    K[k * 2] = ink; K[k * 2 + 1] = rim;
  };
  put(i + 0, a0x - ox, a0z - oz, -1, 0);
  put(i + 1, a0x + ox, a0z + oz, 1, 0);
  put(i + 2, b0x + ox, b0z + oz, 1, 1);
  put(i + 3, a0x - ox, a0z - oz, -1, 0);
  put(i + 4, b0x + ox, b0z + oz, 1, 1);
  put(i + 5, b0x - ox, b0z - oz, -1, 1);
  S.n++;
  S.splats++;
}

/** draw everything queued into the live target. One draw call. */
function flush() {
  if (!S.n) return;
  const r = S.renderer;
  S.geo.setDrawRange(0, S.n * 6);
  S.geo.attributes.position.needsUpdate = true;
  S.geo.attributes.aQ.needsUpdate = true;
  S.geo.attributes.aInk.needsUpdate = true;
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  // §2.1: autoClear OFF is the whole persistence mechanism — every frame adds
  // to what is already on the target and nothing ever wipes it but a recentre.
  r.autoClear = false;
  r.setRenderTarget(S.rtA);
  r.render(S.scene, S.cam);
  r.autoClear = prevAuto;
  r.setRenderTarget(prev);
  S.n = 0;
  S.draws++;
  S.flushes++;
  S.lastFlushFrame = r.info.render.frame;
}

// ============================================================== the recentre
function recentre(px, pz) {
  const r = S.renderer;
  const texel = TRACKS_SPAN / S.size;
  // move only far enough to leave the player TRACKS_RECENTRE_LAG metres ahead
  // of the new centre (see the constant's note) — not all the way onto them
  const dist = Math.hypot(px - S.cx, pz - S.cz) || 1;
  const k = Math.max(0, (dist - TRACKS_RECENTRE_LAG * S.u) / dist);
  // TEXEL-ALIGNED OR NOT AT ALL. A fractional offset would resample the whole
  // map through a bilinear filter on every recentre and every old track would
  // blur a little more each time; snapping to whole texels makes the copy an
  // exact one, which acceptance §3.3 measures as "< 1/255 outside the margin".
  const dx = Math.round((px - S.cx) * k / texel) * texel;
  const dz = Math.round((pz - S.cz) * k / texel) * texel;
  if (dx === 0 && dz === 0) return;
  flush();                              // anything queued belongs to the OLD centre
  S.blitU.tSrc.value = S.rtA.texture;
  // a world point now at destination-uv `s` was at source-uv `s + d/span`
  S.blitU.uShift.value.set(dx / TRACKS_SPAN, dz / TRACKS_SPAN);
  const prev = r.getRenderTarget();
  const prevAuto = r.autoClear;
  r.autoClear = false;
  r.setRenderTarget(S.rtB);
  r.render(S.blitScene, S.cam);
  r.autoClear = prevAuto;
  r.setRenderTarget(prev);
  const t = S.rtA; S.rtA = S.rtB; S.rtB = t;      // ping-pong
  S.cx += dx; S.cz += dz;
  // ONE write reaches every material in the world — the shared holder from
  // lib/core.mjs. Without it this line would need a material walk.
  S.look.tracksMap(S.rtA.texture);
  S.look.tracksWindow(S.cx, S.cz, TRACKS_SPAN);
  S.draws++;
  S.recentres++;
}

// ======================================================= specs/0019: the read
// H (clean.js) empties the frame for a recording, and by default the tracks go
// with it. THE MAP IS NOT TOUCHED — this hides the READ and nothing else:
//
//   · `TRACKS_GAIN = 0` is terrain.mjs's own bit-exact gate (its L3 block
//     short-circuits before the texture fetch), so hiding costs a uniform write
//     and the frame is identical to a build with no tracks layer at all;
//   · `step()` and `flush()` carry on underneath, so a run laid while H is on is
//     still on the map when H comes off. Wiping and re-laying would have been
//     the easy version and the wrong one: "the tracks must not be CLEARED by H".
//
// The gain is also a DIAL Greg tunes (terrain.mjs `dial('TRACKS_GAIN', ...)`),
// which is why the live value is held rather than assumed — a 0.6 he set before
// pressing H is a 0.6 again when he lets go, not a 1.
function hideForCleanFrame() {
  const want = (() => {
    try {
      if (!document.body.classList.contains('clean-frame')) return false;
      return !setting('cleanPumpTracks');
    } catch { return false; }        // no document: a headless import, not a shot
  })();
  if (want === S.hidden) return;
  S.hidden = want;
  if (want) {
    S.gainHeld = S.look.TRACKS_GAIN;
    S.look.TRACKS_GAIN = 0;
  } else {
    S.look.TRACKS_GAIN = S.gainHeld == null ? 1 : S.gainHeld;
    S.gainHeld = null;
  }
}

// ================================================================== the step
function step(dt) {
  const c = S.ctrl, u = S.u;
  const p = c.position;

  if (Math.hypot(p.x - S.cx, p.z - S.cz) > TRACKS_RECENTRE * u) recentre(p.x, p.z);

  // WHO LEAVES A TRACK: skis, on the ground, moving. Anything else breaks the
  // path so the next stroke starts fresh rather than drawing a chord across
  // wherever you were airborne / walking / on the sled.
  const rides = c.mode === 'skis' && c.grounded && c.speed() > D.TRACKS_MIN_V * u;
  if (!rides) { S.prevL = S.prevR = null; return; }

  const yaw = c.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);      // along the skis (fx.js)
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);       // across them
  const tx = p.x - fx * TRACKS_BACK * u;               // the tail contact
  const tz = p.z - fz * TRACKS_BACK * u;
  const sx = rx * TRACKS_STANCE * u, sz = rz * TRACKS_STANCE * u;
  const lx = tx - sx, lz = tz - sz;
  const Rx = tx + sx, Rz = tz + sz;

  if (!S.prevL) { S.prevL = [lx, lz]; S.prevR = [Rx, Rz]; return; }
  // a jump cut / respawn / lift ride is not a carve
  if (Math.hypot(lx - S.prevL[0], lz - S.prevL[1]) > TRACKS_MAX_STEP * u) {
    S.prevL = [lx, lz]; S.prevR = [Rx, Rz]; return;
  }

  // INK FROM EDGE ANGLE (§2.1). Flat-running leaves TRACKS_INK_MIN; a fully
  // committed carve leaves 1.0. `ctrl.lean` is the bank the physics actually
  // carried and is clamped to TRACKS_LEAN_FULL by ski.js, so this ramp cannot
  // run off the end of its own range.
  const lean = Math.min(1, Math.abs(c.lean) / TRACKS_LEAN_FULL);
  const ink = D.TRACKS_INK_MIN + (1 - D.TRACKS_INK_MIN) * lean;

  // WHICH EDGE GETS THE LIP. specs/0013 §1 says the downhill edge, "where the
  // snow is thrown up"; §2.3's parenthetical says the sun-facing side. §1 wins,
  // and not only because it is the picture: the downhill direction is a fact
  // this module can READ (`ctrl.groundNormal()`), while the sun bearing lives in
  // the run's own scene module and a player-side file has no business
  // hardcoding one world's azimuth. On a fall-line run the two agree anyway —
  // this mountain's front side faces the afternoon sun.
  let rim = 0;
  const gn = c.groundNormal ? c.groundNormal() : null;
  if (gn) {
    const hx = gn.x, hz = gn.z;                       // downhill, horizontally
    const h = Math.hypot(hx, hz);
    if (h > 1e-3) {
      // how squarely the downhill direction crosses the stroke, times the ink
      const across = (hx * rx + hz * rz) / h;
      rim = ink * across;
    }
  }

  push(S.prevL[0], S.prevL[1], lx, lz, ink, rim);
  push(S.prevR[0], S.prevR[1], Rx, Rz, ink, rim);
  S.prevL = [lx, lz]; S.prevR = [Rx, Rz];
}

// ====================================================== the mobile step-down
// specs/0013 §2.4. On a coarse pointer the size is DECIDED BY MEASUREMENT, not
// by a device string: 512, else 256, else off. The statistic is the MINIMUM of
// each block and the answer is the median of the paired per-block differences —
// the same doctrine harness/shader-perf.mjs argues for at length, for the same
// reason: interference can only ADD time to a frame, so a block's minimum is
// its least-disturbed sample and a mean is a measure of the phone's other apps.
function measureMs(scene, camera) {
  const r = S.renderer;
  const gl = r.getContext();
  const BLOCK = 5, BLOCKS = TRACKS_MOBILE_FRAMES / (2 * BLOCK) | 0;
  const px = new Uint8Array(4);
  const one = (withTracks) => {
    S.look.TRACKS_GAIN = withTracks ? 1 : 0;
    let best = Infinity;
    for (let i = 0; i < BLOCK; i++) {
      const t0 = performance.now();
      if (withTracks) {
        // a representative splat: two strokes, which is what one frame of
        // skiing queues
        push(S.cx - 1, S.cz, S.cx + 1, S.cz, 1, 0.5);
        push(S.cx - 1, S.cz + 0.3, S.cx + 1, S.cz + 0.3, 1, 0.5);
        flush();
      }
      r.render(scene, camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // the flush
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  };
  const d = [];
  for (let b = 0; b < BLOCKS; b++) {
    // alternate the order so a warm-up bias lands on both conditions equally
    if (b & 1) { const off = one(false); d.push(one(true) - off); }
    else { const on = one(true); d.push(on - one(false)); }
  }
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

function decideSize(scene, camera) {
  const coarse = (() => { try { return matchMedia('(pointer: coarse)').matches; } catch { return false; } })();
  const rec = { coarse, budgetMs: TRACKS_MOBILE_MS, frames: TRACKS_MOBILE_FRAMES, steps: [] };
  if (!coarse) {
    rec.size = TRACKS_RT_SIZE; rec.enabled = true; rec.why = 'fine pointer — no measurement, 512';
    S.decision = rec; return rec;
  }
  let ms = measureMs(scene, camera);
  rec.steps.push({ size: TRACKS_RT_SIZE, ms: +ms.toFixed(3) });
  if (ms <= TRACKS_MOBILE_MS) {
    rec.size = TRACKS_RT_SIZE; rec.enabled = true;
    rec.why = `coarse pointer, ${ms.toFixed(2)} ms <= ${TRACKS_MOBILE_MS} — 512 stands`;
    S.decision = rec; return rec;
  }
  // step down and measure again
  teardownTargetsOnly();
  build(TRACKS_RT_SIZE_LOW);
  ms = measureMs(scene, camera);
  rec.steps.push({ size: TRACKS_RT_SIZE_LOW, ms: +ms.toFixed(3) });
  if (ms <= TRACKS_MOBILE_MS) {
    rec.size = TRACKS_RT_SIZE_LOW; rec.enabled = true;
    rec.why = `coarse pointer, 512 cost ${rec.steps[0].ms} ms — stepped down to 256 at ${ms.toFixed(2)} ms`;
    S.decision = rec; return rec;
  }
  rec.size = 0; rec.enabled = false;
  rec.why = `coarse pointer, 512 cost ${rec.steps[0].ms} ms and 256 cost ${ms.toFixed(2)} ms, both over `
    + `${TRACKS_MOBILE_MS} — tracks OFF`;
  S.decision = rec; return rec;
}
function teardownTargetsOnly() {
  if (S.rtA) S.rtA.dispose();
  if (S.rtB) S.rtB.dispose();
  if (S.geo) S.geo.dispose();
  if (S.mesh && S.mesh.material) S.mesh.material.dispose();
  if (S.blitMesh) { S.blitMesh.geometry.dispose(); S.blitMesh.material.dispose(); }
  S.n = 0;
}

// ==================================================================== boot
function boot(world, ctrl, unitScale, test) {
  S.THREE = world.THREE;
  S.renderer = world.renderer;
  S.ctrl = ctrl;
  S.u = unitScale || 1;
  S.test = !!test;
  const look = (typeof window !== 'undefined') ? window.__look : null;
  if (!look || typeof look.tracksMap !== 'function' || typeof look.tracksWindow !== 'function') {
    S.why = 'this world registered no L3-tracks look layer — nothing to draw into';
    return;
  }
  if (!S.renderer || !S.renderer.capabilities || !S.renderer.capabilities.isWebGL2) {
    S.why = 'WebGL2 is required (RG8 render target, MAX blend equation)';
    return;
  }
  S.look = look;
  S.cx = ctrl.position.x; S.cz = ctrl.position.z;
  build(TRACKS_RT_SIZE);
  const rec = decideSize(world.scene, world.camera);
  if (!rec.enabled) {
    teardown();
    S.on = false; S.why = rec.why;
    if (S.test) console.log('[tracks] ' + rec.why);
    return;
  }
  // the measurement leaves ink on the map and the gain wherever it last wrote
  clearTarget(S.rtA); clearTarget(S.rtB);
  S.n = 0; S.splats = 0; S.draws = 0; S.flushes = 0;
  S.look.tracksMap(S.rtA.texture);
  S.look.tracksWindow(S.cx, S.cz, TRACKS_SPAN);
  S.look.TRACKS_GAIN = 1;
  S.on = true; S.why = rec.why;
  if (S.test) {
    console.log(`[tracks] ${rec.why}  |  RT ${S.size}^2 RG8 x2 = `
      + `${(2 * S.size * S.size * 2 / 1048576).toFixed(2)} MB GPU, 0 transfer bytes  |  `
      + `span ${TRACKS_SPAN} m, ${(TRACKS_SPAN / S.size * 100).toFixed(1)} cm/texel, `
      + `recentre at ${TRACKS_RECENTRE} m`);
  }
  // the dials, on the same surface the read's dials are on
  for (const k of Object.keys(D)) {
    Object.defineProperty(look, k, {
      get: () => D[k], set: (v) => { D[k] = +v; }, enumerable: true, configurable: true,
    });
  }
}

// ============================================================== the one call
let booted = false;
export const tracks = {
  /**
   * ONE call per frame, from main.js's playerSystems(). Self-initialising: the
   * first call carries everything it needs, which is what keeps main.js's diff
   * to an import and this line.
   */
  update(dt, live, world, ctrl, unitScale, test) {
    if (!booted) {
      booted = true;
      try { boot(world, ctrl, unitScale, test); }
      catch (e) { S.on = false; S.why = 'boot failed: ' + (e && e.message || e); teardown(); }
    }
    if (!S.on) return;
    // specs/0019 — BEFORE the `live` gate on purpose: H can be pressed while the
    // world is not stepping (the panel is up, the intro is up), and a frame that
    // renders without stepping must still honour the knob.
    try { hideForCleanFrame(); } catch { /* a world with no body */ }
    if (!live) return;
    try {
      step(dt);
      // AT MOST ONE TARGET RENDER PER REAL FRAME. `info.render.frame` only moves
      // when something actually renders, so under __player.stepFixed (which
      // never renders) this holds the splats back until the pool is full — a
      // 600-step ride costs ~5 target renders instead of 600 — while under the
      // rAF loop it is exactly one per frame, which is what §3.7 counts.
      if (S.n && (S.renderer.info.render.frame !== S.lastFlushFrame || S.n >= SEG_CAP - 2)) flush();
    } catch (e) { S.on = false; S.why = 'update failed: ' + (e && e.message || e); }
  },

  // ------------------------------------------------------------ test hooks
  info: () => ({
    // `size` is 0 when the layer is off, so it can never read as "256" for a
    // build that measured 256 and then decided against it — `builtSize` keeps
    // the last size that was actually allocated, for the step-down record.
    on: S.on, why: S.why, size: S.on ? S.size : 0, builtSize: S.size,
    span: TRACKS_SPAN, recentre: TRACKS_RECENTRE,
    format: 'RG8', bytes: S.on ? 2 * S.size * S.size * 2 : 0,
    centre: { x: S.cx, z: S.cz },
    draws: S.draws, recentres: S.recentres, splats: S.splats, flushes: S.flushes,
    decision: S.decision,
    // specs/0019 — the READ is gated, the map is not. `hidden` is this module's
    // own bookkeeping; `dials.TRACKS_GAIN` below is what the shader actually
    // sees, and a gate should prefer the second.
    hidden: S.hidden, gainHeld: S.gainHeld,
    dials: { ...D, TRACKS_GAIN: S.look ? S.look.TRACKS_GAIN : null,
             TRACKS_DARK: S.look ? S.look.TRACKS_DARK : null,
             TRACKS_RIM: S.look ? S.look.TRACKS_RIM : null },
    consts: { TRACKS_RT_SIZE, TRACKS_SPAN, TRACKS_RECENTRE, TRACKS_RECENTRE_LAG,
              TRACKS_MOBILE_MS, TRACKS_MOBILE_FRAMES, TRACKS_RT_SIZE_LOW,
              TRACKS_BACK, TRACKS_STANCE, TRACKS_LEAN_FULL,
              TRACKS_MAX_STEP, TRACKS_FEATHER, TRACKS_RIM_WIDTH, SEG_CAP },
    // what the window guarantees, given the lag (see TRACKS_RECENTRE_LAG)
    persistenceM: { behind: [TRACKS_SPAN / 2 + TRACKS_RECENTRE_LAG, TRACKS_SPAN / 2 + TRACKS_RECENTRE],
                    ahead: [TRACKS_SPAN / 2 - TRACKS_RECENTRE, TRACKS_SPAN / 2 - TRACKS_RECENTRE_LAG] },
  }),

  /**
   * The whole map as {w, h, ink: Uint8Array, rim: Uint8Array}. Read as
   * RGBA/UNSIGNED_BYTE — the one pair ES 3.0 guarantees for a normalised
   * fixed-point colour buffer, which `readRenderTargetPixels` does NOT use for
   * an RG8 target (it asks for RG/UNSIGNED_BYTE, which is only conditionally
   * supported). Test-only; nothing on the render path reads pixels back.
   */
  readMap() {
    if (!S.on) return null;
    flush();
    const r = S.renderer, gl = r.getContext();
    const n = S.size;
    const buf = new Uint8Array(n * n * 4);
    const prev = r.getRenderTarget();
    r.setRenderTarget(S.rtA);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    r.setRenderTarget(prev);
    const ink = new Uint8Array(n * n), rim = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) { ink[i] = buf[i * 4]; rim[i] = buf[i * 4 + 1]; }
    return { w: n, h: n, ink, rim, centre: { x: S.cx, z: S.cz }, span: TRACKS_SPAN };
  },

  /** ink/rim at one world xz, nearest texel. null when outside the window. */
  sampleAt(x, z, map) {
    if (!S.on) return null;
    const m = map || tracks.readMap();
    if (!m) return null;
    const ux = (x - m.centre.x) / m.span + 0.5, uz = (z - m.centre.z) / m.span + 0.5;
    if (ux < 0 || ux > 1 || uz < 0 || uz > 1) return null;
    const i = Math.min(m.w - 1, Math.max(0, Math.round(ux * m.w - 0.5)));
    const j = Math.min(m.h - 1, Math.max(0, Math.round(uz * m.h - 0.5)));
    const k = j * m.w + i;
    return { ink: m.ink[k] / 255, rim: m.rim[k] / 255, i, j };
  },

  /** wipe the map — used by the acceptance rides to start from clean snow */
  reset(x, z) {
    if (!S.on) return false;
    S.n = 0; S.prevL = S.prevR = null;
    if (x !== undefined) { S.cx = x; S.cz = z; }
    clearTarget(S.rtA); clearTarget(S.rtB);
    S.look.tracksWindow(S.cx, S.cz, TRACKS_SPAN);
    S.draws = 0; S.recentres = 0; S.splats = 0; S.flushes = 0;
    return true;
  },

  /** force a flush — the acceptance harness calls it before reading the map */
  flush: () => { if (S.on) flush(); },

  // ---- cost hooks (§3.4). They exist because the pass has to be priced on its
  // own: harness/shader-perf.mjs serves the run's scene/ and never loads this
  // module, so it can only price THE READ. `splatTest(2)` queues exactly what
  // one frame of skiing queues — two strokes, one per ski — and `recentreTest`
  // forces the blit, so a timing loop can alternate "with the pass" against
  // "without it" while the rider stands still and nothing else moves.
  splatTest(n = 2) {
    if (!S.on) return 0;
    for (let i = 0; i < n; i++) {
      const z = S.cz + (i - n / 2) * (2 * TRACKS_STANCE * S.u);
      push(S.cx - 3 * S.u, z, S.cx + 3 * S.u, z, 1, 0.5);
    }
    return S.n;
  },
  recentreTest(dx = 14, dz = 0) {
    if (!S.on) return null;
    recentre(S.cx + dx * S.u, S.cz + dz * S.u);
    return { x: S.cx, z: S.cz, recentres: S.recentres };
  },
};

if (typeof window !== 'undefined') window.__tracks = tracks;
export default tracks;
