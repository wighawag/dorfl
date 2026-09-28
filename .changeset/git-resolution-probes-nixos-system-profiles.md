---
'dorfl': patch
---

dorfl now finds git on NixOS even when it is launched with an environment that has no usable `PATH`. After the caller's own `PATH` and the standard system dirs (`/usr/local/bin`, `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`), it also looks in the NixOS system profiles `/run/current-system/sw/bin` and `/nix/var/nix/profiles/default/bin`, and adds them to the `PATH` git's own child processes see. `DORFL_GIT` / `GIT` still take precedence, then the caller's `PATH`, so a pinned git keeps winning. A `/usr/bin/git` symlink is no longer needed on NixOS.
