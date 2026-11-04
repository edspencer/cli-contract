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

Each tool copies the reference code into its own repo rather than depending on a package. Localidraw allows no
runtime dependencies, and a fix to six products' lifecycle code is six small PRs either way. `reference/` and the
conformance tests come next (ROADMAP step 1).

[MIT](LICENSE).
