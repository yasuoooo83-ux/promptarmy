// 道具：各軍が1つだけ選べる。置く道具は自陣の布陣範囲に置く。
// 効果の数値は units.js の TUNING（wallPct など）。
import { W, H, TERRAIN, canDeploy } from './map.js';

export const ITEMS = {
  ishigaki: {
    ja: '石垣',
    place: 'line',
    desc: '縦3マスの石垣を築く。石垣の上で戦う味方は、受けるダメージが大きく減る。敵は石垣を越えるのが遅い。',
  },
  babosaku: {
    ja: '馬防柵',
    place: 'line',
    desc: '縦3マスの柵を立てる。柵の所にいる味方には、騎馬の突撃が効かず、騎馬の攻撃も弱まる。敵は柵を越えるのが遅い。鉄砲と組むと強い。',
  },
  yagura: {
    ja: '物見櫓',
    place: 'point',
    desc: '1マスに櫓を建てる。櫓の4マス以内に伏せた敵は見破られる。櫓の2マス以内の弓・鉄砲は射程+1。',
  },
  taiko: {
    ja: '陣太鼓',
    place: 'none',
    desc: '全軍の士気が下がりにくく、立て直しも早い（置く場所はない）。',
  },
};

export const ITEM_KEYS = Object.keys(ITEMS);

// 道具が占めるマス（線は縦3マス：置いたマスと、その上下）。置けないマスは除く
export function itemCells(side, item) {
  if (!item || !ITEMS[item.type] || ITEMS[item.type].place === 'none') return [];
  const { x, y } = item;
  const ys = ITEMS[item.type].place === 'line' ? [y - 1, y, y + 1] : [y];
  return ys.filter((yy) => yy >= 0 && yy < H && canDeploy(side, x, yy)).map((yy) => yy * W + x);
}

export function canPlaceItem(side, type, x, y) {
  if (!ITEMS[type]) return false;
  if (ITEMS[type].place === 'none') return true;
  return canDeploy(side, x, y) && TERRAIN[y * W + x] !== 'flumen';
}

// 設定を検査して正規化する。おかしければ null（道具なし）
export function normItem(side, item) {
  if (!item || !ITEMS[item.type]) return null;
  if (ITEMS[item.type].place === 'none') return { type: item.type };
  const x = item.x | 0;
  const y = item.y | 0;
  return canPlaceItem(side, item.type, x, y) ? { type: item.type, x, y } : null;
}
