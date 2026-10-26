// 陣立て（ローカルモード：1画面で両軍の編成を決める）
import { h } from './dom.js';
import { STATS, TROOP_GENERA, BUDGET, MAX_UNITS, armyCost } from '../engine/units.js';
import { SIDE_JA } from './names.js';
import { forecastView } from './forecast.js';

export const PRESET = ['pedites', 'hastati', 'equites', 'sagittarii', 'sclopetarii'];

export function sideComp(state, side) {
  const out = [];
  for (let i = 1; i <= 6; i++) {
    const s = state.slots[side + i];
    if (s && s.genus) out.push(s.genus);
  }
  return out;
}

export function renderLobby(root, { state, go, newSeed }) {
  const info = {};
  const startBtn = h('button', { class: 'btn big primary' }, '作戦開始');

  function refresh() {
    let ok = true;
    for (const side of ['W', 'E']) {
      const comp = sideComp(state, side);
      const cost = armyCost(comp);
      const over = cost > BUDGET;
      if (over) ok = false;
      info[side].textContent = `編成 ${cost} / ${BUDGET}（残り ${BUDGET - cost}）　部隊 ${comp.length} / ${MAX_UNITS}`;
      info[side].classList.toggle('over', over);
    }
    startBtn.disabled = !ok;
  }

  function column(side) {
    const rows = [];
    // 大将
    rows.push(
      h(
        'div',
        { class: 'slot-row' },
        h('span', { class: 'slot-name' }, '大将'),
        h('span', { class: 'slot-genus fixed' }, `${STATS.dux.ja}（コスト外）`),
        h('input', {
          class: 'owner', type: 'text', maxLength: 12, placeholder: '担当者名',
          value: (state.slots[side + '0'] && state.slots[side + '0'].owner) || '',
          oninput: (e) => { state.slots[side + '0'] = { genus: 'dux', owner: e.target.value }; },
        }),
      ),
    );
    for (let i = 1; i <= 6; i++) {
      const id = side + i;
      const cur = state.slots[id] || { genus: '', owner: '' };
      const sel = h(
        'select',
        {
          class: 'slot-genus',
          onchange: (e) => {
            state.slots[id] = { genus: e.target.value, owner: (state.slots[id] && state.slots[id].owner) || '' };
            refresh();
          },
        },
        h('option', { value: '' }, '— なし —'),
        TROOP_GENERA.map((g) =>
          h('option', { value: g, selected: cur.genus === g }, `${STATS[g].ja}（${STATS[g].cost}）`),
        ),
      );
      rows.push(
        h(
          'div',
          { class: 'slot-row' },
          h('span', { class: 'slot-name' }, `第${i}隊`),
          sel,
          h('input', {
            class: 'owner', type: 'text', maxLength: 12, placeholder: '担当者名',
            value: cur.owner || '',
            oninput: (e) => {
              state.slots[id] = { genus: (state.slots[id] && state.slots[id].genus) || '', owner: e.target.value };
            },
          }),
        ),
      );
    }
    info[side] = h('div', { class: 'budget' });
    return h('div', { class: `army army-${side}` }, h('h2', {}, `${SIDE_JA[side]}の陣立て`), rows, info[side]);
  }

  startBtn.addEventListener('click', () => go('plan'));

  root.append(
    h(
      'section',
      { class: 'screen lobby' },
      h('h1', {}, '陣立て'),
      h('p', { class: 'note' }, `編成予算は1軍${BUDGET}。部隊は最大${MAX_UNITS}、同じ兵種を複数出せます。担当者名は空でも構いません（1人が複数の部隊を担当してもOK）。`),
      h('div', { class: 'armies' }, column('W'), column('E')),
      forecastView(state.seed),
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => go('title') }, '戻る'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              for (const side of ['W', 'E']) {
                for (let i = 1; i <= 6; i++) {
                  const prev = state.slots[side + i];
                  state.slots[side + i] = { genus: PRESET[i - 1] || '', owner: (prev && prev.owner) || '' };
                }
              }
              go('lobby');
            },
          },
          'おまかせ編成',
        ),
        h('button', { class: 'btn', onclick: () => { newSeed(); go('lobby'); } }, '天候を引き直す'),
        startBtn,
      ),
    ),
  );
  refresh();
}
