import { createDrapeSolver } from './rider-drape-solver.js';

export const DRAPE_NODES = 15;
const HEM_NODES = 12;
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const amount = clamp(value); return amount * amount * (3 - 2 * amount); };

function armInfluence(part, vertex) {
  if (!part.bones) return /arm|wrist|glove/.test(part.bone ?? '') ? 1 : 0;
  let amount = 0;
  for (let slot = 0; slot < 4; slot++) {
    if (/arm|wrist|glove/.test(part.bones[part.boneIndices[vertex * 4 + slot]])) amount += part.boneWeights[vertex * 4 + slot];
  }
  return amount;
}

export function createDrapeLayout(parts) {
  let hem = Infinity, hoodBottom = Infinity, hoodTop = -Infinity;
  for (const part of parts) {
    for (let vertex = 0; vertex < part.positions.length / 3; vertex++) {
      const height = part.positions[vertex * 3 + 1];
      if (part.name.includes('connected-jacket') && armInfluence(part, vertex) < 0.1) hem = Math.min(hem, height);
      if (part.name.includes('folded-hood')) { hoodBottom = Math.min(hoodBottom, height); hoodTop = Math.max(hoodTop, height); }
    }
  }
  if (![hem, hoodBottom, hoodTop].every(Number.isFinite)) throw new Error('Drape requires jacket and hood geometry');
  return {
    hem, hoodBottom, hoodTop,
    encode(part, vertex) {
      const offset = vertex * 3;
      const horizontal = part.positions[offset], height = part.positions[offset + 1], depth = part.positions[offset + 2];
      if (/folded-hood|hood-center-seam/.test(part.name)) {
        const across = clamp((horizontal + 0.13) / 0.26) * 2;
        const lower = Math.min(1, Math.floor(across));
        const weight = 1 - smooth((height - hoodBottom) / Math.max(0.08, hoodTop - hoodBottom - 0.045));
        return [HEM_NODES + lower, HEM_NODES + lower + 1, across - lower, weight];
      }
      if (!/connected-jacket|front-zip|hand-pocket|chest-pocket/.test(part.name)) return [0, 0, 0, 0];
      const weight = (1 - smooth((height - hem) / 0.22)) * (1 - smooth(armInfluence(part, vertex) / 0.2));
      const angle = (Math.atan2(depth / 0.16, horizontal / 0.25) + Math.PI * 2) % (Math.PI * 2);
      const around = angle / (Math.PI * 2) * HEM_NODES;
      const lower = Math.floor(around) % HEM_NODES;
      return [lower, (lower + 1) % HEM_NODES, around - Math.floor(around), weight];
    },
  };
}

export function applyDrapeShader(material, uniforms, surface = true) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 drapeBinding;
uniform vec3 riderDrapeOffsets[${DRAPE_NODES}];
varying vec3 vDrapeViewOffset;`);
    shader.vertexShader = shader.vertexShader.replace('#include <skinning_vertex>', `#include <skinning_vertex>
vec3 drapeOffset = mix(riderDrapeOffsets[int(drapeBinding.x)], riderDrapeOffsets[int(drapeBinding.y)], drapeBinding.z) * drapeBinding.w;
transformed += drapeOffset;
vDrapeViewOffset = (modelViewMatrix * vec4(drapeOffset, 0.0)).xyz;`);
    if (surface) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vDrapeViewOffset;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 drapeBasePosition = -vViewPosition - vDrapeViewOffset;
vec3 drapeBaseCross = cross(dFdx(drapeBasePosition), dFdy(drapeBasePosition));
vec3 drapeMovedCross = cross(dFdx(-vViewPosition), dFdy(-vViewPosition));
if (dot(drapeBaseCross, drapeBaseCross) > 1e-20 && dot(drapeMovedCross, drapeMovedCross) > 1e-20) {
  vec3 drapeBaseNormal = normalize(drapeBaseCross);
  vec3 drapeMovedNormal = normalize(drapeMovedCross);
  vec3 drapeRotation = cross(drapeBaseNormal, drapeMovedNormal);
  float drapeCosine = max(dot(drapeBaseNormal, drapeMovedNormal), -0.99);
  normal = normalize(normal + cross(drapeRotation, normal) + cross(drapeRotation, cross(drapeRotation, normal)) / (1.0 + drapeCosine));
}`);
    }
  };
  material.customProgramCacheKey = () => `${key}|rider-drape-v1-${surface ? 'surface' : 'shadow'}`;
  material.needsUpdate = true;
}

export function createRiderDrape(THREE, body, materials, unitScale = 1) {
  const binding = body.geometry.getAttribute('drapeBinding');
  const controlVertices = new Int32Array(DRAPE_NODES).fill(-1);
  const scores = new Float64Array(DRAPE_NODES).fill(Infinity);
  let activeVertices = 0;
  for (let vertex = 0; vertex < binding.count; vertex++) {
    const weight = binding.getW(vertex);
    if (weight <= 0) continue;
    activeVertices++;
    const lower = binding.getX(vertex), upper = binding.getY(vertex), blend = binding.getZ(vertex);
    for (const [node, distance] of [[lower, blend], [upper, 1 - blend]]) {
      const score = (1 - weight) + distance * 0.4;
      if (score < scores[node]) { scores[node] = score; controlVertices[node] = vertex; }
    }
  }
  if (controlVertices.some(vertex => vertex < 0)) throw new Error('Incomplete drape control coverage');
  const nodes = Array.from({ length: DRAPE_NODES }, (_, index) => ({ stiffness: index < HEM_NODES ? 420 : 280, damping: index < HEM_NODES ? 22 : 18, maxOffset: index < HEM_NODES ? 0.04 : 0.055 }));
  const edges = Array.from({ length: HEM_NODES }, (_, index) => ({ a: index, b: (index + 1) % HEM_NODES }));
  edges.push({ a: 12, b: 13 }, { a: 13, b: 14 });
  const solver = createDrapeSolver({ nodes, edges, substep: 1 / 120 });
  const offsets = Array.from({ length: DRAPE_NODES }, () => new THREE.Vector3());
  const uniforms = { riderDrapeOffsets: { value: offsets } };
  for (const material of materials) applyDrapeShader(material, uniforms);
  body.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  body.customDistanceMaterial = new THREE.MeshDistanceMaterial();
  applyDrapeShader(body.customDepthMaterial, uniforms, false);
  applyDrapeShader(body.customDistanceMaterial, uniforms, false);
  const targets = new Float64Array(DRAPE_NODES * 3);
  const position = new THREE.Vector3(), inverseLinear = new THREE.Matrix3();
  const pelvis = body.skeleton.bones.find(bone => /rider:hips$/.test(bone.name));
  const neck = body.skeleton.bones.find(bone => /rider:neck$/.test(bone.name));
  const colliders = [{ center: [0, 0, 0], radius: 0.13 }, { center: [0, 0, 0], radius: 0.09 }];
  const bones = [pelvis, neck];
  const state = { enabled: true, wind: [0, 0, 0], nodes: DRAPE_NODES, activeVertices, maxDisplacementM: 0, updates: 0, solver: solver.stats };
  function update(dt) {
    let targetsChanged = false;
    body.updateWorldMatrix(true, false);
    body.skeleton.update();
    for (let node = 0; node < DRAPE_NODES; node++) {
      body.getVertexPosition(controlVertices[node], position);
      body.localToWorld(position).divideScalar(unitScale);
      targetsChanged ||= Math.abs(position.x - targets[node * 3]) + Math.abs(position.y - targets[node * 3 + 1]) + Math.abs(position.z - targets[node * 3 + 2]) > 1e-8;
      position.toArray(targets, node * 3);
    }
    for (let index = 0; index < bones.length; index++) {
      if (bones[index]) bones[index].getWorldPosition(position).divideScalar(unitScale);
      else position.set(0, index ? 1.42 : 0.88, 0).applyMatrix4(body.matrixWorld).divideScalar(unitScale);
      position.toArray(colliders[index].center);
    }
    if (dt === 0 && targetsChanged) solver.reset(targets);
    solver.step(dt, targets, { enabled: state.enabled, wind: state.wind, colliders });
    inverseLinear.setFromMatrix4(body.matrixWorld).invert();
    state.maxDisplacementM = 0;
    for (let node = 0; node < DRAPE_NODES; node++) {
      offsets[node].fromArray(solver.offsets, node * 3);
      state.maxDisplacementM = Math.max(state.maxDisplacementM, offsets[node].length());
      offsets[node].multiplyScalar(unitScale).applyMatrix3(inverseLinear);
    }
    if (dt !== 0) state.updates++;
  }
  const controller = {
    state, uniforms, update,
    setEnabled(enabled) { state.enabled = !!enabled; solver.reset(targets); for (const offset of offsets) offset.set(0, 0, 0); state.maxDisplacementM = 0; },
    setWind(horizontal, vertical, depth) { state.wind = [horizontal, vertical, depth].map(value => Number.isFinite(value) ? Math.max(-25, Math.min(25, value)) : 0); },
    dispose() { body.customDepthMaterial.dispose(); body.customDistanceMaterial.dispose(); },
  };
  body.userData.riderDrape = controller;
  update(0);
  return controller;
}
