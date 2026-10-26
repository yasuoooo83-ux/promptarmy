// 基本命令：AIを使わずに選べる、兵種に合った単純な動き。
// AIの追加命令（条件つきの条）の後ろに、基本命令の条を自動で足して1つの軍令にする。
// 追加命令のどの条にも当てはまらないとき（目標がいなくて飛ばされたときも）、基本命令が働く。
import { isRanged, STATS } from './units.js';

export const BASIC = {
  attack: { ja: '攻める', desc: '近くの敵へ向かって戦う（弓・鉄砲は射程に入ったら止まって撃つ）' },
  hold: { ja: '持ち場を守る', desc: '動かずに構え、近づいた敵と戦う（弓・鉄砲は射程に入った敵を撃つ）' },
  guard: { ja: '大将を守る', desc: '大将のそばにつき、大将に近づく敵を討つ' },
  base: { ja: '本陣を狙う', desc: '敵の本陣へ向かう（3秒居座れば勝ち）' },
};

export const BASIC_KEYS = Object.keys(BASIC);

// その兵種が選べる基本命令（大将は自分を守れない）
export function basicChoices(genus) {
  return genus === 'dux' ? ['hold', 'attack', 'base'] : BASIC_KEYS;
}

// 兵種ごとの初期値
export function defaultBasic(genus) {
  return genus === 'dux' ? 'hold' : 'attack';
}

const R = (si, fac) => ({ si, fac });

// 基本命令の条（「いつも」で終わる）
export function basicRules(genus, key) {
  const ranged = isRanged(genus);
  switch (key) {
    case 'attack':
      return ranged
        ? [R({ res: 'hostis_prope', spatium: STATS[genus].range }, { actio: 'ferire', scopus: 'proximus' }), R({ res: 'semper' }, { actio: 'progredi', scopus: 'proximus' })]
        : [R({ res: 'semper' }, { actio: 'progredi', scopus: 'proximus' })];
    case 'guard':
      return [R({ res: 'semper' }, { actio: 'tueri', socius: 'dux' })];
    case 'base':
      return [R({ res: 'semper' }, { actio: 'ire', locus: 'castra_hostium' })];
    case 'hold':
    default:
      // 近接の兵は身を固めて待つ（受けるダメージ80%。接触した敵とは戦う）。射撃兵はその場で撃つ
      return ranged ? [R({ res: 'semper' }, { actio: 'ferire', scopus: 'proximus' })] : [R({ res: 'semper' }, { actio: 'exspectare' })];
  }
}

// 追加命令（AIの軍令。無ければ null）と基本命令を1つの軍令にする。baseFrom = 基本命令が始まる条の番号（0始まり）
export function combineOrder(genus, key, extra) {
  const ex = extra && Array.isArray(extra.iussa) ? extra.iussa : [];
  return { iussa: [...ex, ...basicRules(genus, key || defaultBasic(genus))], baseFrom: ex.length, nota: (extra && extra.nota) || '' };
}
