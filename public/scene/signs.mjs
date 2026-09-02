// Trail signs and terminal lettering.
//
// The one place this world uses textures: a 2D canvas is painted at build time
// (no fetch, no external asset) and handed to a CanvasTexture. Run names are
// the cheapest possible way to make a ski world legible — you stand at the top
// of a corridor and the board tells you it is RED DOG FACE.

const DIFF = {
  black: { shape: 'diamond', fill: '#141414' },
  blue: { shape: 'square', fill: '#1d5fb4' },
  green: { shape: 'circle', fill: '#217a3c' },
};

function canvas(w, h) {
  const c = (typeof document !== 'undefined' && document.createElement)
    ? document.createElement('canvas')
    : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : null);
  if (!c) return null;
  c.width = w; c.height = h;
  return c;
}

function fit(ctx, text, maxW, start, family) {
  let px = start;
  do {
    ctx.font = `700 ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxW) break;
    px -= 2;
  } while (px > 10);
  return px;
}

// A resort trail board: white face, black border, difficulty badge, run name.
export function trailBoardTexture(THREE, name, diff) {
  const W = 512, H = 168;
  const c = canvas(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f2ee'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 9; g.strokeRect(4.5, 4.5, W - 9, H - 9);
  const d = DIFF[diff] || DIFF.black;
  g.fillStyle = d.fill;
  const cx = 76, cy = H / 2, r = 42;
  g.beginPath();
  if (d.shape === 'diamond') { g.moveTo(cx, cy - r); g.lineTo(cx + r * 0.82, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r * 0.82, cy); }
  else if (d.shape === 'square') { g.rect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56); }
  else { g.arc(cx, cy, r * 0.8, 0, Math.PI * 2); }
  g.closePath(); g.fill();
  const fam = 'Helvetica,Arial,sans-serif';
  const words = name.split(' ');
  // Two-word names wrap too once they are long enough that a single line would
  // shrink to nothing — SCHIMMELPFENNIG BOWL is 20 characters and was landing at
  // ~17 px on a 512 px board. 14 is the threshold that leaves CHAMPS ELYSEES and
  // SECRET GARDEN on one line, exactly as they already shipped.
  const wrap = words.length > 2 || (words.length === 2 && name.length > 14);
  const lines = wrap
    ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')]
    : [name];
  g.fillStyle = '#141414'; g.textBaseline = 'middle'; g.textAlign = 'left';
  if (lines.length === 1) {
    const px = fit(g, name, W - 170, 62, fam);
    g.font = `700 ${px}px ${fam}`;
    g.fillText(name, 140, H / 2 + 2);
  } else {
    const px = Math.min(fit(g, lines[0], W - 170, 52, fam), fit(g, lines[1], W - 170, 52, fam));
    g.font = `700 ${px}px ${fam}`;
    g.fillText(lines[0], 140, H / 2 - px * 0.60);
    g.fillText(lines[1], 140, H / 2 + px * 0.60);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Terminal flank: "SIBERIA EXPRESS" on the pale band of view-25 — a small
// square resort mark, the name, and the Leitner-Poma builder's mark at the
// right, which is what the photograph shows on the real shed. 12:1, because on
// this lift the band runs most of the length of a low flat shed rather than
// sitting under a barrel vault.
export function terminalTexture(THREE, name) {
  const W = 1536, H = 128;
  const c = canvas(W, H);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = '#e9ebee'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d4d8dc'; g.fillRect(0, H - 10, W, 10);
  const fam = 'Helvetica,Arial,sans-serif';
  // resort mark: a small dark square with a white slash
  g.fillStyle = '#20334d'; g.fillRect(W * 0.055, H * 0.24, H * 0.52, H * 0.52);
  g.strokeStyle = '#ffffff'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(W * 0.055 + 10, H * 0.68); g.lineTo(W * 0.055 + H * 0.42, H * 0.32); g.stroke();
  const label = name + ' EXPRESS';
  g.fillStyle = '#171a1e'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const px = fit(g, label, W * 0.52, 82, fam);
  g.font = `700 ${px}px ${fam}`;
  g.fillText(label, W * 0.115, H / 2);
  // Leitner-Poma builder's mark
  g.fillStyle = '#c8102e';
  g.beginPath(); g.moveTo(W * 0.845, H * 0.56); g.lineTo(W * 0.868, H * 0.24);
  g.lineTo(W * 0.891, H * 0.56); g.lineTo(W * 0.877, H * 0.56);
  g.lineTo(W * 0.868, H * 0.40); g.lineTo(W * 0.859, H * 0.56); g.closePath(); g.fill();
  g.fillStyle = '#171a1e'; g.font = `700 22px ${fam}`;
  g.fillText('LEITNER', W * 0.845, H * 0.72);
  g.fillStyle = '#c8102e';
  g.fillText('POMA', W * 0.845, H * 0.90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A board mesh on the +v side, sized in metres.
export function boardMesh(THREE, tex, w, h, { doubleSided = true } = {}) {
  const geo = new THREE.PlaneGeometry(w, h);
  const mat = new THREE.MeshLambertMaterial({
    map: tex, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    color: 0x9aa4b0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.62,
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

// Place a board upright at `pos` with its face pointing along the horizontal
// unit vector (nx, ny). PlaneGeometry faces local +Z, so lookAt does the work —
// no Euler-order guessing, which is what put the terminal lettering edge-on.
export function faceBoard(THREE, mesh, pos, nx, ny) {
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.up.set(0, 0, 1);
  mesh.lookAt(pos[0] + nx, pos[1] + ny, pos[2]);
  return mesh;
}
