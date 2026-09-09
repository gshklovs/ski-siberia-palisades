import { parseGlbGeometry, verifyApprovedGrid, EXPANSION_PILOT } from './snow-bank-asset.mjs';

export const APPROVED_SNOW_BANK = Object.freeze({
  id: 'snow-restored-source',
  lod: 'budget-22720',
  assetUrl: new URL('./snow-restored-budget.glb', import.meta.url),
  sha256: EXPANSION_PILOT.approvedSha256,
  anchorEnu: EXPANSION_PILOT.anchorEnu,
  collarCells: 2,
  collarTaper: Object.freeze({ ringFraction: .42, derivativeScale: .3 })
});

let cachedPlacements;

function bytesView(input) {
  if (input instanceof Uint8Array) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return new Uint8Array(input);
}

export async function sha256Hex(input) {
  const bytes = bytesView(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

async function fetchApprovedAsset(fetchImpl) {
  const response = await fetchImpl(APPROVED_SNOW_BANK.assetUrl);
  if (!response.ok) throw new Error(`Unable to load approved snow bank asset: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function parseApprovedAsset(input) {
  const hash = await sha256Hex(input);
  if (hash !== APPROVED_SNOW_BANK.sha256) throw new Error(`Approved snow bank SHA256 mismatch: ${hash}`);
  const geometry = parseGlbGeometry(input);
  const grid = verifyApprovedGrid(geometry);
  return [{
    id: APPROVED_SNOW_BANK.id,
    lod: APPROVED_SNOW_BANK.lod,
    anchorEnu: [...APPROVED_SNOW_BANK.anchorEnu],
    collarCells: APPROVED_SNOW_BANK.collarCells,
    collarTaper: APPROVED_SNOW_BANK.collarTaper,
    geometry,
    grid,
    sourceHash: hash
  }];
}

export async function approvedSnowBankPlacements({ bytes, fetchImpl = globalThis.fetch } = {}) {
  if (bytes) return parseApprovedAsset(bytesView(bytes));
  if (!cachedPlacements) cachedPlacements = fetchApprovedAsset(fetchImpl).then(parseApprovedAsset);
  return cachedPlacements;
}
