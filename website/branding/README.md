# Dorfl — branding

Brand assets for **Dorfl**, _It Claims Its Own Work_.

> Named after Dorfl, the golem who buys his own receipt and chooses his own
> purpose, in Terry Pratchett's _Feet of Clay_. A respectful nod, not an
> endorsement. Discworld and its characters are the creation of Sir Terry
> Pratchett.

## Status

**`v9b` is the current canonical system: ONE head (square + jaw), used
everywhere.** Square/circle/tiny contexts are solved by _framing and cropping_
the one head, never by re-proportioning the creature. The hero/lockup may show a
_bit of body_ below the head, but the body is purely additive: it never changes
the head's shape.

This supersedes the `v8` two-proportion fork (tall + square head), which risked
deforming the creature. Earlier `v2`…`v7`, `v8*`, and `v9a` are kept as drafts.
See _Evolution_ below.

## Logo construction (locked geometry)

There is **one head**. Every asset is the same head, only the _framing_ changes
(crop, scale, container, optional body below). This is a responsive logo, not
drift: differences are deliberate, never the numbers wandering.

**The head (canonical — square + jaw). Do not let these drift:**

| Feature     | Spec                                                          |
| ----------- | ------------------------------------------------------------- |
| Head box    | 220 × 208, corner r30                                         |
| Jaw         | squared chin 92 × 26, r10, centered, flush at head bottom     |
| Visor band  | 148 × 72, r15; inset amber 132 × 56, r11                       |
| `>` eye     | chevron, stroke weight **13**, round caps/joins               |
| `_` eye     | 34 × 11, r5.5, pulled tight to `>` (reads as a cursor)        |
| Mouth       | flat dash 58 × 10, r5, dark clay `#7E3D2C` — **deadpan**      |
| Shaded half | right side, `#8A4632` @ 0.42 opacity                          |

**The jaw is NON-NEGOTIABLE.** Without it the square reads as a terminal
window/card, not a head (see `dorfl-v9b-head-nojaw.svg`, kept as the proof). The
chin is the cheapest possible silhouette cue and the thing that says "creature."

**Showing a body (hero/lockup only):** the body is drawn _behind_ the head and
rises to tuck **under the jaw** (neck meets chin, like a real bust). The head
geometry above is unchanged — the body is additive and is cropped by the frame.
Never flatten the jaw to attach a neck.

The **only** legitimate per-asset differences are: (1) framing/scale/crop,
(2) container (square tile / circle / band), (3) whether a body is shown, and
(4) mono dropping the shaded half. Anything else is a bug.

## Current files (v9b canonical + v9a alt)

| File                          | Use                                                |
| ----------------------------- | -------------------------------------------------- |
| `dorfl-v9b-head.svg`          | **the mark** — square head + jaw (avatar/tile)     |
| `dorfl-v9b-lockup.svg`        | horizontal: head + bit of chest + `dorfl` + tagline|
| `dorfl-v9b-hero.svg`          | full standing golem (illustration only)            |
| `dorfl-v9b-head-nojaw.svg`    | rejected experiment (why the jaw stays)            |
| `dorfl-v9a-*.svg`             | tall-head alternative (head-only lockup, icons)    |

## The idea

The mark is a calm clay-golem **head** whose **face is a command prompt**:

- **Eyes = `>_`** — a golem is animated by words; Dorfl was rebuilt and _given a
  voice_. His eyes spell a CLI cursor: he is a being that was given language.
  Drawn inside a recessed glowing amber visor with a dark border.
- **Mouth = a flat ASCII line** — deliberately **deadpan, not a smile**. Dorfl is
  the Disc's first ceramic atheist; he survives a divine thunderbolt and calls it
  "Not Much Of An Argument." The charm is _serene, unbothered dignity_, not
  cuteness. A smiling mouth (see the retired `v6` `~`) reads as a friendly robot
  mascot and loses him.
- **Clay, blocky, honest** — golems are clay/stone; his Hebrew/Yiddish name means
  "holy innocent." Humble, square, tireless (he never sleeps), fireproof.

The wordmark tagline **"It Claims Its Own Work"** is set
With-Every-Word-Capitalised, because golems Speak With The First Letter Of Every
Word Capitalised. "Claims" is true twice over: it is the tool's atomic
claim-a-slice protocol _and_ Dorfl's arc of claiming his own freedom.

## Evolution (drafts → current)

| Draft                    | What it tried / why it isn't canonical                              |
| ------------------------ | ------------------------------------------------------------------- |
| `dorfl-logo.svg`         | v1 hero — gradient clay head, separate brow-slot + round eyes        |
| `dorfl-horizontal.svg`   | v1 wide lockup                                                       |
| `dorfl-glyph-mono.svg`   | v1 single-ink glyph                                                  |
| `dorfl-v2.svg`           | prompt-forward + flat, but the silhouette read as a jar             |
| `dorfl-v3-glyph.svg`     | abstract carved tablet with a `>_` slot (still a nice alt icon)     |
| `dorfl-v4.svg`           | `>_` glowing directly on the face (raw, no border)                  |
| `dorfl-v5.svg`           | `>_` in a recessed visor, but eyes too far apart (read as 2 eyes)   |
| `dorfl-v6.svg`           | tighter `>_` + `~` mouth — but the smile made him cute, lost charm  |
| `dorfl-v7*.svg`          | deadpan flat mouth + lore tagline — right face, but assets drifted  |
| `dorfl-v8-*.svg`         | one locked geometry, but a two-PROPORTION fork (risked deforming)   |
| `dorfl-v9a-*.svg`        | one TALL head; square/circle/favicon by framing+crop (alt)         |
| **`dorfl-v9b-*.svg`**    | **current** — one SQUARE+jaw head everywhere; body shown only below |

## Building

SVG is the source of truth (tracked). PNGs are generated into `out/`
(gitignored). Render everything with:

```sh
./build.sh
```

It renders each SVG to `out/<name>.png`, `out/<name>@512.png`, and
`out/<name>-favicon.png`, auto-detecting `magick` (ImageMagick v7) or `convert`.

Prefer an **icon-only** lineage (no tagline) for small favicons; taglined
lockups are for README/site headers.

## Palette

| Token        | Hex       | Use                                  |
| ------------ | --------- | ------------------------------------ |
| Clay (light) | `#C9745A` | Highlights, tagline                  |
| Clay (base)  | `#A4543C` | Golem head                           |
| Clay (shade) | `#8A4632` | Carved shaded half                   |
| Clay (dark)  | `#7E3D2C` | Deadpan mouth, seams                 |
| Chem amber   | `#FFB23E` | The glowing visor (the `>_` band)    |
| Visor inset  | `#1C1813` | Recessed band + carved `>` `_` chars |
| Slate        | `#23201C` | Background tile                      |
| Bone         | `#E9D9C7` | Wordmark                             |

Amber (`#FFB23E`) is the one warm light in the head — the brand pop. Use it only
for the visor.

## Typography

Wordmark: a serif (Georgia placeholder) for a "carved" feel; a chunkier slab is a
candidate later. Tagline: monospace, Title Case, tying the golem-speech nod to the
CLI.
