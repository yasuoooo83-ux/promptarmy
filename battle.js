// 合戦画面：記録の再生
import { h, clear } from './dom.js';
import { STATS, MAX_TURNS } from '../engine/units.js';
import { SD_TURNS } from '../engine/sim.js';
import { BASIC } from '../engine/basic.js';
import { createBoard } from '../render/board.js';
import { createPlayer, SPEEDS } from '../playback.js';
import { buildLog } from './log.js';
import { unitName, CIRCLED, SIDE_JA } from './names.js';

export function renderBattle(root, { state, go, online }) {
  const battle = state.battle.record;
  const frames = battle.turns.length;
  let selected = -1;

  const turnLabel = h('span', { class: 'turn' });
  const clockBar = h('i');
  const clock = h('span', { class: 'clock-bar' }, clockBar);
  const weatherLabel = h('span', { class: 'weather' });
  const boardHost = h('div', { class: 'board-host' });
  const logBox = h('ol', { class: 'log' });
  const detail = h('div', { class: 'detail' });
  const playBtn = h('button', { class: 'btn primary' }, '開始');
  const pending = battle.result && battle.result.reason === 'pending';
  const revealBtn = pending
    ? h('button', { class: 'btn big primary', onclick: () => go('command') }, '決戦へ（全体指揮を書く）')
    : h('button', { class: 'btn big primary', onclick: () => go('reveal') }, '戦果へ');
  const speedBtns = {};

  const board = createBoard(boardHost, battle, {
    onSelect: (i) => {
      selected = i;
      board.select(i);
      showDetail(player.index);
    },
  });

  function showDetail(frame) {
    clear(detail);
    if (selected < 0) {
      detail.append(h('p', { class: 'note' }, '駒をクリックすると詳細が出ます。'));
      return;
    }
    const bu = battle.units[selected];
    const u = battle.turns[frame].units[selected];
    if (!u.on) {
      detail.append(h('div', {}, h('b', {}, unitName(bu))), h('div', {}, 'まだ分かれていません（割合の軍令が働くと、残りの兵が守備隊になります）。'));
      return;
    }
    detail.append(
      h('div', {}, h('b', {}, unitName(bu))),
      h('div', {}, `兵数 ${u.troops} / ${u.mx}　士気 ${u.morale}`),
      h('div', {}, !u.alive ? '討死' : u.routed ? '潰走中' : u.morale <= 40 ? '動揺している' : '健在'),
      h(
        'div',
        { class: 'seal-line' },
        !u.alive || frame === 0
          ? ''
          : bu.twin && !u.routed
            ? '守備に徹している'
            : u.rule > (bu.baseFrom || 0) && frame <= 30
              ? `基本命令（${BASIC[bu.basic] ? BASIC[bu.basic].ja : ''}）で動いている`
              : u.rule > 0
            ? `いま動いている${frame > 30 ? '全体指揮' : '追加命令'}：${CIRCLED[u.rule]}（中身は封印）`
            : u.routed
              ? '軍令を無視して後退中'
              : 'どの条も当てはまらず待機',
      ),
    );
  }

  function showLog(frame) {
    clear(logBox);
    for (const l of buildLog(battle, frame)) logBox.append(h('li', { class: l.kind || '' }, l.text));
    logBox.scrollTop = logBox.scrollHeight;
  }

  function show(frame, animate) {
    const tr = battle.turns[frame];
    board.update(frame, animate);
    // 合戦内の時計（1ターン＝1秒）。決戦は決戦開始から数え直す
    const sd = frame > MAX_TURNS || (frame === MAX_TURNS && frames > MAX_TURNS + 1); // 30秒の時点で決戦が続くなら、決戦の時計を出す
    const total = sd ? SD_TURNS : MAX_TURNS;
    const now = sd ? frame - MAX_TURNS : frame;
    turnLabel.textContent = `${sd ? '決戦　' : ''}残り ${total - now}秒`;
    clockBar.style.width = `${Math.floor((now * 100) / total)}%`;
    clockBar.parentElement.classList.toggle('sd', sd);
    weatherLabel.textContent = tr.weather === 'pluvia' ? '☂ 雨' : '☀ 晴';
    weatherLabel.className = `weather ${tr.weather === 'pluvia' ? 'rain' : 'sun'}`;
    showLog(frame);
    showDetail(frame);
    revealBtn.classList.toggle('pulse', frame >= frames - 1);
  }

  const player = createPlayer({
    frameCount: frames,
    onFrame: (i, o) => show(i, !!o.animate),
    onState: (s) => {
      playBtn.textContent = s.playing ? '一時停止' : s.idx >= s.last ? 'もう一度' : '開始';
      for (const [k, b] of Object.entries(speedBtns)) b.classList.toggle('on', SPEEDS[k] === s.interval);
      board.setMoveMs(Math.floor(s.interval * 0.95));
    },
  });

  playBtn.addEventListener('click', () => (player.playing ? player.pause() : player.play()));
  const ctl = h(
    'div',
    { class: 'controls' },
    playBtn,
    h('button', { class: 'btn', onclick: () => player.step() }, '1秒送り'),
    h('button', { class: 'btn', onclick: () => player.toEnd() }, '最後まで'),
    h('button', { class: 'btn', onclick: () => player.restart() }, '最初から'),
    h(
      'span',
      { class: 'speed' },
      [['watch', '観戦'], ['normal', '通常'], ['fast', '高速']].map(([k, label]) => {
        speedBtns[k] = h('button', { class: 'btn small', onclick: () => player.setSpeed(SPEEDS[k]) }, label);
        return speedBtns[k];
      }),
    ),
  );

  root.append(
    h(
      'section',
      { class: 'screen battle' },
      h('div', { class: 'battle-head' }, h('h1', {}, '合戦'), turnLabel, clock, weatherLabel),
      h(
        'div',
        { class: 'battle-main' },
        h('div', { class: 'board-col' }, boardHost, ctl),
        h(
          'aside',
          { class: 'side-col' },
          h('h3', {}, '選んだ部隊'),
          detail,
          h('h3', {}, '実況'),
          logBox,
          h('div', { class: 'row-buttons' }, revealBtn),
          online ? null : h('button', { class: 'btn small', onclick: () => go('plan') }, '作戦をやり直す'),
        ),
      ),
    ),
  );

  const from = Math.min(state.battle.resumeFrom || 0, frames - 1);
  if (from > 0) player.seek(from);
  else show(0, false);
  // 決戦はじっくり見せる（観戦の速さで再生）
  player.setSpeed(from > 0 ? SPEEDS.watch : SPEEDS.normal);
  player.play();

  return () => {
    player.destroy();
    board.destroy();
  };
}
