// A small JSON Schema validator: the part of draft 2020-12 that schemas/ uses, and no more. The runner has no runtime
// dependencies, so it carries this rather than Ajv. A keyword it doesn't know is an error, not a silent pass.

import fs from 'node:fs';

export type Schema = { [keyword: string]: unknown };

export interface SchemaError {
  /** A JSON Pointer to the value, e.g. `/checks/2/status`. */
  path: string;
  message: string;
}

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description', '$defs', '$comment']);
const KNOWN = new Set([
  ...ANNOTATIONS,
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minimum',
  'maximum',
  'pattern',
  '$ref',
  'if',
  'then',
]);

export function validate(schema: Schema, value: unknown): SchemaError[] {
  const errors: SchemaError[] = [];
  check(schema, schema, value, '', errors);
  return errors;
}

/** Throws on a keyword the validator doesn't implement, so a schema can't quietly ask for more than it gets. */
export function assertSupported(schema: unknown, where = '#'): void {
  if (typeof schema !== 'object' || schema === null) return;
  for (const [k, v] of Object.entries(schema)) {
    if (!KNOWN.has(k)) throw new Error(`${where}: the validator doesn't support "${k}"`);
    if (k === 'properties' || k === '$defs') for (const [p, s] of Object.entries(v as object)) assertSupported(s, `${where}/${k}/${p}`);
    else if (k === 'items' || k === 'if' || k === 'then' || (k === 'additionalProperties' && typeof v === 'object')) assertSupported(v, `${where}/${k}`);
  }
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  return actual === t || (t === 'number' && actual === 'integer');
}

const ptr = (path: string, key: string | number) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

function resolveRef(root: Schema, ref: string): Schema {
  const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
  const defs = root.$defs as Record<string, Schema> | undefined;
  if (!m || !defs?.[m[1]]) throw new Error(`unsupported or unknown $ref: ${ref}`);
  return defs[m[1]];
}

function check(root: Schema, s: Schema, v: unknown, path: string, errors: SchemaError[]): void {
  const at = path || '/';
  if (typeof s.$ref === 'string') check(root, resolveRef(root, s.$ref), v, path, errors);
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => matchesType(v, t))) {
      errors.push({ path: at, message: `should be ${types.join(' or ')}, but is ${typeOf(v)}` });
      return;
    }
  }
  if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => e === v)) {
    errors.push({ path: at, message: `should be one of ${(s.enum as unknown[]).map((e) => JSON.stringify(e)).join(', ')}, but is ${JSON.stringify(v)}` });
  }
  if (s.const !== undefined && s.const !== v) errors.push({ path: at, message: `should be ${JSON.stringify(s.const)}` });
  if (typeof v === 'number') {
    if (typeof s.minimum === 'number' && v < s.minimum) errors.push({ path: at, message: `should be at least ${s.minimum}` });
    if (typeof s.maximum === 'number' && v > s.maximum) errors.push({ path: at, message: `should be at most ${s.maximum}` });
  }
  if (typeof v === 'string' && typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(v)) {
    errors.push({ path: at, message: `should match ${s.pattern}, but is ${JSON.stringify(v)}` });
  }
  if (Array.isArray(v) && s.items) v.forEach((item, i) => check(root, s.items as Schema, item, ptr(path, i), errors));
  if (typeOf(v) === 'object') {
    const obj = v as Record<string, unknown>;
    for (const r of (s.required as string[] | undefined) ?? []) {
      if (!(r in obj)) errors.push({ path: at, message: `is missing "${r}"` });
    }
    const props = (s.properties as Record<string, Schema> | undefined) ?? {};
    for (const [k, val] of Object.entries(obj)) {
      if (props[k]) check(root, props[k], val, ptr(path, k), errors);
      else if (s.additionalProperties === false) errors.push({ path: ptr(path, k), message: 'is not allowed here' });
      else if (typeof s.additionalProperties === 'object') check(root, s.additionalProperties as Schema, val, ptr(path, k), errors);
    }
  }
  if (s.if && s.then && validate({ ...(s.if as Schema), $defs: root.$defs }, v).length === 0) check(root, s.then as Schema, v, path, errors);
}

/** The schemas this package ships, by name: `busy`, `service-status`, `update-check`, `doctor`. */
export function loadSchema(name: string): Schema {
  // From src/ when run by tsx, from dist/src/ when built: schemas/ sits at the package root either way.
  for (const rel of ['../schemas/', '../../schemas/']) {
    const url = new URL(`${rel}${name}.schema.json`, import.meta.url);
    if (fs.existsSync(url)) return JSON.parse(fs.readFileSync(url, 'utf8')) as Schema;
  }
  throw new Error(`no schema named ${name}`);
}

export function formatErrors(errors: SchemaError[]): string {
  return errors.map((e) => `${e.path} ${e.message}`).join('; ');
}
