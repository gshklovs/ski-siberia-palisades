export function snowRegionAt(east, north) {
  const field = Math.sin(east * .009 + Math.sin(north * .004) * 1.7)
    * .55 + Math.cos(north * .011 - east * .003) * .30;
  const blend = Math.max(0, Math.min(1, (field + .20) / .55));
  return blend * blend * (3 - 2 * blend);
}

export const snowRegionGLSL = `
  float snowRegionAt(vec2 point) {
    float field = sin(point.x * .009 + sin(point.y * .004) * 1.7) * .55
      + cos(point.y * .011 - point.x * .003) * .30;
    return smoothstep(-.20, .35, field);
  }
`;
