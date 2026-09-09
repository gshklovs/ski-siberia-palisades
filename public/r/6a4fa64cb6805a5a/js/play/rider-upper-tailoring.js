const UPPER_PART_NAMES = Object.freeze([
  'polish-v7:connected-jacket:shell',
  'polish-v7:connected-jacket:panel',
  'polish-v7:front-zip',
  'polish-v7:front-zip-tape',
  'polish-v7:front-zip-puller',
]);

const UPPER_PART_SET = new Set(UPPER_PART_NAMES);
const SHOULDER_MIN_X = 0.16;
const SHOULDER_MAX_X = 0.47;
const SHOULDER_MIN_Y = 1.28;
const SHOULDER_MAX_Y = 1.46;
const COLLAR_MAX_X = 0.17;
const COLLAR_MIN_Y = 1.385;
const COLLAR_MAX_Y = 1.49;
const COLLAR_FRONT_Z = -0.18;
const COLLAR_BACK_Z = 0.13;
const MAX_SHOULDER_DROP = 0.018;
const MAX_SHOULDER_ROUND = 0.004;
const MAX_COLLAR_DIP = 0.016;
const MAX_COLLAR_FORWARD = 0.004;
const JACOBIAN_STEP = 1e-5;

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function compactWeight(value, minimum, maximum) {
  if (value <= minimum || value >= maximum) return 0;
  const phase = (value - minimum) / (maximum - minimum);
  return Math.sin(Math.PI * phase) ** 2;
}

function smoothstep(minimum, maximum, value) {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const phase = (value - minimum) / (maximum - minimum);
  return phase * phase * (3 - 2 * phase);
}

function deformation(positionX, positionY, positionZ) {
  const absoluteX = Math.abs(positionX);
  const shoulderAcross = compactWeight(absoluteX, SHOULDER_MIN_X, SHOULDER_MAX_X);
  const shoulderHeight = compactWeight(positionY, SHOULDER_MIN_Y, SHOULDER_MAX_Y);
  const shoulder = shoulderAcross * shoulderHeight;

  const collarAcross = absoluteX >= COLLAR_MAX_X
    ? 0
    : Math.cos(Math.PI * absoluteX / (2 * COLLAR_MAX_X)) ** 2;
  const collarHeight = smoothstep(COLLAR_MIN_Y, 1.465, positionY);
  const collarFront = 1 - smoothstep(-0.10, 0.04, positionZ);
  const collar = collarAcross * collarHeight * collarFront;

  return [
    positionX - Math.sign(positionX) * MAX_SHOULDER_ROUND * shoulder,
    positionY - MAX_SHOULDER_DROP * shoulder - MAX_COLLAR_DIP * collar,
    positionZ - MAX_COLLAR_FORWARD * collar,
  ];
}

function numericalJacobian(positionX, positionY, positionZ) {
  const point = [positionX, positionY, positionZ];
  const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let axis = 0; axis < 3; axis++) {
    const low = point.slice();
    const high = point.slice();
    low[axis] -= JACOBIAN_STEP;
    high[axis] += JACOBIAN_STEP;
    const before = deformation(...low);
    const after = deformation(...high);
    for (let row = 0; row < 3; row++) matrix[row][axis] = (after[row] - before[row]) / (2 * JACOBIAN_STEP);
  }
  return matrix;
}

function transportNormal(normal, matrix) {
  const [matrix00, matrix01, matrix02] = matrix[0];
  const [matrix10, matrix11, matrix12] = matrix[1];
  const [matrix20, matrix21, matrix22] = matrix[2];
  const cofactor00 = matrix11 * matrix22 - matrix12 * matrix21;
  const cofactor01 = matrix12 * matrix20 - matrix10 * matrix22;
  const cofactor02 = matrix10 * matrix21 - matrix11 * matrix20;
  const cofactor10 = matrix02 * matrix21 - matrix01 * matrix22;
  const cofactor11 = matrix00 * matrix22 - matrix02 * matrix20;
  const cofactor12 = matrix01 * matrix20 - matrix00 * matrix21;
  const cofactor20 = matrix01 * matrix12 - matrix02 * matrix11;
  const cofactor21 = matrix02 * matrix10 - matrix00 * matrix12;
  const cofactor22 = matrix00 * matrix11 - matrix01 * matrix10;
  const normalX = cofactor00 * normal[0] + cofactor01 * normal[1] + cofactor02 * normal[2];
  const normalY = cofactor10 * normal[0] + cofactor11 * normal[1] + cofactor12 * normal[2];
  const normalZ = cofactor20 * normal[0] + cofactor21 * normal[1] + cofactor22 * normal[2];
  const length = Math.hypot(normalX, normalY, normalZ);
  return [normalX / length, normalY / length, normalZ / length];
}

export function tailorRiderUpperParts(parts) {
  return parts.map((source) => {
    const part = cloneValue(source);
    if (!UPPER_PART_SET.has(part.name)) return part;

    for (let offset = 0; offset < source.positions.length; offset += 3) {
      const point = source.positions.slice(offset, offset + 3);
      const result = deformation(...point);
      if (result[0] === point[0] && result[1] === point[1] && result[2] === point[2]) continue;
      part.positions.splice(offset, 3, ...result);
      part.normals.splice(offset, 3,
        ...transportNormal(source.normals.slice(offset, offset + 3), numericalJacobian(...point)));
    }
    return part;
  });
}

export const RIDER_UPPER_TAILORING_LIMITS = Object.freeze({
  partNames: UPPER_PART_NAMES,
  shoulderBand: Object.freeze({
    minimumAbsoluteX: SHOULDER_MIN_X,
    maximumAbsoluteX: SHOULDER_MAX_X,
    minimumY: SHOULDER_MIN_Y,
    maximumY: SHOULDER_MAX_Y,
  }),
  collarBand: Object.freeze({
    maximumAbsoluteX: COLLAR_MAX_X,
    minimumY: COLLAR_MIN_Y,
    maximumY: COLLAR_MAX_Y,
    frontZ: COLLAR_FRONT_Z,
    backZ: COLLAR_BACK_Z,
  }),
  maximumShoulderDrop: MAX_SHOULDER_DROP,
  maximumShoulderRound: MAX_SHOULDER_ROUND,
  maximumCollarDip: MAX_COLLAR_DIP,
  maximumCollarForward: MAX_COLLAR_FORWARD,
  bindSpace: true,
  lowerArmsChanged: false,
  headHoodBootsPantsChanged: false,
});
