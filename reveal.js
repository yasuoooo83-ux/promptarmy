// 戦果：勝敗、軍ごとの短い振り返り（画面内で読める）、詳しい戦況レポート（AIに相談する人向け）。
// 相手の作戦は通常は見せない。対戦を終えるときに、両軍が同意したら作戦を公開できる。
import { h, copyText } from './dom.js';
import { SIDE_JA } from './names.js';
import { clockLabel } from './log.js';
import { buildReport } from './report.js';
import { sideSummary } from './summary.js';

const REASON_JA = {
  dux: '大将を討ち取った',
  base: '敵の本陣を3秒占拠した',
  time: '時間切れ。残存兵数の割合で決着',
};

export function renderReveal(root, { state, go, online, mySides = ['W', 'E'] }) {
  const rec = state.battle.record;
  const res = rec.result;
  const lastFrame = rec.turns[rec.turns.length - 1];
  const headline = res.winner === 'draw' ? '引き分け' : `${SIDE_JA[res.winner]}の勝利`;
  const remain = { W: 0, E: 0 };
  rec.units.forEach((u, i) => { if (lastFrame.units[i].alive) remain[u.side] += lastFrame.units[i].troops; });

  const reportBox = (side) => {
    const text = buildReport(state, rec, side);
    const status = h('span', { class: 'note' });
    return h(
      'details',
      { class: 'report-more' },
      h('summary', {}, 'もっと詳しく：戦況レポート（AIに相談したい人向け）'),
      h(
        'div',
        { class: 'row-buttons' },
        h(
          'button',
          {
            class: 'btn small',
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

  const sidePanel = (side) =>
    h(
      'details',
      { class: `report side-${side}`, open: !!online },
      h('summary', {}, h('b', {}, `${SIDE_JA[side]}の振り返り`), online ? '' : `（${SIDE_JA[side]}の人だけ開いてください）`),
      sideSummary(state, rec, side),
      reportBox(side),
    );

  // ---- 対戦を終えるときの作戦公開（両軍の同意が必要） ----
  const disclose = h('div', { class: 'disclose-body' });
  const agree = { W: false, E: false };
  const openBtn = h('button', { class: 'btn primary', disabled: true }, '作戦を公開する');
  const showAll = () => {
    state.battle.disclosed = true;
    disclose.textContent = '';
    disclose.append(
      h('p', { class: 'note' }, 'お互いの作戦です。「その命令をそう訳したのか」「あの動きはこの狙いだったのか」を見比べてみよう。'),
      h('div', { class: 'reports compare' }, ...['W', 'E'].map((sd) => sideSummary(state, rec, sd, { showOutcome: false, title: `${SIDE_JA[sd]}の作戦` }))),
      h('p', { class: 'note' }, '作戦を公開したあとの再戦は、お互いの手の内を知った上での勝負になります。新しい勝負にするなら「陣立てからやり直す」へ。'),
    );
  };
  const agreeBox = (side) =>
    h(
      'label',
      { class: `agree side-${side}` },
      h('input', {
        type: 'checkbox',
        onchange: (e) => {
          agree[side] = e.target.checked;
          openBtn.disabled = !(agree.W && agree.E);
        },
      }),
      ` ${SIDE_JA[side]}：作戦の公開に同意する`,
    );
  openBtn.addEventListener('click', showAll);
  if (online) {
    // オンライン：自分の同意を送り、両軍の同意がそろったら、お互いの日本語の原文が届いて公開される
    const me = online.side;
    const en = me === 'W' ? 'E' : 'W';
    const line = h('div', { class: 'note' });
    const agreeBtn = h('button', { class: 'btn primary' }, '作戦の公開に同意する');
    let shown = false;
    const tryShow = async () => {
      const rd = online.round() || {};
      const ag = rd.agree || {};
      line.textContent = `${SIDE_JA[me]}（あなた）：${ag[me] ? '同意 ✓' : 'まだ'}　${SIDE_JA[en]}：${ag[en] ? '同意 ✓' : 'まだ'}`;
      agreeBtn.disabled = !!ag[me];
      if (shown || !(rd.reveal && rd.reveal.W && rd.reveal.E)) return;
      const bodies = await online.openReveal();
      if (!bodies || bodies.error) return;
      const r = bodies[en];
      for (const [id, t] of Object.entries(r.prompts || {})) if (id[0] === en) state.plan.prompts[id] = t;
      if (r.cmdPrompt) state.plan.cmdPrompts[en] = r.cmdPrompt;
      shown = true;
      showAll();
    };
    agreeBtn.addEventListener('click', () => {
      const prompts = {};
      for (const [id, t] of Object.entries(state.plan.prompts || {})) if (id[0] === me) prompts[id] = t;
      agreeBtn.disabled = true;
      online.agree({ prompts, cmdPrompt: (state.plan.cmdPrompts && state.plan.cmdPrompts[me]) || '' }).catch(() => { agreeBtn.disabled = false; });
    });
    disclose.append(
      h('p', { class: 'note' }, '対戦を終えるときに、両軍が同意したら、お互いの作戦（基本命令・追加命令の原文とAIの訳・決戦の全体指揮・道具）を見せ合えます。相手が同意するまで公開されません。'),
      h('div', { class: 'row-buttons' }, agreeBtn, line),
    );
    online.onRoom(() => tryShow());
    tryShow();
  } else disclose.append(
    h('p', { class: 'note' }, '対戦を終えるときに、両軍が同意したら、お互いの作戦（基本命令・追加命令の原文とAIの訳・決戦の全体指揮・道具）を見せ合えます。勝手には公開されません。'),
    h('div', { class: 'row-buttons' }, agreeBox('W'), agreeBox('E'), openBtn),
  );
  if (state.battle.disclosed && !online) showAll();

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
        '相手の作戦は明かしません。自軍の振り返りを開いて、どの命令で何秒動いたか、各部隊がどうなったかを確かめよう。相手の動きから作戦を推理して、作戦を直して再戦できます。',
      ),
      h('div', { class: `reports${online ? ' single' : ''}` }, mySides.map((sd) => sidePanel(sd))),
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => go('battle') }, 'もう一度見る'),
        h('button', { class: 'btn primary', onclick: () => go('replan') }, '作戦を直して再戦（同じ天候・同じ条件で比べる）'),
        h('button', { class: 'btn', onclick: () => go('replanNew') }, '作戦を直して再戦（新しい天候）'),
        h('button', { class: 'btn', onclick: () => go('lobby') }, '陣立てからやり直す'),
      ),
      h('details', { class: 'disclose', open: !!state.battle.disclosed }, h('summary', {}, h('b', {}, '対戦を終える：作戦を公開する（両軍の同意が必要）')), disclose),
    ),
  );
}
