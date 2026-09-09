import { MATERIALS, PARTS } from './rider-polish-mesh.js';

const SIDES = ['l', 'r'];
const BINDING_TOP = 0.085;
const SOLE_CLEARANCE = 0.0025;

function bootPart(side) {
  const part = PARTS.find(candidate => candidate.name === `polish-v7:boot-shell-${side}`);
  if (!part) throw new Error(`rider-fpv-boots: missing boot-shell-${side}`);
  return part;
}

function geometryFor(THREE, part, scale) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (let offset = 0; offset < part.positions.length; offset += 3) {
    minX = Math.min(minX, part.positions[offset]);
    maxX = Math.max(maxX, part.positions[offset]);
    minY = Math.min(minY, part.positions[offset + 1]);
  }
  const centerX = (minX + maxX) * 0.5;
  const soleY = (BINDING_TOP + SOLE_CLEARANCE) * scale;
  const positions = new Float32Array(part.positions.length);
  for (let offset = 0; offset < part.positions.length; offset += 3) {
    positions[offset] = (part.positions[offset] - centerX) * scale;
    positions[offset + 1] = (part.positions[offset + 1] - minY) * scale + soleY;
    positions[offset + 2] = part.positions[offset + 2] * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals.slice(), 3));
  geometry.setIndex(part.indices.slice());
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRiderFpvBoots(THREE, skiRoots, scale = 1) {
  if (!Array.isArray(skiRoots) || skiRoots.length !== 2 || skiRoots.some(root => !root?.add)) {
    throw new Error('rider-fpv-boots: skiRoots must contain left and right roots');
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('rider-fpv-boots: scale must be finite and positive');
  const spec = MATERIALS.gear;
  const material = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    metalness: spec.metalness,
    roughness: spec.roughness,
    clearcoat: spec.clearcoat ?? 0,
    clearcoatRoughness: spec.clearcoatRoughness ?? 0.45
  });
  material.name = 'rider:fp-boot-material';
  const boots = SIDES.map((side, index) => {
    const mesh = new THREE.Mesh(geometryFor(THREE, bootPart(side), scale), material);
    mesh.name = `rider:fp-boot-${side}`;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    skiRoots[index].add(mesh);
    return mesh;
  });
  const extents = boots.map(boot => ({
    min: boot.geometry.boundingBox.min.toArray(),
    max: boot.geometry.boundingBox.max.toArray()
  }));
  const stats = {
    vertices: boots.reduce((sum, boot) => sum + boot.geometry.getAttribute('position').count, 0),
    triangles: boots.reduce((sum, boot) => sum + boot.geometry.index.count / 3, 0),
    meshes: boots.length,
    draws: boots.length,
    materials: 1,
    textures: 0
  };
  return { boots, material, stats, extents };
}
