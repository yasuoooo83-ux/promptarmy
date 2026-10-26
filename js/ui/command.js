// 決戦：30秒で決着しなかったとき、両軍が全体指揮（全部隊への号令）を1つずつ書いて封印する。
import { h, copyText } from './dom.js';
import { parseOrder, errorMessage } from '../engine/parse.js';
import { buildPrompt } from '../prompt.js';
import { MAX_TURNS } from '../engine/units.js';
import { SD_TURNS } from '../engine/sim.js';
import { SIDE_JA } from './names.js';
import { demoCommand } from './plan.js';
import { guideView } from './guide.js';

export function fillDemoCommands(state) {
  for (const side of ['W', 'E']) {
    if (state.plan.commands[side]) continue;
    const d = demoCommand(side);
    const r = parseOrder(d.text, { slotId: side, genus: 'omnes' });
    if (r.ok) {
      state.plan.commands[side] = { order: r.order, text: d.text };
      state.plan.cmdPrompts[side] = d.jp;
    }
  }
}

export function renderCommand(root, { state, go, startSuddenDeath }) {
  if (!state.plan.commands) state.plan.commands = {};
  if (!state.plan.cmdPrompts) state.plan.cmdPrompts = {};
  if (state.demoMode) fillDemoCommands(state);
  const rec = state.battle.record;
  const res = rec.result;
  const last = rec.turns[rec.turns.length - 1];
  const remain = { W: 0, E: 0 };
  rec.units.forEach((u, i) => { if (last.units[i].alive) remain[u.side] += last.units[i].troops; });
  const cards = {};
  const foot = h('span', { class: 'note' });

  function refresh() {
    const n = ['W', 'E'].filter((s) => state.plan.commands[s]).length;
    foot.textContent = `封印済み ${n} / 2 軍。未封印の軍は「いつも待機」になります。`;
  }

  function sealedView(side) {
    return h(
      'div',
      { class: `plan-card sealed side-${side}` },
      h('div', { class: 'plan-head' }, h('b', {}, `${SIDE_JA[side]}の全体指揮`)),
      h('div', { class: 'seal' }, `封印号令 ${state.plan.commands[side].order.iussa.length}条 ✓`),
      h(
        'button',
        { class: 'btn small', onclick: () => { delete state.plan.commands[side]; swap(side); refresh(); } },
        '封印を解いてやり直す',
      ),
    );
  }

  function editView(side) {
    const status = h('div', { class: 'status' });
    const copied = h('span', { class: 'note' });
    const prompt = h('textarea', { class: 'jp', rows: 3, maxLength: 600, placeholder: '全軍への号令を日本語で書く（例：全軍、敵の大将へ突撃せよ）' });
    prompt.value = state.plan.cmdPrompts[side] || demoCommand(side).jp;
    const paste = h('textarea', {
      class: 'sealed-input', rows: 3, maxLength: 6000, spellcheck: false,
      placeholder: 'AIが返した軍令をここに貼り付ける（中身はぼかして表示されます）',
    });
    return h(
      'div',
      { class: `plan-card side-${side}` },
      h('div', { class: 'plan-head' }, h('b', {}, `${SIDE_JA[side]}の全体指揮`), '（大将を含む全部隊が、この号令に従う）'),
      h('label', {}, '① 全軍への号令（日本語）'),
      prompt,
      h(
        'div',
        { class: 'row-buttons' },
        h(
          'button',
          {
            class: 'btn small',
            onclick: async () => {
              const ok = await copyText(buildPrompt(side, 'omnes', prompt.value.trim()));
              copied.textContent = ok ? '号令を入れた指示文をコピーしました。AIに貼って送ってください。' : 'コピーできませんでした。';
            },
          },
          '② 指示文をコピー',
        ),
        copied,
      ),
      h('label', {}, '③ AIが返した軍令を貼る'),
      paste,
      status,
      h(
        'button',
        {
          class: 'btn small primary',
          onclick: () => {
            const r = parseOrder(paste.value, { slotId: side, genus: 'omnes' });
            if (!r.ok) {
              status.className = 'status bad';
              status.textContent = [...new Set(r.errors.map(errorMessage))].join(' ');
              return;
            }
            state.plan.commands[side] = { order: r.order, text: paste.value };
            state.plan.cmdPrompts[side] = prompt.value;
            swap(side);
            refresh();
          },
        },
        '④ 検査して封印する',
      ),
    );
  }

  function swap(side) {
    const next = state.plan.commands[side] ? sealedView(side) : editView(side);
    cards[side].replaceWith(next);
    cards[side] = next;
  }

  const list = h('div', { class: 'plan-list' });
  for (const side of ['W', 'E']) {
    cards[side] = state.plan.commands[side] ? sealedView(side) : editView(side);
    list.append(cards[side]);
  }

  root.append(
    h(
      'section',
      { class: 'screen plan command' },
      h('h1', {}, '決戦 ― 全体指揮'),
      h(
        'div',
        { class: 'result-banner' },
        h('div', { class: 'big' }, `${MAX_TURNS}秒で決着つかず`),
        h('div', {}, `残存兵力　西軍 ${res.ratio.W}%（${remain.W}）／東軍 ${res.ratio.E}%（${remain.E}）`),
      ),
      h(
        'p',
        { class: 'note' },
        `両軍とも、大将を含む全部隊への号令を1つ書いて封印してください。号令は部隊ごとの軍令に代わって、決戦の間ずっと働きます。` +
          `決戦は最大${SD_TURNS}秒（時間の条件は決戦開始から数える）。両軍とも布陣の位置に戻って陣を立て直し、失った兵の半分が戻る。決戦中は急行軍で足が速い。大将を討つか本陣を落とせば勝ち。決まらなければ残存兵数の割合で決着します。`,
      ),
      guideView(),
      list,
      h(
        'details',
        { class: 'dev', open: true },
        h('summary', {}, 'デモ（お試し用）'),
        h(
          'button',
          { class: 'btn', onclick: () => { fillDemoCommands(state); for (const s of ['W', 'E']) swap(s); refresh(); } },
          'デモの号令を両軍に入力する（西：大将へ総攻撃／東：大将を守る）',
        ),
      ),
      h('div', { class: 'foot' }, foot),
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => go('battle') }, '合戦を見直す'),
        h('button', { class: 'btn big primary', onclick: () => startSuddenDeath() }, '決戦開始'),
      ),
    ),
  );
  refresh();
}
