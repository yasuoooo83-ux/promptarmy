// 戦後の短い振り返り（画面内で読む）と、対戦を終えるときの作戦公開。
// 記録から確かめられる事実だけを書く。「発動0秒」を失敗とは決めつけず、条件が成り立った秒数を並べて見せる。
import { h } from './dom.js';
import { STATS } from '../engine/units.js';
import { BASIC } from '../engine/basic.js';
import { ITEMS } from '../engine/items.js';
import { ruleJa } from '../engine/vocab.js';
import { SIDE_JA, CIRCLED } from './names.js';
import { clockLabel } from './log.js';

const REASON_JA = { dux: '大将を討ち取った', base: '本陣を占拠した', time: '時間切れ（残存兵数の割合）' };

export function outcomeLine(rec, side) {
  const res = rec.result;
  const en = side === 'W' ? 'E' : 'W';
  if (res.winner === 'draw') return `引き分け（${clockLabel(res.turn)}）`;
  const who = res.winner === side ? '勝ち' : '負け';
  const by = res.winner === side ? `${SIDE_JA[side]}が` : `${SIDE_JA[en]}が`;
  return `${who}：${by}${REASON_JA[res.reason]}（${clockLabel(res.turn)}）`;
}

// 1つの条について、記録から言えること
function ruleFact(ran, cond) {
  if (ran > 0) return { text: `働いた ${ran}秒`, cls: 'ran' };
  if (cond === 0) return { text: '0秒：条件が一度も成り立たなかった', cls: 'idle' };
  return { text: `0秒：条件は${cond}秒成り立ったが、上の条が先に働いた（または狙う相手がいなかった）`, cls: 'idle' };
}

function unitTitle(u) {
  return u.genus === 'dux' ? '大将' : `第${u.slot}隊 ${STATS[u.genus].ja}`;
}

function itemText(rec, side) {
  const it = rec.items && rec.items[side];
  return it ? ITEMS[it.type].ja : 'なし';
}

// side の作戦と結果（自軍の振り返り／作戦公開で使う）
export function sideSummary(state, rec, side, { showOutcome = true, title = '' } = {}) {
  const last = rec.turns[rec.turns.length - 1];
  const idx = (id) => rec.units.findIndex((u) => u.id === id);
  const twinOf = {};
  rec.units.forEach((u) => { if (u.twin) twinOf[u.parent] = u; });

  const rows = rec.units
    .filter((u) => u.side === side && !u.twin)
    .map((u) => {
      const i = idx(u.id);
      const tw = twinOf[u.id];
      const now = last.units[i].troops + (tw ? last.units[idx(tw.id)].troops : 0);
      const dealt = u.dealt + (tw ? tw.dealt : 0);
      const taken = u.taken + (tw ? tw.taken : 0);
      const ti = tw ? idx(tw.id) : -1;
      const split = ti >= 0 && rec.turns.some((t) => t.units[ti].on);
      const word = u.genus === 'dux' ? '討死' : '壊滅';
      const part = (unit, j) =>
        unit.deadTurn || !last.units[j].alive ? `${clockLabel(unit.deadTurn)}に${word}` : `生存 兵${last.units[j].troops}`;
      let fate;
      if (!split) {
        fate = u.deadTurn
          ? h('span', { class: 'fate dead' }, `${clockLabel(u.deadTurn)}に${word}`)
          : h('span', { class: 'fate alive' }, `生存 兵${now}/${u.maxTroops}`);
      } else {
        // 割合の命令で二つに分かれた：動いた隊と、残った守備隊を別々に書く
        const allDead = (u.deadTurn || !last.units[i].alive) && (tw.deadTurn || !last.units[ti].alive);
        fate = h('span', { class: `fate ${allDead ? 'dead' : 'alive'}` }, `動いた隊：${part(u, i)}／守備隊：${part(tw, ti)}`);
      }
      const sealed = state.plan.sealed && state.plan.sealed[u.id];
      const said = state.plan.prompts && state.plan.prompts[u.id];
      const baseFrom = u.baseFrom || 0;
      const baseSec = u.ruleCount.slice(baseFrom).reduce((a, b) => a + b, 0);
      const cond = u.condCount || [];
      // 潰走していた秒（本戦30秒のうち。命令は働かない）
      let routed = 0;
      for (let t = 1; t <= Math.min(30, rec.turns.length - 1); t++) if (rec.turns[t].units[i].alive && rec.turns[t].units[i].routed) routed++;
      return h(
        'div',
        { class: 'sum-unit' },
        h('div', { class: 'sum-head' }, h('b', {}, unitTitle(u)), fate),
        h('div', { class: 'sum-nums' }, `与えた被害 ${dealt}　受けた被害 ${taken}${tw ? '（守備隊を含む）' : ''}`),
        h(
          'div',
          { class: 'sum-basic' },
          `基本命令：${BASIC[u.basic] ? BASIC[u.basic].ja : '—'}`,
          h('span', { class: 'sec' }, `${baseSec}秒`),
          u.defaultCount ? h('span', { class: 'sec idle' }, `何もせず待機 ${u.defaultCount}秒`) : null,
          routed ? h('span', { class: 'sec bad' }, `潰走 ${routed}秒`) : null,
        ),
        sealed
          ? h(
              'div',
              { class: 'sum-extra' },
              h('div', { class: 'said' }, `追加命令「${said || '（原文なし）'}」`),
              h(
                'ol',
                {},
                sealed.order.iussa.map((r, k) => {
                  const f = ruleFact(u.ruleCount[k] || 0, cond[k] || 0);
                  return h('li', {}, h('span', { class: 'rule' }, `${CIRCLED[k + 1]} ${ruleJa(r)}`), h('span', { class: `sec ${f.cls}` }, f.text));
                }),
              ),
            )
          : h('div', { class: 'sum-extra none' }, '追加命令なし'),
      );
    });

  const cmd = rec.sd && state.plan.commands && state.plan.commands[side];
  const cmdView = cmd
    ? h(
        'div',
        { class: 'sum-unit sum-cmd' },
        h('div', { class: 'sum-head' }, h('b', {}, '決戦の全体指揮')),
        h('div', { class: 'said' }, `「${(state.plan.cmdPrompts && state.plan.cmdPrompts[side]) || '（原文なし）'}」`),
        h(
          'ol',
          {},
          cmd.order.iussa.map((r, k) =>
            h('li', {}, h('span', { class: 'rule' }, `${CIRCLED[k + 1]} ${ruleJa(r)}`), h('span', { class: 'sec' }, `のべ ${rec.sd[side].ruleCount[k]}秒（部隊×秒）`)),
          ),
        ),
      )
    : null;

  return h(
    'div',
    { class: `summary side-${side}` },
    title ? h('div', { class: 'sum-outcome' }, title) : null,
    showOutcome ? h('div', { class: 'sum-outcome' }, outcomeLine(rec, side)) : null,
    h('div', { class: 'sum-meta' }, `道具：${itemText(rec, side)}　残存兵力 ${rec.result.ratio[side]}%`),
    ...rows,
    cmdView,
    h('p', { class: 'note small' }, '秒数は本戦30秒のうち、その命令で動いた秒数。0秒は「失敗」とは限らない（条件が来なかっただけのこともある）。'),
  );
}
