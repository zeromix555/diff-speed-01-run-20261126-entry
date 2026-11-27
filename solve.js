// Fast exact drop-in for makefun-diff 1.0.0 (MIT).
//
// Returns exactly what makefun-diff 1.0.0's diffPatch returns for every input:
// the same line splitting, the same common prefix/suffix trim, the same Myers
// greedy search (deletion preferred on ties, no edge-diagonal pruning, every
// equal run followed as far as it goes), and the same patch format.
//
// Speed comes from data layout, not from a different algorithm:
//  - lines are interned to small integers once, so every comparison in the
//    search is an integer compare on Int32Arrays;
//  - the search keeps one Int32Array of furthest-x per diagonal per d (the
//    reference allocates a linked-list path object per (d, k) step), and its
//    hot loop handles the edge diagonals separately so it carries no
//    range checks for them;
//  - the edit script is recovered by backtracking over those snapshots,
//    recomputing each step's choice with the reference's exact rule, so the
//    script is the same one the reference's stored histories would give;
//  - the patch is built with the reference's own grouping code, unchanged.

const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** The patch's first word. */
export const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
export const CONTEXT = 3;

const NEG = -1000000000;

/**
 * A text's lines, each with its "\n" (the last one without, when the text does
 * not end in one), plus each line's interned id (equal strings share an id).
 */
function tokenize(text, intern) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] !== '' ? 1 : 0);
  const lines = new Array(count);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    const line = parts[i] + '\n';
    lines[i] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[i] = id;
  }
  if (parts[last] !== '') {
    const line = parts[last];
    lines[last] = line;
    let id = intern.get(line);
    if (id === undefined) {
      id = intern.size;
      intern.set(line, id);
    }
    ids[last] = id;
  }
  return { lines, ids };
}

/**
 * The runs of the edit script of the middle of the old lines into the middle
 * of the new lines: [{ kind, count }], in order. ai/bi are the interned line
 * ids; the middle is ai[oa .. oa+n2) into bi[ob .. ob+m2).
 *
 * The search is the reference's: for d = 0, 1, 2, ... edits and each diagonal
 * k = x - y from -d to d in steps of 2, the furthest point a path of d edits
 * reaches on k is either one old line past the furthest (d-1)-point on
 * diagonal k - 1 (a deletion) or one new line past the furthest (d-1)-point on
 * diagonal k + 1 (an insertion), whichever lies further into the old text,
 * and the deletion when both reach the same point; a move past the end of
 * either text is no candidate; no diagonal is pruned; from that point the
 * path keeps every line equal in both texts as far as it can. The first path
 * to reach the ends of both texts is the edit script.
 *
 * The diagonals are visited in the reference's order (k from -d to d), with
 * the four edge diagonals handled outside the hot loop: k = -d and k = 1 - d
 * have an insertion candidate only, k = d - 1 and k = d a deletion only.
 */
function editRuns(ai, bi, oa, n2, ob, m2) {
  if (n2 === 0 && m2 === 0) return [];
  const Vs = [];
  // d = 0: the snake from the first lines, on diagonal 0.
  let x = 0;
  let y = 0;
  while (x < n2 && y < m2 && ai[oa + x] === bi[ob + y]) {
    x++;
    y++;
  }
  const v0 = new Int32Array(1);
  v0[0] = x;
  Vs.push(v0);
  let D = -1;
  let kF = 0;
  if (x === n2 && y === m2) {
    D = 0;
  } else {
    for (let d = 1; d <= n2 + m2; d++) {
      const prev = Vs[d - 1];
      const cur = new Int32Array(2 * d + 1);
      let done = false;
      // k = -d: insertion only, from diagonal -d+1 (prev index 0).
      {
        const pv = prev[0];
        if (pv !== NEG && pv + d - 1 < m2) {
          let nx = pv;
          let ny = pv + d;
          while (nx < n2 && ny < m2 && ai[oa + nx] === bi[ob + ny]) {
            nx++;
            ny++;
          }
          cur[0] = nx;
          if (nx === n2 && ny === m2) {
            D = d;
            kF = -d;
            done = true;
          }
        } else {
          cur[0] = NEG;
        }
      }
      // k = 1-d: insertion only, from diagonal 2-d (prev index 1).
      if (!done) {
        const pv = prev[1];
        if (pv !== NEG && pv !== undefined && pv + d - 2 < m2) {
          let nx = pv;
          let ny = pv + d - 1;
          while (nx < n2 && ny < m2 && ai[oa + nx] === bi[ob + ny]) {
            nx++;
            ny++;
          }
          cur[1] = nx;
          if (nx === n2 && ny === m2) {
            D = d;
            kF = 1 - d;
            done = true;
          }
        } else {
          cur[1] = NEG;
        }
      }
      // k = 2-d .. d-2: both candidates.
      for (let ki = 2; ki <= 2 * d - 2 && !done; ki++) {
        const k = ki - d;
        const pvD = prev[ki - 2];
        const pvI = prev[ki];
        let delX = NEG;
        let insX = NEG;
        if (pvD !== NEG && pvD < n2) delX = pvD + 1;
        if (pvI !== NEG && pvI - (k + 1) < m2) insX = pvI;
        if (delX === NEG && insX === NEG) {
          cur[ki] = NEG;
          continue;
        }
        let nx;
        let ny;
        if (delX >= insX) {
          nx = delX;
          ny = delX - k;
        } else {
          nx = insX;
          ny = insX - k;
        }
        while (nx < n2 && ny < m2 && ai[oa + nx] === bi[ob + ny]) {
          nx++;
          ny++;
        }
        cur[ki] = nx;
        if (nx === n2 && ny === m2) {
          D = d;
          kF = k;
          done = true;
        }
      }
      // k = d-1: deletion only, from diagonal d-2 (prev index 2d-3).
      if (!done && d >= 2) {
        const ki = 2 * d - 1;
        const pv = prev[ki - 2];
        if (pv !== NEG && pv < n2) {
          let nx = pv + 1;
          let ny = pv + 1 - (d - 1);
          while (nx < n2 && ny < m2 && ai[oa + nx] === bi[ob + ny]) {
            nx++;
            ny++;
          }
          cur[ki] = nx;
          if (nx === n2 && ny === m2) {
            D = d;
            kF = d - 1;
            done = true;
          }
        } else {
          cur[ki] = NEG;
        }
      } else if (!done && d === 1) {
        cur[1] = NEG;
      }
      // k = d: deletion only, from diagonal d-1 (prev index 2d-2).
      if (!done) {
        const ki = 2 * d;
        const pv = prev[ki - 2];
        if (pv !== NEG && pv < n2) {
          let nx = pv + 1;
          let ny = pv + 1 - d;
          while (nx < n2 && ny < m2 && ai[oa + nx] === bi[ob + ny]) {
            nx++;
            ny++;
          }
          cur[ki] = nx;
          if (nx === n2 && ny === m2) {
            D = d;
            kF = d;
            done = true;
          }
        } else {
          cur[ki] = NEG;
        }
      }
      Vs.push(cur);
      if (done) break;
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // Backtrack from the ends at d = D, recomputing each step's choice from
  // the snapshots with the same rule, so the script is the reference's.
  const ops = [];
  x = n2;
  y = m2;
  for (let d = D; d >= 1; d--) {
    const k = x - y;
    const prev = Vs[d - 1];
    const plen = prev.length;
    let delX = NEG;
    let insX = NEG;
    const iDel = k + d - 2;
    if (iDel >= 0 && iDel < plen) {
      const pv = prev[iDel];
      if (pv !== NEG && pv < n2) delX = pv + 1;
    }
    const iIns = k + d;
    if (iIns >= 0 && iIns < plen) {
      const pv = prev[iIns];
      if (pv !== NEG && pv - (k + 1) < m2) insX = pv;
    }
    let postX;
    let postY;
    let isDel;
    if (delX >= insX) {
      postX = delX;
      postY = delX - k;
      isDel = true;
    } else {
      postX = insX;
      postY = insX - k;
      isDel = false;
    }
    const snake = x - postX;
    for (let i = 0; i < snake; i++) ops.push(KEEP);
    if (isDel) {
      ops.push(DELETE);
      x = postX - 1;
      y = postY;
    } else {
      ops.push(INSERT);
      x = postX;
      y = postY - 1;
    }
  }
  // The d = 0 snake, from the first lines to where the backtrack stopped.
  for (let i = 0; i < x; i++) ops.push(KEEP);
  ops.reverse();
  const runs = [];
  for (let i = 0; i < ops.length; i++) {
    const kind = ops[i];
    const r = runs[runs.length - 1];
    if (r !== undefined && r.kind === kind) r.count++;
    else runs.push({ kind, count: 1 });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? `${op}${line}` : `${op}${line}\n%\n`;
}

/** make.fun's own patch of input.old into input.new. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const intern = new Map();
  const ta = tokenize(input.old, intern);
  const tb = tokenize(input.new, intern);
  const a = ta.lines;
  const b = tb.lines;
  const ai = ta.ids;
  const bi = tb.ids;
  const n = a.length;
  const m = b.length;
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ai[prefix] === bi[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ai[n - 1 - suffix] === bi[m - 1 - suffix]) suffix++;
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(ai, bi, prefix, n - prefix - suffix, prefix, m - prefix - suffix));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, a[at]));
  }
  return out.join('');
}
