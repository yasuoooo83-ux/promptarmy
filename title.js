import { h } from './dom.js';

// Firebase のエラーを、直し方の分かる日本語に
function friendly(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/network-request-failed/.test(m)) return 'Firebaseにつながりません。インターネット接続と、設定（apiKey）を確かめてください。';
  if (/operation-not-allowed|admin-restricted/.test(m)) return 'Firebaseの「匿名ログイン」が有効になっていません（Authentication → ログイン方法 → 匿名）。';
  if (/api-key-not-valid|invalid-api-key/.test(m)) return 'Firebaseの設定（apiKey）が正しくありません。';
  if (/PERMISSION_DENIED|permission/i.test(m) && !/ルーム/.test(m)) return 'データベースに書き込めません。Realtime Database のルール（database.rules.json）を公開したか確かめてください。';
  return String((e && e.message) || e);
}

export function renderTitle(root, { startLocal, startDemo, createRoom, joinRoom, resumeRoom, savedRoom }) {
  const status = h('div', { class: 'status' });
  const name = h('input', { class: 'owner', type: 'text', maxLength: 12, placeholder: 'あなたの名前（任意）' });
  const code = h('input', { class: 'room-input', type: 'text', inputMode: 'numeric', maxLength: 4, placeholder: 'ルームコード（4けた）' });
  try { name.value = localStorage.getItem('prompt-army-name') || ''; } catch (e) { /* なし */ }
  const run = async (fn) => {
    try { localStorage.setItem('prompt-army-name', name.value.trim()); } catch (e) { /* なし */ }
    status.className = 'status';
    status.textContent = 'つないでいます…';
    try {
      await fn();
    } catch (e) {
      status.className = 'status bad';
      status.textContent = friendly(e);
    }
  };

  // Firebase の設定（firebase-config.js が空のときに、このブラウザだけで使う設定を貼る）
  const cfgArea = h('textarea', { rows: 6, spellcheck: false, placeholder: 'Firebaseコンソールの firebaseConfig = { ... } をそのまま貼る' });
  const cfgStatus = h('span', { class: 'note' });
  try {
    const cur = localStorage.getItem('prompt-army-firebase');
    if (cur) cfgStatus.textContent = `設定済み（${JSON.parse(cur).projectId}）`;
  } catch (e) { /* なし */ }
  const cfgBox = h(
    'details',
    { class: 'dev' },
    h('summary', {}, 'Firebaseの設定（オンライン対戦の準備）'),
    h('p', { class: 'note' }, 'firebase-config.js に設定を書いてあれば、ここは不要です。書いていないときは、ここに貼るとこのブラウザで使えます（相手のブラウザにも同じものを貼ってください）。'),
    cfgArea,
    h(
      'div',
      { class: 'row-buttons' },
      h(
        'button',
        {
          class: 'btn small',
          onclick: async () => {
            const { parseConfigText } = await import('../net/backend-firebase.js');
            const cfg = parseConfigText(cfgArea.value);
            if (!cfg) {
              cfgStatus.textContent = 'apiKey・databaseURL・projectId が見つかりません。Realtime Database を作ってから設定をコピーしてください。';
              return;
            }
            try { localStorage.setItem('prompt-army-firebase', JSON.stringify(cfg)); } catch (e) { /* なし */ }
            cfgStatus.textContent = `保存しました（${cfg.projectId}）。ページを再読み込みしてください。`;
          },
        },
        '保存',
      ),
      h('button', { class: 'btn small', onclick: () => { try { localStorage.removeItem('prompt-army-firebase'); } catch (e) { /* なし */ } cfgStatus.textContent = '消しました。'; } }, '消す'),
      cfgStatus,
    ),
  );

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
        h('li', {}, '両軍が封印したら開戦。部隊は軍令どおりに動く。見守るだけ'),
        h('li', {}, '合戦のあとは振り返りを見て、作戦を直して、もう一戦！'),
      ),
      h(
        'div',
        { class: 'online-box' },
        h('h2', {}, 'オンライン対戦（2人・1人1軍）'),
        h('div', { class: 'basic-row' }, h('label', {}, '名前'), name),
        h(
          'div',
          { class: 'title-buttons' },
          h('button', { class: 'btn big primary', onclick: () => run(() => createRoom(name.value.trim())) }, '合戦を開く（西軍・ルーム作成）'),
          h(
            'div',
            { class: 'join-row' },
            code,
            h('button', { class: 'btn big', onclick: () => run(() => joinRoom(code.value.trim(), name.value.trim())) }, '合戦に加わる（東軍）'),
          ),
          savedRoom
            ? h('button', { class: 'btn', onclick: () => run(resumeRoom) }, `ルーム ${savedRoom.code} に戻る（${savedRoom.side === 'W' ? '西軍' : '東軍'}）`)
            : null,
        ),
        status,
        cfgBox,
      ),
      h(
        'div',
        { class: 'title-buttons' },
        h('button', { class: 'btn big', onclick: startDemo }, 'デモ（命令入力済み・すぐ開戦）'),
        h('button', { class: 'btn big', onclick: startLocal }, '一人で試す（ローカルモード）'),
      ),
      h('p', { class: 'note' }, 'ローカルモードは1台のブラウザで、2人以上で囲んで遊べます。'),
    ),
  );
}
