import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('SPEC.md says its version at the top, and its changelog has an entry for it', () => {
  const m = /^Version (\d+\.\d+(?:\.\d+)?)\b/m.exec(spec.split('\n').slice(0, 5).join('\n'));
  assert.ok(m, 'no "Version x.y" line near the top of SPEC.md');
  const changelog = spec.slice(spec.indexOf('\n## Changelog'));
  assert.ok(changelog.includes(`**${m[1]}**`), `SPEC.md's changelog has no entry for ${m[1]}`);
});

test('the package runs on Node 22 and has no runtime dependencies', () => {
  assert.equal(pkg.engines.node, '>=22');
  assert.equal(pkg.dependencies, undefined);
});
