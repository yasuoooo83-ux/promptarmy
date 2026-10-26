// オンライン対戦（2人・1人1軍）のルーム制御。
// 封印のしくみ：作戦の中身より先に「封印の印」（SHA-256）だけを出し合い、両軍の印がそろってから中身を送る。
// データベースの決まり（database.rules.json）で、相手の印がそろう前に中身は書けず、中身が出たあとは印を変えられない。
// 届いた相手の作戦は、印と一致するか・ルールどおりかを検査してから使う。
import { ENGINE_VERSION } from '../engine/version.js';
import { STATS, BUDGET, MAX_UNITS, TROOP_GENERA, armyCost } from '../engine/units.js';
import { canDeploy } from '../engine/map.js';
import { ITEMS, canPlaceItem } from '../engine/items.js';
import { basicChoices } from '../engine/basic.js';
import { parseOrder } from '../engine/parse.js';

export const OTHER = { W: 'E', E: 'W' };

function randomHex(n = 16) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] >>> 0;
}

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 封印：中身（JSON文字列）と、ランダムな塩、印
export async function makeSeal(obj) {
  const json = JSON.stringify(obj);
  const nonce = randomHex();
  const hash = await sha256Hex(`${json}|${nonce}`);
  return { json, nonce, hash };
}

export async function checkSeal(seal, body) {
  if (!seal || !body || typeof body.json !== 'string' || typeof body.nonce !== 'string') return false;
  return (await sha256Hex(`${body.json}|${body.nonce}`)) === seal.hash;
}

// ---- 相手の作戦の検査（ルールどおりか） ----
export function validatePlan(side, plan) {
  const bad = (why) => ({ ok: false, why });
  if (!plan || typeof plan !== 'object') return bad('作戦が読めない');
  if (plan.v !== ENGINE_VERSION) return bad(`ゲームの版が違う（相手 ${plan.v} ／自分 ${ENGINE_VERSION}）`);
  const army = Array.isArray(plan.army) ? plan.army : [];
  const ids = new Set();
  const troops = [];
  for (const a of army) {
    if (!a || typeof a.id !== 'string' || !new RegExp(`^${side}[0-6]$`).test(a.id) || ids.has(a.id)) return bad('部隊の番号がおかしい');
    ids.add(a.id);
    if (a.id === `${side}0`) { if (a.genus !== 'dux') return bad('大将がいない'); }
    else if (!TROOP_GENERA.includes(a.genus)) return bad('兵種がおかしい');
    else troops.push(a.genus);
    if (a.owner !== undefined && (typeof a.owner !== 'string' || a.owner.length > 12)) return bad('担当者名がおかしい');
  }
  if (!ids.has(`${side}0`)) return bad('大将がいない');
  if (troops.length > MAX_UNITS || armyCost(troops) > BUDGET) return bad('編成が予算を超えている');
  const cells = new Set();
  for (const a of army) {
    const p = plan.placement && plan.placement[a.id];
    if (!Array.isArray(p) || p.length !== 2 || !canDeploy(side, p[0], p[1]) || cells.has(`${p[0]},${p[1]}`)) return bad('布陣がおかしい');
    cells.add(`${p[0]},${p[1]}`);
    const b = plan.basic && plan.basic[a.id];
    if (!basicChoices(a.genus).includes(b)) return bad('基本命令がおかしい');
    const ex = plan.extras && plan.extras[a.id];
    if (ex) {
      const r = parseOrder(JSON.stringify({ legio: a.id, genus: a.genus, iussa: ex.iussa, nota: ex.nota || '' }), { slotId: a.id, genus: a.genus, extra: true });
      if (!r.ok) return bad('追加命令がルールに合わない');
    }
  }
  const it = plan.item;
  if (it) {
    if (!ITEMS[it.type]) return bad('道具がおかしい');
    if (ITEMS[it.type].place !== 'none' && !canPlaceItem(side, it.type, it.x, it.y)) return bad('道具の置き場所がおかしい');
  }
  return { ok: true };
}

export function validateCommand(side, cmd) {
  if (!cmd || !cmd.order) return { ok: false, why: '全体指揮が読めない' };
  const r = parseOrder(JSON.stringify({ legio: side, genus: 'omnes', iussa: cmd.order.iussa, nota: cmd.order.nota || '' }), { slotId: side, genus: 'omnes' });
  return r.ok ? { ok: true, order: r.order } : { ok: false, why: '全体指揮がルールに合わない' };
}

// ---- ルーム ----
// backend: backend-firebase.js / backend-memory.js。onRoom(room) はルームの中身が変わるたびに呼ばれる。
export function createOnline(backend, { onRoom, onError } = {}) {
  const self = {
    backend,
    code: '',
    side: '',
    room: null,
    pending: { plan: null, cmd: null, reveal: null }, // 印だけ出して、中身をまだ送っていないもの（{round, json, nonce}）
    busy: new Set(),
  };
  let unsub = null;
  const P = (p) => `rooms/${self.code}${p ? '/' + p : ''}`;

  self.round = (n) => {
    const r = self.room && self.room.rounds;
    const k = n === undefined ? self.room && self.room.cur : n;
    return (r && r[k]) || null;
  };
  self.curNo = () => (self.room && self.room.cur) || 0;

  function subscribe() {
    if (unsub) unsub();
    unsub = backend.on(P(), (v) => {
      self.room = v;
      autoSend().catch((e) => onError && onError(e));
      onRoom && onRoom(v);
    }, (e) => onError && onError(e));
  }

  // 両軍の印がそろったら、自分の中身を送る（決戦の号令・公開も同じ）
  async function autoSend() {
    for (const [kind, sealKey, bodyKey, need] of [
      ['plan', 'seal', 'plan', null],
      ['cmd', 'cmdSeal', 'cmd', null],
      ['reveal', 'agree', 'reveal', null],
    ]) {
      void need;
      const pend = self.pending[kind];
      if (!pend) continue;
      const rd = self.round(pend.round);
      if (!rd) continue;
      const both = rd[sealKey] && rd[sealKey].W && rd[sealKey].E;
      const mine = rd[bodyKey] && rd[bodyKey][self.side];
      if (mine) { self.pending[kind] = null; continue; }
      if (!both || self.busy.has(kind)) continue;
      self.busy.add(kind);
      try {
        await backend.set(P(`rounds/${pend.round}/${bodyKey}/${self.side}`), { json: pend.json, nonce: pend.nonce || '' });
        self.pending[kind] = null;
      } catch (e) {
        // 間に合わなかった（相手が封印を解いた等）。次の更新で送り直す
      } finally {
        self.busy.delete(kind);
      }
    }
  }

  self.create = async (name) => {
    for (let k = 0; k < 8; k++) {
      const code = String(1000 + Math.floor(Math.random() * 9000));
      try {
        await backend.set(`rooms/${code}/meta`, { v: ENGINE_VERSION, host: backend.uid, at: Date.now() });
      } catch (e) {
        if (!/PERMISSION_DENIED|permission/i.test(String((e && (e.code || e.message)) || e))) throw e;
        continue; // 使用中のコード
      }
      self.code = code;
      self.side = 'W';
      await backend.set(P('players/W'), { uid: backend.uid, name: name || '' });
      await backend.set(P('rounds/1'), { seed: randomSeed(), mode: 'first', by: 'W' });
      await backend.set(P('cur'), 1);
      subscribe();
      return { code, side: 'W' };
    }
    throw new Error('ルームを作れませんでした。Realtime Database のルール（database.rules.json）を公開したか確かめてください。');
  };

  self.join = async (code, name) => {
    self.code = String(code).trim();
    try {
      await backend.set(P('players/E'), { uid: backend.uid, name: name || '' });
    } catch (e) {
      throw new Error('ルームが見つからないか、もう2人そろっています。コードを確かめてください。');
    }
    const meta = await backend.get(P('meta'));
    if (meta && meta.v !== ENGINE_VERSION) throw new Error(`ゲームの版が違います（ルーム ${meta.v} ／この画面 ${ENGINE_VERSION}）。ページを再読み込みしてください。`);
    self.side = 'E';
    subscribe();
    return { code: self.code, side: 'E' };
  };

  // 再読み込みのあとで戻る
  self.resume = async (code, side, pending) => {
    self.code = code;
    self.side = side;
    if (pending) self.pending = { plan: null, cmd: null, reveal: null, ...pending };
    const me = await backend.get(P(`players/${side}`));
    if (!me || me.uid !== backend.uid) throw new Error('このルームに戻れませんでした（別のブラウザで入ったルームです）。');
    subscribe();
  };

  self.leave = () => {
    if (unsub) unsub();
    unsub = null;
    self.room = null;
    self.code = '';
    self.side = '';
    self.pending = { plan: null, cmd: null, reveal: null };
  };

  // ---- 作戦の封印（印を出す）と、封印を解く ----
  self.sealPlan = async (planObj) => {
    const n = self.curNo();
    const s = await makeSeal(planObj);
    self.pending.plan = { round: n, json: s.json, nonce: s.nonce };
    await backend.set(P(`rounds/${n}/seal/${self.side}`), { hash: s.hash, at: Date.now() });
  };
  self.unsealPlan = async () => {
    const n = self.curNo();
    await backend.set(P(`rounds/${n}/seal/${self.side}`), null);
    self.pending.plan = null;
  };
  self.sealCmd = async (cmdObj) => {
    const n = self.curNo();
    const s = await makeSeal(cmdObj);
    self.pending.cmd = { round: n, json: s.json, nonce: s.nonce };
    await backend.set(P(`rounds/${n}/cmdSeal/${self.side}`), { hash: s.hash, at: Date.now() });
  };
  self.unsealCmd = async () => {
    const n = self.curNo();
    await backend.set(P(`rounds/${n}/cmdSeal/${self.side}`), null);
    self.pending.cmd = null;
  };
  // 作戦の公開：同意を出し、両軍の同意がそろったら日本語の原文を送る
  self.agree = async (revealObj) => {
    const n = self.curNo();
    self.pending.reveal = { round: n, json: JSON.stringify(revealObj), nonce: '' };
    await backend.set(P(`rounds/${n}/agree/${self.side}`), true);
  };

  // 再戦：次の合戦を作る（先に押した方の選び方になる）
  self.nextRound = async (mode, seed) => {
    const n = self.curNo() + 1;
    try {
      await backend.set(P(`rounds/${n}`), { seed, mode, by: self.side });
    } catch (e) {
      // すでに相手が作った
    }
    await backend.set(P('cur'), n);
    return n;
  };

  // 届いた中身を開く（印の照合つき）
  self.openBodies = async (n, sealKey, bodyKey) => {
    const rd = self.round(n);
    if (!rd || !rd[bodyKey] || !rd[bodyKey].W || !rd[bodyKey].E) return null;
    const out = {};
    for (const s of ['W', 'E']) {
      const body = rd[bodyKey][s];
      if (sealKey && !(await checkSeal(rd[sealKey][s], body))) return { error: `${s === 'W' ? '西軍' : '東軍'}の中身が封印と一致しません` };
      try {
        out[s] = JSON.parse(body.json);
      } catch (e) {
        return { error: '中身が読めません' };
      }
    }
    return out;
  };

  return self;
}

// 1つの軍の作戦をまとめる（日本語の原文は入れない。公開に同意したときだけ別に送る）
export function packPlan({ side, slots, placement, item, basic, extras }) {
  return {
    v: ENGINE_VERSION,
    army: slots.map((s) => ({ id: s.id, genus: s.genus, owner: s.owner || '' })),
    placement,
    item: item || null,
    basic,
    extras,
    side,
  };
}

export const GENUS_JA = (g) => (STATS[g] ? STATS[g].ja : g);
