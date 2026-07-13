# Vendored: `incur/src/internal/agents.ts` (MIT)

`agents.ts` here is a **verbatim** copy of `src/internal/agents.ts` from
[wevm/incur](https://github.com/wevm/incur) (MIT). See `LICENSE` beside it for the
required copyright + permission notice, which is also duplicated as a header
comment at the top of `agents.ts` itself so the file stays attribution-complete
in isolation.

We VENDOR rather than depend (see
`docs/adr/skill-install-vendors-incur-agents-map.md`): the harness-destination
map + copy/symlink logic are the one hard, drift-prone piece we need, and the
file is dependency-free (only `node:fs`/`os`/`path`). Keep it BYTE-CLOSE to
upstream so a future incur update is a mechanical re-copy — put all wrapper
code outside this directory (`../../install-skills.ts`).

To refresh: re-fetch `src/internal/agents.ts` from the upstream tag you want,
overwrite `agents.ts`, keep the small ATTRIBUTION HEADER block at the top
(above the original `import` lines) intact, and re-copy `LICENSE` if it
changed upstream.
