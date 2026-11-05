---
name: refresh
description: Bring the atlas of {{project}} back in line with the repo. Use when the user asks to refresh or update the atlas, or when pointers have gone stale.
---

1. Run `{{atlas}} check`.
2. Re-survey the features it reports as changed, with `surveyor` subagents. Launch independent areas in one message so they run in parallel.
3. Fix the broken code pointers it reports.
4. If the app's theme files changed, rewrite `{{tokens}}` from them.
5. Report what changed in the atlas (counts and names) and what is still unknown.
