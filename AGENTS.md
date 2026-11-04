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
