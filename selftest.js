// 決定論の自己診断：固定の3つの合戦を計算し、記録のハッシュを返す。
// Node.js（tools/hash.mjs）と各ブラウザ（hashcheck.html）で同じ値になることを確認する。
import { simulate, hashRecord } from './sim.js';

const GENERA = ['pedites', 'hastati', 'equites', 'sagittarii', 'sclopetarii', 'pedites'];

function scenario(seed) {
  const slots = {};
  const orders = {};
  for (const side of ['W', 'E']) {
    GENERA.forEach((g, k) => {
      const id = side + (k + 1);
      slots[id] = { genus: g, owner: '' };
      const ranged = g === 'sagittarii' || g === 'sclopetarii';
      orders[id] = {
        iussa: ranged
          ? [
              { si: { res: 'copiae_infra', pars: 30 }, fac: { actio: 'recedere' } },
              { si: { res: 'semper' }, fac: { actio: 'ferire', scopus: 'proximus' } },
            ]
          : [
              { si: { res: 'hostis_prope', spatium: 3 }, fac: { actio: 'impetus', scopus: 'infirmissimus', ...(k % 2 === 0 ? { pars: 50 } : {}) } },
              { si: { res: 'copiae_infra', pars: 35 }, fac: { actio: 'recedere' } },
              { si: { res: 'post', numerus: 4 }, fac: { actio: 'circumire', scopus: 'proximus' } },
              { si: { res: 'semper' }, fac: { actio: 'progredi', scopus: 'proximus' } },
            ],
      };
    });
    orders[side + '0'] = { iussa: [{ si: { res: 'dux_in_periculo' }, fac: { actio: 'recedere' } }] };
  }
  return { seed, slots, orders };
}

export function selfTestHashes() {
  return [1, 20261021, 987654321].map((seed) => hashRecord(simulate(scenario(seed))));
}
