export const EXPANSION_PILOT = Object.freeze({
  anchorEnu: [-195, -232, 226.6918],
  sourceBoundsLocal: [-16, -20, 16, 20],
  neighborOffsetEnu: [0, 40, 0],
  expectedColumns: 143,
  expectedRows: 81,
  expectedVertices: 11583,
  expectedTriangles: 22720,
  approvedSha256: 'ccd43e8258b72da5fe2e3e7ec8b80a048545640a46de72b3e500ec9315a5f22b'
});


const COMPONENT_BYTES = new Map([[5121, 1], [5123, 2], [5125, 4], [5126, 4]]);
const TYPE_WIDTH = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4]]);

function bytesView(input) {
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

function readComponent(view, offset, componentType) {
  if (componentType === 5121) return view.getUint8(offset);
  if (componentType === 5123) return view.getUint16(offset, true);
  if (componentType === 5125) return view.getUint32(offset, true);
  if (componentType === 5126) return view.getFloat32(offset, true);
  throw new Error(`Unsupported GLB component type ${componentType}`);
}

export function parseGlbGeometry(input) {
  const bytes = bytesView(input);
  const file = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (file.getUint32(0, true) !== 0x46546c67 || file.getUint32(4, true) !== 2) throw new Error('Expected a GLB v2 file');
  if (file.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB length header mismatch');
  let document;
  let binary;
  for (let offset = 12; offset < bytes.byteLength;) {
    const length = file.getUint32(offset, true);
    const type = file.getUint32(offset + 4, true);
    const payload = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(payload).replace(/[\u0000 ]+$/g, ''));
    if (type === 0x004e4942) binary = payload;
    offset += 8 + length;
  }
  if (!document || !binary) throw new Error('GLB must contain JSON and BIN chunks');
  if (document.meshes?.length !== 1 || document.meshes[0].primitives?.length !== 1) throw new Error('Expected one approved snow mesh primitive');
  const primitive = document.meshes[0].primitives[0];
  function accessorValues(accessorIndex) {
    const accessor = document.accessors[accessorIndex];
    const bufferView = document.bufferViews[accessor.bufferView];
    const width = TYPE_WIDTH.get(accessor.type);
    const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
    if (!width || !componentBytes || accessor.sparse) throw new Error('Unsupported GLB accessor layout');
    const stride = bufferView.byteStride ?? width * componentBytes;
    const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const source = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
    const Values = accessor.componentType === 5126 ? Float32Array : accessor.componentType === 5125 ? Uint32Array : accessor.componentType === 5123 ? Uint16Array : Uint8Array;
    const values = new Values(accessor.count * width);
    for (let item = 0; item < accessor.count; item++) {
      for (let component = 0; component < width; component++) values[item * width + component] = readComponent(source, start + item * stride + component * componentBytes, accessor.componentType);
    }
    return { accessor, values };
  }
  const position = accessorValues(primitive.attributes.POSITION);
  const normal = accessorValues(primitive.attributes.NORMAL);
  const indices = accessorValues(primitive.indices);
  if (position.accessor.type !== 'VEC3' || position.accessor.componentType !== 5126) throw new Error('Snow positions must be float VEC3');
  if (normal.accessor.type !== 'VEC3' || normal.accessor.componentType !== 5126) throw new Error('Snow normals must be float VEC3');
  if (indices.accessor.type !== 'SCALAR') throw new Error('Snow indices must be scalar');
  return { document, positions: position.values, normals: normal.values, indices: indices.values };
}

function nearlyEqual(first, second, tolerance = 1e-5) {
  return Math.abs(first - second) <= tolerance;
}

export function verifyApprovedGrid(geometry) {
  const { positions, indices } = geometry;
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  if (vertexCount !== EXPANSION_PILOT.expectedVertices || triangleCount !== EXPANSION_PILOT.expectedTriangles) throw new Error(`Unexpected approved mesh budget: ${vertexCount} vertices, ${triangleCount} triangles`);
  const firstZ = positions[2];
  let columns = 1;
  while (columns < vertexCount && nearlyEqual(positions[columns * 3 + 2], firstZ)) columns++;
  const rows = vertexCount / columns;
  if (columns !== EXPANSION_PILOT.expectedColumns || rows !== EXPANSION_PILOT.expectedRows || !Number.isInteger(rows)) throw new Error(`Approved mesh is not the verified ${EXPANSION_PILOT.expectedColumns}x${EXPANSION_PILOT.expectedRows} grid`);
  for (let row = 0; row < rows; row++) {
    const rowZ = positions[row * columns * 3 + 2];
    if (!nearlyEqual(rowZ, 20 - row * .5)) throw new Error(`Unexpected grid north coordinate on row ${row}`);
    for (let column = 0; column < columns; column++) if (!nearlyEqual(positions[(row * columns + column) * 3 + 2], rowZ)) throw new Error(`Grid row ${row} is not rectangular`);
  }
  let cursor = 0;
  for (let row = 0; row < rows - 1; row++) for (let column = 0; column < columns - 1; column++) {
    const start = row * columns + column;
    const corners = new Set([start, start + 1, start + columns, start + columns + 1]);
    const cell = Array.from(indices.subarray(cursor, cursor + 6));
    if (cell.some(index => !corners.has(index)) || new Set(cell).size !== 4) throw new Error(`Indices do not form rectangular cell ${row},${column}`);
    cursor += 6;
  }
  if (cursor !== indices.length) throw new Error('Grid index coverage mismatch');
  return { columns, rows, vertices: vertexCount, triangles: triangleCount };
}
