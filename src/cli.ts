#!/usr/bin/env node
// cli-conformance: checks a tool against the CLI contract from the outside.

import path from 'node:path';
import { parseArgs } from 'node:util';
import { EXIT } from '../reference/exit-codes.ts';
import { createOutput, exitQuietlyOnEpipe, reportUsageError, UsageError, type Output } from '../reference/output.ts';
import { CHECK_IDS, type CheckId } from './checks.ts';
import { ConfigError, readConfig } from './config.ts';
import { formatReport } from './report.ts';
import { runConformance, runnerPackage, SetupError, type Source } from './runner.ts';

const USAGE = `Usage: cli-conformance [options]

Packs the tool in this folder, installs it into a temporary prefix, and runs the checks its
cli-contract.json lists.

Options:
  --dir <path>        the tool's checkout (default: this folder)
  --package <spec>    install this from the registry instead of packing (localidraw@latest)
  --tarball <file>    install this tarball instead of packing
  --config <file>     the settings (default: <dir>/cli-contract.json; needed with --package)
  --only <ids>        run only these checks, comma-separated
  --json              print the report as one JSON document on stdout
  --keep              keep the temporary folder and print where it is
  -v, --version       print the version
  -h, --help          print this

Checks: ${CHECK_IDS.join(', ')}

Exit codes: 0 every check passed or was skipped, 1 a check failed or the tool couldn't be
installed, 2 a usage or cli-contract.json error.
`;

export async function main(argv: string[], out: Output | null = null): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        dir: { type: 'string' },
        package: { type: 'string' },
        tarball: { type: 'string' },
        config: { type: 'string' },
        only: { type: 'string' },
        json: { type: 'boolean' },
        keep: { type: 'boolean' },
        version: { type: 'boolean', short: 'v' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return reportUsageError(out ?? createOutput({ tool: 'cli-conformance' }), new UsageError((err as Error).message), USAGE);
  }
  const o = out ?? createOutput({ tool: 'cli-conformance', json: values.json });

  try {
    if (values.version) {
      process.stdout.write(`${runnerPackage().version}\n`);
      return EXIT.OK;
    }
    if (values.help) {
      process.stdout.write(USAGE);
      return EXIT.OK;
    }
    if ([values.dir, values.package, values.tarball].filter(Boolean).length > 1) {
      throw new UsageError('give one of --dir, --package and --tarball');
    }
    const dir = path.resolve(values.dir ?? '.');
    if ((values.package || values.tarball) && !values.config) {
      throw new UsageError('--package and --tarball need --config: there is no checkout to find cli-contract.json in');
    }
    const only = values.only?.split(',').map((s) => s.trim()).filter(Boolean);
    for (const id of only ?? []) {
      if (!CHECK_IDS.includes(id as CheckId)) throw new UsageError(`--only: no check named "${id}"`);
    }

    const config = readConfig(values.config ? path.resolve(values.config) : path.join(dir, 'cli-contract.json'));
    const source: Source = values.package
      ? { kind: 'package', spec: values.package }
      : values.tarball
        ? { kind: 'tarball', path: values.tarball }
        : { kind: 'dir', path: dir };

    const report = await runConformance({
      source,
      config,
      only: only as CheckId[] | undefined,
      keep: values.keep,
      log: (line) => process.stderr.write(`${line}\n`),
    });
    if (o.json) o.result(report);
    else process.stdout.write(formatReport(report, o.color));
    return report.ok ? EXIT.OK : EXIT.FAILED;
  } catch (err) {
    if (err instanceof UsageError) return reportUsageError(o, err, USAGE);
    if (err instanceof ConfigError) return o.error(err.message, EXIT.USAGE);
    if (err instanceof SetupError) return o.error(err.message, EXIT.FAILED);
    return o.error((err as Error).message, EXIT.FAILED);
  }
}

exitQuietlyOnEpipe();
process.exitCode = await main(process.argv.slice(2));
