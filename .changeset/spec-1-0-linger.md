---
"@edspencer/cli-conformance": patch
---

The package now ships SPEC 1.0. Nothing a tool must do changed from 0.2; the wording of §5 "Without a service" now matches step 9 (a foreground `serve` that's answering makes `update` exit 3 before it installs), and §7 says that when `loginctl` can't answer, `install` prints nothing about linger and `doctor` reports the check as skipped. `reference/service/index.ts`'s `lingerAdvice` follows: it returns nothing unless linger is off.
