# Releasing @edspencer/cli-conformance

The conformance runner is published to npm as
[`@edspencer/cli-conformance`](https://www.npmjs.com/package/@edspencer/cli-conformance), from the root of this repo.
Every release comes from GitHub Actions (`.github/workflows/release.yml`), with npm trusted publishing and a
provenance attestation. Nobody publishes a release from a laptop, and no npm token exists. (The one exception is the
0.0.1 placeholder, below.) This is Localidraw's process, without the Docker image.

`SPEC.md` has its own version, at its top, and its own changelog section at the bottom. It isn't tied to the
package's version: a spec change bumps the spec's version, and a runner that checks something new is a changeset.

## How a release happens

1. **PRs carry changesets.** A PR that changes what the package does (a new check, a changed report, a fix) adds a
   `.changeset/*.md` file naming the bump and a summary for users ([CONTRIBUTING.md](CONTRIBUTING.md#changesets)).
2. **The Release workflow keeps a version PR open.** On every push to `main` that leaves changesets pending, the
   `release` job runs `npm run changeset:version` and opens or updates a PR titled **"chore: version packages"**
   (branch `changeset-release/main`). It consumes the changesets into `CHANGELOG.md`, bumps `version` in
   `package.json` and refreshes `package-lock.json`.
3. **Merging the version PR releases.** That push leaves no changesets and a version with no `v<version>` tag, so the
   same workflow run goes on to:
   - `verify-ci`: wait for the CI run on the merge commit and require it to have passed;
   - `publish-npm`: `npm publish` (`prepack` builds `dist/`), then check that the provenance attestation is visible;
   - `github-release`: create the tag `v<version>` and a GitHub Release whose notes are that version's
     `CHANGELOG.md` section.

Nobody edits `version` or `CHANGELOG.md` by hand. `workflow_dispatch` (Actions → Release → Run workflow) re-runs the
pipeline for the current `main`. A `v<version>` tag always means that version is on npm.

### The version PR's CI

The version PR is opened by `github-actions[bot]`, and GitHub doesn't run CI for it the usual way, so the ruleset's
required `CI passed` never reports on it. Close and reopen it to get a real CI run, or merge it with the ruleset's
admin bypass. Either way nothing unverified ships: `verify-ci` blocks the publish unless CI on the push to `main`
concluded `success` on that exact commit.

## npm auth: trusted publishing

There is no `NPM_TOKEN` secret, and there must never be one. What makes it work:

- On npmjs.com, the package's settings have a **trusted publisher**: GitHub Actions, repository
  `edspencer/cli-contract`, workflow `release.yml`, no environment, with **npm publish** ticked under its **Allowed
  actions**. Renaming `release.yml` breaks publishing until this is updated.
- The job has `permissions: id-token: write`, and `actions/setup-node` with `registry-url`.
- npm ≥ 11.5.1: Node 22 ships npm 10, so the job installs `npm@^11.5.1` first.
- `publishConfig`: `access: public` and `provenance: true`. The job checks the attestation landed and fails if not.

### Bootstrapping the package: the 0.0.1 placeholder (one-time, by hand)

A trusted publisher can only be attached to a package that exists, and a new package's first publish can't be done
over OIDC ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). So Ed publishes a placeholder
**`@edspencer/cli-conformance@0.0.1`** by hand, from a laptop: a `package.json` with only the name, `0.0.1`, a
description saying it's a placeholder, `license` and `repository`, then `npm publish --access public`. Then he adds the
trusted publisher above, and requires 2FA with tokens disallowed. `package.json` on `main` says 0.0.1 to match, so the
first changeset's minor bump makes 0.1.0, the first real release.

**Before merging the first version PR**, check `npm view @edspencer/cli-conformance version` shows `0.0.1`.

## When something goes wrong

The pipeline is built so that re-running it finishes a half-done release; npm never accepts the same version twice.

- **`verify-ci` failed.** Nothing was published. Fix `main`, or re-run CI and then re-run Release.
- **`publish-npm` failed before publishing.** An `E404`/`ENEEDAUTH` almost always means the trusted publisher doesn't
  match the repo, the workflow file or the job's `id-token` permission, or the placeholder was never published.
  `E403 … OIDC permission denied` means **npm publish** isn't ticked under the publisher's allowed actions.
- **Published, but a later step failed.** Re-run the workflow: it skips the publish ("already on npm") and finishes
  the provenance check, the tag and the Release.
- **A bad version is out.** Fix forward with a patch changeset. `npm deprecate` the bad one.

## Dry runs, locally

```sh
npx changeset status --verbose   # what the next version would be
npm publish --dry-run            # builds (prepack) and lists what would go into the tarball
```
