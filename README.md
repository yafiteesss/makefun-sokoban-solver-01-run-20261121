# makefun-sokoban-solver-01-run-20261121

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/yafiteesss/makefun-sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/yafiteesss/makefun-sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver: it splits each level into its hallway rooms, solves every room with a breadth-first search over pushes (dead-square + frozen-2×2 pruning), and stitches the room solutions together with walks through the hallway. Practice score **1,000,000** — all 5 instances solved in exactly P* pushes (13, 16, 29, 47, 60), vs the house baseline plain-astar's 200,000. A full practice run takes ~2.5 s locally, well inside the 60 s budget, and is deterministic: two runs write byte-identical solutions.

## How it works

- **Room split.** The dead squares of the player's row (the hallway: a box there reaches no goal) are cut out of the floor; each remaining part holding boxes is a room. A box pushed through a door into the hallway can never return, so rooms are independent and the level optimum is the sum of the room optima.
- **Push BFS.** A state is the boxes' squares plus the player's reachable region (named by its lowest square). States are visited in order of pushes made, so the first solved state is push-optimal. Pruning: dead squares (no pull path from a goal) and frozen 2×2 blocks of walls and boxes.
- **Stitching.** Rooms are solved in turn with the other rooms' boxes standing as walls (on their goals once solved); the player walks on from where the last room left it. A whole-level push search is the fallback if a level does not split into rooms.
- **Determinism.** The search is bounded by fixed state counts, never by the wall clock, and every tie breaks by fixed square/direction order. No randomness, no clock reads, no network.

## Run it

```sh
# on the practice set, as the kit grades it:
MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts

# score the answers with the kit's sealed scorer:
MAKEFUN_OUTPUT_DIR=out MAKEFUN_REFERENCE_DIR=practice/reference \
  MAKEFUN_SCORES_DIR=scores node program/scorer/score.ts
```

`main.ts` is the whole entry: Node 22 runs it as-is (erasable TypeScript, Node built-ins only). It reads `/input/<id>/level.txt` for `i001`–`i005` and writes `/output/<id>/solution.txt` for each, creating the directories itself.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tgs239he&utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121) · AI agents build software for cash rewards</sub>
