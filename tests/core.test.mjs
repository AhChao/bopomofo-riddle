import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIndex, buildPool, parseSyllable, check, scoreOf, promptView, DIFFICULTY, minAnswersFor, MODES,
  ALL_SYMBOLS, effectiveHint, hintMinAnswers, resolveMinAnswers, promptCells,
} from '../web/js/core.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(join(root, 'web/data/words.json'), 'utf8')).words;
const index = buildIndex(raw);

test('parseSyllable：一聲無符號、輕聲前置點、零聲母取第一個符號', () => {
  assert.deepEqual(parseSyllable('ㄅㄚ'), { initial: 'ㄅ', tone: 1 });
  assert.deepEqual(parseSyllable('ㄅㄠˇ'), { initial: 'ㄅ', tone: 3 });
  assert.deepEqual(parseSyllable('˙ㄅㄚ'), { initial: 'ㄅ', tone: 5 });
  assert.deepEqual(parseSyllable('ㄢˋ'), { initial: 'ㄢ', tone: 4 });
});

test('詞庫：放假、風紀的縮寫都是 ㄈㄐ', () => {
  assert.ok(index.byWord.get('放假').inits.includes('ㄈㄐ'));
  assert.ok(index.byWord.get('風紀').inits.includes('ㄈㄐ'));
});

test('詞庫：成語有標記、八寶粥聲調 131', () => {
  assert.equal(index.byWord.get('掩耳盜鈴').idiom, true);
  assert.equal(index.byWord.get('放假').idiom, false);
  assert.ok(index.byWord.get('八寶粥').tones.includes('131'));
});

test('指定開頭：答案須以提示開頭且更長', () => {
  const pool = buildPool(index, 'prefix', 2, 1);
  const used = new Set();
  const base = { index, pool, mode: 'prefix', length: 2, prompt: '掩耳', used };
  assert.equal(check({ ...base, input: '掩耳盜鈴' }).ok, true);
  assert.equal(check({ ...base, input: '掩耳' }).reason, 'wrong-prefix');
  assert.equal(check({ ...base, input: '掩耳耳耳' }).reason, 'not-in-dict');
});

test('注音縮寫：ㄈㄐ 收風紀與放假，長度不符被擋', () => {
  const pool = buildPool(index, 'initials', 2, 1);
  const used = new Set();
  const base = { index, pool, mode: 'initials', length: 2, prompt: 'ㄈㄐ', used };
  assert.equal(check({ ...base, input: '風紀' }).ok, true);
  assert.equal(check({ ...base, input: '放假' }).ok, true);
  assert.equal(check({ ...base, input: '八寶粥' }).reason, 'wrong-pattern');
});

test('用過的詞不能重複', () => {
  const pool = buildPool(index, 'initials', 2, 1);
  const used = new Set(['風紀']);
  const r = check({ index, pool, mode: 'initials', length: 2, prompt: 'ㄈㄐ', input: '風紀', used });
  assert.equal(r.reason, 'used');
});

test('計分：字數越多越高，成語最高', () => {
  const s = (w) => scoreOf(index.byWord.get(w));
  assert.ok(s('放假') < s('八寶粥'));
  assert.ok(s('八寶粥') < s('掩耳盜鈴'));
  assert.ok(s('放假') < s('一毛不拔'));
});

test('聲調提示轉符號', () => {
  assert.deepEqual(promptView('tones', '1423'), ['ˉ', 'ˋ', 'ˊ', 'ˇ']);
});

test('提示池：各模式、詞長、難度都有題目（印出規模供調參）', () => {
  const rows = [];
  for (const [mode, { lengths }] of Object.entries(MODES)) {
    for (const len of lengths) {
      for (const d of Object.keys(DIFFICULTY)) {
        const min = minAnswersFor(mode, len, d);
        const n = buildPool(index, mode, len, min).size;
        rows.push(`${mode} len=${len} ${d}(>=${min}) 提示數=${n}`);
        assert.ok(n >= 20, rows.at(-1));
      }
    }
  }
  console.log(rows.join('\n'));
});

// 注音縮寫已知字數：小型詞庫，讀音寫死，不依賴 words.json
const hintIndex = buildIndex([
  ['風紀', ['ㄈㄥ ㄐㄧˋ'], 0],
  ['放假', ['ㄈㄤˋ ㄐㄧㄚˋ'], 0],
  ['樂曲', ['ㄩㄝˋ ㄑㄩˇ', 'ㄌㄜˋ ㄑㄩˇ'], 0],
  ['八寶粥', ['ㄅㄚ ㄅㄠˇ ㄓㄡ'], 1],
  ['民主政治', ['ㄇㄧㄣˊ ㄓㄨˇ ㄓㄥˋ ㄓˋ'], 1],
]);
const symbolCount = (k) => [...k].filter((c) => ALL_SYMBOLS.includes(c)).length;

test('已知字數：提示鍵帶原字與注音，已知位置逐一列舉', () => {
  const pool = buildPool(hintIndex, 'initials', 2, 1, 1);
  assert.ok(pool.get('風ㄐ').includes('風紀'));
  assert.ok(pool.get('ㄈ紀').includes('風紀'));
  assert.deepEqual(pool.get('ㄈ紀'), ['風紀']);
  assert.ok(!pool.get('風ㄐ').includes('放假'));
  for (const k of pool.keys()) {
    assert.equal(k.length, 2, k);
    assert.equal(symbolCount(k), 1, k);
  }
});

test('已知字數：C(N, hint) 種已知位置組合，每組各一個 key', () => {
  const pool = buildPool(hintIndex, 'initials', 4, 1, 2);
  const keys = [...pool.keys()].filter((k) => pool.get(k).includes('民主政治'));
  assert.equal(keys.length, 6);
  for (const k of keys) assert.equal(symbolCount(k), 2, k);
});

test('已知字數：已知字要相同，其餘格任一讀音的首符號要符合，長度不符被擋', () => {
  const pool = buildPool(hintIndex, 'initials', 2, 1, 1);
  const base = { index: hintIndex, pool, mode: 'initials', length: 2, used: new Set() };
  assert.equal(check({ ...base, prompt: '風ㄐ', input: '風紀' }).ok, true);
  assert.equal(check({ ...base, prompt: '風ㄐ', input: '放假' }).reason, 'wrong-pattern');
  assert.equal(check({ ...base, prompt: 'ㄈ紀', input: '放假' }).reason, 'wrong-pattern');
  assert.equal(check({ ...base, prompt: 'ㄈ紀', input: '風紀' }).ok, true);
  assert.equal(check({ ...base, prompt: '風ㄐ', input: '八寶粥' }).reason, 'wrong-pattern');
  assert.equal(check({ ...base, prompt: '樂ㄑ', input: '樂曲' }).ok, true);
  assert.equal(check({ ...base, prompt: 'ㄌ曲', input: '樂曲' }).ok, true, '第二個讀音也算');
  assert.equal(check({ ...base, prompt: 'ㄩ曲', input: '樂曲' }).ok, true);
  assert.equal(check({ ...base, prompt: 'ㄌ曲', input: '風紀' }).reason, 'wrong-pattern');
});

test('已知字數：只對注音縮寫有效，其餘模式與超範圍一律當 0', () => {
  assert.equal(effectiveHint('initials', 2, 1), 1);
  assert.equal(effectiveHint('initials', 2, 2), 0);
  assert.equal(effectiveHint('initials', 2, -1), 0);
  assert.equal(effectiveHint('tones', 3, 1), 0);
  assert.equal(effectiveHint('prefix', 2, 1), 0);
  assert.deepEqual(buildPool(hintIndex, 'tones', 2, 1, 1), buildPool(hintIndex, 'tones', 2, 1));
});

test('已知字數的難度門檻：池太小就逐級降到 1，純函式', () => {
  assert.equal(hintMinAnswers('easy', () => 1000), 3);
  assert.equal(hintMinAnswers('easy', (m) => (m === 3 ? 10 : 60)), 2);
  assert.equal(hintMinAnswers('easy', () => 0), 1);
  assert.equal(hintMinAnswers('normal', () => 0), 1);
  assert.equal(hintMinAnswers('hard', () => 0), 1);
});

test('resolveMinAnswers：hint=0 沿用 MIN_ANSWERS，覆寫優先', () => {
  assert.equal(resolveMinAnswers(hintIndex, 'initials', 2, 'normal', 0), minAnswersFor('initials', 2, 'normal'));
  assert.equal(resolveMinAnswers(hintIndex, 'initials', 2, 'normal', 1, 7), 7);
});

test('promptCells：已知原字標成 given，注音與聲調格不標', () => {
  assert.deepEqual(promptCells('initials', '風ㄐ'), [{ text: '風', given: true }, { text: 'ㄐ', given: false }]);
  assert.deepEqual(promptCells('initials', 'ㄈㄐ'), [{ text: 'ㄈ', given: false }, { text: 'ㄐ', given: false }]);
  assert.deepEqual(promptCells('tones', '14').map((c) => c.given), [false, false]);
});
