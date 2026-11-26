import { describe, it, expect } from 'vitest';
import { fastStateFromSquares } from '../evalTerms';
import { endgameKnowledgeFor } from '../evalTerms';

function flat(setupRows: string[]): Int8Array {
  const code: Record<string, number> = {
    K: 1, A: 2, B: 3, N: 4, R: 5, C: 6, P: 7,
    k: -1, a: -2, b: -3, n: -4, r: -5, c: -6, p: -7,
  };
  const sq = new Int8Array(90);
  for (let row = 0; row < 10; row++) {
    const cells = setupRows[row].split(',');
    for (let col = 0; col < 9; col++) {
      const ch = cells[col];
      if (ch && ch !== '.') sq[col * 10 + row] = code[ch];
    }
  }
  return sq;
}

const empty = '.,.,.,.,.,.,.,.,.';

describe('残局定式知识', () => {
  it('单车难破士象全：抵消车的大部分子力优势', () => {
    const rows = Array(10).fill(empty);
    rows[0] = '.,.,a,K,a,.,.,.,.';
    rows[2] = '.,.,b,.,b,.,.,.,.';
    rows[9] = '.,.,.,k,.,.,.,.,.';
    rows[7] = '.,.,.,.,R,.,.,.,.';
    const st = fastStateFromSquares(flat(rows), 1);
    expect(endgameKnowledgeFor(st, 1)).toBe(-700);
  });

  it('马炮对单士：给出残局胜势提示', () => {
    const rows = Array(10).fill(empty);
    rows[0] = '.,.,.,a,K,.,.,.,.';
    rows[9] = '.,.,.,.,k,.,.,.,.';
    rows[7] = '.,.,.,.,N,.,.,.,.';
    rows[6] = '.,.,.,.,C,.,.,.,.';
    const st = fastStateFromSquares(flat(rows), 1);
    expect(endgameKnowledgeFor(st, 1)).toBe(180);
  });

  it('中局不增加定式开销', () => {
    const rows = Array(10).fill(empty);
    rows[0] = 'R,N,A,K,A,.,.,.,.';
    rows[9] = 'r,n,a,k,a,.,.,.,.';
    const st = fastStateFromSquares(flat(rows), 1);
    expect(endgameKnowledgeFor(st, 1)).toBe(0);
  });
});
