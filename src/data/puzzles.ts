/**
 * Shared standard Xiangqi position.
 *
 * The built-in endgame/opening puzzle library that used to live here has been
 * removed. The practice screen now hosts only the 《适情雅趣》 collection
 * (see data/shiqingyaqu.ts). `INITIAL_SETUP` remains as the canonical starting
 * position consumed by the game store and the test suite.
 */

const EMPTY_ROW = '.,.,.,.,.,.,.,.,.';

/** Standard initial Xiangqi position (Board notation string). */
export const INITIAL_SETUP = [
  'R,N,B,A,K,A,B,N,R', // row0
  EMPTY_ROW, // row1
  '.,C,.,.,.,.,.,C,.', // row2 cannons
  'P,.,P,.,P,.,P,.,P', // row3 pawns
  EMPTY_ROW, // row4
  EMPTY_ROW, // row5
  'p,.,p,.,p,.,p,.,p', // row6 black pawns
  '.,c,.,.,.,.,.,c,.', // row7 black cannons
  EMPTY_ROW, // row8
  'r,n,b,a,k,a,b,n,r', // row9
].join('/');
