import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EXIT, describeExitCode, isToolOwnCode } from '../reference/exit-codes.ts';

test('the constants match SPEC §2', () => {
  assert.deepEqual(EXIT, {
    OK: 0,
    FAILED: 1,
    USAGE: 2,
    NOT_RUNNING: 3,
    NOT_INSTALLED: 4,
    CANNOT_UPDATE: 5,
    ROLLED_BACK: 6,
    ROLLBACK_FAILED: 7,
    BUSY: 75,
  });
});

test("every code in SPEC §2's table has a constant", () => {
  const spec = fs.readFileSync(new URL('../SPEC.md', import.meta.url), 'utf8');
  const section = spec.slice(spec.indexOf('## 2. Exit codes'), spec.indexOf('## 3. Output'));
  const codes = [...section.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1]));
  assert.deepEqual(codes.sort((a, b) => a - b), Object.values(EXIT).sort((a, b) => a - b));
});

test('a tool owns 8 to 63', () => {
  assert.equal(isToolOwnCode(7), false);
  assert.equal(isToolOwnCode(8), true);
  assert.equal(isToolOwnCode(63), true);
  assert.equal(isToolOwnCode(64), false);
  assert.equal(isToolOwnCode(75), false);
});

test('describeExitCode names the shared codes', () => {
  assert.equal(describeExitCode(4), '4 (not installed)');
  assert.equal(describeExitCode(75), '75 (busy)');
  assert.equal(describeExitCode(42), '42');
  assert.match(describeExitCode(null), /signal/);
});
