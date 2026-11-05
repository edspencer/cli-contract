// The `update` checks (SPEC §5, §6), against a local registry serving three builds of the tool under test:
//
//   A  the packed tool: what's installed
//   B  A with every package.json's version bumped a minor: the update
//   C  B bumped a patch, whose `serve` exits at once: an update that installs and then doesn't come up
//
// B and C are made from the installed copy of A (its files, not its node_modules), so they're the same code with
// another version. The registry serves all three from the start, and each check moves the dist-tags. npm runs in an
// environment that's checked before anything installs: its global folder must be inside the runner's own temporary
// folder, or nothing runs.
//
// These checks are opt-in: a tool lists them in cli-contract.json when it has `update`. Two need a real service manager
// (`REAL_SERVICE_CHECKS`), and run only where CI_REAL_SERVICE=1 and CI are set: they install the tool's service under
// the real home, which on a CI runner is throwaway and on a laptop is not.

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describeExitCode, EXIT } from '../reference/exit-codes.ts';
import { bumpVersion } from '../reference/semver.ts';
import type { Config } from './config.ts';
import { startFakeRegistry, type FakeRegistry } from './fake-registry.ts';
import { freePort, npm, run, type RunResult } from './proc.ts';
import { formatErrors, loadSchema, validate } from './schema.ts';

export const UPDATE_CHECK_IDS = [
  'update-up-to-date',
  'update-check-json',
  'update-no-tty',
  'update-busy',
  'update-npx',
  'update-checkout',
  'update-not-writable',
  'update',
  'update-to-lower',
  'update-service',
  'update-rollback',
] as const;

export type UpdateCheckId = (typeof UPDATE_CHECK_IDS)[number];

/** Checks that install the tool's service with the real service manager. */
export const REAL_SERVICE_CHECKS: ReadonlySet<string> = new Set<UpdateCheckId>(['update-service', 'update-rollback']);

export const UPDATE_CHECK_TITLES: Record<UpdateCheckId, string> = {
  'update-up-to-date': '`update --yes` with the registry at this version exits 0 and installs nothing (SPEC §5 step 4)',
  'update-check-json': '`update --check --json` exits 0 with one document matching the schema, and installs nothing (SPEC §1, §5)',
  'update-no-tty': '`update` without a TTY and without `--yes` exits 2, with the usage after the message (SPEC §1, §3)',
  'update-busy': '`update --yes` while the instance is busy exits 75 and installs nothing (SPEC §5 step 6)',
  'update-npx': '`update --yes` from an npx cache exits 5 (SPEC §6)',
  'update-checkout': '`update --yes` from a checkout exits 5 (SPEC §6)',
  'update-not-writable': '`update --yes` with a global folder it can\'t write exits 5, printing the command with `sudo` (SPEC §5 step 5)',
  update: '`update --yes` installs the newer version from the registry and exits 0 (SPEC §5)',
  'update-to-lower': '`update --yes` doesn\'t go to a lower version; `update --yes --to <lower>` does (SPEC §5 step 4)',
  'update-service': 'with the service installed, `update --yes` exits 0 with the new version answering (SPEC §5 steps 9 to 12)',
  'update-rollback': 'an update whose new version doesn\'t start rolls back and exits 6, with the old version answering (SPEC §5 step 13)',
};

type Verdict = { status: 'pass' | 'fail' | 'skip'; message: string; details?: string[] };
const pass = (message: string): Verdict => ({ status: 'pass', message });
const fail = (message: string, details?: string[]): Verdict => ({ status: 'fail', message, details });
const skip = (message: string): Verdict => ({ status: 'skip', message });

/** The `update` section of cli-contract.json. */
export interface UpdateConfig {
  /** Where the tool's `runtime.json` is, for `update-busy`: `{home}/.tool/runtime.json`. */
  runtimeFile?: string;
  /** How `update-service` and `update-rollback` install the service; `{port}` is a free port. */
  serviceInstall?: string[];
  /** How long each `update` may take. Default 300 000. */
  timeoutMs?: number;
}

export interface RigInput {
  work: string;
  prefix: string;
  /** The installed package's folder. */
  root: string;
  /** The bin's file, relative to the package's folder. */
  binFile: string;
  name: string;
  version: string;
  /** A's tarball, or a spec `npm pack` can fetch. */
  source: string;
  config: Config;
  dirs: { home: string; tmp: string };
  /** The sandbox environment the other checks run in. */
  sandbox: NodeJS.ProcessEnv;
  /** The runner's own environment. */
  base: NodeJS.ProcessEnv;
  log: (line: string) => void;
}

export interface UpdateRig {
  A: string;
  B: string;
  C: string;
  registry: FakeRegistry;
  /** Runs the installed bin. `real` uses the real-service environment. */
  cli(args: string[], o?: { real?: boolean; file?: string }): Promise<RunResult>;
  /** Installs this version from the local registry, unless it's already the one installed. */
  ensure(version: string, real?: boolean): Promise<void>;
  installed(): Promise<string>;
  /** A copy of the installed package somewhere else (`_npx/…`, a checkout), its node_modules linked, not copied. */
  copyTo(dir: string): string;
  globalRoot: string;
  close(): Promise<void>;
}

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Every package.json under `dir` (but not in a node_modules) whose version is `from`, set to `to`. */
function bumpManifests(dir: string, from: string, to: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') n += bumpManifests(p, from, to);
    else if (entry.isFile() && entry.name === 'package.json') {
      const text = fs.readFileSync(p, 'utf8');
      try {
        const json = JSON.parse(text) as { version?: string };
        if (json.version !== from) continue;
        json.version = to;
        fs.writeFileSync(p, `${JSON.stringify(json, null, 2)}\n`);
        n++;
      } catch {
        // not JSON: not ours to touch
      }
    }
  }
  return n;
}

/** What makes C's `serve` fail: it exits at once, so neither the service manager nor a health check sees it up. */
export const SABOTAGE =
  "if (process.argv[2] === 'serve') { process.stderr.write('cli-conformance: this build exits at once, to test the rollback\\n'); process.exit(1); }\n";

function sabotage(file: string): void {
  const text = fs.readFileSync(file, 'utf8');
  const shebang = text.startsWith('#!') ? text.slice(0, text.indexOf('\n') + 1) : '';
  fs.writeFileSync(file, `${shebang}${SABOTAGE}${text.slice(shebang.length)}`);
}

/** Packs `dir` without running its scripts, and returns the tarball. */
async function pack(dir: string, dest: string, env: NodeJS.ProcessEnv): Promise<string> {
  const out = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', dest], { cwd: dir, env, timeoutMs: 600_000 });
  const json = out.slice(out.lastIndexOf('\n[') + 1 || out.indexOf('['));
  return path.join(dest, path.basename((JSON.parse(json) as { filename: string }[])[0].filename));
}

/** npm's settings for every command here: a private cache, the local registry, and our prefix. */
function withNpm(env: NodeJS.ProcessEnv, o: { prefix: string; cache: string; registry: string }): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  // npm passes its own npm_config_* to scripts (`npx cli-conformance` has them): none of them belong here.
  for (const [k, v] of Object.entries(env)) if (!/^npm_config_/i.test(k)) out[k] = v;
  return {
    ...out,
    npm_config_prefix: o.prefix,
    npm_config_cache: o.cache,
    npm_config_registry: `${o.registry}/`,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_loglevel: 'error',
  };
}

export async function createUpdateRig(i: RigInput): Promise<UpdateRig> {
  const A = i.version;
  const B = bumpVersion(A, 'minor');
  const C = bumpVersion(B, 'patch');
  const builds = path.join(i.work, 'builds');
  fs.mkdirSync(builds, { recursive: true });
  const timeoutMs = (i.config.update as UpdateConfig | undefined)?.timeoutMs ?? 300_000;
  const upstream = i.base.npm_config_registry ?? i.base.NPM_CONFIG_REGISTRY ?? 'https://registry.npmjs.org';
  const registry = await startFakeRegistry({ name: i.name, upstream });
  const cache = path.join(i.work, 'npm-cache');
  const sandboxEnv = withNpm(i.sandbox, { prefix: i.prefix, cache, registry: registry.url });
  const realEnv = withNpm({ ...i.base, ...realExtras(i) }, { prefix: i.prefix, cache, registry: registry.url });

  try {
    // npm must install into our prefix and nowhere else. Asked of npm, through the environment the tool gets.
    const globalRoot = (await npm(['root', '-g'], { cwd: i.work, env: sandboxEnv, timeoutMs: 60_000 })).trim().split(/\r?\n/).at(-1) ?? '';
    if (!fs.existsSync(globalRoot) || !fs.realpathSync(globalRoot).startsWith(fs.realpathSync(i.work))) {
      throw new Error(`refusing to run the update checks: \`npm root -g\` is ${globalRoot}, which isn't inside ${i.work}`);
    }

    i.log(`Building ${B} and ${C} from ${A} for the update checks…`);
    const tarballA = fs.existsSync(i.source) ? i.source : await npmPackSpec(i, builds);
    const make = async (version: string, broken: boolean) => {
      const dir = path.join(builds, version);
      fs.cpSync(i.root, dir, { recursive: true, filter: (src) => !path.relative(i.root, src).split(/[/\\]/).includes('node_modules') });
      if (bumpManifests(dir, A, version) === 0) throw new Error(`no package.json in ${i.root} has version ${A}`);
      if (broken) sabotage(path.join(dir, i.binFile));
      return pack(dir, builds, sandboxEnv);
    };
    const manifest = (tarDir: string) => JSON.parse(fs.readFileSync(path.join(tarDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    registry.versions[A] = { tarball: tarballA, manifest: manifest(i.root) };
    registry.versions[B] = { tarball: await make(B, false), manifest: manifest(path.join(builds, B)) };
    registry.versions[C] = { tarball: await make(C, true), manifest: manifest(path.join(builds, C)) };
    registry.distTags = { latest: A };

    const bin = path.join(i.root, i.binFile);
    const cli = (args: string[], o: { real?: boolean; file?: string } = {}) =>
      run(process.execPath, [o.file ?? bin, ...args], { cwd: i.dirs.tmp, env: o.real ? realEnv : sandboxEnv, timeoutMs });
    const installed = async () => (await cli(['--version'])).stdout.trim();
    const rig: UpdateRig = {
      A,
      B,
      C,
      registry,
      globalRoot,
      cli,
      installed,
      async ensure(version, real) {
        if ((await installed()) === version) return;
        await npm(['install', '--global', '--no-audit', '--no-fund', `${i.name}@${version}`], { cwd: i.work, env: real ? realEnv : sandboxEnv, timeoutMs });
        const now = await installed();
        if (now !== version) throw new Error(`installed ${i.name}@${version}, but --version says ${JSON.stringify(now)}`);
      },
      copyTo(dir) {
        const dest = path.join(dir, ...i.name.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(i.root, dest, { recursive: true, filter: (src) => path.relative(i.root, src) !== 'node_modules' });
        if (fs.existsSync(path.join(i.root, 'node_modules'))) {
          fs.symlinkSync(path.join(i.root, 'node_modules'), path.join(dest, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
        }
        return path.join(dest, i.binFile);
      },
      close: () => registry.close(),
    };
    return rig;
  } catch (err) {
    await registry.close();
    throw err;
  }
}

async function npmPackSpec(i: RigInput, dest: string): Promise<string> {
  const out = await npm(['pack', '--json', '--pack-destination', dest, i.source], { cwd: i.work, env: i.base, timeoutMs: 600_000 });
  return path.join(dest, path.basename((JSON.parse(out.slice(out.indexOf('['))) as { filename: string }[])[0].filename));
}

/** The config's environment, over the real one, for the real-service checks. */
function realExtras(i: RigInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NO_COLOR: '1' };
  for (const [k, v] of Object.entries(i.config.env ?? {})) env[k] = v === null ? undefined : fill(v, { ...i.dirs, port: '' });
  return env;
}

// ---- the checks

export interface UpdateCheckContext {
  bin: string;
  name: string;
  config: Config;
  dirs: { home: string; tmp: string };
  rig(): Promise<UpdateRig>;
  serveTimeoutMs: number;
}

const show = (r: RunResult) => {
  const out: string[] = [];
  if (r.stdout.trim()) out.push(`stdout: ${r.stdout.trimEnd().split('\n').slice(-12).join('\n        ')}`);
  if (r.stderr.trim()) out.push(`stderr: ${r.stderr.trimEnd().split('\n').slice(-12).join('\n        ')}`);
  return out;
};

function expect(r: RunResult, args: string[], want: number): Verdict | null {
  if (r.code === want) return null;
  const how = r.timedOut ? `was still running after ${Math.round(r.ms / 1000)} s, and was killed` : `exited ${describeExitCode(r.code)}`;
  return fail(`\`${args.join(' ')}\` ${how}; expected ${describeExitCode(want)}`, show(r));
}

async function still(rig: UpdateRig, version: string): Promise<Verdict | null> {
  const now = await rig.installed();
  return now === version ? null : fail(`the installed version changed to ${now}; it should still be ${version}`);
}

async function health(port: number): Promise<string | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? ((await res.json()) as { version?: string }).version : undefined;
  } catch {
    return undefined;
  }
}

async function waitForHealth(port: number, version: string, timeoutMs: number): Promise<string | undefined> {
  const end = Date.now() + timeoutMs;
  let last: string | undefined;
  while (Date.now() < end) {
    last = await health(port);
    if (last === version) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  return last;
}

/** Runs `fn` with a stand-in instance that says it's busy, found through the tool's runtime.json. */
async function withBusyInstance<T>(file: string, version: string, fn: () => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
    const body = req.url === '/api/busy' ? { busy: true, version, counts: { conformance: 1 } } : req.url === '/api/health' ? { ok: true, version } : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? {}));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, url: `http://127.0.0.1:${port}`, version, startedAt: new Date().toISOString() }), { mode: 0o600 });
  try {
    return await fn();
  } finally {
    fs.rmSync(file, { force: true });
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/** Installs the service at A, runs `fn` with its port, and uninstalls it whatever happens. */
async function withService(ctx: UpdateCheckContext, rig: UpdateRig, fn: (port: number) => Promise<Verdict>): Promise<Verdict> {
  await rig.ensure(rig.A, true);
  const port = await freePort();
  const args = ((ctx.config.update as UpdateConfig | undefined)?.serviceInstall ?? ['service', 'install', '--port', '{port}']).map((a) => fill(a, { ...ctx.dirs, port }));
  await rig.cli(['service', 'uninstall'], { real: true });
  try {
    const installed = await rig.cli(args, { real: true });
    const bad = expect(installed, args, EXIT.OK);
    if (bad) return bad;
    const up = await waitForHealth(port, rig.A, ctx.serveTimeoutMs);
    if (up !== rig.A) return fail(`after \`${args.join(' ')}\`, http://127.0.0.1:${port}/api/health answered ${JSON.stringify(up)}; expected ${rig.A}`);
    return await fn(port);
  } finally {
    await rig.cli(['service', 'uninstall'], { real: true });
  }
}

export const UPDATE_CHECKS: Record<UpdateCheckId, (ctx: UpdateCheckContext) => Promise<Verdict>> = {
  async 'update-up-to-date'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.A };
    const args = ['update', '--yes'];
    const r = await rig.cli(args);
    return expect(r, args, EXIT.OK) ?? (await still(rig, rig.A)) ?? pass(`exits 0 at ${rig.A}, with the registry's latest at ${rig.A}`);
  },

  async 'update-check-json'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const args = ['update', '--check', '--json'];
    const r = await rig.cli(args);
    const bad = expect(r, args, EXIT.OK) ?? (await still(rig, rig.A));
    if (bad) return bad;
    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(r.stdout) as Record<string, unknown>;
    } catch {
      return fail(`\`${args.join(' ')}\`'s stdout isn't one JSON document (prose belongs on stderr)`, show(r));
    }
    const errors = validate(loadSchema('update-check'), doc);
    if (errors.length) return fail(`doesn't match schemas/update-check.schema.json: ${formatErrors(errors)}`, [`stdout: ${r.stdout.slice(0, 400)}`]);
    const want = { current: rig.A, target: rig.B, updateAvailable: true, installMethod: 'npm-global', canUpdate: true };
    const got = Object.fromEntries(Object.keys(want).map((k) => [k, doc[k]]));
    if (JSON.stringify(got) !== JSON.stringify(want)) return fail(`says ${JSON.stringify(got)}; expected ${JSON.stringify(want)}`);
    return pass(`exits 0 with ${rig.A} → ${rig.B} available, installMethod npm-global, and installs nothing`);
  },

  async 'update-no-tty'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const args = ['update'];
    const r = await rig.cli(args);
    const bad = expect(r, args, EXIT.USAGE) ?? (await still(rig, rig.A));
    if (bad) return bad;
    const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
    const first = lines.findIndex((l) => l.startsWith(`${ctx.bin}: `));
    if (first === -1) return fail(`stderr has no \`${ctx.bin}: <message>\` line`, show(r));
    if (first === lines.length - 1) return fail('stderr has the message but no usage after it', show(r));
    return pass(`exits 2 with ${JSON.stringify(lines[first])}, then the usage`);
  },

  async 'update-busy'(ctx) {
    const file = (ctx.config.update as UpdateConfig | undefined)?.runtimeFile;
    if (file === undefined) return fail('cli-contract.json\'s "update" has no "runtimeFile": where the tool looks for its runtime.json, e.g. "{home}/.tool/runtime.json"');
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const args = ['update', '--yes'];
    const r = await withBusyInstance(fill(file, ctx.dirs), rig.A, () => rig.cli(args));
    return expect(r, args, EXIT.BUSY) ?? (await still(rig, rig.A)) ?? pass('exits 75 while /api/busy says busy, and installs nothing');
  },

  async 'update-npx'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const file = rig.copyTo(path.join(ctx.dirs.tmp, 'npm-cache', '_npx', 'c0ffee', 'node_modules'));
    const args = ['update', '--yes'];
    const r = await rig.cli(args, { file });
    return expect(r, args, EXIT.CANNOT_UPDATE) ?? (await still(rig, rig.A)) ?? pass('exits 5 run from `…/_npx/<hash>/node_modules`');
  },

  async 'update-checkout'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const file = rig.copyTo(path.join(ctx.dirs.tmp, 'src'));
    const args = ['update', '--yes'];
    const r = await rig.cli(args, { file });
    return expect(r, args, EXIT.CANNOT_UPDATE) ?? (await still(rig, rig.A)) ?? pass('exits 5 run from a folder not under a node_modules');
  },

  async 'update-not-writable'(ctx) {
    if (process.platform === 'win32') return skip("Windows: a folder's mode bits can't make it read-only");
    if (process.getuid?.() === 0) return skip('running as root, which writes whatever the mode bits say');
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const mode = fs.statSync(rig.globalRoot).mode;
    fs.chmodSync(rig.globalRoot, 0o555);
    const args = ['update', '--yes'];
    let r: RunResult;
    try {
      r = await rig.cli(args);
    } finally {
      fs.chmodSync(rig.globalRoot, mode);
    }
    const bad = expect(r, args, EXIT.CANNOT_UPDATE) ?? (await still(rig, rig.A));
    if (bad) return bad;
    if (!/\bsudo\b/.test(r.stdout + r.stderr)) return fail('exits 5, but prints no command with `sudo`', show(r));
    return pass('exits 5 with the global folder read-only, printing the `sudo` command');
  },

  async update(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.A);
    rig.registry.distTags = { latest: rig.B };
    const args = ['update', '--yes'];
    const r = await rig.cli(args);
    const bad = expect(r, args, EXIT.OK);
    if (bad) return bad;
    const now = await rig.installed();
    if (now !== rig.B) return fail(`exits 0, but --version then says ${now}; expected ${rig.B}`, show(r));
    if (!rig.registry.requests.some((q) => q.includes('dist-tags'))) return fail("exits 0, but never asked the registry's dist-tags");
    return pass(`exits 0, and ${rig.A} → ${rig.B} is installed`);
  },

  async 'update-to-lower'(ctx) {
    const rig = await ctx.rig();
    await rig.ensure(rig.B);
    rig.registry.distTags = { latest: rig.A };
    const plain = ['update', '--yes'];
    const r1 = await rig.cli(plain);
    const bad = expect(r1, plain, EXIT.OK) ?? (await still(rig, rig.B));
    if (bad) return bad;
    const to = ['update', '--yes', '--to', rig.A];
    const r2 = await rig.cli(to);
    const bad2 = expect(r2, to, EXIT.OK);
    if (bad2) return bad2;
    const now = await rig.installed();
    if (now !== rig.A) return fail(`\`${to.join(' ')}\` exits 0, but --version then says ${now}; expected ${rig.A}`, show(r2));
    return pass(`stays at ${rig.B} without --to, and goes to ${rig.A} with it`);
  },

  async 'update-service'(ctx) {
    const rig = await ctx.rig();
    return withService(ctx, rig, async (port) => {
      rig.registry.distTags = { latest: rig.B };
      const args = ['update', '--yes'];
      const r = await rig.cli(args, { real: true });
      const bad = expect(r, args, EXIT.OK);
      if (bad) return bad;
      const now = await waitForHealth(port, rig.B, ctx.serveTimeoutMs);
      if (now !== rig.B) return fail(`exits 0, but /api/health answers ${JSON.stringify(now)}; expected ${rig.B}`, show(r));
      const st = await rig.cli(['service', 'status', '--json'], { real: true });
      const doc = (() => {
        try {
          return JSON.parse(st.stdout) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })();
      if (doc === undefined) return fail('`service status --json` after the update printed no JSON document', show(st));
      const errors = validate(loadSchema('service-status'), doc);
      if (errors.length) return fail(`\`service status --json\` after the update doesn't match the schema: ${formatErrors(errors)}`);
      if (doc.installedVersion !== rig.B || doc.runningVersion !== rig.B) {
        return fail(`\`service status --json\` says installed ${String(doc.installedVersion)}, running ${String(doc.runningVersion)}; expected ${rig.B} for both`);
      }
      const update = doc.update as { updateAvailable?: boolean } | undefined;
      if (update?.updateAvailable === true) return fail('`service status --json` still says an update is available: update-check.json should be rewritten after an update');
      return pass(`exits 0, and ${rig.B} answers on the service's port; status agrees`);
    });
  },

  async 'update-rollback'(ctx) {
    const rig = await ctx.rig();
    return withService(ctx, rig, async (port) => {
      rig.registry.distTags = { latest: rig.C };
      const args = ['update', '--yes'];
      const r = await rig.cli(args, { real: true });
      const bad = expect(r, args, EXIT.ROLLED_BACK);
      if (bad) return bad;
      const now = await waitForHealth(port, rig.A, ctx.serveTimeoutMs);
      if (now !== rig.A) return fail(`exits 6, but /api/health answers ${JSON.stringify(now)}; expected ${rig.A} running again`, show(r));
      return (await still(rig, rig.A)) ?? pass(`${rig.C} doesn't start, so it exits 6, with ${rig.A} installed and answering again`);
    });
  },
};
