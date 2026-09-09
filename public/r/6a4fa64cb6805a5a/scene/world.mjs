import { groundZ, terrain } from './ground.mjs';
import { RUNS, LIFTS, FRAME } from './layout.mjs';
import { addDetails, signTexture } from './details.mjs';
import { applySnowSurface } from './snow-surface.mjs';
import { applyRockSurface } from './rock-surface.mjs';
import { addConifers, treeBarkMaterial, treeBarkDepthMaterial } from './trees-polished.mjs';
import { snowReliefTerrain, terrainSampler } from './snow-relief.mjs';
import { approvedSnowBankPlacements, sha256Hex, APPROVED_SNOW_BANK } from './snow-banks.mjs';
import { buildTerrainPatchReplacement } from './terrain-patches.mjs';
import { canonicalTrees } from './tree-layout.mjs';
import { buildSnowBankMapPlacements } from './snow-bank-map.mjs';
import { applyGroomedRun } from './groomed-run.mjs';
import { applySnowTracks, installSnowTrackBridge } from './snow-tracks.mjs';
import { addNearSnowRelief } from './near-snow-relief.mjs';

const patchCache = new Map();
let approvedSource;
let patchCacheHits = 0;
let patchCacheBuilds = 0;

function retainedBufferBytes(value, buffers = new Set(), visited = new Set()) {
  if (!value || typeof value !== 'object' || visited.has(value)) return 0;
  visited.add(value);
  if (ArrayBuffer.isView(value)) {
    if (buffers.has(value.buffer)) return 0;
    buffers.add(value.buffer);
    return value.buffer.byteLength;
  }
  return Object.values(value).reduce((total, child) => total + retainedBufferBytes(child, buffers, visited), 0);
}

export function snowBankCacheStats() {
  const entries = [...patchCache.values()].filter(entry => entry.patch);
  const buffers = new Set();
  return {
    entries: entries.length,
    hits: patchCacheHits,
    builds: patchCacheBuilds,
    retainedTypedBufferBytes: entries.reduce((total, entry) => total + retainedBufferBytes(entry.patch, buffers), 0),
    spatialIndexEstimatedBytes: entries.reduce((total, entry) => total + entry.patch.stats.spatialIndexEstimatedBytes, 0)
  };
}

async function snowBankPatch(opts) {
  const suppliedBytes = opts.snowBankAsset ? new Uint8Array(opts.snowBankAsset instanceof Uint8Array ? opts.snowBankAsset : new Uint8Array(opts.snowBankAsset)) : undefined;
  if (suppliedBytes && await sha256Hex(suppliedBytes) !== APPROVED_SNOW_BANK.sha256) throw new Error('Approved snow bank SHA256 mismatch');
  const preset = opts.snowBankPreset ?? 'balanced';
  const key = opts.snowBanks === 'map' ? `map:${preset}` : 'source';
  const cacheable = !opts.terrainPatches && opts.snowBankCache !== false;
  if (cacheable && patchCache.has(key)) {
    patchCacheHits++;
    return patchCache.get(key).promise;
  }
  const entry = {};
  entry.promise = (async () => {
    if (!approvedSource) approvedSource = approvedSnowBankPlacements({ bytes: suppliedBytes }).then(placements => structuredClone(placements)).catch(error => { approvedSource = undefined; throw error; });
    const placements = await approvedSource;
    const map = opts.snowBanks === 'map' ? buildSnowBankMapPlacements(terrain, placements[0], { preset }) : null;
    const patch = buildTerrainPatchReplacement(terrain, opts.terrainPatches ?? map?.placements ?? placements);
    if (map) patch.stats.map = map.stats;
    if (cacheable) { entry.patch = patch; patchCacheBuilds++; }
    return patch;
  })().catch(error => { if (patchCache.get(key) === entry) patchCache.delete(key); throw error; });
  if (cacheable) patchCache.set(key, entry);
  return entry.promise;
}

export function buildWorld(THREE, opts = {}) {
  if (opts.snowBanks === true || opts.snowBanks === 'map') {
    if (opts.snowRelief === true) throw new Error('snowBanks and snowRelief are separate opt-in terrain modes');
    return snowBankPatch(opts).then(terrainPatch => buildResolvedWorld(THREE, opts, terrainPatch));
  }
  return buildResolvedWorld(THREE, opts);
}

function buildResolvedWorld(THREE, opts, terrainPatch) {
  const alpinePolish = opts.alpinePolish === true;
  const activeTerrain = opts.snowRelief === true ? snowReliefTerrain(terrain) : terrain;
  const worldGroundZ = terrainPatch?.sample ?? (opts.snowRelief === true ? terrainSampler(activeTerrain) : groundZ);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(alpinePolish ? '#78a3c8' : '#709cc4');
  scene.fog = new THREE.Fog(alpinePolish ? '#a9c0d2' : '#9ebbd0', alpinePolish ? 2500 : 2200, alpinePolish ? 9800 : 9500);
  const colliders = [];
  const snow = new THREE.MeshStandardMaterial({ color: alpinePolish ? '#f1f3f4' : '#eff4fa', roughness: alpinePolish ? 0.91 : 0.94, vertexColors: true });
  snow.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float chuteMask; varying float alpineChute; varying vec3 alpinePosition; varying vec3 alpineNormal;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nalpinePosition=position; alpineNormal=normal; alpineChute=chuteMask;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 alpinePosition; varying vec3 alpineNormal; varying float alpineChute;
      float alpineHash(vec3 point) {return fract(sin(dot(point,vec3(127.1,311.7,74.7)))*43758.5453);}
      float alpineNoise(vec3 point) {
        vec3 cell=floor(point);vec3 blend=fract(point);blend=blend*blend*(3.0-2.0*blend);
        return mix(mix(mix(alpineHash(cell),alpineHash(cell+vec3(1,0,0)),blend.x),mix(alpineHash(cell+vec3(0,1,0)),alpineHash(cell+vec3(1,1,0)),blend.x),blend.y),mix(mix(alpineHash(cell+vec3(0,0,1)),alpineHash(cell+vec3(1,0,1)),blend.x),mix(alpineHash(cell+vec3(0,1,1)),alpineHash(cell+vec3(1,1,1)),blend.x),blend.y),blend.z);
      }
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float steep = 1.0 - abs(normalize(alpineNormal).z);
      float grain = fract(sin(dot(floor(alpinePosition * 5.0), vec3(12.9898,78.233,45.164))) * 43758.5453);
      float large = alpineNoise(alpinePosition * vec3(.22,.23,.35));
      float detail = alpineNoise(alpinePosition * vec3(1.1,1.1,.63));
      float joint = smoothstep(.46,.50,detail)-smoothstep(.50,.56,detail);
      float rock = ${alpinePolish ? 'smoothstep(.27,.38, steep + (large-.5)*.10)' : 'smoothstep(.22,.39, steep + (large-.5)*.24)'};
      vec3 granite = mix(vec3(.16,.17,.16), vec3(.47,.46,.415), large*.75+detail*.25);
      granite *= 1.0-joint*${alpinePolish ? '.06' : '.30'};
      float snowPatches = ${alpinePolish ? 'smoothstep(.58,.78,large*.65+detail*.35) * (1.0-smoothstep(.16,.40,steep))' : 'smoothstep(.63,.77,large*.55+detail*.45) * (1.0-smoothstep(.4,.82,steep))'};
      rock *= 1.0-snowPatches;
      rock *= 1.0-alpineChute;
      ${opts.groomedRun === true ? 'rock *= 1.0 - clamp(groomedMask, 0.0, 1.0);' : ''}
      ${alpinePolish ? `float alpineFootprint = max(length(dFdx(alpinePosition.xy)), length(dFdy(alpinePosition.xy)));
      float alpineFineFade = 1.0 - smoothstep(.08, .65, alpineFootprint);
      float wind = alpineNoise(alpinePosition*vec3(1.7,.28,1.0))*.032*alpineFineFade;
      diffuseColor.rgb *= mix(vec3(.958+wind+grain*.008*alpineFineFade), granite, rock);` : `float wind = alpineNoise(alpinePosition*vec3(1.7,.28,1.0))*.055;
      diffuseColor.rgb *= mix(vec3(.945+wind+grain*.015), granite, rock);`}
    `);
  };
  let snowSurface;
  if (alpinePolish) scene.userData.rockSurface = applyRockSurface(snow, { THREE, enabled: opts.rockDetail !== false, metersPerRepeat: 9, colorStrength: 1, roughness: .84 });
  if (opts.groomedRun !== true) snowSurface = applySnowSurface(THREE, snow, { mask: '1.0 - rock', enabled: opts.snowDetail !== false, alpinePolish });
  const positions = terrainPatch?.positions.slice() ?? new Float32Array(activeTerrain.heights.length * 3);
  const colors = new Float32Array(positions.length);
  const chuteMask = new Float32Array(positions.length / 3);
  const chutes = RUNS.filter(run=>run.style==='chute'||run.style==='gully');
  const indices = terrainPatch?.indices.slice() ?? new Uint32Array((terrain.xs.length - 1) * (terrain.ys.length - 1) * 6);
  if (!terrainPatch) {
    let vertex = 0, indexOffset = 0;
    for (let row = 0; row < terrain.ys.length; row++) for (let column = 0; column < terrain.xs.length; column++) {
      positions.set([terrain.xs[column], terrain.ys[row], activeTerrain.heights[vertex]], vertex * 3);
      if (column < terrain.xs.length - 1 && row < terrain.ys.length - 1) {
        const next = vertex + terrain.xs.length;
        indices.set([vertex, vertex + 1, next, vertex + 1, next + 1, next], indexOffset);
        indexOffset += 6;
      }
      vertex++;
    }
  }
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const east = positions[vertex * 3], north = positions[vertex * 3 + 1];
    if(north<280&&north> -450&&east> -500&&east<900){
      for(const chute of chutes)for(let segment=0;segment<chute.pts.length-1;segment++){
        const first=chute.pts[segment],second=chute.pts[segment+1];
        const deltaEast=second[0]-first[0],deltaNorth=second[1]-first[1],square=deltaEast*deltaEast+deltaNorth*deltaNorth;
        const along=Math.max(0,Math.min(1,((east-first[0])*deltaEast+(north-first[1])*deltaNorth)/(square||1)));
        const distance=Math.hypot(east-first[0]-deltaEast*along,north-first[1]-deltaNorth*along);
        const blend=Math.max(0,Math.min(1,(chute.width-distance)/(chute.width*.65)));
        chuteMask[vertex]=Math.max(chuteMask[vertex],blend*blend*(3-2*blend));
      }
    }
    const ambient = 0.965 + 0.025 * Math.sin(east * 0.013) * Math.sin(north * 0.009);
    colors.set(alpinePolish ? [ambient * .992, ambient * .997, 1] : [ambient, ambient, 1], vertex * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('chuteMask', new THREE.BufferAttribute(chuteMask, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const groomedRun = opts.groomedRun === true ? applyGroomedRun(THREE, snow, geometry) : null;
  if (groomedRun) snowSurface = applySnowSurface(THREE, snow, { mask: '1.0 - rock', enabled: opts.snowDetail !== false, alpinePolish });
  scene.userData.snowSurface = snowSurface;
  if (alpinePolish) {
    const snowTracks = applySnowTracks(THREE, snow);
    scene.userData.snowTracks = snowTracks;
    if (typeof window !== 'undefined') installSnowTrackBridge(snowTracks, window);
  }
  const ground = new THREE.Mesh(geometry, snow);
  ground.name = 'terrain-alpine-and-collidable-rim';
  if (groomedRun) ground.userData.groomedRun = groomedRun;
  ground.receiveShadow = true;
  scene.add(ground); colliders.push(ground);
  const sun = new THREE.DirectionalLight(alpinePolish ? '#ffe8c4' : '#fff0d9', alpinePolish ? 3.15 : 2.7);
  sun.position.set(-1000, -1600, 2100);
  sun.target.position.set(-150, -100, 200);
  sun.castShadow = !!opts.shadows;
  sun.shadow.mapSize.set(2048, 2048);
  const shadowExtent = alpinePolish ? 620 : 750;
  Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent, near: 10, far: 5000 });
  sun.shadow.bias = alpinePolish ? -0.00008 : -0.00015;
  if (alpinePolish) sun.shadow.normalBias = .025;
  scene.add(sun, sun.target);
  const ambient = new THREE.HemisphereLight(alpinePolish ? '#a9cbed' : '#b9d6ff', alpinePolish ? '#43515f' : '#5d6470', alpinePolish ? .72 : 1.25);
  ambient.position.set(0, 0, 1); scene.add(ambient);
  const steel = new THREE.MeshStandardMaterial({ color: '#68747b', roughness: 0.55, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: '#202a33', roughness: 0.72 });
  const red = new THREE.MeshStandardMaterial({ color: '#b84030', roughness: 0.8 });
  const timber = new THREE.MeshStandardMaterial({ color: '#67503a', roughness: 1 });
  const enamel = new THREE.MeshStandardMaterial({ color: '#d6dde0', roughness: .5, metalness: .2 });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const batches = new Map();
  function box(name, point, size, material, collidable = true, yaw = 0) {
    const key = material.uuid + ':' + collidable;
    if (!batches.has(key)) batches.set(key, { material, collidable, items: [] });
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...point), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw), new THREE.Vector3(...size));
    batches.get(key).items.push({ matrix, name });
  }
  const chairUpdates = [];
  const lifts = [];
  for (const lift of LIFTS) {
    const ordered = [...lift.pts].sort((first, second) => first[2] - second[2]);
    const base = ordered[0], top = ordered.at(-1);
    const delta = new THREE.Vector3(top[0] - base[0], top[1] - base[1], 0);
    const length = delta.length(); delta.normalize();
    const side = new THREE.Vector3(-delta.y, delta.x, 0);
    const yaw = Math.atan2(delta.y, delta.x);
    const start = lift.topOnly ? 0.60 : 0;
    const supports = [];
    const supportCount = lift.topOnly ? 5 : 16;
    for (let support = 0; support < supportCount; support++) {
      const fraction = start + (1 - start) * support / (supportCount - 1);
      const east = base[0] + delta.x * length * fraction;
      const north = base[1] + delta.y * length * fraction;
      const groundHeight = worldGroundZ(east, north);
      const terminal = support === supportCount - 1 || (!lift.topOnly && support === 0);
      supports.push({ east, north, height: groundHeight + (terminal ? 7 : 15), groundHeight, terminal });
    }
    for (let pass = 0; pass < 8; pass++) for (let index = 0; index < supports.length - 1; index++) {
      const first = supports[index], second = supports[index + 1];
      let deficit = 0;
      for (let part = 0; part <= 30; part++) {
        const fraction = part / 30;
        const east = first.east + (second.east - first.east) * fraction;
        const north = first.north + (second.north - first.north) * fraction;
        const height = first.height + (second.height - first.height) * fraction - 1.4 * 4 * fraction * (1 - fraction);
        deficit = Math.max(deficit, worldGroundZ(east, north) + 6.5 - height);
      }
      if (deficit > 0) { first.height += deficit; second.height += deficit; }
    }
    for (const support of supports) {
      if (support.terminal) {
        box(lift.id + '-terminal', [support.east, support.north, support.groundHeight + 5], [17, 7.5, 3.3], dark, true, yaw);
        box('terminal-white-valance', [support.east, support.north, support.groundHeight + 3.7], [17.1, 7.6, .65], enamel, false, yaw);
        if(lift.id==='siberia-express'){
          const nameplate=new THREE.Mesh(new THREE.PlaneGeometry(10,.8),new THREE.MeshStandardMaterial({map:signTexture(THREE,'SIBERIA EXPRESS'),side:THREE.DoubleSide}));
          nameplate.rotation.set(Math.PI/2,0,yaw);nameplate.position.set(support.east+side.x*3.82,support.north+side.y*3.82,support.groundHeight+4.3);scene.add(nameplate);
        }
        for (const offset of [-5, 5]) box('terminal-support', [support.east + delta.x * offset, support.north + delta.y * offset, support.groundHeight + 2.5], [0.65, 0.65, 5], steel);
      } else {
        const height = support.height - support.groundHeight;
        box('lift-tower', [support.east, support.north, support.groundHeight + height / 2], [0.65, 0.65, height], steel);
        box('tower-crossarm', [support.east, support.north, support.height], [0.45, 8, 0.45], steel, false, yaw);
        for (const direction of [-1, 1]) box('sheave-bank', [support.east + side.x * direction * 3, support.north + side.y * direction * 3, support.height], [3.2, 0.25, 0.35], steel, false, yaw);
      }
    }
    function cablePoint(progress, direction) {
      const position = Math.max(0, Math.min(supports.length - 1.000001, progress * (supports.length - 1)));
      const index = Math.floor(position), fraction = position - index;
      const first = supports[index], second = supports[index + 1];
      return new THREE.Vector3(first.east + (second.east - first.east) * fraction + side.x * direction * 3, first.north + (second.north - first.north) * fraction + side.y * direction * 3, first.height + (second.height - first.height) * fraction - 1.4 * 4 * fraction * (1 - fraction));
    }
    for (const direction of [-1, 1]) {
      const points = Array.from({ length: 361 }, (_, index) => cablePoint(index / 360, direction));
      const curve = new THREE.CatmullRomCurve3(points);
      const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 720, 0.045, 4, false), dark);
      cable.name = lift.id + '-haul-cable'; scene.add(cable);
      const count = Math.floor(length * (1 - start) / lift.chairSpacing);
      const seatGeo = new THREE.BoxGeometry(3.3, 0.65, 0.18);
      const seats = new THREE.InstancedMesh(seatGeo, dark, count);
      const backs = new THREE.InstancedMesh(new THREE.BoxGeometry(3.3, 0.10, 0.70), steel, count);
      const hangers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.07, 2.5), steel, count);
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw + Math.PI / 2);
      function animate(time) {
        for (let index = 0; index < count; index++) {
          const fraction = ((index / count + direction * time * lift.speed / (length * (1 - start))) % 1 + 1) % 1;
          const point = cablePoint(fraction, direction);
          matrix.compose(new THREE.Vector3(point.x, point.y, point.z - 2.8), rotation, new THREE.Vector3(1, 1, 1)); seats.setMatrixAt(index, matrix);
          matrix.setPosition(point.x + delta.x * .3, point.y + delta.y * .3, point.z - 2.45); backs.setMatrixAt(index, matrix);
          matrix.setPosition(point.x, point.y, point.z - 1.25); hangers.setMatrixAt(index, matrix);
        }
        seats.instanceMatrix.needsUpdate = true; backs.instanceMatrix.needsUpdate = true; hangers.instanceMatrix.needsUpdate = true;
      }
      animate(0); chairUpdates.push(animate); scene.add(seats, backs, hangers);
    }
    if (!lift.topOnly) {
      const load = [base[0] + side.x * 15, base[1] + side.y * 15];
      const unload = [top[0] - delta.x * 23, top[1] - delta.y * 23];
      lifts.push({ id: lift.id, name: lift.name, radius: 5, speed: lift.speed, chairSpacing: lift.chairSpacing, base: [...load, worldGroundZ(...load)], top: [...unload, worldGroundZ(...unload)] });
    }
  }
  for (const run of RUNS.filter(run => run.sign)) {
    const point = run.pts[0];
    const east = point[0] + 8, north = point[1] + 3;
    const height = worldGroundZ(east, north);
    box('trail-sign-post', [east, north, height + 1.2], [0.14, 0.14, 2.4], timber);
    box('trail-sign-' + run.id, [east, north, height + 2.2], [1.3, 0.08, 0.42], /Sun Bowl/.test(run.name) ? red : dark, false);
  }
  box('Gold-Coast-Funitel-top', [102.7, 599.5, worldGroundZ(102.7, 599.5) + 5], [28, 16, 10], dark, true);
  addDetails(THREE,scene,box,{timber,dark,red,steel},worldGroundZ,{trackExclusionBounds:terrainPatch?.regions.map(region=>region.outerBounds)??[]});
  const trees = canonicalTrees();
  addConifers(THREE, scene, trees);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(.18, .28, 1, 5).rotateX(Math.PI / 2), treeBarkMaterial(THREE), trees.length);
  trunks.customDepthMaterial = treeBarkDepthMaterial(THREE);
  trunks.castShadow = true;
  const matrix = new THREE.Matrix4();
  let treeIndex = 0;
  for (const tree of trees) {
    matrix.makeScale(1, 1, tree.size); matrix.setPosition(tree.east, tree.north, tree.height + tree.size / 2); trunks.setMatrixAt(treeIndex, matrix);
    treeIndex++;
  }
  trunks.name = 'tree-trunks';
  scene.add(trunks); colliders.push(trunks);
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(boxGeometry, batch.material, batch.items.length);
    batch.items.forEach((item, index) => mesh.setMatrixAt(index, item.matrix));
    mesh.name = batch.collidable ? 'structures-and-posts' : 'structure-detail'; mesh.castShadow = true;
    scene.add(mesh); if (batch.collidable) colliders.push(mesh);
  }
  scene.updateMatrixWorld(true);
  let triangles = 0, draws = 0, collidableTriangles = 0;
  scene.traverse(object => { if (object.isMesh) { const count = (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1); triangles += count; draws++; } });
  for (const mesh of colliders) collidableTriangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
  if (alpinePolish && opts.nearSnowRelief !== false) {
    const nearSnowRelief = addNearSnowRelief(THREE, scene, { groundZ: worldGroundZ, groomed: !!groomedRun });
    applySnowSurface(THREE, nearSnowRelief.mesh.material, { alpinePolish: true });
    const reliefTracks = applySnowTracks(THREE, nearSnowRelief.mesh.material, { mask: '1.0' });
    if (typeof window !== 'undefined') installSnowTrackBridge(reliefTracks, window);
    scene.userData.nearSnowRelief = nearSnowRelief;
    scene.userData.dynamicSnowBudget = { maximumTriangles: nearSnowRelief.budget.maximumTriangles, addedDrawCalls: 1, trackSamplesPerFragment: 1, trackTargetBytes: 1048576 };
  }
  const spawnEast = -320, spawnNorth = -40;
return { scene, up: 'z', gear: 'skis', spawn: { position: [spawnEast, spawnNorth, worldGroundZ(spawnEast, spawnNorth) + .3], lookAt: [-240, -310, 315], eyeHeight: 0 }, colliders, lifts, liftLines: LIFTS, runs: RUNS, markers: [], terrainHeight: worldGroundZ, groundZ: worldGroundZ, update: time => chairUpdates.forEach(update => update(time)), report: { frame: FRAME, stats: { triangles, drawCalls: draws, collidableTriangles, trees: trees.length }, alpinePolish: alpinePolish ? { enabled: true, snowSurface: { ...snowSurface.budget }, lighting: { sunIntensity: sun.intensity, hemisphereIntensity: ambient.intensity }, shadows: { mapSize: sun.shadow.mapSize.x, extentM: shadowExtent, texelM: 2 * shadowExtent / sun.shadow.mapSize.x } } : { enabled: false }, groomedRun: groomedRun ?? { enabled: false }, snowBanks: terrainPatch ? { enabled: true, ...structuredClone(terrainPatch.stats) } : { enabled: false }, snowRelief: opts.snowRelief === true ? activeTerrain.snowRelief : { enabled: false, rollback: 'Original canonical heights and collider transforms' }, day: '2026-02-27 winter reconstruction; blue-sky lighting assumption', notes: ['DEM-derived cliff envelope; photographic microgeometry not yet reconstructed', 'Tree positions classified from 2025-10-21 imagery; height and species shapes inferred', 'Headwall top-only landmark; no invented load terminal'] } };
}
