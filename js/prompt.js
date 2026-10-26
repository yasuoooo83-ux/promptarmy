// 翻訳用指示文の生成。ゲーム画面の「指示文をコピー」で使う。
import { STATS } from './engine/units.js';
import { buildDictionaryText } from './engine/vocab.js';
import { BASIC } from './engine/basic.js';

const EXAMPLE_IUSSA = [
  { si: { res: 'hostis_prope', genus: 'sclopetarii', spatium: 4 }, fac: { actio: 'impetus', scopus: 'sclopetarii' } },
  { si: { res: 'ante', numerus: 5 }, fac: { actio: 'exspectare' } },
  { si: { res: 'semper' }, fac: { actio: 'progredi', scopus: 'proximus' } },
];
const EXAMPLE_NOTA = 'Equites tormentarios hostium petunt; antea in loco manent.';

const RULES = [
  '【守ること】',
  '- 出力はJSONのコードブロック1つだけ。日本語の説明は一切書かない。',
  '- 辞書にない語、辞書にない行動は使わない。命令に無理がある部分は、辞書の範囲で最も近い意味にする。',
  '- 軍令は最大5条。上の条ほど優先される（上から順に調べ、最初に当てはまった条だけを実行する）。命令が長いときは大事なものを優先して5条に収める。',
  '- 私の命令にない行動を勝手に足さない。最後の条は {"si":{"res":"semper"}, "fac":{…}} の形にすることを勧める。',
  '- "nota" に、どう解釈したかをラテン語で短く書く（200文字以内）。',
];

// 追加命令モード：基本命令はゲーム側が持つ。AIは「条件つきの条」だけを書く
const EXTRA_RULES = [
  '【追加命令の決まり】（この部隊にはゲーム側で「基本命令」が決まっています）',
  '- あなたが書くのは、基本命令より優先したい「条件つきの条」だけ（最大4条）。',
  '- "si" に "semper"（いつも）を使ってはいけない。いつもの動きは基本命令が担当する。',
  '- どの条にも当てはまらないとき、部隊は基本命令どおりに動く。',
  '- 時間は「秒」。合戦は30秒（1秒ごとに軍令を調べる）。「10秒まで」は ante 10、「10秒たったら」は post 10。',
];
const EXTRA_EXAMPLE = [
  { si: { res: 'copiae_infra', pars: 30 }, fac: { actio: 'ire', locus: 'castra' } },
  { si: { res: 'hostis_prope', genus: 'equites', spatium: 2 }, fac: { actio: 'impetus', scopus: 'equites' } },
];

function genusLine(genus) {
  return genus === 'omnes'
    ? 'omnes（全軍への号令＝全体指揮。大将も含む全部隊が、この軍令に従う）'
    : `${genus}（${STATS[genus].ja}）`;
}

// order: 入力欄の日本語の命令。空なら、書き込み用の案内文が入る。
// basic: 基本命令（attack など）を渡すと「追加命令」モード（条件つきの条だけ・最大4条）になる。
export function buildPrompt(slotId, genus, order = '', basic = null) {
  const jp = String(order).trim();
  const extra = !!basic;
  const example = { legio: slotId, genus, iussa: extra ? EXTRA_EXAMPLE : EXAMPLE_IUSSA, nota: EXAMPLE_NOTA };
  return [
    'あなたは戦国合戦ゲーム「PROMPT ARMY」の軍師です。',
    extra
      ? '私が日本語で書いた「追加命令」を、下の辞書にある語だけを使って、ラテン語の軍令（JSON）に翻訳してください。'
      : '私が日本語で書いた命令を、下の辞書にある語だけを使って、ラテン語の軍令（JSON）に翻訳してください。',
    '',
    ...RULES,
    ...(extra ? ['', ...EXTRA_RULES] : []),
    '',
    '【私の部隊】',
    `legio: ${slotId}`,
    `genus: ${genusLine(genus)}`,
    ...(extra ? [`基本命令: ${BASIC[basic].ja}（${BASIC[basic].desc}）`] : []),
    '',
    '【辞書】',
    buildDictionaryText(),
    '',
    '【出力の形】（形の例です。中身は私の命令に合わせて作り直してください）',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '',
    '【私の命令】',
    jp || 'ここに日本語で命令を書いてください。',
    '',
  ].join('\n');
}

// 一括入力用：1つの軍の、追加命令のある部隊ぶんの軍令を、まとめて1つのJSONで返してもらう。
// units = [{ id: 'W0', genus: 'dux', basic: 'hold' }, ...]、orders = 日本語の追加命令（部隊ごとの見出し付きの文章）
export function buildBulkPrompt(units, orders = '') {
  const jp = String(orders).trim();
  const extra = units.some((u) => u.basic);
  const example = {
    legiones: units.slice(0, 2).map((u, k) => ({
      legio: u.id,
      genus: u.genus,
      iussa: extra ? [EXTRA_EXAMPLE[k]] : k === 0 ? [EXAMPLE_IUSSA[2]] : EXAMPLE_IUSSA,
      nota: k === 0 ? 'Progrediuntur.' : EXAMPLE_NOTA,
    })),
  };
  return [
    'あなたは戦国合戦ゲーム「PROMPT ARMY」の軍師です。',
    extra
      ? '私が日本語で書いた、各部隊への「追加命令」を、下の辞書にある語だけを使って、ラテン語の軍令（JSON）に翻訳してください。'
      : '私が日本語で書いた、各部隊への命令を、下の辞書にある語だけを使って、ラテン語の軍令（JSON）に翻訳してください。',
    `部隊は${units.length}つあります。部隊ごとに別々の軍令を作り、1つのJSONにまとめてください。`,
    '',
    ...RULES,
    ...(extra ? ['', ...EXTRA_RULES] : []),
    `- "legiones" の中に、下の${units.length}部隊すべての軍令を必ず入れる（1部隊に1つ。legio と genus は下の表のとおり）。`,
    '- 「全軍」「みんな」など全部隊に向けた命令は、すべての部隊の軍令に反映する。',
    '',
    '【私の部隊】',
    extra ? '| legio | genus | 基本命令 |' : '| legio | genus |',
    extra ? '|---|---|---|' : '|---|---|',
    ...units.map((u) => (extra ? `| ${u.id} | ${genusLine(u.genus)} | ${BASIC[u.basic].ja} |` : `| ${u.id} | ${genusLine(u.genus)} |`)),
    '',
    '【辞書】',
    buildDictionaryText(),
    '',
    '【出力の形】（形の例です。部隊の数・中身は私の命令に合わせて作り直してください）',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    '',
    '【私の命令】',
    jp || 'ここに日本語で命令を書いてください。',
    '',
  ].join('\n');
}
