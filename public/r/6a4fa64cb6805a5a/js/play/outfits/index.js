// specs/0037 — the outfits, five family modules, one list in code order + byCode.
// 27 at 0037, 32 since specs/0040 added g27–g31; read OUTFITS.length, never a count.
import race from './race.js';
import shell from './shell.js';
import freeride from './freeride.js';
import retro from './retro.js';
import armour from './armour.js';

export const FAMILIES = { race, shell, freeride, retro, armour };
export const OUTFITS = [...race, ...shell, ...freeride, ...retro, ...armour]
  .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
export const byCode = Object.fromEntries(OUTFITS.map((o) => [o.code, o]));
export default OUTFITS;
