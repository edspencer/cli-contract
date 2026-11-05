#!/usr/bin/env node
// A tool that gets each checked part of the contract wrong.
import http from 'node:http';

const args = process.argv.slice(2);
const json = args.includes('--json');

if (args[0] === '--version') process.stdout.write('fixture-broken v0.9.0\n'); // not bare
else if (args[0] === '-v') process.stdout.write('0.9.0\n');
else if (args[0] === '--help' || args[0] === '-h') {
  process.stderr.write('Usage: fixture-broken\n'); // usage on stderr, and exit 1
  process.exitCode = 1;
} else if (args[0] === 'service' && args[1] === 'status') {
  if (json) process.stdout.write('Service status:\n{"installed": false}\n'); // prose on stdout under --json
  else process.stdout.write('not installed\n'); // exit 0
} else if (args[0] === 'busy') {
  if (json) process.stdout.write(`${JSON.stringify({ running: false, busy: 'no' })}\n`); // fails the schema
  process.exitCode = 3;
} else if (args[0] === 'serve') {
  const port = Number(args[args.indexOf('--port') + 1]);
  http
    .createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')) // no version
    .listen(port, '127.0.0.1', () => process.stdout.write(`Listening on ${port}\n`));
} else {
  // An unknown flag is ignored, and it serves: the runner's timeout has to catch it.
  setInterval(() => {}, 1000);
}
