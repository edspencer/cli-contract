# Roadmap

How each tool gets to [SPEC.md](SPEC.md). Surveyed on 4 November 2026, from each repo's `main` (BragDoc's `next`).

Sizes are rough, in agent time with review: **XS** under an hour, **S** half a day, **M** one or two days, **L** three
to five days.

## Progress, by wave

From the rollout plan (`CLI-ROLLOUT.md` on the dev box). **The rollout finished on 5 November 2026, with SPEC 1.0.**

| Wave | What | Done |
|---|---|---|
| A | This repo: the spec, `reference/` foundations, the schemas, the runner | ✓ (runner 0.1.0) |
| B | Alignment: health, exit codes, `serve`, `status --json`, `logs`, units | ✓ Paddock 0.80.0, Hallway 0.11.0, Local Review 0.14.0, BragDoc 0.3.0 |
| C | Paddock's busy check and `update`; then `update` into `reference/` | ✓ C1 busy (0.81.0), C2 `update` (0.82.0), C4 `reference/` update and service, the runner's update checks, SPEC 0.2 (runner 0.2.0). C3, Ed dogfooding `paddock update` on his laptop, is still to come |
| D | busy (a), then `update` and `doctor` (b), from the reference | ✓ Hallway 0.12.0–0.13.0, Local Review 0.15.0–0.16.0, BragDoc 0.4.0–0.5.0 |
| E | Localidraw: commands and SIGTERM, `service`, busy, `update`, `doctor` | ✓ 0.5.0, 0.6.0, 0.7.0 |
| F | Managers: alignment, busy and SIGTERM, `update` and `doctor`, the Ansible role | ✓ Managers 0.4.0; the role is [homelab-infra#371](https://github.com/edspencer/homelab-infra/pull/371), for Ed |
| G | `doctor` everywhere, the §1 "should"s, docs, the sweep, SPEC 1.0 | ✓ G1/G2 (Paddock 0.83.0, Hallway 0.14.0, Local Review 0.17.0, Localidraw 0.8.0, BragDoc's next release); G3: SPEC 1.0, `lingerAdvice`, the headers, Managers' §1 musts |

### Where each tool stands at SPEC 1.0

All six list all 20 of the runner's checks in `cli-contract.json` with none skipped, run `@edspencer/cli-conformance`
0.2.0 in CI (the two real-service checks in their real-service jobs), and head every copied `reference/` file
`@ 1.0`. "Published" is what `npx <package>@latest` answered on 5 November, in a throwaway home and npm prefix:
`--version` bare, `busy` 3, `service status` 4, the three `--json` documents valid against `schemas/`, and `update`
refusing with 5 from npx and under `<TOOL>_IN_DOCKER=1`.

| Tool | Release | Commands | Real-service CI | Reference copies (all `@ 1.0`) | Published | Differences |
|---|---|---|---|---|---|---|
| Paddock | 0.83.0 | all; `start` alias | launchd, systemd | 17: `update`, `service/` managers, busy, output, runtime file | ✓ 0.83.0; the image's `update` exits 5 with the pull command | `logs --json` |
| Managers | 0.4.0; §1's three musts (checkout and port refusals, reinstall keeps settings) and the "should"s land in the next release (managers#24) | all; `start` alias | launchd, systemd | 17, as Paddock | ✓ 0.4.0; the image's `update` exits 5 | `logs --json`; no docs site (`UPDATING.md`) |
| Hallway | 0.14.0 | all, plus app services | launchd, systemd, Task Scheduler | 21: `update`, busy, output, runtime file | ✓ 0.14.0 (no image) | two daemon logs (D74); `logs --json` |
| Local Review | 0.17.0 | all | launchd, systemd | 23: `update`, busy, output, runtime file, `rotate.ts` | ✓ 0.17.0 (no image) | `logs --json` |
| BragDoc | 0.5.0 (`latest`); 0.6.0 pending on `next` | all | launchd, systemd | 20: `update` (with `egress.ts` fetch), busy | ✓ 0.5.0; the image's `update` exits 5 | log path (D85); `logs --json` |
| Localidraw | 0.8.0 | all; `serve [folder]` | launchd, systemd | 20: all of `reference/`, verbatim | ✓ 0.8.0; the image's `update` exits 5 | `logs --json` |

**Still to come (Later, not part of 1.0):** the busy endpoint's auth design (§10.1), updating from inside the service
(§10.2), and Windows' `ServiceManager` in `reference/service/` for the five tools that don't have Windows yet (§10.3,
P3).

## Deliberate local differences

Where a tool departs from a SPEC line on purpose. Hallway's and BragDoc's are recorded in their own decisions, the
last row is recorded here for all six, and the conformance runner doesn't check any of them.

| Tool | SPEC says | The tool does | Why |
|---|---|---|---|
| Hallway | §7: the service writes one `<home>/logs/service.log` | The daemon writes `<home>/logs/daemon.out.log` and `daemon.err.log`, rotated by Hallway; `service logs` reads both, `status --json`'s `log` names the out file (D74) | §7's point, that `logs` reads files the tool writes on every OS, already holds, Windows included, where Hallway's supervisor writes them. Moving them would break `hallway logs daemon`, `doctor` and the rotation, and re-render every installed unit, for nothing a reader would notice |
| BragDoc | §7: `<home>/logs/service.log` | `<data home>/service/bragdoc.log`, rotated at 10 MB by copy and truncate (D85) | macOS installs already logged there before the contract. One file the tool writes, on every OS, holds; only the path is BragDoc's own, and moving it would split an existing install's log across two files until it's reinstalled |
| All six | §1: `--json` should be on the other `service` commands | `service logs --json` exits 2 | A log is a stream of lines, and `-f` never ends, so there's no one document to print. Every other `service` command takes `--json` |

**Not departures, but worth knowing when you compare the copies:**
- Paddock and Managers keep their own `service/spec.ts`, `service/index.ts` and `service/ready.ts` (the commands around
  the `ServiceManager`), and their own `service-log.ts` rotation, which `reference/service/rotate.ts` was lifted from.
- Hallway, Local Review and BragDoc keep their own service code (Hallway's has Windows), and copy only the `update`
  files and `busy-client.ts`. Local Review also copies `rotate.ts`. BragDoc's copies route `fetch` through its
  `egress.ts` (D9's amendment), and their headers list that.
- Localidraw copies all of `reference/`, verbatim.
- Hallway and Local Review ship no Docker image, so §9's image lines don't apply to them. `<TOOL>_IN_DOCKER=1` still
  gets the pull command.
- Managers has no docs site: its `UPDATING.md` and `--help` carry what the others' "Updating" and "Running as a
  service" pages do.

The table below is the survey this plan started from, on 4 November.

## Where each tool stood on 4 November

| | Paddock | Managers | Hallway | Local Review | BragDoc | Localidraw |
|---|---|---|---|---|---|---|
| Foreground | `start` | `start` | `serve` | `serve` | `serve` | `[folder]` |
| `service install`, `uninstall`, `restart`, `status` | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| `service start`, `stop` | ✓ | ✓ | — | — | ✓ | — |
| `service logs` | — | — | `logs daemon` | — | ✓ | — |
| `update` | — | — | — | — | — | — |
| `busy` | — | — | — | — | — | — |
| `doctor` | — | — | ✓ | — | — | — |
| `service status --json` | — | — | ✓ | ✓ | — | — |
| Usage exits 2 | — (1) | — (1) | ✓ | ✓ | ✓ | ✓ (but 2 for every refusal) |
| `/api/health` has `version` | — | — | ✓ | — | ✓ | ✓ |
| Unit pins a realpath'd Node, strips per-shell `PATH` | — | — | ✓ | ✓ | partly | — |
| Windows | — | — | ✓ | — | — | — |
| Real-service CI | — | — | Linux, macOS, Windows | Linux, macOS | — | — |

## Busy, per tool

These are counts only, until the question of proving the caller is local is settled (SPEC §10).

| Tool | Counts as busy | Worth a note, not busy | Where it comes from |
|---|---|---|---|
| Paddock | a chat turn running; a live SDK session with a background task; a scheduled job or trigger running | idle live sessions (they resume) | `SessionHub.runningSessions()`, `herdctl.isSdkSessionLive`, `fleetStatus().counts.runningJobs` |
| Managers | as Paddock, plus a trigger run with `status: running` | scheduled fires in the next few minutes | `turn-interlock.ts` `sessionIsBusy`, `managers/trigger-runs.ts`, `/api/fleet` |
| Hallway | a fronting setup running; an app start, stop or restart in flight | apps keep running: they're their own services | `FrontingSetupJob.state`, the prober's in-flight work |
| Local Review | a write in flight (a save, a backup snapshot, a GitHub sync) | open pages; drafts live in the browser and survive | a counter around writes; the SSE listener set |
| BragDoc | an import (`cache/import.lock`, with a live pid); a judge run; AI requests running or queued | OCR queued (it resumes) | `import/lock.ts`, the judge's status, `ctx.ai.queue()` |
| Localidraw | a canvas or library save in flight | open pages; they retry their save and reconnect | a counter around writes; `clients.size` |

Paddock has a trap. A keeper chat that runs `paddock update` is itself a running chat, so it sees itself as busy, and
with `--force` it would kill itself. Its busy message for chats should say to run the update from a terminal.

Localidraw's row needs proof first: an e2e test that restarts the server mid-edit and loses nothing. If that test
fails, "a page has a save due" becomes a reason to wait, reported by the page.

## The gaps

### Paddock
| Gap | Size |
|---|---|
| `/api/health` returns `version` | XS |
| The main `--help` lists all six service actions (it shows three) | XS |
| Usage errors exit 2; `service status` exits 3 or 4 | S |
| `serve`, keeping `start` | XS |
| `service status --json`, with installed and running versions | S |
| `service logs`; Linux logs to a file rather than the journal; rotation | S |
| Units: realpath Node, strip per-shell `PATH`, quote `ExecStart` words, warn when Node has gone | S |
| `install` checks linger | XS |
| `/api/busy` (counts) and `paddock busy` | M |
| `update`: the first implementation | L |
| `doctor` | M |
| Real-service CI (from Local Review's `scripts/service-real.mjs`) | M |
| Image: `paddock` on `PATH`, `PADDOCK_IN_DOCKER=1`; Watchtower in the deploying guide | S |

### Managers
Its CLI is Paddock's, nearly line for line, so most of these are copies.

| Gap | Size |
|---|---|
| Paddock's alignment: the health version, exit codes, `serve`, `status --json`, `logs`, units, linger | M |
| `/api/busy` (Paddock's sources, plus running trigger runs) and `managers busy` | M |
| A SIGTERM that lets a turn finish or records it, rather than closing at once | M |
| `update` (from Paddock) | S |
| `doctor` (`/api/security`'s checks fold into it) | M |
| The Ansible role: `managers busy` before the restart; `MANAGERS_UPDATE_HINT` in the unit | S |
| Real-service CI | S |
| Image: `MANAGERS_IN_DOCKER=1`, `managers` on `PATH` | XS |

### Hallway
| Gap | Size |
|---|---|
| `service start` and `stop` for the daemon (`stop` doesn't disable, SPEC §1) | S |
| `service logs` (`logs daemon` stays) | XS |
| `service status` exits 3 or 4 | XS |
| `--json` on `service install`, `restart`, `start`, `stop` | S |
| `/api/busy` and `hallway busy` | S |
| `update`, including Windows. Every supervisor running from the package must stop before npm runs, and the app jobs are regenerated and restarted after, which restarts the apps. `update` says so first | M |
| `doctor` gains the install method and the update check | S |
| `--data-dir` (`HALLWAY_HOME` stays) | XS |

### Local Review
| Gap | Size |
|---|---|
| `service start` and `stop` | S |
| `service logs`; one combined log file | S |
| `service status` exits 3 or 4 | XS |
| `/api/health` returns `version` | XS |
| `/api/busy` and `local-review busy` | S |
| `update` | M |
| `doctor` (the warnings in `service status` are the start of it) | M |
| `--data-dir` (`LOCAL_REVIEW_HOME` stays) | XS |

### BragDoc
| Gap | Size |
|---|---|
| A decision amending D9: checks a person runs (`update`, `update --check`, `doctor`) are allowed, through a new `egress.ts` purpose; background checks stay banned | XS |
| `service status --json`; exits 3 or 4 | S |
| Linux logs to a file, as macOS already does | S |
| `/api/busy` (needs a route for the AI queue) and `bragdoc busy` | S |
| `update`, with a pre-migration backup when `schemaVersion` goes up | M |
| `doctor` | M |
| Real-service CI | S |

### Localidraw
| Gap | Size |
|---|---|
| Commands: `serve [folder]` as the default, commands win over folder names; a port in use exits 1, not 2 | M |
| `~/.localidraw/` for the service only: logs, the update lock, runtime state. Never drawings | S |
| `service install <folder> [--port --host --allowed-host --poll]` through `logs`, on macOS and Linux | L |
| A SIGTERM handler that finishes the writes under way | S |
| The restart-mid-edit e2e test, then `/api/busy` and `localidraw busy` | M |
| `update` (Node built-ins only, which the reference already is) | M |
| `doctor`, built from the checks already there (the page isn't built, the port is in use, the inotify limit) | S |
| `--json` on the new commands | S |
| Image: `LOCALIDRAW_IN_DOCKER=1`; an "Upgrading" section in the self-hosting page | XS |
| Website: a "Running as a service" page; the README and `AGENTS.md` | S |

## The order

The tools share a spec and copied reference code, not a package. Localidraw allows no runtime dependencies, and the
repos already copy one another's service code. Copied files start with
`// From edspencer/cli-contract reference/<file> @ <version>; local changes: …`.

1. **This repo**: `SPEC.md`, then `reference/exit-codes.ts`, and a conformance runner that checks only the commands
   that already exist. (M)
2. **One alignment PR per tool**, six PRs of size S. Each brings in the health version, the exit codes, `serve`,
   `service status --json`, the missing `service start`, `stop` and `logs`, the help text, linger, and the unit
   hardening. No new behaviour beyond the spec. Localidraw comes at step 8 instead.
3. **Paddock: `/api/busy` and `paddock busy`.** (M) This is the hardest busy check, and the one Ed needs.
4. **Paddock: `update`.** (L) Built against a real product first, and dogfooded on Ed's laptop.
5. **Into `reference/`**: install detection, the registry and semver code, and `update`. The conformance runner gains
   update tests against a fake registry (`npm_config_registry` pointed at a local server serving two packed
   versions), including a version that fails its health check, to prove the rollback. (M)
6. **Managers, then its Ansible role.** (M, then S)
7. **Hallway, Local Review and BragDoc**, in any order: busy and `update`, then `doctor` where it's missing.
   BragDoc's starts with the D9 decision. (M each)
8. **Localidraw**, in three PRs: commands and SIGTERM (M); `service` (L); the restart test, busy and `update` (M).
9. **`doctor`** wherever it's still missing, and Watchtower in the image docs. (S to M each)
10. **Later.** The open questions (SPEC §10): proving the caller is local, so `/api/busy` can say more; updating from
    inside the service; and Windows (P3), porting Hallway's Task Scheduler and supervisor into `reference/`.

Steps 2 and 7 can run across repos in parallel. Steps 3 to 5 are serial: they make the reference that the rest copy.
