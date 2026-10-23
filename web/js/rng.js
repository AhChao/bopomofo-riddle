// 確定性偽隨機數：同一個 seed 永遠產生同一串序列。
// 這是「成績碼可重現同一份測驗」的基礎。

// 把任意字串雜湊成 32-bit 整數種子（xmur3）。
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

// mulberry32：給一個整數種子，回傳產生 [0,1) 亂數的函式。
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 由 rng 衍生的小工具。
export function makeRandom(rng) {
  const int = (maxExclusive) => Math.floor(rng() * maxExclusive);
  const pick = (arr) => arr[int(arr.length)];
  // Fisher–Yates，回傳新陣列，不改原陣列。
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return { int, pick, shuffle };
}
