// 画面遷移と状態管理（ローカルモード／オンライン2人対戦）
import { simulate } from './engine/sim.js';
import { ENGINE_VERSION } from './engine/version.js';
import { clear, h } from './ui/dom.js';
import { renderTitle } from './ui/title.js';
import { renderLobby, PRESET } from './ui/lobby.js';
import { renderPlan, slotList, basicOf } from './ui/plan.js';
import { combineOrder } from './engine/basic.js';
import { renderBattle } from './ui/battle.js';
import { renderReveal } from './ui/reveal.js';
import { renderCommand } from './ui/command.js';
import { placementOf, itemOf } from './ui/deploy.js';
import { renderRoom, renderWait, ROUND_MODE_JA } from './ui/room.js';
import { createOnline, packPlan, validatePlan, validateCommand, randomSeed, OTHER } from './net/online.js';
import { SIDE_JA } from './ui/names.js';

function newPlan() {
  // basic = 基本命令、extraText = 追加命令の日本語、sealed = 封印した追加命令（AIの軍令）、prompts = 戦況レポート用の元の言葉
  return { basic: {}, extraText: {}, sealed: {}, prompts: {}, placement: {}, items: {}, placeSealed: { W: false, E: false }, commands: {}, cmdPrompts: {} };
}

const SESSION_KEY = 'prompt-army-online';
const WAIT_CMD = { iussa: [{ si: { res: 'semper' }, fac: { actio: 'exspectare' } }] };

// opts.backendFactory: () => Promise<backend>（オンライン用の通信。テストではメモリの通信を渡す）
export function createApp(root, opts = {}) {
  const state = {
    screen: 'title',
    seed: randomSeed(),
    slots: {},
    plan: newPlan(),
    battle: null,
    demoMode: false,
    online: null, // { code, side, round, names, notice, error }
  };
  for (const side of ['W', 'E']) {
    state.slots[side + '0'] = { genus: 'dux', owner: '' };
    for (let i = 1; i <= 6; i++) state.slots[side + i] = { genus: PRESET[i - 1] || '', owner: '' };
  }

  let cleanup = null;
  let net = null; // createOnline の戻り値
  const roomListeners = new Set();
  const storage = opts.storage !== undefined ? opts.storage : (typeof sessionStorage !== 'undefined' ? sessionStorage : null);

  function newSeed() {
    state.seed = randomSeed();
  }

  function resetPlan() {
    state.plan = newPlan();
    state.battle = null;
  }

  // オンラインでは自軍だけを扱う
  const mySides = () => (state.online ? [state.online.side] : ['W', 'E']);

  // 合戦の設定（布陣・軍令）。決戦のやり直し計算でも同じものを使う
  function battleConfig() {
    const slots = {};
    const orders = {};
    const placement = {};
    for (const sl of slotList(state)) {
      slots[sl.id] = { genus: sl.genus, owner: sl.owner };
      placement[sl.id] = placementOf(state, sl);
      // 追加命令（AI）の後ろに基本命令を足して1つの軍令にする
      const sealed = state.plan.sealed[sl.id];
      orders[sl.id] = combineOrder(sl.genus, basicOf(state, sl), sealed ? sealed.order : null);
    }
    const items = { W: itemOf(state, 'W'), E: itemOf(state, 'E') };
    return { seed: state.seed, slots, orders, placement, items, suddenDeath: true };
  }

  // 記録に「基本命令が何条目から始まるか」を書き添える（表示用。計算には使わない）
  function annotate(record, cfg) {
    for (const u of record.units) {
      const id = u.twin ? u.parent : u.id;
      const o = cfg.orders[id];
      u.baseFrom = o ? o.baseFrom : 0;
      const sl = slotList(state).find((x) => x.id === id);
      u.basic = sl ? basicOf(state, sl) : '';
    }
    return record;
  }

  // ================= ローカル =================
  function startBattleLocal() {
    const cfg = battleConfig();
    const record = annotate(simulate(cfg), cfg);
    state.plan.commands = {};
    state.battle = { record, resumeFrom: 0 };
    go('battle');
  }

  // 決戦：全体指揮を足して最初から計算し直す（30ターン目までは同じ記録になる）。31ターン目から再生する
  function startSuddenDeathLocal() {
    const c = state.plan.commands;
    const commands = { W: c.W ? c.W.order : WAIT_CMD, E: c.E ? c.E.order : WAIT_CMD };
    const cfg = battleConfig();
    const record = annotate(simulate({ ...cfg, commands }), cfg);
    state.battle = { record, resumeFrom: state.battle.record.turns.length - 1 };
    go('battle');
  }

  // ================= オンライン =================
  function save() {
    if (!storage || !state.online || !net) return;
    try {
      const mine = {};
      for (const [k, v] of Object.entries(state.slots)) if (k[0] === state.online.side) mine[k] = v;
      storage.setItem(SESSION_KEY, JSON.stringify({
        code: state.online.code, side: state.online.side, round: state.online.round, seed: state.seed,
        slots: mine, plan: state.plan, pending: net.pending, screen: state.screen,
      }));
    } catch (e) { /* 保存できなくても遊べる */ }
  }

  function savedSession() {
    try {
      const s = storage && JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      return s && s.code && s.side ? s : null;
    } catch (e) {
      return null;
    }
  }

  async function backend() {
    if (opts.backendFactory) return opts.backendFactory();
    const { FIREBASE_CONFIG } = await import('./net/firebase-config.js');
    let cfg = FIREBASE_CONFIG;
    if (!cfg) {
      try { cfg = JSON.parse(localStorage.getItem('prompt-army-firebase') || 'null'); } catch (e) { cfg = null; }
    }
    if (!cfg) throw new Error('Firebaseの設定がありません。タイトル画面の「Firebaseの設定」に firebaseConfig を貼ってください。');
    const { createFirebaseBackend } = await import('./net/backend-firebase.js');
    return createFirebaseBackend(cfg);
  }

  function onRoom(room) {
    if (!state.online) return;
    const o = state.online;
    o.names = {
      W: (room && room.players && room.players.W && room.players.W.name) || '',
      E: (room && room.players && room.players.E && room.players.E.name) || '',
    };
    if (!room) return;
    // 相手が次の合戦（再戦）を始めた
    if (room.cur > o.round && !o.notice) {
      const rd = room.rounds && room.rounds[room.cur];
      o.notice = rd ? `${SIDE_JA[rd.by]}が「${ROUND_MODE_JA[rd.mode] || '再戦'}」を選びました。` : '次の合戦が始まりました。';
      refreshBanner();
    }
    for (const fn of [...roomListeners]) fn(room);
    advance();
  }

  // ルームの状態から、自動で次へ進む（相手を待っている画面だけ）
  let advancing = false;
  async function advance() {
    if (advancing || !state.online || !net || !net.room) return;
    advancing = true;
    try {
      const o = state.online;
      const room = net.room;
      if (state.screen === 'room' && room.players && room.players.W && room.players.E) {
        enterRound(o.round || room.cur || 1, true);
        return;
      }
      if (o.round !== net.curNo()) return; // 古い合戦にいる
      const rd = net.round(o.round);
      if (!rd) return;
      if (state.screen === 'wait' && o.waitFor === 'plan' && rd.plan && rd.plan.W && rd.plan.E) await computeBattle();
      else if (state.screen === 'wait' && o.waitFor === 'cmd' && rd.cmd && rd.cmd.W && rd.cmd.E) await computeSuddenDeath();
    } catch (e) {
      showError(e);
    } finally {
      advancing = false;
    }
  }

  function showError(e) {
    if (state.online) state.online.error = String((e && e.message) || e);
    refreshBanner();
  }

  // 相手の作戦を、ローカルの状態に入れる（自軍のぶんは触らない）
  function applyPlan(side, plan) {
    for (let i = 0; i <= 6; i++) {
      const id = side + i;
      delete state.slots[id];
      for (const k of ['basic', 'extraText', 'sealed', 'prompts', 'placement']) delete state.plan[k][id];
    }
    for (const a of plan.army) {
      state.slots[a.id] = { genus: a.genus, owner: a.owner || '' };
      state.plan.basic[a.id] = plan.basic[a.id];
      state.plan.placement[a.id] = plan.placement[a.id].slice();
      const ex = plan.extras && plan.extras[a.id];
      if (ex) state.plan.sealed[a.id] = { order: { legio: a.id, genus: a.genus, iussa: ex.iussa, nota: ex.nota || '' } };
    }
    if (plan.item) state.plan.items[side] = { ...plan.item };
    else delete state.plan.items[side];
  }

  function myPlan() {
    const side = state.online.side;
    const slots = slotList(state).filter((s) => s.side === side);
    const placement = {};
    const basic = {};
    const extras = {};
    for (const sl of slots) {
      placement[sl.id] = placementOf(state, sl);
      basic[sl.id] = basicOf(state, sl);
      const s = state.plan.sealed[sl.id];
      if (s) extras[sl.id] = { iussa: s.order.iussa, nota: s.order.nota || '' };
    }
    return packPlan({ side, slots, placement, item: itemOf(state, side), basic, extras });
  }

  async function submitPlan() {
    const o = state.online;
    o.error = '';
    o.waitFor = 'plan';
    await net.sealPlan(myPlan());
    go('wait');
  }

  async function computeBattle() {
    const o = state.online;
    const n = o.round;
    const bodies = await net.openBodies(n, 'seal', 'plan');
    if (!bodies) return;
    if (bodies.error) throw new Error(bodies.error);
    const en = OTHER[o.side];
    const v = validatePlan(en, bodies[en]);
    if (!v.ok) throw new Error(`${SIDE_JA[en]}の作戦がルールに合いません：${v.why}`);
    applyPlan(en, bodies[en]);
    state.seed = net.round(n).seed;
    state.plan.commands = {};
    const cfg = battleConfig();
    const record = annotate(simulate(cfg), cfg);
    state.battle = { record, resumeFrom: 0, round: n };
    go('battle');
  }

  async function submitCommand() {
    const o = state.online;
    const c = state.plan.commands[o.side];
    o.error = '';
    o.waitFor = 'cmd';
    await net.sealCmd({ order: c ? c.order : WAIT_CMD });
    go('wait');
  }

  async function computeSuddenDeath() {
    const o = state.online;
    const bodies = await net.openBodies(o.round, 'cmdSeal', 'cmd');
    if (!bodies) return;
    if (bodies.error) throw new Error(bodies.error);
    const commands = {};
    for (const s of ['W', 'E']) {
      const v = validateCommand(s, bodies[s]);
      if (!v.ok) throw new Error(`${SIDE_JA[s]}の${v.why}`);
      commands[s] = v.order;
      if (s !== o.side) state.plan.commands[s] = { order: v.order };
    }
    if (!state.battle) await computeBattleSilently();
    const cfg = battleConfig();
    const record = annotate(simulate({ ...cfg, commands }), cfg);
    state.battle = { record, resumeFrom: 30, round: o.round };
    go('battle');
  }

  // 再読み込みのあと：作戦を開いて本戦を計算し直す（画面は変えない）
  async function computeBattleSilently() {
    const o = state.online;
    const bodies = await net.openBodies(o.round, 'seal', 'plan');
    if (!bodies || bodies.error) throw new Error((bodies && bodies.error) || '作戦がそろっていません');
    const en = OTHER[o.side];
    const v = validatePlan(en, bodies[en]);
    if (!v.ok) throw new Error(v.why);
    applyPlan(en, bodies[en]);
    state.seed = net.round(o.round).seed;
    const cfg = battleConfig();
    state.battle = { record: annotate(simulate(cfg), cfg), resumeFrom: 0, round: o.round };
  }

  // 次の合戦に入る（mode: first / same / new / lobby）
  function enterRound(n, fromRoom) {
    const o = state.online;
    const rd = net.round(n);
    o.round = n;
    o.notice = '';
    o.error = '';
    o.waitFor = '';
    state.seed = rd ? rd.seed : state.seed;
    state.battle = null;
    state.plan.commands = {};
    state.plan.cmdPrompts = {};
    if (rd && (rd.mode === 'first' || rd.mode === 'lobby')) {
      if (rd.mode === 'lobby') {
        const keep = state.slots;
        resetPlan();
        state.slots = keep;
      }
      go('lobby', { raw: true });
    } else {
      go('plan', { raw: true });
    }
    void fromRoom;
  }

  async function rematch(mode) {
    const o = state.online;
    if (net.curNo() > o.round) {
      enterRound(net.curNo());
      return;
    }
    const seed = mode === 'same' ? state.seed : randomSeed();
    const n = await net.nextRound(mode, seed);
    // ルームの更新（相手が先に作った合戦かもしれない）が届くのを待つ
    for (let k = 0; k < 200 && !net.round(n); k++) await new Promise((r) => setTimeout(r, 25));
    enterRound(n);
  }

  async function startOnline(kind, { name, code } = {}) {
    state.online = { code: '', side: '', round: 0, names: { W: '', E: '' }, notice: '', error: '', waitFor: '' };
    try {
      const b = await backend();
      net = createOnline(b, { onRoom, onError: showError });
      const r = kind === 'create' ? await net.create(name) : await net.join(code, name);
      Object.assign(state.online, { code: r.code, side: r.side });
      // 担当者名の初期値
      for (let i = 0; i <= 6; i++) {
        const id = r.side + i;
        if (state.slots[id] && !state.slots[id].owner) state.slots[id].owner = name || '';
      }
      go('room');
    } catch (e) {
      state.online = null;
      net = null;
      throw e;
    }
  }

  async function resumeOnline() {
    const s = savedSession();
    if (!s) throw new Error('戻れるルームがありません。');
    const b = await backend();
    net = createOnline(b, { onRoom, onError: showError });
    state.online = { code: s.code, side: s.side, round: s.round, names: { W: '', E: '' }, notice: '', error: '', waitFor: '' };
    Object.assign(state.slots, s.slots || {});
    state.plan = { ...newPlan(), ...(s.plan || {}) };
    state.seed = s.seed;
    await net.resume(s.code, s.side, s.pending);
    // ルームの状態を待ってから画面を決める
    await new Promise((res) => {
      const t = setInterval(() => { if (net.room) { clearInterval(t); res(); } }, 30);
    });
    const rd = net.round(s.round);
    if (!rd) return go('room');
    if (rd.cmd && rd.cmd.W && rd.cmd.E) { state.online.waitFor = 'cmd'; state.screen = 'wait'; return advanceNow(); }
    if (rd.cmdSeal && rd.cmdSeal[s.side]) { await computeBattleSilently(); state.online.waitFor = 'cmd'; return go('wait'); }
    if (rd.plan && rd.plan.W && rd.plan.E) { state.online.waitFor = 'plan'; state.screen = 'wait'; return advanceNow(); }
    if (rd.seal && rd.seal[s.side]) { state.online.waitFor = 'plan'; return go('wait'); }
    return go(s.screen === 'lobby' ? 'lobby' : 'plan');
  }
  function advanceNow() {
    return advance();
  }

  function leaveOnline() {
    if (net) net.leave();
    net = null;
    state.online = null;
    try { storage && storage.removeItem(SESSION_KEY); } catch (e) { /* なし */ }
    resetPlan();
    go('title');
  }

  // ================= 画面 =================
  function rerender() {
    go(state.screen, { keep: true });
  }

  function go(screen, { keep, raw } = {}) {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    roomListeners.clear();
    if (!keep && !raw && (screen === 'replan' || screen === 'replanNew' || screen === 'rematch' || (screen === 'lobby' && state.online && state.screen === 'reveal'))) {
      if (state.online) {
        rematch(screen === 'replan' ? 'same' : screen === 'lobby' ? 'lobby' : 'new').catch(showError);
        return;
      }
      // 作戦を引き継いで再戦：編成・布陣・基本命令・追加命令はそのまま。決戦の号令だけ書き直す
      // replan = 同じ条件（同じ天候・同じ乱数）で比べる／replanNew = 新しい天候で
      if (screen !== 'replan') newSeed();
      state.battle = null;
      state.plan.commands = {};
      screen = 'plan';
    }
    if (screen === 'lobby' && !state.online && !keep) resetPlan();
    state.screen = screen;
    clear(root);
    const online = state.online && net
      ? {
          ...state.online,
          room: net.room,
          round: () => net.round(state.online.round),
          onRoom: (fn) => roomListeners.add(fn),
          agree: (obj) => net.agree(obj).then(save),
          openReveal: () => net.openBodies(state.online.round, null, 'reveal'),
          unseal: async () => {
            if (state.online.waitFor === 'cmd') { await net.unsealCmd(); go('command'); }
            else { await net.unsealPlan(); go('plan'); }
          },
          leave: leaveOnline,
          goNotice: () => enterRound(net.curNo()),
        }
      : null;
    const ctx = {
      state, go, newSeed, online, mySides: mySides(),
      startBattle: () => (state.online ? submitPlan().catch(showError) : startBattleLocal()),
      startSuddenDeath: () => (state.online ? submitCommand().catch(showError) : startSuddenDeathLocal()),
      startLocal: () => { state.demoMode = false; go('lobby'); },
      startDemo: () => { state.demoMode = true; state.autoDemo = true; go('plan'); },
      createRoom: (name) => startOnline('create', { name }),
      joinRoom: (code, name) => startOnline('join', { code, name }),
      resumeRoom: resumeOnline,
      savedRoom: savedSession(),
    };
    lastCtx = ctx;
    refreshBanner();
    switch (screen) {
      case 'title': renderTitle(root, ctx); break;
      case 'room': renderRoom(root, ctx); break;
      case 'wait': renderWait(root, ctx); break;
      case 'lobby': renderLobby(root, ctx); break;
      case 'plan': renderPlan(root, ctx); break;
      case 'battle': cleanup = renderBattle(root, ctx); break;
      case 'reveal': renderReveal(root, ctx); break;
      case 'command': renderCommand(root, ctx); break;
      default: renderTitle(root, ctx);
    }
    save();
    if (!keep && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
  }

  let lastCtx = null;
  function refreshBanner() {
    for (const el of root.querySelectorAll(':scope > .online-banner')) el.remove();
    if (lastCtx && state.online && (state.online.notice || state.online.error)) root.prepend(onlineBanner(lastCtx));
  }

  function onlineBanner(ctx) {
    const o = state.online;
    return h(
      'div',
      { class: `online-banner${o.error ? ' bad' : ''}` },
      o.error ? h('span', {}, `⚠ ${o.error}`) : null,
      o.notice ? h('span', {}, o.notice) : null,
      o.notice ? h('button', { class: 'btn small primary', onclick: () => ctx.online.goNotice() }, '次の合戦へ進む') : null,
      o.error ? h('button', { class: 'btn small', onclick: () => { o.error = ''; refreshBanner(); } }, '閉じる') : null,
    );
  }

  return { state, go, version: ENGINE_VERSION, get net() { return net; } };
}

if (typeof document !== 'undefined' && document.getElementById('app')) {
  const app = createApp(document.getElementById('app'));
  window.__app = app;
  const q = new URLSearchParams(location.search);
  if (q.has('demo')) {
    app.state.demoMode = true;
    app.state.autoDemo = true; // 命令入力済みの作戦画面から始める
    app.go('plan');
  } else {
    app.go(q.has('local') ? 'lobby' : 'title');
  }
}
