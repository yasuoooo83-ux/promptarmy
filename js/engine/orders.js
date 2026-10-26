// 条件・行動の評価。ctx = { units: 生存部隊（ord昇順）, turn（合戦内の秒。決戦中は決戦開始からの秒）, rain }
// 位置は連続座標（1マス=100）。「距離n」は reach(n) と比べる。
import { dist, dist2, reach, terrainOfPos, baseAtPos, otherSide } from './map.js';
import { isRanged, TUNING } from './units.js';

export const DEFAULT_ORDER = {
  iussa: [{ si: { res: 'semper' }, fac: { actio: 'exspectare' } }],
};

// 守備隊（分けた残りの兵）が使う、固定の行動：その場を動かず、来た敵と戦う（射撃兵は撃つ）
export function holdDecision(u, ctx) {
  if (isRanged(u.genus)) {
    const t = nearest(u, enemiesOf(u, ctx));
    return { rule: 0, actio: 'ferire', target: t, moveTarget: null, locus: null, pars: 0 };
  }
  return { rule: 0, actio: 'exspectare', target: null, moveTarget: null, locus: null, pars: 0 };
}

// 見えている敵（森に伏せた敵は、近づかないと見えない）
function enemiesOf(u, ctx) {
  const r = reach(TUNING.revealCells);
  const tw = ctx.towers && ctx.towers[u.side]; // 自軍の物見櫓
  const rt = reach(TUNING.towerRevealCells);
  return ctx.units.filter(
    (e) => e.side !== u.side && e.troops > 0 &&
      (!e.hidden || dist2(u.x, u.y, e.x, e.y) <= r * r || (tw && dist2(tw[0], tw[1], e.x, e.y) <= rt * rt)),
  );
}

function nearest(u, list) {
  let best = null;
  let bd = Infinity;
  for (const e of list) {
    const d = dist2(u.x, u.y, e.x, e.y);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

// 目標（敵）を選ぶ。見つからなければ null
function findTarget(scopus, u, ctx) {
  const en = enemiesOf(u, ctx);
  if (en.length === 0) return null;
  const s = scopus || 'proximus';
  if (s === 'proximus') return nearest(u, en);
  if (s === 'infirmissimus') {
    let best = null;
    let bd = Infinity;
    for (const e of en) {
      const d = dist2(u.x, u.y, e.x, e.y);
      if (
        best === null ||
        e.troops * best.maxTroops < best.troops * e.maxTroops ||
        (e.troops * best.maxTroops === best.troops * e.maxTroops && d < bd)
      ) {
        best = e;
        bd = d;
      }
    }
    return best;
  }
  // dux または兵種名
  return nearest(u, en.filter((e) => e.genus === s));
}

function findAlly(genus, u, ctx) {
  return nearest(
    u,
    ctx.units.filter((a) => a.side === u.side && a !== u && a.troops > 0 && a.genus === genus),
  );
}

export function evalCond(si, u, ctx) {
  switch (si.res) {
    case 'semper':
      return true;
    case 'ante':
      return ctx.turn <= si.numerus;
    case 'post':
      // 「n秒たったら」＝ n秒目が終わってから（n+1秒目から）。「n秒まで」と重ならない
      return ctx.turn > si.numerus;
    case 'hostis_prope': {
      const r = reach(si.spatium);
      const r2 = r * r;
      return enemiesOf(u, ctx).some(
        (e) => dist2(u.x, u.y, e.x, e.y) <= r2 && (!si.genus || e.genus === si.genus),
      );
    }
    case 'copiae_infra':
      return u.troops * 100 < si.pars * u.maxTroops;
    case 'socius_infra':
      return ctx.units.some(
        (a) => a.side === u.side && a !== u && a.troops > 0 && a.genus === si.genus && a.troops * 100 < si.pars * a.maxTroops,
      );
    case 'dux_in_periculo': {
      const d = ctx.units.find((a) => a.side === u.side && a.genus === 'dux' && a.troops > 0);
      if (!d) return false;
      const r = reach(2);
      return enemiesOf(u, ctx).some((e) => dist2(d.x, d.y, e.x, e.y) <= r * r);
    }
    case 'pluvia':
      return !!ctx.rain;
    case 'in_loco': {
      if (si.locus === 'castra') return baseAtPos(u.side, u.x, u.y);
      if (si.locus === 'castra_hostium') return baseAtPos(otherSide(u.side), u.x, u.y);
      return terrainOfPos(u.x, u.y) === si.locus;
    }
    default:
      return false;
  }
}

// 行動を具体化する。目標が見つからなければ null（その条は飛ばされる）
// 戻り値: { actio, target, moveTarget, locus, pars }
//   target     = 近接攻撃で優先する敵
//   moveTarget = 近づく相手（敵または味方）
//   pars       = この割合（％）の兵だけがこの行動をとり、残りは守備に回る（0 = 全員）
export function resolveAction(fac, u, ctx) {
  const pars = fac.pars && fac.pars > 0 && fac.pars < 100 ? fac.pars : 0;
  switch (fac.actio) {
    case 'progredi':
    case 'impetus':
    case 'circumire': {
      const t = findTarget(fac.scopus || 'proximus', u, ctx);
      return t ? { actio: fac.actio, target: t, moveTarget: t, locus: null, pars } : null;
    }
    case 'ferire': {
      const t = findTarget(fac.scopus || 'proximus', u, ctx);
      return t ? { actio: 'ferire', target: t, moveTarget: null, locus: null, pars } : null;
    }
    case 'exspectare':
      return { actio: 'exspectare', target: null, moveTarget: null, locus: null, pars: 0 };
    case 'recedere':
      return { actio: 'recedere', target: null, moveTarget: null, locus: null, pars: 0 };
    case 'ire': {
      if (fac.locus) return { actio: 'ire', target: null, moveTarget: null, locus: fac.locus, pars };
      const a = findAlly(fac.socius, u, ctx);
      return a ? { actio: 'ire', target: null, moveTarget: a, locus: null, pars } : null;
    }
    case 'tueri': {
      const a = findAlly(fac.socius, u, ctx);
      if (!a) return null;
      const r = reach(1);
      const foes = enemiesOf(u, ctx).filter((e) => dist2(a.x, a.y, e.x, e.y) <= r * r);
      const foe = nearest(u, foes);
      return foe
        ? { actio: 'tueri', target: foe, moveTarget: foe, locus: null, pars }
        : { actio: 'tueri', target: null, moveTarget: a, locus: null, pars };
    }
    default:
      return null;
  }
}

// 軍令を上から評価し、最初に当てはまった条の行動を返す。
// どの条にも当てはまらなければ待機（rule = 0）。
export function decide(u, order, ctx) {
  const rules = order.iussa;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (!evalCond(r.si, u, ctx)) continue;
    const d = resolveAction(r.fac, u, ctx);
    if (!d) continue; // 目標が無い条は「条件が偽」とみなして次へ
    d.rule = k + 1;
    return d;
  }
  return { rule: 0, actio: 'exspectare', target: null, moveTarget: null, locus: null, pars: 0 };
}

export { dist };
