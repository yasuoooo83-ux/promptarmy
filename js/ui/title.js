import { h } from './dom.js';

export function renderTitle(root, { startLocal, startDemo }) {
  root.append(
    h(
      'section',
      { class: 'screen title' },
      h('h1', { class: 'logo' }, 'PROMPT ARMY'),
      h('p', { class: 'sub' }, '戦国版　〜 日本語の命令は、ラテン語に訳されて戦場へ 〜'),
      h(
        'ol',
        { class: 'howto' },
        h('li', {}, '部隊を布陣し、道具を1つ選び、基本命令を選ぶ（これだけで開戦できる）'),
        h('li', {}, '工夫したい部隊には、日本語で追加命令を書く'),
        h('li', {}, '「指示文」と一緒に、いつも使っているAI（ChatGPT・Gemini・Claudeなど）に貼る'),
        h('li', {}, 'AIが返したラテン語の軍令を、中身を読まずにゲームへ貼って封印する'),
        h('li', {}, '全員が封印したら開戦。部隊は軍令どおりに動く。見守るだけ'),
        h('li', {}, '合戦のあとは「戦況レポート」をAIに渡して作戦会議。作戦を直して、もう一戦！'),
      ),
      h(
        'div',
        { class: 'title-buttons' },
        h('button', { class: 'btn big', disabled: true, title: 'フェーズ3で実装予定' }, '合戦を開く（ルーム作成）'),
        h('button', { class: 'btn big', disabled: true, title: 'フェーズ3で実装予定' }, '合戦に加わる（ルームコード）'),
        h('button', { class: 'btn big primary', onclick: startDemo }, 'デモ（命令入力済み・すぐ開戦）'),
        h('button', { class: 'btn big', onclick: startLocal }, '一人で試す（ローカルモード）'),
      ),
      h('p', { class: 'note' }, 'オンライン対戦（ルーム）は準備中です。ローカルモードは1台のブラウザで、2人以上で囲んで遊べます。'),
    ),
  );
}
