# @edspencer/cli-conformance

## 0.1.0

### Minor Changes

- [#3](https://github.com/edspencer/cli-contract/pull/3) [`a5df395`](https://github.com/edspencer/cli-contract/commit/a5df395ccf12c50fa9293b52b590a87f3547cdb5) Thanks [@edspencer](https://github.com/edspencer)! - The first release of the conformance runner. `npx cli-conformance` packs the tool in the current folder, installs it into a temporary prefix with a throwaway home, and runs the checks its `cli-contract.json` lists: `--version` is bare, `--help` exits 0, an unknown flag exits 2 with `<tool>: <message>` and the usage, `service status` exits 4 with nothing installed and its `--json` matches the schema, `busy` exits 3 with nothing running and its `--json` matches the schema, and `serve` prints `<Name> <version>: <url>` first and answers `/api/health` with its version. `--json` prints the report as one document. The package also ships the spec, the JSON schemas and the reference code.
