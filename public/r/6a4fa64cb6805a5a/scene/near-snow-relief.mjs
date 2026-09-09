import { snowRegionAt } from './snow-regions.mjs';
import { sampleGroomedRun } from './groomed-run.mjs';

const CAPACITY = 384;
const TRIANGLES_PER_CLUMP = 40;
const RADIUS_M = 25;
const FADE_M = 10;
const CELL_M = 2;
const UPDATE_DISTANCE_M = 1.5;
const GROOMED_MARGIN_M = 1;
const SLOPE_STEP_M = .35;
const MAX_GRADIENT = .35;

function hash(column, row, salt = 0) {
  let value = Math.imul(column, 0x1f123bb5) ^ Math.imul(row, 0x5f356495) ^ Math.imul(salt, 0x6c8e9cf5);
  value = Math.imul(value ^ value >>> 15, 0x2c1b3c6d);
  return ((value ^ value >>> 12) >>> 0) / 4294967296;
}

function smoothstep(edge0, edge1, value) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

function inGroomedCorridor(east, north) {
  if (sampleGroomedRun(east, north)) return true;
  return sampleGroomedRun(east + GROOMED_MARGIN_M, north)
    || sampleGroomedRun(east - GROOMED_MARGIN_M, north)
    || sampleGroomedRun(east, north + GROOMED_MARGIN_M)
    || sampleGroomedRun(east, north - GROOMED_MARGIN_M);
}

function domeGeometry(THREE) {
  const sectors = 8;
  const rings = 3;
  const positions = [0, 0, 1];
  const normals = [0, 0, 1];
  const indices = [];
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring / rings;
    const height = (1 - radius * radius) ** 2;
    for (let sector = 0; sector < sectors; sector++) {
      const angle = sector / sectors * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      positions.push(x, y, height);
      const normal = new THREE.Vector3(4 * x * (1 - radius * radius), 4 * y * (1 - radius * radius), 1).normalize();
      normals.push(normal.x, normal.y, normal.z);
    }
  }
  for (let sector = 0; sector < sectors; sector++) indices.push(0, 1 + sector, 1 + (sector + 1) % sectors);
  for (let ring = 1; ring < rings; ring++) {
    const inner = 1 + (ring - 1) * sectors;
    const outer = inner + sectors;
    for (let sector = 0; sector < sectors; sector++) {
      const next = (sector + 1) % sectors;
      indices.push(inner + sector, outer + sector, outer + next, inner + sector, outer + next, inner + next);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function addNearSnowRelief(THREE, root, { groundZ, enabled = true, groomed = true, material } = {}) {
  if (typeof groundZ !== 'function') throw new TypeError('Near snow relief requires groundZ(east, north)');
  const geometry = domeGeometry(THREE);
  const sharedMaterial = material ?? new THREE.MeshStandardMaterial({ color: 0xf1f3f4, roughness: .91, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, sharedMaterial, CAPACITY);
  mesh.name = 'near-snow-relief';
  mesh.count = 0;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(mesh);

  const budget = {
    sharedMaterials: 1,
    triangles: CAPACITY * TRIANGLES_PER_CLUMP,
    draws: 1,
    capacity: CAPACITY,
    trianglesPerClump: TRIANGLES_PER_CLUMP,
    maximumTriangles: CAPACITY * TRIANGLES_PER_CLUMP,
    drawCalls: 1,
    radiusM: RADIUS_M,
    fadeM: FADE_M,
    updateDistanceM: UPDATE_DISTANCE_M,
    count: 0,
    candidates: 0,
    rejectedRegion: 0,
    rejectedGroomed: 0,
    rejectedSlope: 0,
    minimumFade: 1,
    maximumFade: 0,
    updates: 0
  };
  const inverse = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3();
  const previousPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 0, 1);

  function update(camera) {
    if (!enabled || !camera) {
      if (mesh.count) { mesh.count = 0; mesh.instanceMatrix.needsUpdate = true; }
      budget.count = 0;
      return false;
    }
    mesh.updateWorldMatrix(true, false);
    inverse.copy(mesh.parent?.matrixWorld ?? mesh.matrixWorld).invert();
    camera.getWorldPosition(cameraPosition).applyMatrix4(inverse);
    if (cameraPosition.distanceToSquared(previousPosition) < UPDATE_DISTANCE_M * UPDATE_DISTANCE_M) return false;
    previousPosition.copy(cameraPosition);
    Object.assign(budget, { count: 0, candidates: 0, rejectedRegion: 0, rejectedGroomed: 0, rejectedSlope: 0, minimumFade: 1, maximumFade: 0 });
    const centerColumn = Math.floor(cameraPosition.x / CELL_M);
    const centerRow = Math.floor(cameraPosition.y / CELL_M);
    const cellRadius = Math.ceil(RADIUS_M / CELL_M);
    let count = 0;
    for (let row = centerRow - cellRadius; row <= centerRow + cellRadius && count < CAPACITY; row++) {
      for (let column = centerColumn - cellRadius; column <= centerColumn + cellRadius && count < CAPACITY; column++) {
        const east = (column + .18 + hash(column, row, 1) * .64) * CELL_M;
        const north = (row + .18 + hash(column, row, 2) * .64) * CELL_M;
        const distance = Math.hypot(east - cameraPosition.x, north - cameraPosition.y);
        if (distance >= RADIUS_M) continue;
        budget.candidates++;
        if (snowRegionAt(east, north) <= .6) { budget.rejectedRegion++; continue; }
        if (groomed && inGroomedCorridor(east, north)) { budget.rejectedGroomed++; continue; }
        const height = groundZ(east, north);
        const eastGradient = (groundZ(east + SLOPE_STEP_M, north) - groundZ(east - SLOPE_STEP_M, north)) / (2 * SLOPE_STEP_M);
        const northGradient = (groundZ(east, north + SLOPE_STEP_M) - groundZ(east, north - SLOPE_STEP_M)) / (2 * SLOPE_STEP_M);
        if (![height, eastGradient, northGradient].every(Number.isFinite) || Math.hypot(eastGradient, northGradient) >= MAX_GRADIENT) { budget.rejectedSlope++; continue; }
        const fade = 1 - smoothstep(RADIUS_M - FADE_M, RADIUS_M, distance);
        const radius = (.12 + hash(column, row, 3) * .23) * fade;
        const clumpHeight = (.02 + hash(column, row, 4) * .04) * fade;
        normal.set(-eastGradient, -northGradient, 1).normalize();
        rotation.setFromUnitVectors(up, normal);
        position.set(east, north, height - .001);
        scale.set(radius, radius * (.72 + hash(column, row, 5) * .24), clumpHeight);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(count++, matrix);
        budget.minimumFade = Math.min(budget.minimumFade, fade);
        budget.maximumFade = Math.max(budget.maximumFade, fade);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    budget.count = count;
    budget.updates++;
    return true;
  }

  mesh.onBeforeRender = (renderer, scene, camera) => update(camera);
  return { mesh, update, budget };
}
