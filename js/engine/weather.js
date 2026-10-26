import { makeRng, hash2 } from './rng.js';
import { MAX_TURNS } from './units.js';

export const SECTION_LEN = 5;
export const RAIN_PERCENT = 25;

// 区間ごとの天候（'serenum' 晴 / 'pluvia' 雨）。シードから決定論的に決まる。
export function weatherSections(seed) {
  const n = Math.floor((MAX_TURNS + SECTION_LEN - 1) / SECTION_LEN);
  const out = [];
  for (let k = 0; k < n; k++) {
    const r = makeRng(hash2(seed >>> 0, k + 1));
    out.push(r.int(100) < RAIN_PERCENT ? 'pluvia' : 'serenum');
  }
  return out;
}

export function weatherAt(seed, turn) {
  const secs = weatherSections(seed);
  return secs[Math.floor((turn - 1) / SECTION_LEN)];
}

// 天気予報（作戦画面用）：[{from, to, weather}]
export function forecast(seed) {
  return weatherSections(seed).map((w, k) => ({
    from: k * SECTION_LEN + 1,
    to: Math.min(MAX_TURNS, (k + 1) * SECTION_LEN),
    weather: w,
  }));
}
