import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckResult } from '../src/checks.ts';
import { readConfig } from '../src/config.ts';
import { run } from '../src/proc.ts';
import { runConformance, type Report } from '../src/runner.ts';
import { UPDATE_CHECK_IDS } from '../src/update-checks.ts';
import { tempDir } from './helpers.ts';

// The update checks, end to end, against a tool built on the reference code: test/fixtures/updatable, with reference/
// compiled into its lib/. Each check installs real packed builds from the runner's local registry.

const repo = fileURLToPath(new URL('../', import.meta.url));
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
let work = '';
let updatable = '';

before(async () => {
  work = tempDir('cli-conformance-update-');
  updatable = path.join(work, 'updatable');
  fs.cpSync(path.join(fixtures, 'updatable'), updatable, { recursive: true });
  const tsc = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  const r = await run(process.execPath, [tsc, '-p', path.join(repo, 'tsconfig.reference.json'), '--outDir', path.join(updatable, 'lib')], {
    cwd: repo,
    env: process.env,
    timeoutMs: 120_000,
  });
  assert.equal(r.code, 0, `compiling reference/ failed:\n${r.stdout}\n${r.stderr}`);
});

after(() => fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 }));

const byId = (r: Report) => Object.fromEntries(r.results.map((x) => [x.id, x])) as Record<string, CheckResult>;
const notPassed = (r: Report) => r.results.filter((x) => x.status !== 'pass').map((x) => `${x.id}: ${x.status}: ${x.message}\n${(x.details ?? []).join('\n')}`);

/** Runs `fn` with these variables set, and puts them back. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const cantChmod = process.platform === 'win32' || process.getuid?.() === 0;

test('a tool built on the reference passes every update check, the rollback included', { timeout: 900_000 }, async () => {
  // CI_REAL_SERVICE installs under the real home: here the fixture's own service, under a throwaway one.
  const realHome = tempDir('cli-conformance-realhome-');
  const r = await withEnv({ CI_REAL_SERVICE: '1', CI: 'true', HOME: realHome, USERPROFILE: realHome }, () =>
    runConformance({ source: { kind: 'dir', path: updatable }, config: readConfig(path.join(updatable, 'cli-contract.json')) }),
  );
  const expected = cantChmod ? ['update-not-writable: skip'] : [];
  assert.deepEqual(
    notPassed(r).map((l) => l.split(':').slice(0, 2).join(':')),
    expected,
    notPassed(r).join('\n\n'),
  );
  const x = byId(r);
  assert.match(x.update.message, /2\.4\.6 → 2\.5\.0 is installed/);
  assert.match(x['update-rollback'].message, /2\.5\.1 doesn't start, so it exits 6, with 2\.4\.6 installed and answering again/);
  assert.equal(r.results.length, 9 + UPDATE_CHECK_IDS.length);
  // The fixture's service is gone, and nothing was left running.
  assert.equal(fs.existsSync(path.join(realHome, '.fixture-updatable', 'unit.json')), false);
});

test('without CI_REAL_SERVICE the service checks are skipped, saying why; with it but without CI they refuse', { timeout: 300_000 }, async () => {
  const config = readConfig(path.join(updatable, 'cli-contract.json'));
  const only = ['update-service', 'update-rollback'] as const;
  const skipped = await withEnv({ CI_REAL_SERVICE: undefined }, () => runConformance({ source: { kind: 'dir', path: updatable }, config, only: [...only] }));
  assert.deepEqual(skipped.results.map((x) => [x.id, x.status]), [['update-service', 'skip'], ['update-rollback', 'skip']]);
  assert.match(skipped.results[0].message, /needs a real service manager: it runs where CI_REAL_SERVICE=1/);
  const refused = await withEnv({ CI_REAL_SERVICE: '1', CI: undefined }, () => runConformance({ source: { kind: 'dir', path: updatable }, config, only: [...only] }));
  assert.deepEqual(refused.results.map((x) => x.status), ['fail', 'fail']);
  assert.match(refused.results[0].message, /also needs CI set/);
});

test('the update checks are opt-in: unlisted, they are neither run nor reported', async () => {
  const config = readConfig(path.join(updatable, 'cli-contract.json'));
  for (const id of UPDATE_CHECK_IDS) delete config.checks[id];
  const r = await runConformance({ source: { kind: 'dir', path: updatable }, config, only: ['version', 'update'] });
  assert.deepEqual(r.results.map((x) => x.id), ['version']);
});

test('a tool without update fails them, saying what it found', { timeout: 300_000 }, async () => {
  const config = readConfig(path.join(fixtures, 'good', 'cli-contract.json'));
  config.checks.update = true;
  config.checks['update-check-json'] = true;
  const r = await runConformance({ source: { kind: 'dir', path: path.join(fixtures, 'good') }, config, only: ['update', 'update-check-json'] });
  const x = byId(r);
  assert.match(x.update.message, /`update --yes` exited 2 \(usage\); expected 0 \(ok\)/);
  assert.match(x['update-check-json'].message, /`update --check --json` exited 2 \(usage\); expected 0 \(ok\)/);
});
