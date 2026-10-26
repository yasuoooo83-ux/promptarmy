// 兵種の基本値と相性表（初期値。調整した場合は BALANCE.md に理由を記録する）
export const MAX_TURNS = 30; // 本戦のターン数。画面では「30秒の合戦」（1ターン＝合戦内の1秒）

// 調整可能な補正値（％）。変更したら BALANCE.md に理由を記録する。
export const TUNING = {
  waitPct: 80, // 待機中の部隊が受けるダメージ
  waitShoots: 0, // 1なら待機中の弓・鉄砲も射撃する／0なら待機中は撃たない（射撃は ferire などの行動のとき）
  dmgPct: 150, // 全ダメージの倍率（v0.3：膠着を減らすため）
  footSpeedPct: 150, // 移動1の兵種の速さ（1マス=100%。v0.3：最初の接触を早めるため）
  sdDmgPct: 100, // 決戦（サドンデス）中のダメージの倍率（v0.4.1：1.5倍だと数ターンで終わってしまうので等倍に）
  sdTurns: 10, // 決戦の最大ターン数（v0.7：本戦の状況を引き継ぐので10秒で足りる）
  sdDuxPct: 100, // 決戦中に大将が受けるダメージ（特別扱いなし）
  sdSpeedPct: 100, // 決戦中の移動の速さ（v0.7：急行軍はやめた。本戦の位置取りを生かすため）
  meleeFatigue: 3, // 近接で斬り合ったターンごとに減る士気（v0.3：乱戦で崩れる側をはっきりさせる）
  // ---- 地の利（v0.4）----
  hillHoldPct: 60, // 丘の上で動かずに構える部隊が受ける近接ダメージ（動いていれば 80）
  hillShotPct: 75, // 丘の上で動かずに構える部隊が受ける射撃ダメージ
  downhillPct: 120, // 丘の上から、丘でない場所の敵へ斬り下ろすとき
  ambushPct: 160, // 森に伏せていた部隊の初撃（近接）
  ambushShotPct: 130, // 森に伏せていた部隊の初撃（射撃）
  ambushShock: 10, // 伏兵に襲われた側の士気の追加低下
  revealCells: 2, // 伏兵はこのマス数以内に近づかれると見つかる
  moveShotPct: 60, // 動きながら撃つとき（そのターンに進んだ弓・鉄砲）。止まって撃つ方が強い
  riverShotPct: 150, // 川を渡っている敵への射撃
  bridgeShotPct: 140, // 橋を渡っている敵への射撃
  bridgeMeleePct: 120, // 橋の上の敵への近接
  crossingPct: 130, // 岸で動かずに待ち構えて、川・橋の上の敵を討つとき（近接）
  // ---- 道具（v0.6）----
  wallPct: 70, // 石垣の上の味方が受けるダメージ
  wallSlowPct: 30, // 敵が石垣を越える速さ
  fenceSlowPct: 40, // 敵が馬防柵を越える速さ
  fencePct: 50, // 柵の所にいる味方を、騎馬が攻撃するときの威力（突撃は無効）
  fenceMeleePct: 65, // 柵の所にいる味方を、騎馬以外が斬りつけるときの威力
  fenceShotPct: 85, // 柵の所にいる味方が受ける射撃
  fenceFirePct: 120, // 柵の所から撃つ弓・鉄砲の威力
  towerRevealCells: 4, // 物見櫓が伏兵を見破る距離
  towerRangeCells: 2, // 物見櫓のこの距離以内の弓・鉄砲は射程+1
  towerShotPct: 110, // 物見櫓のそばの弓・鉄砲の威力
  drumPct: 80, // 陣太鼓：士気の下がり方
  drumAtkPct: 112, // 陣太鼓：士気が40以上の間、与えるダメージ
};
export const BUDGET = 500;
export const MAX_UNITS = 6;

export const GENUS_LIST = ['pedites', 'hastati', 'equites', 'sagittarii', 'sclopetarii', 'dux'];
// 編成で選べる兵種（大将を除く）
export const TROOP_GENERA = ['pedites', 'hastati', 'equites', 'sagittarii', 'sclopetarii'];

export const STATS = {
  pedites:     { ja: '足軽',   kanji: '足', troops: 100, atk: 10, def: 8,  move: 1, range: 1, cost: 60 },
  hastati:     { ja: '槍隊',   kanji: '槍', troops: 100, atk: 10, def: 9,  move: 1, range: 1, cost: 80 },
  equites:     { ja: '騎馬隊', kanji: '騎', troops: 90,  atk: 16, def: 6,  move: 3, range: 1, cost: 120 },
  sagittarii:  { ja: '弓隊',   kanji: '弓', troops: 80,  atk: 8,  def: 4,  move: 1, range: 3, cost: 80 },
  sclopetarii: { ja: '鉄砲隊', kanji: '銃', troops: 80,  atk: 20, def: 4,  move: 1, range: 2, cost: 120 },
  dux:         { ja: '大将',   kanji: '将', troops: 120, atk: 10, def: 12, move: 1, range: 1, cost: 0 },
};

export function isRanged(genus) {
  return genus === 'sagittarii' || genus === 'sclopetarii';
}

// 攻撃側 → 防御側 の相性（％）。表にない組み合わせは100。
export const MATCHUP = {
  pedites:     { sagittarii: 120, sclopetarii: 120, dux: 120 },
  hastati:     { equites: 200 },
  equites:     { pedites: 120, hastati: 50, sagittarii: 150, sclopetarii: 150, dux: 120 },
  sagittarii:  { pedites: 120, hastati: 200 },
  sclopetarii: { equites: 130 },
  dux:         {},
};

export function matchup(att, def) {
  const row = MATCHUP[att];
  return (row && row[def]) || 100;
}

// 編成の合計コスト（大将は含まない）
export function armyCost(genera) {
  let c = 0;
  for (const g of genera) c += STATS[g].cost;
  return c;
}
