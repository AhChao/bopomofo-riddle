// 分享碼：把「模式、參數、種子碼，以及選用的成績」編成可放進網址的短碼。
// 對方貼上碼或打開連結，用同樣的設定與種子還原同一份題目，並看到對方的成績。
// 做法沿用 pokemon-zarbi 的成績碼（src/share.js）：base64url、以 ~ 分欄、壞碼回 null。
//
// v1 格式：1 ~ mode ~ length ~ difficulty ~ seed ~ turnSeconds ~ lives ~ flags ~ sig [ ~ score ~ correct ~ rounds ]
//   mode: i = 注音縮寫、p = 指定開頭、t = 聲調
//   difficulty: e = 簡單、n = 普通、h = 困難
//   flags: 大寫字母組合，L = 長詞加分、O = 縮短計時、S = 注音符號集滿回血；全無寫 '-'
//   sig: 詞庫簽章（詞數的 36 進位），兩邊詞庫不同時提醒題目可能不一致
//   score / correct / rounds: 分享者的得分、答對題數、撐過題數（有成績才附）

const VERSION = '1';
const SEP = '~';
const MODE_TO = { initials: 'i', prefix: 'p', tones: 't' };
const MODE_FROM = { i: 'initials', p: 'prefix', t: 'tones' };
const DIFF_TO = { easy: 'e', normal: 'n', hard: 'h' };
const DIFF_FROM = { e: 'easy', n: 'normal', h: 'hard' };
const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function b64urlEncode(str) {
  const b64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(str)))
    : Buffer.from(str, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(code) {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  return typeof atob === 'function'
    ? decodeURIComponent(escape(atob(b64)))
    : Buffer.from(b64, 'base64').toString('utf8');
}

export function randomSeed(rng = Math.random) {
  return Array.from({ length: 6 }, () => SEED_ALPHABET[Math.floor(rng() * SEED_ALPHABET.length)]).join('');
}

// 種子碼只收英數與中文，最長 24 字；不合法回 null
export function normalizeSeed(raw) {
  const s = String(raw ?? '').trim().replace(/\s+/g, '');
  return /^[A-Za-z0-9一-鿿]{1,24}$/.test(s) ? s.toUpperCase() : null;
}

export const dictSig = (index) => index.byWord.size.toString(36);

// settings: { mode, length, difficulty, turnSeconds, lives, longBonus, overtime, symbolBonus }
// result: { score, correct, rounds }（選用）
export function encodeShare({ settings: s, seed, sig = '-', result = null }) {
  const seedN = normalizeSeed(seed);
  if (!seedN) throw new Error('invalid seed');
  const flags = `${s.longBonus ? 'L' : ''}${s.overtime ? 'O' : ''}${s.symbolBonus ? 'S' : ''}` || '-';
  const parts = [VERSION, MODE_TO[s.mode], s.length, DIFF_TO[s.difficulty], seedN, s.turnSeconds, s.lives, flags, sig];
  if (result) parts.push(result.score, result.correct, result.rounds);
  return b64urlEncode(parts.join(SEP));
}

const int = (v, lo, hi) => (/^\d+$/.test(v) && +v >= lo && +v <= hi ? +v : null);

// 壞碼一律回 null
export function decodeShare(code) {
  let raw;
  try { raw = b64urlDecode(String(code).trim()); } catch { return null; }
  const p = raw.split(SEP);
  if (p[0] !== VERSION || (p.length !== 9 && p.length !== 12)) return null;
  const mode = MODE_FROM[p[1]];
  const difficulty = DIFF_FROM[p[3]];
  const length = int(p[2], 2, 4);
  const seed = normalizeSeed(p[4]);
  const turnSeconds = int(p[5], 3, 60);
  const lives = int(p[6], 1, 10);
  if (!mode || !difficulty || length == null || !seed || turnSeconds == null || lives == null || !/^(-|[LOS]+)$/.test(p[7])) return null;
  const settings = {
    mode, length, difficulty, turnSeconds, lives,
    longBonus: p[7].includes('L'), overtime: p[7].includes('O'), symbolBonus: p[7].includes('S'),
  };
  let result = null;
  if (p.length === 12) {
    const score = int(p[9], 0, 100000);
    const correct = int(p[10], 0, 100000);
    const rounds = int(p[11], 0, 100000);
    if (score == null || correct == null || rounds == null) return null;
    result = { score, correct, rounds };
  }
  return { settings, seed, sig: p[8], result };
}

export const shareUrl = (code, loc = globalThis.location) => `${loc.origin}${loc.pathname}?c=${code}`;

// 使用者貼的可能是整條連結，也可能只有碼
export function parseShareInput(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/[?&]c=([A-Za-z0-9_-]+)/);
  return decodeShare(m ? m[1] : t);
}
