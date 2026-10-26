// 作戦：部隊ごとに「基本命令」を選ぶ（これだけで開戦できる）。
// 工夫したい部隊にだけ、日本語の「追加命令」を書き、AIに訳してもらって封印する（任意）。
// 時間や状況の条件（〜秒たったら、敵が近づいたら…）は追加命令でしか書けない。
import { h, copyText } from './dom.js';
import { STATS } from '../engine/units.js';
import { parseOrder, parseBulk, errorMessage } from '../engine/parse.js';
import { BASIC, basicChoices, defaultBasic } from '../engine/basic.js';
import { buildPrompt, buildBulkPrompt } from '../prompt.js';
import { forecastView } from './forecast.js';
import { deployView } from './deploy.js';
import { guideView } from './guide.js';
import { slotLabel, SIDE_JA } from './names.js';

export function slotList(state) {
  const out = [];
  for (const side of ['W', 'E']) {
    for (let i = 0; i <= 6; i++) {
      const id = side + i;
      const s = state.slots[id];
      if (i === 0) out.push({ id, side, slot: 0, genus: 'dux', owner: (s && s.owner) || '' });
      else if (s && s.genus) out.push({ id, side, slot: i, genus: s.genus, owner: s.owner || '' });
    }
  }
  return out;
}

export function basicOf(state, sl) {
  const b = state.plan.basic && state.plan.basic[sl.id];
  return b && basicChoices(sl.genus).includes(b) ? b : defaultBasic(sl.genus);
}

// ---- デモ：西軍は攻め、東軍は橋の待ち伏せ＋森の伏兵 ----
// basic = 基本命令、jp = 追加命令（日本語。空なら基本命令だけ）、iussa = AIが訳したのと同じ形の追加命令
const DEMO_W = {
  dux: {
    basic: 'hold',
    jp: '8秒たったら自ら出陣し、敵の大将を討ち取れ。',
    iussa: [{ si: { res: 'post', numerus: 8 }, fac: { actio: 'impetus', scopus: 'dux' } }],
    nota: 'Post octo secunda dux ducem hostium petit.',
  },
  pedites: {
    basic: 'attack',
    jp: '敵が5マス以内に来たら、半分だけ突っ込め。残りの半分は守りを固めろ。',
    iussa: [{ si: { res: 'hostis_prope', spatium: 5 }, fac: { actio: 'impetus', scopus: 'proximus', pars: 50 } }],
    nota: 'Dimidia pars impetum facit; reliqui locum tenent.',
  },
  hastati: {
    basic: 'attack',
    jp: '敵の騎馬が2マス以内に来たら、槍で騎馬を狙って突け。',
    iussa: [{ si: { res: 'hostis_prope', genus: 'equites', spatium: 2 }, fac: { actio: 'impetus', scopus: 'equites' } }],
    nota: 'Equites hostium hastis petunt.',
  },
  equites: {
    basic: 'attack',
    jp: '敵の大将が6マス以内に見えたら、横へ回り込んで討ち取れ。',
    iussa: [{ si: { res: 'hostis_prope', genus: 'dux', spatium: 6 }, fac: { actio: 'circumire', scopus: 'dux' } }],
    nota: 'Ducem hostium a latere petunt.',
  },
  sagittarii: { basic: 'attack', jp: '', iussa: null },
  sclopetarii: {
    basic: 'attack',
    jp: '雨のときは待機。',
    iussa: [{ si: { res: 'pluvia' }, fac: { actio: 'exspectare' } }],
    nota: 'In pluvia manent.',
  },
};

const DEMO_E = {
  dux: {
    basic: 'hold',
    jp: '大将が危なくなったら本陣へ下がれ。',
    iussa: [{ si: { res: 'dux_in_periculo' }, fac: { actio: 'ire', locus: 'castra' } }],
    nota: 'In periculo ad castra redit.',
  },
  pedites: { basic: 'attack', jp: '', iussa: null },
  hastati: { basic: 'hold', jp: '', iussa: null },
  equites: {
    basic: 'hold',
    jp: '森に伏せて待て。敵が4マス以内に来たら飛び出して突撃せよ。',
    iussa: [{ si: { res: 'hostis_prope', spatium: 4 }, fac: { actio: 'impetus', scopus: 'proximus' } }],
    nota: 'In silva latent; hostibus appropinquantibus erumpunt.',
  },
  sagittarii: {
    basic: 'hold',
    jp: '兵が3割を切ったら下がれ。',
    iussa: [{ si: { res: 'copiae_infra', pars: 30 }, fac: { actio: 'recedere' } }],
    nota: 'Si pauci sunt, recedunt.',
  },
  sclopetarii: { basic: 'hold', jp: '', iussa: null },
};

// デモの布陣（東軍：橋の手前に弓・鉄砲、森に騎馬の伏兵）。兵種ごと、各1部隊目だけ
const DEMO_PLACE_E = { dux: [15, 4], pedites: [10, 6], hastati: [10, 3], equites: [12, 8], sagittarii: [10, 8], sclopetarii: [10, 2] };
export function demoPlacement(slots) {
  const out = {};
  const used = new Set();
  for (const sl of slots) {
    if (sl.side !== 'E' || used.has(sl.genus) || !DEMO_PLACE_E[sl.genus]) continue;
    used.add(sl.genus);
    out[sl.id] = DEMO_PLACE_E[sl.genus].slice();
  }
  return out;
}

// デモの基本命令と追加命令。text = 追加命令のJSON（AIが返す形）。追加命令がなければ null
export function demoOrder(sl) {
  const table = sl.side === 'E' || String(sl.id || '').startsWith('E') ? DEMO_E : DEMO_W;
  const d = table[sl.genus] || table.pedites;
  const text = d.iussa ? JSON.stringify({ legio: sl.id, genus: sl.genus, iussa: d.iussa, nota: d.nota }, null, 2) : null;
  return { basic: d.basic, jp: d.jp, text };
}

// デモの全体指揮（決戦の号令。こちらは「いつも」も書ける）
const DEMO_CMD = {
  W: {
    jp: '全軍、敵の大将めがけて突撃せよ！',
    iussa: [{ si: { res: 'semper' }, fac: { actio: 'impetus', scopus: 'dux' } }],
    nota: 'Omnes in ducem hostium impetum faciunt.',
  },
  E: {
    jp: '大将を守れ。敵がすぐそばに来たら斬りかかれ。',
    iussa: [
      { si: { res: 'hostis_prope', spatium: 1 }, fac: { actio: 'impetus', scopus: 'proximus' } },
      { si: { res: 'semper' }, fac: { actio: 'tueri', socius: 'dux' } },
    ],
    nota: 'Ducem tuentur; hostes proximos invadunt.',
  },
};

export function demoCommand(side) {
  const d = DEMO_CMD[side];
  const text = JSON.stringify({ legio: side, genus: 'omnes', iussa: d.iussa, nota: d.nota }, null, 2);
  return { jp: d.jp, text };
}

// デモの作戦（基本命令・追加命令・布陣）をまとめて入れる。追加命令は通常と同じ検査を通す。
export const DEMO_ITEMS = { W: { type: 'taiko' }, E: { type: 'ishigaki', x: 10, y: 7 } };

export function fillDemo(state, slots) {
  const p = state.plan;
  if (!p.items) p.items = {};
  for (const side of ['W', 'E']) if (!p.items[side]) p.items[side] = { ...DEMO_ITEMS[side] };
  for (const [id, pos] of Object.entries(demoPlacement(slots))) if (!p.placement[id]) p.placement[id] = pos;
  for (const sl of slots) {
    const d = demoOrder(sl);
    p.basic[sl.id] = d.basic;
    p.extraText[sl.id] = d.jp;
    delete p.sealed[sl.id];
    delete p.prompts[sl.id];
    if (d.text) {
      const r = parseOrder(d.text, { slotId: sl.id, genus: sl.genus, extra: true });
      if (r.ok) {
        p.sealed[sl.id] = { order: r.order, text: d.text };
        p.prompts[sl.id] = d.jp;
      }
    }
  }
}

// 一括入力の日本語：部隊ごとの見出し【W1 足軽】の下に追加命令を書く
export function bulkTemplate(state, units) {
  return units
    .map((sl) => `【${sl.id} ${STATS[sl.genus].ja}】${(state.plan.extraText && state.plan.extraText[sl.id]) || ''}`)
    .join('\n');
}

// 見出し【W1 …】ごとに日本語の命令を切り分ける
export function splitBulkText(text) {
  const out = {};
  const re = /【\s*([WE]\d)[^】]*】([\s\S]*?)(?=【\s*[WE]\d|$)/g;
  let m;
  while ((m = re.exec(String(text)))) out[m[1].toUpperCase()] = m[2].trim();
  return out;
}

function showErrors(status, errors) {
  status.className = 'status bad';
  status.textContent = '';
  for (const m of new Set(errors.map(errorMessage))) status.append(h('div', {}, m));
}

export function renderPlan(root, { state, go, startBattle }) {
  const slots = slotList(state);
  const plan = state.plan;
  if (state.autoDemo) {
    state.autoDemo = false;
    fillDemo(state, slots);
  }
  const cards = {};
  const footInfo = h('span', { class: 'note' });
  const startBtn = h('button', { class: 'btn big primary' }, '開戦');

  function refreshFoot() {
    const n = slots.filter((s) => plan.sealed[s.id]).length;
    footInfo.textContent = `全${slots.length}隊、基本命令で開戦できます。追加命令を封印した部隊：${n}隊。`;
  }

  function extraStatus(sl) {
    const sealed = plan.sealed[sl.id];
    return sealed
      ? h('span', { class: 'seal small-seal' }, `追加命令 ${sealed.order.iussa.length}条 封印 ✓`)
      : h('span', { class: 'note' }, '追加命令なし（基本命令だけで動く）');
  }

  function card(sl) {
    const basicSel = h(
      'select',
      {
        class: 'basic-select',
        onchange: (e) => {
          plan.basic[sl.id] = e.target.value;
          desc.textContent = BASIC[e.target.value].desc;
        },
      },
      basicChoices(sl.genus).map((k) => h('option', { value: k, selected: basicOf(state, sl) === k }, BASIC[k].ja)),
    );
    const desc = h('div', { class: 'note small' }, BASIC[basicOf(state, sl)].desc);
    const sealed = plan.sealed[sl.id];

    const status = h('div', { class: 'status' });
    const copied = h('span', { class: 'note' });
    const jp = h('textarea', {
      class: 'jp', rows: 2, maxLength: 600,
      placeholder: '例：敵の騎馬が2マス以内に来たら突け／10秒たったら突撃／兵が3割を切ったら本陣へ退け',
      oninput: (e) => { plan.extraText[sl.id] = e.target.value; },
    });
    jp.value = (plan.extraText && plan.extraText[sl.id]) || '';
    const paste = h('textarea', {
      class: 'sealed-input', rows: 3, maxLength: 6000, spellcheck: false,
      placeholder: 'AIが返した軍令をここに貼り付ける（中身はぼかして表示されます）',
    });
    const extraBox = sealed
      ? h(
          'div',
          { class: 'extra-sealed' },
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                delete plan.sealed[sl.id];
                delete plan.prompts[sl.id];
                swap(sl);
                refreshFoot();
              },
            },
            '追加命令の封印を解く',
          ),
        )
      : h(
          'details',
          { class: 'extra', open: !!jp.value },
          h('summary', {}, '＋ 追加命令を付ける（任意・AIで訳す）'),
          h('label', {}, '① 追加命令（日本語）。時間や状況の条件はここで書く。当てはまらないときは基本命令で動く'),
          jp,
          h(
            'div',
            { class: 'row-buttons' },
            h(
              'button',
              {
                class: 'btn small',
                onclick: async () => {
                  const text = jp.value.trim();
                  const ok = await copyText(buildPrompt(sl.id, sl.genus, text, basicOf(state, sl)));
                  copied.textContent = !ok ? 'コピーできませんでした。' : text ? '指示文をコピーしました。AIに貼って送ってください。' : '指示文をコピーしました（追加命令が空です）。';
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
                const r = parseOrder(paste.value, { slotId: sl.id, genus: sl.genus, extra: true });
                if (!r.ok) return showErrors(status, r.errors);
                plan.sealed[sl.id] = { order: r.order, text: paste.value };
                plan.prompts[sl.id] = jp.value;
                swap(sl);
                refreshFoot();
              },
            },
            '④ 検査して封印する',
          ),
        );
    return h(
      'div',
      { class: `plan-card side-${sl.side}${sealed ? ' has-extra' : ''}` },
      h('div', { class: 'plan-head' }, h('b', {}, slotLabel(sl.id)), ` ${STATS[sl.genus].ja}${sl.owner ? '（' + sl.owner + '）' : ''}`),
      h('div', { class: 'basic-row' }, h('label', {}, '基本命令'), basicSel),
      desc,
      h('div', { class: 'extra-status' }, extraStatus(sl)),
      extraBox,
    );
  }

  function swap(sl) {
    const next = card(sl);
    cards[sl.id].replaceWith(next);
    cards[sl.id] = next;
  }

  // まとめて追加命令（ひとりで遊ぶとき向け）：追加命令を書いた部隊ぶんを、1回でAIに訳してもらう
  function bulkView(side) {
    const units = slots.filter((sl) => sl.side === side);
    const status = h('div', { class: 'status' });
    const copied = h('span', { class: 'note' });
    const jp = h('textarea', { class: 'jp', rows: Math.min(10, units.length + 1), maxLength: 4000 });
    jp.value = bulkTemplate(state, units);
    const paste = h('textarea', {
      class: 'sealed-input', rows: 3, maxLength: 30000, spellcheck: false,
      placeholder: 'AIが返した軍令をここに貼り付ける（中身はぼかして表示されます）',
    });
    const targets = () => {
      const said = splitBulkText(jp.value);
      return { said, units: units.filter((sl) => said[sl.id]) };
    };
    return h(
      'details',
      { class: `plan-card bulk side-${side}` },
      h('summary', {}, h('b', {}, `${SIDE_JA[side]}の追加命令をまとめて書く`), '（ひとりで遊ぶとき向け）'),
      h('label', {}, '① 【W1 足軽】のような見出しの後ろに、その部隊への追加命令を書く。空の部隊は基本命令だけで動く'),
      jp,
      h(
        'div',
        { class: 'row-buttons' },
        h(
          'button',
          {
            class: 'btn small',
            onclick: async () => {
              const { said, units: us } = targets();
              if (!us.length) {
                copied.textContent = '追加命令が書かれた部隊がありません。';
                return;
              }
              const text = us.map((sl) => `【${sl.id} ${STATS[sl.genus].ja}】${said[sl.id]}`).join('\n');
              const ok = await copyText(buildBulkPrompt(us.map((sl) => ({ id: sl.id, genus: sl.genus, basic: basicOf(state, sl) })), text));
              copied.textContent = ok ? `${us.length}部隊ぶんの指示文をコピーしました。AIに貼って送ってください。` : 'コピーできませんでした。';
            },
          },
          '② 指示文をコピー（まとめて）',
        ),
        copied,
      ),
      h('label', {}, '③ AIが返した軍令を貼る（1回でまとめて）'),
      paste,
      status,
      h(
        'button',
        {
          class: 'btn small primary',
          onclick: () => {
            const { said, units: us } = targets();
            const r = parseBulk(paste.value, us.map((sl) => ({ slotId: sl.id, genus: sl.genus, extra: true })));
            status.textContent = '';
            if (r.error) return showErrors(status, [r.error]);
            let n = 0;
            const bad = [];
            for (const sl of us) {
              const one = r.results[sl.id];
              if (one.ok) {
                plan.sealed[sl.id] = { order: one.order, text: JSON.stringify(one.order) };
                plan.extraText[sl.id] = said[sl.id];
                plan.prompts[sl.id] = said[sl.id];
                swap(sl);
                n++;
              } else {
                bad.push(h('div', {}, `${slotLabel(sl.id)}（${STATS[sl.genus].ja}）：${[...new Set(one.errors.map(errorMessage))].join(' ')}`));
              }
            }
            refreshFoot();
            status.className = bad.length ? 'status bad' : 'status good';
            status.append(h('div', {}, `${n}部隊の追加命令を封印しました。`), ...bad);
          },
        },
        '④ 検査してまとめて封印する',
      ),
    );
  }

  const list = h('div', { class: 'plan-list' });
  for (const sl of slots) {
    cards[sl.id] = card(sl);
    list.append(cards[sl.id]);
  }

  const dev = h(
    'details',
    { class: 'dev', open: true },
    h('summary', {}, 'デモ（お試し用）'),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: () => {
          fillDemo(state, slots);
          go('plan');
        },
      },
      'デモの作戦を入れる（西：攻め＋陣太鼓／東：橋の待ち伏せ・石垣・森の伏兵）',
    ),
  );

  startBtn.addEventListener('click', () => startBattle());
  root.append(
    h(
      'section',
      { class: 'screen plan' },
      h('h1', {}, '作戦'),
      h(
        'p',
        { class: 'note' },
        '部隊ごとに「基本命令」を選べば、すぐ開戦できます。工夫したい部隊にだけ「追加命令」を日本語で書き、AIに訳してもらって封印しましょう（任意）。時間や状況の条件（〜秒たったら、敵が近づいたら…）は追加命令で書きます。',
      ),
      forecastView(state.seed),
      guideView(),
      deployView(state, slots),
      h('h2', { class: 'section-title' }, '命令'),
      h('div', { class: 'plan-list bulk-list' }, bulkView('W'), bulkView('E')),
      list,
      dev,
      h('div', { class: 'foot' }, footInfo),
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => go('lobby') }, '陣立てに戻る'),
        startBtn,
      ),
    ),
  );
  refreshFoot();
}
