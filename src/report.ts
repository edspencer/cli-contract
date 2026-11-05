// The report, for a person.

import type { Paint } from '../reference/output.ts';
import type { Report } from './runner.ts';

const MARK = { pass: '✓', fail: '✗', skip: '-' } as const;

export function formatReport(r: Report, c: Paint): string {
  const width = Math.max(...r.results.map((x) => x.id.length), 0);
  const lines = [`${r.runner.name} ${r.runner.version}: ${r.target.name} ${r.target.version} (${r.target.source})`, ''];
  for (const x of r.results) {
    const mark = x.status === 'pass' ? c.green(MARK.pass) : x.status === 'fail' ? c.red(MARK.fail) : c.dim(MARK.skip);
    const message = x.status === 'skip' ? c.dim(`skipped: ${x.message}`) : x.message;
    lines.push(`${mark} ${x.id.padEnd(width)}  ${message}`);
    if (x.status === 'fail') {
      lines.push(`  ${' '.repeat(width)}  ${c.dim(x.title)}`);
      for (const d of x.details ?? []) lines.push(...d.split('\n').map((l) => `  ${' '.repeat(width)}  ${c.dim(l)}`));
    }
  }
  const { pass, fail, skip } = r.summary;
  lines.push('', `${pass} passed, ${fail} failed, ${skip} skipped.`);
  if (r.workDir) lines.push(`Kept the temporary folder: ${r.workDir}`);
  return `${lines.join('\n')}\n`;
}
