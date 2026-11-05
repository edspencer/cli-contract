# Contributing to cli-contract

This repo holds the contract Ed's local tools share ([SPEC.md](SPEC.md)), the reference code they copy
(`reference/`), the JSON schemas for their `--json` output (`schemas/`), and the conformance runner that checks a tool
from the outside (`src/`, published as `@edspencer/cli-conformance`). Coding agents should read
[AGENTS.md](AGENTS.md) as well.

## Setup

You need Node.js 22 or later (`.nvmrc` says 22).

```sh
git clone https://github.com/edspencer/cli-contract.git
cd cli-contract
npm ci
```

If your shell exports `NODE_ENV=production`, `npm ci` skips the dev dependencies: unset it (`env -u NODE_ENV npm ci`).
`package-lock.json` is written by npm 11; on Node 22, add or upgrade dependencies with `npx npm@11 install …`.

## Checks

CI runs these on Node 22 and 24, on Linux, macOS and Windows. Run them before you open a PR:

```sh
npm run typecheck
npm run build
npm test
npm run smoke:pack    # pack, install into a temp prefix, run it against the conforming fixture
```

## The rules

- **`reference/` uses Node built-ins only** and runs on Node 22. Tools copy these files, and Localidraw allows no
  runtime dependencies. Every reference file has unit tests in `test/`.
- **The runner has no runtime dependencies either.** It's a devDependency in six repos.
- **Don't rule Windows out** (SPEC §7): `node:path`, no shell unless it's unavoidable, no reliance on SIGTERM.
- **A change to `SPEC.md` is a change to six tools.** Bump its version at the top (a minor for anything a tool must
  now do, a patch for wording), add a line to its changelog section, and say in the PR which tools it affects.

## Pull requests

Branch off `main` and open the PR against it. `CI passed` must be green to merge (the ruleset requires it). Say what
changed and how you checked it.

## Changesets

Versions and `CHANGELOG.md` come from [changesets](https://github.com/changesets/changesets). If a PR changes what a
user of `@edspencer/cli-conformance` would notice (a new or changed check, the report, the config file, a fix), add
one:

```sh
npm run changeset
```

A check that can newly fail a tool's CI is a **minor**, before 1.0. Changes to `SPEC.md` alone, the reference code
alone, tests, CI and docs don't need one: the package ships `reference/`, `schemas/` and `SPEC.md`, but a tool takes
those by copying, not by upgrading. [RELEASING.md](RELEASING.md) says how changesets become a release.
