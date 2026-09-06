//
// STUBBED by poi-lab tools/export-red-dog (specs/0003 §A2).
// specs/0058 -- the ride recorder is not in this build. armed() is false forever, tick()/mark()/look() do nothing and key() consumes nothing, so every call site in main.js, dev.js and touch.js is dead.
// The original module is 56,836 bytes.

export const createRecorder = () => ({ armed: () => false, setArmed: () => false, pre: () => {}, tick: () => {}, look: () => {}, mark: () => {}, key: () => false, fileKey: () => 'KeyJ', open: () => false, close: () => false, submit: () => null, panelOpen: () => false, setNote: () => null, lastRequest: () => null, segments: () => ({ prev: null, cur: null }), events: () => [], at: () => null, cost: () => null, reset: () => {} });
export const EV = { spawn: 1, respawn: 2, teleport: 3, liftBoard: 4, land: 5, takeoff: 6, wipeStart: 7, wipeEnd: 8, fence: 9, canopy: 10, tree: 11, solid: 12, trick: 13, gear: 14, void: 15, file: 16, jibOn: 17, jibOff: 18, grab: 19 };
