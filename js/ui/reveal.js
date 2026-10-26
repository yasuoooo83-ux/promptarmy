// 戦果：勝敗と、軍ごとの「戦況レポート」。相手の作戦（命令）は見せない。
// レポートは自軍の人だけが開き、コピーして自分のAIに相談する。
import { h, copyText } from './dom.js';
import { SIDE_JA } from './names.js';
import { clockLabel } from './log.js';
import { buildReport } from './report.js';

const REASON_JA = {
  dux: '大将を討ち取った',
  base: '敵の本陣を3秒占拠した',
  time: '時間切れ。残存兵数の割合で決着',
};

export function renderReveal(root, { state, go }) {
  const rec = state.battle.record;
  const res = rec.result;
  const lastFrame = rec.turns[rec.turns.length - 1];
  const headline = res.winner === 'draw' ? '引き分け' : `${SIDE_JA[res.winner]}の勝利`;
  const remain = { W: 0, E: 0 };
  rec.units.forEach((u, i) => { if (lastFrame.units[i].alive) remain[u.side] += lastFrame.units[i].troops; });

  const reportPanel = (side) => {
    const text = buildReport(state, rec, side);
    const status = h('span', { class: 'note' });
    return h(
      'details',
      { class: `report side-${side}` },
      h('summary', {}, h('b', {}, `${SIDE_JA[side]}の戦況レポート`), `（${SIDE_JA[side]}の人だけ開いてください）`),
      h(
        'div',
        { class: 'row-buttons' },
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const ok = await copyText(text);
              status.textContent = ok ? 'コピーしました。いつも使っているAIに貼って、相談してみよう。' : 'コピーできませんでした。下の文章を選んでコピーしてください。';
            },
          },
          'AIに相談するためにコピー',
        ),
        status,
      ),
      h('pre', { class: 'report-text' }, text),
    );
  };

  root.append(
    h(
      'section',
      { class: 'screen reveal' },
      h('h1', {}, '戦果'),
      h(
        'div',
        { class: `result-banner ${res.winner}` },
        h('div', { class: 'big' }, headline),
        h('div', {}, `${REASON_JA[res.reason]}（${clockLabel(res.turn)}）`),
        h('div', { class: 'note' }, `残存兵力　西軍 ${res.ratio.W}%（${remain.W}）／東軍 ${res.ratio.E}%（${remain.E}）`),
      ),
      h(
        'p',
        { class: 'note' },
        '相手の作戦は明かしません。自軍の戦況レポートを開き、「AIに相談するためにコピー」を押して、いつも使っているAIに「なぜこうなった？次はどうする？」と聞いてみよう。レポートには自軍の命令・各命令が働いた秒数・画面で見えた敵の様子・ゲームのルール要約が入っています。',
      ),
      h('div', { class: 'reports' }, reportPanel('W'), reportPanel('E')),
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => go('battle') }, 'もう一度見る'),
        h('button', { class: 'btn primary', onclick: () => go('replan') }, '作戦を直して再戦（同じ天候・同じ条件で比べる）'),
        h('button', { class: 'btn', onclick: () => go('replanNew') }, '作戦を直して再戦（新しい天候）'),
        h('button', { class: 'btn', onclick: () => go('lobby') }, '陣立てからやり直す'),
      ),
    ),
  );
}
