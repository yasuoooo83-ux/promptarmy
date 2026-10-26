// 合戦シミュレーション。DOM・Firebaseに依存しない純粋な計算。
// 決定論の約束：整数演算のみ／乱数は自前のシード付き乱数／走査順は部隊 ord 昇順に固定。
// 位置は連続座標（1マス=100の整数）。部隊は盤の上を自由に動き、互いに重ならないよう押し合う。
import { makeRng, hashString } from './rng.js';
import { ENGINE_VERSION } from './version.js';
import {
  W, H, N, TERRAIN, COST, SLOT_POS, BASE_CELLS, DIRS_BY_SIDE, INF, CELL, PW, PH, SPEED_PCT,
  dist, dist2, isqrt, reach, dijkstra, otherSide, cellIdx, cellCenter, terrainOfPos, baseAtPos,
} from './map.js';
import { STATS, MAX_TURNS, TUNING, matchup, isRanged } from './units.js';
import { weatherAt } from './weather.js';
import { decide, holdDecision, DEFAULT_ORDER } from './orders.js';
import { normItem, itemCells } from './items.js';

export const MORALE_MAX = 70;
export const ROUT_AT = 20;
export const RECOVER_AT = 40;
export const BASE_HOLD_TURNS = 3;
export const SD_TURNS = TUNING.sdTurns; // 決戦（サドンデス）の最大ターン数

// 空間まわりの定数（単位は座標。100 = 1マス）
export const SEP = 70; // 部隊どうしが保つ最小の間隔（これより近いと押し合う）
export const CONTACT = reach(1); // 近接戦闘が届く距離
const STOP_AT = 100; // 目標にこの距離まで近づいたら止まる
const SUB = 25; // 1小歩で進む距離（平地）
const SUBS_PER_CELL = 4;
const MARGIN = 30; // 盤の縁から部隊の中心までの余白
const CAV_CHARGE = 200;

// 1ターンの小歩の数（移動1の兵種は TUNING.footSpeedPct で速さを変えられる）
// 決戦中は急行軍（TUNING.sdSpeedPct）で、にらみ合いをすぐ終わらせる
function subsOf(genus, sd) {
  const mv = STATS[genus].move;
  const base = mv === 1 ? Math.round((SUBS_PER_CELL * TUNING.footSpeedPct) / 100) : mv * SUBS_PER_CELL;
  return sd ? Math.round((base * TUNING.sdSpeedPct) / 100) : base;
}

// ダメージ計算（整数のみ）。mods は「各種補正」（％）の配列で、先頭から順に適用する。
export function calcDamage(rng, atk, troops, def, matchupPct, mods) {
  let m = 100;
  m = Math.floor((m * matchupPct) / 100);
  for (const p of mods) m = Math.floor((m * p) / 100);
  const base = Math.floor((atk * troops * m * (100 - def * 3)) / 1000000);
  const jitter = 90 + rng.int(21);
  return Math.max(1, Math.floor((base * jitter) / 100));
}

// 勝敗判定（純粋関数）
export function evaluateEnd(s) {
  if (s.wDuxDead && s.eDuxDead) return { winner: 'draw', reason: 'dux' };
  if (s.eDuxDead) return { winner: 'W', reason: 'dux' };
  if (s.wDuxDead) return { winner: 'E', reason: 'dux' };
  const wh = s.holdsW >= BASE_HOLD_TURNS;
  const eh = s.holdsE >= BASE_HOLD_TURNS;
  if (wh && eh) return { winner: 'draw', reason: 'base' };
  if (wh) return { winner: 'W', reason: 'base' };
  if (eh) return { winner: 'E', reason: 'base' };
  if (s.turn >= (s.maxTurn || MAX_TURNS)) {
    if (s.ratioW > s.ratioE) return { winner: 'W', reason: 'time' };
    if (s.ratioE > s.ratioW) return { winner: 'E', reason: 'time' };
    return { winner: 'draw', reason: 'time' };
  }
  return null;
}

// 軍令に「割合で分ける条」があるか（あれば守備隊の枠を用意する）
function hasSplitRule(order) {
  if (!order || !Array.isArray(order.iussa)) return false;
  return order.iussa.some(
    (r) => r.fac && r.fac.pars > 0 && r.fac.pars < 100 && r.fac.actio !== 'exspectare' && r.fac.actio !== 'recedere',
  );
}

function mkUnit(o) {
  return {
    troops: 0, maxTroops: 0, morale: MORALE_MAX, alive: false, on: false, routed: false, reload: 0,
    moved: 0, cvoid: 0, inMelee: 0, lostT: 0, gunHit: 0, fired: 0, dealtT: 0, takenT: 0,
    dealt: 0, taken: 0, deadTurn: 0, ruleCount: [0, 0, 0, 0, 0, 0], defaultCount: 0,
    twin: false, parent: '', hidden: false, hiddenStart: false, ambushed: 0, ambushTurns: 0, ambushUsed: 0,
    ...o,
  };
}

function buildUnits(slots, orders, placement) {
  const list = [];
  for (const side of ['W', 'E']) {
    for (let i = 0; i <= 6; i++) {
      const id = side + i;
      const sl = slots[id];
      const genus = i === 0 ? 'dux' : sl && sl.genus;
      if (!genus || !STATS[genus]) continue;
      if (i > 0 && genus === 'dux') continue;
      const st = STATS[genus];
      const pos = (placement && placement[id]) || SLOT_POS[side][i];
      const ord = i * 2 + (side === 'E' ? 1 : 0);
      list.push(mkUnit({
        id, side, slot: i, ord, genus,
        owner: (sl && sl.owner) || '',
        x: pos[0] * CELL + CELL / 2, y: pos[1] * CELL + CELL / 2,
        sx: pos[0] * CELL + CELL / 2, sy: pos[1] * CELL + CELL / 2, // 布陣の位置（決戦で戻る）
        troops: st.troops, maxTroops: st.troops, alive: true, on: true,
      }));
      // 割合で部隊を分ける軍令があれば、守備隊の枠を用意する（最初は戦場にいない）
      if (i > 0 && hasSplitRule(orders[id])) {
        list.push(mkUnit({
          id: id + 'g', side, slot: i, ord: 20 + ord, genus,
          owner: (sl && sl.owner) || '',
          x: pos[0] * CELL + CELL / 2, y: pos[1] * CELL + CELL / 2,
          sx: pos[0] * CELL + CELL / 2, sy: pos[1] * CELL + CELL / 2,
          twin: true, parent: id,
        }));
      }
    }
  }
  list.sort((a, b) => a.ord - b.ord);
  list.forEach((u, i) => { u.i = i; });
  return list;
}

// 整数ベクトルを長さ len に揃える（0方向へ切り捨て。点対称に保つため trunc を使う）
function norm(dx, dy, len) {
  const d = isqrt(dx * dx + dy * dy);
  if (d === 0) return [0, 0];
  return [Math.trunc((dx * len) / d), Math.trunc((dy * len) / d)];
}

const clampX = (x) => (x < MARGIN ? MARGIN : x > PW - MARGIN ? PW - MARGIN : x);
const clampY = (y) => (y < MARGIN ? MARGIN : y > PH - MARGIN ? PH - MARGIN : y);

// 回り込みの候補点（目標の周り8方向）。東軍は点対称の順序。
const FLANK_W = [[-100, 0], [0, -100], [100, 0], [0, 100], [-70, -70], [70, -70], [70, 70], [-70, 70]];
const FLANK_BY_SIDE = { W: FLANK_W, E: FLANK_W.map((p) => [-p[0], -p[1]]) };

const NOBLOCK = new Uint8Array(N);
const BASE_CENTER = { W: [50, 500], E: [PW - 50, 500] };
const BASE_GUARD = 220; // 本陣を守っているとみなす距離（約2マス）

// 地形コストを考えた「次に向かう点」。まっすぐ行ける所はまっすぐ、川は橋へ迂回する。
function aimPoint(u, gx, gy) {
  const s = cellIdx(u.x, u.y);
  const g = cellIdx(gx, gy);
  if (s === g) return [gx, gy];
  const { dist: dd, pred } = dijkstra(s, NOBLOCK, DIRS_BY_SIDE[u.side]);
  if (dd[g] >= INF) return [gx, gy];
  const path = [];
  for (let c = g, guard = 0; c !== s && c >= 0 && guard <= N; c = pred[c], guard++) path.push(c);
  path.reverse();
  const limit = Math.min(path.length, 8);
  const pmax = [];
  let m = COST[s];
  for (let k = 0; k < limit; k++) {
    if (COST[path[k]] > m) m = COST[path[k]];
    pmax.push(m);
  }
  for (let k = limit; k >= 1; k--) {
    const last = k === path.length;
    const [px, py] = last ? [gx, gy] : cellCenter(path[k - 1]);
    if (lineClear(u.x, u.y, px, py, pmax[k - 1])) return [px, py];
  }
  return cellCenter(path[0]);
}

// 線分の途中に、maxCost より通りにくい地形がないか
function lineClear(ax, ay, bx, by, maxCost) {
  const len = dist(ax, ay, bx, by);
  const n = Math.ceil(len / 20);
  for (let i = 1; i <= n; i++) {
    const x = ax + Math.trunc(((bx - ax) * i) / n);
    const y = ay + Math.trunc(((by - ay) * i) / n);
    if (COST[cellIdx(x, y)] > maxCost) return false;
  }
  return true;
}

// 合戦を最後まで計算する。
// cfg = { seed, slots:{W1:{genus,owner}}, orders:{W1:正規化済み軍令}, placement?（マス座標）, setup?,
//         suddenDeath?: true なら30ターンで決着しないとき「決戦」へ,
//         commands?: { W: 全体指揮, E: 全体指揮 }（決戦の軍令。両軍の全部隊がこれに従う） }
// suddenDeath が true で commands が無いとき、30ターンで決着しなければ result.reason = 'pending' で止まる。
// commands を渡して同じ設定で計算し直すと、30ターン目までは同じ記録になり、31ターン目から決戦が続く。
export function simulate(cfg) {
  const seed = cfg.seed >>> 0;
  const orders = cfg.orders || {};
  const sudden = !!cfg.suddenDeath;
  const cmds = sudden && cfg.commands && cfg.commands.W && cfg.commands.E ? cfg.commands : null;
  const lastTurn = cmds ? MAX_TURNS + TUNING.sdTurns : MAX_TURNS;
  const sdCount = { W: { ruleCount: [0, 0, 0, 0, 0, 0], defaultCount: 0 }, E: { ruleCount: [0, 0, 0, 0, 0, 0], defaultCount: 0 } };
  const rng = makeRng(seed);
  const units = buildUnits(cfg.slots || {}, orders, cfg.placement);
  if (cfg.setup) cfg.setup(units);
  // ---- 道具（各軍1つ） ----
  const items = { W: normItem('W', cfg.items && cfg.items.W), E: normItem('E', cfg.items && cfg.items.E) };
  const fort = { W: new Set(), E: new Set() }; // 石垣のマス
  const fence = { W: new Set(), E: new Set() }; // 馬防柵のマス
  const tower = { W: null, E: null }; // 物見櫓の位置
  const drum = { W: false, E: false }; // 陣太鼓
  for (const side of ['W', 'E']) {
    const it = items[side];
    if (!it) continue;
    if (it.type === 'ishigaki') fort[side] = new Set(itemCells(side, it));
    else if (it.type === 'babosaku') fence[side] = new Set(itemCells(side, it));
    else if (it.type === 'yagura') tower[side] = [it.x * CELL + CELL / 2, it.y * CELL + CELL / 2];
    else if (it.type === 'taiko') drum[side] = true;
  }
  const onOwn = (sets, u) => sets[u.side].has(cellIdx(u.x, u.y));
  // 敵の石垣・柵の上は進みにくい（％）
  const obstacle = (u) => {
    const c = cellIdx(u.x, u.y);
    const o = otherSide(u.side);
    return fort[o].has(c) ? TUNING.wallSlowPct : fence[o].has(c) ? TUNING.fenceSlowPct : 100;
  };
  const towerSees = (side, e) => {
    const tw = tower[side];
    const r = reach(TUNING.towerRevealCells);
    return !!tw && dist2(tw[0], tw[1], e.x, e.y) <= r * r;
  };

  // 森に布陣した部隊は、最初から伏兵（敵から見えない）
  for (const u of units) {
    u.hidden = u.alive && terrainOfPos(u.x, u.y) === 'silva';
    if (u.hidden) u.ambushTurns = 2;
  }
  const orderOf = (u) => orders[u.id] || DEFAULT_ORDER;
  const twinOf = new Map();
  units.forEach((u) => { if (u.twin) twinOf.set(u.parent, u); });
  const initTotal = { W: 0, E: 0 };
  units.forEach((u) => { initTotal[u.side] += u.maxTroops; });
  const initMax = units.map((u) => u.maxTroops);
  const holds = { W: 0, E: 0 };

  const snapshot = (t, weather, events, dec) => ({
    t,
    weather,
    holds: { W: holds.W, E: holds.E },
    events,
    units: units.map((u) => {
      const d = dec && dec[u.i];
      return {
        x: u.x, y: u.y, troops: u.troops, mx: u.maxTroops, morale: u.morale,
        routed: u.routed ? 1 : 0, alive: u.alive ? 1 : 0, on: u.on ? 1 : 0, hid: u.hidden ? 1 : 0,
        act: d && u.alive ? d.actio : '',
        rule: d && u.alive ? d.rule : 0,
        tgt: d && u.alive && d.target ? d.target.i : -1,
        dealt: u.dealtT, taken: u.takenT,
      };
    }),
  });

  const turns = [snapshot(0, weatherAt(seed, 1), [], null)];
  let result = null;

  for (let t = 1; t <= lastTurn && !result; t++) {
    const weather = weatherAt(seed, t);
    const rain = weather === 'pluvia';
    const events = [];
    if (rain && (t === 1 || weatherAt(seed, t - 1) !== 'pluvia')) events.push({ type: 'rain' });
    const inSD = t > MAX_TURNS;
    if (inSD && t === MAX_TURNS + 1) {
      // 決戦：両軍とも布陣の位置に戻って陣を立て直す。失った兵の一部が戻り、士気も回復する
      events.push({ type: 'suddenDeath' });
      for (const u of units) {
        if (!u.alive) continue;
        u.x = u.sx + (u.twin ? (u.side === 'W' ? -30 : 30) : 0);
        u.y = u.sy;
        u.troops += Math.floor(((u.maxTroops - u.troops) * TUNING.sdHealPct) / 100);
        u.morale = MORALE_MAX;
        u.routed = false;
        u.reload = 0;
        u.hidden = terrainOfPos(u.x, u.y) === 'silva';
        u.ambushTurns = u.hidden ? 2 : 0;
      }
      holds.W = 0;
      holds.E = 0;
    }

    for (const u of units) {
      u.hiddenStart = u.hidden; u.ambushed = 0; u.ambushUsed = 0; u.moved = 0; u.cvoid = 0; u.inMelee = 0; u.lostT = 0; u.gunHit = 0; u.fired = 0; u.dealtT = 0; u.takenT = 0;
    }
    const alive = units.filter((u) => u.alive);
    // 時間の条件は、本戦は開戦から、決戦は決戦開始からの秒（1ターン＝1秒）で数える
    const ctx = { units: alive, turn: t > MAX_TURNS ? t - MAX_TURNS : t, rain, towers: tower };

    // ---- 2. 行動決定（割合の条が働いたら、ここで部隊を二つに分ける） ----
    const dec = new Array(units.length).fill(null);
    for (const u of alive.slice()) {
      if (u.routed) {
        dec[u.i] = { rule: 0, actio: 'recedere', target: null, moveTarget: null, locus: null, pars: 0 };
        continue;
      }
      if (inSD) {
        // 決戦：全部隊（大将・守備隊も）が全体指揮に従う
        const d = decide(u, cmds[u.side], ctx);
        dec[u.i] = d;
        if (d.rule > 0) sdCount[u.side].ruleCount[d.rule - 1]++;
        else sdCount[u.side].defaultCount++;
        if (u.twin) continue;
      } else if (u.twin) {
        dec[u.i] = holdDecision(u, ctx);
        continue;
      }
      const d = inSD ? dec[u.i] : decide(u, orderOf(u), ctx);
      dec[u.i] = d;
      if (!inSD) {
        if (d.rule > 0) u.ruleCount[d.rule - 1]++;
        else u.defaultCount++;
      }
      const tw = twinOf.get(u.id);
      if (d.pars > 0 && tw && !tw.on) {
        const act = Math.max(1, Math.floor((u.troops * d.pars) / 100));
        const rest = u.troops - act;
        if (rest > 0) {
          const actMax = Math.max(act, Math.floor((u.maxTroops * d.pars) / 100));
          tw.troops = rest;
          tw.maxTroops = Math.max(rest, u.maxTroops - actMax);
          u.troops = act;
          u.maxTroops = actMax;
          tw.morale = u.morale;
          tw.reload = u.reload;
          tw.x = u.x + (u.side === 'W' ? -30 : 30); // 守備隊は一歩うしろに残る
          tw.y = u.y;
          tw.alive = true;
          tw.on = true;
          alive.push(tw);
          events.push({ type: 'split', a: u.id, b: tw.id, pars: d.pars });
        }
      }
    }
    alive.sort((a, b) => a.ord - b.ord);
    for (const u of alive) if (!dec[u.i]) dec[u.i] = u.routed ? { rule: 0, actio: 'recedere', target: null, moveTarget: null, locus: null, pars: 0 } : holdDecision(u, ctx);

    // ---- 3. 移動（小歩ごとに同時に進み、そのつど押し合って間隔を保つ） ----
    const present = (u) => u.alive && u.troops > 0;
    const near = (a, b, r) => dist2(a.x, a.y, b.x, b.y) <= r * r;
    const enemyOf = (u) => alive.filter((e) => e.side !== u.side && e.troops > 0);
    const adjEnemy = (u) => alive.some((e) => e.side !== u.side && e.troops > 0 && near(u, e, CONTACT));
    const targetAdj = (u, d) => d.target && d.target.troops > 0 && near(u, d.target, CONTACT);
    const shouldStop = (u, d) => {
      if (d.actio === 'impetus' || d.actio === 'circumire') return !!targetAdj(u, d);
      return adjEnemy(u);
    };

    const moving = new Uint8Array(units.length); // 動く行動か
    const stopped = new Uint8Array(units.length);
    let maxSub = 0;
    for (const u of alive) {
      const d = dec[u.i];
      if (d.actio === 'exspectare' || d.actio === 'ferire') continue;
      moving[u.i] = 1;
      maxSub = Math.max(maxSub, subsOf(u.genus, inSD));
      if (d.actio === 'recedere') continue; // 後退は最初から足止めされない
      if (shouldStop(u, d)) stopped[u.i] = 1; // すでに交戦中
    }

    const aims = new Array(units.length).fill(null);

    const flankPoint = (u, T) => {
      const friends = alive.filter((a) => a.side === u.side && a !== u && a.troops > 0 && near(a, T, CONTACT));
      let best = null;
      let bScore = -1;
      let bd = INF * 4;
      for (const [ox, oy] of FLANK_BY_SIDE[u.side]) {
        const gx = clampX(T.x + ox);
        const gy = clampY(T.y + oy);
        let score = 0;
        if (friends.length) {
          score = INF;
          for (const f of friends) {
            const dv = dist2(gx, gy, f.x, f.y);
            if (dv < score) score = dv;
          }
        }
        const du = dist2(gx, gy, u.x, u.y);
        if (score > bScore || (score === bScore && du < bd)) {
          bScore = score;
          bd = du;
          best = [gx, gy];
        }
      }
      return best;
    };

    const toLocusPoint = (u, locus) => {
      const on = locus === 'castra' ? baseAtPos(u.side, u.x, u.y)
        : locus === 'castra_hostium' ? baseAtPos(otherSide(u.side), u.x, u.y)
          : terrainOfPos(u.x, u.y) === locus;
      if (on) return null;
      const s = cellIdx(u.x, u.y);
      const { dist: dd } = dijkstra(s, NOBLOCK, DIRS_BY_SIDE[u.side]);
      let goal = -1;
      let bd = INF;
      for (let k = 0; k < N; k++) {
        const i = u.side === 'W' ? k : N - 1 - k; // 東軍は逆順に走査（点対称）
        const gx = i % W;
        const gy = (i - gx) / W;
        const match =
          locus === 'castra' ? BASE_CELLS[u.side].some((c) => c[0] === gx && c[1] === gy)
            : locus === 'castra_hostium' ? BASE_CELLS[otherSide(u.side)].some((c) => c[0] === gx && c[1] === gy)
              : TERRAIN[i] === locus;
        if (!match || dd[i] >= bd) continue;
        bd = dd[i];
        goal = i;
      }
      return goal < 0 ? null : cellCenter(goal);
    };

    const retreatPoint = (u) => {
      const en = enemyOf(u);
      if (en.length === 0) return null;
      let e0 = null;
      let bd = Infinity;
      for (const e of en) {
        const dv = dist2(u.x, u.y, e.x, e.y);
        if (dv < bd) { bd = dv; e0 = e; }
      }
      let fx = u.x - e0.x;
      let fy = u.y - e0.y;
      if (fx === 0 && fy === 0) fx = u.side === 'W' ? -1 : 1;
      const [ax, ay] = norm(fx, fy, 100);
      const bc = BASE_CENTER[u.side];
      const [bx, by] = norm(bc[0] - u.x, bc[1] - u.y, 50);
      return [clampX(u.x + ax + bx), clampY(u.y + ay + by)];
    };

    // 小歩の最初に「どこへ向かうか」を決める
    const computeAim = (u, d) => {
      switch (d.actio) {
        case 'progredi':
        case 'impetus':
        case 'tueri': {
          const T = d.moveTarget;
          if (!T || T.troops <= 0 || dist2(u.x, u.y, T.x, T.y) <= STOP_AT * STOP_AT) return null;
          const p = aimPoint(u, T.x, T.y);
          // 途中の目印（橋など）へ向かうときは、目印の手前で止まらない
          return { x: p[0], y: p[1], chase: T, arrive: p[0] === T.x && p[1] === T.y ? STOP_AT : 5 };
        }
        case 'circumire': {
          const T = d.moveTarget;
          if (!T || T.troops <= 0 || near(u, T, CONTACT)) return null;
          const f = flankPoint(u, T);
          const p = aimPoint(u, f[0], f[1]);
          return { x: p[0], y: p[1], chase: null, arrive: 10 };
        }
        case 'ire': {
          if (d.locus) {
            const c = toLocusPoint(u, d.locus);
            if (!c) return null;
            const p = aimPoint(u, c[0], c[1]);
            return { x: p[0], y: p[1], chase: null, arrive: 10 };
          }
          const T = d.moveTarget;
          if (!T || T.troops <= 0 || dist2(u.x, u.y, T.x, T.y) <= STOP_AT * STOP_AT) return null;
          const p = aimPoint(u, T.x, T.y);
          // 途中の目印（橋など）へ向かうときは、目印の手前で止まらない
          return { x: p[0], y: p[1], chase: T, arrive: p[0] === T.x && p[1] === T.y ? STOP_AT : 5 };
        }
        case 'recedere': {
          const p = retreatPoint(u);
          return p ? { x: p[0], y: p[1], chase: null, arrive: 5 } : null;
        }
        default:
          return null;
      }
    };

    // 押し合い：近すぎる部隊を左右に押し離す（同時に解決）
    const separate = () => {
      const ps = alive.filter(present);
      const n = ps.length;
      for (let iter = 0; iter < 3; iter++) {
        const dx = new Int32Array(n);
        const dy = new Int32Array(n);
        let any = false;
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            let vx = ps[b].x - ps[a].x;
            let vy = ps[b].y - ps[a].y;
            const d2 = vx * vx + vy * vy;
            if (d2 >= SEP * SEP) continue;
            if (d2 === 0) { vx = 1; vy = 0; }
            const d = Math.max(1, isqrt(vx * vx + vy * vy));
            const half = (SEP - (d2 === 0 ? 0 : d)) >> 1;
            const px = Math.trunc((vx * half) / d);
            const py = Math.trunc((vy * half) / d);
            dx[a] -= px; dy[a] -= py;
            dx[b] += px; dy[b] += py;
            any = true;
          }
        }
        if (!any) break;
        for (let k = 0; k < n; k++) {
          ps[k].x = clampX(ps[k].x + dx[k]);
          ps[k].y = clampY(ps[k].y + dy[k]);
        }
      }
    };

    for (let sub = 0; sub < maxSub; sub++) {
      if (sub % SUBS_PER_CELL === 0) {
        for (const u of alive) aims[u.i] = moving[u.i] && !stopped[u.i] ? computeAim(u, dec[u.i]) : null;
      }
      const props = [];
      for (const u of alive) {
        if (!moving[u.i] || stopped[u.i] || sub >= subsOf(u.genus, inSD)) continue;
        const a = aims[u.i];
        if (!a) continue;
        let ax = a.x;
        let ay = a.y;
        let arrive = a.arrive;
        if (a.chase && a.chase.troops > 0 && dist2(u.x, u.y, a.chase.x, a.chase.y) < 300 * 300) {
          ax = a.chase.x;
          ay = a.chase.y;
          arrive = STOP_AT;
        }
        const vx = ax - u.x;
        const vy = ay - u.y;
        const d = isqrt(vx * vx + vy * vy);
        let step = Math.floor((((SUB * SPEED_PCT[terrainOfPos(u.x, u.y)]) / 100) * obstacle(u)) / 100);
        if (d - arrive < step) step = d - arrive;
        if (step <= 0) continue;
        props.push({ u, mx: Math.trunc((vx * step) / d), my: Math.trunc((vy * step) / d), step });
      }
      for (const p of props) {
        const u = p.u;
        u.x = clampX(u.x + p.mx);
        u.y = clampY(u.y + p.my);
        u.moved += p.step;
        const tn = terrainOfPos(u.x, u.y);
        if (tn === 'silva' || tn === 'pons' || tn === 'flumen') u.cvoid = 1;
      }
      separate();
      for (const u of alive) {
        if (moving[u.i] && !stopped[u.i] && dec[u.i].actio !== 'recedere' && shouldStop(u, dec[u.i])) stopped[u.i] = 1;
      }
    }

    // ---- 4. 射撃（同時解決） ----
    const shots = [];
    for (const u of alive) {
      if (!isRanged(u.genus) || u.routed || u.reload > 0) continue;
      if (!TUNING.waitShoots && dec[u.i].actio === 'exspectare') continue; // 待機中は撃たない
      const here = terrainOfPos(u.x, u.y);
      if (here === 'flumen') continue; // 川から射撃不可
      if (u.genus === 'sclopetarii' && rain) continue; // 雨で撃てない
      const rt = reach(TUNING.towerRangeCells);
      const nearTower = tower[u.side] && dist2(u.x, u.y, tower[u.side][0], tower[u.side][1]) <= rt * rt; // 物見櫓のそば
      const range = reach(STATS[u.genus].range) + (here === 'collis' ? CELL : 0) + (nearTower ? CELL : 0);
      const r2 = range * range;
      const rv = reach(TUNING.revealCells);
      const seen = (e) => !e.hidden || dist2(u.x, u.y, e.x, e.y) <= rv * rv || towerSees(u.side, e); // 伏兵は近くでないと撃てない（物見櫓があれば見える）
      const d = dec[u.i];
      let tg = null;
      if (d.target && present(d.target) && seen(d.target) && dist2(u.x, u.y, d.target.x, d.target.y) <= r2) {
        tg = d.target;
      } else {
        let bd = Infinity;
        for (const e of alive) {
          if (e.side === u.side || !present(e) || !seen(e)) continue;
          const dv = dist2(u.x, u.y, e.x, e.y);
          if (dv <= r2 && dv < bd) { bd = dv; tg = e; }
        }
      }
      if (!tg) continue;
      const mods = inSD ? [TUNING.dmgPct, TUNING.sdDmgPct, tg.genus === 'dux' ? TUNING.sdDuxPct : 100] : [TUNING.dmgPct];
      if (drum[u.side] && u.morale >= RECOVER_AT) mods.push(TUNING.drumAtkPct); // 陣太鼓：士気が高い間は勢いがある
      if (u.genus === 'sagittarii' && rain) mods.push(70);
      if (u.moved >= 10) mods.push(TUNING.moveShotPct); // 動きながら撃つと当たりにくい
      if (nearTower) mods.push(TUNING.towerShotPct); // 物見櫓から狙い撃ち
      const tt = terrainOfPos(tg.x, tg.y);
      const tgStill = tg.moved < 10;
      if (tt === 'silva') mods.push(50);
      if (tt === 'flumen') mods.push(TUNING.riverShotPct); // 渡河中を撃つ
      if (tt === 'pons') mods.push(TUNING.bridgeShotPct);
      if (tt === 'collis' && tgStill) mods.push(TUNING.hillShotPct); // 丘で構える
      if (onOwn(fort, tg)) mods.push(TUNING.wallPct); // 石垣に守られる
      if (onOwn(fence, tg)) mods.push(TUNING.fenceShotPct); // 柵が矢弾を少し防ぐ
      if (onOwn(fence, u)) mods.push(TUNING.fenceFirePct); // 柵に銃・弓を据えて撃つ
      if (u.ambushTurns > 0) {
        u.ambushUsed = 1;
        mods.push(TUNING.ambushShotPct); // 伏兵の初撃
        if (!tg.ambushed) events.push({ type: 'ambush', a: u.id, b: tg.id });
        tg.ambushed = 1;
      }
      if (dec[tg.i] && dec[tg.i].actio === 'exspectare' && !tg.routed) mods.push(TUNING.waitPct);
      const st = STATS[u.genus];
      const dmg = calcDamage(rng, st.atk, u.troops, STATS[tg.genus].def, matchup(u.genus, tg.genus), mods);
      shots.push({ a: u, b: tg, dmg });
    }
    for (const s of shots) {
      const real = Math.min(s.dmg, s.b.troops);
      s.b.troops -= real;
      s.b.lostT += real;
      s.b.takenT += real;
      s.b.taken += real;
      s.a.dealtT += real;
      s.a.dealt += real;
      s.a.fired = 1;
      if (s.a.genus === 'sclopetarii') s.b.gunHit = 1;
      events.push({ type: 'shoot', a: s.a.id, b: s.b.id, d: real });
    }
    for (const u of alive) {
      if (u.fired && u.genus === 'sclopetarii') u.reload = 1;
      else if (u.reload > 0) u.reload--;
    }

    // ---- 5. 近接戦闘（同時解決） ----
    const hits = [];
    for (const u of alive) {
      if (!present(u) || u.routed) continue;
      if (isRanged(u.genus) && u.fired) continue;
      const foes = alive.filter((e) => e.side !== u.side && present(e) && near(u, e, CONTACT));
      if (foes.length === 0) continue;
      const d = dec[u.i];
      let tg = null;
      if (d.target && foes.includes(d.target)) tg = d.target;
      else {
        let bd = Infinity;
        for (const e of foes) {
          const dv = dist2(u.x, u.y, e.x, e.y);
          if (dv < bd) { bd = dv; tg = e; }
        }
      }
      const mods = inSD ? [TUNING.dmgPct, TUNING.sdDmgPct, tg.genus === 'dux' ? TUNING.sdDuxPct : 100] : [TUNING.dmgPct];
      if (drum[u.side] && u.morale >= RECOVER_AT) mods.push(TUNING.drumAtkPct); // 陣太鼓：士気が高い間は勢いがある
      const wouldCharge = u.genus === 'equites' && u.moved >= CAV_CHARGE && !u.cvoid;
      const behindFence = onOwn(fence, tg);
      if (wouldCharge) {
        if (behindFence) {
          events.push({ type: 'fence', a: u.id, b: tg.id }); // 馬防柵：突撃を無効化
        } else if (tg.genus === 'hastati' && tg.moved < 10) {
          events.push({ type: 'yarisashi', a: u.id, b: tg.id }); // 槍衾：突撃を無効化
        } else {
          mods.push(150);
          events.push({ type: 'charge', a: u.id, b: tg.id });
        }
      }
      if (u.genus === 'hastati' && tg.genus === 'equites' && u.moved < 10) mods.push(150); // 槍衾の反撃
      if (behindFence) mods.push(u.genus === 'equites' ? TUNING.fencePct : TUNING.fenceMeleePct); // 柵越しに斬りかかるのは難しい（騎馬はなおさら）
      if (onOwn(fort, tg)) mods.push(TUNING.wallPct); // 石垣に守られる
      const sup = alive.filter((a) => a.side === u.side && present(a) && near(a, tg, CONTACT)).length;
      if (sup >= 2) mods.push(130); // 挟撃
      const tt = terrainOfPos(tg.x, tg.y);
      const here = terrainOfPos(u.x, u.y);
      if (tt === 'collis') mods.push(tg.moved < 10 ? TUNING.hillHoldPct : 80); // 丘で構える守り
      if (here === 'collis' && tt !== 'collis') mods.push(TUNING.downhillPct); // 丘から斬り下ろす
      if (tt === 'flumen') mods.push(130);
      if (tt === 'pons') mods.push(TUNING.bridgeMeleePct);
      if ((tt === 'flumen' || tt === 'pons') && here !== 'flumen' && here !== 'pons' && u.moved < 10) mods.push(TUNING.crossingPct); // 岸で待ち構える
      if (u.ambushTurns > 0) {
        u.ambushUsed = 1;
        mods.push(TUNING.ambushPct); // 伏兵の初撃
        if (!tg.ambushed) events.push({ type: 'ambush', a: u.id, b: tg.id });
        tg.ambushed = 1;
      }
      if (dec[tg.i] && dec[tg.i].actio === 'exspectare' && !tg.routed) mods.push(TUNING.waitPct);
      if (isRanged(u.genus)) mods.push(50);
      const st = STATS[u.genus];
      const dmg = calcDamage(rng, st.atk, u.troops, STATS[tg.genus].def, matchup(u.genus, tg.genus), mods);
      hits.push({ a: u, b: tg, dmg });
    }
    for (const h of hits) {
      const real = Math.min(h.dmg, h.b.troops);
      h.b.troops -= real;
      h.b.lostT += real;
      h.b.takenT += real;
      h.b.taken += real;
      h.a.dealtT += real;
      h.a.dealt += real;
      h.a.inMelee = 1;
      h.b.inMelee = 1;
      events.push({ type: 'melee', a: h.a.id, b: h.b.id, d: real });
    }

    // ---- 6. 壊滅・士気・潰走 ----
    const destroyed = [];
    for (const u of alive) {
      if (u.troops <= 0) {
        u.troops = 0;
        u.alive = false;
        u.deadTurn = t;
        destroyed.push(u);
        events.push({ type: 'destroyed', a: u.id });
      }
    }
    const duxOf = {};
    for (const u of alive) if (u.genus === 'dux') duxOf[u.side] = u;
    for (const u of alive) {
      if (!u.alive) continue;
      let drop = Math.floor(u.lostT / 2);
      if (u.gunHit) drop += 5;
      if (u.inMelee) drop += TUNING.meleeFatigue;
      if (u.ambushed) drop += TUNING.ambushShock;
      if (drum[u.side]) drop = Math.floor((drop * TUNING.drumPct) / 100); // 陣太鼓
      for (const z of destroyed) {
        if (z.side === u.side && near(u, z, 300)) drop += 10;
      }
      const dx = duxOf[u.side];
      if (dx && dx.alive && near(u, dx, 200)) drop = Math.floor(drop / 2);
      u.morale -= drop;
      if (u.lostT === 0) u.morale += 3;
      if (u.morale > MORALE_MAX) u.morale = MORALE_MAX;
      if (u.morale < 0) u.morale = 0;
      if (!u.routed && u.morale <= ROUT_AT) {
        u.routed = true;
        events.push({ type: 'rout', a: u.id });
      } else if (u.routed && u.morale >= RECOVER_AT) {
        u.routed = false;
        events.push({ type: 'recover', a: u.id });
      }
    }

    // 伏兵：森の中で動かず、撃たず、斬り合わなかった部隊は、敵から見えなくなる
    // 伏兵の初撃は、森を出てから2ターンのうちに一度だけ使える
    for (const u of units) {
      u.hidden = u.alive && !u.routed && terrainOfPos(u.x, u.y) === 'silva' && u.moved < 10 && !u.fired && !u.inMelee;
      if (u.ambushUsed) u.ambushTurns = 0;
      else if (u.hidden) u.ambushTurns = 2;
      else if (u.ambushTurns > 0) u.ambushTurns--;
    }

    // ---- 7. 勝敗 ----
    for (const side of ['W', 'E']) {
      const en = otherSide(side);
      const on = units.some((u) => u.alive && u.side === side && baseAtPos(en, u.x, u.y));
      // 本陣の近く（2マス）に、崩れていない守り手がいる間は「占拠」にならない（攻めて守り手を退ける必要がある）
      const bc = BASE_CENTER[en];
      const defended = units.some((e) => e.alive && e.side === en && !e.routed && e.troops > 0 && dist2(e.x, e.y, bc[0], bc[1]) <= BASE_GUARD * BASE_GUARD);
      holds[side] = on && !defended ? holds[side] + 1 : 0;
    }
    const remain = { W: 0, E: 0 };
    for (const u of units) if (u.alive) remain[u.side] += u.troops;
    const ratio = {
      W: Math.floor((remain.W * 100) / initTotal.W),
      E: Math.floor((remain.E * 100) / initTotal.E),
    };
    const end = evaluateEnd({
      wDuxDead: units.some((u) => u.id === 'W0' && !u.alive),
      eDuxDead: units.some((u) => u.id === 'E0' && !u.alive),
      holdsW: holds.W,
      holdsE: holds.E,
      turn: t,
      maxTurn: lastTurn,
      ratioW: ratio.W,
      ratioE: ratio.E,
    });
    if (end && sudden && !cmds && end.reason === 'time') {
      // 30ターンで決着せず：決戦の全体指揮を待つ
      result = { winner: null, reason: 'pending', turn: t, ratio };
      events.push({ type: 'pending' });
    } else if (end) {
      result = { winner: end.winner, reason: end.reason, turn: t, ratio };
      events.push({ type: 'result', winner: end.winner, reason: end.reason });
    }

    // ---- 8. 記録 ----
    turns.push(snapshot(t, weather, events, dec));
  }

  const rec = {
    version: ENGINE_VERSION,
    seed,
    units: units.map((u) => ({
      id: u.id, side: u.side, slot: u.slot, genus: u.genus, owner: u.owner,
      twin: u.twin ? 1 : 0, parent: u.parent,
      maxTroops: initMax[u.i], dealt: u.dealt, taken: u.taken, deadTurn: u.deadTurn,
      ruleCount: u.ruleCount.slice(), defaultCount: u.defaultCount,
    })),
    turns,
    result,
  };
  if (cmds) rec.sd = sdCount;
  if (items.W || items.E) rec.items = { W: items.W, E: items.E }; // 道具（描画用） // 決戦で全体指揮の各条が働いた回数（部隊×ターン）
  return rec;
}

// 記録の指紋（Node・各ブラウザで一致することを確認するためのハッシュ）
export function hashRecord(record) {
  return hashString(JSON.stringify(record));
}
