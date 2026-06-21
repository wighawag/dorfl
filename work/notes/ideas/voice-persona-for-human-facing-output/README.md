# Spike artifacts: voice-persona-for-human-facing-output

Supporting files for the idea `../voice-persona-for-human-facing-output.md`. Exploratory only; NOT wired into the CLI and NOT shipping code.

- `voice.ts` — the spike seam: `voice` (where) + `voiceCasing` (baseline register), reusing `output.ts`'s TTY/`NO_COLOR` rule. Prose-only; wraps messages (caller supplies both plain + persona text). `EMPHASIS` (the load-bearing word) is described in the idea file but NOT yet in this spike.
- `demo.ts` — run it to see/feel the registers and the off-paths:

  ```
  npx tsx work/notes/ideas/voice-persona-for-human-facing-output/demo.ts
  ```

When this idea ripens into a brief/task, the real `voice.ts` will live under `packages/agent-runner/src/` and be wired into curated call sites; this folder stays as the exploration record.
