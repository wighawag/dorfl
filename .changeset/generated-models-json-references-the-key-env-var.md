---
'dorfl': patch
---

The `models.json` that `dorfl install-ci` generates now references each provider API key as an environment variable (`"apiKey": "$ANTHROPIC_API_KEY"`) instead of the bare env-var name. The pinned pi harness reads a config value as an env var only when it is written `$NAME` or `${NAME}` and treats anything else as a literal, so it sent the string `ANTHROPIC_API_KEY` as the token and every CI agent launch failed with `401 Unauthorized`, even with a valid provider secret. Re-run `dorfl install-ci` to regenerate `.github/actions/dorfl-setup/action.yml` with the fix.
