# Self-hosted fonts (web)

All fonts here are OFL-1.1 (SIL Open Font License) and self-hosted (no CDN). We
ship only the formats/subsets the site actually uses.

## Hananiah (`hananiah.woff2`)

- A **Hebrew-SIMULATION** ("faux-Hebrew") display face: Latin letters redrawn to
  read as Hebrew script. Derived from Ezra SIL by "Christ Trekker".
- License: OFL-1.1. Distributed in the Open Siddur font pack
  (https://github.com/aharonium/fonts, "Non-Hebrew Scripts/Christ Trekker (OFL)").
- Used ONLY as a one-line display accent for the golem's signature
  (`Words In The Heart Can Not Be Taken`). This is faithful to the books: golem
  writing is described as "a corrupted form of the Hebrew alphabet made to appear
  as roman letters" (Feet of Clay). Display-only; never body text.
- Converted TTF -> woff2 with `npx ttf2woff2`.

> All other text uses the system stack: Inter/system-ui for UI and Georgia for
> the wordmark + serif headings. No other self-hosted fonts.
