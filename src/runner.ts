// Packs a tool, installs it into a throwaway prefix, and runs the checks its cli-contract.json asks for.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL_CHECK_IDS, CHECK_TITLES, CHECKS, OPT_IN_CHECKS, type CheckContext, type CheckId, type CheckResult, type CoreCheckId, type ServeSession } from './checks.ts';
import type { Config } from './config.ts';
import { freePort, killTree, npm, run, start } from './proc.ts';
import { createUpdateRig, REAL_SERVICE_CHECKS, UPDATE_CHECKS, type UpdateCheckId, type UpdateRig } from './update-checks.ts';

export type Source =
  /** A checkout: `npm pack` it (which runs its `prepack`), then install the tarball. */
  | { kind: 'dir'; path: string }
  | { kind: 'tarball'; path: string }
  /** Anything `npm install` takes: `localidraw@latest`. */
  | { kind: 'package'; spec: string };

export interface RunnerOptions {
  source: Source;
  config: Config;
  /** Run only these checks; the rest are left out of the report. */
  only?: CheckId[];
  /** Keep the temporary folder, and say where it is. */
  keep?: boolean;
  /** Progress, for a person. */
  log?: (line: string) => void;
}

export interface Report {
  runner: { name: string; version: string };
  target: { name: string; version: string; bin: string; source: string };
  ok: boolean;
  summary: { pass: number; fail: number; skip: number };
  results: CheckResult[];
  /** Set with `keep`. */
  workDir?: string;
}

export class SetupError extends Error {
  override name = 'SetupError';
}

export function runnerPackage(): { name: string; version: string } {
  for (const rel of ['../package.json', '../../package.json']) {
    const url = new URL(rel, import.meta.url);
    if (fs.existsSync(url)) {
      const pkg = JSON.parse(fs.readFileSync(url, 'utf8'));
      if (pkg.name === '@edspencer/cli-conformance') return { name: pkg.name, version: pkg.version };
    }
  }
  return { name: '@edspencer/cli-conformance', version: 'unknown' };
}

/** The one package installed in a prefix: `<prefix>/lib/node_modules` on POSIX, `<prefix>/node_modules` on Windows. */
function installedPackageRoot(prefix: string): string {
  const nm = process.platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules');
  const roots: string[] = [];
  for (const entry of fs.existsSync(nm) ? fs.readdirSync(nm) : []) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) for (const sub of fs.readdirSync(path.join(nm, entry))) roots.push(path.join(nm, entry, sub));
    else roots.push(path.join(nm, entry));
  }
  if (roots.length !== 1) throw new SetupError(`expected one package installed in ${nm}, found ${roots.length}`);
  return roots[0];
}

function pickBin(pkg: { name: string; bin?: string | Record<string, string> }, wanted?: string): { bin: string; file: string } {
  const bins: Record<string, string> =
    typeof pkg.bin === 'string' ? { [pkg.name.replace(/^@[^/]+\//, '')]: pkg.bin } : (pkg.bin ?? {});
  const names = Object.keys(bins);
  if (names.length === 0) throw new SetupError(`${pkg.name} has no "bin" in its package.json`);
  const bin = wanted ?? (names.length === 1 ? names[0] : undefined);
  if (!bin) throw new SetupError(`${pkg.name} has several bins (${names.join(', ')}); say which in cli-contract.json's "bin"`);
  if (!bins[bin]) throw new SetupError(`${pkg.name} has no bin named "${bin}" (it has ${names.join(', ')})`);
  return { bin, file: bins[bin] };
}

/**
 * The environment every command runs in: a throwaway home, so nothing the tool reads or writes is the real one, and
 * no colour. `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` go, so `systemctl --user` can't see the real user's
 * services. Then the config's own variables.
 */
export function sandboxEnv(base: NodeJS.ProcessEnv, dirs: { home: string; tmp: string }, extra: Config['env'] = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const k of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'FORCE_COLOR', 'npm_config_prefix', 'NPM_CONFIG_PREFIX']) delete env[k];
  Object.assign(env, {
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    XDG_CONFIG_HOME: path.join(dirs.home, '.config'),
    XDG_DATA_HOME: path.join(dirs.home, '.local', 'share'),
    XDG_STATE_HOME: path.join(dirs.home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(dirs.home, '.cache'),
    APPDATA: path.join(dirs.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(dirs.home, 'AppData', 'Local'),
    NO_COLOR: '1',
  });
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === null) delete env[k];
    else env[k] = fill(v, { ...dirs, port: '' });
  }
  return env;
}

function fill(s: string, vars: { home: string; tmp: string; port: string | number }): string {
  return s.replace(/\{(home|tmp|port)\}/g, (_, k: 'home' | 'tmp' | 'port') => String(vars[k]));
}

export async function runConformance(o: RunnerOptions): Promise<Report> {
  const log = o.log ?? (() => {});
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-conformance-'));
  const dirs = { home: path.join(work, 'home'), tmp: path.join(work, 'tmp') };
  const prefix = path.join(work, 'prefix');
  for (const d of [dirs.home, dirs.tmp, prefix]) fs.mkdirSync(d, { recursive: true });
  const npmEnv: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false' };
  let serveSession: Promise<ServeSession> | null = null;
  let updateRig: Promise<UpdateRig> | null = null;

  try {
    let spec = '';
    let sourceLabel: string;
    if (o.source.kind === 'dir') {
      const dir = path.resolve(o.source.path);
      log(`Packing ${dir}…`);
      const out = await npm(['pack', '--json', '--pack-destination', work], { cwd: dir, env: npmEnv, timeoutMs: 600_000 });
      // `prepack` scripts may print before npm's JSON; the JSON is the last thing on stdout.
      const json = out.slice(out.lastIndexOf('\n[') + 1 || out.indexOf('['));
      const filename = (JSON.parse(json) as { filename: string }[])[0].filename;
      spec = path.join(work, path.basename(filename));
      sourceLabel = `packed from ${dir}`;
    } else if (o.source.kind === 'tarball') {
      spec = path.resolve(o.source.path);
      sourceLabel = spec;
    } else {
      spec = o.source.spec;
      sourceLabel = `${spec} from the registry`;
    }

    log(`Installing ${path.basename(spec)} into a temporary prefix…`);
    await npm(['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel=error', spec], {
      cwd: work,
      env: npmEnv,
      timeoutMs: 600_000,
    });

    const root = installedPackageRoot(prefix);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const { bin, file } = pickBin(pkg, o.config.bin);
    const binFile = fs.realpathSync(path.join(root, file));
    const env = sandboxEnv(process.env, dirs, o.config.env);
    const timeoutMs = o.config.timeoutMs ?? 15_000;
    const serveTimeoutMs = o.config.serve?.timeoutMs ?? 30_000;

    // Node and the bin's real file, not the shim, as a service unit would (SPEC §7). It also means no shell on Windows.
    const ctx: CheckContext = {
      bin,
      version: pkg.version,
      name: o.config.name,
      serveTimeoutMs,
      run: (args) => run(process.execPath, [binFile, ...args], { cwd: dirs.tmp, env, timeoutMs }),
      fetch: (url) => fetch(url, { signal: AbortSignal.timeout(5000) }),
      serve: () => (serveSession ??= startServe(binFile, o.config, dirs, env, serveTimeoutMs)),
    };

    const updateCtx = {
      bin,
      name: o.config.name,
      config: o.config,
      dirs,
      serveTimeoutMs,
      rig: () =>
        (updateRig ??= createUpdateRig({
          work,
          prefix,
          root,
          binFile: file,
          name: pkg.name,
          version: pkg.version,
          source: spec,
          config: o.config,
          dirs,
          sandbox: env,
          base: process.env,
          log,
        }).catch((err: Error) => {
          throw new SetupError(`couldn't set up the update checks: ${err.message}`);
        })),
    };

    const results: CheckResult[] = [];
    for (const id of ALL_CHECK_IDS) {
      if (o.only && !o.only.includes(id)) continue;
      const setting = o.config.checks[id];
      const title = CHECK_TITLES[id];
      if (setting === undefined && OPT_IN_CHECKS.has(id)) continue;
      if (setting === undefined) {
        results.push({
          id,
          title,
          status: 'fail',
          message: `cli-contract.json doesn't list "${id}": add "${id}": true, or "${id}": { "skip": "<why>" }`,
        });
      } else if (setting !== true) {
        results.push({ id, title, status: 'skip', message: setting.skip });
      } else if (REAL_SERVICE_CHECKS.has(id) && process.env.CI_REAL_SERVICE !== '1') {
        results.push({ id, title, status: 'skip', message: 'needs a real service manager: it runs where CI_REAL_SERVICE=1 (a CI runner)' });
      } else if (REAL_SERVICE_CHECKS.has(id) && !process.env.CI) {
        results.push({
          id,
          title,
          status: 'fail',
          message: "CI_REAL_SERVICE=1 installs the tool's service under this user's real home, so it also needs CI set: use it on a CI runner",
        });
      } else {
        // `serve` is stopped first: a running instance would make `update` refuse, or answer for the service.
        if (OPT_IN_CHECKS.has(id) && serveSession) {
          await stopServe(await serveSession);
          serveSession = null;
        }
        log(`Checking ${id}…`);
        try {
          const verdict = OPT_IN_CHECKS.has(id) ? await UPDATE_CHECKS[id as UpdateCheckId](updateCtx) : await CHECKS[id as CoreCheckId](ctx);
          results.push({ id, title, ...verdict });
        } catch (err) {
          results.push({ id, title, status: 'fail', message: `the check itself failed: ${(err as Error).message}` });
        }
      }
    }

    const summary = { pass: 0, fail: 0, skip: 0 };
    for (const r of results) summary[r.status]++;
    return {
      runner: runnerPackage(),
      target: { name: pkg.name, version: pkg.version, bin, source: sourceLabel },
      ok: summary.fail === 0,
      summary,
      results,
      ...(o.keep ? { workDir: work } : {}),
    };
  } finally {
    if (serveSession) await stopServe(await serveSession);
    if (updateRig) await updateRig.then((r) => r.close(), () => {});
    if (!o.keep) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

async function startServe(binFile: string, config: Config, dirs: { home: string; tmp: string }, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<ServeSession> {
  const port = await freePort();
  const args = (config.serve?.args ?? ['serve', '--port', '{port}']).map((a) => fill(a, { ...dirs, port }));
  const child = start(process.execPath, [binFile, ...args], { cwd: dirs.tmp, env: { ...env, PORT: String(port) } });
  const session: ServeSession = { firstLine: null, stdout: '', stderr: '', exited: null, port, child };
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (session.stderr += d));
  child.on('exit', (code) => (session.exited ??= { code }));
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      session.stdout += d;
      const nl = session.stdout.indexOf('\n');
      if (session.firstLine === null && nl !== -1) {
        session.firstLine = session.stdout.slice(0, nl).replace(/\r$/, '');
        done();
      }
    });
    child.on('exit', done);
    child.on('error', done);
  });
  return session;
}

async function stopServe(s: ServeSession): Promise<void> {
  if (s.exited) return;
  const exited = new Promise<void>((r) => s.child.once('exit', () => r()));
  killTree(s.child, 'SIGTERM');
  const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 10_000));
  if ((await Promise.race([exited, timer])) === 'timeout') {
    killTree(s.child, 'SIGKILL');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  }
}
