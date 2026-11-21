// A push-optimal Sokoban solver for make.fun's sokoban-solver-01-run-20261121.
//
// Idea: every level is a one-wide hallway with 1-4 small rooms off it, each room
// holding 3-4 boxes and as many goals. A box pushed out of a room's door into the
// hallway can never be pushed back (the player would have to stand on the far side
// of the hallway, which is wall), so each room is an independent puzzle and the
// level's push-optimum is the sum of the rooms' optima. The solver therefore
// splits the level into rooms, solves each room push-optimally, and stitches the
// room solutions together with plain walks through the hallway.
//
// Each room is solved by breadth-first search over pushes: a state is the boxes'
// squares plus the player's reachable region (named by its lowest square), so the
// first solved state the search meets uses the fewest pushes. Two prunings keep
// the search small, and neither can prune a solvable state:
//   - dead squares: a square from which no sequence of pulls brings a box onto a
//     goal (computed by pulling backwards from the goals over open floor);
//   - frozen 2x2 blocks: four squares of walls and boxes holding a box off goal.
// The search is bounded by a fixed number of states, never by the clock, and
// every tie is broken by fixed square/direction order, so two runs write the
// same bytes. If a level does not split into rooms, the same search runs over
// the whole level as a fallback.
//
// Local run: MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Work budgets, counted in states, never in wall-clock time: the search gives
// up past these instead of answering differently from one run to the next.
const ROOM_STATE_CAP = 400_000;
const WHOLE_STATE_CAP = 400_000;

// The four steps, in a fixed order that also breaks every tie in the search.
const DIRS = [
  { dx: 0, dy: -1, step: 'u', push: 'U' },
  { dx: 0, dy: 1, step: 'd', push: 'D' },
  { dx: -1, dy: 0, step: 'l', push: 'L' },
  { dx: 1, dy: 0, step: 'r', push: 'R' },
];

interface Board {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** A level in XSB (# wall, space floor, . goal, $ box, * box on a goal, @ player). */
function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { w, h, wall, goals: goals.sort((a, b) => a - b), boxes: boxes.sort((a, b) => a - b), player };
}

/**
 * The squares a lone box can be pushed from onto some goal: start at the goals
 * and pull backwards — a square y is live when the square past it in some
 * direction (y + d) is live and the square before it (y - d) is open floor for
 * the player to stand on and pull from.
 */
function liveSquares(bd: Board): Uint8Array {
  const live = new Uint8Array(bd.w * bd.h);
  const queue: number[] = [];
  for (const g of bd.goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const dir of DIRS) {
      const d = dir.dy * bd.w + dir.dx;
      const y = x - d;
      if (!bd.wall[y] && !bd.wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/** The square the player ends on after walking `moves` (case aside) from `from`. */
function endPos(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  return p;
}

/**
 * The push-optimal solution of one board ({pushes, moves} in LURD, an upper
 * letter for a push), or null when the search gives up or the board is dead.
 * Breadth-first over pushes: states are visited in order of pushes made, so
 * the first solved state met is optimal.
 */
function pushSearch(bd: Board, cap: number): { pushes: number; moves: string } | null {
  const size = bd.w * bd.h;
  const goal = new Uint8Array(size);
  for (const g of bd.goals) goal[g] = 1;
  const live = liveSquares(bd);
  for (const b of bd.boxes) if (!live[b]) return null;

  const wall = bd.wall;
  const occupied = new Uint8Array(size);
  // Two stamp arrays, so the region of a state and the region of the state a
  // push would make never overwrite each other's marks; one shared stack.
  const seenMark = new Int32Array(size);
  const probeMark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;
  let curTag = 0;

  // The lowest square of the region reachable from `from`, stamped in `mark`.
  const regionLow = (from: number, mark: Int32Array): number => {
    curTag = ++stamp;
    let low = from;
    let n = 0;
    stack[n++] = from;
    mark[from] = curTag;
    while (n > 0) {
      const p = stack[--n];
      if (p < low) low = p;
      const q0 = p - bd.w;
      const q1 = p + bd.w;
      const q2 = p - 1;
      const q3 = p + 1;
      if (!wall[q0] && !occupied[q0] && mark[q0] !== curTag) { mark[q0] = curTag; stack[n++] = q0; }
      if (!wall[q1] && !occupied[q1] && mark[q1] !== curTag) { mark[q1] = curTag; stack[n++] = q1; }
      if (!wall[q2] && !occupied[q2] && mark[q2] !== curTag) { mark[q2] = curTag; stack[n++] = q2; }
      if (!wall[q3] && !occupied[q3] && mark[q3] !== curTag) { mark[q3] = curTag; stack[n++] = q3; }
    }
    return low;
  };

  // Whether the box just pushed to `to` sits in a frozen 2x2 block of walls and
  // boxes holding a box off its goal. `occupied` must already hold the box at
  // `to` (and no longer at its old square) when this runs.
  const frozenBlock = (to: number): boolean => {
    for (const a of [to, to - 1, to - bd.w, to - bd.w - 1]) {
      const b = a + 1;
      const c = a + bd.w;
      const d = c + 1;
      if (!((wall[a] || occupied[a]) && (wall[b] || occupied[b]) && (wall[c] || occupied[c]) && (wall[d] || occupied[d]))) continue;
      if ((occupied[a] && !goal[a]) || (occupied[b] && !goal[b]) || (occupied[c] && !goal[c]) || (occupied[d] && !goal[d])) return true;
    }
    return false;
  };

  // The shortest walk from `from` to `to` around walls and boxes, in lower
  // LURD letters, the first direction first on ties.
  const walkTo = (from: number, to: number): string => {
    if (from === to) return '';
    const prev = new Int32Array(size).fill(-1);
    const how: string[] = new Array<string>(size);
    const queue = [from];
    prev[from] = from;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      if (p === to) break;
      for (const dir of DIRS) {
        const q = p + dir.dy * bd.w + dir.dx;
        if (wall[q] || occupied[q] || prev[q] !== -1) continue;
        prev[q] = p;
        how[q] = dir.step;
        queue.push(q);
      }
    }
    if (prev[to] === -1) throw new Error('no walk to the push square');
    let s = '';
    for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
    return s;
  };

  const solved = (bs: number[]): boolean => bs.every((b) => goal[b] === 1);
  const keyOf = (bs: number[], low: number): string => `${low}|${bs.join(',')}`;

  // The states in the order found: boxes, the player's square after the push
  // that made the state, and the push (from -> to) from the parent state.
  const statesBoxes: number[][] = [bd.boxes.slice()];
  const statesPlayer: number[] = [bd.player];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushTo: number[] = [-1];
  const index = new Map<string, number>();
  index.set(keyOf(bd.boxes, regionLow(bd.player, seenMark)), 0);
  if (solved(bd.boxes)) return { pushes: 0, moves: '' };

  let found = -1;
  for (let head = 0; head < statesBoxes.length && found < 0; head++) {
    const bs = statesBoxes[head];
    for (const b of bs) occupied[b] = 1;
    regionLow(statesPlayer[head], seenMark);
    const tag = curTag;
    for (let bi = 0; bi < bs.length && found < 0; bi++) {
      const from = bs[bi];
      for (const dir of DIRS) {
        const d = dir.dy * bd.w + dir.dx;
        const to = from + d;
        const stand = from - d;
        if (seenMark[stand] !== tag) continue; // the player cannot get behind this box
        if (wall[to] || occupied[to] || !live[to]) continue;
        occupied[from] = 0;
        occupied[to] = 1;
        if (frozenBlock(to)) {
          occupied[to] = 0;
          occupied[from] = 1;
          continue;
        }
        const next = bs.slice();
        next[bi] = to;
        next.sort((a, b) => a - b);
        const nlow = regionLow(from, probeMark);
        occupied[to] = 0;
        occupied[from] = 1;
        const key = keyOf(next, nlow);
        if (index.has(key)) continue;
        if (statesBoxes.length >= cap) {
          for (const b of bs) occupied[b] = 0;
          return null;
        }
        index.set(key, statesBoxes.length);
        statesBoxes.push(next);
        statesPlayer.push(from);
        parent.push(head);
        pushFrom.push(from);
        pushTo.push(to);
        if (solved(next)) {
          found = statesBoxes.length - 1;
          break;
        }
      }
    }
    for (const b of bs) occupied[b] = 0;
  }
  if (found < 0) return null;

  // The path of states, then the moves: walk to each push's square, then push.
  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = bd.player;
  let curBoxes = bd.boxes.slice();
  for (const s of path) {
    const from = pushFrom[s];
    const to = pushTo[s];
    const d = to - from;
    const dir = DIRS.find((dd) => dd.dy * bd.w + dd.dx === d);
    if (!dir) throw new Error('push with no direction');
    for (const b of curBoxes) occupied[b] = 1;
    moves += walkTo(player, from - d);
    for (const b of curBoxes) occupied[b] = 0;
    moves += dir.push;
    player = from;
    const i = curBoxes.indexOf(from);
    curBoxes[i] = to;
    curBoxes.sort((a, b) => a - b);
  }
  return { pushes: path.length, moves };
}

/**
 * The level's rooms: cut the dead squares of the player's row (the hallway: a
 * box there reaches no goal) out of the floor, and each part left that holds a
 * box is a room, its boxes and goals. Null when some part holds more or fewer
 * boxes than goals, or a box or goal starts in the hallway: then the level is
 * no set of rooms.
 */
function splitRooms(bd: Board): { goals: number[]; boxes: number[] }[] | null {
  const live = liveSquares(bd);
  const row = Math.floor(bd.player / bd.w);
  const cut = new Uint8Array(bd.w * bd.h);
  for (let x = 0; x < bd.w; x++) {
    const i = row * bd.w + x;
    if (!bd.wall[i] && !live[i]) cut[i] = 1;
  }
  for (const b of bd.boxes) if (cut[b]) return null;
  for (const g of bd.goals) if (cut[g]) return null;
  const comp = new Int32Array(bd.w * bd.h).fill(-1);
  const rooms: { goals: number[]; boxes: number[] }[] = [];
  for (let s = 0; s < bd.w * bd.h; s++) {
    if (bd.wall[s] || cut[s] || comp[s] >= 0) continue;
    const squares = [s];
    comp[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      const p = squares[i];
      for (const dir of DIRS) {
        const q = p + dir.dy * bd.w + dir.dx;
        if (!bd.wall[q] && !cut[q] && comp[q] < 0) {
          comp[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ goals: [], boxes: [] });
  }
  for (const b of bd.boxes) rooms[comp[b]].boxes.push(b);
  for (const g of bd.goals) rooms[comp[g]].goals.push(g);
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The level solved room by room, or over the whole level when it is no set of rooms. */
function solveLevel(text: string): string {
  const bd = parseLevel(text);
  const rooms = splitRooms(bd);
  if (rooms !== null) {
    let player = bd.player;
    let moves = '';
    let ok = true;
    const done: boolean[] = rooms.map(() => false);
    for (let ri = 0; ri < rooms.length; ri++) {
      // The other rooms' boxes stand as walls: on their goals once solved,
      // where they started otherwise. The player walks on from where the last
      // room left it.
      const wall2 = bd.wall.slice();
      for (let oj = 0; oj < rooms.length; oj++) {
        if (oj === ri) continue;
        for (const b of done[oj] ? rooms[oj].goals : rooms[oj].boxes) wall2[b] = 1;
      }
      const sub: Board = {
        w: bd.w,
        h: bd.h,
        wall: wall2,
        goals: rooms[ri].goals.slice().sort((a, b) => a - b),
        boxes: rooms[ri].boxes.slice().sort((a, b) => a - b),
        player,
      };
      const res = pushSearch(sub, ROOM_STATE_CAP);
      if (res === null) {
        ok = false;
        break;
      }
      moves += res.moves;
      player = endPos(bd.w, player, res.moves);
      done[ri] = true;
    }
    if (ok) return moves;
  }
  const whole = pushSearch(bd, WHOLE_STATE_CAP);
  return whole === null ? '' : whole.moves;
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  try {
    mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
    writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
  } catch {
    // A level that cannot be written stays unanswered rather than failing the run.
  }
}
