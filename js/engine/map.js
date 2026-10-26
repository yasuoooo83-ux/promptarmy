// マップ定義・地形・距離・経路探索（整数のみ）
export const W = 16;
export const H = 10;
export const N = W * H;

export const MAP_ID = 'sekigahara01';

const ROWS = [
  '..FF...RR.......',
  '.FFF...RR.....H.',
  '..F....BB.......',
  '.......RR.HHH...',
  'W......RR..HH..E',
  'W..HH..RR......E',
  '...HHH.RR.......',
  '.......BB....F..',
  '.H.....RR...FFF.',
  '.......RR...FF..',
];

const CHAR_TERRAIN = {
  '.': 'campus',
  F: 'silva',
  H: 'collis',
  R: 'flumen',
  B: 'pons',
  W: 'campus',
  E: 'campus',
};

export const TERRAIN_COST = { campus: 1, silva: 2, collis: 1, flumen: 3, pons: 1 };

export const TERRAIN_JA = {
  campus: '平地',
  silva: '森',
  collis: '丘',
  flumen: '川',
  pons: '橋',
};

export const TERRAIN = new Array(N); // idx -> 地形名
export const COST = new Int8Array(N); // idx -> 移動コスト
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = CHAR_TERRAIN[ROWS[y][x]];
    TERRAIN[y * W + x] = t;
    COST[y * W + x] = TERRAIN_COST[t];
  }
}

// 本陣マス
export const BASE_CELLS = {
  W: [[0, 4], [0, 5]],
  E: [[15, 4], [15, 5]],
};

export function isBase(side, x, y) {
  return BASE_CELLS[side].some((c) => c[0] === x && c[1] === y);
}

export function otherSide(side) {
  return side === 'W' ? 'E' : 'W';
}

// 布陣できる範囲（自陣の6列。橋の手前まで出せる）
export const DEPLOY_COLS = { W: [0, 5], E: [10, 15] };
export function canDeploy(side, x, y) {
  const [a, b] = DEPLOY_COLS[side];
  return Number.isInteger(x) && Number.isInteger(y) && x >= a && x <= b && y >= 0 && y < H && TERRAIN[y * W + x] !== 'flumen';
}

// スロット番号 → 初期位置
const W_POS = [[0, 4], [3, 2], [2, 3], [2, 5], [2, 7], [1, 2], [1, 6]];
export const SLOT_POS = {
  W: W_POS,
  E: W_POS.map((p) => [15 - p[0], 9 - p[1]]),
};

export function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < W && y < H;
}

export function terrainAt(x, y) {
  return TERRAIN[y * W + x];
}

// ---- 連続座標（整数の固定小数）----
// 1マス = 100 単位。部隊の位置は 0〜1599 × 0〜999 の整数で持つ。
// 地形・本陣は「位置が属するマス」で判定する。
export const CELL = 100;
export const PW = W * CELL;
export const PH = H * CELL;

// 整数の平方根（切り捨て）。浮動小数の誤差が出ないよう補正する。
export function isqrt(n) {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

// ユークリッド距離（単位は座標と同じ。切り捨て）
export function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return isqrt(dx * dx + dy * dy);
}

// 距離の2乗（比較用）
export function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

// 「距離n」（マス数）を座標の距離にする。接触の余裕として +20。
export function reach(n) {
  return n * CELL + 20;
}

// 位置 → マス番号
export function cellIdx(x, y) {
  let cx = Math.floor(x / CELL);
  let cy = Math.floor(y / CELL);
  if (cx < 0) cx = 0;
  else if (cx >= W) cx = W - 1;
  if (cy < 0) cy = 0;
  else if (cy >= H) cy = H - 1;
  return cy * W + cx;
}

export function cellCenter(idx) {
  const cx = idx % W;
  const cy = (idx - cx) / W;
  return [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
}

export function terrainOfPos(x, y) {
  return TERRAIN[cellIdx(x, y)];
}

export function baseAtPos(side, x, y) {
  const i = cellIdx(x, y);
  const cx = i % W;
  return isBase(side, cx, (i - cx) / W);
}

// 地形ごとの進む速さ（％）
export const SPEED_PCT = { campus: 100, silva: 60, collis: 100, flumen: 40, pons: 100 };

// 8方向（上・右上・右・右下・下・左下・左・左上）
export const DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

// 東軍は点対称（180度回転）の順序を使う。同点のときの選び方が陣営で偏らないようにするため。
export const DIRS_BY_SIDE = {
  W: DIRS,
  E: DIRS.map((_, i) => DIRS[(i + 4) % 8]),
};
// 周囲8マスの走査順（西軍：上段の左から、東軍：その逆順）
const SCAN_W = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) SCAN_W.push([dx, dy]);
export const SCAN_BY_SIDE = { W: SCAN_W, E: SCAN_W.slice().reverse() };

export const INF = 1000000000;

// 移動コスト付き最短経路（Dial法）。blocked[idx]=1 のマスには入れない。
// 同コストの経路は、近傍を DIRS の順に展開したとき最初に見つかったものを採用する。
export function dijkstra(start, blocked, dirs = DIRS) {
  const dist_ = new Int32Array(N).fill(INF);
  const pred = new Int16Array(N).fill(-1);
  dist_[start] = 0;
  const buckets = [[start]];
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const cur = b[k];
      if (dist_[cur] !== d) continue;
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (let di = 0; di < 8; di++) {
        const nx = cx + dirs[di][0];
        const ny = cy + dirs[di][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (blocked[ni]) continue;
        const nd = d + COST[ni];
        if (nd < dist_[ni]) {
          dist_[ni] = nd;
          pred[ni] = cur;
          (buckets[nd] || (buckets[nd] = [])).push(ni);
        }
      }
    }
  }
  return { dist: dist_, pred };
}

// goal から pred をたどって、start の次の1マスを返す
export function firstStep(pred, start, goal) {
  let c = goal;
  let guard = 0;
  while (pred[c] !== start) {
    c = pred[c];
    if (c < 0 || ++guard > N) return -1;
  }
  return c;
}
