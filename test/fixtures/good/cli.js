#!/usr/bin/env node
// A tool that follows the contract, as far as the runner's checks go.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const USAGE = 'Usage: fixture-good [serve] [--port <n>]\n       fixture-good service status [--json]\n       fixture-good busy [--json]\n';
const home = path.join(os.homedir(), '.fixture-good');
const args = process.argv.slice(2);
const json = args.includes('--json');

if (args[0] === '--version' || args[0] === '-v') process.stdout.write(`${VERSION}\n`);
else if (args[0] === '--help' || args[0] === '-h') process.stdout.write(USAGE);
else if (args[0] === 'service' && args[1] === 'status') {
  const unit = path.join(os.homedir(), '.config', 'systemd', 'user', 'fixture-good.service');
  const installed = fs.existsSync(unit);
  if (json) {
    process.stdout.write(`${JSON.stringify({ installed, running: false, answering: false, installedVersion: null, runningVersion: null, port: null, url: null, pid: null, unit: installed ? unit : null, log: null, warnings: [] })}\n`);
  } else process.stdout.write('Service: not installed\n');
  process.exitCode = installed ? 3 : 4;
} else if (args[0] === 'busy') {
  const running = fs.existsSync(path.join(home, 'runtime.json'));
  if (json) process.stdout.write(`${JSON.stringify({ running, busy: false })}\n`);
  else process.stderr.write("Fixture isn't running.\n");
  process.exitCode = running ? 0 : 3;
} else if (args.length === 0 || args[0] === 'serve' || args[0].startsWith('--port')) {
  const rest = args[0] === 'serve' ? args.slice(1) : args;
  const i = rest.indexOf('--port');
  const port = Number(i === -1 ? process.env.PORT ?? 4999 : rest[i + 1]);
  const server = http.createServer((req, res) => {
    if (req.url === '/api/health') res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, version: VERSION }));
    else res.writeHead(404).end();
  });
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Fixture Good ${VERSION}: http://127.0.0.1:${port}\n`));
  process.on('SIGTERM', () => server.close(() => (process.exitCode = 0)));
} else {
  process.stderr.write(`fixture-good: unknown option ${args[0]}\n\n${USAGE}`);
  process.exitCode = 2;
}
