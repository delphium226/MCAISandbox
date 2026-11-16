---
name: brief-agent
description: Hand a piece of project work (a fix, a rung, an investigation, a panel change) to a background work agent with a complete brief, run several at once without collisions, and check each report before relaying it. Use when the coordinating session decides to delegate work, when the user says "decide what to do and do it", or when two or more independent pieces of work should run in parallel.
---

# Briefing and checking work agents

The coordinating session plans and checks; work agents (Agent tool, `general-purpose`, `run_in_background: true`) do
the work. A brief is the only context an agent gets, and its report comes back in the same confident voice whether it
worked or not, so both ends need care.

## Before writing a brief

- Who else is working: other agents of this session, linked sessions, live runs (`python scripts/stack.py status`). Split
  the work so no two agents edit the same file, and give each agent its own test world(s).
- Keep a copy of every brief in the scratchpad (`<topic>_brief.md`), so it can be re-sent or reused after a compaction.

## The brief

Write it in this order, plainly:

1. **Goal and done**: what to find or fix, and what counts as done ("reached live in a run from rt_base", "the cause
   named with numbers").
2. **What is known**: the run folders and logs, issue numbers, minutes and counts already measured, commits that touched
   it, what was ruled out. Point at files; don't paste them.
3. **Method**: measure first (lessons 99, 113, 129: count in 10-minute bins), then the smallest Minecraft-sensible fix,
   new behaviour behind a flag defaulting on (settings registry + `docs/SETTINGS.md`), a unit check where one fits.
4. **The rules block** (adapt the worlds and files, keep the rest):
   - Work in the clone `D:\Projects\MCAISandbox-scale50` (branch scale-50); read its CLAUDE.md (CRLF, never `sed -i`,
     settings registry, flags default on) and grep `docs/LESSONS.md` for the area.
   - Test world(s) N are yours; never touch the others' ports (name them). At most 2 runs at once.
   - Launch every run from a `git archive` of a commit (the `live-run` skill). If auto mode blocks a detached start,
     stop and say so in the report; never work around it.
   - Another agent edits X at the same time: stay out of its files; in a shared file (mcWorld.ts, ladder.ts) keep hunks
     small and commit only your own (`git apply --cached` of your own patch, check `git diff --cached`).
   - Checks: `npm run typecheck`, `npm run check:offline` (name the known failures, e.g. palette_golden on scale-50,
     choice_golden on tiered-brain-building).
   - Commit on scale-50 ending with the harness's `Co-Authored-By` line, push `private scale-50`; port to
     tiered-brain-building (the `port-branch` skill), push private. Never main or origin, no worktrees.
   - Update the spec doc, comment on the issue and close it if done; file an issue (with a milestone) for what is left.
     Remove your bots.
5. **Report form**: causes with numbers, fixes (commits, file:line), runs (stage minutes, busy %, `[stuck]`/`[lag]`),
   what was not tested, risks.

## While agents run

Tell the user in a line or two what each agent is doing and on which world (with the world's addresses if they may
watch). Don't predict results. Interim "waiting on its own background work" notices need at most a one-line note.

## When a report arrives: check before relaying

```bash
cd /d/Projects/MCAISandbox-scale50 && git fetch -q private && git log --oneline -3 private/scale-50
cd /d/Projects/MCAISandbox && git fetch -q private && git log --oneline -3 private/tiered-brain-building
gh issue view N --json state --jq .state
python scripts/stack.py status   # its world shows 0 agents
```

Then relay: the outcome first, the numbers in a short table, the commits on both branches, what is untested, the risks.
Say plainly what failed or was skipped. A follow-up that acts on the report (one more run, the next fix) is offered as
the closing question, not started unasked.
