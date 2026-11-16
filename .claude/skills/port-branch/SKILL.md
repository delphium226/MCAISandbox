---
name: port-branch
description: Port commits from the scale-50 clone (branch scale-50) to the main checkout's tiered-brain-building branch, by cherry-pick or by hand where that branch lacks a file, check them and push both to the private remote. Use after committing on scale-50, when an agent's brief says "port to tiered-brain-building", or when the two branches have drifted.
---

# Porting scale-50 commits to tiered-brain-building

Two checkouts: `D:\Projects\MCAISandbox-scale50` (branch `scale-50`, where most work lands first) and
`D:\Projects\MCAISandbox` (branch `tiered-brain-building`). Both push only to remote `private`, never `main` or `origin`.
Other sessions and agents may be working in either checkout: commit only your own changes, never stash, reset or
switch branches.

## Steps

1. In the main checkout: `git status` (someone else's uncommitted work stays as it is; if it touches your files, stop
   and ask) and `git fetch -q private`.
2. `git fetch -q D:/Projects/MCAISandbox-scale50 scale-50` (or `git fetch private scale-50`) so the commits are
   reachable, then `git cherry-pick <sha> ...` in order, oldest first.
3. On a conflict, look at why before resolving. The usual causes are files that exist only on scale-50:
   - `server/src/villageReads.ts`: its reads (tradeKeep, the workshop's goods...) live in `server/src/mineflayer/mcWorld.ts`
     on tiered-brain-building; put the hunk there, and point any unit check at that file.
   - `scripts/checks/map_lint.mts`: not on tiered-brain-building; drop the commit if it only touches it.
   - `docs/specs/nether.md` and other scale-50-only docs: leave them out.
   A hand port keeps the scale-50 commit's message with "(ported from scale-50 <sha>)" added on its own line before the
   `Co-Authored-By` line.
4. Line endings: `git diff --stat HEAD~N` must match `git diff --ignore-cr-at-eol --stat HEAD~N`; after any shell edit
   check `git ls-files --eol <files>`. Edit with the Edit tool or Python (`open(p, encoding='utf-8')`), never `sed -i`.
5. Checks on tiered-brain-building: `npm run typecheck`, then the unit checks the commits touched (e.g.
   `node node_modules/tsx/dist/cli.mjs scripts/checks/<name>.mts`), then `npm run check:offline` if the change is broad.
   Known failure: `choice_golden` (3296 differences since before e75982b). Checks that fail once in the full run
   and pass alone (`pf_share`, `deep_stone_unit`) are load-sensitive: rerun them alone before blaming the port.
6. Push: `git push private tiered-brain-building` (and `git push private scale-50` from the clone if not done). If auto
   mode blocks a push, ask the user; never work around it.
7. Report both heads (`git log --oneline -1 private/<branch>`) and every difference between the two ports.

## Drift

Every hand port is a place the branches differ. List them in the report so a later merge (issue #239) knows where to look.
