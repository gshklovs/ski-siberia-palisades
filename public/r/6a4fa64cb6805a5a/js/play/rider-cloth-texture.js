const textures = new WeakMap();
export const CLOTH_TEXTURE_SIZE = 1024;
export const CLOTH_TILE_METERS = 0.192;

function hash(horizontal, vertical) {
  let seed = Math.imul(horizontal + 173, 374761393) ^ Math.imul(vertical + 971, 668265263);
  seed = Math.imul(seed ^ seed >>> 13, 1274126177);
  return ((seed ^ seed >>> 16) >>> 0) / 4294967295;
}

function periodicNoise(horizontal, vertical, cells) {
  const column = Math.floor(horizontal * cells), row = Math.floor(vertical * cells);
  const fractionX = horizontal * cells - column, fractionY = vertical * cells - row;
  const blendX = fractionX * fractionX * (3 - 2 * fractionX);
  const blendY = fractionY * fractionY * (3 - 2 * fractionY);
  const lower = hash(column % cells, row % cells) * (1 - blendX) + hash((column + 1) % cells, row % cells) * blendX;
  const upper = hash(column % cells, (row + 1) % cells) * (1 - blendX) + hash((column + 1) % cells, (row + 1) % cells) * blendX;
  return lower * (1 - blendY) + upper * blendY;
}

export function createClothTexels(size = CLOTH_TEXTURE_SIZE) {
  if (!Number.isInteger(size) || size < 16) throw new Error('Invalid cloth texture size');
  const data = new Uint8Array(size * size * 4);
  const byte = value => Math.round(Math.max(0, Math.min(1, value)) * 255);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const horizontal = (column + 0.5) / size, vertical = (row + 0.5) / size;
      const warp = Math.sin(horizontal * 240 * Math.PI * 2);
      const weft = Math.sin(vertical * 240 * Math.PI * 2);
      const twill = Math.sin((horizontal + vertical) * 120 * Math.PI * 2);
      const grain = periodicNoise(horizontal, vertical, 96) - 0.5;
      const dye = periodicNoise(horizontal, vertical, 24) - 0.5;
      const reinforcement = Math.pow(0.5 + 0.5 * Math.cos(horizontal * 24 * Math.PI * 2), 12)
        + Math.pow(0.5 + 0.5 * Math.cos(vertical * 24 * Math.PI * 2), 12);
      const offset = (row * size + column) * 4;
      data[offset] = byte(0.43 + warp * 0.11 + weft * 0.09 + twill * 0.05 + grain * 0.12 + reinforcement * 0.10);
      data[offset + 1] = byte(0.5 + grain * 0.40 + twill * 0.12 - reinforcement * 0.08);
      data[offset + 2] = byte(0.5 + dye * 0.60 + grain * 0.24);
      data[offset + 3] = 255;
    }
  }
  return data;
}

export function sharedClothTexture(THREE) {
  if (textures.has(THREE)) return textures.get(THREE);
  const texture = new THREE.DataTexture(createClothTexels(), CLOTH_TEXTURE_SIZE, CLOTH_TEXTURE_SIZE, THREE.RGBAFormat);
  texture.name = 'rider:shared-woven-cloth';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textures.set(THREE, texture);
  return texture;
}
