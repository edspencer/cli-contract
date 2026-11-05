# reference/

Code the tools copy into their own repos (SPEC.md, AGENTS.md). Node built-ins only; Node 22.

| File | What it is | SPEC |
|---|---|---|
| `exit-codes.ts` | The shared exit codes as constants | §2 |
| `output.ts` | `<tool>: <message>` errors, colour (`NO_COLOR`, `FORCE_COLOR`, TTY), the `--json` discipline, usage errors, EPIPE | §2, §3 |
| `runtime-file.ts` | `<home>/runtime.json`: `{ pid, port, url, version, startedAt }`, written 0600 and atomically | §4 |
| `busy-client.ts` | Find the instance, ask `/api/busy`, exit 0, 75 or 3 with §4's messages; the guard for `stop`, `restart` and `update` | §4 |
| `semver.ts` | Compare versions (prereleases too), and read an `engines.node` range; a range it can't read is a pass | §5 step 4 |
| `install-method.ts` | Which of §6's ten rows this install is, and the command to print for it | §6 |
| `registry.ts` | The dist-tags and one version's manifest, with `fetch` and a 10-second abort; `--to` as a version or a tag | §5 step 3 |
| `lock.ts` | `<home>/update.lock`, `O_EXCL`, holding the pid; a stale one is removed | §5 step 1 |
| `package-manager.ts` | The npm beside this Node, run as `node npm-cli.js` with no shell; installs, `npm cache add`, the writability probe | §5 steps 5, 8, 10 |
| `update-check.ts` | `<home>/update-check.json`, what `service status` repeats, and §3's notice | §3 |
| `health.ts` | Ask `/api/health`, wait for it, or wait for one version | §5 step 12, §8 |
| `update.ts` | `update`, the whole of §5, over a tool's hooks (`UpdateProduct`) and the machine (`UpdateEnvironment`) | §5 |
| `service/manager.ts` | The `ServiceManager` interface, the spec a unit is written from, the Runner | §7 |
| `service/launchd.ts` | macOS: the plist, and bootout/bootstrap with the race fix | §7 |
| `service/systemd.ts` | Linux: the unit, escaping, `enable --now` then a restart if it was active, linger | §7 |
| `service/spec.ts`, `service/path-env.ts` | `<home>/service`, `<home>/logs/service.log`, the realpath'd spec, the service's PATH | §7 |
| `service/logs.ts` | `logs`: the last lines, and following through a rotation | §1, §7 |
| `service/rotate.ts` | Rotating `service.log` by copy and truncate, at boot and on an unref'd timer (from Paddock) | §7 |
| `service/index.ts` | The manager for this OS (Windows throws, for now), and the linger advice | §7 |

Copy a file whole, and start it with:

```ts
// From edspencer/cli-contract reference/<file> @ <spec version>; local changes: none
```

Copy a file's imports with it. `update.ts` imports `exit-codes`, `output` (a type), `health`, `install-method`, `lock`
(and through it `runtime-file`), `package-manager`, `registry`, `semver` and `update-check`; `service/` is a folder of
its own, needing nothing outside it. A tool keeps its own names, its busy check and its service commands, and gives them to `update.ts` as an
`UpdateProduct` (test/fixtures/updatable/cli.js is a small, complete example). `test/` has each file's tests; copy
those too, or port them.

Imports between these files use `.ts` extensions (compile with `rewriteRelativeImportExtensions`, or change them to
`.js` and say so in the header). The tests are in `test/`.
