// オンライン対戦：ルームで相手を待つ画面と、封印したあと相手を待つ画面。
import { h } from './dom.js';
import { SIDE_JA } from './names.js';

export const ROUND_MODE_JA = { first: '最初の合戦', same: '作戦を直して再戦（同じ天候）', new: '作戦を直して再戦（新しい天候）', lobby: '陣立てからやり直す' };

function who(o, side) {
  const n = o.names && o.names[side];
  return `${SIDE_JA[side]}${n ? '（' + n + '）' : ''}`;
}

export function renderRoom(root, { online }) {
  const o = online;
  const both = o.room && o.room.players && o.room.players.W && o.room.players.E;
  root.append(
    h(
      'section',
      { class: 'screen room' },
      h('h1', {}, '合戦のルーム'),
      h('div', { class: 'room-code' }, h('span', {}, 'ルームコード'), h('b', {}, o.code)),
      h('p', {}, `あなたは ${who(o, o.side)} です。`),
      both
        ? h('p', {}, '両軍がそろいました。陣立てへ進みます…')
        : h('p', { class: 'note' }, 'このコードを相手に伝えてください。相手が「合戦に加わる」でコードを入れると、自動で陣立てに進みます。'),
      h('div', { class: 'row-buttons' }, h('button', { class: 'btn', onclick: () => o.leave() }, 'ルームを出る')),
    ),
  );
}

// 封印したあと、相手の封印を待つ
export function renderWait(root, { online }) {
  const o = online;
  const cmd = o.waitFor === 'cmd';
  const sealKey = cmd ? 'cmdSeal' : 'seal';
  const status = h('div', { class: 'wait-status' });
  const draw = () => {
    status.textContent = '';
    const rd = o.round() || {};
    for (const s of ['W', 'E']) {
      const sealed = rd[sealKey] && rd[sealKey][s];
      const sent = rd[cmd ? 'cmd' : 'plan'] && rd[cmd ? 'cmd' : 'plan'][s];
      status.append(
        h(
          'div',
          { class: `wait-row side-${s}` },
          h('b', {}, who(o, s) + (s === o.side ? '（あなた）' : '')),
          h('span', { class: sealed ? 'seal' : 'note' }, sent ? '封印を開いた ✓' : sealed ? '封印済み ✓' : cmd ? '全体指揮を書いています…' : '作戦を練っています…'),
        ),
      );
    }
  };
  draw();
  o.onRoom(draw);
  root.append(
    h(
      'section',
      { class: 'screen wait' },
      h('h1', {}, cmd ? '決戦 ― 相手の号令を待つ' : '封印 ― 相手を待つ'),
      h('p', {}, '両軍が封印したら、同時に封印を開いて合戦が始まります。相手の作戦は、両軍がそろうまで送られません。'),
      status,
      h(
        'div',
        { class: 'row-buttons' },
        h('button', { class: 'btn', onclick: () => o.unseal().catch((e) => alertLine(root, e)) }, cmd ? '封印を解いて号令を書き直す' : '封印を解いて作戦に戻る'),
      ),
      h('p', { class: 'note small' }, `ルーム ${o.code}`),
    ),
  );
}

function alertLine(root, e) {
  root.append(h('p', { class: 'status bad' }, `封印を解けませんでした（もう封印が開かれています）：${(e && e.message) || e}`));
}
