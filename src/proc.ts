// Running the tool under test, and npm, without a shell (SPEC §7: Windows stays possible).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface RunResult {
  /** null when it was killed, by a signal or the timeout. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

export interface RunOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** Starts a process in its own group (POSIX), so it and anything it starts can be stopped together. */
export function start(cmd: string, args: string[], o: Omit<RunOptions, 'timeoutMs'>): ChildProcess {
  return spawn(cmd, args, {
    cwd: o.cwd,
    env: o.env,
    // stdin is never a TTY: a tool that would ask must refuse instead (SPEC §3).
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
}

/** Signals the process and its children. On Windows there's no SIGTERM: taskkill ends the tree. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

/** Runs a command to completion, or kills it at the timeout. Never rejects for a non-zero exit. */
export function run(cmd: string, args: string[], o: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const began = Date.now();
    const child = start(cmd, args, o);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, 'SIGKILL');
    }, o.timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr, timedOut, ms: Date.now() - began });
    });
  });
}

/** How to run npm without a shell: Node and npm-cli.js, found next to this Node. Falls back to `npm` on the PATH. */
export function npmCommand(env: NodeJS.ProcessEnv = process.env): { cmd: string; pre: string[]; shell: boolean } {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    env.npm_execpath && path.basename(env.npm_execpath) === 'npm-cli.js' ? env.npm_execpath : '',
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // POSIX
  ];
  const cli = candidates.find((c) => c && fs.existsSync(c));
  if (cli) return { cmd: process.execPath, pre: [cli], shell: false };
  return { cmd: process.platform === 'win32' ? 'npm.cmd' : 'npm', pre: [], shell: process.platform === 'win32' };
}

/** Runs npm and resolves with its output; rejects with npm's stderr if it fails. */
export async function npm(args: string[], o: RunOptions): Promise<string> {
  const { cmd, pre, shell } = npmCommand(o.env);
  if (shell) {
    // Only reached on Windows without npm-cli.js beside Node. Quote every word for cmd.exe.
    const r = spawnSync([cmd, ...args].map((a) => `"${a.replace(/"/g, '""')}"`).join(' '), {
      cwd: o.cwd,
      env: o.env,
      shell: true,
      encoding: 'utf8',
      timeout: o.timeoutMs,
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`npm ${args[0]} failed:\n${r.stderr || r.stdout}`);
    return r.stdout;
  }
  const r = await run(cmd, [...pre, ...args], o);
  if (r.code !== 0) throw new Error(`npm ${args[0]} ${r.timedOut ? 'timed out' : 'failed'}:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** A port nothing is listening on, just now. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}
