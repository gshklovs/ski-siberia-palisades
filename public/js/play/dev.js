//
// STUBBED by poi-lab tools/export-red-dog (specs/0003 §A2).
// specs/0003 A2 -- dev mode is not in this build. What is left is the API surface main.js consumes, so all ~20 of its call sites stay module-safe: available() and active() are false forever and nothing else does anything.
// The original module is 48,785 bytes.

export const createDev = () => ({ available: () => false, active: () => false, toggle: () => false, setActive: () => false, update: () => {}, applyTo: () => {}, look: () => {}, key: () => false, pointer: () => {}, tick: () => {} });
