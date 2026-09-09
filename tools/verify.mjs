import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(process.argv[2] || 'work/siberia-release');
const report = JSON.parse(fs.readFileSync(path.join(root, 'public/release.json')));
for (const entry of report.files) {
  assert.ok(entry.path.startsWith(`r/${report.release}/`));
  assert.ok(!/(?:\.env|\.blend|\.git|api.key|credentials)/i.test(entry.path));
  const bytes = fs.readFileSync(path.join(root, 'public', entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256, entry.path);
}
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
assert.ok(index.includes(`r/${report.release}/`));
assert.ok(!index.includes('__REL__'));
assert.ok(!index.includes('/api/run/'));
assert.ok(!index.includes('ski-red-dog-face'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
assert.equal(config.outputDirectory, 'public');
assert.equal(config.redirects, undefined);
assert.ok(report.files.some(entry => entry.path.endsWith('/scene/near-snow-relief.mjs')));
assert.ok(report.files.some(entry => entry.path.endsWith('/scene/snow-restored-budget.glb')));
assert.ok(report.files.some(entry => entry.path.endsWith('/js/play/rider-polish-mesh.js')));
console.log(JSON.stringify({pass:true,release:report.release,files:report.files.length,bytes:report.totalBytes}));
