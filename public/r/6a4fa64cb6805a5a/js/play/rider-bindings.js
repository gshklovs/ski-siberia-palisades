export const POLISHED_RIDER_LIFT = 0.054;

export function createBootAttachment(THREE, rig, skis, unitScale) {
  const anchors = skis.map((ski, index) => {
    const bone = rig.bone(`rider:ankle-${index ? 'r' : 'l'}`);
    const boneIndex = rig.skeleton.bones.indexOf(bone);
    const bind = rig.skeleton.boneInverses[boneIndex].clone().invert();
    return { ski, bone, bind, offset: new THREE.Matrix4().makeTranslation((index ? -0.148 : 0.148) * unitScale, 0.034 * unitScale, 0),
      position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
      targetPosition: new THREE.Vector3(), targetQuaternion: new THREE.Quaternion(), targetScale: new THREE.Vector3() };
  });
  const matrix = new THREE.Matrix4(), parentInverse = new THREE.Matrix4();
  let applied = false;
  return {
    restore() {
      if (!applied) return;
      for (const anchor of anchors) {
        anchor.bone.position.copy(anchor.position);
        anchor.bone.quaternion.copy(anchor.quaternion);
        anchor.bone.scale.copy(anchor.scale);
      }
      applied = false;
    },
    update(weight) {
      const blend = Math.min(1, Math.max(0, Number(weight) || 0));
      if (blend === 0) return;
      for (const anchor of anchors) {
        const { bone, ski } = anchor;
        anchor.position.copy(bone.position);
        anchor.quaternion.copy(bone.quaternion);
        anchor.scale.copy(bone.scale);
        ski.updateWorldMatrix(true, false);
        bone.parent.updateWorldMatrix(true, false);
        parentInverse.copy(bone.parent.matrixWorld).invert();
        matrix.multiplyMatrices(parentInverse, ski.matrixWorld).multiply(anchor.offset).multiply(anchor.bind);
        matrix.decompose(anchor.targetPosition, anchor.targetQuaternion, anchor.targetScale);
        bone.position.copy(anchor.position).lerp(anchor.targetPosition, blend);
        bone.quaternion.copy(anchor.quaternion).slerp(anchor.targetQuaternion, blend);
        bone.scale.copy(anchor.scale).lerp(anchor.targetScale, blend);
        bone.updateWorldMatrix(false, true);
      }
      rig.skeleton.update();
      applied = true;
    },
  };
}

export function fitRiderBindings(THREE, ski, unitScale) {
  const binding = ski.children.find(child => child.geometry?.parameters?.depth === 0.32 * unitScale);
  if (!binding) throw new Error('Expected ski binding mount');
  const originalGeometry = binding.geometry;
  binding.geometry = new THREE.BoxGeometry(0.095 * unitScale, 0.016 * unitScale, 0.35 * unitScale);
  binding.position.set(0, 0.023 * unitScale, -0.082 * unitScale);
  binding.name = 'rider:binding-plate';
  originalGeometry.dispose();
  const positions = [], normals = [], indices = [];
  for (const [width, height, depth, horizontal, vertical, longitudinal] of [
    [0.15, 0.035, 0.028, 0, 0.047, -0.276],
    [0.12, 0.044, 0.035, 0, 0.051, 0.104],
    [0.018, 0.023, 0.07, -0.079, 0.042, -0.24],
    [0.018, 0.023, 0.07, 0.079, 0.042, -0.24],
  ]) {
    const box = new THREE.BoxGeometry(width * unitScale, height * unitScale, depth * unitScale);
    box.translate(horizontal * unitScale, vertical * unitScale, longitudinal * unitScale);
    const offset = positions.length / 3;
    positions.push(...box.attributes.position.array);
    normals.push(...box.attributes.normal.array);
    indices.push(...Array.from(box.index.array, index => index + offset));
    box.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  const clamps = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x697581, metalness: 0.45, roughness: 0.4 }));
  clamps.name = 'rider:binding-retainers';
  clamps.castShadow = true;
  ski.add(clamps);
}
