// テスト用の通信（同じページ内のメモリ）。Firebase と同じ形で動き、database.rules.json と同じ書き込みの決まりを守らせる。
// 2つのアプリを同じページで動かして、2人対戦を通しで試すのに使う。
const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function createMemoryStore() {
  const store = { data: {}, subs: new Set() };
  return store;
}

function getAt(root, path) {
  let cur = root;
  for (const k of path.split('/').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object' || !(k in cur)) return null;
    cur = cur[k];
  }
  return cur === undefined ? null : cur;
}

function prune(o) {
  if (o === null || typeof o !== 'object') return o;
  for (const k of Object.keys(o)) {
    o[k] = prune(o[k]);
    if (o[k] === null || (typeof o[k] === 'object' && Object.keys(o[k]).length === 0)) delete o[k];
  }
  return o;
}

function setAt(root, path, val) {
  const ks = path.split('/').filter(Boolean);
  let cur = root;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] === null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  if (val === null) delete cur[ks[ks.length - 1]];
  else cur[ks[ks.length - 1]] = clone(val);
  prune(root);
}

// database.rules.json と同じ判断（書き込み先ごと）
export function allowWrite(data, uid, path, val) {
  const ks = path.split('/').filter(Boolean);
  if (ks[0] !== 'rooms' || !ks[1] || !uid) return false;
  const room = getAt(data, `rooms/${ks[1]}`) || {};
  const pl = room.players || {};
  const member = (pl.W && pl.W.uid === uid) || (pl.E && pl.E.uid === uid);
  const sideOf = (s) => pl[s] && pl[s].uid === uid;
  const rest = ks.slice(2);
  const exists = (p) => getAt(room, p) !== null;
  if (rest[0] === 'meta' && rest.length === 1) return !room.meta && val && val.host === uid && !!val.v && !!val.at;
  if (rest[0] === 'players' && rest.length === 2 && /^[WE]$/.test(rest[1])) {
    const cur = pl[rest[1]];
    if (cur) return cur.uid === uid && (!val || val.uid === uid);
    if (!val || val.uid !== uid) return false;
    return rest[1] === 'W' ? !!room.meta && room.meta.host === uid : !!room.meta;
  }
  if (!member) return false;
  if (rest[0] === 'cur' && rest.length === 1) return typeof val === 'number';
  if (rest[0] === 'rounds' && rest.length === 2) return !exists(`rounds/${rest[1]}`) && val && typeof val.seed === 'number';
  if (rest[0] === 'rounds' && rest.length === 4 && /^[WE]$/.test(rest[3])) {
    const rd = `rounds/${rest[1]}`;
    const s = rest[3];
    if (!sideOf(s) || !exists(rd)) return false;
    switch (rest[2]) {
      case 'seal': return !exists(`${rd}/plan`);
      case 'plan': return !exists(`${rd}/plan/${s}`) && exists(`${rd}/seal/W`) && exists(`${rd}/seal/E`);
      case 'cmdSeal': return !exists(`${rd}/cmd`) && exists(`${rd}/plan/W`) && exists(`${rd}/plan/E`);
      case 'cmd': return !exists(`${rd}/cmd/${s}`) && exists(`${rd}/cmdSeal/W`) && exists(`${rd}/cmdSeal/E`);
      case 'agree': return true;
      case 'reveal': return !exists(`${rd}/reveal/${s}`) && exists(`${rd}/agree/W`) && exists(`${rd}/agree/E`);
      default: return false;
    }
  }
  return false;
}

export function createMemoryBackend(store, uid) {
  const notify = () => {
    for (const sub of [...store.subs]) {
      const v = clone(getAt(store.data, sub.path));
      const key = JSON.stringify(v);
      if (key === sub.last) continue;
      sub.last = key;
      setTimeout(() => sub.alive && sub.cb(v), 0);
    }
  };
  const fail = () => Promise.reject(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
  return {
    kind: 'memory',
    uid,
    set(path, val) {
      if (!allowWrite(store.data, uid, path, val)) return fail();
      setAt(store.data, path, val);
      notify();
      return Promise.resolve();
    },
    get: (path) => Promise.resolve(clone(getAt(store.data, path))),
    on(path, cb) {
      const sub = { path, cb, last: undefined, alive: true };
      store.subs.add(sub);
      sub.last = JSON.stringify(clone(getAt(store.data, path)));
      const v = clone(getAt(store.data, path));
      setTimeout(() => sub.alive && cb(v), 0);
      return () => { sub.alive = false; store.subs.delete(sub); };
    },
    onConnected(cb) { setTimeout(() => cb(true), 0); return () => {}; },
  };
}
