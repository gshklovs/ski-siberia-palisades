export function createRiderStance(THREE, rig, unitScale) {
  const rows = [
    ['spine-1', -.055, 0], ['spine-2', -.035, 0], ['head', .04, 0],
    ['arm-l', 0, .045], ['arm-r', 0, -.045],
    ['forearm-l', .065, 0], ['forearm-r', .065, 0],
    ['pole-l', -.04, 0], ['pole-r', -.04, 0],
    ['leg-u-l', .10, 0], ['leg-u-r', .10, 0],
    ['leg-l-l', -.20, 0], ['leg-l-r', -.20, 0],
  ].map(([name, pitch, roll]) => ({ bone: rig.bone(`rider:${name}`), pitch, roll, original: new THREE.Quaternion() })).filter(row => row.bone);
  const hips = rig.bone('rider:hips'), hipPosition = new THREE.Vector3();
  const pitchAxis = new THREE.Vector3(1, 0, 0), rollAxis = new THREE.Vector3(0, 0, 1), rotation = new THREE.Quaternion();
  let applied = false;
  const state = { enabled: true, weight: 0 };
  return {
    state,
    restore() {
      if (!applied) return;
      for (const row of rows) row.bone.quaternion.copy(row.original);
      if (hips) hips.position.copy(hipPosition);
      applied = false;
    },
    update(dt, ctrl, camera, tumble, options = {}) {
      const riding = state.enabled && ctrl?.mode === 'skis' && ctrl.grounded && !options.mount;
      const crouch = Math.max(0, Math.min(1, camera?.state?.crouch || 0));
      const target = riding ? 1 - .65 * crouch : 0;
      if (Number.isFinite(dt) && dt > 0) state.weight += (target - state.weight) * (1 - Math.exp(-12 * Math.min(dt, .25)));
      if (!state.enabled || options.mount || ctrl?.mode !== 'skis') state.weight = 0;
      const weight = state.weight * (1 - Math.max(0, Math.min(1, tumble?.auth || 0)));
      if (weight < 1e-6) return;
      for (const row of rows) {
        row.original.copy(row.bone.quaternion);
        row.bone.quaternion.multiply(rotation.setFromAxisAngle(pitchAxis, row.pitch * weight));
        row.bone.quaternion.multiply(rotation.setFromAxisAngle(rollAxis, row.roll * weight));
      }
      if (hips) {
        hipPosition.copy(hips.position);
        hips.position.y -= .012 * unitScale * weight;
        hips.position.z -= .015 * unitScale * weight;
      }
      applied = true;
    },
  };
}
