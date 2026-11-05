---
name: correct
description: Apply a user's correction to a feature in the atlas of {{project}} and mark it verified. Use when the user says an atlas entry is wrong or gives the right answer.
---

1. Apply the user's correction to the feature with the CLI (`feature set`, `alias`, `code`, `doc`, `relate`).
2. Mark the feature verified: `{{atlas}} feature set <name> --verified`.
3. Report what you changed.
