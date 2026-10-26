// ラテン語辞書・同義語表・日本語訳。同義語は後から追加できる（SYNONYMS に足すだけ）。
import { GENUS_LIST, STATS } from './units.js';

export const CONDITIONS = [
  'semper', 'ante', 'post', 'hostis_prope', 'copiae_infra',
  'socius_infra', 'dux_in_periculo', 'pluvia', 'in_loco',
];
export const ACTIONS = [
  'progredi', 'impetus', 'ferire', 'exspectare', 'ire', 'recedere', 'tueri', 'circumire',
];
export const SCOPUS_SPECIAL = ['proximus', 'infirmissimus', 'dux'];
export const LOCUS_LIST = ['silva', 'collis', 'pons', 'flumen', 'campus', 'castra', 'castra_hostium'];

export const LOCUS_JA = {
  silva: '森', collis: '丘', pons: '橋', flumen: '川', campus: '平地',
  castra: '自陣の本陣', castra_hostium: '敵の本陣',
};

// 正規形 → 受け付ける揺れ
export const SYNONYMS = {
  // 行動
  impetus: ['impetum', 'impetum_facere', 'impetus_facere', 'irrumpere', 'oppugnare', 'invadere'],
  progredi: ['progredere', 'progredimini', 'procedere', 'prodire', 'progressus', 'progredior', 'avancer'],
  exspectare: ['expectare', 'exspecta', 'expecta', 'manere', 'mane', 'manete', 'exspectate', 'stare', 'sta'],
  recedere: ['recede', 'recedite', 'se_recipere', 'receptus', 'retro_ire', 'refugere', 'fugere'],
  ferire: ['feri', 'ferite', 'iacere', 'sagittare', 'mittere', 'petere', 'pugnare', 'oppugna'],
  ire: ['ite', 'i', 'movere', 'se_movere', 'proficiscere', 'pergere'],
  tueri: ['tuere', 'tuemini', 'defendere', 'protegere', 'custodire', 'tutari'],
  circumire: ['circumi', 'circumite', 'circumvenire', 'circuire', 'circumagere'],
  // 兵種
  equites: ['eques', 'equitatus', 'equitum', 'equitibus'],
  sclopetarii: ['sclopetarius', 'sclopetari', 'arcabusarii', 'tormentarii', 'tormentarius', 'sclopeti', 'sclopetum'],
  sagittarii: ['sagittarius', 'arcuarii', 'sagittari', 'sagittarum'],
  hastati: ['hastatus', 'hastarii', 'hastari', 'hastatorum'],
  pedites: ['pedes', 'peditatus', 'peditum', 'peditibus'],
  dux: ['duces', 'ductor', 'imperator', 'dux_hostium'],
  omnes: ['omnis', 'omnia', 'exercitus', 'universi', 'cuncti', 'totus_exercitus', 'all', 'tota_acies'],
  // 目標
  proximus: ['proximum', 'proxima', 'proximi', 'hostis_proximus', 'proximus_hostis'],
  infirmissimus: ['infirmissimum', 'infirmissima', 'infirmus', 'debilissimus'],
  // 条件
  semper: ['semper_et', 'omni_tempore', 'sempre'],
  ante: ['usque', 'ad'],
  post: ['postea', 'a'],
  hostis_prope: ['hostis_propinquus', 'hostes_prope', 'hostis_proximus_prope', 'hostes_propinqui'],
  copiae_infra: ['copiae_pauciores', 'copiae_minus', 'copia_infra'],
  socius_infra: ['socii_infra', 'socius_debilis'],
  dux_in_periculo: ['dux_periclitatur', 'dux_in_periculum', 'dux_periculo'],
  pluvia: ['pluvius', 'imber', 'pluit'],
  in_loco: ['in_locum', 'in_loci'],
  // 地形
  silva: ['silvae', 'silvam', 'silvis'],
  collis: ['collem', 'colle', 'collibus', 'mons'],
  pons: ['pontem', 'ponte', 'pontes'],
  flumen: ['flumine', 'fluminis', 'fluvius', 'flumina'],
  campus: ['campum', 'campo', 'planities', 'campi'],
  castra: ['castra_nostra', 'castrum'],
  castra_hostium: ['castra_hostis', 'castra_hostilia'],
};

const SYN_MAP = {};
for (const canon of Object.keys(SYNONYMS)) {
  SYN_MAP[canon] = canon;
  for (const w of SYNONYMS[canon]) {
    if (SYN_MAP[w] === undefined) SYN_MAP[w] = canon;
  }
}

// 小文字化・ダイアクリティカルマーク除去・空白とハイフンを _ に
export function plain(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, '_');
}

// 語を正規形に寄せる（知らない語はそのまま返す）
export function normWord(v) {
  if (typeof v !== 'string') return v;
  const p = plain(v);
  return SYN_MAP[p] !== undefined ? SYN_MAP[p] : p;
}

// ---- 日本語訳（辞書から機械的に作る。AIは使わない） ----
const gJa = (g) => (STATS[g] ? STATS[g].ja : String(g));

export function scopusJa(s) {
  if (s === undefined || s === null || s === 'proximus') return '最も近い敵';
  if (s === 'infirmissimus') return '最も兵の少ない敵';
  if (s === 'dux') return '敵の大将';
  return `敵の${gJa(s)}`;
}

export function condJa(si) {
  switch (si.res) {
    case 'semper': return 'いつも';
    case 'ante': return `${si.numerus}秒まで`;
    case 'post': return `${si.numerus}秒たったら`;
    case 'hostis_prope':
      return si.genus ? `敵の${gJa(si.genus)}が距離${si.spatium}以内` : `敵が距離${si.spatium}以内`;
    case 'copiae_infra': return `自分の兵が${si.pars}%未満`;
    case 'socius_infra': return `味方の${gJa(si.genus)}が${si.pars}%未満`;
    case 'dux_in_periculo': return '大将が危ない（大将の距離2以内に敵）';
    case 'pluvia': return '雨';
    case 'in_loco': return `${LOCUS_JA[si.locus] || si.locus}にいる`;
    default: return String(si.res);
  }
}

export function actionJa(fac) {
  const base = actionJaBase(fac);
  return fac.pars > 0 && fac.pars < 100 ? `兵の${fac.pars}%が${base}（残りは守備）` : base;
}

function actionJaBase(fac) {
  switch (fac.actio) {
    case 'progredi': return `${scopusJa(fac.scopus)}へ前進`;
    case 'impetus': return `${scopusJa(fac.scopus)}に突撃`;
    case 'ferire': return `${scopusJa(fac.scopus)}を攻撃`;
    case 'exspectare': return '待機';
    case 'ire':
      return fac.locus ? `${LOCUS_JA[fac.locus] || fac.locus}へ移動` : `味方の${gJa(fac.socius)}の隣へ移動`;
    case 'recedere': return '後退';
    case 'tueri': return `味方の${gJa(fac.socius)}を護衛`;
    case 'circumire': return `${scopusJa(fac.scopus)}の側面へ回り込む`;
    default: return String(fac.actio);
  }
}

export function ruleJa(rule) {
  return `${condJa(rule.si)} → ${actionJa(rule.fac)}`;
}

// ---- 翻訳用指示文に埋め込む辞書 ----
export function buildDictionaryText() {
  const g = GENUS_LIST.map((k) => `| ${k} | ${STATS[k].ja} |`).join('\n');
  const loc = LOCUS_LIST.map((k) => `| ${k} | ${LOCUS_JA[k]} |`).join('\n');
  return [
    '■ 条件 si（"res" に入れる語）',
    '| ラテン語 | 日本語 | 追加の値 |',
    '|---|---|---|',
    '| semper | いつも | なし |',
    '| ante | 〜秒まで（開戦からn秒の間。決戦の号令では決戦開始から） | "numerus": 1〜30 |',
    '| post | 〜秒たったら（開戦からn秒が過ぎたあと。決戦の号令では決戦開始から） | "numerus": 1〜30 |',
    '| hostis_prope | 敵が近い | "spatium": 1〜8（マス数）、"genus": 兵種（省略可） |',
    '| copiae_infra | 自分の兵が減った | "pars": 1〜99（％未満） |',
    '| socius_infra | 味方が減った | "genus": 兵種（必須。大将は dux）、"pars": 1〜99 |',
    '| dux_in_periculo | 自軍の大将が危ない | なし |',
    '| pluvia | 雨 | なし |',
    '| in_loco | 〜にいる | "locus": 地形 |',
    '',
    '■ 行動 fac（"actio" に入れる語）',
    '| ラテン語 | 日本語 | 追加の値 |',
    '|---|---|---|',
    '| progredi | 前進（目標へ近づく） | "scopus": 目標（省略時 proximus）、"pars"（省略可） |',
    '| impetus | 突撃（目標の隣へ行って攻撃） | "scopus": 目標、"pars"（省略可） |',
    '| ferire | その場で射撃・攻撃（動かず、弓・鉄砲は撃つ） | "scopus": 目標、"pars"（省略可） |',
    '| exspectare | 待機（動かず、撃たず、身を固めて守る） | なし |',
    '| ire | 移動 | "locus": 地形、または "socius": 味方の兵種、"pars"（省略可） |',
    '| recedere | 後退（敵から離れる） | なし |',
    '| tueri | 味方を護衛 | "socius": 味方の兵種（大将は dux）、"pars"（省略可） |',
    '| circumire | 回り込む（側面から攻撃） | "scopus": 目標、"pars"（省略可） |',
    '',
    '■ 割合 "pars"（fac の中に書く。1〜99の整数）',
    '「兵の半分だけ突撃、残りは守備」のように、部隊の一部だけに行動させたいときに使う。',
    'pars を書いた条が初めて働くと、部隊は二つに分かれる。pars％の兵がその行動をとり、残りは動かず守備に就く。',
    '例：半分が突撃 → {"actio":"impetus","scopus":"proximus","pars":50}',
    '全員が行動するなら pars は書かない。',
    '',
    '■ 目標 scopus',
    '| ラテン語 | 日本語 |',
    '|---|---|',
    '| proximus | 最も近い敵 |',
    '| infirmissimus | 最も兵の少ない敵 |',
    '| dux | 敵の大将 |',
    '| 兵種名 | その兵種のうち最も近い敵 |',
    '',
    '■ 兵種名（"genus" "scopus" "socius" に入れる語）',
    '| ラテン語 | 日本語 |',
    '|---|---|',
    g,
    '',
    '■ 地形 locus',
    '| ラテン語 | 日本語 |',
    '|---|---|',
    loc,
  ].join('\n');
}
