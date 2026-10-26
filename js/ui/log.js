// 合戦の記録（イベント）から実況ログを作る
import { unitName } from './names.js';

const REASON_JA = {
  dux: '大将、討死',
  base: '本陣を3秒占拠',
  time: '時間切れ・残存兵数の割合で決着',
};

// 合戦内の時刻（1ターン＝1秒）。決戦は決戦開始から数える
export function clockLabel(t) {
  return t > 30 ? `決戦${t - 30}秒` : `${t}秒`;
}
function pad(t) {
  return clockLabel(t);
}

export function formatEvent(ev, t, byId) {
  const nm = (id) => unitName(byId[id]);
  switch (ev.type) {
    case 'rain':
      return `${pad(t)} 雨。鉄砲が沈黙する`;
    case 'charge':
      return `${pad(t)} ${nm(ev.a)}、${nm(ev.b)}へ突撃！`;
    case 'ambush':
      return `${pad(t)} ${nm(ev.a)}、伏兵として${nm(ev.b)}に襲いかかる！`;
    case 'fence':
      return `${pad(t)} ${nm(ev.b)}、馬防柵で騎馬の突撃を止めた`;
    case 'yarisashi':
      return `${pad(t)} ${nm(ev.b)}、槍衾で騎馬を受け止めた`;
    case 'split':
      return `${pad(t)} ${nm(ev.a)}、兵の${ev.pars}%で攻め、残りは守備に就く`;
    case 'pending':
      return `${pad(t)} 決着つかず。両軍、全体指揮を！`;
    case 'suddenDeath':
      return `${pad(t)} 決戦開始！両軍、陣を立て直して全体指揮に従う`;
    case 'rout':
      return `${pad(t)} ${nm(ev.a)}、潰走`;
    case 'recover':
      return `${pad(t)} ${nm(ev.a)}、立て直した`;
    case 'destroyed':
      return byId[ev.a].genus === 'dux' ? `${pad(t)} ${nm(ev.a)}、討死` : `${pad(t)} ${nm(ev.a)}、壊滅`;
    case 'result': {
      const why = REASON_JA[ev.reason];
      if (ev.winner === 'draw') return `${pad(t)} 引き分け（${why}）`;
      return `${pad(t)} ${ev.winner === 'W' ? '西軍' : '東軍'}の勝利！（${why}）`;
    }
    default:
      return null;
  }
}

// 1〜upTo ターンまでのログ行
export function buildLog(battle, upTo) {
  const byId = {};
  battle.units.forEach((u) => { byId[u.id] = u; });
  const lines = [{ t: 0, text: `${pad(0)} 合戦開始` }];
  for (let k = 1; k <= upTo && k < battle.turns.length; k++) {
    for (const ev of battle.turns[k].events) {
      const text = formatEvent(ev, k, byId);
      if (text) lines.push({ t: k, text, kind: ev.type });
    }
  }
  return lines;
}
