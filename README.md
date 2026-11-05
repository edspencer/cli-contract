# cli-contract

One CLI shape for Ed's local tools: [Paddock](https://github.com/edspencer/paddock), Managers, Hallway, Local Review,
BragDoc and Localidraw. Each runs on a laptop, some in a home lab too, and each should feel the same around running
it: the same commands, flags, exit codes and output for serving, installing as a service, logs, checks and updating.

```sh
paddock service install     # run it in the background, at login
paddock service status      # is it running, which version, is it busy?
paddock update              # check it's safe, stop, install the new version, start, roll back if it fails
paddock busy                # 0 idle, 75 busy, 3 not running: for scripts, Ansible and Watchtower
paddock doctor              # what's wrong, and how to fix it
```

- **[SPEC.md](SPEC.md)** is the contract.
- **[ROADMAP.md](ROADMAP.md)** is where each tool stands, and the order they get there in.

Each tool copies the reference code ([reference/](reference/README.md)) into its own repo rather than depending on a
package. Localidraw allows no runtime dependencies, and a fix to six products' lifecycle code is six small PRs either
way. [schemas/](schemas/) has the JSON schemas for the `--json` output the spec requires.

## The conformance runner

[`@edspencer/cli-conformance`](https://www.npmjs.com/package/@edspencer/cli-conformance) checks a tool from the
outside. It packs the tool (`npm pack`, so `prepack` builds it), installs the tarball into a temporary prefix, and
runs the installed bin with a throwaway `HOME`, `NO_COLOR`, and no TTY on stdin. It's a devDependency:

```sh
npm install --save-dev @edspencer/cli-conformance
npx cli-conformance                 # in the tool's checkout; exit 0 passed, 1 failed, 2 a usage or config error
npx cli-conformance --json          # the report as one JSON document on stdout; progress on stderr
npx cli-conformance --only version,busy
npx cli-conformance --package localidraw@latest --config cli-contract.json   # a published version instead
```

In CI, after the build: `- run: npx cli-conformance`.

Each tool keeps a `cli-contract.json` at its root, saying which checks apply and why any don't. Every check must be
listed, so a new check in a newer runner fails until the tool says whether it applies.

```json
{
  "$schema": "./node_modules/@edspencer/cli-conformance/schemas/cli-contract.schema.json",
  "name": "Local Review",
  "serve": { "args": ["serve", "--port", "{port}", "--data-dir", "{home}/data"] },
  "env": { "SOME_TOKEN": null },
  "checks": {
    "version": true,
    "help": true,
    "unknown-flag": true,
    "service-status": true,
    "service-status-json": true,
    "busy": { "skip": "no busy command yet (wave D)" },
    "busy-json": { "skip": "no busy command yet (wave D)" },
    "serve-banner": true,
    "serve-health": true
  }
}
```

| Check | Passes when |
|---|---|
| `version` | `--version` and `-v` print the version from `package.json` and a newline, nothing else, and exit 0 |
| `help` | `--help` and `-h` print something on stdout and exit 0 |
| `unknown-flag` | `--no-such-flag-cli-conformance` exits 2; stderr's first line is `<bin>: …`, and the usage follows it |
| `service-status` | `service status` exits 4 with nothing installed |
| `service-status-json` | `service status --json` exits 4 and prints one document matching `schemas/service-status.schema.json`, with `installed` and `running` false |
| `busy` | `busy` exits 3 with nothing running |
| `busy-json` | `busy --json` exits 3 and prints one document matching `schemas/busy.schema.json`, with `running` false |
| `serve-banner` | `serve`'s first stdout line is `<name> <version>: <url>` |
| `serve-health` | `GET <url>/api/health` answers 200 with `{ "ok": true, "version": "<version>" }` |

- **`serve.args`** start the tool in the foreground (default `["serve", "--port", "{port}"]`). `{port}` is a free
  port, also given as `PORT`; `{home}` is the throwaway home and `{tmp}` a scratch folder (the commands' working
  folder). The runner stops it afterwards with SIGTERM (a tree kill on Windows), then SIGKILL after 10 seconds.
- **`env`** adds variables to every command, or removes them with `null`. A tool that would spend money or touch
  real data when it starts (Paddock's drive mode, an API key) sets that here.
- **`timeoutMs`** (default 15 000) bounds each command; `serve.timeoutMs` (default 30 000) bounds the wait for
  `serve`'s first line and for `/api/health`. A command that's still running then is killed and fails its check.
- **The home is throwaway, but the machine isn't.** `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS` are removed,
  so `systemctl --user` can't reach the real user's services, but `launchctl` on macOS still sees the real login
  session. A tool should decide "installed" from the unit file in its home, as the spec's `status` does. CI runners
  have nothing installed either way.

[examples/localidraw.cli-contract.json](examples/localidraw.cli-contract.json) is Localidraw 0.4's settings: four
checks pass, and five wait for the commands it doesn't have yet.

[MIT](LICENSE).
