// 早見表：命令を書く前に知っておきたいルールの一覧。数値はエンジンの値から作るので、調整しても食い違わない。
import { h } from './dom.js';
import { STATS, MATCHUP, TUNING, MAX_TURNS, TROOP_GENERA } from '../engine/units.js';
import { W, H, TERRAIN, SPEED_PCT, DEPLOY_COLS, isBase, TERRAIN_JA } from '../engine/map.js';
import { SD_TURNS, ROUT_AT, RECOVER_AT, BASE_HOLD_TURNS } from '../engine/sim.js';
import { ITEMS } from '../engine/items.js';

const ja = (g) => STATS[g].ja;
const MARK = { silva: '森', collis: '丘', flumen: '川', pons: '橋' };

function speedOf(g) {
  const mv = STATS[g].move;
  const cells = mv === 1 ? TUNING.footSpeedPct / 100 : mv;
  return `${cells}マス`;
}

// 相性表から「得意・苦手」の文
function matchupLines(g) {
  const good = [];
  const bad = [];
  for (const [d, p] of Object.entries(MATCHUP[g] || {})) {
    if (p > 100) good.push(`${ja(d)}に${p / 100}倍`);
    else if (p < 100) bad.push(`${ja(d)}には${p / 100}倍`);
  }
  for (const a of Object.keys(MATCHUP)) {
    const p = MATCHUP[a][g];
    if (p && p > 100) bad.push(`${ja(a)}から${p / 100}倍くらう`);
  }
  return [good.join('・') || '—', bad.join('・') || '—'];
}

const NOTE = {
  pedites: '安くて頑丈。数をそろえやすい',
  hastati: '動かずに構えると、騎馬の突撃を止めて1.5倍で反撃（槍衾）',
  equites: '速い。2マス以上走って斬り込むと1.5倍（突撃）。森・橋・川を通ると突撃にならない',
  sagittarii: `射程3マス。雨の日は威力${70}%`,
  sclopetarii: '射程2マス。威力は大きいが、撃った次の1秒は撃てない。雨の日は撃てない。撃たれた側は士気が大きく下がる',
  dux: '討たれたら負け。近く（2マス）の味方は士気が下がりにくい',
};

function unitTable() {
  const rows = [...TROOP_GENERA, 'dux'].map((g) => {
    const s = STATS[g];
    const [good, bad] = matchupLines(g);
    return h(
      'tr',
      {},
      h('th', {}, `${s.kanji} ${s.ja}`),
      h('td', {}, String(s.troops)),
      h('td', {}, String(s.atk)),
      h('td', {}, String(s.def)),
      h('td', {}, speedOf(g)),
      h('td', {}, s.range > 1 ? `${s.range}マス` : '接触'),
      h('td', {}, g === 'dux' ? '—' : String(s.cost)),
      h('td', { class: 'small' }, good),
      h('td', { class: 'small' }, bad),
      h('td', { class: 'small' }, NOTE[g]),
    );
  });
  return h(
    'table',
    { class: 'guide-table' },
    h('thead', {}, h('tr', {}, ['兵種', '兵数', '攻撃', '防御', '1秒の移動', '射程', 'コスト', '得意', '苦手', 'ひとこと'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows),
  );
}

function terrainTable() {
  const rows = [
    ['森', `${SPEED_PCT.silva}%`, `【伏兵】森の中で動かずにいる部隊は、敵から見えない（${TUNING.revealCells}マス以内に近づかれると見つかる）。見えない部隊は狙われず、撃たれない。森から出て最初の一撃は近接${TUNING.ambushPct / 100}倍・射撃${TUNING.ambushShotPct / 100}倍で、襲われた側は士気が大きく下がる。森の中の部隊が受ける射撃は半分。騎馬は森を通ると突撃できない`],
    ['丘', `${SPEED_PCT.collis}%`, `【構え】丘の上で動かずに構える部隊は、受ける近接ダメージ${TUNING.hillHoldPct}%・射撃ダメージ${TUNING.hillShotPct}%（動いていれば近接80%）。丘から撃つと射程+1マス。丘から下の敵へ斬り下ろすと${TUNING.downhillPct / 100}倍`],
    ['川', `${SPEED_PCT.flumen}%`, `【渡河】どこでも渡れるが遅い。川の中の部隊は射撃を${TUNING.riverShotPct / 100}倍・近接を1.3倍くらい、撃つこともできない。岸で動かず待ち構えて斬りかかると、さらに${TUNING.crossingPct / 100}倍`],
    ['橋', `${SPEED_PCT.pons}%`, `【橋の待ち伏せ】橋の上の部隊は射撃を${TUNING.bridgeShotPct / 100}倍・近接を${TUNING.bridgeMeleePct / 100}倍くらう。岸で動かず待ち構えて斬りかかると、さらに${TUNING.crossingPct / 100}倍。橋の手前に鉄砲を置くと強い。騎馬は橋を通ると突撃できない`],
    ['平地', `${SPEED_PCT.campus}%`, '—'],
  ];
  return h(
    'table',
    { class: 'guide-table' },
    h('thead', {}, h('tr', {}, ['地形', '進む速さ', '効果'].map((t) => h('th', {}, t)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('th', {}, r[0]), h('td', {}, r[1]), h('td', {}, r[2])))),
  );
}

// 縮尺つきの小さな地図（座標・本陣・布陣できる範囲）
function miniMap() {
  const grid = h('div', { class: 'guide-map' });
  grid.append(h('span', { class: 'gm-axis' }, ''));
  for (let x = 0; x < W; x++) grid.append(h('span', { class: 'gm-axis' }, String(x)));
  for (let y = 0; y < H; y++) {
    grid.append(h('span', { class: 'gm-axis' }, String(y)));
    for (let x = 0; x < W; x++) {
      const t = TERRAIN[y * W + x];
      const base = isBase('W', x, y) ? 'W' : isBase('E', x, y) ? 'E' : '';
      const zone = x <= DEPLOY_COLS.W[1] ? ' zW' : x >= DEPLOY_COLS.E[0] ? ' zE' : '';
      grid.append(h('span', { class: `gm t-${t}${zone}${base ? ' base-' + base : ''}`, title: `(${x},${y}) ${base ? '本陣' : TERRAIN_JA[t]}` }, base ? '陣' : MARK[t] || ''));
    }
  }
  return h(
    'div',
    { class: 'guide-map-wrap' },
    grid,
    h(
      'p',
      { class: 'small' },
      '1目盛り＝1マス。「距離3」＝3マス以内（斜めも同じくらい）。両軍の初期位置は約12マス離れている。',
      '下線のある左右6列が布陣できる範囲（橋の手前まで出せる）。',
    ),
  );
}

const ACTIONS = [
  ['前進', 'progredi', '目標へ近づく。途中でどの敵に接触しても、そこで止まって戦う。'],
  ['突撃', 'impetus', '目標へまっすぐ向かう。ほかの敵では止まらず、目標に接触して戦う。'],
  ['その場で攻撃', 'ferire', '動かない。弓・鉄砲は射程内の目標（いなければ一番近い敵）を撃つ。'],
  ['待機', 'exspectare', '動かない。撃たない。受けるダメージ80%。接触した敵とは戦う。'],
  ['移動', 'ire', '地形（森・丘・橋・本陣など）か、味方のそばへ移動する。'],
  ['後退', 'recedere', '一番近い敵から離れ、自陣の本陣の方へ下がる。'],
  ['護衛', 'tueri', '味方に接触している敵へ向かう。敵がいなければ味方のそばにいる。'],
  ['回り込む', 'circumire', '目標の、味方がいない側へ回り込んで攻撃する（挟み撃ちを作る）。'],
];

const CONDS = [
  ['いつも', '必ず当てはまる。最後の条に置くと「それ以外のとき」になる'],
  ['〜秒まで／〜秒たったら', '例：「10秒までは待機」「10秒たったら突撃」（10秒目までと、11秒目から。重ならない）'],
  ['敵が距離n以内', 'nマス以内に敵（兵種も指定できる）。例：騎馬が2マス以内なら'],
  ['自分の兵が〜%未満', '例：兵が3割を切ったら後退'],
  ['味方の〜が〜%未満', '例：大将が半分を切ったら護衛'],
  ['大将が危ない', '自軍の大将の2マス以内に敵がいる'],
  ['雨', '雨の区間（天気予報を見る）'],
  ['〜にいる', '森・丘・橋・川・平地・自陣の本陣・敵の本陣'],
];

export function guideView({ open = false } = {}) {
  return h(
    'details',
    { class: 'guide', open },
    h('summary', {}, '📜 早見表（命令を書く前に）'),
    h(
      'div',
      { class: 'guide-body' },
      h('h3', {}, '勝ち方'),
      h(
        'ul',
        {},
        h('li', {}, '敵の大将を討てば勝ち。'),
        h('li', {}, `敵の本陣に${BASE_HOLD_TURNS}秒続けて居座れば勝ち。`),
        h('li', {}, `合戦は${MAX_TURNS}秒。決まらなければ「決戦」。両軍が全軍への号令（全体指揮）を1つずつ出し、最大${SD_TURNS}秒戦う（30秒目の位置・兵力・士気をそのまま引き継ぐ。本戦で押し込んだ分がそのまま生きる）。それでも決まらなければ、残った兵の割合が多い方の勝ち。`),
      ),
      h('h3', {}, '基本命令と追加命令'),
      h(
        'ul',
        {},
        h('li', {}, '基本命令（選ぶだけ）：攻める／持ち場を守る／大将を守る／本陣を狙う。これだけで開戦できる。'),
        h('li', {}, '追加命令（任意・AIで訳す）：「10秒たったら突撃」「敵の騎馬が近づいたら突け」「兵が3割を切ったら退け」のような、時間や状況の条件つきの命令。最大4条。'),
        h('li', {}, '毎秒、追加命令の条を上から調べ、当てはまった条を実行する。どれにも当てはまらなければ基本命令で動く。'),
      ),
      h('h3', {}, '軍令の読まれ方'),
      h(
        'ul',
        {},
        h('li', {}, '毎秒、上の条から順に調べ、最初に当てはまった条だけを実行する。'),
        h('li', {}, '目標がいない条（例：敵に騎馬がいないのに「騎馬に突撃」）は飛ばされる。'),
        h('li', {}, '決戦の全体指揮は「いつも」も書ける（基本命令の代わりになる）。どの条にも当てはまらなければ、その場で待機。'),
        h('li', {}, '潰走中の部隊は、軍令を無視して後退する。'),
        h('li', {}, '「兵の半分だけ突撃、残りは守備」のように割合を書くと、部隊が二つに分かれる（残りは動かず守る）。'),
      ),
      h('h3', {}, '兵種'),
      unitTable(),
      h('h3', {}, '行動（命令で使える動き）'),
      h('table', { class: 'guide-table' }, h('tbody', {}, ACTIONS.map(([j, l, d]) => h('tr', {}, h('th', {}, j), h('td', { class: 'small latin' }, l), h('td', {}, d))))),
      h('h3', {}, '条件（「〜なら」に使えるもの）'),
      h('table', { class: 'guide-table' }, h('tbody', {}, CONDS.map(([j, d]) => h('tr', {}, h('th', {}, j), h('td', {}, d))))),
      h('h3', {}, '道具（各軍1つ）'),
      h('table', { class: 'guide-table' }, h('tbody', {}, Object.values(ITEMS).map((it) => h('tr', {}, h('th', {}, it.ja), h('td', {}, it.desc))))),
      h('h3', {}, '地形'),
      terrainTable(),
      miniMap(),
      h('h3', {}, '作戦のヒント（地の利）'),
      h(
        'ul',
        {},
        h('li', {}, '丘で構える：槍・足軽を丘に置いて「敵が目の前に来るまで待て」。その後ろに弓・鉄砲を置けば、前列が盾になる。'),
        h('li', {}, '森の伏兵：騎馬を森に置いて「敵が4マス以内に来たら突撃」。見えない所から飛び出す初撃は強烈。'),
        h('li', {}, '橋の待ち伏せ：橋の出口を槍で塞ぎ、横に鉄砲、後ろに弓。渡ってくる敵は大きな損害を受ける。射撃兵だけを前に出すと、斬り込まれて崩れる。'),
        h('li', {}, '「全員前進」だけの軍は、地の利を使う相手に負けやすい。逆に、守ってばかりの両軍がにらみ合うと30秒で決戦になる。'),
      ),
      h('h3', {}, '戦いの細かいルール'),
      h(
        'ul',
        {},
        h('li', {}, '近接は、接触（約1マス）している敵と戦う。射撃と近接は毎秒、両軍同時に解決される。'),
        h('li', {}, '挟み撃ち：同じ敵に2部隊以上で接触すると、ダメージ1.3倍。'),
        h('li', {}, '待機中の部隊が受けるダメージは80%。ただし待機中の弓・鉄砲は撃たない。'),
        h('li', {}, `弓・鉄砲は、動きながら撃つと威力${TUNING.moveShotPct}%。止まって撃つ方が強い。`),
        h('li', {}, `士気（最大70）：兵を失うと下がり、斬り合うたびに${TUNING.meleeFatigue}下がる。鉄砲に撃たれると−5、近くの味方が壊滅すると−10。被害のない1秒ごとに+3。`),
        h('li', {}, `士気${ROUT_AT}以下で潰走（後退し続ける）。${RECOVER_AT}以上に戻ると立て直す。大将の2マス以内なら士気の下がり方は半分。`),
        h('li', {}, '天気は5秒ごとに変わる。天気予報は作戦画面の上に出ている。'),
      ),
    ),
  );
}
