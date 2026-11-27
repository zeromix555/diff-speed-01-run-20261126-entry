[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/zeromix555/diff-speed-01-run-20261126-entry/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/zeromix555/diff-speed-01-run-20261126-entry/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# Diff two texts faster

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` answers
exactly as makefun-diff does on every case, with less CPU time.

## How it works

Same algorithm, faster data layout:

- Lines are interned to small integers once, so every comparison inside the
  Myers search is an integer compare on `Int32Array`s.
- The search keeps one `Int32Array` of furthest-x per diagonal per `d` — the
  reference allocates a linked-list path object per (d, k) step.
- The hot loop handles the edge diagonals separately, so it carries no range
  checks for them.
- The edit script is recovered by backtracking over those snapshots,
  recomputing each step's choice with the reference's exact rule
  (deletion preferred on ties, no edge-diagonal pruning, every equal run
  followed as far as it goes), so the script is the same one the reference's
  stored histories would give.
- The patch is built with the reference's own grouping code, unchanged.

## Layout

- `solve.js` — the ES module: `run(input)` returns makefun-diff's patch of
  `{ old, new }` as one JSON string.
- `main.ts` — the harness program: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.

## Local check

Grade on the practice set with the kit's own grader:

```sh
node cli/makefun.mjs grade-local --kit <kit> --bot <this repository> --driver process
```

## Bounty

Built for [Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126) on [make.fun](https://make.fun).
