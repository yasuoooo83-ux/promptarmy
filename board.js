// 合戦の描画（Canvas 2D）。斜め上から見下ろした戦場に、兵アイコンの群れを描く。
// 計算は一切しない。エンジンの記録（record）を読んで、1ターンの間を演出でつなぐだけ。
// 描画の乱数（Math.random）は見た目にしか使わない。合戦の結果には関わらない。
import { W, H, TERRAIN, BASE_CELLS, CELL, PW, PH } from '../engine/map.js';
import { STATS } from '../engine/units.js';
import { CIRCLED } from '../ui/names.js';
import { itemCells } from '../engine/items.js';

// ---- 見た目の定数 ----
const TILT = 0.7; // 縦のつぶれ（斜め俯瞰）
const FAR = 0.78; // 奥（上端）の縮み
const TOP_PAD = 54; // 旗のための上の余白（px）
const BOTTOM_PAD = 18;
const PER_ICON = 2; // 兵アイコン1体 = 兵2人
const SPACING = 16; // 隊列の間隔（座標）
const ENGAGE_DIST = 150; // この距離以内の敵とは「乱戦」に見せる

const SIDE = {
  W: { main: '#2f57b8', light: '#8fb0ff', dark: '#14275c', line: 'rgba(80,140,255,0.75)', flag: '#2a4fa8' },
  E: { main: '#c8352a', light: '#ff9a8a', dark: '#5e130c', line: 'rgba(255,90,70,0.75)', flag: '#b8281e' },
};
const SKIN = '#f1d3a2';
const GROUND = {
  campus: [186, 178, 118],
  silva: [104, 128, 70],
  collis: [196, 166, 104],
  flumen: [92, 140, 172],
  pons: [92, 140, 172],
};

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 隊列（兵種ごと）。lat = 横、dep = 前からの深さ。
function makeSlots(n, genus) {
  const aspect = genus === 'sagittarii' || genus === 'sclopetarii' ? 3.2 : genus === 'equites' ? 1.5 : 1.7;
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const sp = genus === 'equites' ? SPACING * 1.25 : SPACING;
  const slots = [];
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols);
    const c = k % cols;
    const inRow = r === rows - 1 ? n - r * cols : cols;
    let lat = (c - (inRow - 1) / 2) * sp * 1.15 + (r % 2 ? sp * 0.35 : 0) + rand(-4, 4);
    let dep = r * sp * 0.8 + rand(-4, 4);
    if (genus === 'equites') dep += Math.abs(lat) * 0.35; // 楔形
    slots.push({ lat, dep, row: r });
  }
  const mean = slots.reduce((s, q) => s + q.dep, 0) / (n || 1);
  for (const q of slots) q.dep -= mean;
  return { slots, rows };
}

export function createBoard(container, battle, { onSelect } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'board-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'board-canvas';
  const lineBtn = document.createElement('button');
  lineBtn.className = 'btn small board-toggle on';
  lineBtn.textContent = '進軍線';
  wrap.append(canvas, lineBtn);
  container.append(wrap);

  let ctx = null;
  try {
    ctx = canvas.getContext && canvas.getContext('2d');
  } catch (e) {
    ctx = null;
  }

  let showLines = true;
  lineBtn.addEventListener('click', () => {
    showLines = !showLines;
    lineBtn.classList.toggle('on', showLines);
  });

  // ---- 投影（斜め俯瞰。奥ほど小さい台形） ----
  let S = 0.5; // 座標 → px の倍率（手前）
  let cssW = 800;
  let cssH = 400;
  const fz = (y) => FAR + (1 - FAR) * (y / PH);
  const projY = (y) => TOP_PAD + S * TILT * (FAR * y + ((1 - FAR) * y * y) / (2 * PH));
  const proj = (x, y) => [cssW / 2 + (x - PW / 2) * fz(y) * S, projY(y)];
  const scaleAt = (y) => S * fz(y); // その奥行きでの 1座標 = 何px

  // ---- 地形の下絵（一度だけ作り、画面の大きさが変わったら台形に写し直す） ----
  const TEX = 0.5; // 下絵の解像度（座標の半分）
  let groundTex = null;
  let bg = null;
  const trees = [];
  const camps = [];

  function buildGroundTexture() {
    const tw = PW * TEX;
    const th = PH * TEX;
    const c = document.createElement('canvas');
    c.width = tw;
    c.height = th;
    const g = c.getContext('2d');
    if (!g) return null;
    // 1) 地形の色をマス単位で塗った小さな絵を、なめらかに引き伸ばす（境目がぼける）
    const small = document.createElement('canvas');
    small.width = W;
    small.height = H;
    const sg = small.getContext('2d');
    const img = sg.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const col = GROUND[TERRAIN[i]];
      img.data[i * 4] = col[0];
      img.data[i * 4 + 1] = col[1];
      img.data[i * 4 + 2] = col[2];
      img.data[i * 4 + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(small, -tw / W / 2, -th / H / 2, tw + tw / W, th + th / H);
    // 2) 草のまだら
    for (let k = 0; k < 2600; k++) {
      const x = Math.random() * tw;
      const y = Math.random() * th;
      const r = rand(2, 9);
      g.fillStyle = Math.random() < 0.5 ? 'rgba(120,140,60,0.10)' : 'rgba(230,215,160,0.10)';
      g.beginPath();
      g.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    // 3) 丘：盛り上がりの陰影と等高線
    for (let i = 0; i < W * H; i++) {
      if (TERRAIN[i] !== 'collis') continue;
      const cx = ((i % W) + 0.5) * CELL * TEX;
      const cy = (Math.floor(i / W) + 0.5) * CELL * TEX;
      const gr = g.createRadialGradient(cx - 8, cy - 10, 4, cx, cy, CELL * TEX * 0.9);
      gr.addColorStop(0, 'rgba(255,240,200,0.45)');
      gr.addColorStop(1, 'rgba(120,90,40,0)');
      g.fillStyle = gr;
      g.fillRect(cx - CELL * TEX, cy - CELL * TEX, CELL * TEX * 2, CELL * TEX * 2);
      g.strokeStyle = 'rgba(110,80,40,0.25)';
      g.lineWidth = 1.2;
      for (let r = 10; r < 30; r += 8) {
        g.beginPath();
        g.ellipse(cx, cy, r * 1.4, r, 0, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      }
    }
    // 4) 川：行ごとの左右の岸をつないだ帯。ゆらぎを付ける
    const left = [];
    const right = [];
    for (let y = 0; y < H; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < W; x++) {
        const t = TERRAIN[y * W + x];
        if (t === 'flumen' || t === 'pons') {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      if (lo >= 0) {
        left.push([lo * CELL, (y + 0.5) * CELL]);
        right.push([(hi + 1) * CELL, (y + 0.5) * CELL]);
      }
    }
    if (left.length) {
      const wob = (y, s) => Math.sin(y / 70 + s) * 14 + Math.sin(y / 23 + s * 2) * 5;
      const pts = [];
      const N = 80;
      const pathEdge = (edge, s, inset) => {
        const out = [];
        for (let k = 0; k <= N; k++) {
          const yy = (k / N) * PH;
          const rowF = clamp(yy / CELL - 0.5, 0, edge.length - 1);
          const a = Math.floor(rowF);
          const b = Math.min(edge.length - 1, a + 1);
          const f = rowF - a;
          const x = edge[a][0] * (1 - f) + edge[b][0] * f + wob(yy, s) + inset;
          out.push([x * TEX, yy * TEX]);
        }
        return out;
      };
      const L = pathEdge(left, 0, 18);
      const R = pathEdge(right, 1.3, -18);
      pts.push(...L, ...R.reverse());
      // 岸
      g.fillStyle = 'rgba(90,75,45,0.45)';
      g.beginPath();
      const Lb = pathEdge(left, 0, 6);
      const Rb = pathEdge(right, 1.3, -6).reverse();
      [...Lb, ...Rb].forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      // 水
      const wg = g.createLinearGradient(left[0][0] * TEX, 0, right[0][0] * TEX, 0);
      wg.addColorStop(0, '#4f86ab');
      wg.addColorStop(0.5, '#6aa3c6');
      wg.addColorStop(1, '#4f86ab');
      g.fillStyle = wg;
      g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
      // さざ波
      g.strokeStyle = 'rgba(230,245,255,0.35)';
      g.lineWidth = 1;
      for (let k = 0; k < 90; k++) {
        const yy = Math.random() * PH;
        const row = clamp(Math.floor(yy / CELL), 0, left.length - 1);
        const xx = rand(left[row][0] + 30, right[row][0] - 30);
        g.beginPath();
        g.moveTo(xx * TEX, yy * TEX);
        g.quadraticCurveTo((xx + 8) * TEX, (yy - 4) * TEX, (xx + 16) * TEX, yy * TEX);
        g.stroke();
      }
    }
    // 5) 橋
    for (let y = 0; y < H; y++) {
      let lo = -1;
      let hi = -1;
      for (let x = 0; x < W; x++) {
        if (TERRAIN[y * W + x] === 'pons') {
          if (lo < 0) lo = x;
          hi = x;
        }
      }
      if (lo < 0) continue;
      const x0 = (lo * CELL - 10) * TEX;
      const x1 = ((hi + 1) * CELL + 10) * TEX;
      const yc = (y + 0.5) * CELL * TEX;
      const hh = 34 * TEX;
      g.fillStyle = '#8a6239';
      g.fillRect(x0, yc - hh, x1 - x0, hh * 2);
      g.strokeStyle = 'rgba(60,35,15,0.6)';
      g.lineWidth = 1;
      for (let x = x0; x < x1; x += 6) {
        g.beginPath();
        g.moveTo(x, yc - hh);
        g.lineTo(x, yc + hh);
        g.stroke();
      }
      g.fillStyle = '#5b3b1c';
      g.fillRect(x0, yc - hh - 2, x1 - x0, 3);
      g.fillRect(x0, yc + hh - 1, x1 - x0, 3);
    }
    // 6) 本陣の地面（踏み固めた土）
    for (const side of ['W', 'E']) {
      for (const [cx, cy] of BASE_CELLS[side]) {
        g.fillStyle = 'rgba(150,120,80,0.35)';
        g.fillRect(cx * CELL * TEX, cy * CELL * TEX, CELL * TEX, CELL * TEX);
      }
    }
    return c;
  }

  // 森の木（奥行きの並べ替えに入れる）と、本陣の陣幕
  for (let i = 0; i < W * H; i++) {
    if (TERRAIN[i] !== 'silva') continue;
    const cx = (i % W) * CELL;
    const cy = Math.floor(i / W) * CELL;
    for (let k = 0; k < 5; k++) trees.push({ x: cx + rand(12, 88), y: cy + rand(12, 88), r: rand(13, 19), tone: rand(0, 1) });
  }
  for (const side of ['W', 'E']) {
    const cs = BASE_CELLS[side];
    const x = (cs.reduce((s, c) => s + c[0], 0) / cs.length + 0.5) * CELL;
    const y = (cs.reduce((s, c) => s + c[1], 0) / cs.length + 0.5) * CELL;
    camps.push({ side, x, y });
  }

  // 道具（石垣・馬防柵・物見櫓・陣太鼓）
  const props = [];
  for (const side of ['W', 'E']) {
    const it = battle.items && battle.items[side];
    if (!it) continue;
    if (it.type === 'taiko') {
      const c = camps.find((q) => q.side === side);
      props.push({ kind: 'taiko', side, x: c.x + (side === 'W' ? 70 : -70), y: c.y + 120 });
      continue;
    }
    for (const idx of itemCells(side, it)) props.push({ kind: it.type, side, x: (idx % W) * CELL + CELL / 2, y: Math.floor(idx / W) * CELL + CELL / 2 });
  }

  function drawProp(g, p) {
    const sc = scaleAt(p.y) / 0.55;
    const side = SIDE[p.side];
    if (p.kind === 'ishigaki' || p.kind === 'babosaku') {
      // マスの縦の幅いっぱいに、敵の側へ向けた壁・柵
      const fx = p.side === 'W' ? 30 : -30;
      const [x0, y0] = proj(p.x + fx, p.y - 50);
      const [x1, y1] = proj(p.x + fx, p.y + 50);
      if (p.kind === 'ishigaki') {
        const hh = 13 * sc;
        g.fillStyle = '#9d978a';
        g.beginPath();
        g.moveTo(x0 - 5 * sc, y0);
        g.lineTo(x1 - 5 * sc, y1);
        g.lineTo(x1 - 5 * sc, y1 - hh);
        g.lineTo(x0 - 5 * sc, y0 - hh);
        g.closePath();
        g.fill();
        g.fillStyle = '#c3bdb0';
        g.beginPath();
        g.moveTo(x0 - 5 * sc, y0 - hh);
        g.lineTo(x1 - 5 * sc, y1 - hh);
        g.lineTo(x1 + 5 * sc, y1 - hh);
        g.lineTo(x0 + 5 * sc, y0 - hh);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(60,55,45,0.6)';
        g.lineWidth = 1;
        for (let k = 1; k < 5; k++) {
          const yy = y0 + ((y1 - y0) * k) / 5;
          g.beginPath();
          g.moveTo(x0 - 5 * sc, yy - hh * 0.5);
          g.lineTo(x0 - 5 * sc, yy - hh);
          g.stroke();
        }
        g.beginPath();
        g.moveTo(x0 - 5 * sc, y0 - hh * 0.5);
        g.lineTo(x1 - 5 * sc, y1 - hh * 0.5);
        g.stroke();
      } else {
        g.strokeStyle = '#6b4a24';
        g.lineWidth = Math.max(1.5, 2 * sc);
        const n = 6;
        for (let k = 0; k <= n; k++) {
          const xx = x0 + ((x1 - x0) * k) / n;
          const yy = y0 + ((y1 - y0) * k) / n;
          g.beginPath();
          g.moveTo(xx, yy);
          g.lineTo(xx + (p.side === 'W' ? 4 : -4) * sc, yy - 16 * sc);
          g.stroke();
        }
        g.lineWidth = Math.max(1, 1.5 * sc);
        for (const hf of [0.45, 0.8]) {
          g.beginPath();
          g.moveTo(x0, y0 - 16 * sc * hf);
          g.lineTo(x1, y1 - 16 * sc * hf);
          g.stroke();
        }
      }
    } else if (p.kind === 'yagura') {
      const [x, y] = proj(p.x, p.y);
      const hh = 46 * sc;
      const w = 16 * sc;
      g.strokeStyle = '#5a3b1c';
      g.lineWidth = Math.max(1.5, 2 * sc);
      g.beginPath();
      g.moveTo(x - w / 2, y);
      g.lineTo(x - w / 3, y - hh);
      g.moveTo(x + w / 2, y);
      g.lineTo(x + w / 3, y - hh);
      g.moveTo(x - w / 2, y - hh * 0.5);
      g.lineTo(x + w / 2, y - hh * 0.5);
      g.stroke();
      g.fillStyle = '#8a6239';
      g.fillRect(x - w * 0.6, y - hh - 6 * sc, w * 1.2, 7 * sc);
      g.fillStyle = side.flag;
      g.beginPath();
      g.moveTo(x - w * 0.75, y - hh - 6 * sc);
      g.lineTo(x, y - hh - 16 * sc);
      g.lineTo(x + w * 0.75, y - hh - 6 * sc);
      g.closePath();
      g.fill();
    } else if (p.kind === 'taiko') {
      const [x, y] = proj(p.x, p.y);
      const r = 9 * sc;
      g.fillStyle = '#5a3b1c';
      g.fillRect(x - r, y - r * 0.6, r * 2, r * 0.6);
      g.fillStyle = '#a0522d';
      g.beginPath();
      g.ellipse(x, y - r * 1.4, r, r * 0.9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f3e5c8';
      g.beginPath();
      g.ellipse(x, y - r * 1.4, r * 0.65, r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = side.flag;
      g.beginPath();
      g.arc(x, y - r * 1.4, r * 0.25, 0, Math.PI * 2);
      g.fill();
    }
  }

  function buildBackground() {
    if (!ctx) return;
    if (!groundTex) groundTex = buildGroundTexture();
    const dpr = window.devicePixelRatio || 1;
    bg = document.createElement('canvas');
    bg.width = Math.round(cssW * dpr);
    bg.height = Math.round(cssH * dpr);
    const g = bg.getContext('2d');
    g.scale(dpr, dpr);
    // 空と遠景
    const sky = g.createLinearGradient(0, 0, 0, TOP_PAD + 30);
    sky.addColorStop(0, '#d9cfb3');
    sky.addColorStop(1, '#c2b48a');
    g.fillStyle = sky;
    g.fillRect(0, 0, cssW, cssH);
    g.fillStyle = '#a49766';
    g.fillRect(0, cssH - BOTTOM_PAD, cssW, BOTTOM_PAD);
    // 下絵を台形に写す（横の帯ごと）
    if (groundTex) {
      const K = 140;
      for (let k = 0; k < K; k++) {
        const y0 = (k / K) * PH;
        const y1 = ((k + 1) / K) * PH;
        const ym = (y0 + y1) / 2;
        const [lx] = proj(0, ym);
        const w = PW * scaleAt(ym);
        const top = projY(y0);
        const bot = projY(y1);
        g.drawImage(groundTex, 0, y0 * TEX, PW * TEX, (y1 - y0) * TEX, lx, top, w, bot - top + 0.7);
      }
    }
    // 縁を暗く
    const [l0, t0] = proj(0, 0);
    const [r0] = proj(PW, 0);
    const [l1, b1] = proj(0, PH);
    const [r1] = proj(PW, PH);
    g.strokeStyle = 'rgba(60,45,20,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(l0, t0);
    g.lineTo(r0, t0);
    g.lineTo(r1, b1);
    g.lineTo(l1, b1);
    g.closePath();
    g.stroke();
    const vg = g.createRadialGradient(cssW / 2, cssH * 0.55, cssW * 0.25, cssW / 2, cssH * 0.55, cssW * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(40,25,5,0.28)');
    g.fillStyle = vg;
    g.fillRect(0, 0, cssW, cssH);
  }

  function resize() {
    const w = Math.max(280, Math.floor(container.clientWidth || wrap.clientWidth || 800));
    cssW = w;
    S = (w - 24) / PW;
    cssH = Math.ceil(projY(PH) + BOTTOM_PAD);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildBackground();
  }

  // ---- 部隊と兵の状態（描画側だけのもの） ----
  const US = battle.units.map((bu, i) => ({
    i, bu, side: bu.side, genus: bu.genus,
    cx: 0, cy: 0, fx: 0, fy: 0, tx: 0, ty: 0,
    facing: bu.side === 'W' ? 0 : Math.PI,
    faceTo: bu.side === 'W' ? 0 : Math.PI,
    soldiers: [], rows: 1, d: null, prevD: null, fallen: false, deadAt: 0,
  }));

  function newSoldier(u, x, y) {
    return {
      x, y, slot: { lat: 0, dep: 0, row: 0 },
      ph: rand(0, Math.PI * 2), k: rand(3.5, 7.5),
      mo: rand(-1, 1), ma: rand(-1, 1), next: 0, jx: 0, jy: 0,
      dying: 0, flag: false,
    };
  }

  function wanted(u, d) {
    if (!d || !d.on || !d.alive) return 0;
    return Math.max(1, Math.ceil(d.troops / PER_ICON));
  }

  // 現在の向きで、兵を隊列の枠に割り当てる（前の兵から順に）
  function reform(u) {
    const live = u.soldiers.filter((s) => !s.dying);
    const n = live.length;
    if (!n) return;
    const { slots, rows } = makeSlots(n, u.genus);
    u.rows = rows;
    const fx = Math.cos(u.faceTo);
    const fy = Math.sin(u.faceTo);
    const ref = live.map((s) => ({ s, f: (s.x - u.tx) * fx + (s.y - u.ty) * fy, l: -(s.x - u.tx) * fy + (s.y - u.ty) * fx }));
    ref.sort((a, b) => b.f - a.f);
    const bySlotRow = [...slots].sort((a, b) => a.dep - b.dep);
    let k = 0;
    while (k < n) {
      const row = bySlotRow[k].row;
      const rowSlots = [];
      while (k < n && bySlotRow[k].row === row) rowSlots.push(bySlotRow[k++]);
      const rowSol = ref.slice(k - rowSlots.length, k).sort((a, b) => a.l - b.l);
      rowSlots.sort((a, b) => a.lat - b.lat);
      rowSlots.forEach((q, j) => { rowSol[j].s.slot = q; });
    }
    // 旗指物（数体に1本）
    live.forEach((s, j) => { s.flag = j % 9 === 4; });
  }

  function slotPos(u, s, cx, cy, face) {
    const fx = Math.cos(face);
    const fy = Math.sin(face);
    return [cx - fx * s.slot.dep - fy * s.slot.lat, cy - fy * s.slot.dep + fx * s.slot.lat];
  }

  function ensureCount(u, n, instant, at) {
    n = Math.max(0, n);
    const live = u.soldiers.filter((s) => !s.dying);
    if (live.length < n) {
      for (let k = live.length; k < n; k++) u.soldiers.push(newSoldier(u, u.cx + rand(-20, 20), u.cy + rand(-20, 20)));
      reform(u);
      if (instant) for (const s of u.soldiers) [s.x, s.y] = slotPos(u, s, u.cx, u.cy, u.facing);
    } else if (live.length > n) {
      const extra = live.length - n;
      // 前列（敵に近い側）から減らす
      live.sort((a, b) => a.slot.dep - b.slot.dep);
      // 前の方の兵（候補）から、ばらばらに選んで減らす
      const pool = live.slice(0, Math.min(live.length, Math.max(3, extra * 2)));
      for (let k = pool.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [pool[k], pool[j]] = [pool[j], pool[k]];
      }
      for (const s of pool.slice(0, extra)) s.dying = instant ? -1 : at || now();
      if (instant) u.soldiers = u.soldiers.filter((s) => !s.dying);
    }
  }

  // ---- 演出（粒子・文字） ----
  let parts = [];
  let texts = [];
  let timeline = [];
  let shake = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  let frameIdx = -1;
  let turnStart = 0;
  let turnDur = 700;
  let selected = -1;

  const byId = {};
  battle.units.forEach((u, i) => { byId[u.id] = i; });

  function snapTo(frame) {
    const tr = battle.turns[frame];
    parts = [];
    texts = [];
    timeline = [];
    US.forEach((u, i) => {
      const d = tr.units[i];
      u.d = d;
      u.cx = u.fx = u.tx = d.x;
      u.cy = u.fy = u.ty = d.y;
      u.fallen = d.on && !d.alive;
      faceFor(u, d, tr);
      u.facing = u.faceTo;
      u.soldiers = [];
      const n = wanted(u, d);
      ensureCount(u, n, true);
    });
  }

  function faceFor(u, d, tr) {
    if (!d.alive) return;
    if (d.routed) {
      u.faceTo = u.side === 'W' ? Math.PI : 0;
      return;
    }
    if (d.tgt >= 0 && tr.units[d.tgt] && tr.units[d.tgt].alive) {
      const t = tr.units[d.tgt];
      u.faceTo = Math.atan2(t.y - d.y, t.x - d.x);
      return;
    }
    // 最も近い敵
    let best = null;
    let bd = Infinity;
    tr.units.forEach((e, j) => {
      if (!e.alive || !e.on || US[j].side === u.side) return;
      const dv = (e.x - d.x) ** 2 + (e.y - d.y) ** 2;
      if (dv < bd) { bd = dv; best = e; }
    });
    if (best) u.faceTo = Math.atan2(best.y - d.y, best.x - d.x);
  }

  function schedule(delay, fn) {
    timeline.push({ at: now() + delay, fn });
  }

  function addText(x, y, text, color, big) {
    texts.push({ x, y, text, color, big: !!big, t0: now(), dur: 1400 });
  }

  function update(frame, animate) {
    const tr = battle.turns[frame];
    if (!animate || frame !== frameIdx + 1 || frame === 0) {
      frameIdx = frame;
      snapTo(frame);
      return;
    }
    frameIdx = frame;
    const t0 = now();
    turnStart = t0;
    const moveDur = turnDur * 0.55;

    US.forEach((u, i) => {
      const d = tr.units[i];
      u.prevD = u.d;
      u.d = d;
      u.fx = u.cx;
      u.fy = u.cy;
      u.tx = d.x;
      u.ty = d.y;
      faceFor(u, d, tr);
      // 初めて戦場に出た部隊（分隊は split で兵を受け取る）
      if (d.on && (!u.prevD || !u.prevD.on) && !tr.events.some((e) => e.type === 'split' && e.b === u.bu.id)) {
        u.cx = u.fx = d.x;
        u.cy = u.fy = d.y;
        ensureCount(u, wanted(u, d), true);
      }
      if (u.soldiers.length) reform(u);
    });

    for (const ev of tr.events) {
      const a = byId[ev.a];
      const b = ev.b !== undefined ? byId[ev.b] : undefined;
      switch (ev.type) {
        case 'split': {
          // 元の部隊の後ろの兵を、守備隊へ渡す
          const P = US[a];
          const T = US[b];
          const give = wanted(T, T.d);
          const live = P.soldiers.filter((s) => !s.dying).sort((x, y) => y.slot.dep - x.slot.dep);
          const moved = live.slice(0, give);
          P.soldiers = P.soldiers.filter((s) => !moved.includes(s));
          T.soldiers = moved;
          T.cx = T.fx = P.cx;
          T.cy = T.fy = P.cy;
          T.facing = T.faceTo = P.facing;
          ensureCount(T, give, false);
          reform(T);
          reform(P);
          addText(T.d.x, T.d.y, '分隊', '#fff8d0');
          break;
        }
        case 'shoot': {
          const delay = moveDur * 0.8 + rand(0, turnDur * 0.15);
          schedule(delay, () => volley(US[a], US[b]));
          break;
        }
        case 'charge':
          schedule(moveDur * 0.85, () => {
            const T = US[b];
            parts.push({ type: 'arc', x: T.cx, y: T.cy, side: US[a].side, ang: Math.atan2(T.cy - US[a].cy, T.cx - US[a].cx), t0: now(), dur: 520 });
            addText(T.cx, T.cy, '突撃！', '#ffe08a', true);
            shake = Math.max(shake, 5);
            for (let k = 0; k < 14; k++) dust(T.cx + rand(-50, 50), T.cy + rand(-30, 30), 1.4);
          });
          break;
        case 'ambush':
          schedule(moveDur * 0.8, () => {
            const A = US[a];
            addText(A.cx, A.cy, '伏兵！', '#c8ff9a', true);
            shake = Math.max(shake, 4);
          });
          break;
        case 'fence':
          schedule(moveDur * 0.85, () => {
            const T = US[b];
            addText(T.cx, T.cy, '馬防柵！', '#ffffff', true);
            for (let k = 0; k < 12; k++) spark(T.cx + rand(-45, 45), T.cy + rand(-30, 30));
          });
          break;
        case 'yarisashi':
          schedule(moveDur * 0.85, () => {
            const T = US[b];
            addText(T.cx, T.cy, '槍衾', '#ffffff', true);
            for (let k = 0; k < 16; k++) spark(T.cx + rand(-45, 45), T.cy + rand(-30, 30));
          });
          break;
        case 'rout':
          schedule(turnDur * 0.92, () => addText(US[a].cx, US[a].cy, '潰走', '#ffd27a'));
          break;
        case 'recover':
          schedule(turnDur * 0.92, () => addText(US[a].cx, US[a].cy, '立て直し', '#d8ffd0'));
          break;
        case 'destroyed':
          schedule(turnDur * 0.95, () => {
            const U = US[a];
            addText(U.cx, U.cy, U.genus === 'dux' ? '大将討死' : '壊滅', '#ffffff', U.genus === 'dux');
            if (U.genus === 'dux') shake = Math.max(shake, 9);
          });
          break;
        case 'suddenDeath':
          addText(PW / 2, PH / 2, '決戦！', '#ffd34d', true);
          shake = Math.max(shake, 6);
          break;
        case 'result':
          break;
        default:
          break;
      }
    }

    // 兵が減る：近接・射撃の時間帯に少しずつ
    US.forEach((u) => {
      const live = u.soldiers.filter((s) => !s.dying).length;
      const n = wanted(u, u.d);
      const loss = live - n;
      if (loss <= 0) {
        if (loss < 0) ensureCount(u, n, false);
        return;
      }
      for (let k = 0; k < loss; k++) {
        schedule(rand(turnDur * 0.45, turnDur * 0.95), () => ensureCount(u, u.soldiers.filter((s) => !s.dying).length - 1, false));
      }
      if (!u.d.alive) schedule(turnDur * 0.97, () => { ensureCount(u, 0, false); u.fallen = true; });
    });
  }

  // 弓の一斉射・鉄砲の発砲
  function volley(A, B) {
    if (!A.soldiers.length) return;
    const from = A.soldiers.filter((s) => !s.dying);
    const to = B.soldiers.filter((s) => !s.dying);
    if (!from.length) return;
    const tx = (s) => (s ? s.x : B.cx);
    const ty = (s) => (s ? s.y : B.cy);
    if (A.genus === 'sagittarii') {
      const n = Math.min(26, 8 + from.length);
      for (let k = 0; k < n; k++) {
        const s = from[Math.floor(Math.random() * from.length)];
        const t = to[Math.floor(Math.random() * to.length)];
        parts.push({ type: 'arrow', x0: s.x, y0: s.y, x1: tx(t) + rand(-12, 12), y1: ty(t) + rand(-8, 8), h: rand(70, 120), t0: now() + rand(0, 160), dur: rand(520, 700) });
      }
    } else {
      const front = [...from].sort((a, b) => a.slot.dep - b.slot.dep).slice(0, Math.min(12, from.length));
      for (const s of front) {
        const t = to[Math.floor(Math.random() * to.length)];
        const d0 = rand(0, 90);
        parts.push({ type: 'flash', x: s.x + Math.cos(A.facing) * 8, y: s.y + Math.sin(A.facing) * 8, t0: now() + d0, dur: 120 });
        parts.push({ type: 'tracer', x0: s.x, y0: s.y, x1: tx(t), y1: ty(t), t0: now() + d0, dur: 110 });
        parts.push({ type: 'smoke', x: s.x + Math.cos(A.facing) * 12, y: s.y + Math.sin(A.facing) * 12, r: rand(8, 14), vx: rand(-6, 6), vy: rand(-8, -2), t0: now() + d0, dur: rand(1800, 2600) });
      }
      shake = Math.max(shake, 2);
    }
  }

  function dust(x, y, size = 1) {
    parts.push({ type: 'dust', x, y, r: rand(8, 16) * size, vx: rand(-10, 10), vy: rand(-12, -4), t0: now(), dur: rand(700, 1300) });
  }
  function spark(x, y) {
    parts.push({ type: 'spark', x, y, t0: now() + rand(0, 200), dur: 140, a: rand(0, Math.PI) });
  }

  // ---- 毎フレームの更新 ----
  let lastT = now();
  function step(t) {
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    // 予定の演出
    if (timeline.length) {
      const due = timeline.filter((e) => e.at <= t);
      if (due.length) {
        timeline = timeline.filter((e) => e.at > t);
        for (const e of due) e.fn();
      }
    }
    const p = turnDur > 0 ? clamp((t - turnStart) / (turnDur * 0.55), 0, 1) : 1;
    const pe = ease(p);
    // 部隊の中心
    for (const u of US) {
      u.cx = u.fx + (u.tx - u.fx) * pe;
      u.cy = u.fy + (u.ty - u.fy) * pe;
      u.facing = angleLerp(u.facing, u.faceTo, Math.min(1, dt * 5));
    }
    // 乱戦の相手（近い敵）
    for (const u of US) {
      u.enemy = null;
      if (!u.d || !u.d.alive || !u.d.on || u.d.routed) continue;
      let bd = ENGAGE_DIST * ENGAGE_DIST;
      for (const e of US) {
        if (e.side === u.side || !e.d || !e.d.alive || !e.d.on) continue;
        const dv = (e.cx - u.cx) ** 2 + (e.cy - u.cy) ** 2;
        if (dv < bd) { bd = dv; u.enemy = e; }
      }
    }
    // 兵
    for (const u of US) {
      const moving = Math.abs(u.tx - u.fx) + Math.abs(u.ty - u.fy) > 4 && p < 1;
      const front = Math.max(1, Math.ceil(u.rows * 0.65));
      for (const s of u.soldiers) {
        if (s.dying) continue;
        let [gx, gy] = slotPos(u, s, u.cx, u.cy, u.facing);
        if (u.enemy && s.slot.row < front) {
          // 乱戦：前列は敵との間へ飛び込み、入り乱れる
          const E = u.enemy;
          const mx = (u.cx + E.cx) / 2;
          const my = (u.cy + E.cy) / 2;
          const ax = E.cx - u.cx;
          const ay = E.cy - u.cy;
          const len = Math.hypot(ax, ay) || 1;
          const px = -ay / len;
          const py = ax / len;
          if (t > s.next) {
            s.next = t + rand(300, 900);
            s.jx = rand(-16, 16);
            s.jy = rand(-16, 16);
            s.ma = rand(-1, 1);
          }
          const back = -12 + s.slot.row * 10; // 自軍側へ少し寄る
          gx = mx + px * s.mo * 70 + (ax / len) * (s.ma * 22 - back) + s.jx;
          gy = my + py * s.mo * 70 + (ay / len) * (s.ma * 22 - back) + s.jy;
          if (Math.random() < dt * 0.6) spark(gx, gy);
        } else if (u.d && u.d.routed) {
          if (t > s.next) {
            s.next = t + rand(400, 1000);
            s.jx = rand(-40, 40);
            s.jy = rand(-40, 40);
          }
          gx = u.cx + (gx - u.cx) * 1.8 + s.jx;
          gy = u.cy + (gy - u.cy) * 1.8 + s.jy;
        }
        const k = Math.min(1, dt * s.k * (moving ? 1.6 : 1));
        s.x += (gx - s.x) * k;
        s.y += (gy - s.y) * k;
      }
      // 動いている部隊の砂ぼこり
      if (moving && u.soldiers.length && Math.random() < dt * (u.genus === 'equites' ? 22 : 5)) {
        const s = u.soldiers[Math.floor(Math.random() * u.soldiers.length)];
        dust(s.x - Math.cos(u.facing) * 10, s.y - Math.sin(u.facing) * 10, u.genus === 'equites' ? 1 : 0.6);
      }
      if (u.enemy && Math.random() < dt * 4) dust((u.cx + u.enemy.cx) / 2 + rand(-50, 50), (u.cy + u.enemy.cy) / 2 + rand(-30, 30), 0.9);
      // 消えた兵を片づける
      u.soldiers = u.soldiers.filter((s) => !(s.dying > 0 && t - s.dying > 450));
    }
    // 粒子
    parts = parts.filter((q) => t < q.t0 + q.dur);
    texts = texts.filter((q) => t < q.t0 + q.dur);
    shake *= Math.pow(0.02, dt);
    draw(t);
  }

  // ---- 描画 ----
  function drawSoldier(g, s, u, t, x, y, sc, alpha) {
    const z = 21 * sc; // 身長
    const side = SIDE[u.side];
    const fight = !!u.enemy;
    const flip = Math.cos(u.facing) < 0 ? -1 : 1;
    let bob = Math.sin(t / 160 + s.ph) * 0.6;
    let lunge = 0;
    if (fight) {
      bob = Math.sin(t / 70 + s.ph) * 1.2;
      lunge = Math.sin(t / 90 + s.ph * 2) * 1.6 * flip;
    }
    const X = x + lunge;
    const Y = y + bob;
    g.globalAlpha = alpha;
    // 影
    g.fillStyle = 'rgba(30,20,5,0.28)';
    g.beginPath();
    g.ellipse(x, y, z * 0.38, z * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    const routed = u.d && u.d.routed;
    const body = routed ? side.light : side.main;
    if (u.genus === 'equites') {
      // 馬
      g.fillStyle = '#5a3a22';
      g.beginPath();
      g.ellipse(X, Y - z * 0.42, z * 0.48, z * 0.2, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(X + flip * z * 0.32 - z * 0.08, Y - z * 0.75, z * 0.16, z * 0.32);
      g.strokeStyle = '#3c2614';
      g.lineWidth = Math.max(1, z * 0.07);
      g.beginPath();
      g.moveTo(X - z * 0.3, Y - z * 0.3);
      g.lineTo(X - z * 0.32, Y);
      g.moveTo(X + z * 0.3, Y - z * 0.3);
      g.lineTo(X + z * 0.32, Y);
      g.stroke();
      // 騎手
      g.fillStyle = body;
      g.fillRect(X - z * 0.14, Y - z * 1.05, z * 0.28, z * 0.42);
      g.fillStyle = SKIN;
      g.beginPath();
      g.arc(X, Y - z * 1.15, z * 0.12, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ddd';
      g.lineWidth = Math.max(1, z * 0.06);
      g.beginPath();
      g.moveTo(X, Y - z * 0.85);
      g.lineTo(X + flip * z * 0.75, Y - z * 1.25);
      g.stroke();
    } else {
      g.fillStyle = body;
      g.fillRect(X - z * 0.2, Y - z * 0.78, z * 0.4, z * 0.62);
      g.fillStyle = side.dark;
      g.fillRect(X - z * 0.2, Y - z * 0.2, z * 0.4, z * 0.2);
      g.fillStyle = SKIN;
      g.beginPath();
      g.arc(X, Y - z * 0.92, z * 0.15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = side.dark; // 陣笠
      g.beginPath();
      g.moveTo(X - z * 0.24, Y - z * 0.95);
      g.lineTo(X, Y - z * 1.14);
      g.lineTo(X + z * 0.24, Y - z * 0.95);
      g.closePath();
      g.fill();
      if (u.genus === 'dux') {
        g.fillStyle = '#f2c230'; // 金の前立て
        g.beginPath();
        g.moveTo(X - z * 0.22, Y - z * 1.2);
        g.lineTo(X, Y - z * 1.08);
        g.lineTo(X + z * 0.22, Y - z * 1.2);
        g.lineTo(X, Y - z * 1.0);
        g.closePath();
        g.fill();
        g.fillRect(X - z * 0.2, Y - z * 0.5, z * 0.4, z * 0.08);
      }
      g.lineWidth = Math.max(1, z * 0.07);
      if (u.genus === 'hastati') {
        g.strokeStyle = '#d9d2c0';
        g.beginPath();
        g.moveTo(X + flip * z * 0.15, Y - z * 0.4);
        g.lineTo(X + flip * z * 0.65, Y - z * 1.6);
        g.stroke();
      } else if (u.genus === 'pedites' || u.genus === 'dux') {
        g.strokeStyle = '#e8e8e8';
        g.beginPath();
        g.moveTo(X + flip * z * 0.18, Y - z * 0.5);
        g.lineTo(X + flip * z * 0.48, Y - z * 0.9);
        g.stroke();
      } else if (u.genus === 'sagittarii') {
        g.strokeStyle = '#7a4a1e';
        g.beginPath();
        g.arc(X + flip * z * 0.22, Y - z * 0.6, z * 0.36, -Math.PI / 2, Math.PI / 2, flip < 0);
        g.stroke();
      } else if (u.genus === 'sclopetarii') {
        g.strokeStyle = '#2a1e12';
        g.beginPath();
        g.moveTo(X - flip * z * 0.05, Y - z * 0.55);
        g.lineTo(X + flip * z * 0.6, Y - z * 0.62);
        g.stroke();
      }
    }
    if (s.flag) {
      g.strokeStyle = '#3a2a14';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X - flip * z * 0.12, Y - z * 0.5);
      g.lineTo(X - flip * z * 0.12, Y - z * 1.9);
      g.stroke();
      g.fillStyle = side.flag;
      const wv = Math.sin(t / 200 + s.ph) * z * 0.05;
      g.fillRect(X - flip * z * 0.12 - (flip < 0 ? 0 : z * 0.32), Y - z * 1.9 + wv, z * 0.32, z * 0.5);
    }
    g.globalAlpha = 1;
  }

  function drawTree(g, tr) {
    const [x, y] = proj(tr.x, tr.y);
    const sc = scaleAt(tr.y);
    const r = tr.r * sc;
    g.fillStyle = 'rgba(20,30,10,0.3)';
    g.beginPath();
    g.ellipse(x, y, r * 1.1, r * 0.4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#4a3420';
    g.fillRect(x - r * 0.12, y - r * 0.9, r * 0.24, r * 0.9);
    g.fillStyle = tr.tone < 0.5 ? '#3d6a2c' : '#4f7d34';
    g.beginPath();
    g.arc(x, y - r * 1.4, r * 0.85, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,200,110,0.35)';
    g.beginPath();
    g.arc(x - r * 0.25, y - r * 1.65, r * 0.4, 0, Math.PI * 2);
    g.fill();
  }

  // 本陣の陣幕：本陣のマスを三方から囲う布の壁
  function drawCamp(g, c) {
    const side = SIDE[c.side];
    const cs = BASE_CELLS[c.side];
    const x0 = Math.min(...cs.map((q) => q[0])) * CELL + 6;
    const x1 = (Math.max(...cs.map((q) => q[0])) + 1) * CELL - 6;
    const y0 = Math.min(...cs.map((q) => q[1])) * CELL + 6;
    const y1 = (Math.max(...cs.map((q) => q[1])) + 1) * CELL - 6;
    const back = c.side === 'W' ? x0 : x1;
    const front = c.side === 'W' ? x1 : x0;
    const walls = [[[front, y0], [back, y0]], [[back, y0], [back, y1]], [[back, y1], [front, y1]]];
    for (const [[ax, ay], [bx, by]] of walls) {
      const [sx0, sy0] = proj(ax, ay);
      const [sx1, sy1] = proj(bx, by);
      const h0 = 16 * scaleAt(ay) / 0.55;
      const h1 = 16 * scaleAt(by) / 0.55;
      g.fillStyle = '#f4efe2';
      g.beginPath();
      g.moveTo(sx0, sy0);
      g.lineTo(sx1, sy1);
      g.lineTo(sx1, sy1 - h1);
      g.lineTo(sx0, sy0 - h0);
      g.closePath();
      g.fill();
      g.strokeStyle = side.dark;
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = side.flag;
      g.beginPath();
      g.moveTo(sx0, sy0 - h0 * 0.62);
      g.lineTo(sx1, sy1 - h1 * 0.62);
      g.lineTo(sx1, sy1 - h1 * 0.38);
      g.lineTo(sx0, sy0 - h0 * 0.38);
      g.closePath();
      g.fill();
    }
  }

  function drawBanner(g, u, t) {
    const [x, y] = proj(u.cx, u.cy);
    const sc = clamp(scaleAt(u.cy) / 0.55, 0.65, 1.4);
    const side = SIDE[u.side];
    const d = u.d;
    const twin = u.bu.twin;
    const poleH = (twin ? 34 : 44) * sc;
    const fw = (twin ? 14 : 18) * sc;
    const fh = (twin ? 18 : 24) * sc;
    const topY = y - poleH - 10 * sc;
    const lean = d.routed ? -0.35 : 0;
    g.save();
    g.translate(x, y - 6 * sc);
    g.rotate(lean);
    g.strokeStyle = '#2e2010';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -poleH);
    g.stroke();
    const wv = Math.sin(t / 260 + u.i) * 1.5 * sc;
    g.fillStyle = d.routed ? '#9a8f7c' : side.flag;
    g.beginPath();
    g.moveTo(0, -poleH);
    g.lineTo(fw, -poleH + wv);
    g.lineTo(fw, -poleH + fh + wv);
    g.lineTo(0, -poleH + fh);
    g.closePath();
    g.fill();
    g.strokeStyle = u.genus === 'dux' ? '#f2c230' : 'rgba(0,0,0,0.35)';
    g.lineWidth = u.genus === 'dux' ? 2.5 : 1;
    g.stroke();
    g.fillStyle = u.genus === 'dux' ? '#f2c230' : '#fff';
    g.font = `bold ${Math.round(13 * sc)}px 'Shippori Mincho', serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(STATS[u.genus].kanji, fw / 2, -poleH + fh / 2 + wv / 2);
    if (twin) {
      g.fillStyle = '#fffaf0';
      g.fillRect(fw + 1, -poleH + fh - 10 * sc, 11 * sc, 11 * sc);
      g.fillStyle = '#222';
      g.font = `bold ${Math.round(9 * sc)}px sans-serif`;
      g.fillText('守', fw + 1 + 5.5 * sc, -poleH + fh - 4.5 * sc);
    }
    if (d.hid) {
      g.fillStyle = 'rgba(40,70,30,0.9)';
      g.fillRect(-14 * sc, -poleH, 12 * sc, 12 * sc);
      g.fillStyle = '#e8ffd8';
      g.font = `bold ${Math.round(9 * sc)}px sans-serif`;
      g.fillText('伏', -8 * sc, -poleH + 6 * sc);
    }
    g.restore();
    // 兵力バー（旗の上）
    const bw = 36 * sc;
    const bh = 4.5 * sc;
    const frac = d.mx > 0 ? d.troops / d.mx : 0;
    const bx = x - bw / 2;
    const by = topY - 6 * sc;
    g.fillStyle = 'rgba(20,15,5,0.7)';
    g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    g.fillStyle = frac > 0.5 ? (u.side === 'W' ? '#5aa0ff' : '#ff6a5a') : frac > 0.25 ? '#e6b030' : '#e05030';
    g.fillRect(bx, by, bw * frac, bh);
    // 士気が低い：バーの横に「!」
    if (d.morale <= 40 && !d.routed) {
      g.fillStyle = '#ffcc33';
      g.font = `bold ${Math.round(12 * sc)}px sans-serif`;
      g.textAlign = 'left';
      g.fillText('!', bx + bw + 3, by + bh);
    }
    // いま動いている条（丸数字）
    if (d.rule > 0) {
      g.fillStyle = '#1f1c18';
      g.beginPath();
      g.arc(x - 9 * sc, topY + 8 * sc, 7 * sc, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `${Math.round(10 * sc)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      // 基本命令で動いているときは「基」、追加命令（決戦では全体指揮）は丸数字
      g.fillText(frameIdx <= 30 && d.rule > (u.bu.baseFrom || 0) ? '基' : CIRCLED[d.rule], x - 9 * sc, topY + 8.5 * sc);
    }
    if (u.i === selected) {
      g.strokeStyle = '#ffd34d';
      g.lineWidth = 2;
      g.strokeRect(bx - 3, by - 3, bw + 6, bh + 6);
    }
  }

  function drawLines(g) {
    for (const u of US) {
      const d = u.d;
      if (!d || !d.alive || !d.on) continue;
      const act = d.act;
      let tx = null;
      let ty = null;
      if (d.tgt >= 0 && US[d.tgt].d && US[d.tgt].d.alive) {
        tx = US[d.tgt].cx;
        ty = US[d.tgt].cy;
      } else if (act === 'recedere' || act === 'ire') {
        const vx = u.tx - u.fx;
        const vy = u.ty - u.fy;
        const len = Math.hypot(vx, vy);
        if (len < 5) continue;
        tx = u.cx + (vx / len) * 160;
        ty = u.cy + (vy / len) * 160;
      }
      if (tx === null) continue;
      const side = SIDE[u.side];
      const vx = tx - u.cx;
      const vy = ty - u.cy;
      const len = Math.hypot(vx, vy);
      if (len < 40) continue;
      const ex = tx - (vx / len) * 30;
      const ey = ty - (vy / len) * 30;
      const [x0, y0] = proj(u.cx, u.cy);
      const [x1, y1] = proj(ex, ey);
      g.save();
      g.strokeStyle = act === 'recedere' ? 'rgba(240,220,120,0.8)' : side.line;
      g.lineWidth = act === 'impetus' ? 3 : act === 'ferire' ? 1.2 : 2;
      if (act === 'ferire') g.setLineDash([3, 5]);
      else if (act === 'circumire') g.setLineDash([8, 5]);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      g.setLineDash([]);
      // 矢じり
      const a = Math.atan2(y1 - y0, x1 - x0);
      const ah = act === 'impetus' ? 10 : 7;
      g.fillStyle = g.strokeStyle;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x1 - Math.cos(a - 0.45) * ah, y1 - Math.sin(a - 0.45) * ah);
      g.lineTo(x1 - Math.cos(a + 0.45) * ah, y1 - Math.sin(a + 0.45) * ah);
      g.closePath();
      g.fill();
      g.restore();
    }
  }

  function drawParts(g, t) {
    for (const q of parts) {
      if (t < q.t0) continue;
      const p = (t - q.t0) / q.dur;
      switch (q.type) {
        case 'dust':
        case 'smoke': {
          const x = q.x + q.vx * p * 3;
          const y = q.y + q.vy * p * 3;
          const [sx, sy] = proj(x, y);
          const sc = scaleAt(y);
          const r = q.r * (1 + p * (q.type === 'smoke' ? 2.2 : 1.2)) * sc;
          const a = (1 - p) * (q.type === 'smoke' ? 0.55 : 0.35);
          g.fillStyle = q.type === 'smoke' ? `rgba(235,235,230,${a})` : `rgba(170,140,90,${a})`;
          g.beginPath();
          g.arc(sx, sy - r * 0.6 - p * 10, r, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'arrow': {
          const x = q.x0 + (q.x1 - q.x0) * p;
          const y = q.y0 + (q.y1 - q.y0) * p;
          const [sx, sy0] = proj(x, y);
          const lift = Math.sin(Math.PI * p) * q.h * scaleAt(y);
          const sy = sy0 - lift - 8 * scaleAt(y);
          const p2 = Math.max(0, p - 0.04);
          const [px, py0] = proj(q.x0 + (q.x1 - q.x0) * p2, q.y0 + (q.y1 - q.y0) * p2);
          const py = py0 - Math.sin(Math.PI * p2) * q.h * scaleAt(y) - 8 * scaleAt(y);
          g.strokeStyle = 'rgba(40,25,10,0.85)';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(px, py);
          g.lineTo(sx, sy);
          g.stroke();
          break;
        }
        case 'tracer': {
          const [x0, y0] = proj(q.x0, q.y0);
          const [x1, y1] = proj(q.x1, q.y1);
          g.strokeStyle = `rgba(255,240,180,${1 - p})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(x0 + (x1 - x0) * p * 0.6, y0 - 8 + (y1 - y0) * p * 0.6);
          g.lineTo(x0 + (x1 - x0) * Math.min(1, p * 0.6 + 0.4), y0 - 8 + (y1 - y0) * Math.min(1, p * 0.6 + 0.4));
          g.stroke();
          break;
        }
        case 'flash': {
          const [sx, sy] = proj(q.x, q.y);
          g.fillStyle = `rgba(255,230,120,${1 - p})`;
          g.beginPath();
          g.arc(sx, sy - 8, 5 * (1 - p) + 2, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'spark': {
          const [sx, sy] = proj(q.x, q.y);
          const r = 4 + p * 3;
          g.strokeStyle = `rgba(255,250,220,${1 - p})`;
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(sx - Math.cos(q.a) * r, sy - 10 - Math.sin(q.a) * r);
          g.lineTo(sx + Math.cos(q.a) * r, sy - 10 + Math.sin(q.a) * r);
          g.moveTo(sx - Math.sin(q.a) * r, sy - 10 + Math.cos(q.a) * r);
          g.lineTo(sx + Math.sin(q.a) * r, sy - 10 - Math.cos(q.a) * r);
          g.stroke();
          break;
        }
        case 'arc': {
          const [sx, sy] = proj(q.x, q.y);
          const sc = scaleAt(q.y);
          const R = 80 * sc;
          const sweep = Math.PI * 1.1 * Math.min(1, p * 1.8);
          const start = q.ang + Math.PI - 0.5;
          g.strokeStyle = q.side === 'W' ? `rgba(120,170,255,${1 - p})` : `rgba(255,70,50,${1 - p})`;
          g.lineWidth = 7 * (1 - p) + 2;
          g.beginPath();
          g.ellipse(sx, sy - 8, R, R * TILT, 0, start, start + sweep);
          g.stroke();
          break;
        }
        default:
          break;
      }
    }
  }

  function drawTexts(g, t) {
    for (const q of texts) {
      const p = (t - q.t0) / q.dur;
      const [sx, sy] = proj(q.x, q.y);
      const size = q.big ? 22 : 15;
      g.font = `bold ${size}px 'Shippori Mincho', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const y = sy - 70 - p * 26;
      g.globalAlpha = p < 0.8 ? 1 : (1 - p) / 0.2;
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(20,10,0,0.75)';
      g.strokeText(q.text, sx, y);
      g.fillStyle = q.color;
      g.fillText(q.text, sx, y);
      g.globalAlpha = 1;
    }
  }

  let rainOn = false;
  const drops = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), l: rand(8, 16) }));

  function draw(t) {
    if (!ctx) return;
    const g = ctx;
    g.save();
    g.clearRect(0, 0, cssW, cssH);
    if (shake > 0.3) g.translate(rand(-shake, shake), rand(-shake, shake));
    if (bg) g.drawImage(bg, 0, 0, cssW, cssH);
    // 討死した部隊の倒れた旗（地面）
    for (const u of US) {
      if (!u.fallen) continue;
      const [x, y] = proj(u.cx, u.cy);
      const sc = clamp(scaleAt(u.cy) / 0.55, 0.65, 1.4);
      g.save();
      g.translate(x, y);
      g.rotate(-1.25);
      g.strokeStyle = '#3a2a14';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -36 * sc);
      g.stroke();
      g.fillStyle = u.side === 'W' ? 'rgba(60,80,130,0.75)' : 'rgba(140,60,50,0.75)';
      g.fillRect(0, -36 * sc, 14 * sc, 18 * sc);
      g.restore();
    }
    // 選択中の部隊：足元の輪
    if (selected >= 0 && US[selected].d && US[selected].d.alive) {
      const u = US[selected];
      const [x, y] = proj(u.cx, u.cy);
      const sc = scaleAt(u.cy);
      g.strokeStyle = `rgba(255,210,60,${0.6 + Math.sin(t / 200) * 0.3})`;
      g.lineWidth = 2.5;
      g.beginPath();
      g.ellipse(x, y, 80 * sc, 80 * sc * TILT, 0, 0, Math.PI * 2);
      g.stroke();
    }
    // 奥行き順に：木・陣幕・兵
    const items = [];
    for (const tr of trees) items.push({ y: tr.y, k: 0, o: tr });
    for (const c of camps) items.push({ y: c.y - 120, k: 1, o: c });
    for (const pr of props) items.push({ y: pr.y - 10, k: 3, o: pr });
    for (const u of US) for (const s of u.soldiers) items.push({ y: s.y, k: 2, o: s, u });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.k === 0) drawTree(g, it.o);
      else if (it.k === 1) drawCamp(g, it.o);
      else if (it.k === 3) drawProp(g, it.o);
      else {
        const s = it.o;
        const [x, y] = proj(s.x, s.y);
        let alpha = 1;
        let sc = scaleAt(s.y) / 0.55;
        if (s.dying) {
          const q = clamp((t - s.dying) / 450, 0, 1);
          alpha = 1 - q;
          sc *= 1 - q * 0.4;
        }
        if (it.u.d && it.u.d.routed) alpha *= 0.85;
        if (it.u.d && it.u.d.hid) alpha *= 0.5; // 森に伏せている（敵からは見えない）
        drawSoldier(g, s, it.u, t, x, y, sc * 0.55, alpha);
      }
    }
    drawParts(g, t);
    if (showLines) drawLines(g);
    // 旗（手前ほど後に）
    const flags = US.filter((u) => u.d && u.d.on && u.d.alive).sort((a, b) => a.cy - b.cy);
    for (const u of flags) drawBanner(g, u, t);
    drawTexts(g, t);
    // 雨
    if (rainOn) {
      g.fillStyle = 'rgba(60,80,100,0.12)';
      g.fillRect(0, 0, cssW, cssH);
      g.strokeStyle = 'rgba(200,220,240,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      for (const d of drops) {
        const yy = ((d.y + t / 900) % 1) * cssH;
        const xx = ((d.x + t / 5000) % 1) * cssW;
        g.moveTo(xx, yy);
        g.lineTo(xx - 4, yy + d.l);
      }
      g.stroke();
    }
    g.restore();
  }

  // ---- クリックで部隊を選ぶ ----
  canvas.addEventListener('click', (ev) => {
    const r = canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    let best = -1;
    let bd = 34 * 34;
    US.forEach((u, i) => {
      if (!u.d || !u.d.on || !u.d.alive) return;
      const [x, y] = proj(u.cx, u.cy);
      for (const yy of [y, y - 40]) {
        const dv = (x - mx) ** 2 + (yy - my) ** 2;
        if (dv < bd) { bd = dv; best = i; }
      }
    });
    if (best >= 0 && onSelect) onSelect(best);
  });

  // ---- ループ ----
  let raf = 0;
  let alive = true;
  function loop(t) {
    if (!alive) return;
    try {
      step(t);
    } catch (e) {
      // 演出の不具合で再生が止まらないよう、描画のエラーは握りつぶして次のフレームへ
      if (typeof console !== 'undefined') console.warn('board', e);
    }
    raf = requestAnimationFrame(loop);
  }
  let ro = null;
  if (ctx) {
    resize();
    if (typeof ResizeObserver !== 'undefined') {
      let lastW = 0;
      ro = new ResizeObserver(() => {
        const w = Math.floor(container.clientWidth);
        if (w && Math.abs(w - lastW) > 2) {
          lastW = w;
          resize();
        }
      });
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }
    if (typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
  }

  function updatePublic(frame, animate) {
    update(frame, animate);
    rainOn = battle.turns[frame].weather === 'pluvia';
  }

  return {
    update: updatePublic,
    select(i) { selected = i; },
    setMoveMs(ms) { turnDur = Math.max(120, ms); },
    el: wrap,
    destroy() {
      alive = false;
      if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      wrap.remove();
    },
  };
}
