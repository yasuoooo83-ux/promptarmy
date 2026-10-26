// 画面遷移と状態管理（ローカルモード）
import { simulate } from './engine/sim.js';
import { ENGINE_VERSION } from './engine/version.js';
import { clear } from './ui/dom.js';
import { renderTitle } from './ui/title.js';
import { renderLobby, PRESET } from './ui/lobby.js';
import { renderPlan, slotList, basicOf } from './ui/plan.js';
import { combineOrder } from './engine/basic.js';
import { renderBattle } from './ui/battle.js';
import { renderReveal } from './ui/reveal.js';
import { renderCommand } from './ui/command.js';
import { placementOf, itemOf } from './ui/deploy.js';

function newPlan() {
  // basic = 基本命令、extraText = 追加命令の日本語、sealed = 封印した追加命令（AIの軍令）、prompts = 戦況レポート用の元の言葉
  return { basic: {}, extraText: {}, sealed: {}, prompts: {}, placement: {}, items: {}, placeSealed: { W: false, E: false }, commands: {}, cmdPrompts: {} };
}

function randomSeed() {
  const a = new Uint32Array(1);
  (globalThis.crypto || window.crypto).getRandomValues(a);
  return a[0] >>> 0;
}

export function createApp(root) {
  const state = {
    screen: 'title',
    seed: randomSeed(),
    slots: {},
    plan: newPlan(),
    battle: null,
    demoMode: false,
  };
  for (const side of ['W', 'E']) {
    state.slots[side + '0'] = { genus: 'dux', owner: '' };
    for (let i = 1; i <= 6; i++) state.slots[side + i] = { genus: PRESET[i - 1] || '', owner: '' };
  }

  let cleanup = null;

  function newSeed() {
    state.seed = randomSeed();
  }

  function resetPlan() {
    state.plan = newPlan();
    state.battle = null;
  }

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

  function startBattle() {
    const cfg = battleConfig();
    const record = annotate(simulate(cfg), cfg);
    state.plan.commands = {};
    state.battle = { record, resumeFrom: 0 };
    go('battle');
  }

  // 決戦：全体指揮を足して最初から計算し直す（30ターン目までは同じ記録になる）。31ターン目から再生する
  const WAIT_CMD = { iussa: [{ si: { res: 'semper' }, fac: { actio: 'exspectare' } }] };
  function startSuddenDeath() {
    const c = state.plan.commands;
    const commands = { W: c.W ? c.W.order : WAIT_CMD, E: c.E ? c.E.order : WAIT_CMD };
    const cfg = battleConfig();
    const record = annotate(simulate({ ...cfg, commands }), cfg);
    state.battle = { record, resumeFrom: state.battle.record.turns.length - 1 };
    go('battle');
  }

  function go(screen) {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    if (screen === 'replan' || screen === 'replanNew' || screen === 'rematch') {
      // 作戦を引き継いで再戦：編成・布陣・基本命令・追加命令はそのまま。決戦の号令だけ書き直す
      // replan = 同じ条件（同じ天候・同じ乱数）で比べる／replanNew = 新しい天候で
      if (screen !== 'replan') newSeed();
      state.battle = null;
      state.plan.commands = {};
      screen = 'plan';
    }
    if (screen === 'lobby') resetPlan();
    state.screen = screen;
    clear(root);
    const ctx = {
      state, go, startBattle, startSuddenDeath, newSeed,
      startLocal: () => { state.demoMode = false; go('lobby'); },
      startDemo: () => { state.demoMode = true; state.autoDemo = true; go('plan'); },
    };
    switch (screen) {
      case 'title': renderTitle(root, ctx); break;
      case 'lobby': renderLobby(root, ctx); break;
      case 'plan': renderPlan(root, ctx); break;
      case 'battle': cleanup = renderBattle(root, ctx); break;
      case 'reveal': renderReveal(root, ctx); break;
      case 'command': renderCommand(root, ctx); break;
      default: renderTitle(root, ctx);
    }
    window.scrollTo && window.scrollTo(0, 0);
  }

  return { state, go, version: ENGINE_VERSION };
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
