---
"@edspencer/cli-conformance": minor
---

Opt-in `update` checks, against a local registry serving two more builds of the tool (a version higher, and one whose `serve` fails): up to date, `--check --json` against the schema, no TTY without `--yes`, busy, an npx cache, a checkout, a read-only global folder, an update, `--to` a lower version, and, where `CI_REAL_SERVICE=1` and `CI` are set, an update with the service installed and a rollback to exit 6. A tool lists them in `cli-contract.json` when it has `update`, with an `update` section for its `runtime.json` and how to install its service. The package now ships `reference/`'s update and `service/` code too.
