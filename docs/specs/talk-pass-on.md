# A request one member cannot serve is passed to one who can (#233 follow-up, F361)

## The problem

F361's live tier: a member's talk prompt lists the chores its menu offers now, 0-17 of them (about 4 typical), not the
bench's 18-24. The menu drops what is not wanted (no `gather:cobblestone` with 1,439 in storage), what other members
hold (the pens and the breeding), what this member cannot do (no watch or hunt unarmed, no eat or rest 110 blocks out).
Six requests the bench expects promised were refused, truly by the list ("I have no chore that breeds sheep"). The
refusal is right, but the person's request then goes nowhere, though another member often has that chore on its list.

## The smallest thing that works

A member's refusal "nothing on my list does it" is passed to one other member whose list does have a chore that fits.
It reuses what is there: the `via` hand-over the forward to the Mayor already makes (`talkHeard(target, from, text, pos,
via)`), the target's own talk call with its own chores, and the promise that `talkPromise` runs when the target is free.

1. **When.** A member (not the Mayor) answers `refuse`, the request did not come by another member (`via`: one hop
   only), the village is complete, and either the model's reason says it has no chore (or no weapon) for it (`no
   chore`, `no weapon`, `not on my list`, `nothing on my list`...) or code refused a promise whose option was not on its
   list. A refusal for any other reason (it cannot hand items over, it is hurt, outside the game) stays a refusal.
2. **Who.** Code reads the other members' feasible menus now (the Mayor and the speaker left out; `menu(...).feasible`,
   as the talk call does) and scores each option against the person's words: shared words between the line and the
   option's name and id, with a short list of words for the same thing (zombie/skeleton/monster/fight -> watch, hunt;
   wood/trees -> logs; stone -> cobblestone; food -> eat, meal); place words ("home", "tower", "hut") do not count, so
   "be home before dark" is no rest. The member's own and project chores (`own:`, `help:`, `initiate:`, `custom:`,
   `innovate:`) are left out: they serve the member, not a person's ask. The best score wins; a tie goes to the idle
   member, then the nearest to the person. No option scores: nobody is asked. Options held by other members are not on
   anyone's feasible list but the holder's, so a held chore is not passed.
3. **What is said.** The refusing member's line gets "; I'll ask Ben, who can (option name)" after code's reason. The
   request is marked `refused` with `outcome: passed to Ben`. Ben's talk call then sees "Lena passes on what
   SausageOfDoom4 said to them" and answers as for any line: promise (code keeps it as any promise), refuse or chat.
4. **Flag.** `MC_TALK_PASS` (on by default; `off` leaves refusals as they are). No new kind, no prompt change: the bench
   (one call a case) is not affected; the live tier sees a second request in the ledger with `via`.

## Not in this step

- The menu itself does not change for a person's ask: when no member has the chore (cobblestone with storage full,
  every direction explored), the refusal stands. A person's ask as a want that adds the option (the request standing for
  "something wants it") is the next step if live runs show those refusals matter.
- The Mayor offering it as a public task: not needed while another member's list holds the chore.
