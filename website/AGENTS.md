# Working in `website/` (agent guidance)

This folder holds the **Dorfl** marketing/landing site. (Dorfl is the new name
for the tool currently called `agent-runner`.) It is scaffolded from our house
template `~/dev/github/wighawag/template-svelte-tailwind`
(SvelteKit + Svelte 5 + Tailwind v4 via `@tailwindcss/vite`, `adapter-static`).

> Note: some harnesses auto-load nested `AGENTS.md` files, some only load the
> repo-root one. The same rule is therefore also stated (briefly) in the root
> `AGENTS.md`. This file is the fuller version.

## The template-feedback rule (important)

This site is an _instantiation_ of `template-svelte-tailwind`. **Any decision,
fix, dependency change, config tweak, or better default made here might belong
back in the template.** We have historically improved instantiations and then
never fed the improvements back, so the template stagnates. Do not let that
happen on the Dorfl site.

- Maintain **`website/TEMPLATE-NOTES.md`**. Log every deviation from the
  template: _what_ changed, _why_, and whether it is **Dorfl-specific** (stays
  here) or a **general improvement** (candidate to backport to
  `template-svelte-tailwind`).
- When you finish a chunk of work, surface a short **"candidate backports"**
  list so the human can act on it.
- You do NOT modify the template yourself. Just record the candidates faithfully
  so the human can apply them later.

## Not a deviation (do not record these)

- The site lives **directly under `website/`** (flat app: `src/`, `static/`,
  `svelte.config.js` here), not under `website/web/`. That is only because
  `agent-runner` is **already a pnpm monorepo** (see `pnpm-workspace.yaml`,
  `packages/`), so `website/` is just another workspace member. The template's
  `web/` wrapper exists to turn a standalone repo into a monorepo; we already are
  one. This structural difference is expected, not template drift.

## Brand assets

- `website/branding/` is the committed Dorfl logo suite. The site **consumes**
  it; do not redesign it.
- Palette, locked head geometry, and the tagline ("It Claims Its Own Work",
  Title Case is an intentional Pratchett golem-speech nod) are documented in
  `website/branding/README.md`. Use the palette as the Tailwind theme:
  clay `#A4543C` / `#C9745A` / `#8A4632` / `#7E3D2C`, chem amber `#FFB23E`,
  slate `#23201C`, bone `#E9D9C7`.
- Canonical lockup: `dorfl-v9b-lockup.svg`. Hero art: `dorfl-v9b-hero.svg`.
  Favicon: `dorfl-v9b-favicon.svg`. Icon/og-image: `dorfl-v9b-icon.svg`.
- Rasterize SVG → PNG with `website/branding/build.sh` (outputs to the
  gitignored `website/branding/out/`).

## House rules

- **pnpm only.** Do not auto-commit; the human owns every git-state transition.
  Touch only `website/`. Run the site's `format` and `check` before declaring
  done.
