// Scene adapters — how a run's scene/ becomes something you can walk around in.
//
// Three tiers, most-preferred first:
//
//  1. CONTRACT  scene/world.mjs exporting buildWorld(THREE) -> {scene, spawn?,
//     colliders?}. We own the renderer, camera and loop. See harness/PLAYABLE.md.
//
//  2. PAGE TAKEOVER  the scene is a self-contained index.html (the Arm-A shape).
//     We cannot import it, so we run its own module graph inside THIS document:
//     <base> is rewritten to the scene dir (its document-relative fetches of
//     ./data/* keep working), its importmap is re-injected (so its vendored
//     three is the same module instance we use), its body markup is cloned into
//     a hidden donor node (so getElementById in its inline script still finds
//     things), and its scripts are re-created so they execute. We then patch
//     WebGLRenderer.prototype.render to capture the (scene, camera) it renders
//     and to write our camera pose in just before each frame — the scene keeps
//     its own renderer, loop, water animation and lighting, and never knows.
//
//     FAILURE MODE: this rides on the scene rendering through a normal
//     THREE.WebGLRenderer resolved through its own importmap, and on it not
//     needing a real page layout. A scene that renders only to a render target,
//     that hardcodes a second copy of three, that never populates within 30 s,
//     or that hard-depends on the DOM its own <style> gave it will be reported
//     NOT PLAYABLE rather than half-work. Camera fighting is expected and
//     handled (we write last, inside render); a scene that recomputes its
//     camera *inside* its own render call would beat us.
//
//  3. GLTF  scene/*.glb — loaded into a scene we build, with our own lights.

const TIMEOUT_MS = 30000;

// Intercept every WebGLRenderer.render call without owning the renderer.
// three r150+ assigns `this.render = function ...` inside the constructor, so
// the method is an OWN property and patching the prototype is a no-op. An
// accessor on the prototype catches that assignment as it happens and swaps in
// a wrapper; the prototype-method form is still handled for other revisions.
function installRenderHook(THREE, onRender) {
  const proto = THREE.WebGLRenderer.prototype;
  if (typeof proto.render === 'function') {
    const orig = proto.render;
    proto.render = function (s, c) { onRender(this, s, c); return orig.call(this, s, c); };
    return () => { proto.render = orig; };
  }
  Object.defineProperty(proto, 'render', {
    configurable: true,
    get() { return undefined; },
    set(fn) {
      const wrapped = function (s, c) { onRender(this, s, c); return fn.call(this, s, c); };
      Object.defineProperty(this, 'render', { value: wrapped, writable: true, configurable: true, enumerable: true });
    },
  });
  return () => { delete proto.render; };
}

export async function loadWorld(THREE, cfg, say = () => {}) {
  if (cfg.mode === 'world') return loadContract(THREE, cfg, say);
  if (cfg.mode === 'gltf') return loadGltf(THREE, cfg, say);
  return takeOverPage(THREE, cfg, say);
}

// ---------------------------------------------------------------- tier 1
async function loadContract(THREE, cfg, say) {
  // specs/0051 §9.2 #8 — boot-timeline attribution, wave 1a. `mark` is a
  // no-op off a real Performance timeline (node/test harnesses); paired with
  // world.mjs's marks these split nav→__playerReady into: page boot (nav→
  // here), module-graph fetch/eval — which includes ground.mjs's eager
  // buildGround() running as an IMPORT side effect, not inside buildWorld
  // (specs/0051 §4.6) — and buildWorld()'s own internal buckets. Never gates
  // anything (D-6); see PROGRESS-0051-1a.md for the measured split.
  const mark = (n) => { try { performance.mark(n); } catch { /* no Performance timeline */ } };
  mark('chunks:loader-start');
  say('building world…');
  // ABSOLUTE, ONCE. `cfg.entryUrl` is not the same SHAPE on the two hosts the
  // player runs on: the export template builds it off `new URL('.',
  // location.href)` and hands over an absolute href, while the bench hands over
  // the run API's root-relative path ('/files/runs/<run>/scene/world.mjs',
  // play.html:119). `import()` resolves either against the importing module and
  // is happy; `new URL(spec, base)` THROWS on a relative base, which is how the
  // whole chunk scheduler went inert on the bench and only on the bench
  // (§2.1 — "a scheduler exception must be a visible failure"). Resolving once,
  // here, means the module specifiers below cannot diverge from what the world
  // entry itself was loaded from.
  const entryHref = new URL(cfg.entryUrl, location.href).href;
  mark('chunks:loader-import-start');
  const mod = await import(entryHref);
  mark('chunks:loader-import-end');
  const build = mod.buildWorld || mod.default;
  if (typeof build !== 'function') throw new Error('world.mjs exports no buildWorld(THREE)');
  mark('chunks:loader-build-start');
  const query = new URLSearchParams(location.search);
  const out = await build(THREE, {
    units: 'm',
    // D31 — the only opts key buildWorld honours, and the device that needs it:
    // on touch the 2048^2 shadow pass never runs.
    shadows: !matchMedia('(pointer: coarse)').matches,
    snowBanks: query.get('snowBanks') === 'map' ? 'map' : query.get('snowBanks') === '1',
    alpinePolish: query.get('alpinePolish') === '1',
    groomedRun: query.get('groomedRun') === '1',
  });
  mark('chunks:loader-build-end');
  const scene = out && (out.scene || (out.isScene ? out : null));
  if (!scene) throw new Error('buildWorld returned no scene');
  const renderer = makeRenderer(THREE);
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.12, 20000);
  document.body.appendChild(renderer.domElement);
  mark('chunks:loader-end');
  // specs/0051 §2.1 — "buildWorld returns a `chunks` handle beside {scene,
  // spawn, colliders, update}; loader.js:62-98 passes it through". The three
  // scene modules beside it are what wave 2a's scheduler builds tiles FROM:
  // `tiles.mjs` is the lattice (wave 1b), `ground.mjs` is groundZ/normalAt and
  // `terrain.mjs` is colorAt. They are resolved AGAINST `entryHref` — the exact
  // href `world.mjs` itself was imported from above, and therefore the URL its
  // own static imports resolved against — so the browser hands back the module
  // records that are already in the graph: the same instances, not second
  // copies (a second `ground.mjs` would re-run `buildGround()` and cost 24 MB
  // and two seconds). bench-probe.mjs asserts that identity from the outside,
  // by counting ground.mjs once in the resource timeline.
  //
  // NOTHING IS SWALLOWED. An ABSENT module is the one legitimate inert case (the
  // gltf and page adapters, any contract world older than wave 1b). Everything
  // else is a bug, and used to be indistinguishable from absence because this
  // catch returned null either way. Two failures, both LOUD:
  //
  //   - the specifier will not RESOLVE. Never a missing module — it means
  //     `entryUrl` is malformed for `new URL`, which is precisely the bug that
  //     emptied the bench of trees. Always loud.
  //   - the module resolved and would not IMPORT. Loud iff the file answers a
  //     fetch; a 404 there is a genuinely absent module.
  //
  // `.loud` is what chunks.js turns into the reason `window.__chunks` reads back
  // (§2.1: "a scheduler exception must be a visible failure").
  const sideErrors = Object.create(null);
  const side = async (spec) => {
    if (Array.isArray(cfg.sceneModules) && !cfg.sceneModules.includes(spec)) return null;
    let href = null;
    try { href = new URL(spec, entryHref).href; } catch (e) {
      e.loud = true; e.present = null; e.href = null; sideErrors[spec] = e;
      console.error(`[play] scene module ${spec} could not be RESOLVED against entryUrl ${cfg.entryUrl} — `
        + 'the chunk scheduler will be inert and this world will have no tiles, no forest and no rocks', e);
      return null;
    }
    try { return await import(href); } catch (e) {
      let present = false;
      try { present = (await fetch(href, { cache: 'force-cache' })).ok; } catch { /* not there */ }
      e.present = present; e.loud = present; e.href = href; sideErrors[spec] = e;
      if (present) {
        console.error(`[play] scene module ${spec} IS present at ${href} but failed to import — `
          + 'the chunk scheduler will be inert and this world will have no tiles, no forest and no rocks', e);
      }
      return null;
    }
  };
  const [tiles, ground, terrain] = await Promise.all(
    [side('./tiles.mjs'), side('./ground.mjs'), side('./terrain.mjs')]);
  return {
    adapter: 'contract', THREE, scene, camera, renderer,
    chunks: out.chunks || null,           // the tiles.mjs handle (probes + drain)
    tiles, ground, terrain,               // the modules the scheduler builds from
    sideErrors,                           // spec -> the import Error, with `.present`
    // specs/0051 §5.3 wave 3a — the forest/rock prototypes world.mjs bakes
    // (firGeo + T1/T3/T4 dressing) and POOL_INST places, one per (class, seed)
    tileProtos: out.tileProtos || null,
    // specs/0051 §5.1 wave 4a — the ladder meshes the tile lattice replaces on
    // screen. A DECLARATION, like `colliders`: chunks.js hides exactly this list
    // once the required tile set is first complete, and a world that declares
    // none keeps drawing what it built.
    legacyFloor: Array.isArray(out.legacyFloor) ? out.legacyFloor : null,
    colliders: out.colliders || null,
    // specs/0051 §3.6 / §2.1 — the two handles the collision router needs and
    // the loader used to drop on the floor. `terrainHeight` is the world's own
    // analytic ground (world.mjs:1675 red-dog, world.mjs:563 siberia), consumed
    // by ZERO player files before this wave; `chunks` is §2.1's tile handle,
    // passed through here exactly as the spec says loader.js does.
    // (`chunks` is already passed through above, from 2a's scheduler wiring.)
    terrainHeight: typeof out.terrainHeight === 'function' ? out.terrainHeight : null,
    spawnHint: out.spawn || null,
    gear: out.gear || null,        // optional 'boots'|'skis'|'bike'|'glider' (PLAYABLE.md)
    lifts: Array.isArray(out.lifts) ? out.lifts : null,   // optional rideable chairlifts
    // optional run polylines — READ-ONLY, exactly as declared. The player never
    // writes to them; lift.js aims its unload spawns down them and guide.js
    // derives its whole course from them.
    runs: Array.isArray(out.runs) ? out.runs : null,
    markers: Array.isArray(out.markers) ? out.markers : null,  // optional POI signs (markers.js)
    // specs/0057 §1.1 — optional JIB LINES (rail.js). Declared in the world's own
    // frame like `markers` and `lifts`, and read-only exactly as they are: rail.js
    // tips a copy at init and the world's array is never written to.
    jibs: Array.isArray(out.jibs) ? out.jibs : null,
    report: out.report || null,   // D42 — drawCalls / triangles / collidableTriangles / buildMs.
                                  // The world counts these itself; the loader used to
                                  // drop them on the floor, so no perf budget could be
                                  // enforced against anything but an estimate.
    upAxis: out.up === 'z' ? 'z' : 'y',
    declaredUp: out.up !== undefined,
    update: typeof out.update === 'function' ? out.update : null,
    ownLoop: true,
  };
}

// ---------------------------------------------------------------- tier 3
async function loadGltf(THREE, cfg, say) {
  say('loading glb…');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(cfg.entryUrl);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbcd8ef);
  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x6b6350, 2.0));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.7);
  sun.position.set(160, 320, 120);
  scene.add(sun, gltf.scene);
  const renderer = makeRenderer(THREE);
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.12, 20000);
  document.body.appendChild(renderer.domElement);
  return { adapter: 'gltf', THREE, scene, camera, renderer, colliders: [gltf.scene], spawnHint: null, upAxis: 'y', ownLoop: true };
}

function makeRenderer(THREE) {
  const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  // D25 — COARSE POINTERS CAP AT 1.5, everything else keeps 2. A 3x phone at
  // DPR 2 renders 4x the pixels of DPR 1 for a screen held at arm's length, and
  // it is the device least able to afford them.
  r.setPixelRatio(Math.min(devicePixelRatio, matchMedia('(pointer: coarse)').matches ? 1.5 : 2));
  r.setSize(innerWidth, innerHeight);
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

// ---------------------------------------------------------------- tier 2
async function takeOverPage(THREE, cfg, say) {
  const doc = new DOMParser().parseFromString(cfg.sceneHtml, 'text/html');

  // capture what the scene renders, and get a hook to write our camera pose
  let captured = null;
  const hooks = [];
  const uninstall = installRenderHook(THREE, (renderer, scene, camera) => {
    if (!captured && scene && scene.isScene && camera && camera.isCamera) {
      captured = { scene, camera, renderer };
    }
    if (captured && scene === captured.scene) for (const h of hooks) h(captured);
  });

  // donor DOM: the scene's own body markup, hidden. Its inline module does
  // getElementById() on nodes that only exist in its page.
  const donor = document.createElement('div');
  donor.className = 'play-donor';
  donor.setAttribute('hidden', '');
  const scripts = [];
  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeName === 'SCRIPT') { scripts.push(node); continue; }
    donor.appendChild(document.importNode(node, true));
  }
  for (const node of Array.from(doc.head.querySelectorAll('script'))) {
    if ((node.getAttribute('type') || '') === 'importmap') continue;   // already injected by boot
    scripts.push(node);
  }
  document.body.appendChild(donor);

  say('running scene modules…');
  const errors = [];
  const onErr = (e) => errors.push(String(e.message || e.reason || e));
  addEventListener('error', onErr);
  addEventListener('unhandledrejection', onErr);

  for (const src of scripts) {
    const s = document.createElement('script');
    for (const a of Array.from(src.attributes)) s.setAttribute(a.name, a.value);
    if (!src.getAttribute('src')) s.textContent = src.textContent;
    document.body.appendChild(s);
  }

  // wait for a populated scene: either the scene says it is ready, or its child
  // count stops growing
  say('waiting for the world…');
  const t0 = performance.now();
  let lastCount = -1, stableSince = 0;
  for (;;) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    if (captured) {
      const n = captured.scene.children.length;
      if (n !== lastCount) { lastCount = n; stableSince = now; }
      const ready = window.__ready === true;
      if (n > 0 && (ready || now - stableSince > 900)) break;
    }
    if (now - t0 > TIMEOUT_MS) {
      removeEventListener('error', onErr); removeEventListener('unhandledrejection', onErr);
      uninstall();
      throw new Error(captured
        ? 'the scene rendered but never populated (' + (captured.scene.children.length) + ' children after 30 s)'
        : 'the scene never called WebGLRenderer.render' + (errors.length ? ' — first error: ' + errors[0] : ''));
    }
  }
  removeEventListener('error', onErr);
  removeEventListener('unhandledrejection', onErr);

  // best-effort: silence whatever camera rig the page brought with it
  const st = window.__state;
  if (st) {
    if (st.controls) { try { st.controls.enabled = false; st.controls.update = () => {}; } catch { /* not ours */ } }
    if ('useOrtho' in st) st.useOrtho = false;
  }

  const cam = captured.camera;
  cam.near = 0.12; cam.fov = 72; cam.updateProjectionMatrix();

  return {
    adapter: 'page', THREE,
    scene: captured.scene, camera: cam, renderer: captured.renderer,
    colliders: null, spawnHint: null, upAxis: 'y',
    ownLoop: false,
    onBeforeSceneRender: (fn) => hooks.push(fn),
    donor,
  };
}
