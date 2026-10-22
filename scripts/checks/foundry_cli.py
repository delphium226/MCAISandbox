"""The foundry's CLI handling, offline (#92): a quota or sign-in error stops the rounds (agy's real quota error from the
wool ticket, 10-22, and Claude-style ones), a normal reply or a crash with output is not one; this run's round files are
numbered after an earlier run's; the authorship names both writers of a ticket begun by one CLI and repaired by another.
Usage: python scripts/checks/foundry_cli.py      (prints one line a check, ends "FOUNDRY_CLI OK" or exits 1)
"""
import pathlib, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import foundry as F  # noqa: E402

fails = []


def ok(cond, what):
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


# The real agy result of 10-22 (runs/2026-10-22/g6-demand/agy_wool/cli-round2.jsonl), and others
agy = {"status": "ERROR", "response": "", "error": "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 81h45m7s."}
ok(bool(F.fatal_error(agy, "")) and "quota" in F.fatal_error(agy, "").lower(), "agy's quota error is fatal")
ok(bool(F.fatal_error({"is_error": True, "result": "Claude AI usage limit reached|1792700000"}, "")), "claude's usage limit is fatal")
ok(bool(F.fatal_error({}, "Error: Invalid API key. Please run /login\n")), "a sign-in error on stderr is fatal")
ok(F.fatal_error({"status": "SUCCESS", "response": "done"}, "") is None, "a normal reply is not")
ok(F.fatal_error({"status": "ERROR", "error": "tool call failed: file not found"}, "") is None, "an ordinary error is not")
ok(F.fatal_error({"is_error": False, "result": "the rate limit of the event loop is fine"}, "") is None, "result text of a successful turn is not read")

# Round files numbered after an earlier run's
with tempfile.TemporaryDirectory() as d:
    out = pathlib.Path(d)
    for n in (1, 2, 3, 4):
        (out / f"cli-round{n}.jsonl").write_text("{}", encoding="utf-8")
    cli = F.Cli("claude", "claude-opus-5-5", out, out, {"minutes": 45, "turns": 500, "rounds": 3})
    ok(cli.offset == 4, f"offset after 4 earlier rounds: {cli.offset}")
    empty = F.Cli("agy", "m", pathlib.Path(d) / "wt", pathlib.Path(d) / "none", {"minutes": 45, "turns": 500, "rounds": 3})
    ok(empty.offset == 0, "no earlier rounds: offset 0")

# agy's cumulative usage counted once (the amethyst ticket's rounds 2-4, 10-22: 0.32M, 0.33M, 0.47M input so far)
with tempfile.TemporaryDirectory() as d:
    c = F.Cli("agy", "m", pathlib.Path(d), pathlib.Path(d), {"minutes": 45, "turns": 500, "rounds": 3})
    for inp, outp in ((324689, 138335), (334361, 139121), (467293, 144807)):
        c.add_usage({"input_tokens": inp, "output_tokens": outp}, "conv1")
    ok(c.usage == {"input": 467293, "output": 144807}, f"cumulative rounds counted once: {c.usage}")
    c.add_usage({"input_tokens": 1000, "output_tokens": 10}, "conv2")
    c.add_usage({"input_tokens": 5, "output_tokens": 5})
    ok(c.usage == {"input": 468298, "output": 144822}, f"a new conversation and a per-call report add: {c.usage}")

# Authorship
class C:
    kind, model, round, steps = "claude", "claude-opus-5-5", 1, 12
ok(F.authorship(C, "agy (gemini-4-argon-high) round 1, cut off by its quota").startswith("Written agy (gemini-4-argon-high) round 1, cut off by its quota; then claude (claude-opus-5-5) in 1 repair rounds"), "both writers named")
ok(F.authorship(C, None).startswith("Written by claude"), "one writer")
C.round = 0
ok("the gates only" in F.authorship(C, "agy"), "gates only")

print("FOUNDRY_CLI OK" if not fails else f"FOUNDRY_CLI FAILED: {len(fails)}")
sys.exit(1 if fails else 0)
