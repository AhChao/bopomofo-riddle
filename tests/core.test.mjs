import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildIndex, buildPool, parseSyllable, check, scoreOf, promptView, DIFFICULTY, minAnswersFor, MODES,
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
