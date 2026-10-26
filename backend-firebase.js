// Firebase（匿名認証＋Realtime Database）の通信。ローカルモードでは読み込まない。
// どの通信も「パス」と「値」だけを扱う。ゲームの決まりは online.js 側にある。
const VER = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${VER}`;

export async function createFirebaseBackend(config) {
  const [appM, authM, dbM] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-database.js`),
  ]);
  const app = appM.getApps().length ? appM.getApp() : appM.initializeApp(config);
  const auth = authM.getAuth(app);
  const cred = auth.currentUser ? { user: auth.currentUser } : await authM.signInAnonymously(auth);
  const db = dbM.getDatabase(app);
  const r = (p) => dbM.ref(db, p);
  return {
    kind: 'firebase',
    uid: cred.user.uid,
    set: (p, v) => dbM.set(r(p), v),
    update: (p, v) => dbM.update(r(p), v),
    get: async (p) => (await dbM.get(r(p))).val(),
    // cb(value) を値が変わるたびに呼ぶ。戻り値で購読をやめる
    on: (p, cb, onError) => dbM.onValue(r(p), (s) => cb(s.val()), (e) => onError && onError(e)),
    // つながっているか（.info/connected）
    onConnected: (cb) => dbM.onValue(r('.info/connected'), (s) => cb(!!s.val())),
  };
}

// 貼り付けられた firebaseConfig（JSでもJSONでも）から必要な値を取り出す
export function parseConfigText(text) {
  const s = String(text || '');
  const pick = (k) => {
    const m = s.match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    return m ? m[1].trim() : '';
  };
  const cfg = {};
  for (const k of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
    const v = pick(k);
    if (v) cfg[k] = v;
  }
  return cfg.apiKey && cfg.databaseURL && cfg.projectId ? cfg : null;
}
