import { STATS } from '../engine/units.js';

export const SIDE_JA = { W: '西軍', E: '東軍' };

// 部隊名は「軍・兵種（担当者名）」。大将は「西軍大将」。
export function unitName(u) {
  const side = SIDE_JA[u.side];
  const who = u.owner ? `（${u.owner}）` : '';
  if (u.genus === 'dux') return `${side}大将${who}`;
  return `${side}・${STATS[u.genus].ja}${u.twin ? 'の守備隊' : ''}${who}`;
}

export const CIRCLED = ['', '①', '②', '③', '④', '⑤'];

export function slotLabel(id) {
  return `${SIDE_JA[id[0]]} ${id[1] === '0' ? '大将' : '第' + id[1] + '隊'}`;
}
