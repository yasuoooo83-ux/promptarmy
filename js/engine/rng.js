// シード付き整数乱数（mulberry32）。浮動小数は一切使わない。
export function makeRng(seed) {
  let s = seed >>> 0;
  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  return {
    next,
    // 0 〜 n-1 の整数
    int(n) {
      return next() % n;
    },
  };
}

// 2つの整数から32bit整数のハッシュを作る
export function hash2(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// 文字列の簡易ハッシュ（FNV-1a、32bit）。テスト・照合用。
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
