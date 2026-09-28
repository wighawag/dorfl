---
title: 'install-ci auth-json mode never passes PI_AUTH_JSON (or GH_PAT) to any job'
slug: install-ci-auth-json-never-wires-pi-auth-json
date: 2026-09-28
status: spotted
---

2026-09-28, noticed while building `ci-split-generate-workflows`.

In `auth-json` mode the generated `dorfl-setup` action reads `$PI_AUTH_JSON` (and the refresh script `$GH_PAT`) from the environment, but `providerSecretsWithBlock` returns nothing for auth-json and no generated workflow sets either variable, so the "Configure agent auth (auth.json)" step would exit with "PI_AUTH_JSON secret is not set" (`packages/dorfl/src/install-ci-core.ts`, `generateSetupAction` / `providerSecretsWithBlock`). Pre-existing and unchanged by the split. Unverified beyond reading the code. Note for a fix: `GH_PAT` is a write-capable token, so wiring it would put a write credential into the agent job, which ADR `ci-agent-job-holds-no-write-token` forbids.
