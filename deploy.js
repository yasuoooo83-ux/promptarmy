// 布陣と道具：自陣の6列に部隊を置き、道具を1つ選んで置く。置き終えたら封印して相手に見せない（ローカルモードでは畳んで隠す）。
import { h, clear } from './dom.js';
import { STATS } from '../engine/units.js';
import { W, H, TERRAIN, SLOT_POS, DEPLOY_COLS, canDeploy, isBase, TERRAIN_JA } from '../engine/map.js';
import { ITEMS, ITEM_KEYS, itemCells, canPlaceItem } from '../engine/items.js';
import { SIDE_JA } from './names.js';

const TERRAIN_MARK = { silva: '森', collis: '丘', pons: '橋' };
const ITEM_MARK = { ishigaki: '石', babosaku: '柵', yagura: '櫓' };

export function defaultPlacement(sl) {
  return SLOT_POS[sl.side][sl.slot].slice();
}

// 布陣の現在値（未設定なら初期位置）
export function placementOf(state, sl) {
  const p = state.plan.placement && state.plan.placement[sl.id];
  return p ? p.slice() : defaultPlacement(sl);
}

// 道具の現在値（無ければ null）
export function itemOf(state, side) {
  const it = state.plan.items && state.plan.items[side];
  return it && ITEMS[it.type] ? it : null;
}

// 道具を選んだときの最初の置き場所（自陣の前寄り・中央）
function defaultItemPos(side) {
  return side === 'W' ? { x: 3, y: 4 } : { x: 12, y: 5 };
}

export function deployView(state, slots, sides = ['W', 'E']) {
  const plan = state.plan;
  if (!plan.placement) plan.placement = {};
  if (!plan.placeSealed) plan.placeSealed = { W: false, E: false };
  if (!plan.items) plan.items = {};
  const box = h('div', { class: 'deploy' });

  function panel(side) {
    const host = h('div', { class: `deploy-panel side-${side}` });
    let selected = null; // 部隊のID、または 'item'
    const mine = slots.filter((s) => s.side === side);

    function render() {
      clear(host);
      host.append(h('h3', {}, `${SIDE_JA[side]}の布陣と道具`));
      if (plan.placeSealed[side]) {
        const it = itemOf(state, side);
        host.append(
          h('div', { class: 'seal' }, '布陣・道具 封印済み ✓'),
          h('p', { class: 'note' }, '配置と道具は開戦まで相手に見えません。'),
          h('button', { class: 'btn small', onclick: () => { plan.placeSealed[side] = false; render(); } }, '封印を解いて置き直す'),
        );
        return;
      }
      const it = itemOf(state, side);
      // 道具の選択
      const itemSel = h(
        'select',
        {
          class: 'basic-select',
          onchange: (e) => {
            const type = e.target.value;
            if (!type) delete plan.items[side];
            else plan.items[side] = { type, ...(ITEMS[type].place === 'none' ? {} : (it && it.x !== undefined ? { x: it.x, y: it.y } : defaultItemPos(side))) };
            selected = type && ITEMS[type].place !== 'none' ? 'item' : null;
            render();
          },
        },
        h('option', { value: '' }, '道具なし'),
        ITEM_KEYS.map((k) => h('option', { value: k, selected: !!it && it.type === k }, ITEMS[k].ja)),
      );
      host.append(
        h('div', { class: 'basic-row' }, h('label', {}, '道具（1つ）'), itemSel),
        h('div', { class: 'note small' }, it ? ITEMS[it.type].desc : '石垣・馬防柵・物見櫓・陣太鼓から1つ選べます。'),
      );
      host.append(
        h(
          'p',
          { class: 'note' },
          '部隊（丸）や道具（石・柵・櫓）を押して選び、置きたいマスを押す。自陣の6列（川以外）に置けます。森に置くと伏兵（敵から見えない）、丘は守りに強い。',
        ),
      );
      const [c0, c1] = DEPLOY_COLS[side];
      const grid = h('div', { class: 'deploy-grid' });
      grid.style.gridTemplateColumns = `repeat(${c1 - c0 + 1}, 34px)`;
      const at = {};
      for (const sl of mine) {
        const [x, y] = placementOf(state, sl);
        at[`${x},${y}`] = sl;
      }
      const itemSet = new Set(it ? itemCells(side, it) : []);
      for (let y = 0; y < H; y++) {
        for (let x = c0; x <= c1; x++) {
          const t = TERRAIN[y * W + x];
          const base = isBase(side, x, y);
          const sl = at[`${x},${y}`];
          const onItem = itemSet.has(y * W + x);
          const cell = h('div', {
            class: `dcell t-${t}${base ? ' base' : ''}${canDeploy(side, x, y) ? '' : ' no'}${onItem ? ' item item-' + it.type : ''}${onItem && selected === 'item' ? ' item-sel' : ''}`,
            title: onItem ? ITEMS[it.type].ja : base ? '本陣' : TERRAIN_JA[t],
            onclick: () => {
              if (sl && selected !== 'item') {
                selected = selected === sl.id ? null : sl.id;
                render();
                return;
              }
              if (!sl && onItem && selected !== 'item') {
                selected = 'item';
                render();
                return;
              }
              if (selected === 'item') {
                if (canPlaceItem(side, it.type, x, y)) plan.items[side] = { type: it.type, x, y };
                selected = null;
                render();
                return;
              }
              if (!selected || !canDeploy(side, x, y)) return;
              plan.placement[selected] = [x, y];
              selected = null;
              render();
            },
          });
          if (onItem) cell.append(h('span', { class: 'ditem' }, ITEM_MARK[it.type]));
          if (sl) {
            cell.append(h('span', { class: `dtoken ${side}${selected === sl.id ? ' sel' : ''}`, title: `第${sl.slot}隊` }, STATS[sl.genus].kanji));
          } else if (!onItem) {
            const mk = base ? '陣' : TERRAIN_MARK[t];
            if (mk) cell.append(h('span', { class: 'dmark' }, mk));
          }
          grid.append(cell);
        }
      }
      host.append(
        ...[
        grid,
        selected === 'item' ? h('p', { class: 'note' }, `${ITEMS[it.type].ja}を置くマスを押してください（${ITEMS[it.type].place === 'line' ? '押したマスと、その上下の3マス' : '1マス'}）。`) : null,
        h(
          'div',
          { class: 'row-buttons' },
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                for (const sl of mine) delete plan.placement[sl.id];
                selected = null;
                render();
              },
            },
            '初期配置に戻す',
          ),
          h('button', { class: 'btn small primary', onclick: () => { plan.placeSealed[side] = true; render(); } }, '布陣と道具を封印'),
        ),
        ].filter(Boolean),
      );
    }
    render();
    return host;
  }

  for (const side of sides) box.append(panel(side));
  return h('div', {}, h('h2', { class: 'section-title' }, '布陣と道具'), box);
}
