# @edspencer/cli-conformance

## 0.2.1

### Patch Changes

- [#9](https://github.com/edspencer/cli-contract/pull/9) [`2cf2bc2`](https://github.com/edspencer/cli-contract/commit/2cf2bc23b30d560f0fc76452ee097ca0ec0de0a5) Thanks [@edspencer](https://github.com/edspencer)! - The package now ships SPEC 1.0. Nothing a tool must do changed from 0.2; the wording of §5 "Without a service" now matches step 9 (a foreground `serve` that's answering makes `update` exit 3 before it installs), and §7 says that when `loginctl` can't answer, `install` prints nothing about linger and `doctor` reports the check as skipped. `reference/service/index.ts`'s `lingerAdvice` follows: it returns nothing unless linger is off.

## 0.2.0

### Minor Changes

- [#5](https://github.com/edspencer/cli-contract/pull/5) [`21dce70`](https://github.com/edspencer/cli-contract/commit/21dce703b868678cb8bd7b1b1564919e31b74da1) Thanks [@edspencer](https://github.com/edspencer)! - Opt-in `update` checks, against a local registry serving two more builds of the tool (a version higher, and one whose `serve` fails): up to date, `--check --json` against the schema, no TTY without `--yes`, busy, an npx cache, a checkout, a read-only global folder, an update, `--to` a lower version, and, where `CI_REAL_SERVICE=1` and `CI` are set, an update with the service installed and a rollback to exit 6. A tool lists them in `cli-contract.json` when it has `update`, with an `update` section for its `runtime.json` and how to install its service. The package now ships `reference/`'s update and `service/` code too.

## 0.1.0

### Minor Changes

- [#3](https://github.com/edspencer/cli-contract/pull/3) [`a5df395`](https://github.com/edspencer/cli-contract/commit/a5df395ccf12c50fa9293b52b590a87f3547cdb5) Thanks [@edspencer](https://github.com/edspencer)! - The first release of the conformance runner. `npx cli-conformance` packs the tool in the current folder, installs it into a temporary prefix with a throwaway home, and runs the checks its `cli-contract.json` lists: `--version` is bare, `--help` exits 0, an unknown flag exits 2 with `<tool>: <message>` and the usage, `service status` exits 4 with nothing installed and its `--json` matches the schema, `busy` exits 3 with nothing running and its `--json` matches the schema, and `serve` prints `<Name> <version>: <url>` first and answers `/api/health` with its version. `--json` prints the report as one document. The package also ships the spec, the JSON schemas and the reference code.
