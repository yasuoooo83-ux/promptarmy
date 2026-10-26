// 貼り付けられた軍令の解析・正規化・検査。
// 封印を守るため、エラーには「どの語が読めなかったか」を一切含めない。
import { GENUS_LIST } from './units.js';
import { CONDITIONS, ACTIONS, SCOPUS_SPECIAL, LOCUS_LIST, normWord, plain } from './vocab.js';

export const MAX_RULES = 5;
export const MAX_EXTRA_RULES = 4; // 追加命令（基本命令の前に足す条）の上限
export const NOTA_MAX = 200;

// コードブロック記号・スマート引用符・全角記号を処理して、JSON文字列を取り出す
export function extractJsonText(text) {
  let s = String(text);
  s = s.replace(/```[a-zA-Z0-9_-]*/g, ' ');
  s = s.replace(/[“”„‟「」]/g, '"');
  s = s.replace(/[‘’‚‛]/g, "'");
  // 全角ASCII（！〜～）を半角へ
  s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/　/g, ' ').replace(/、/g, ',');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  return s.slice(a, b + 1);
}

function tryParse(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    try {
      return JSON.parse(jsonText.replace(/,(\s*[}\]])/g, '$1'));
    } catch (e2) {
      return undefined;
    }
  }
}

function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// キーを小文字化・ダイアクリティカル除去して取り出す
function lowerKeys(o) {
  const out = {};
  for (const k of Object.keys(o)) out[plain(k)] = o[k];
  return out;
}

function toInt(v) {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return parseInt(v, 10);
  return NaN;
}

function intIn(v, lo, hi) {
  const n = toInt(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

function inList(v, list) {
  const w = normWord(v);
  return typeof w === 'string' && list.includes(w) ? w : null;
}

const SCOPUS_OK = [...SCOPUS_SPECIAL, ...GENUS_LIST];

// 条件を検査・正規化。読めなければ null
function normCond(raw) {
  if (raw === undefined || raw === null) return { res: 'semper' }; // si が無い条は「いつも」とみなす
  if (!isObj(raw)) return null;
  const o = lowerKeys(raw);
  const res = inList(o.res, CONDITIONS);
  if (!res) return null;
  switch (res) {
    case 'ante':
    case 'post': {
      const n = intIn(o.numerus, 1, 30);
      return n === null ? null : { res, numerus: n };
    }
    case 'hostis_prope': {
      const sp = intIn(o.spatium, 1, 8);
      if (sp === null) return null;
      const out = { res, spatium: sp };
      if (o.genus !== undefined && o.genus !== null && o.genus !== '') {
        const g = inList(o.genus, GENUS_LIST);
        if (!g) return null;
        out.genus = g;
      }
      return out;
    }
    case 'copiae_infra': {
      const p = intIn(o.pars, 1, 99);
      return p === null ? null : { res, pars: p };
    }
    case 'socius_infra': {
      const g = inList(o.genus, GENUS_LIST);
      const p = intIn(o.pars, 1, 99);
      return g && p !== null ? { res, genus: g, pars: p } : null;
    }
    case 'in_loco': {
      const l = inList(o.locus, LOCUS_LIST);
      return l ? { res, locus: l } : null;
    }
    default:
      return { res }; // semper / dux_in_periculo / pluvia
  }
}

function normScopus(v) {
  if (v === undefined || v === null || v === '') return 'proximus';
  return inList(v, SCOPUS_OK);
}

// 割合 pars：省略なら { ok:true, pars:0 }（全員）。1〜99 ならその割合、100 は「全員」。"50%" のような書き方も許す。
function normPars(v) {
  if (v === undefined || v === null || v === '') return { ok: true, pars: 0 };
  const s = typeof v === 'string' ? v.replace(/[%％]\s*$/, '') : v;
  const n = intIn(s, 1, 100);
  if (n === null) return { ok: false, pars: 0 };
  return { ok: true, pars: n === 100 ? 0 : n };
}

function withPars(out, o) {
  const p = normPars(o.pars);
  if (!p.ok) return null;
  if (p.pars > 0) out.pars = p.pars;
  return out;
}

// 行動を検査・正規化。読めなければ null
function normAction(raw) {
  if (!isObj(raw)) return null;
  const o = lowerKeys(raw);
  const actio = inList(o.actio, ACTIONS);
  if (!actio) return null;
  switch (actio) {
    case 'progredi':
    case 'impetus':
    case 'ferire':
    case 'circumire': {
      const s = normScopus(o.scopus);
      return s ? withPars({ actio, scopus: s }, o) : null;
    }
    case 'ire': {
      const hasLocus = o.locus !== undefined && o.locus !== null && o.locus !== '';
      const hasSocius = o.socius !== undefined && o.socius !== null && o.socius !== '';
      if (hasLocus) {
        const l = inList(o.locus, LOCUS_LIST);
        return l ? withPars({ actio, locus: l }, o) : null;
      }
      if (hasSocius) {
        const g = inList(o.socius, GENUS_LIST);
        return g ? withPars({ actio, socius: g }, o) : null;
      }
      return null;
    }
    case 'tueri': {
      const g = inList(o.socius, GENUS_LIST);
      return g ? withPars({ actio, socius: g }, o) : null;
    }
    default:
      return { actio }; // exspectare / recedere（割合は意味がないので無視する）
  }
}

// エラーコード → 利用者向けメッセージ（語の中身は含めない）
export function errorMessage(err) {
  switch (err.code) {
    case 'empty': return '軍令が貼り付けられていません。';
    case 'json': return '軍令を読み取れません（JSONの形になっていません）。AIにJSONのコードブロックだけを出してもらってください。';
    case 'legio': return 'この軍令は別の部隊用です。指示文をコピーし直してAIに頼んでください。';
    case 'genus': return 'この軍令は別の兵種用です。指示文をコピーし直してAIに頼んでください。';
    case 'count': return err.max ? `追加命令の数が合いません（1〜${err.max}条にしてください）。` : '軍令の数が合いません（1〜5条にしてください）。';
    case 'semper': return `第${err.rule}条が「いつも」になっています。追加命令は「〜なら」「〜秒まで」のような条件つきの条だけにして、AIに書き直してもらってください（いつもの動きは基本命令で選びます）。`;
    case 'rule': return `第${err.rule}条に読めない語があります。AIに「辞書にある語だけで書き直して」と頼んでください。`;
    case 'missing': return 'この部隊の軍令が見つかりません。AIに「全部隊ぶんを出して」と頼んでください。';
    default: return '軍令を読み取れません。';
  }
}

// 貼り付けられた文字列を解析する。
// expect = { slotId: 'W3', genus: 'equites' }（省略可。指定時は一致を検査）
// 戻り値: { ok, order, errors:[{code, rule?}] }
export function parseOrder(text, expect) {
  const errors = [];
  if (text === undefined || text === null || String(text).trim() === '') {
    return { ok: false, order: null, errors: [{ code: 'empty' }] };
  }
  const jt = extractJsonText(text);
  const data = jt === null ? undefined : tryParse(jt);
  if (!isObj(data)) return { ok: false, order: null, errors: [{ code: 'json' }] };

  const o = lowerKeys(data);
  const legio = typeof o.legio === 'string' ? o.legio.trim().toUpperCase() : '';
  // 全体指揮（決戦の号令）は genus = omnes。省略や同義語も許す
  const forAll = expect && expect.genus === 'omnes';
  const genus = forAll
    ? (o.genus === undefined || o.genus === null || o.genus === '' || normWord(o.genus) === 'omnes' ? 'omnes' : null)
    : inList(o.genus, GENUS_LIST);

  if (expect && expect.slotId && legio !== expect.slotId) errors.push({ code: 'legio' });
  if (expect && expect.genus && genus !== expect.genus) errors.push({ code: 'genus' });

  // 追加命令（expect.extra）：条件つきの条だけ、最大4条（後ろに基本命令が付く）
  const extra = !!(expect && expect.extra);
  const maxRules = extra ? MAX_EXTRA_RULES : MAX_RULES;
  const iussa = Array.isArray(o.iussa) ? o.iussa : null;
  if (!iussa || iussa.length < 1 || iussa.length > maxRules) {
    errors.push(extra ? { code: 'count', max: maxRules } : { code: 'count' });
  }

  const rules = [];
  if (iussa && iussa.length >= 1 && iussa.length <= maxRules) {
    iussa.forEach((r, k) => {
      if (!isObj(r)) {
        errors.push({ code: 'rule', rule: k + 1 });
        return;
      }
      const ro = lowerKeys(r);
      const si = normCond(ro.si);
      const fac = normAction(ro.fac);
      if (!si || !fac) errors.push({ code: 'rule', rule: k + 1 });
      else if (extra && si.res === 'semper') errors.push({ code: 'semper', rule: k + 1 });
      else rules.push({ si, fac });
    });
  }

  if (errors.length) return { ok: false, order: null, errors };

  let nota = typeof o.nota === 'string' ? o.nota : '';
  if (nota.length > NOTA_MAX) nota = nota.slice(0, NOTA_MAX);

  return {
    ok: true,
    order: { legio, genus, iussa: rules, nota },
    errors: [],
  };
}

// 【開発者用】読めなかった語を洗い出す（同義語表を育てるためのもの）。画面からは呼ばない（封印を守る）。
const FIELD_SETS = {
  res: CONDITIONS,
  actio: ACTIONS,
  scopus: SCOPUS_OK,
  socius: GENUS_LIST,
  genus: GENUS_LIST,
  locus: LOCUS_LIST,
};

export function unknownWords(text) {
  const jt = extractJsonText(text);
  const data = jt === null ? undefined : tryParse(jt);
  const out = [];
  if (!isObj(data)) return out;
  const o = lowerKeys(data);
  if (typeof o.genus === 'string' && !GENUS_LIST.includes(normWord(o.genus))) {
    out.push({ rule: 0, key: 'genus', value: o.genus });
  }
  const rules = Array.isArray(o.iussa) ? o.iussa : [];
  rules.forEach((r, k) => {
    if (!isObj(r)) return;
    const ro = lowerKeys(r);
    for (const part of ['si', 'fac']) {
      if (!isObj(ro[part])) continue;
      const po = lowerKeys(ro[part]);
      for (const key of Object.keys(FIELD_SETS)) {
        const v = po[key];
        if (typeof v !== 'string' || v === '') continue;
        if (!FIELD_SETS[key].includes(normWord(v))) out.push({ rule: k + 1, key, value: v });
      }
    }
  });
  return out;
}

// 一括入力：AIが全部隊の軍令をまとめて返したもの（{"legiones":[...]} または配列）を部隊ごとに検査する。
// expects = [{ slotId, genus }, ...]
// 戻り値: { ok: 全部隊が合格か, error: 全体のエラー（JSONでない等）|null, results: { slotId: parseOrder の結果 } }
export function parseBulk(text, expects) {
  if (text === undefined || text === null || String(text).trim() === '') {
    return { ok: false, error: { code: 'empty' }, results: {} };
  }
  let s = String(text).replace(/```[a-zA-Z0-9_-]*/g, ' ');
  // 配列で返ってきた場合も受け付ける
  const a = s.indexOf('[');
  const o = s.indexOf('{');
  let data;
  const jt = extractJsonText(s);
  if (a >= 0 && (o < 0 || a < o)) {
    const b = s.lastIndexOf(']');
    data = tryParse(extractJsonText('{"legiones":' + s.slice(a, b + 1) + '}') || '');
    if (!isObj(data) && jt !== null) data = tryParse(jt);
  } else {
    data = jt === null ? undefined : tryParse(jt);
  }
  if (!isObj(data)) return { ok: false, error: { code: 'json' }, results: {} };
  const top = lowerKeys(data);
  const list = Array.isArray(top.legiones) ? top.legiones
    : Array.isArray(top.iussa_omnium) ? top.iussa_omnium
      : Object.values(top).find((v) => Array.isArray(v) && v.some((x) => isObj(x) && 'legio' in lowerKeys(x)));
  if (!Array.isArray(list)) return { ok: false, error: { code: 'json' }, results: {} };
  const byLegio = {};
  for (const item of list) {
    if (!isObj(item)) continue;
    const it = lowerKeys(item);
    const id = typeof it.legio === 'string' ? it.legio.trim().toUpperCase() : '';
    if (id && !byLegio[id]) byLegio[id] = item;
  }
  const results = {};
  let all = true;
  for (const ex of expects) {
    const item = byLegio[ex.slotId];
    const r = item ? parseOrder(JSON.stringify(item), ex) : { ok: false, order: null, errors: [{ code: 'missing' }] };
    results[ex.slotId] = r;
    if (!r.ok) all = false;
  }
  return { ok: all, error: null, results };
}
