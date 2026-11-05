---
name: seed
description: Seed the atlas of {{project}} from the repo, by area, with surveyor subagents. Use when the atlas is empty or a scope (an app, a directory) is missing from it.
---

The input is the user's scope (for example "Scout only"). The default scope is the whole repo.

1. **State.** Run `{{atlas}} list`. If it's non-empty, seed only what's missing.
2. **Skeleton (you, no deep reads).** Build the vocabulary and the area split from:
   - the repo layout: `git -C {{repo}} ls-tree -r --name-only main | awk -F/ '{print $1"/"$2"/"$3}' | sort | uniq -c | sort -rn | head -80`
   - AGENTS.md, CLAUDE.md and README in the scope's directories
   - `git -C {{repo}} log main --format=%s -n 300` (add `-- <dirs>` when scoped)
   - branch names: `git -C {{repo}} branch -a --merged main --format='%(refname:short)' | head -100`

   Pick 4 to 10 areas for the scope. An area is a product domain (what users would call a part of the product: feed, replies, curation), not an app or service. Its code usually spans several apps and services. A surface with its own users and its own vocabulary (an internal admin panel, a bot) can be an area of its own. For each area, write the root or area feature yourself (`feature add <area> --summary … [--parent <root>]`), with its aliases. Then map each area to its directories in every app and service (`git -C {{repo}} ls-tree -r --name-only main | grep -i <term>` per area), so the surveyors don't overlap.
3. **Survey.** Launch one `surveyor` per area in a single message. Each brief has:
   - the area feature name and its parent
   - the directories it owns, across all apps and services
   - the vocabulary hints you saw for it (commit terms, routes)
   - the current feature names from `{{atlas}} list`, so it reuses names instead of duplicating them
   - a target size of 5 to 20 features
4. **Review.**
   - Run `{{atlas}} list`. Merge duplicates (`feature merge`).
   - Fix parents.
   - `relate` features from different areas that work together, with a note saying how.
   - `show` any feature whose summary looks generic, and fix it.
5. **Tokens.** If the scope has a UI, write `{{tokens}}` from the theme files (CSS variables, Tailwind theme, design-token files) of the customer-facing apps, not internal tools: colors, type, radii, spacing and shadows, as CSS custom properties on `:root`, with a comment naming each source file. Copy values as written; don't convert or approximate them. When two customer apps have different themes, write one section per app with app-prefixed properties (`--web-…`, `--mobile-…`). Skip this when there's no UI in scope.
6. **Report:**
   - the feature count per area
   - the names you were unsure of
   - the areas you skipped
