# reference/

Code the tools copy into their own repos (SPEC.md, AGENTS.md). Node built-ins only; Node 22.

| File | What it is | SPEC |
|---|---|---|
| `exit-codes.ts` | The shared exit codes as constants | §2 |
| `output.ts` | `<tool>: <message>` errors, colour (`NO_COLOR`, `FORCE_COLOR`, TTY), the `--json` discipline, usage errors, EPIPE | §2, §3 |
| `runtime-file.ts` | `<home>/runtime.json`: `{ pid, port, url, version, startedAt }`, written 0600 and atomically | §4 |
| `busy-client.ts` | Find the instance, ask `/api/busy`, exit 0, 75 or 3 with §4's messages; the guard for `stop`, `restart` and `update` | §4 |

Copy a file whole, and start it with:

```ts
// From edspencer/cli-contract reference/<file> @ <spec version>; local changes: none
```

Imports between these files use `.ts` extensions (compile with `rewriteRelativeImportExtensions`, or change them to
`.js` and say so in the header). The tests are in `test/`.
