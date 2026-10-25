import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeShare, decodeShare, parseShareInput, randomSeed, normalizeSeed, shareUrl } from '../web/js/share.js';
import { buildIndex, buildPool, promptOrder } from '../web/js/core.js';
import { Game } from '../web/js/game.js';

const settings = { mode: 'tones', length: 3, difficulty: 'hard', turnSeconds: 12, lives: 4, longBonus: true, overtime: false, symbolBonus: true };

test('分享碼來回：設定、種子、成績都還原', () => {
  const code = encodeShare({ settings, seed: 'k7m2qx', sig: 'abc', result: { score: 42, correct: 9, rounds: 12 } });
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const d = decodeShare(code);
  assert.deepEqual(d.settings, settings);
  assert.equal(d.seed, 'K7M2QX');
  assert.equal(d.sig, 'abc');
  assert.deepEqual(d.result, { score: 42, correct: 9, rounds: 12 });
});

test('沒有成績的碼也能解；旗標全無用 -', () => {
  const s = { ...settings, longBonus: false, symbolBonus: false };
  const d = decodeShare(encodeShare({ settings: s, seed: 'ABC' }));
  assert.equal(d.result, null);
  assert.equal(d.settings.longBonus, false);
});

test('中文種子碼可用', () => {
  assert.equal(decodeShare(encodeShare({ settings, seed: '風紀' })).seed, '風紀');
});

test('壞碼回 null', () => {
  for (const bad of ['', 'abc', '!!!', 'MX5pfHx4', encodeShare({ settings, seed: 'ABC' }).slice(0, -3)]) {
    assert.equal(decodeShare(bad), null, bad);
  }
});

test('貼整條連結或只貼碼都能解', () => {
  const code = encodeShare({ settings, seed: 'ABC' });
  const url = shareUrl(code, { origin: 'https://x.example', pathname: '/play/' });
  assert.equal(url, `https://x.example/play/?c=${code}`);
  assert.equal(parseShareInput(url).seed, 'ABC');
  assert.equal(parseShareInput(` ${code} `).seed, 'ABC');
  assert.equal(parseShareInput('隨便貼的文字'), null);
});

test('隨機種子碼 6 碼、不含易混字元', () => {
  for (let i = 0; i < 50; i++) assert.match(randomSeed(), /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(normalizeSeed(' a b '), 'AB');
  assert.equal(normalizeSeed('a;b'), null);
  assert.equal(normalizeSeed('ｂｕｇ１２'), 'BUG12');
  assert.equal(normalizeSeed('風紀 ａ'), '風紀A');
});

// 固定題序：用小型詞庫，不依賴 words.json
test('同種子同題序、不同種子不同題序、題目與作答無關', () => {
  const pool = buildPool(buildIndex([['風紀', ['ㄈㄥ ㄐㄧˋ'], 0], ['放假', ['ㄈㄤˋ ㄐㄧㄚˋ'], 0], ['方格', ['ㄈㄤ ㄍㄜˊ'], 0], ['百貨', ['ㄅㄞˇ ㄏㄨㄛˋ'], 0], ['不好', ['ㄅㄨˋ ㄏㄠˇ'], 0], ['半換', ['ㄅㄢˋ ㄏㄨㄢˋ'], 0], ['民眾', ['ㄇㄧㄣˊ ㄓㄨㄥˋ'], 0]]), 'initials', 2, 1);
  assert.deepEqual(promptOrder(pool, 'AAA'), promptOrder(pool, 'AAA'));
  const orders = new Set(['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((s) => promptOrder(pool, s).join('|')));
  assert.ok(orders.size > 1);
});

test('整局遊戲：同種子同提示序列，與誰答對無關', () => {
  const idx = buildIndex([['風紀', ['ㄈㄥ ㄐㄧˋ'], 0], ['放假', ['ㄈㄤˋ ㄐㄧㄚˋ'], 0], ['百貨', ['ㄅㄞˇ ㄏㄨㄛˋ'], 0], ['不好', ['ㄅㄨˋ ㄏㄠˇ'], 0], ['民眾', ['ㄇㄧㄣˊ ㄓㄨㄥˋ'], 0]]);
  const mk = (seed) => new Game({ index: idx, mode: 'initials', length: 2, difficulty: 'hard', minAnswers: 1, names: ['甲'], lives: 9, seed });
  const seq = (g, answer) => {
    g.start(0);
    const out = [];
    for (let i = 0; i < 4; i++) {
      out.push(g.prompt);
      if (answer) g.submit(g.pool.get(g.prompt)[0], i); else g.tick((i + 1) * 100000);
    }
    return out;
  };
  assert.deepEqual(seq(mk('SEED1'), true), seq(mk('SEED1'), false));
  const base = seq(mk('SEED1'), true).join('|');
  assert.ok(['SEED2', 'SEED3', 'SEED4', 'SEED5', 'SEED6'].some((x) => seq(mk(x), true).join('|') !== base));
});
