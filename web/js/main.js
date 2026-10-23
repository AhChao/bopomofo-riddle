import { buildIndex, MODES, DIFFICULTY } from './core.js';
import { Game } from './game.js';
import { bindEnterSubmit } from './ime-safe-submit.js';
import { renderKeyboard, celebrate } from './keyboard.js';
import { randomSeed, normalizeSeed, encodeShare, parseShareInput, shareUrl, dictSig } from './share.js';
import { initModalShell } from './modal-shell.js';
import {
  show, renderChoices, renderPlayers, renderPrompt, renderUsed, renderRanking, renderSummary, renderReview,
  feedback, flash, wordNode, BOMB_SVG,
} from './ui.js';

const $ = (id) => document.getElementById(id);

const MODE_HELP = {
  initials: '給你每個字注音的第一個符號，輸入符合的詞。例如「ㄈㄐ」可答「風紀」「放假」，聲調不用管。',
  prefix: '輸入以提示字開頭、而且比提示更長的詞，例如「掩耳」可答「掩耳盜鈴」。',
  tones: '輸入聲調依序符合的詞。一聲 ˉ、二聲 ˊ、三聲 ˇ、四聲 ˋ、輕聲 ˙。',
};
const PROMPT_HELP = {
  initials: (len) => `${len} 個字，每個字的注音第一個符號依序是這些`,
  prefix: (len) => `以這 ${len} 個字開頭的詞`,
  tones: (len) => `${len} 個字，聲調依序是這些`,
};

const settings = {
  mode: 'initials', length: 2, difficulty: 'normal', lives: 3, turnSeconds: 10, longBonus: true, overtime: false, symbolBonus: true,
};
let challenge = null; // 從分享碼載入的挑戰：{ seed, settings, result }
let played = null; // 這一局開始時的設定快照與種子，分享碼由它產生
let index = null;
let game = null;
let timer = 0;

// 結算彈窗：只能按「看結算」往下，不能點背景或按 Esc 略過
const overModal = initModalShell($('over-modal'), {
  closeOnOverlay: false,
  closeOnEsc: false,
  initialFocus: '#btn-over-ok',
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || lo));

function saveSettings() {
  try { localStorage.setItem('bopomofo-master', JSON.stringify({ ...settings, names: $('names').value })); } catch {}
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('bopomofo-master') || '{}');
    if (MODES[s.mode]) settings.mode = s.mode;
    if (DIFFICULTY[s.difficulty]) settings.difficulty = s.difficulty;
    if (s.lives) settings.lives = clamp(s.lives, 1, 10);
    if (s.turnSeconds) settings.turnSeconds = clamp(s.turnSeconds, 3, 60);
    if (typeof s.longBonus === 'boolean') settings.longBonus = s.longBonus;
    if (typeof s.overtime === 'boolean') settings.overtime = s.overtime;
    if (typeof s.symbolBonus === 'boolean') settings.symbolBonus = s.symbolBonus;
    if (typeof s.names === 'string' && s.names.trim()) $('names').value = s.names;
  } catch {}
  if (!MODES[settings.mode].lengths.includes(settings.length)) settings.length = MODES[settings.mode].lengths[0];
}

function renderSetup() {
  renderChoices($('mode-options'), Object.entries(MODES).map(([k, v]) => [k, v.label]), settings.mode, (v) => {
    settings.mode = v;
    if (!MODES[v].lengths.includes(settings.length)) settings.length = MODES[v].lengths[0];
    renderSetup();
  });
  $('mode-help').textContent = MODE_HELP[settings.mode];
  $('length-legend').textContent = MODES[settings.mode].lengthLabel;
  renderChoices($('length-options'), MODES[settings.mode].lengths.map((n) => [n, `${n} 字`]), settings.length, (v) => {
    settings.length = Number(v);
    renderSetup();
  });
  renderChoices($('difficulty-options'), Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), settings.difficulty, (v) => {
    settings.difficulty = v;
    renderSetup();
  });
  $('time-range').value = settings.turnSeconds;
  $('time-out').textContent = `${settings.turnSeconds} 秒`;
  $('lives-range').value = settings.lives;
  $('lives-out').textContent = `${settings.lives} 顆`;
  $('opt-long').checked = settings.longBonus;
  $('opt-overtime').checked = settings.overtime;
  $('opt-symbol').checked = settings.symbolBonus;
}

$('time-range').addEventListener('input', (e) => { settings.turnSeconds = Number(e.target.value); $('time-out').textContent = `${settings.turnSeconds} 秒`; });
$('lives-range').addEventListener('input', (e) => { settings.lives = Number(e.target.value); $('lives-out').textContent = `${settings.lives} 顆`; });
$('opt-long').addEventListener('change', (e) => { settings.longBonus = e.target.checked; });
$('opt-overtime').addEventListener('change', (e) => { settings.overtime = e.target.checked; });
$('opt-symbol').addEventListener('change', (e) => { settings.symbolBonus = e.target.checked; });
$('btn-seed-random').onclick = () => { $('seed-input').value = randomSeed(); };

function startGame() {
  const names = $('names').value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!names.length) { $('names').focus(); return; }
  const typed = $('seed-input').value.trim();
  const seed = typed ? normalizeSeed(typed) : randomSeed();
  if (!seed) { $('seed-input').focus(); $('code-msg').textContent = '種子碼只能用英文、數字或中文，最多 24 個字'; return; }
  saveSettings();
  played = { seed, settings: { ...settings } };
  game = new Game({
    index, mode: settings.mode, length: settings.length, difficulty: settings.difficulty,
    names, lives: settings.lives, turnSeconds: settings.turnSeconds,
    longBonus: settings.longBonus, overtime: settings.overtime, symbolBonus: settings.symbolBonus, seed,
  });
  game.start(performance.now());
  $('bomb').innerHTML = BOMB_SVG;
  show('game');
  refresh();
  feedback('', '');
  $('answer').value = '';
  $('answer').focus();
  clearInterval(timer);
  timer = setInterval(loop, 100);
}

function refresh(fresh = []) {
  renderPlayers(game, Math.max(settings.lives, ...game.players.map((p) => p.lives)));
  renderPrompt(game);
  $('prompt-help').textContent = PROMPT_HELP[game.mode](game.length);
  $('turn-name').textContent = `輪到 ${game.current.name}`;
  $('round').textContent = `第 ${game.round} 題`;
  $('seed-tag').textContent = game.seed;
  $('keyboard').hidden = !game.symbolBonus;
  if (game.symbolBonus) renderKeyboard(game.current.name, game.current.symbols, fresh);
  renderUsed(index, [...game.used]);
}

// 用 setInterval 而不是 requestAnimationFrame：分頁切到背景時照樣倒數，不能靠切分頁暫停計時
function loop() {
  const now = performance.now();
  const left = game.msLeft(now);
  $('bomb-num').textContent = Math.ceil(left / 1000);
  $('bomb').classList.toggle('warn', left < 5000 && left >= 3000);
  $('bomb').classList.toggle('hot', left < 3000);
  const ev = game.tick(now);
  if (!ev) return;
  flash($('bomb'), 'boom');
  const parts = [`${ev.player} 時間到${ev.eliminated ? '，出局' : '，扣一顆心'}。`];
  if (ev.hint.length) {
    parts.push('可以這樣答：');
    ev.hint.forEach((w, i) => { if (i) parts.push('、'); parts.push(wordNode(index, w)); });
  }
  feedback(parts, 'bad');
  if (ev.over) { endGame(); return; }
  refresh();
  $('answer').value = '';
}

// 遊戲結束：先跳彈窗說明這局的結果，按「看結算」才進結算頁
function endGame() {
  clearInterval(timer);
  renderPlayers(game, Math.max(settings.lives, ...game.players.map((p) => p.lives)));
  renderShare();
  renderRanking(game);
  renderReview(game);
  renderSummary(game);
  overModal.open();
}

const REASON = {
  'not-in-dict': '辭典裡沒有這個詞',
  used: '這個詞本局用過了',
  'wrong-prefix': () => `要以「${game.prompt}」開頭，而且比它更長`,
  'wrong-pattern': () => ({
    initials: `要是 ${game.length} 個字，而且每個字的注音第一個符號符合提示`,
    tones: `要是 ${game.length} 個字，而且聲調符合提示`,
  })[game.mode],
};

function submit() {
  const input = $('answer').value.trim();
  if (!input || !game || game.over) return;
  const r = game.submit(input, performance.now());
  if (r.ok) {
    const parts = [wordNode(index, r.entry.w), `　${r.entry.idiom ? '成語　' : ''}+${r.gain} 分`];
    if (r.completed) parts.push(r.star ? '　集滿注音符號，多一顆心！' : '　集滿注音符號！心數已達上限。');
    feedback(parts, 'ok');
    $('answer').value = '';
    refresh(r.player === game.current.name ? r.newSymbols : []);
    if (r.completed) celebrate();
  } else {
    const msg = REASON[r.reason];
    feedback(typeof msg === 'function' ? msg() : msg, 'bad');
    flash($('answer'), 'shake');
  }
}

// 注音輸入法選字時的 Enter 是確認選字，不是送出（見 ime-safe-submit）
bindEnterSubmit($('answer'), submit);
$('btn-submit').onclick = submit;
$('btn-start').onclick = startGame;
$('btn-over-ok').onclick = () => { overModal.close(); show('over'); };
$('btn-replay').onclick = () => { $('seed-input').value = ''; startGame(); };
$('btn-again').onclick = () => { show('setup'); };

// ---- 分享：產生碼、複製、載入朋友的碼 ----
function renderShare() {
  const top = game.summary()[0];
  const result = { score: top.score, correct: top.correct, rounds: game.round - 1 };
  const code = encodeShare({ settings: played.settings, seed: played.seed, sig: dictSig(index), result });
  $('share-code').value = shareUrl(code);
  $('share-msg').textContent = `種子碼 ${played.seed}`;
  $('btn-share').hidden = typeof navigator.share !== 'function';
  const box = $('challenge');
  const s = played.settings;
  const same = challenge && challenge.result && challenge.seed === played.seed && challenge.settings.mode === s.mode
    && challenge.settings.length === s.length && challenge.settings.difficulty === s.difficulty;
  box.hidden = !same;
  if (same) {
    const f = challenge.result;
    const verdict = top.score > f.score ? '你贏了' : top.score < f.score ? '差一點，再挑戰一次' : '平手';
    box.replaceChildren();
    const b = document.createElement('b');
    b.textContent = verdict;
    box.append(b, `　朋友 ${f.score} 分、答對 ${f.correct} 題；你 ${top.score} 分、答對 ${top.correct} 題。`);
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const t = $('share-code');
  t.select();
  try { return document.execCommand('copy'); } catch { return false; }
}

$('btn-copy').onclick = async () => {
  $('share-msg').textContent = (await copyText($('share-code').value)) ? '已複製連結，傳給朋友就能玩同一份題目。' : '複製失敗，請手動選取上面的連結。';
};
$('btn-share').onclick = () => {
  const top = game.summary()[0];
  navigator.share({ title: '注音大師', text: `我在種子 ${played.seed} 得了 ${top.score} 分，來挑戰同一份題目`, url: $('share-code').value }).catch(() => {});
};

function loadCode(text) {
  const d = parseShareInput(text);
  if (!d) { $('code-msg').textContent = '這個分享碼無法辨識，請確認有完整貼上。'; return false; }
  Object.assign(settings, d.settings);
  $('seed-input').value = d.seed;
  challenge = { seed: d.seed, settings: d.settings, result: d.result };
  renderSetup();
  const m = MODES[d.settings.mode];
  let msg = `已載入：${m.label} ${d.settings.length} 字，種子 ${d.seed}。`;
  if (d.result) msg += `朋友得 ${d.result.score} 分、答對 ${d.result.correct} 題。`;
  msg += '按「開始」玩同一份題目。';
  if (d.sig !== '-' && d.sig !== dictSig(index)) msg += '（對方的詞庫版本和你不同，題目可能不完全一樣。）';
  $('code-msg').textContent = msg;
  return true;
}
$('btn-load-code').onclick = () => { if (loadCode($('code-input').value)) $('code-input').value = ''; };
bindEnterSubmit($('code-input'), () => $('btn-load-code').click());
$('btn-retry').onclick = () => { $('seed-input').value = played.seed; startGame(); };

async function boot() {
  loadSettings();
  renderSetup();
  const res = await fetch('data/words.json');
  index = buildIndex((await res.json()).words);
  show('setup');
  const c = new URLSearchParams(location.search).get('c');
  if (c) loadCode(c);
}
boot().catch(() => {
  document.querySelector('#screen-loading p').textContent = '詞庫載入失敗，請重新整理。';
});
