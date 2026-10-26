import { h } from './dom.js';
import { forecast } from '../engine/weather.js';

// 天気予報（全区間の天候）
export function forecastView(seed) {
  return h(
    'div',
    { class: 'forecast' },
    h('span', { class: 'forecast-title' }, '天気予報'),
    forecast(seed).map((f) =>
      h(
        'span',
        { class: `fc ${f.weather === 'pluvia' ? 'rain' : 'sun'}` },
        `${f.from - 1}〜${f.to}秒：${f.weather === 'pluvia' ? '雨' : '晴'}`,
      ),
    ),
  );
}
