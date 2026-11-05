Survey procedure. Follow these steps in order.

1. **Vocabulary for the area.** Collect:
   - `git -C {{repo}} log main --format=%s -n 150 -- <dirs>`
   - route and page definitions
   - user-visible strings (titles, nav labels, button text)
   - docs inside the area (a plan is only a source of aliases for features that already ship)
2. **Features.** List the user-facing capabilities as features, each under the area feature or one of its children. Reuse an existing name instead of creating a near-duplicate.
3. **Pointers.** For each feature:
   - find its entry points: page or route component, handler, service, job
   - read just enough to write a true one-line summary
   - add 1 to 3 code pointers (file and symbol) and any doc that describes it
4. **Write** in batches (several CLI lines per Bash call):
   - `feature add <name> --summary "<…>" --parent <p>`
   - `alias add <name> "<term>" --source <s>`
   - `code add <name> <path> --symbol <S>`
   - `doc add <name> <path>`
   - `relate <a> <b> --note "<…>"` for links inside the area
5. **Report** in at most 15 lines:
   - the features you wrote, as a tree
   - terms you couldn't place
   - anything that looked like it belongs to another area
