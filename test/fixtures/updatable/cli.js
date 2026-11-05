#!/usr/bin/env node
// A tool built on the reference code (compiled into lib/ by the tests): `update`, `busy`, and a service whose
// "service manager" is a detached process this CLI starts itself. That's enough for every update check, rollback
// included, on any OS, without installing anything real.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardBusy, runBusyCommand } from './lib/busy-client.js';
import { EXIT } from './lib/exit-codes.js';
import { fetchHealth, waitForReady } from './lib/health.js';
import { createOutput } from './lib/output.js';
import { isPidAlive, readLiveRuntimeFile, removeRuntimeFile, writeRuntimeFile } from './lib/runtime-file.js';
import { tailFile } from './lib/service/logs.js';
import { updateSummary } from './lib/update-check.js';
import { runUpdate } from './lib/update.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const NAME = 'Fixture Updatable';
const TOOL = 'fixture-updatable';
const home = path.join(os.homedir(), '.fixture-updatable');
const unitFile = path.join(home, 'unit.json');
const pidFile = path.join(home, 'service.pid');
const logFile = path.join(home, 'logs', 'service.log');
const USAGE = `Usage: ${TOOL} [serve] [--port <n>]
       ${TOOL} service install [--port <n>] [--refresh] | uninstall | status [--json]
       ${TOOL} busy [--json]
       ${TOOL} update [--check] [--to <version|tag>] [--yes] [--force] [--json]
`;

const argv = process.argv.slice(2);
const flags = new Set();
const values = {};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (['--json', '--yes', '--force', '--check', '--refresh', '--version', '-v', '--help', '-h'].includes(a)) flags.add(a);
  else if (a === '--port' || a === '--to') values[a.slice(2)] = argv[++i];
  else if (a.startsWith('-')) {
    process.stderr.write(`${TOOL}: unknown option ${a}\n\n${USAGE}`);
    process.exit(EXIT.USAGE);
  } else words.push(a);
}
const out = createOutput({ tool: TOOL, json: flags.has('--json') });
const readUnit = () => {
  try {
    return JSON.parse(fs.readFileSync(unitFile, 'utf8'));
  } catch {
    return null;
  }
};
const servicePid = () => {
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : NaN);
  return isPidAlive(pid) ? pid : null;
};
const urlOf = (unit) => `http://127.0.0.1:${unit.port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stopService() {
  const pid = servicePid();
  if (pid !== null) {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 100 && isPidAlive(pid); i++) await sleep(100);
  }
  fs.rmSync(pidFile, { force: true });
}

async function installService() {
  const old = readUnit();
  if (flags.has('--refresh') && old === null) {
    out.say(`${NAME}'s service isn't installed.`);
    return EXIT.NOT_INSTALLED;
  }
  const unit = { node: process.execPath, cli: fs.realpathSync(process.argv[1]), port: values.port ?? old?.port ?? '4999' };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(unitFile, JSON.stringify(unit));
  await stopService();
  const fd = fs.openSync(logFile, 'a');
  const child = spawn(unit.node, [unit.cli, 'serve', '--port', unit.port], { detached: true, stdio: ['ignore', fd, fd], windowsHide: true, cwd: home });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid));
  if ((await waitForReady({ url: urlOf(unit), timeoutMs: 5000 })) === 'ready') {
    out.say(`${NAME} is installed, and running at ${urlOf(unit)}`);
    return EXIT.OK;
  }
  return out.error(`installed, but ${urlOf(unit)} didn't answer.`);
}

async function status() {
  const unit = readUnit();
  const update = updateSummary(home, { currentVersion: pkg.version });
  const doc = { installed: unit !== null, running: false, answering: false, installedVersion: null, runningVersion: null, port: null, url: null, pid: null, unit: unit ? unitFile : null, log: unit ? logFile : null, warnings: [], ...(update ? { update } : {}) };
  if (unit === null) {
    out.result(doc);
    out.say(`${NAME}'s service isn't installed.`);
    return EXIT.NOT_INSTALLED;
  }
  const pid = servicePid();
  const health = await fetchHealth({ url: urlOf(unit) });
  const installed = JSON.parse(fs.readFileSync(path.join(path.dirname(unit.cli), 'package.json'), 'utf8')).version;
  Object.assign(doc, { running: pid !== null, answering: health !== undefined, installedVersion: installed, runningVersion: health?.version ?? null, port: Number(unit.port), url: urlOf(unit), pid });
  out.result(doc);
  out.say(`${NAME} ${installed}: ${health ? `running ${health.version}` : 'not answering'}`);
  return health ? EXIT.OK : EXIT.NOT_RUNNING;
}

async function update() {
  return runUpdate(
    {
      name: NAME,
      tool: TOOL,
      packageName: pkg.name,
      envPrefix: 'FIXTURE_UPDATABLE',
      home,
      currentVersion: pkg.version,
      entry: process.argv[1],
      binSubpath: 'cli.js',
      usage: USAGE,
      changelogUrl: (v) => `https://example.test/fixture-updatable/v${v}`,
      healthTimeoutMs: 10_000,
      guardBusy: ({ force }) => guardBusy({ home, out, name: NAME, force }),
      service: {
        inspect() {
          const unit = readUnit();
          if (unit === null) {
            const live = readLiveRuntimeFile(home);
            return { installed: false, running: live !== null, ...(live ? { url: live.url } : {}) };
          }
          return { installed: true, running: servicePid() !== null, url: urlOf(unit), log: logFile };
        },
        stop() {
          const r = spawnSync(process.execPath, [process.argv[1], 'service', 'stop'], { encoding: 'utf8' });
          if (r.status !== 0) throw new Error(r.stderr || 'stop failed');
        },
        refresh(cli) {
          const r = spawnSync(process.execPath, [cli, 'service', 'install', '--refresh'], { encoding: 'utf8' });
          return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
        },
        tail: (lines) => (fs.existsSync(logFile) ? tailFile(logFile, lines) : ''),
      },
    },
    { check: flags.has('--check'), yes: flags.has('--yes'), force: flags.has('--force'), json: flags.has('--json'), ...(values.to ? { to: values.to } : {}) },
    { out },
  );
}

function serve() {
  const port = Number(values.port ?? process.env.PORT ?? 4999);
  const server = http.createServer((req, res) => {
    const body = req.url === '/api/health' ? { ok: true, version: pkg.version } : req.url === '/api/busy' ? { busy: false, version: pkg.version, counts: {} } : null;
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? {}));
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    writeRuntimeFile(home, { pid: process.pid, port, url, version: pkg.version });
    process.stdout.write(`${NAME} ${pkg.version}: ${url}\n`);
  });
  const stop = () => {
    removeRuntimeFile(home);
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

const [cmd, sub] = words;
if (flags.has('--version') || flags.has('-v')) process.stdout.write(`${pkg.version}\n`);
else if (flags.has('--help') || flags.has('-h')) process.stdout.write(USAGE);
else if (cmd === undefined || cmd === 'serve') serve();
else if (cmd === 'busy') process.exitCode = await runBusyCommand({ home, out, name: NAME });
else if (cmd === 'update' || cmd === 'upgrade') process.exitCode = await update();
else if (cmd === 'service' && sub === 'install') process.exitCode = await installService();
else if (cmd === 'service' && sub === 'status') process.exitCode = await status();
else if (cmd === 'service' && sub === 'stop') await stopService();
else if (cmd === 'service' && sub === 'uninstall') {
  await stopService();
  fs.rmSync(unitFile, { force: true });
} else {
  process.stderr.write(`${TOOL}: unknown command ${words.join(' ')}\n\n${USAGE}`);
  process.exitCode = EXIT.USAGE;
}
