// Packs this package, installs the tarball into a temporary prefix, and runs the installed cli-conformance as a tool's
// CI would: its --version, then the conforming fixture, which must pass. Run after `npm run build`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npm, run } from '../dist/src/proc.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-conformance-smoke-'));
const env = { ...process.env, npm_config_update_notifier: 'false' };
try {
  const packed = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: repo, env, timeoutMs: 120_000 });
  const tarball = path.join(work, JSON.parse(packed)[0].filename.replace(/^.*[\\/]/, ''));
  const prefix = path.join(work, 'prefix');
  await npm(['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball], { cwd: work, env, timeoutMs: 300_000 });

  const root = process.platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules');
  const pkgDir = path.join(root, '@edspencer', 'cli-conformance');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'no runtime dependencies');
  for (const f of ['SPEC.md', 'schemas/busy.schema.json', 'reference/busy-client.ts', 'dist/src/cli.js']) {
    assert.ok(fs.existsSync(path.join(pkgDir, f)), `the package has ${f}`);
  }
  const cli = path.join(pkgDir, pkg.bin['cli-conformance']);
  const opts = { cwd: work, env, timeoutMs: 300_000 };

  const v = await run(process.execPath, [cli, '--version'], opts);
  assert.equal(v.stdout, `${pkg.version}\n`);

  const good = await run(process.execPath, [cli, '--dir', path.join(repo, 'test', 'fixtures', 'good'), '--json'], opts);
  assert.equal(good.code, 0, good.stderr);
  const report = JSON.parse(good.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.summary.fail, 0);
  console.log(`smoke: the packed cli-conformance ${pkg.version} installs and passes the conforming fixture (${report.summary.pass} checks)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5 });
}
