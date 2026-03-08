---
title: MOA RL Environment
emoji: 🤖
colorFrom: blue
colorTo: purple
sdk: docker
pinned: false
---

# MOA RL Environment

An OpenEnv-compatible RL environment for training agents on real TypeScript engineering tasks derived from MOA developer session traces.

## API

- `POST /reset` — get a new task (broken file + description + tests)
- `POST /step` — submit a fix, get vitest reward score
- `GET /state` — current environment state
