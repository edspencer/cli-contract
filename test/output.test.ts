import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createOutput, exitQuietlyOnEpipe, paint, reportUsageError, UsageError, useColor } from '../reference/output.ts';
import { capture } from './helpers.ts';

test('colour: only on a TTY, NO_COLOR wins, FORCE_COLOR forces, TERM=dumb never', () => {
  assert.equal(useColor({ write() {}, isTTY: true }, {}), true);
  assert.equal(useColor({ write() {}, isTTY: false }, {}), false);
  assert.equal(useColor({ write() {} }, {}), false);
  assert.equal(useColor({ write() {}, isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(useColor({ write() {}, isTTY: true }, { NO_COLOR: '' }), true, 'an empty NO_COLOR is unset');
  assert.equal(useColor({ write() {}, isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' }), false);
  assert.equal(useColor({ write() {}, isTTY: false }, { FORCE_COLOR: '1' }), true);
  assert.equal(useColor({ write() {}, isTTY: true }, { FORCE_COLOR: '0' }), false);
  assert.equal(useColor({ write() {}, isTTY: true }, { TERM: 'dumb' }), false);
});

test('paint does nothing when off', () => {
  assert.equal(paint(false).red('x'), 'x');
  assert.equal(paint(true).red('x'), '\u001b[31mx\u001b[39m');
});

test('without --json, prose goes to stdout and errors to stderr as `<tool>: <message>`', () => {
  const stdout = capture();
  const stderr = capture();
  const out = createOutput({ tool: 'paddock', stdout, stderr, env: {} });
  out.say('Paddock is running.');
  out.result({ ignored: true });
  assert.equal(out.error("Paddock isn't installed as a service.", 4), 4);
  assert.equal(stdout.text, 'Paddock is running.\n');
  assert.equal(stderr.text, "paddock: Paddock isn't installed as a service.\n");
});

test('with --json, stdout carries one document and nothing else', () => {
  const stdout = capture(true);
  const stderr = capture();
  const out = createOutput({ tool: 'paddock', json: true, stdout, stderr, env: { FORCE_COLOR: '1' } });
  out.say('progress');
  out.warn('a warning');
  out.result({ ok: true });
  assert.equal(JSON.parse(stdout.text).ok, true);
  assert.equal(stderr.text, 'progress\na warning\n');
  assert.equal(out.color.bold('x'), 'x', 'no colour for stdout under --json');
  assert.throws(() => out.result({}), /one document/);
});

test('a usage error prints the message, then the usage, and is exit 2', () => {
  const stderr = capture();
  const out = createOutput({ tool: 'localidraw', stdout: capture(), stderr, env: {} });
  const code = reportUsageError(out, new UsageError('unknown option --nope'), 'Usage: localidraw [folder]\n');
  assert.equal(code, 2);
  assert.equal(stderr.text, 'localidraw: unknown option --nope\n\nUsage: localidraw [folder]\n');
});

test('EPIPE exits quietly with the exit code so far; other errors still throw', () => {
  const stream = new EventEmitter() as unknown as NodeJS.WriteStream;
  const codes: number[] = [];
  exitQuietlyOnEpipe(stream, (c) => codes.push(c));
  const saved = process.exitCode;
  process.exitCode = 3;
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  process.exitCode = saved;
  assert.deepEqual(codes, [3]);
  assert.throws(() => stream.emit('error', Object.assign(new Error('nope'), { code: 'EIO' })), /nope/);
});
