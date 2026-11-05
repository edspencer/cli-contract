# cli-contract: working conventions

- **SPEC.md is the contract.** A change to it is a change to six tools. Say in the PR which tools it affects and
  whether any of them already does otherwise. Bump the version at its top: a minor version for anything a tool
  must now do, a patch for wording.
- **Write like the tools' own docs**: plain, direct, British spelling, short sentences. Say what happens, not what
  might.
- **`reference/` uses Node built-ins only**, because Localidraw allows no runtime dependencies. It targets Node 22,
  the lowest `engines` among the tools.
- **Nothing here is a runtime dependency of a tool.** Tools copy `reference/` files, with a header naming the file
  and the version they came from. The conformance package is a devDependency.
- **Don't rule Windows out** (SPEC §7), even though it's a later priority.
- Personal, machine-specific rules go in a git-ignored `CLAUDE.local.md`.

## Layout

- `SPEC.md`: the contract, with its version at the top and a changelog at the bottom.
- `reference/`: the code tools copy (`exit-codes.ts`, …), each with tests in `test/`.
- `schemas/`: JSON schemas for the `--json` output the spec requires.
- `src/`: the conformance runner (`cli.ts`, `runner.ts`, `checks.ts`), published as `@edspencer/cli-conformance` from this repo's root
  ([RELEASING.md](RELEASING.md)).

## Commands

```sh
npm ci
npm run typecheck
npm run build      # dist/ (tsc)
npm test           # node:test via tsx (packs and installs the fixture CLIs in test/fixtures/)
npm run smoke:pack # pack this package, install it, run it against the conforming fixture
npm run changeset  # for a change users of the npm package would notice (CONTRIBUTING.md)
```

`CI passed` must be green to merge (a ruleset requires it). The orchestrator merges "chore: version packages" PRs.
