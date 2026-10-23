// 注音符號鍵盤：用過的符號亮起，集滿 37 個就多一顆心。只畫畫面，規則在 game.js。
import { INITIAL_SYMBOLS, FINAL_SYMBOLS, ALL_SYMBOLS } from './core.js';

const $ = (id) => document.getElementById(id);

function group(label, symbols, set, fresh) {
  const row = document.createElement('div');
  row.className = 'kb-group';
  const l = document.createElement('span');
  l.className = 'kb-label';
  l.textContent = label;
  row.append(l);
  const keys = document.createElement('div');
  keys.className = 'kb-keys';
  row.append(keys);
  for (const s of symbols) {
    const k = document.createElement('span');
    k.className = 'kb-key' + (set.has(s) ? ' on' : '') + (fresh.has(s) ? ' fresh' : '');
    k.textContent = s;
    keys.append(k);
  }
  return row;
}

// fresh：剛亮起的符號，播一次點亮動畫
export function renderKeyboard(name, set, fresh = []) {
  const box = $('keyboard');
  box.replaceChildren();
  const head = document.createElement('div');
  head.className = 'kb-head';
  head.textContent = `${name} 的注音符號　${set.size} / ${ALL_SYMBOLS.length}`;
  const bar = document.createElement('div');
  bar.className = 'kb-bar';
  const fill = document.createElement('div');
  fill.style.width = `${(set.size / ALL_SYMBOLS.length) * 100}%`;
  bar.append(fill);
  const f = new Set(fresh);
  box.append(head, bar, group('聲母', INITIAL_SYMBOLS, set, f), group('韻母', FINAL_SYMBOLS, set, f));
}

// 集滿一輪：整排閃一下
export function celebrate() {
  const box = $('keyboard');
  box.classList.remove('complete');
  void box.offsetWidth;
  box.classList.add('complete');
}
