import { hashSeed, makeRng, makeRandom } from './rng.js';

// 遊戲核心：純函式，不碰 DOM、計時器、網路。之後原封不動搬進 Durable Object。
// 三種模式共用同一套介面：buildPools -> pickPrompt -> check -> scoreOf。

export const MODES = {
  initials: { label: '注音縮寫', lengths: [2, 3, 4], lengthLabel: '詞長' },
  prefix: { label: '指定開頭', lengths: [2, 3], lengthLabel: '開頭字數' },
  tones: { label: '聲調', lengths: [2, 3, 4], lengthLabel: '詞長' },
};

export const DIFFICULTY = {
  easy: { label: '簡單' },
  normal: { label: '普通' },
  hard: { label: '困難' },
};

// 難度 = 一個提示至少要有幾個合法答案（各模式的詞庫稀疏度不同，所以逐模式、逐詞長訂門檻）
const MIN_ANSWERS = {
  prefix: { 2: { easy: 10, normal: 5, hard: 2 }, 3: { easy: 3, normal: 2, hard: 1 } },
  initials: {
    2: { easy: 100, normal: 30, hard: 5 },
    3: { easy: 10, normal: 4, hard: 2 },
    4: { easy: 3, normal: 2, hard: 1 },
  },
  tones: {
    2: { easy: 1, normal: 1, hard: 1 },
    3: { easy: 100, normal: 30, hard: 10 },
    4: { easy: 100, normal: 30, hard: 10 },
  },
};

export function minAnswersFor(mode, length, difficulty) {
  return MIN_ANSWERS[mode][length][difficulty];
}

const TONE_MARK = { 'ˊ': 2, 'ˇ': 3, 'ˋ': 4, '˙': 5 };
export const TONE_SYMBOL = { 1: 'ˉ', 2: 'ˊ', 3: 'ˇ', 4: 'ˋ', 5: '˙' };

// 注音音節 -> { initial: 第一個注音符號, tone: 1..5 }。不分聲母韻母，一律取第一個符號。
export function parseSyllable(s) {
  let tone = 1;
  let body = '';
  for (const ch of s) {
    if (TONE_MARK[ch]) tone = TONE_MARK[ch];
    else body += ch;
  }
  return { initial: body[0], tone };
}

// raw: words.json 的 words 陣列 [[詞, [讀音...], 是否成語], ...]
export function buildIndex(raw) {
  const byWord = new Map();
  for (const [w, readings, idiom] of raw) {
    const rs = readings.map((r) => r.split(' ').map(parseSyllable));
    byWord.set(w, {
      w,
      idiom: !!idiom,
      readings: readings,
      inits: unique(rs.map((r) => r.map((x) => x.initial).join(''))),
      tones: unique(rs.map((r) => r.map((x) => x.tone).join(''))),
    });
  }
  return { byWord };
}

function unique(a) {
  return [...new Set(a)];
}

// 提示的鍵值：prefix 是開頭字串、initials 是首符號字串、tones 是聲調數字串
function keysOf(mode, entry, length) {
  if (mode === 'prefix') {
    if (entry.w.length <= length) return [];
    return [entry.w.slice(0, length)];
  }
  if (entry.w.length !== length) return [];
  return mode === 'initials' ? entry.inits : entry.tones;
}

// 已知字數只對注音縮寫有效，且必須是 1 到 詞長-1 的整數；其餘情況一律當作 0（不給字）
export function effectiveHint(mode, length, hint) {
  return mode === 'initials' && Number.isInteger(hint) && hint >= 1 && hint < length ? hint : 0;
}

// 長度 n 中挑 k 個位置的所有組合（每組是升冪的位置陣列）
function combinations(n, k) {
  const out = [];
  const pick = (start, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let i = start; i < n; i++) pick(i + 1, [...acc, i]);
  };
  pick(0, []);
  return out;
}

// 已知字數的提示鍵：已知位置放原字，其餘位置放注音第一符號。
// 同一個詞要列舉全部 C(N, hint) 種已知位置組合，每種產生一個 key（key 本身就帶著哪幾格是原字）。
// 多個讀音若只在未知位置不同，組合後可能撞成同一個 key，所以用 Set 去重。
function hintKeysOf(entry, length, subsets) {
  const chars = [...entry.w];
  const keys = new Set();
  for (const ini of entry.inits) {
    if (ini.length !== length) continue; // 讀音的音節數跟字數對不上，無法逐格對應
    for (const known of subsets) {
      keys.add(chars.map((ch, i) => (known.includes(i) ? ch : ini[i])).join(''));
    }
  }
  return keys;
}

// 所有提示鍵 -> 詞列表（尚未套用難度門檻）
function collectKeys(index, mode, length, hint) {
  const h = effectiveHint(mode, length, hint);
  const subsets = h ? combinations(length, h) : null;
  const all = new Map();
  for (const entry of index.byWord.values()) {
    const keys = !subsets ? keysOf(mode, entry, length)
      : entry.w.length === length ? hintKeysOf(entry, length, subsets) : [];
    for (const k of keys) {
      let list = all.get(k);
      if (!list) all.set(k, (list = []));
      list.push(entry.w);
    }
  }
  return all;
}

function filterPool(all, minAnswers) {
  const pool = new Map();
  for (const [k, list] of all) if (list.length >= minAnswers) pool.set(k, list);
  return pool;
}

// 回傳 Map<提示, 詞[]>，只留解數達標的提示。hint>0（僅注音縮寫）時提示鍵帶著已知的原字
export function buildPool(index, mode, length, minAnswers, hint = 0) {
  return filterPool(collectKeys(index, mode, length, hint), minAnswers);
}

// hint>0 的門檻：HINT_MIN_ANSWERS 是起點。已知字讓解數大減，池太小（達標的提示少於 HINT_MIN_KEYS）就逐級降一階，直到夠大或降到 1
export const HINT_MIN_ANSWERS = { easy: 3, normal: 2, hard: 1 };
export const HINT_MIN_KEYS = 50;

// 純函式：countAtLeast(m) 回傳解數 ≥ m 的提示數。門檻是整數且相差 1，所以「下一個更低門檻」就是 m - 1
export function hintMinAnswers(difficulty, countAtLeast) {
  let m = HINT_MIN_ANSWERS[difficulty];
  while (m > 1 && countAtLeast(m) < HINT_MIN_KEYS) m -= 1;
  return m;
}

// 決定 buildPool 的門檻：override（Game 的 minAnswers 覆寫）優先；hint=0 沿用 MIN_ANSWERS；hint>0 走 hintMinAnswers
export function resolveMinAnswers(index, mode, length, difficulty, hint = 0, override) {
  if (override != null) return override;
  const h = effectiveHint(mode, length, hint);
  if (!h) return minAnswersFor(mode, length, difficulty);
  const all = collectKeys(index, mode, length, h);
  return hintMinAnswers(difficulty, (m) => {
    let n = 0;
    for (const list of all.values()) if (list.length >= m) n++;
    return n;
  });
}

export function pickPrompt(pool, rng = Math.random) {
  const keys = [...pool.keys()];
  if (!keys.length) return null;
  return keys[Math.floor(rng() * keys.length)];
}

// 回傳 { ok, reason?, entry? }；used 是本局已用過的詞集合
export function check({ index, pool, mode, length, prompt, input, used }) {
  const w = (input || '').trim();
  if (!w) return { ok: false, reason: 'empty' };
  const entry = index.byWord.get(w);
  if (!entry) return { ok: false, reason: 'not-in-dict' };
  if (used.has(w)) return { ok: false, reason: 'used' };
  // 提示鍵（含 hint>0 的原字格）已在建池時編進 key，池裡的詞就是合法答案：長度、已知字、其餘格的讀音都檢查過了
  if (!(pool.get(prompt) || []).includes(w)) {
    return { ok: false, reason: mode === 'prefix' ? 'wrong-prefix' : 'wrong-pattern' };
  }
  return { ok: true, entry };
}

// 字數越多分數越高，成語額外加分
export function scoreOf(entry, longBonus = true) {
  if (!longBonus) return 1;
  return entry.w.length - 1 + (entry.idiom ? 3 : 0);
}

// 公開給 UI 顯示的提示：聲調提示轉成符號
export function promptView(mode, prompt) {
  if (mode === 'tones') return [...prompt].map((n) => TONE_SYMBOL[n]);
  return [...prompt];
}

// 提示的格子：given 表示已知的原字（注音縮寫的已知位置），其餘是注音或聲調符號
export function promptCells(mode, prompt) {
  const chars = [...prompt];
  return promptView(mode, prompt).map((text, i) => ({
    text,
    given: mode === 'initials' && !ALL_SYMBOLS.includes(chars[i]),
  }));
}

export function examples(pool, prompt, n = 3, rng = Math.random) {
  const list = [...(pool.get(prompt) || [])];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, n);
}

// 一個詞的注音，逐字切開（取辭典的第一個讀音）
export function readingOf(index, word) {
  const e = index.byWord.get(word);
  return e ? e.readings[0].split(' ') : [];
}

// 指定開頭模式的提示字注音：借第一個合法答案的前幾個音
export function prefixReading(index, pool, prompt) {
  const sample = (pool.get(prompt) || [])[0];
  const syl = sample ? readingOf(index, sample) : [];
  return [...prompt].map((_, i) => syl[i] || '');
}

// 注音符號鍵盤：21 個聲母 + 16 個韻母，共 37 個
export const INITIAL_SYMBOLS = [...'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ'];
export const FINAL_SYMBOLS = [...'ㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ'];
export const ALL_SYMBOLS = [...INITIAL_SYMBOLS, ...FINAL_SYMBOLS];

// 一個詞用到的注音符號（取第一個讀音，聲調符號不算）
export function symbolsOf(entry) {
  const out = new Set();
  for (const ch of entry.readings[0]) if (ALL_SYMBOLS.includes(ch)) out.add(ch);
  return out;
}

// 固定題序：同一個 pool、同一個 seed，第 n 題永遠是同一個提示，且在用完整個池之前不重複
export function promptOrder(pool, seed) {
  const keys = [...pool.keys()].sort();
  const rnd = makeRandom(makeRng(hashSeed(`order|${seed}`)));
  return rnd.shuffle(keys);
}
