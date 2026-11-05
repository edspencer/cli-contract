import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_IDS, type CheckResult } from '../src/checks.ts';
import { ConfigError, parseConfig, readConfig, type Config } from '../src/config.ts';
import { npm } from '../src/proc.ts';
import { runConformance, sandboxEnv, type Report } from '../src/runner.ts';
import { tempDir } from './helpers.ts';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const repo = fileURLToPath(new URL('../', import.meta.url));
const tarballs: Record<string, string> = {};
let packDir = '';

// Pack each fixture once; the tests install the tarball (`--tarball`), and one test packs a checkout itself.
before(async () => {
  const dest = (packDir = tempDir('cli-conformance-test-'));
  for (const name of ['good', 'broken']) {
    const out = await npm(['pack', '--json', '--pack-destination', dest], { cwd: path.join(fixtures, name), env: process.env, timeoutMs: 120_000 });
    tarballs[name] = path.join(dest, (JSON.parse(out) as { filename: string }[])[0].filename.replace(/^.*[\\/]/, ''));
  }
});

after(() => fs.rmSync(packDir, { recursive: true, force: true, maxRetries: 5 }));

const config = (name: string): Config => readConfig(path.join(fixtures, name, 'cli-contract.json'));
const byId = (r: Report) => Object.fromEntries(r.results.map((x) => [x.id, x])) as Record<string, CheckResult>;

test('a conforming CLI, packed from its checkout, passes every check', async () => {
  const r = await runConformance({ source: { kind: 'dir', path: path.join(fixtures, 'good') }, config: config('good') });
  assert.deepEqual(
    r.results.filter((x) => x.status !== 'pass').map((x) => `${x.id}: ${x.message} ${x.details ?? ''}`),
    [],
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.summary, { pass: CHECK_IDS.length, fail: 0, skip: 0 });
  assert.deepEqual(r.target, { name: 'fixture-good', version: '1.2.3', bin: 'fixture-good', source: `packed from ${path.join(fixtures, 'good')}` });
  assert.match(byId(r)['serve-banner'].message, /Fixture Good 1\.2\.3: http:\/\/127\.0\.0\.1:\d+/);
});

test('a broken CLI fails each check, saying what it found and what was expected', async () => {
  const r = await runConformance({ source: { kind: 'tarball', path: tarballs.broken }, config: config('broken') });
  const x = byId(r);
  assert.equal(r.ok, false);
  assert.match(x.version.message, /`--version` printed "fixture-broken v0\.9\.0\\n"; expected "0\.9\.0\\n"/);
  assert.match(x.help.message, /`--help` exited 1 \(failed\); expected 0 \(ok\)/);
  assert.match(x['unknown-flag'].message, /still running after \d+ s, and was killed; expected 2 \(usage\)/);
  assert.match(x['service-status'].message, /exited 0 \(ok\); expected 4 \(not installed\)/);
  assert.match(x['service-status-json'].message, /exited 0 \(ok\); expected 4/);
  assert.equal(x.busy.status, 'skip');
  assert.equal(x.busy.message, 'not until wave C');
  assert.match(x['busy-json'].message, /\/busy should be boolean, but is string/);
  assert.match(x['serve-banner'].message, /the first line is "Listening on \d+"; expected "Fixture Broken 0\.9\.0: <url>"/);
  assert.match(x['serve-health'].message, /answered version undefined; expected "0\.9\.0"/);
  assert.deepEqual(r.summary, { pass: 0, fail: 8, skip: 1 });
  for (const f of r.results.filter((y) => y.status === 'fail')) assert.ok(f.title.includes('SPEC §'), f.id);
});

test('a check the config leaves out fails, naming the fix', async () => {
  const c = config('good');
  delete c.checks['busy-json'];
  const r = await runConformance({ source: { kind: 'tarball', path: tarballs.good }, config: c, only: ['busy', 'busy-json'] });
  assert.deepEqual(r.results.map((x) => [x.id, x.status]), [['busy', 'pass'], ['busy-json', 'fail']]);
  assert.match(r.results[1].message, /doesn't list "busy-json": add "busy-json": true, or "busy-json": \{ "skip": "<why>" \}/);
});

test("the config's env reaches the tool, over the sandbox's own home", async () => {
  // The fixture reads $HOME/.config/systemd/user/fixture-good.service: absent in the runner's fresh home (the first
  // test passes service-status), present in this one.
  const home = tempDir();
  fs.mkdirSync(path.join(home, '.config', 'systemd', 'user'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config', 'systemd', 'user', 'fixture-good.service'), '');
  const c = { ...config('good'), env: { HOME: home, USERPROFILE: home } };
  const r = await runConformance({ source: { kind: 'tarball', path: tarballs.good }, config: c, only: ['service-status'] });
  assert.match(r.results[0].message, /exited 3 \(not running\); expected 4/);
});

test('the sandbox environment', () => {
  const env = sandboxEnv(
    { PATH: '/bin', HOME: '/real', XDG_RUNTIME_DIR: '/run/user/1', DBUS_SESSION_BUS_ADDRESS: 'x', FORCE_COLOR: '1', SECRET: 's' },
    { home: '/tmp/h', tmp: '/tmp/t' },
    { SECRET: null, DATA: '{home}/data', DIR: '{tmp}' },
  );
  assert.equal(env.HOME, '/tmp/h');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.NO_COLOR, '1');
  for (const k of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'FORCE_COLOR', 'SECRET']) assert.equal(env[k], undefined, k);
  assert.equal(env.DATA, '/tmp/h/data');
  assert.equal(env.DIR, '/tmp/t');
  assert.equal(env.XDG_CONFIG_HOME, path.join('/tmp/h', '.config'));
});

test('cli-contract.json errors', () => {
  const parse = (o: unknown) => () => parseConfig(JSON.stringify(o), 'cli-contract.json');
  assert.throws(() => parseConfig('{', 'x.json'), (e) => e instanceof ConfigError && /x\.json isn't valid JSON/.test(e.message));
  assert.throws(parse({ checks: {} }), /missing "name"/);
  assert.throws(parse({ name: 'X', checks: { version: false } }), /matches none of the allowed forms/);
  assert.throws(parse({ name: 'X', checks: { 'no-such': true } }), /a check this runner doesn't have: "no-such"/);
  assert.throws(parse({ name: 'X', checks: { busy: { skip: ' ' } } }), /"busy" is skipped without a reason/);
  assert.throws(parse({ name: 'X', checks: {}, typo: 1 }), /\/typo is not allowed here/);
  assert.throws(() => readConfig(path.join(tempDir(), 'cli-contract.json')), /no .*cli-contract\.json/);
  assert.equal(parseConfig(JSON.stringify({ name: 'X', checks: { busy: { skip: 'why' } } }), 'c').name, 'X');
  for (const f of fs.readdirSync(path.join(repo, 'examples'))) readConfig(path.join(repo, 'examples', f));
});

function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(repo, 'src', 'cli.ts'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('the CLI: --json prints one report document; the exit code says whether it passed', () => {
  const ok = cli('--tarball', tarballs.good, '--config', path.join(fixtures, 'good', 'cli-contract.json'), '--json', '--only', 'version,busy');
  assert.equal(ok.code, 0, ok.stderr);
  const report = JSON.parse(ok.stdout) as Report;
  assert.equal(report.ok, true);
  assert.deepEqual(report.results.map((x) => x.id), ['version', 'busy']);
  assert.equal(report.runner.name, '@edspencer/cli-conformance');
  assert.match(ok.stderr, /Installing/, 'progress goes to stderr');

  const bad = cli('--tarball', tarballs.broken, '--config', path.join(fixtures, 'broken', 'cli-contract.json'), '--only', 'version');
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /✗ version +`--version` printed/);
  assert.match(bad.stdout, /0 passed, 1 failed, 0 skipped\./);
});

test('the CLI follows the contract itself: bare version, usage errors exit 2', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  assert.deepEqual(cli('--version'), { code: 0, stdout: `${pkg.version}\n`, stderr: '' });
  assert.equal(cli('-h').code, 0);
  const unknown = cli('--nope');
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^cli-conformance: .*--nope.*\n\nUsage: cli-conformance/);
  assert.equal(cli('--package', 'x').code, 2, '--package without --config');
  assert.match(cli('--only', 'nope', '--config', 'x').stderr, /no check named "nope"/);
  const noConfig = cli('--dir', tempDir());
  assert.equal(noConfig.code, 2);
  assert.match(noConfig.stderr, /^cli-conformance: no .*cli-contract\.json/);
});
