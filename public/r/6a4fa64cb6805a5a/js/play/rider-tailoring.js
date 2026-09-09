const PANTS_NAME = 'polish-v7:connected-pants';
const TAPER_START_Y = 0.34;
const TAPER_END_Y = 0.72;
const LEG_CENTER_X = 0.13;
const LEG_CENTER_Z = -0.03;
const MAX_LATERAL_TAPER = 0.045;
const MAX_DEPTH_TAPER = 0.03;

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)]));
  }
  return value;
}

function taperWeight(height) {
  if (height <= TAPER_START_Y || height >= TAPER_END_Y) return 0;
  const phase = (height - TAPER_START_Y) / (TAPER_END_Y - TAPER_START_Y);
  return Math.sin(Math.PI * phase) ** 2;
}

function taperDerivative(height) {
  if (height <= TAPER_START_Y || height >= TAPER_END_Y) return 0;
  const phase = (height - TAPER_START_Y) / (TAPER_END_Y - TAPER_START_Y);
  return Math.PI / (TAPER_END_Y - TAPER_START_Y) * Math.sin(2 * Math.PI * phase);
}

export function tailorRiderParts(parts) {
  return parts.map((source) => {
    const part = cloneValue(source);
    if (part.name !== PANTS_NAME) return part;

    for (let offset = 0; offset < part.positions.length; offset += 3) {
      const sourceX = part.positions[offset];
      const height = part.positions[offset + 1];
      const sourceZ = part.positions[offset + 2];
      const weight = taperWeight(height);
      if (weight === 0) continue;
      const derivative = taperDerivative(height);
      const centerX = sourceX < 0 ? -LEG_CENTER_X : LEG_CENTER_X;
      const scaleX = 1 - MAX_LATERAL_TAPER * weight;
      const scaleZ = 1 - MAX_DEPTH_TAPER * weight;
      const dxdy = -(sourceX - centerX) * MAX_LATERAL_TAPER * derivative;
      const dzdy = -(sourceZ - LEG_CENTER_Z) * MAX_DEPTH_TAPER * derivative;
      part.positions[offset] = centerX
        + (sourceX - centerX) * scaleX;
      part.positions[offset + 2] = LEG_CENTER_Z
        + (sourceZ - LEG_CENTER_Z) * scaleZ;
      const normalX = source.normals[offset] / scaleX;
      const normalZ = source.normals[offset + 2] / scaleZ;
      const normalY = source.normals[offset + 1] - dxdy * normalX - dzdy * normalZ;
      const normalLength = Math.hypot(normalX, normalY, normalZ);
      part.normals[offset] = normalX / normalLength;
      part.normals[offset + 1] = normalY / normalLength;
      part.normals[offset + 2] = normalZ / normalLength;
    }
    return part;
  });
}

export const RIDER_TAILORING_LIMITS = Object.freeze({
  pantsName: PANTS_NAME,
  taperStartY: TAPER_START_Y,
  taperEndY: TAPER_END_Y,
  maximumLateralTaper: MAX_LATERAL_TAPER,
  maximumDepthTaper: MAX_DEPTH_TAPER,
  shoulderChanges: false,
  compressionFolds: false,
});
