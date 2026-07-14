---
'dorfl': patch
---

Prefer the plain `dorfl.json` per-repo config filename while still reading the legacy `.dorfl.json` dotfile on fallback. This corrects a rename sweep that had flattened every reference to the legacy dotfile down to `dorfl.json`, making the fallback docs self-contradictory and breaking the brand/repo-config/install-ci tests. The legacy `.dorfl.json` name is now consistently documented and tested as the read-only fallback, and the preferred `dorfl.json` is the name written by `setup` and reported by `install-ci`.
