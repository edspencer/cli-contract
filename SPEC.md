# The CLI contract

Version 0.2, a draft. It covers the lifecycle around running one of Ed's local tools: running it, installing it as a
service, looking at it, checking it, and updating it. What each tool does is its own business. Releasing (changesets,
npm trusted publishing) is shared already and isn't covered here.

It applies to Paddock, Managers, Hallway, Local Review, BragDoc and Localidraw. Below, `<tool>` is the bin
(`paddock`, `localidraw`), `<Name>` is the product's name (`Paddock`, `Local Review`), `<TOOL>` is its environment
prefix (`PADDOCK`, `LOCAL_REVIEW`), and `<home>` is its data home (`~/.paddock`, `~/.hallway`).

**Must** is the contract. **Should** is the default, which a tool may leave out if its `AGENTS.md` says why.

## 1. Commands

```
<tool> [serve] [args]                    run in the foreground (the default with no command)
<tool> service install [options]         write the unit, enable it, start it, wait until it answers
<tool> service install --refresh         re-render the installed unit with the settings it records
<tool> service uninstall                 stop it, disable it, remove the unit; keep data and logs
<tool> service start                     start the installed service; wait until it answers
<tool> service stop [--force]            stop it until `service start` or the next login or boot
<tool> service restart [--force]         stop and start; refresh the unit if it's stale
<tool> service status [--json]           installed? running? which version? answering? busy?
<tool> service logs [-f] [-n <lines>]    the service's log (default: the last 50 lines)
<tool> update [--check] [--to <version|tag>] [--yes] [--force] [--json]
<tool> busy [--json]                     is the running instance busy?
<tool> doctor [--json] [--offline]       checks, with a fix for each failure
<tool> -v | --version                    the bare version and a newline, nothing else
<tool> -h | --help                       usage; `<tool> <command> --help` for one command
```

### `serve`

- `serve` must be the name for running in the foreground. A bare `<tool>` must serve too.
- Paddock and Managers must keep `start` as an alias, for good.
- A tool that takes a positional argument for serving (Localidraw's folder) must let its commands win. A folder that
  has a command's name is reached as `./service`.
- `--open` should open the page in a browser once it's listening.

### Flags belong to their commands

A flag that a command can't act on is a usage error (exit 2), not something parsed and dropped: `--force` on
`service start`, `--check` on `busy`, `--refresh` on `service status`. A script that passes `--force` to the wrong
command learns so, rather than finding later that nothing was forced.

### `service`

The word is singular. With no further argument it means the tool's own service. A tool that manages other services
(Hallway's apps) may add sub-commands of its own beside these.

- **`install`** must be idempotent. A reinstall must keep the port and environment it finds in the existing unit,
  unless options say otherwise, and must replace a running service, not leave the old process serving
  (`systemctl --user enable --now` doesn't restart a unit that's already active, so restart it then). It must refuse
  to run:
  - from an npx, pnpm dlx, bunx or yarn dlx cache;
  - from a checkout, unless `--from-checkout` is given;
  - when a process that isn't this tool holds the port.
  It should take `--dry-run`, which prints the unit and writes nothing.
- **`install --refresh`** re-renders the installed unit in this CLI's format, from the settings the unit records
  (port, host, data home, options), not from the invoking shell's flags and environment. Flags given with it still
  win. With nothing installed it exits 4, rather than doing a first install with defaults. It's what `update` runs
  through the new CLI (§5 step 11).
- **`uninstall`** must keep the data home and the logs.
- **`start`** must wait until `/api/health` answers, and print the last 20 log lines if it doesn't within the
  tool's timeout. On Linux it should clear a failed state first (`systemctl --user reset-failed`): a unit that hit
  systemd's start limit stays failed until then.
- **`stop`** follows the service managers' own convention. The service stays stopped until `service start`, or the
  next login or boot, whichever comes first. That's what `systemctl --user stop` and `launchctl bootout` of a
  LaunchAgent do. `stop` must not disable the unit. To keep it off for good, use `service uninstall`.
- **`restart`** must re-render the unit first if it's stale: the Node or CLI it names has gone, or its format is older
  than the running CLI writes.
- **`stop`** and **`restart`** must run the busy check (§4) and refuse with exit 75 unless `--force` is given.
  `uninstall` doesn't check: removing the service is an explicit act.
- **`status`** must report whether it's installed, running and answering; the installed version and the running
  version; the port, URL and pid; the unit's file; the log file; and warnings (a stale unit, a missing Node). It may
  repeat the last update check (§3); in `--json` that's `update`, which is left out, never null, when there's
  nothing to repeat.
- **`logs`** must read a file the tool writes itself, on every OS (§7).

### `update`

`upgrade` must be accepted as a hidden alias.

- **`--check`** reports and changes nothing.
- **`--to`** takes a version or a dist-tag (`next`). It is the only way to move to a lower version.
- **`--yes`** skips the question. Without a TTY, `update` must refuse with exit 2 unless `--yes` is given.
- **`--force`** skips the busy check, and nothing else: the health check and the rollback still run.

§5 has the sequence.

### `busy`

`busy` asks the running instance whether it is busy (§4). It must exit 0 when it isn't, 75 when it is, and 3 when no
instance answers. It's there for scripts, Ansible and Docker, where there's no `service` to ask.

### `doctor`

`doctor` must check:

- that this Node satisfies the package's `engines`;
- how the tool was installed (§6);
- the unit: whether it's present, whether its Node and CLI paths still exist, and whether it's the same install as
  this CLI;
- that the running version is the installed one;
- whether the port is free or held by this tool;
- linger, on Linux;
- that the data home is writable;
- whether a newer version exists. `--offline` skips this one.

It should add the tool's own checks. Each line starts `✓`, `!` or `✗`, and a failure has a `fix:` line under it.
`doctor` exits 1 if any check fails. Warnings don't change the exit code.

### `--json`

- **Must** be supported on `service status`, `update --check`, `busy` and `doctor`. **Should** be on the other
  `service` commands and on `update`.
- With `--json`, stdout carries exactly one JSON document and nothing else. Prose and progress go to stderr, and the
  exit code means what it does without `--json`.
- `--version` stays bare. `service status --json` carries the versions.

## 2. Exit codes

| Code | Meaning | From |
|---|---|---|
| 0 | Done; running and answering; up to date; not busy | everything |
| 1 | Failed | everything |
| 2 | Usage: an unknown command or flag, a bad value. The usage is printed after the message | everything |
| 3 | Not running: installed but not running or not answering, or no instance answers | `service status`, `busy`, `open` |
| 4 | Not installed: there's no service unit | `service status`, `start`, `stop`, `restart`, `logs` |
| 5 | This install can't update itself; the right command was printed | `update` |
| 6 | The update failed and was rolled back; the old version is running again | `update` |
| 7 | The update failed and couldn't be rolled back; a person is needed | `update` |
| 75 | Busy: refused, and why was printed. Try later, or use `--force` | `busy`, `update`, `service stop`, `restart` |

- Codes 3 and 4 are what `systemctl status` and LSB init scripts use for "not running" and "no such service".
- Code 75 is `EX_TEMPFAIL` from `sysexits.h`. It's also the code that makes Watchtower's pre-update hook skip an
  update.
- `update --check` exits 0 whether or not there's an update. Scripts read `updateAvailable` from `--json`.
- A tool may use codes 8 to 63 for its own commands. The codes above mean the same in every tool.
- Set `process.exitCode`, not `process.exit()`, so piped output isn't cut short. A closed pipe (EPIPE) exits quietly.

## 3. Output

- **Errors** go to stderr as `<tool>: <message>`. A refusal says what to do next.
- **Colour** appears only on a TTY, honours `NO_COLOR` and `FORCE_COLOR`, and stays mostly in `serve`'s banner.
- **Prompts** appear only on a TTY. Without one, a command that would ask needs `--yes`, or exits 2 and says so.
- **`serve`'s first stdout line** is `<Name> <version>: <url>`, even on a first run: logs, first-run notices and
  banner art go to stderr, or after it. `--quiet` (`-q`) prints only that line.
- **The update notice** goes to stderr, and only from a command that has just asked the registry: `update --check` and
  `doctor`. `service status` may repeat what the last of those found, which is cached in `<home>/update-check.json`.
  It never asks the registry itself, and says nothing once the cache is about another version than the one installed.

  ```
  Paddock 0.80.0 is available (you have 0.79.1).
    Run: paddock update
    Changes: https://github.com/edspencer/paddock/releases/tag/v0.80.0
  ```

  When this install can't update itself, the `Run:` line gives the right command instead (§6):

  ```
    Run: docker compose pull && docker compose up -d    (image ghcr.io/edspencer/paddock:0.80.0)
    Run: sudo npm install -g @edspencer/paddock@0.80.0  (the global folder isn't writable)
    Run: git pull && npm install && npm run build       (this is a checkout)
  ```

- **Nothing contacts the registry by itself.** Only `update`, `update --check` and `doctor` ask it, and only when a
  person runs them. There's no background check and no check on startup, and the server never asks.

## 4. The busy check

Each tool's server must answer `GET /api/busy`.

```
GET /api/busy

200 { "busy": true, "version": "0.79.1", "counts": { "chat": 2, "job": 0 } }
```

- **`busy`** is true only for work a restart would lose or cut short, the kind someone would be annoyed to find
  killed.
- **`counts`** gives, for each kind of work, how many are under way. The kinds are the tool's own (`chat`, `job`,
  `import`, `save`). The CLI's message names them: `Paddock is busy: 2 chats are running.`
- **No labels, ids or titles yet.** Until §10's first question is settled, this answer is the whole answer, for every
  caller. Once it's settled, a caller that has proved it's local may also get `reasons` (one line each, for a person:
  what the work is and since when) and `notes` (worth saying, but not a reason to wait).
- **It must be cheap.** It reads in-memory state, never walks the disk, and answers in well under a second.
- **It must not need auth**, like `/api/health`: it says nothing but counts.
- **The CLI finds the instance through `<home>/runtime.json`**, `{ pid, port, url, version, startedAt }`, which
  `serve` writes (0600, atomically) once it's listening and removes on a clean exit. A file whose pid has gone is
  ignored. When the server is bound to a wildcard address, `url` names loopback. The CLI never guesses a default
  port: that would ask whatever else is listening there.
- **The CLI's rules:**
  - Nothing answering means "not running": `busy` exits 3, and an update may go ahead.
  - A busy answer refuses with exit 75 and says what's running.
  - `--force` prints the same message, prefixed `Overriding:`, and carries on.
- **There is a race, and it's accepted.** Work can start between the check and the stop. So each server's SIGTERM
  must stop cleanly: it finishes or records the work under way, and exits within the unit's stop timeout.

What counts as busy, for each tool, is in [ROADMAP.md](ROADMAP.md#busy-per-tool).

## 5. `update`, step by step

1. **Lock.** Create `<home>/update.lock` with `O_EXCL`, holding the pid. A live lock refuses with exit 1; a stale one
   is removed.
2. **How was it installed?** (§6.) If this install can't update itself, print the notice with the right command and
   exit 5. The refusal waits until step 4 has the target, which the notice names, so an install that's already up
   to date still exits 0, and `--check` reports instead of refusing.
3. **What's current?** Read the current version from our own `package.json`. Then ask the registry with Node's
   `fetch` and `AbortSignal.timeout(10_000)`:
   - for the target, `latest` or `--to`: `GET <registry>/-/package/<name>/dist-tags`, with a scoped name's `/` written
     as `%2f`;
   - for the target's `engines`: `GET <registry>/<name>/<version>`.

   `<registry>` is `npm_config_registry`, else `npm config get registry`, else `https://registry.npmjs.org`.
4. **Compare.**
   - Prereleases count only when `--to` names them.
   - If the target is the current version, say so and exit 0.
   - If the target's `engines.node` rejects this Node, exit 1 and name the Node it needs.
   - A lower version needs `--to`.

   `--check` stops here and reports. Whatever the answer, write it to `<home>/update-check.json` (§3).
5. **Can we write there?** If the global folder isn't writable, exit 5 and print the command with `sudo`. Never run
   `sudo`.
6. **Busy?** If an instance answers, ask `/api/busy`. If it's busy and `--force` wasn't given, exit 75. This happens
   before anything is stopped.
7. **Ask** `Update Paddock 0.79.1 → 0.80.0? The service will restart.` and give the changelog link. `--yes` skips
   the question. Without a TTY, `--yes` is required.
8. **Fetch first.** Run `npm cache add <name>@<target>` and `npm cache add <name>@<current>`. A network failure then
   happens while the old version is still serving, and the rollback has the old package to hand.
9. **Stop.** Stop the service. If someone is running a foreground `serve`, ask them to stop it, and exit 3 if it still
   answers. Wait until the port is free: on macOS, `launchctl bootout` returns before the job has gone (§7). Stopping comes before installing for two reasons:
   - npm moves the old package aside before unpacking the new one, so a running server would lazily load files that
     are gone;
   - on Windows, a loaded native addon can't be replaced at all.
10. **Install** with the package manager this install came from (§6). For npm, use the `npm` next to
    `process.execPath`, without a shell.
    - If it fails, npm has already put the old package back. Start the service again, check it answers, and exit 6.
11. **Hand over to the new version.** Run the new CLI: `node <new cli.js> service install --refresh`. It re-renders
    the unit in its own format with the kept settings, starts the service, and waits for health. The unit is
    refreshed for two reasons:
    - a pnpm global install has the version in its realpath;
    - a newer version may write a different unit.
12. **Health.** Poll `/api/health` until it answers with `version` equal to the target. Allow 30 seconds unless the
    tool sets its own limit.
13. **On failure,** print the last 20 log lines. Then reinstall the old version, refresh the unit with the old CLI,
    and check that the old version answers.
    - If it does, exit 6: `0.80.0 didn't start; 0.79.1 is running again.`
    - If it doesn't, exit 7. Print the commands to run by hand and the backup path from step 14.
14. **Migrated data.** A tool whose new version changes its data on boot must first copy what it changes to
    `<home>/backups/pre-<version>/`. A rollback that meets data the old version refuses doesn't restore anything
    automatically: it exits 7 and names the backup.
15. **Done.** Rewrite `<home>/update-check.json` to say there's nothing to do (otherwise `status` goes on
    advertising the version that's now installed), print `Updated Paddock 0.79.1 → 0.80.0. Running at <url>`, remove
    the lock, and exit 0.

**Without a service** (someone runs `serve` by hand), `update` does steps 1 to 8 and step 10. If an instance is
running, it then says `Restart Paddock to use 0.80.0`.

**Update runs from a terminal, never from inside the service.** An updater started by the service, such as a web UI
button or an agent the service is running, dies when the service stops:

- systemd's default `KillMode=control-group` kills the whole cgroup;
- launchd kills the job's process group.

Building that needs an updater started outside the service: `systemd-run --user` on Linux, a `setsid` child on
macOS, or a separate scheduled task on Windows. It isn't part of this version.

## 6. How it was installed

Take `realpath(process.argv[1])` and walk up to the folder whose `package.json` has our name. Then check this table
in order, using Node built-ins only.

| Install | How to tell | `update` |
|---|---|---|
| Docker | `<TOOL>_IN_DOCKER=1`, set by the tool's own Dockerfile | exit 5: the image-pull command, with the target tag |
| Managed (Ansible, …) | `<TOOL>_UPDATE_HINT` is set | exit 5: prints the hint |
| npx, pnpm dlx, bunx, yarn dlx | the path is in one of their caches (`/_npx/`, `dlx`, `bunx-`) | exit 5: `npx <name>@latest` already runs the latest |
| Checkout or `npm link` | the package root isn't under a `node_modules` folder | exit 5: `git pull && npm install && npm run build` |
| Global npm | the package root is `<npm root -g>/<name>`, asked of the `npm` next to `process.execPath` | `npm install -g` |
| Global pnpm | the path contains `/pnpm/global/` | `pnpm add -g` |
| Global bun | `/.bun/install/global/` | `bun add -g` |
| Volta | `/.volta/tools/image/packages/` | `volta install` |
| Global yarn (classic) | `/yarn/global/node_modules/` | exit 5: `yarn global add` |
| A dependency of a project | under some other `node_modules` | exit 5: update it in that project |

Don't use `/.dockerenv` to detect Docker. Dev containers have it too, and a global npm install is legitimate there.

## 7. Services

| | macOS | Linux | Windows (P3) |
|---|---|---|---|
| Manager | launchd LaunchAgent, domain `gui/<uid>` | systemd user unit | Task Scheduler and a supervisor process (Hallway's) |
| File | `~/Library/LaunchAgents/<label>.plist` | `${XDG_CONFIG_HOME:-~/.config}/systemd/user/<tool>.service` | `%LOCALAPPDATA%\<tool>\tasks\` |
| Keep alive | `RunAtLoad`, `KeepAlive`, `ThrottleInterval 10` | `Restart=always`, `RestartSec=10`, `WantedBy=default.target` | the supervisor restarts after 10 s |
| Stop | `launchctl bootout` | `systemctl --user stop` | `schtasks /End`, then the process tree |

**What the unit runs.** It runs `realpath(process.execPath)`, then `realpath(<package>/dist/…/cli.js)`, then
`serve` and the options. It never runs the bin shim.

- Every word in a systemd `ExecStart` is quoted, with `%` and `$` escaped.
- `PATH` is Node's own bin folder first, then the installing shell's entries without the per-shell ones (`fnm_multishells`,
  `_npx`, `node_modules/.bin`), then the system folders.
- `status` and `doctor` warn when the Node a unit names has gone. That happens under nvm, fnm and volta when a Node
  version is removed.

**Logs.** The service writes stdout and stderr, appended, to the one file `<home>/logs/service.log`:

- on macOS, `StandardOutPath` and `StandardErrorPath` name the same path;
- on Linux, `StandardOutput=append:` and `StandardError=append:` name it, rather than using the journal;
- on Windows, the supervisor writes it.

So `logs` is one Node implementation everywhere. The tool rotates its own log, by copying it and then truncating it:
the service manager holds the file open, so it has to stay the same file.

**Stopping and starting.**

- **launchd:** `launchctl bootout` returns once launchd has accepted the request, not once the job has gone, and a
  `bootstrap` straight after it fails with exit 5 (`EIO`). After a bootout, poll `launchctl print gui/<uid>/<label>`
  until it fails (with a limit), and retry a bootstrap that fails with 5 or 37 ("operation already in progress")
  a few times, a short pause apart. The retry covers a bootout another process issued.
- **systemd:** `enable --now` starts a stopped unit and leaves an active one alone, so an `install` over a running
  service restarts it, but only then: systemd allows five starts in ten seconds.

**Linger.** On Linux, `install` and `doctor` must check `loginctl show-user $USER -p Linger`. If it's off, they print
`sudo loginctl enable-linger <user>` and why: without it, the service stops when you log out. Never run `sudo`.

**Keeping Windows possible.** Windows is a later priority (P3), and nothing built before it may rule it out:

- paths use `node:path`, never a literal `/`;
- logs are files, not the journal;
- process control goes through a small `ServiceManager` interface (`install`, `uninstall`, `start`, `stop`,
  `restart`, `status`, `linger`), with launchd, systemd and, later, Task Scheduler behind it
  ([reference/service/](reference/service/));
- a clean stop must not depend on SIGTERM alone, because Windows has no SIGTERM (Hallway's supervisor shows one way);
- spawning `npm.cmd` needs `shell: true` and careful quoting, since Node's fix for CVE-2024-27980;
- `update` stops every process running from the package before npm runs, because Windows can't replace a loaded file.

## 8. The server's side

- **`GET /api/health`** must answer `{ "ok": true, "version": "<version>" }` and must not need auth.
- **`GET /api/busy`** must answer as §4 describes.
- **Exit cleanly on SIGTERM.** Finish or record the work under way, then exit 0 within the unit's stop timeout.
- **Data migrations** back up first (§5, step 14).

## 9. Docker and the home lab

- **Images** set `<TOOL>_IN_DOCKER=1`, put `<tool>` on `PATH`, and keep their `HEALTHCHECK` on `/api/health`.
  `docker exec <container> <tool> update --check` prints the image-pull command. Nothing installs anything inside
  a container.
- **Watchtower** can wait for a quiet moment. Enable lifecycle hooks and add the label
  `com.centurylinklabs.watchtower.lifecycle.pre-update=<tool> busy`. When the tool is busy, the hook exits 75 and
  Watchtower skips the update until its next run.
- **A managed install** (Managers' Ansible role) sets `<TOOL>_UPDATE_HINT` in its unit, and runs `<tool> busy`
  before it restarts.

## 10. Open questions

1. **How the CLI proves it's local to `/api/busy`**, before the answer carries labels. Being on loopback isn't proof,
   because a reverse proxy on the same host connects from loopback too. The candidate is a token in a 0600
   `<home>/runtime.json`, which BragDoc already writes. The answer may differ between tools. It's to be designed
   carefully, and until it is, `/api/busy` returns counts only.
2. **Updating from inside the service** (§5): a web UI button, or an agent asked to update the tool it runs in.
3. **Windows** (§7): Task Scheduler for the five tools that don't have it yet.

## Changelog

The version at the top says which this is. A minor version adds something a tool must now do; a patch changes wording.

- **0.2** (5 November 2026), from what waves B to D found. Every tool:
  - `service install --refresh` (§1), which `update` runs through the new CLI.
  - A flag on a command that can't act on it exits 2 (§1).
  - `install` replaces a running service (systemd's `enable --now` doesn't), and on macOS a bootout is waited for and
    a bootstrap that fails with 5 or 37 is retried (§1, §7). `start` should clear systemd's failed state.
  - `serve`'s first line is first even on a first run (§3); `/api/busy` needs no auth, and `runtime.json` is how the
    CLI finds the instance (§4).
  - `update` refuses with 5 only once it has a target, writes `update-check.json` at step 4 and again when it's done,
    and `status --json` leaves `update` out rather than null (§1, §3, §5).
  - Wording: the `ServiceManager` interface's names, and log rotation by copy and truncate (§7).
- **0.1** (4 November 2026): the first draft.
