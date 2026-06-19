# Dorfl — branding

Brand assets for **Dorfl**, _the golem that claims its own work_.

> Named after Dorfl, the golem who buys his own receipt and chooses his own
> purpose, in Terry Pratchett's _Feet of Clay_. A respectful nod, not an
> endorsement. Discworld and its characters are the creation of Sir Terry
> Pratchett.

## The idea

The mark is a calm clay-golem head built from **stacked blocks**. Three meanings
share one shape:

- **Golem** — Dorfl is clay/stone; humble, blocky, tireless.
- **The chem** — a golem runs on words placed inside its head. That's the
  glowing slot across the forehead, drawn as a `>_` prompt: the words/spec that
  animate the agent are the same glyph as the CLI that drives it.
- **Stacked work** — the seams between blocks echo the product itself: one file
  per slice, status is the folder it lives in, no database, no mortar. It holds
  by how the pieces fit.

The eyes are steady, not menacing: Dorfl chose his own purpose.

## Files

| File                     | Use                                                   |
| ------------------------ | ----------------------------------------------------- |
| `dorfl-logo.svg`         | Hero / app-icon (512, rounded square on slate)        |
| `dorfl-horizontal.svg`   | Wide lockup with wordmark + tagline (README, site)    |
| `dorfl-glyph-mono.svg`   | Single-ink glyph (favicon, terminal, stamp)           |

SVG is the source of truth. Rasterize with ImageMagick or Inkscape, e.g.:

```sh
magick -background none dorfl-logo.svg dorfl-logo.png
magick -background none dorfl-glyph-mono.svg -resize 32x32 favicon-32.png
```

Prefer the **mono glyph** lineage for small favicons; it reduces more cleanly
than the gradient hero.

## Palette

| Token       | Hex       | Use                              |
| ----------- | --------- | -------------------------------- |
| Clay (light)| `#C9745A` | Golem body highlight             |
| Clay (base) | `#A4543C` | Golem body                       |
| Clay (dark) | `#7E3D2C` | Seams, crown/jaw blocks          |
| Chem amber  | `#FFB23E` | The lit forehead slot; eyes; accent |
| Chem gold   | `#FFD27A` | Chem highlight                   |
| Slate       | `#2A2622` | Background, knocked-out details  |
| Bone        | `#E9D9C7` | Wordmark, light-ink glyph        |

Amber (`#FFB23E`) is the brand pop — the one warm light in the head. Use it
sparingly.

## Typography

Wordmark is currently set in a serif (Georgia placeholder) for a "carved stone"
feel; a chunkier slab / humanist serif is a candidate for v2. The tagline is set
in a monospace to tie back to the CLI.
