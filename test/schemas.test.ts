import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertSupported, formatErrors, loadSchema, validate } from '../src/schema.ts';
import { busyJson } from '../reference/busy-client.ts';

const names = fs.readdirSync(new URL('../schemas/', import.meta.url)).map((f) => f.replace(/\.schema\.json$/, ''));

test('there is a schema for each --json the spec requires', () => {
  assert.deepEqual(names.sort(), ['busy', 'cli-contract', 'doctor', 'service-status', 'update-check']);
});

for (const name of names) {
  test(`${name}: uses only what the validator supports`, () => assertSupported(loadSchema(name)));
}

const ok = (name: string, doc: unknown) => assert.deepEqual(validate(loadSchema(name), doc), [], `${name}: ${JSON.stringify(doc)}`);
const bad = (name: string, doc: unknown, re: RegExp) => assert.match(formatErrors(validate(loadSchema(name), doc)), re);

test('service-status', () => {
  const none = {
    installed: false, running: false, answering: false, installedVersion: null, runningVersion: null,
    port: null, url: null, pid: null, unit: null, log: null, warnings: [],
  };
  ok('service-status', none);
  ok('service-status', {
    ...none, installed: true, running: true, answering: true, installedVersion: '0.79.1', runningVersion: '0.79.1',
    port: 3000, url: 'http://127.0.0.1:3000', pid: 4242, unit: '/home/u/.config/systemd/user/paddock.service',
    log: '/home/u/.paddock/logs/service.log', warnings: ['the unit names a Node that has gone'],
    busy: { busy: true, counts: { chat: 2 } }, update: { latest: '0.80.0', updateAvailable: true, checkedAt: '2026-11-04T00:00:00Z' },
    loaded: true, // a tool's own field
  });
  bad('service-status', { installed: false }, /missing "running"/);
  bad('service-status', { ...none, port: 70000 }, /\/port should be at most 65535/);
  bad('service-status', { ...none, pid: '12' }, /\/pid should be integer or null, but is string/);
  bad('service-status', { ...none, busy: { busy: true, counts: { chat: -1 } } }, /\/busy\/counts\/chat should be at least 0/);
});

test('busy, including what the reference client prints', () => {
  ok('busy', busyJson({ state: 'not-running' }));
  ok('busy', busyJson({ state: 'busy', url: 'http://127.0.0.1:1/api/busy', answer: { busy: true, version: '1.0.0', counts: { chat: 1 } } }));
  ok('busy', busyJson({ state: 'unknown', url: 'http://127.0.0.1:1/api/busy', detail: 'HTTP 404' }));
  bad('busy', { running: true }, /missing "busy"/);
  bad('busy', { running: true, busy: true, counts: { chat: 1.5 } }, /chat should be integer/);
});

test('update-check', () => {
  const doc = {
    name: '@edspencer/paddock', current: '0.79.1', target: '0.80.0', tag: 'latest', updateAvailable: true,
    installMethod: 'npm-global', canUpdate: true, command: 'paddock update', engines: '>=22', nodeOk: true,
    changelog: 'https://github.com/edspencer/paddock/releases/tag/v0.80.0', checkedAt: '2026-11-04T00:00:00Z',
  };
  ok('update-check', doc);
  ok('update-check', { ...doc, installMethod: 'docker', canUpdate: false, command: 'docker compose pull && docker compose up -d' });
  bad('update-check', { ...doc, installMethod: 'homebrew' }, /installMethod should be one of/);
  bad('update-check', { ...doc, changelog: 'http://x' }, /changelog should match/);
});

test('doctor: a failure needs a fix', () => {
  ok('doctor', { ok: true, checks: [{ id: 'node-engines', status: 'pass', message: 'Node 22.23.4 satisfies >=22' }] });
  ok('doctor', { ok: false, checks: [{ id: 'linger', status: 'fail', message: 'linger is off', fix: 'sudo loginctl enable-linger u' }] });
  bad('doctor', { ok: false, checks: [{ id: 'linger', status: 'fail', message: 'linger is off' }] }, /\/checks\/0 is missing "fix"/);
  bad('doctor', { ok: true, checks: [{ id: 'Bad Id', status: 'ok', message: '' }] }, /id should match.*status should be one of/);
});

test('the validator refuses keywords it does not implement', () => {
  assert.throws(() => assertSupported({ type: 'object', properties: { a: { oneOf: [] } } }), /#\/properties\/a: .*"oneOf"/);
});
