// 戦況レポート：自軍の作戦と結果、画面で見えた敵の様子、ゲームのルール要約を1つの文章にする。
// プレイヤーはこれをコピーして自分のAIに「なぜ負けた？次はどうする？」と相談する。
// 相手の命令（基本命令・追加命令・全体指揮）は一切書かない。
import { STATS, MATCHUP, TUNING, MAX_TURNS, TROOP_GENERA } from '../engine/units.js';
import { SD_TURNS } from '../engine/sim.js';
import { BASIC } from '../engine/basic.js';
import { ITEMS, itemCells } from '../engine/items.js';
import { W } from '../engine/map.js';
import { ruleJa } from '../engine/vocab.js';
import { forecast } from '../engine/weather.js';
import { formatEvent, clockLabel } from './log.js';
import { SIDE_JA, CIRCLED } from './names.js';

const REASON = { dux: '大将を討ち取った', base: '敵の本陣を占拠した', time: '時間切れ（残存兵数の割合）' };
const KEY_EVENTS = new Set(['charge', 'ambush', 'fence', 'yarisashi', 'rout', 'recover', 'destroyed', 'split', 'pending', 'suddenDeath', 'rain', 'result']);

const cellOf = (x, y) => `(${Math.floor(x / 100)},${Math.floor(y / 100)})`;

function itemLine(side, it) {
  if (!it) return 'なし';
  if (ITEMS[it.type].place === 'none') return ITEMS[it.type].ja;
  const cs = itemCells(side, it).map((i) => `(${i % W},${Math.floor(i / W)})`);
  return `${ITEMS[it.type].ja}（${cs.join('・')}）`;
}

// ルール要約（AIに渡す前提知識）
export function rulesSummary() {
  const units = [...TROOP_GENERA, 'dux'].map((g) => {
    const s = STATS[g];
    const good = Object.entries(MATCHUP[g] || {}).map(([d, p]) => `${STATS[d].ja}に${p / 100}倍`).join('・') || '—';
    const move = s.move === 1 ? TUNING.footSpeedPct / 100 : s.move;
    return `- ${s.ja}：兵${s.troops} 攻${s.atk} 防${s.def} 1秒に${move}マス 射程${s.range > 1 ? s.range + 'マス' : '接触'} 費用${g === 'dux' ? '—' : s.cost}／得意：${good}`;
  });
  return [
    '## ルール要約',
    `- 戦場は横16×縦10マス。x=0が西端、x=15が東端、y=0が北。西軍の本陣は(0,4)(0,5)、東軍は(15,4)(15,5)。中央（x=7,8）に南北に川、橋はy=2とy=7。`,
    `- 合戦は${MAX_TURNS}秒（1秒ごとに全部隊が同時に動く）。大将を討つか、敵本陣に3秒居座れば勝ち（本陣の近くに守り手が残っている間は数えない）。決まらなければ決戦：両軍が布陣の位置に戻り、失った兵の半分が戻り、全軍が「全体指揮」1つに従って最大${SD_TURNS}秒戦う。それでも決まらなければ残存兵数の割合。`,
    '- 命令：部隊ごとに基本命令（攻める／持ち場を守る／大将を守る／本陣を狙う）を選ぶ。追加命令（AIが訳す）は「〜秒まで」「〜秒たったら」「敵が距離n以内（兵種も指定可）」「自分の兵が〜%未満」「味方の〜が〜%未満」「大将が危ない」「雨」「〜にいる」の条件つきで最大4条。上から調べ、当てはまらなければ基本命令。行動は前進・突撃・その場で攻撃・待機・移動（地形や味方へ）・後退・護衛・回り込み。「兵の◯%だけ」の割合も書ける（残りは守備隊）。',
    '- 兵種：',
    ...units,
    '- 騎馬は2マス以上走って斬り込むと1.5倍（森・橋・川を通ると無効）。動かない槍は騎馬の突撃を止め1.5倍で反撃。同じ敵に2部隊以上で接触すると1.3倍。',
    `- 弓・鉄砲は動きながら撃つと${TUNING.moveShotPct}%。鉄砲は撃った次の1秒は撃てず、雨では撃てない。弓は雨で70%。待機中の弓・鉄砲は撃たない。`,
    `- 地形：森＝動かずにいると敵から見えない伏兵（2マス以内に近づかれると見つかる）、森を出た初撃は近接${TUNING.ambushPct / 100}倍。丘＝動かず構えると近接${TUNING.hillHoldPct}%・射撃${TUNING.hillShotPct}%に軽減、射程+1。川＝遅い（40%）、川の中の敵には射撃${TUNING.riverShotPct / 100}倍。橋の上の敵には射撃${TUNING.bridgeShotPct / 100}倍。`,
    `- 道具（各軍1つ）：${Object.values(ITEMS).map((i) => `${i.ja}＝${i.desc}`).join(' ')}`,
    '- 士気が20以下で潰走（後退し続ける）、40以上で立て直す。大将の2マス以内は士気が下がりにくい。',
  ].join('\n');
}

// side から見た戦況レポート
export function buildReport(state, rec, side) {
  const en = side === 'W' ? 'E' : 'W';
  const res = rec.result;
  const last = rec.turns[rec.turns.length - 1];
  const first = rec.turns[0];
  const byId = {};
  rec.units.forEach((u) => { byId[u.id] = u; });
  const idx = (id) => rec.units.findIndex((u) => u.id === id);
  const outcome = res.winner === 'draw' ? '引き分け' : res.winner === side ? `${SIDE_JA[side]}（自軍）の勝利` : `${SIDE_JA[en]}（敵軍）の勝利`;

  const lines = [
    `# PROMPT ARMY 戦況レポート（${SIDE_JA[side]}）`,
    '',
    `あなたは戦国合戦ゲーム「PROMPT ARMY」の軍師です。私は${SIDE_JA[side]}を指揮しました。下の戦況レポートと最後の「ルール要約」を読んで、`,
    '(1) なぜこの結果になったのか、(2) 次の合戦で何を変えるとよいか（基本命令・追加命令・布陣・道具）を、具体的に教えてください。',
    '追加命令は、私がそのまま使える日本語の命令文の例で示してください。ルール要約にない動きは提案しないでください。',
    '',
    '## 結果',
    `- ${outcome}：${res.winner === 'draw' ? '' : REASON[res.reason] + '、'}${clockLabel(res.turn)}`,
    `- 残存兵力：${SIDE_JA[side]} ${res.ratio[side]}%／${SIDE_JA[en]} ${res.ratio[en]}%`,
    `- 天気：${forecast(rec.seed).map((f) => `${f.from - 1}〜${f.to}秒${f.weather === 'pluvia' ? '雨' : '晴'}`).join('、')}`,
    '',
    `## 自軍（${SIDE_JA[side]}）の作戦と結果`,
    `- 道具：${itemLine(side, rec.items && rec.items[side])}`,
  ];
  const twinOf = {};
  rec.units.forEach((u) => { if (u.twin) twinOf[u.parent] = u; });
  for (const u of rec.units.filter((x) => x.side === side && !x.twin)) {
    const i = idx(u.id);
    const s0 = first.units[i];
    const sealed = state.plan.sealed[u.id];
    const said = state.plan.prompts[u.id];
    const tw = twinOf[u.id];
    const dealt = u.dealt + (tw ? tw.dealt : 0);
    const taken = u.taken + (tw ? tw.taken : 0);
    const fate = u.deadTurn ? `${clockLabel(u.deadTurn)}に${u.genus === 'dux' ? '討死' : '壊滅'}` : `生存（残り兵${last.units[i].troops}）`;
    lines.push(`### ${u.genus === 'dux' ? '大将' : `第${u.slot}隊 ${STATS[u.genus].ja}`}`);
    lines.push(`- 布陣：${cellOf(s0.x, s0.y)}　基本命令：${BASIC[u.basic] ? BASIC[u.basic].ja : '—'}`);
    if (sealed) {
      lines.push(`- 追加命令（私の言葉）：「${said || ''}」`);
      sealed.order.iussa.forEach((r, k) => {
        lines.push(`  - ${CIRCLED[k + 1]} AIの訳：${ruleJa(r)} → 働いた秒数 ${u.ruleCount[k]}`);
      });
    } else {
      lines.push('- 追加命令：なし');
    }
    const baseSec = u.ruleCount.slice(u.baseFrom || 0).reduce((a, b) => a + b, 0);
    lines.push(`- 基本命令で動いた秒数：${baseSec}${u.defaultCount ? `、何もせず待機：${u.defaultCount}` : ''}`);
    lines.push(`- 結果：${fate}　与えた被害 ${dealt}／受けた被害 ${taken}${tw ? '（守備隊を含む）' : ''}`);
  }
  if (rec.sd && state.plan.commands && state.plan.commands[side]) {
    const c = state.plan.commands[side];
    lines.push('### 決戦の全体指揮');
    lines.push(`- 私の言葉：「${(state.plan.cmdPrompts && state.plan.cmdPrompts[side]) || ''}」`);
    c.order.iussa.forEach((r, k) => lines.push(`  - ${CIRCLED[k + 1]} AIの訳：${ruleJa(r)} → 働いた回数（部隊×秒）${rec.sd[side].ruleCount[k]}`));
  }

  lines.push('', `## 敵軍（${SIDE_JA[en]}）について画面で見えたこと（敵の命令は分からない）`);
  lines.push(`- 道具：${itemLine(en, rec.items && rec.items[en])}`);
  for (const u of rec.units.filter((x) => x.side === en && !x.twin)) {
    const i = idx(u.id);
    const s0 = first.units[i];
    const tw = twinOf[u.id];
    const fate = u.deadTurn ? `${clockLabel(u.deadTurn)}に${u.genus === 'dux' ? '討死' : '壊滅'}` : '生存';
    lines.push(`- ${u.genus === 'dux' ? '大将' : STATS[u.genus].ja}：開戦時の位置 ${cellOf(s0.x, s0.y)}、${fate}、与えた被害 ${u.dealt + (tw ? tw.dealt : 0)}`);
  }

  lines.push('', '## 主な出来事');
  for (let k = 1; k < rec.turns.length; k++) {
    for (const ev of rec.turns[k].events) {
      if (!KEY_EVENTS.has(ev.type)) continue;
      const t = formatEvent(ev, k, byId);
      if (t) lines.push(`- ${t.trim()}`);
    }
  }
  lines.push('', rulesSummary(), '');
  return lines.join('\n');
}
