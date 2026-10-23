// 瀏覽器端到端走查：用真的點擊與鍵盤輸入，走完「設定 → 對局 → 答對/答錯 → 爆炸 → 結算 → 再玩」。
// 用法：先啟動本地靜態伺服器，再 node tests/e2e.mjs（BASE 預設 http://127.0.0.1:8765）。
// Playwright 借用隔壁 repo 的安裝（見 headless-browser-driver 的 lib.mjs）。
import { loadPlaywright } from '/Users/stevenchao/.claude/skills/headless-browser-driver/scripts/lib.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex, buildPool } from '../web/js/core.js';

const BASE = process.env.BASE || 'http://127.0.0.1:8765';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = buildIndex(JSON.parse(readFileSync(join(root, 'web/data/words.json'), 'utf8')).words);
const SYM = { 'ˉ': '1', 'ˊ': '2', 'ˇ': '3', 'ˋ': '4', '˙': '5' };
const KEY = { 指定開頭: 'prefix', 注音縮寫: 'initials', 聲調: 'tones' };
const SCENARIOS = [
  ['指定開頭', 2], ['指定開頭', 3], ['注音縮寫', 2], ['注音縮寫', 3], ['注音縮寫', 4],
  ['聲調', 2], ['聲調', 3], ['聲調', 4],
];

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++; };

await page.goto(BASE);
await page.waitForSelector('#screen-setup.active');
const setRange = (sel, v) => page.$eval(sel, (el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
const SHOTS = process.env.SHOTS;
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
await shot('setup');
check((await page.inputValue('#names')) === '玩家 1', '預設只有一位玩家「玩家 1」');
check((await page.inputValue('#time-range')) === '10' && (await page.inputValue('#lives-range')) === '3', '預設每題 10 秒、3 顆心');
check((await page.getAttribute('#mode-options .choice.on', 'class')) !== null && (await page.textContent('#mode-options .choice.on')) === '注音縮寫', '預設模式是注音縮寫');

for (const [mode, len] of SCENARIOS) {
  const tag = `${mode} ${len}字`;
  await page.click(`#mode-options button:text-is("${mode}")`);
  await page.click(`#length-options button:text-is("${len} 字")`);
  await page.click('#difficulty-options button:text-is("簡單")');
  await setRange('#time-range', 5);
  await setRange('#lives-range', 1);
  await page.fill('#names', '甲\n乙');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-game.active');

  const promptKey = async () => (await page.$$eval('#prompt .ch', (els) => els.map((e) => e.textContent)))
    .map((c) => (KEY[mode] === 'tones' ? SYM[c] : c)).join('');
  const pool = buildPool(index, KEY[mode], len, 1);

  await page.fill('#answer', '不是詞語');
  await page.press('#answer', 'Enter');
  check(/辭典裡沒有/.test(await page.textContent('#feedback')), `${tag}：不在辭典的詞被擋`);

  let okCount = 0;
  const seenTurns = new Set();
  const used = [];
  for (let i = 0; i < 2; i++) {
    seenTurns.add(await page.textContent('#turn-name'));
    const key = await promptKey();
    const ans = (pool.get(key) || []).find((w) => !used.includes(w));
    await page.fill('#answer', ans);
    await page.press('#answer', 'Enter');
    used.push(ans);
    if (/分/.test(await page.textContent('#feedback')) && (await page.getAttribute('#feedback', 'class')).includes('ok')) okCount++;
  }
  check(okCount === 2, `${tag}：連續答對兩次得分`);
  check(seenTurns.size === 2, `${tag}：答對後換人`);
  const usedShown = await page.$$eval('#used-words .w', (els) => els.map((e) => [...e.querySelectorAll('ruby')].map((r) => r.firstChild.textContent).join('')));
  check(used.every((w) => usedShown.includes(w)), `${tag}：已用詞列出`);
  const rts = await page.$$eval('#used-words .w rt', (els) => els.map((e) => e.textContent));
  check(rts.length > 0 && rts.every((t) => /[\u3105-\u312f]/.test(t)), `${tag}：已用詞每個字都有注音`);
  await shot(`game-${KEY[mode]}-${len}`);

  await page.fill('#answer', used[0]);
  await page.press('#answer', 'Enter');
  check(/用過/.test(await page.textContent('#feedback')), `${tag}：重複的詞被擋`);

  // 不再作答，等兩人依序被炸到出局
  await page.waitForSelector('#over-modal:not([hidden])', { timeout: 60000 });
  const modalText = await page.textContent('#over-body');
  check(/答對/.test(modalText) && /時間到/.test(modalText), `${tag}：結束時先跳結算彈窗（${modalText.slice(0, 40)}…）`);
  check(!(await page.$eval('#screen-over', (e) => e.classList.contains('active'))), `${tag}：彈窗未確認前不進結算頁`);
  await page.keyboard.press('Escape');
  check(await page.isVisible('#over-modal'), `${tag}：Esc 不能略過彈窗`);
  await shot(`modal-${KEY[mode]}-${len}`);
  await page.click('#btn-over-ok');
  await page.waitForSelector('#screen-over.active');
  await shot(`over-${KEY[mode]}-${len}`);
  const rows = await page.$$eval('#ranking .rank', (els) => els.map((e) => e.textContent));
  check(rows.length === 2 && /分/.test(rows[0]), `${tag}：結算畫面有排名（${rows[0]}）`);
  await page.click('#btn-again');
  await page.waitForSelector('#screen-setup.active');
}

// 單人練習與注音輸入法 Enter
await page.click('#mode-options button:text-is("注音縮寫")');
await page.click('#length-options button:text-is("2 字")');
await setRange('#time-range', 5);
await page.fill('#names', '獨玩');
await page.click('#btn-start');
await page.waitForSelector('#screen-game.active');
const soloFirstPrompt = await page.$$eval('#prompt .cell', (els) => els.map((e) => e.textContent).join('|'));
const before = await page.textContent('#players');
await page.fill('#answer', '隨便');
await page.evaluate(() => {
  const a = document.getElementById('answer');
  a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
});
check((await page.textContent('#feedback')) === '', '輸入法選字中的 Enter 不送出答案');
check(before === (await page.textContent('#players')), '單人局：玩家列正常');
await page.waitForSelector('#over-modal:not([hidden])', { timeout: 60000 });
check(/的心都用完了/.test(await page.textContent('#over-body')), '單人局：彈窗說明心用完了');
await page.click('#btn-over-ok');
await page.waitForSelector('#screen-over.active');
check((await page.$$('#review .sum-row')).length >= 1, '單人局：結算頁有逐題回顧');
// 分享與種子：同一份題目
const code1 = await page.inputValue('#share-code');
const seed1 = (await page.textContent('#share-msg')).replace('種子碼 ', '').trim();
check(/\?c=[A-Za-z0-9_-]+$/.test(code1) && /^[A-Z2-9]{6}$/.test(seed1), `結算頁產生分享連結與種子碼（${seed1}）`);
await page.click('#btn-retry');
await page.waitForSelector('#screen-game.active');
check((await page.textContent('#seed-tag')) === seed1, '「同一份題目再挑戰」沿用同一個種子');
const retryFirst = await page.$$eval('#prompt .cell', (els) => els.map((e) => e.textContent).join('|'));
check(retryFirst === soloFirstPrompt, `同種子第一題相同（${retryFirst}）`);

const p2 = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await p2.goto(code1);
await p2.waitForSelector('#screen-setup.active');
const loadedMsg = await p2.textContent('#code-msg');
check(/已載入/.test(loadedMsg) && loadedMsg.includes(seed1) && /朋友得/.test(loadedMsg), `貼連結開頁自動載入設定與朋友成績（${loadedMsg.slice(0, 40)}…）`);
check((await p2.inputValue('#seed-input')) === seed1, '種子碼欄位帶入');
await p2.click('#btn-start');
await p2.waitForSelector('#screen-game.active');
const friendFirst = await p2.$$eval('#prompt .cell', (els) => els.map((e) => e.textContent).join('|'));
check(friendFirst === soloFirstPrompt && (await p2.textContent('#seed-tag')) === seed1, '朋友開局的第一題與種子完全相同');
await p2.close();

const p3 = await browser.newPage({ viewport: { width: 1100, height: 800 } });
await p3.goto(BASE);
await p3.waitForSelector('#screen-setup.active');
await p3.fill('#code-input', '亂打的碼');
await p3.click('#btn-load-code');
check(/無法辨識/.test(await p3.textContent('#code-msg')), '壞的分享碼會提示無法辨識');
await p3.fill('#code-input', code1);
await p3.click('#btn-load-code');
check(/已載入/.test(await p3.textContent('#code-msg')), '在輸入框貼上連結也能載入');
await p3.close();

// 注音符號鍵盤：答對後亮起
{
  const key = (await page.$$eval('#prompt .cell', (els) => els.map((e) => e.textContent))).join('');
  const ans = buildPool(index, 'initials', 2, 1).get(key)[0];
  const lit0 = (await page.$$('.kb-key.on')).length;
  await page.fill('#answer', ans);
  await page.press('#answer', 'Enter');
  const lit1 = (await page.$$('.kb-key.on')).length;
  check(lit0 === 0 && lit1 > 0, `答對後注音符號亮起（${lit0} → ${lit1}）`);
  check(/\d+ \/ 37/.test(await page.textContent('.kb-head')), '鍵盤顯示集滿進度 n / 37');
  await shot('keyboard');
}

// 版面：手機不橫向捲動、電腦寬螢幕不被窄欄限制
for (const [w, h, name] of [[390, 844, 'mobile'], [1600, 900, 'wide']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, stage: document.querySelector('.stage').getBoundingClientRect().width, used: document.querySelector('.used').getBoundingClientRect().width, inputBottom: document.getElementById('answer').getBoundingClientRect().bottom }));
  check(m.sw <= m.iw, `${name} ${w}px：沒有橫向捲動（${m.sw}/${m.iw}）`);
  check(m.inputBottom <= h, `${name}：作答輸入框在第一屏內（${Math.round(m.inputBottom)}/${h}）`);
  if (name === 'wide') check(m.stage + m.used > 900, `${name}：寬螢幕兩欄展開（舞台 ${Math.round(m.stage)} + 已用 ${Math.round(m.used)}）`);
  await shot(`layout-${name}`);
}

check(errors.length === 0, `主控台沒有錯誤${errors.length ? '：' + errors.join(' | ') : ''}`);
await browser.close();
console.log(failed ? `\n${failed} 項失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
