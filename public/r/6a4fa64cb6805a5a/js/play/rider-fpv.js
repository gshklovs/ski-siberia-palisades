import * as DEFAULT_POLISH from './rider-polish-mesh.js';
import { applyRiderCloth as defaultApplyRiderCloth } from './rider-cloth.js';

const LIMB = /^rider:(shoulder|arm|forearm|wrist|glove)-([lr])$/;
const CONNECTED = /^polish-v7:connected-jacket:(shell|panel)$/;
const DETAIL = /^polish-v7:(cuff-closure|cuff-tab|glove)-[lr]$/;
const MATERIAL_ORDER = ['shell', 'panel', 'gear'];

function bindMatrices(THREE, skeleton, byName) {
  const matrices = new Map();
  if (skeleton?.bones?.length && skeleton.boneInverses?.length === skeleton.bones.length) {
    skeleton.bones.forEach((bone, index) => matrices.set(bone.name, skeleton.boneInverses[index].clone().invert()));
    return matrices;
  }
  for (const [name, bone] of Object.entries(byName ?? {})) matrices.set(name, bone.matrixWorld.clone());
  return matrices;
}

function targetName(sourceName, fpByName) {
  const match = LIMB.exec(sourceName);
  if (!match) return null;
  const name = `rider:fp-${match[1]}-${match[2]}`;
  return fpByName[name] ? name : null;
}

function influences(part, vertex, fpByName) {
  const weighted = Array.isArray(part.bones) && Array.isArray(part.boneIndices) && Array.isArray(part.boneWeights);
  const values = [];
  if (weighted) {
    const offset = vertex * 4;
    for (let slot = 0; slot < 4; slot++) {
      const source = part.bones[part.boneIndices[offset + slot]];
      const target = targetName(source, fpByName);
      const weight = part.boneWeights[offset + slot] ?? 0;
      if (target && weight > 0) values.push({ source, target, weight });
    }
  } else {
    const target = targetName(part.bone, fpByName);
    if (target) values.push({ source: part.bone, target, weight: 1 });
  }
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  return { coverage: total, values: total > 0 ? values.map(value => ({ ...value, weight: value.weight / total })) : [] };
}

function createMaterials(THREE, specs, scale, applyCloth) {
  return MATERIAL_ORDER.map((name) => {
    const source = specs[name];
    const material = new THREE.MeshPhysicalMaterial({
      color: source.color,
      metalness: source.metalness,
      roughness: source.roughness,
      clearcoat: source.clearcoat ?? 0,
      clearcoatRoughness: source.clearcoatRoughness ?? 0.45
    });
    return applyCloth(material, name, scale, THREE);
  });
}

export function buildRiderFpvGeometry(THREE, options = {}) {
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || !(scale > 0)) throw new Error('rider-fpv: scale must be finite and positive');
  const bodySkeleton = options.bodySkeleton;
  const fpSkeleton = options.fpSkeleton;
  const bodyByName = options.bodyByName ?? Object.fromEntries((bodySkeleton?.bones ?? []).map(bone => [bone.name, bone]));
  const fpByName = options.fpByName ?? Object.fromEntries((fpSkeleton?.bones ?? []).map(bone => [bone.name, bone]));
  if (!bodySkeleton || !fpSkeleton) throw new Error('rider-fpv: bodySkeleton and fpSkeleton are required');
  const parts = options.parts ?? DEFAULT_POLISH.PARTS;
  const materialSpecs = options.materialSpecs ?? DEFAULT_POLISH.MATERIALS;
  const sourceParts = parts.filter(part => CONNECTED.test(part.name) || DETAIL.test(part.name));
  const bodyBind = bindMatrices(THREE, bodySkeleton, bodyByName);
  const fpBind = bindMatrices(THREE, fpSkeleton, fpByName);
  const fpIndex = new Map(fpSkeleton.bones.map((bone, index) => [bone.name, index]));
  const transforms = new Map();
  const normalTransforms = new Map();
  const transformFor = (source, target) => {
    const key = `${source}>${target}`;
    if (!transforms.has(key)) {
      const sourceBind = bodyBind.get(source);
      const targetBind = fpBind.get(target);
      if (!sourceBind || !targetBind) throw new Error(`rider-fpv: missing bind transform ${key}`);
      const matrix = targetBind.clone().multiply(sourceBind.clone().invert());
      transforms.set(key, matrix);
      normalTransforms.set(key, new THREE.Matrix3().getNormalMatrix(matrix));
    }
    return [transforms.get(key), normalTransforms.get(key)];
  };
  const position = [], normal = [], skinIndex = [], skinWeight = [], index = [];
  const groups = [];
  let sourceTriangles = 0;
  const point = new THREE.Vector3(), mapped = new THREE.Vector3(), normalPoint = new THREE.Vector3(), mappedNormal = new THREE.Vector3();
  for (const materialName of MATERIAL_ORDER) {
    const start = index.length;
    for (const part of sourceParts) {
      if (part.material !== materialName) continue;
      const vertexCount = part.positions.length / 3;
      const vertexInfluences = Array.from({ length: vertexCount }, (_, vertex) => influences(part, vertex, fpByName));
      const chosen = [];
      for (let offset = 0; offset < part.indices.length; offset += 3) {
        const triangle = part.indices.slice(offset, offset + 3);
        const coverage = triangle.map(vertex => vertexInfluences[vertex].coverage);
        const include = DETAIL.test(part.name)
          ? coverage.every(value => value > 0)
          : Math.min(...coverage) >= 0.08 && coverage.reduce((sum, value) => sum + value, 0) / 3 >= 0.52;
        if (include) chosen.push(...triangle);
      }
      if (!chosen.length) continue;
      sourceTriangles += chosen.length / 3;
      const remap = new Map();
      for (const sourceVertex of chosen) {
        let targetVertex = remap.get(sourceVertex);
        if (targetVertex == null) {
          targetVertex = position.length / 3;
          remap.set(sourceVertex, targetVertex);
          const sourcePosition = point.fromArray(part.positions, sourceVertex * 3).multiplyScalar(scale);
          mapped.set(0, 0, 0);
          mappedNormal.set(0, 0, 0);
          const sourceNormal = normalPoint.fromArray(part.normals, sourceVertex * 3);
          const values = vertexInfluences[sourceVertex].values;
          for (const value of values) {
            const [matrix, normalMatrix] = transformFor(value.source, value.target);
            mapped.addScaledVector(sourcePosition.clone().applyMatrix4(matrix), value.weight);
            mappedNormal.addScaledVector(sourceNormal.clone().applyMatrix3(normalMatrix).normalize(), value.weight);
          }
          mappedNormal.normalize();
          position.push(mapped.x, mapped.y, mapped.z);
          normal.push(mappedNormal.x, mappedNormal.y, mappedNormal.z);
          const sorted = values.slice().sort((first, second) => second.weight - first.weight).slice(0, 4);
          while (sorted.length < 4) sorted.push({ target: fpSkeleton.bones[0].name, weight: 0 });
          skinIndex.push(...sorted.map(value => fpIndex.get(value.target) ?? 0));
          skinWeight.push(...sorted.map(value => value.weight));
        }
        index.push(targetVertex);
      }
    }
    if (index.length > start) groups.push({ start, count: index.length - start, materialIndex: MATERIAL_ORDER.indexOf(materialName) });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const materials = options.materials ?? createMaterials(THREE, materialSpecs, scale, options.applyCloth ?? defaultApplyRiderCloth);
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.name = 'play:fp-polished-arms';
  mesh.frustumCulled = false;
  mesh.bind(fpSkeleton, new THREE.Matrix4());
  const stats = {
    vertices: position.length / 3,
    triangles: index.length / 3,
    draws: groups.length,
    textures: 0,
    bones: new Set(skinIndex.filter((_, offset) => skinWeight[offset] > 0)).size,
    sourceTriangles
  };
  return { mesh, geometry, materials, stats, sourceParts: sourceParts.map(part => part.name) };
}
