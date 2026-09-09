const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function setting(value, fallback, minimum, maximum, name) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`Invalid drape ${name}`);
  }
  return result;
}

function limitVector(values, offset, maximum) {
  const length = Math.hypot(values[offset], values[offset + 1], values[offset + 2]);
  if (length > maximum) {
    const scale = maximum / length;
    for (let axis = 0; axis < 3; axis++) values[offset + axis] *= scale;
  }
}

export function createDrapeSolver(config = {}) {
  const definitions = config.nodes ?? [];
  if (!Array.isArray(definitions) || definitions.length > 256) throw new RangeError('Invalid drape nodes');
  const nodes = definitions.map((node) => ({
    stiffness: setting(node?.stiffness, 180, 0, 2000, 'stiffness'),
    damping: setting(node?.damping, 18, 0, 120, 'damping'),
    maxOffset: setting(node?.maxOffset, 0.1, 0, 2, 'maxOffset'),
  }));
  const edges = (config.edges ?? []).map((edge) => {
    if (!Number.isInteger(edge.a) || !Number.isInteger(edge.b) || edge.a < 0 || edge.b < 0
      || edge.a >= nodes.length || edge.b >= nodes.length || edge.a === edge.b) {
      throw new RangeError('Invalid drape edge');
    }
    return { a: edge.a, b: edge.b, stiffness: setting(edge.stiffness, 40, 0, 1000, 'edge stiffness') };
  });
  const substep = setting(config.substep, 1 / 120, 1 / 1000, 1 / 60, 'substep');
  const maxSubsteps = setting(config.maxSubsteps, 32, 1, 256, 'maxSubsteps');
  if (!Number.isInteger(maxSubsteps)) throw new RangeError('Invalid drape maxSubsteps');
  const maxDt = setting(config.maxDt, 0.25, substep, 1, 'maxDt');
  const teleportDistance = setting(config.teleportDistance, 2, 0.01, 100, 'teleportDistance');
  const airDrag = setting(config.airDrag, 1.2, 0, 20, 'airDrag');
  const maxWind = setting(config.maxWind, 30, 0, 100, 'maxWind');
  const maxAcceleration = setting(config.maxAcceleration, 80, 1, 1000, 'maxAcceleration');
  const maxSpeed = setting(config.maxSpeed, 6, 0.01, 100, 'maxSpeed');
  const maxStretch = setting(config.maxStretch, 0.12, 0, 1, 'maxStretch');
  const projectionLimit = setting(config.projectionLimit, 0.01, 0, 0.1, 'projectionLimit');
  const gravity = config.gravity ?? [0, -9.81, 0];
  if (gravity.length !== 3 || !Array.from(gravity).every(Number.isFinite)) throw new RangeError('Invalid drape gravity');
  const gravityVector = Float64Array.from(gravity);
  limitVector(gravityVector, 0, maxAcceleration);
  const size = nodes.length * 3;
  const positions = new Float64Array(size);
  const offsets = new Float32Array(size);
  const displacement = new Float64Array(size);
  const velocity = new Float64Array(size);
  const previousTargets = new Float64Array(size);
  const targetVelocity = new Float64Array(size);
  const previousTargetVelocity = new Float64Array(size);
  const targetAcceleration = new Float64Array(size);
  const anchors = new Float64Array(size);
  const forces = new Float64Array(size);
  const beforeProjection = new Float64Array(size);
  const wind = new Float64Array(3);
  const stats = { nodeCount: nodes.length, edgeCount: edges.length, substep, substeps: 0,
    lastSubsteps: 0, simulatedTime: 0, resets: 0, invalidInputs: 0, unresolvedCollisions: 0,
    lastResetReason: null };
  let initialized = false;
  let hasTargetVelocity = false;
  let accumulator = 0;

  function validTargets(targets) {
    return targets != null && targets.length === size
      && Array.from(targets).every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9);
  }

  function publish(targets) {
    for (let index = 0; index < size; index++) {
      offsets[index] = displacement[index];
      positions[index] = targets[index] + displacement[index];
    }
  }

  function resetTo(targets, reason) {
    displacement.fill(0);
    velocity.fill(0);
    previousTargetVelocity.fill(0);
    previousTargets.set(targets);
    accumulator = 0;
    initialized = true;
    hasTargetVelocity = false;
    stats.resets++;
    stats.lastResetReason = reason;
    stats.lastSubsteps = 0;
    stats.unresolvedCollisions = 0;
    publish(targets);
  }

  function reset(targets) {
    if (!validTargets(targets)) {
      stats.invalidInputs++;
      resetTo(previousTargets, 'invalid-targets');
    } else resetTo(targets, 'explicit');
    return api;
  }

  function project(colliders) {
    for (let iteration = 0; iteration < 3; iteration++) {
      for (const edge of edges) {
        const first = edge.a * 3, second = edge.b * 3;
        const delta = [0, 1, 2].map((axis) => anchors[second + axis] + displacement[second + axis]
          - anchors[first + axis] - displacement[first + axis]);
        const distance = Math.hypot(...delta);
        const rest = Math.hypot(...[0, 1, 2].map((axis) => anchors[second + axis] - anchors[first + axis]));
        const excess = distance - (rest * (1 + maxStretch) + 0.001);
        if (excess > 0 && distance > 1e-12) {
          const correction = Math.min(projectionLimit, excess / 2) / distance;
          for (let axis = 0; axis < 3; axis++) {
            displacement[first + axis] += delta[axis] * correction;
            displacement[second + axis] -= delta[axis] * correction;
          }
        }
      }
      for (let node = 0; node < nodes.length; node++) {
        const offset = node * 3, maximum = nodes[node].maxOffset;
        limitVector(displacement, offset, maximum);
        for (const sphere of colliders) {
          const radial = [0, 1, 2].map((axis) => anchors[offset + axis] + displacement[offset + axis] - sphere.center[axis]);
          const distance = Math.hypot(...radial);
          if (distance >= sphere.radius) continue;
          const fromCenter = [0, 1, 2].map((axis) => anchors[offset + axis] - sphere.center[axis]);
          const anchorDistance = Math.hypot(...fromCenter);
          const direction = distance > 1e-12 ? radial.map((value) => value / distance)
            : anchorDistance > 1e-12 ? fromCenter.map((value) => value / anchorDistance) : [0, 1, 0];
          const candidate = direction.map((value, axis) => sphere.center[axis] + value * (sphere.radius + 1e-7) - anchors[offset + axis]);
          if (Math.hypot(...candidate) <= maximum) displacement.set(candidate, offset);
          else {
            const outward = anchorDistance > 1e-12 ? fromCenter.map((value) => value / anchorDistance) : direction;
            const amount = Math.min(maximum, Math.max(0, sphere.radius - anchorDistance) + 1e-7);
            for (let axis = 0; axis < 3; axis++) displacement[offset + axis] = outward[axis] * amount;
          }
        }
        limitVector(displacement, offset, maximum);
      }
    }
  }

  function step(dt, targets, options = {}) {
    stats.lastSubsteps = 0;
    if (!validTargets(targets)) {
      stats.invalidInputs++;
      resetTo(previousTargets, 'invalid-targets');
      return offsets;
    }
    if (!initialized) resetTo(targets, 'initial');
    if (options.enabled === false) {
      resetTo(targets, 'disabled');
      return offsets;
    }
    if (!Number.isFinite(dt) || dt < 0) {
      stats.invalidInputs++;
      resetTo(targets, 'invalid-dt');
      return offsets;
    }
    if (dt > maxDt || dt + accumulator > substep * maxSubsteps + 1e-10) {
      resetTo(targets, 'large-dt');
      return offsets;
    }
    const inputWind = options.wind ?? [0, 0, 0];
    const colliders = options.colliders ?? [];
    if (inputWind.length !== 3 || !Array.from(inputWind).every(Number.isFinite) || !Array.isArray(colliders)
      || colliders.length > 64 || colliders.some((sphere) => !sphere || !sphere.center || sphere.center.length !== 3
        || !Array.from(sphere.center).every((value) => Number.isFinite(value) && Math.abs(value) <= 1e9)
        || !Number.isFinite(sphere.radius) || sphere.radius < 0 || sphere.radius > 100)) {
      stats.invalidInputs++;
      resetTo(targets, 'invalid-forces');
      return offsets;
    }
    for (let node = 0; node < nodes.length; node++) {
      const offset = node * 3;
      if (Math.hypot(...[0, 1, 2].map((axis) => targets[offset + axis] - previousTargets[offset + axis])) > teleportDistance) {
        resetTo(targets, 'teleport');
        return offsets;
      }
    }
    if (dt === 0) { publish(targets); return offsets; }
    wind.set(inputWind);
    limitVector(wind, 0, maxWind);
    const derivativeDt = Math.max(dt, 1e-6);
    for (let index = 0; index < size; index++) {
      targetVelocity[index] = (targets[index] - previousTargets[index]) / derivativeDt;
    }
    for (let node = 0; node < nodes.length; node++) {
      limitVector(targetVelocity, node * 3, 100);
    }
    for (let index = 0; index < size; index++) {
      targetAcceleration[index] = hasTargetVelocity ? (targetVelocity[index] - previousTargetVelocity[index]) / derivativeDt : 0;
    }
    for (let node = 0; node < nodes.length; node++) {
      limitVector(targetAcceleration, node * 3, maxAcceleration);
    }
    const remainder = accumulator;
    accumulator += dt;
    const count = Math.min(maxSubsteps, Math.floor((accumulator + 1e-10) / substep));
    for (let tick = 0; tick < count; tick++) {
      const fraction = clamp(((tick + 1) * substep - remainder) / dt, 0, 1);
      for (let index = 0; index < size; index++) anchors[index] = previousTargets[index] + (targets[index] - previousTargets[index]) * fraction;
      for (let node = 0; node < nodes.length; node++) {
        for (let axis = 0; axis < 3; axis++) {
          const index = node * 3 + axis;
          forces[index] = -nodes[node].stiffness * displacement[index] - targetAcceleration[index] + gravityVector[axis]
            + airDrag * (wind[axis] - targetVelocity[index] - velocity[index]);
        }
      }
      for (const edge of edges) {
        const first = edge.a * 3, second = edge.b * 3;
        const delta = [0, 1, 2].map((axis) => anchors[second + axis] + displacement[second + axis] - anchors[first + axis] - displacement[first + axis]);
        const distance = Math.hypot(...delta);
        if (distance < 1e-12) continue;
        const rest = Math.hypot(...[0, 1, 2].map((axis) => anchors[second + axis] - anchors[first + axis]));
        const strength = edge.stiffness * (distance - rest) / distance;
        for (let axis = 0; axis < 3; axis++) {
          forces[first + axis] += delta[axis] * strength;
          forces[second + axis] -= delta[axis] * strength;
        }
      }
      for (let node = 0; node < nodes.length; node++) {
        const offset = node * 3;
        limitVector(forces, offset, maxAcceleration);
        for (let axis = 0; axis < 3; axis++) velocity[offset + axis] = (velocity[offset + axis] + forces[offset + axis] * substep) * Math.exp(-nodes[node].damping * substep);
        limitVector(velocity, offset, maxSpeed);
        for (let axis = 0; axis < 3; axis++) displacement[offset + axis] += velocity[offset + axis] * substep;
      }
      beforeProjection.set(displacement);
      project(colliders);
      for (let index = 0; index < size; index++) velocity[index] += (displacement[index] - beforeProjection[index]) / substep;
      for (let node = 0; node < nodes.length; node++) limitVector(velocity, node * 3, maxSpeed);
      stats.substeps++;
      stats.simulatedTime += substep;
    }
    accumulator = Math.max(0, accumulator - count * substep);
    stats.lastSubsteps = count;
    previousTargets.set(targets);
    previousTargetVelocity.set(targetVelocity);
    hasTargetVelocity = true;
    publish(targets);
    stats.unresolvedCollisions = 0;
    for (let node = 0; node < nodes.length; node++) {
      for (const sphere of colliders) {
        if (Math.hypot(...[0, 1, 2].map((axis) => positions[node * 3 + axis] - sphere.center[axis])) < sphere.radius - 1e-6) stats.unresolvedCollisions++;
      }
    }
    return offsets;
  }

  const api = { step, reset, offsets, positions, stats };
  return api;
}
