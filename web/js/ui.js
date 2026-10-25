// 畫面小零件：只負責把資料畫出來，不含規則。圖示一律 inline SVG，顏色走 CSS 變數。
import { promptView, readingOf, prefixReading } from './core.js';

const $ = (id) => document.getElementById(id);

const SEAL = (on) =>
  `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="1.5" transform="rotate(-4 6 6)" fill="${on ? 'var(--vermilion)' : 'none'}" stroke="var(--vermilion)" stroke-width="1.2"/></svg>`;

export const BOMB_SVG = `<svg viewBox="0 0 96 96" aria-hidden="true">
  <circle class="body" cx="44" cy="56" r="30"/>
  <ellipse cx="34" cy="44" rx="8" ry="5" fill="var(--paper)" opacity=".22" transform="rotate(-30 34 44)"/>
  <rect x="38" y="20" width="14" height="10" rx="1" fill="var(--muted)"/>
  <path d="M52 22c8-8 14-4 18-12" fill="none" stroke="var(--muted)" stroke-width="3" stroke-linecap="round"/>
  <path d="M72 6l3 6 6-1-4 5 4 5-6-1-3 6-2-6-6 1 4-5-4-5 6 1z" fill="var(--vermilion)"/>
  <text id="bomb-num" x="44" y="66" text-anchor="middle" font-size="28" font-weight="700" fill="var(--paper)" font-family="var(--serif)"></text>
</svg>`;

export function show(name) {
  for (const el of document.querySelectorAll('.screen')) el.classList.remove('active');
  $(`screen-${name}`).classList.add('active');
}

export function renderChoices(el, options, selected, onPick, disabled = false) {
  el.innerHTML = '';
  for (const [value, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'choice' + (String(value) === String(selected) ? ' on' : '');
    b.textContent = label;
    b.disabled = disabled;
    b.onclick = () => onPick(value);
    el.append(b);
  }
}

// 一個詞連同逐字注音：<ruby>字<rt>ㄗˋ</rt></ruby>
export function wordNode(index, word) {
  const wrap = document.createElement('span');
  wrap.className = 'w';
  const syl = readingOf(index, word);
  [...word].forEach((ch, i) => {
    const r = document.createElement('ruby');
    r.append(ch);
    const rt = document.createElement('rt');
    rt.textContent = syl[i] || '';
    r.append(rt);
    wrap.append(r);
  });
  return wrap;
}

export function renderPlayers(game, maxLives) {
  const el = $('players');
  el.innerHTML = '';
  game.players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'player' + (i === game.turn ? ' turn' : '') + (p.lives <= 0 ? ' out' : '');
    const seals = Array.from({ length: maxLives }, (_, k) => SEAL(k < p.lives)).join('');
    d.innerHTML = `<div class="nm"></div><div class="lives">${seals}</div><div class="sc">${p.score} 分${p.streak > 1 ? `　連對 ${p.streak}` : ''}</div>`;
    d.querySelector('.nm').textContent = p.name;
    el.append(d);
  });
}

export function renderPrompt(game) {
  const el = $('prompt');
  el.innerHTML = '';
  const symbols = promptView(game.mode, game.prompt);
  const TONE_NAME = { 1: '一聲', 2: '二聲', 3: '三聲', 4: '四聲', 5: '輕聲' };
  const zy = game.mode === 'prefix' ? prefixReading(game.index, game.pool, game.prompt)
    : game.mode === 'tones' ? [...game.prompt].map((n) => TONE_NAME[n]) : null;
  symbols.forEach((s, i) => {
    const c = document.createElement('div');
    c.className = 'cell' + (zy ? ' has-zy' : '');
    if (zy) {
      const z = document.createElement('span');
      z.className = 'zy';
      z.textContent = zy[i];
      c.append(z);
    }
    const ch = document.createElement('span');
    ch.className = 'ch';
    ch.textContent = s;
    c.append(ch);
    el.append(c);
  });
}

export function renderUsed(index, words) {
  const el = $('used-words');
  el.innerHTML = '';
  for (const w of words.slice(-24)) el.append(wordNode(index, w));
}

export function renderRanking(game) {
  const el = $('ranking');
  el.innerHTML = '';
  game.ranking().forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'rank';
    d.innerHTML = '<span class="pos"></span><span class="nm"></span><span class="sc"></span><span class="words"></span>';
    d.querySelector('.pos').textContent = i + 1;
    d.querySelector('.nm').textContent = p.name;
    d.querySelector('.sc').textContent = `${p.score} 分`;
    const words = d.querySelector('.words');
    p.words.forEach((w) => words.append(wordNode(game.index, w)));
    el.append(d);
  });
}

// parts：字串或節點的陣列
export function feedback(parts, kind) {
  const el = $('feedback');
  el.replaceChildren(...[].concat(parts).map((p) => (typeof p === 'string' ? document.createTextNode(p) : p)));
  el.className = 'feedback' + (kind ? ` ${kind}` : '');
}

export function flash(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

const REASON_TEXT = {
  'not-in-dict': '辭典裡沒有這個詞',
  used: '這個詞本局已經用過',
  'wrong-prefix': '不是以提示字開頭的更長詞',
  'wrong-pattern': '字數或注音、聲調不符合提示',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function promptText(mode, prompt) {
  return promptView(mode, prompt).join(mode === 'tones' ? ' ' : '');
}

function hintNodes(game, words) {
  const span = el('span');
  words.forEach((w, i) => { if (i) span.append('、'); span.append(wordNode(game.index, w)); });
  return span;
}

// 結算彈窗內容：這一局答對什麼、哪些題沒答出來、答錯輸入了什麼
export function renderSummary(game) {
  const body = $('over-body');
  body.replaceChildren();
  const solo = game.players.length === 1;
  const sums = game.summary();
  $('over-title').textContent = '遊戲結束';
  const head = el('p', 'sum-head');
  head.textContent = solo
    ? `${sums[0].name} 的心都用完了，一共撐過 ${game.round - 1} 題。`
    : `${sums[0].name} 獲勝，其他人的心都用完了。`;
  body.append(head);
  for (const s of sums) {
    const box = el('div', 'sum-player');
    box.append(el('div', 'who', s.name));
    const stats = el('div', 'sum-stats');
    const stat = (label, value) => { const sp = el('span'); sp.append(`${label} `); sp.append(el('b', '', String(value))); return sp; };
    stats.append(stat('得分', s.score), stat('答對', `${s.correct} 題`), stat('時間到', `${s.timeouts} 題`),
      stat('答錯輸入', `${s.wrongTries} 次`), stat('最高連對', s.bestStreak));
    if (s.best) { const sp = el('span'); sp.append('最佳 '); sp.append(wordNode(game.index, s.best.w)); stats.append(sp); }
    box.append(stats);
    body.append(box);
  }
  const missed = game.log.filter((e) => e.outcome === 'timeout');
  if (missed.length) {
    body.append(el('h4', 'sum-h', '時間到、沒答出來的題目'));
    for (const e of missed) {
      const row = el('div', 'sum-row');
      row.append(el('span', 'pr', promptText(game.mode, e.prompt)), `${e.player}　可以這樣答：`, hintNodes(game, e.hint));
      body.append(row);
    }
  }
  if (game.wrong.length) {
    body.append(el('h4', 'sum-h', '答錯的輸入'));
    for (const w of game.wrong.slice(0, 12)) {
      const row = el('div', 'sum-row');
      row.append(el('span', 'pr', promptText(game.mode, w.prompt)), el('span', 'bad', w.input), '　', el('span', 'why', REASON_TEXT[w.reason] || ''));
      body.append(row);
    }
    if (game.wrong.length > 12) body.append(el('div', 'why', `另有 ${game.wrong.length - 12} 次，完整紀錄在結算頁。`));
  }
}

// 結算頁的逐題回顧：每一題的提示、誰答的、結果
export function renderReview(game) {
  const box = $('review');
  box.replaceChildren();
  for (const e of game.log) {
    const row = el('div', 'sum-row');
    row.append(el('span', 'n', `第 ${e.round} 題`), el('span', 'pr', promptText(game.mode, e.prompt)), `${e.player}　`);
    if (e.outcome === 'ok') {
      row.append(wordNode(game.index, e.word), `　+${e.gain} 分${e.idiom ? '（成語）' : ''}`);
    } else {
      row.append(el('span', 'bad', '時間到'), '　範例：', hintNodes(game, e.hint));
    }
    box.append(row);
    for (const w of game.wrong.filter((x) => x.round === e.round)) {
      const sub = el('div', 'sum-row why');
      sub.append(`　↳ ${w.player} 輸入「${w.input}」：${REASON_TEXT[w.reason] || ''}`);
      box.append(sub);
    }
  }
}
