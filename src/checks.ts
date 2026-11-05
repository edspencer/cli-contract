// The checks, each against the installed package, from the outside: exit codes, stdout, stderr and HTTP.

import type { ChildProcess } from 'node:child_process';
import { describeExitCode, EXIT } from '../reference/exit-codes.ts';
import { formatErrors, loadSchema, validate } from './schema.ts';
import type { RunResult } from './proc.ts';
import { UPDATE_CHECK_IDS, UPDATE_CHECK_TITLES, type UpdateCheckId } from './update-checks.ts';

export const CHECK_IDS = [
  'version',
  'help',
  'unknown-flag',
  'service-status',
  'service-status-json',
  'busy',
  'busy-json',
  'serve-banner',
  'serve-health',
] as const;

/** The checks every tool lists. The `update` checks (update-checks.ts) are opt-in. */
export type CoreCheckId = (typeof CHECK_IDS)[number];

export const CORE_CHECK_TITLES: Record<CoreCheckId, string> = {
  version: '`--version` and `-v` print the bare version (SPEC §1)',
  help: '`--help` and `-h` print usage and exit 0 (SPEC §1)',
  'unknown-flag': 'an unknown flag exits 2, with `<tool>: <message>` and then the usage on stderr (SPEC §2, §3)',
  'service-status': '`service status` exits 4 when nothing is installed (SPEC §2)',
  'service-status-json': "`service status --json` exits 4 and prints one document matching the schema (SPEC §1)",
  busy: '`busy` exits 3 when nothing is running (SPEC §4)',
  'busy-json': '`busy --json` exits 3 and prints one document matching the schema (SPEC §4)',
  'serve-banner': "`serve`'s first stdout line is `<Name> <version>: <url>` (SPEC §3)",
  'serve-health': '`serve` answers `/api/health` with `{ ok: true, version }` (SPEC §8)',
};

export type CheckId = CoreCheckId | UpdateCheckId;

/** Every check, in the order they run. */
export const ALL_CHECK_IDS: readonly CheckId[] = [...CHECK_IDS, ...UPDATE_CHECK_IDS];

/** Checks a tool may leave out of cli-contract.json: they're not run, and not reported. */
export const OPT_IN_CHECKS: ReadonlySet<CheckId> = new Set(UPDATE_CHECK_IDS);

export const CHECK_TITLES: Record<CheckId, string> = { ...CORE_CHECK_TITLES, ...UPDATE_CHECK_TITLES };

export type Status = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  id: CheckId;
  title: string;
  status: Status;
  /** One line: what was found. For a skip, the reason. */
  message: string;
  /** Evidence for a failure: the output, trimmed. */
  details?: string[];
}

export interface ServeSession {
  /** The first stdout line, or null if none came in time. */
  firstLine: string | null;
  stdout: string;
  stderr: string;
  /** The process exited before it printed a line or answered. */
  exited: { code: number | null } | null;
  port: number;
  child: ChildProcess;
}

export interface CheckContext {
  bin: string;
  version: string;
  name: string;
  /** Runs `<bin> <args>` in the sandbox. */
  run(args: string[]): Promise<RunResult>;
  /** Starts `serve` once and shares it between the checks that need it. */
  serve(): Promise<ServeSession>;
  /** Fetches a URL with a timeout. */
  fetch(url: string): Promise<Response>;
  serveTimeoutMs: number;
}

/** A check's verdict before its id and title are added. */
type Verdict = { status: 'pass' | 'fail'; message: string; details?: string[] };

const pass = (message: string): Verdict => ({ status: 'pass', message });
const fail = (message: string, details?: string[]): Verdict => ({ status: 'fail', message, details });

const show = (s: string) => JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s);

/** The output of a run, for a failure's details. */
function evidence(r: RunResult): string[] {
  const out: string[] = [];
  if (r.stdout.trim()) out.push(`stdout: ${r.stdout.trimEnd().split('\n').slice(0, 8).join('\n        ')}`);
  if (r.stderr.trim()) out.push(`stderr: ${r.stderr.trimEnd().split('\n').slice(0, 8).join('\n        ')}`);
  return out;
}

function exitedWith(r: RunResult, args: string[]): string {
  if (r.timedOut) return `\`${args.join(' ')}\` was still running after ${Math.round(r.ms / 1000)} s, and was killed`;
  return `\`${args.join(' ')}\` exited ${describeExitCode(r.code)}`;
}

/** Fails unless the run exited with `want`. */
function expectCode(r: RunResult, args: string[], want: number): Verdict | null {
  if (r.code === want) return null;
  return fail(`${exitedWith(r, args)}; expected ${describeExitCode(want)}`, evidence(r));
}

/** Parses stdout as exactly one JSON document. */
function oneDocument(r: RunResult, args: string[]): { doc: unknown } | Verdict {
  if (!r.stdout.trim()) return fail(`\`${args.join(' ')}\` printed nothing on stdout; expected one JSON document`, evidence(r));
  try {
    return { doc: JSON.parse(r.stdout) };
  } catch {
    return fail(`\`${args.join(' ')}\`'s stdout isn't one JSON document (prose belongs on stderr)`, evidence(r));
  }
}

function matchesSchema(doc: unknown, schema: string, args: string[]): Verdict | null {
  const errors = validate(loadSchema(schema), doc);
  if (errors.length === 0) return null;
  return fail(`\`${args.join(' ')}\` doesn't match schemas/${schema}.schema.json: ${formatErrors(errors)}`, [`stdout: ${JSON.stringify(doc)}`]);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const CHECKS: Record<CoreCheckId, (ctx: CheckContext) => Promise<Verdict>> = {
  async version(ctx) {
    for (const flag of ['--version', '-v']) {
      const r = await ctx.run([flag]);
      const bad = expectCode(r, [flag], EXIT.OK);
      if (bad) return bad;
      if (r.stdout.replace(/\r\n/g, '\n') !== `${ctx.version}\n`) {
        return fail(`\`${flag}\` printed ${show(r.stdout)}; expected ${show(`${ctx.version}\n`)} and nothing else`, evidence(r));
      }
    }
    return pass(`--version and -v print ${ctx.version}`);
  },

  async help(ctx) {
    for (const flag of ['--help', '-h']) {
      const r = await ctx.run([flag]);
      const bad = expectCode(r, [flag], EXIT.OK);
      if (bad) return bad;
      if (!r.stdout.trim()) return fail(`\`${flag}\` printed nothing on stdout; the usage goes there`, evidence(r));
    }
    return pass('--help and -h print usage and exit 0');
  },

  async 'unknown-flag'(ctx) {
    const args = ['--no-such-flag-cli-conformance'];
    const r = await ctx.run(args);
    const bad = expectCode(r, args, EXIT.USAGE);
    if (bad) return bad;
    const lines = r.stderr.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (!lines[0]?.startsWith(`${ctx.bin}: `)) {
      return fail(`stderr's first line is ${show(lines[0] ?? '')}; expected \`${ctx.bin}: <message>\``, evidence(r));
    }
    if (lines.length < 2) return fail('stderr has the message but no usage after it', evidence(r));
    return pass(`exits 2 with ${show(lines[0])}, then the usage`);
  },

  async 'service-status'(ctx) {
    const args = ['service', 'status'];
    const r = await ctx.run(args);
    return expectCode(r, args, EXIT.NOT_INSTALLED) ?? pass('exits 4 with nothing installed');
  },

  async 'service-status-json'(ctx) {
    const args = ['service', 'status', '--json'];
    const r = await ctx.run(args);
    const bad = expectCode(r, args, EXIT.NOT_INSTALLED);
    if (bad) return bad;
    const parsed = oneDocument(r, args);
    if ('status' in parsed) return parsed;
    const invalid = matchesSchema(parsed.doc, 'service-status', args);
    if (invalid) return invalid;
    const doc = parsed.doc as { installed: boolean; running: boolean };
    if (doc.installed || doc.running) return fail(`says installed: ${doc.installed}, running: ${doc.running}, with nothing installed`);
    return pass('exits 4, and the document matches the schema');
  },

  async busy(ctx) {
    const args = ['busy'];
    const r = await ctx.run(args);
    return expectCode(r, args, EXIT.NOT_RUNNING) ?? pass('exits 3 with nothing running');
  },

  async 'busy-json'(ctx) {
    const args = ['busy', '--json'];
    const r = await ctx.run(args);
    const bad = expectCode(r, args, EXIT.NOT_RUNNING);
    if (bad) return bad;
    const parsed = oneDocument(r, args);
    if ('status' in parsed) return parsed;
    const invalid = matchesSchema(parsed.doc, 'busy', args);
    if (invalid) return invalid;
    if ((parsed.doc as { running: boolean }).running) return fail('says running: true with nothing running');
    return pass('exits 3, and the document matches the schema');
  },

  async 'serve-banner'(ctx) {
    const s = await ctx.serve();
    if (s.firstLine === null) return serveNoLine(s, ctx);
    const re = new RegExp(`^${escapeRe(ctx.name)} ${escapeRe(ctx.version)}: (https?://\\S+)$`);
    if (!re.test(s.firstLine)) {
      return fail(`the first line is ${show(s.firstLine)}; expected ${show(`${ctx.name} ${ctx.version}: <url>`)}`);
    }
    return pass(`the first line is ${show(s.firstLine)}`);
  },

  async 'serve-health'(ctx) {
    const s = await ctx.serve();
    if (s.exited) return serveNoLine(s, ctx);
    const fromBanner = s.firstLine ? /(https?:\/\/\S+)\s*$/.exec(s.firstLine)?.[1] : undefined;
    const base = fromBanner ?? `http://127.0.0.1:${s.port}`;
    const url = new URL('/api/health', base).toString();
    const deadline = Date.now() + ctx.serveTimeoutMs;
    let last = '';
    while (Date.now() < deadline) {
      try {
        const res = await ctx.fetch(url);
        const text = await res.text();
        if (res.status !== 200) return fail(`GET ${url} answered HTTP ${res.status}; expected 200`, [`body: ${text.slice(0, 200)}`]);
        let body: { ok?: unknown; version?: unknown };
        try {
          body = JSON.parse(text);
        } catch {
          return fail(`GET ${url} didn't answer JSON`, [`body: ${text.slice(0, 200)}`]);
        }
        if (body.ok !== true) return fail(`GET ${url} answered without "ok": true`, [`body: ${text.slice(0, 200)}`]);
        if (body.version !== ctx.version) {
          return fail(`GET ${url} answered version ${JSON.stringify(body.version)}; expected "${ctx.version}"`, [`body: ${text.slice(0, 200)}`]);
        }
        return pass(`GET ${url} answers { ok: true, version: "${ctx.version}" }`);
      } catch (err) {
        last = (err as Error).message;
        if (s.exited) return serveNoLine(s, ctx);
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return fail(`nothing answered GET ${url} within ${ctx.serveTimeoutMs / 1000} s (${last})`, serveEvidence(s));
  },
};

function serveEvidence(s: ServeSession): string[] {
  return evidence({ code: s.exited?.code ?? null, stdout: s.stdout, stderr: s.stderr, timedOut: false, ms: 0 });
}

function serveNoLine(s: ServeSession, ctx: CheckContext): Verdict {
  if (s.exited) return fail(`\`serve\` exited ${describeExitCode(s.exited.code)} before it was ready`, serveEvidence(s));
  return fail(`\`serve\` printed no line on stdout within ${ctx.serveTimeoutMs / 1000} s`, serveEvidence(s));
}
