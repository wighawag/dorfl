# Dorfl — branding

Brand assets for **Dorfl**, _It Claims Its Own Work_.

> Named after Dorfl, the golem who buys his own receipt and chooses his own
> purpose, in Terry Pratchett's _Feet of Clay_. A respectful nod, not an
> endorsement. Discworld and its characters are the creation of Sir Terry
> Pratchett.

## Status

**`v8` is the current work-in-progress system.** It introduces a deliberate
two-silhouette fork from one shared face geometry. Earlier `v2`…`v7` and the
original `dorfl-logo` / `-horizontal` / `-glyph-mono` are kept as drafts for
reference; they are not canonical. See _Evolution_ below.

## Logo construction (locked proportions)

All v8 assets are **one head**, drawn at fixed ratios, only the head box and the
framing change. This is an intentional _responsive logo_, not accidental drift:
when two assets differ, it is on purpose (silhouette fork + small-size
simplification), never because the numbers wandered.

**Two canonical silhouettes (the fork):**

| Silhouette | Head box (w×h) | Use                                        | File                  |
| ---------- | -------------- | ------------------------------------------ | --------------------- |
| **tall**   | 200 × 252      | hero, lockup, illustration ("standing")    | `dorfl-v8-tall.svg`   |
| **square** | 220 × 208      | icon, favicon, avatar, UI (fills the tile) | `dorfl-v8-square.svg` |

The square fork exists because a squarer head seats better in tiles/avatars
(less dead corner space); the tall fork keeps the standing-golem character.

**Shared, locked across BOTH silhouettes (do not let these drift):**

| Feature        | Spec                                                        |
| -------------- | ----------------------------------------------------------- |
| Visor band     | 148 × 72, corner r15, inset amber 132 × 56 r11              |
| `>` eye        | chevron, stroke weight **13**, round caps/joins             |
| `_` eye        | 34 × 11, r5.5, pulled tight to `>` (reads as a cursor)      |
| Mouth          | flat dash 58 × 10, r5, dark clay `#7E3D2C` — **deadpan**    |
| Jaw            | squared chin 92 × 26, r10, centered, flush at head bottom   |
| Shaded half    | right side, `#8A4632` @ 0.42 opacity                        |

The **only** legitimate per-asset differences are: (1) which silhouette is used,
(2) framing/scale, and (3) the mono version dropping the shaded half. Anything
else is a bug.

## Current files (v8)

| File                   | Silhouette | Use                                      |
| ---------------------- | ---------- | ---------------------------------------- |
| `dorfl-v8-tall.svg`    | tall       | master head (transparent), hero/inline   |
| `dorfl-v8-square.svg`  | square     | master head (transparent), tiles/avatars |
| `dorfl-v8-icon.svg`    | square     | app icon / favicon (slate tile)          |
| `dorfl-v8-lockup.svg`  | tall       | horizontal: head + `dorfl` + tagline     |
| `dorfl-v8-mono.svg`    | square     | single-ink (terminal, stamp, print)      |

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
| **`dorfl-v8-*.svg`**     | **current** — one locked geometry, tall+square fork, jaw not plug   |

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
