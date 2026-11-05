// `cli-contract.json`: which checks apply to a tool, and why any don't.

import fs from 'node:fs';
import { CHECK_IDS, type CheckId } from './checks.ts';
import { formatErrors, loadSchema, validate } from './schema.ts';

export type CheckSetting = true | { skip: string };

export interface ServeConfig {
  /** The arguments that start it in the foreground. `{port}`, `{home}` and `{tmp}` are filled in. */
  args: string[];
  /** How long to wait for the first line and for /api/health. */
  timeoutMs?: number;
}

export interface Config {
  /** The product's name, as `serve`'s first line says it: `Local Review`. */
  name: string;
  /** Which bin to run, when the package has more than one. */
  bin?: string;
  /** Extra environment for every command. `null` removes a variable. `{home}` and `{tmp}` are filled in. */
  env?: Record<string, string | null>;
  /** How long each command may take before it's killed. Default 15 s. */
  timeoutMs?: number;
  serve?: ServeConfig;
  checks: Partial<Record<CheckId, CheckSetting>>;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function parseConfig(text: string, file: string): Config {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${file} isn't valid JSON: ${(err as Error).message}`);
  }
  const errors = validate(loadSchema('cli-contract'), doc);
  if (errors.length) throw new ConfigError(`${file} doesn't match the schema: ${formatErrors(errors)}`);
  const config = doc as Config;
  for (const id of Object.keys(config.checks)) {
    if (!CHECK_IDS.includes(id as CheckId)) {
      throw new ConfigError(`${file} lists a check this runner doesn't have: "${id}". The checks are: ${CHECK_IDS.join(', ')}.`);
    }
  }
  for (const [id, s] of Object.entries(config.checks)) {
    if (typeof s === 'object' && !s.skip.trim()) throw new ConfigError(`${file}: "${id}" is skipped without a reason`);
  }
  return config;
}

export function readConfig(file: string): Config {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new ConfigError(`no ${file}. Each tool keeps a cli-contract.json at its root, saying which checks apply (README.md).`);
  }
  return parseConfig(text, file);
}
