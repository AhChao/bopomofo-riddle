import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, check, examples, ALL_SYMBOLS } from '../web/js/core.js';
import { Game } from '../web/js/game.js';

// 小型假詞庫：每個提示只要有 1 個解就能開局
const raw = [
  ['風紀', ['ㄈㄥ ㄐㄧˋ'], 0], ['放假', ['ㄈㄤˋ ㄐㄧㄚˋ'], 0], ['方格', ['ㄈㄤ ㄍㄜˊ'], 0],
];
const index = buildIndex(raw);
const make = (extra = {}) => new Game({
  index, mode: 'initials', length: 2, difficulty: 'hard', names: ['甲', '乙'],
  lives: 2, turnSeconds: 10, minAnswers: 1, rng: () => 0, ...extra,
});

test('每一題獨立計時：答對後時間重設成完整一題', () => {
  const g = make();
  g.start(0);
  assert.equal(g.msLeft(0), 10000);
  assert.equal(g.msLeft(7000), 3000);
  const r = g.submit('風紀', 7000);
  assert.equal(r.ok, true);
  assert.equal(g.msLeft(7000), 10000, '換人換題後應重算整題時間');
  assert.equal(g.current.name, '乙');
});

test('答錯不重設時間', () => {
  const g = make();
  g.start(0);
  assert.equal(g.submit('不是詞', 4000).ok, false);
  assert.equal(g.msLeft(4000), 6000);
});

test('超時：扣一顆心、換人、換題、時間重設', () => {
  const g = make();
  g.start(0);
  assert.equal(g.tick(9999), null);
  const ev = g.tick(10000);
  assert.equal(ev.type, 'boom');
  assert.equal(ev.player, '甲');
  assert.equal(g.players[0].lives, 1);
  assert.equal(g.current.name, '乙');
  assert.equal(g.msLeft(10000), 10000);
});

test('多人剩一人結束；單人命用完結束', () => {
  const g = make({ lives: 1 });
  g.start(0);
  const ev = g.tick(10000);
  assert.equal(ev.over, true);
  assert.equal(g.ranking()[0].name, '乙');
  const solo = make({ names: ['獨'], lives: 2 });
  solo.start(0);
  assert.equal(solo.tick(10000).over, undefined);
  assert.equal(solo.tick(20000).over, true);
});

test('題數與連對：答對累加、爆炸歸零', () => {
  const g = make({ lives: 3 });
  g.start(0);
  assert.equal(g.round, 1);
  g.submit('風紀', 1000);
  assert.equal(g.round, 2);
  assert.equal(g.players[0].streak, 1);
  g.tick(11000);
  assert.equal(g.players[1].streak, 0);
  assert.equal(g.round, 3);
});

test('紀錄：答對、超時、答錯輸入都留下，結算摘要算得出來', () => {
  const g = make({ lives: 3 });
  g.start(0);
  g.submit('不是詞', 1000); // 乙以外：甲答錯
  g.submit('風紀', 2000); // 甲答對
  g.tick(13000); // 乙超時
  const s = Object.fromEntries(g.summary().map((p) => [p.name, p]));
  assert.equal(s['甲'].correct, 1);
  assert.equal(s['甲'].wrongTries, 1);
  assert.equal(s['乙'].timeouts, 1);
  assert.deepEqual(g.log.map((e) => e.outcome), ['ok', 'timeout']);
  assert.equal(g.wrong[0].input, '不是詞');
  assert.equal(g.wrong[0].reason, 'not-in-dict');
});

test('縮短計時：每題少 0.25 秒、最短 3 秒；長詞加分可關', () => {
  const g = make({ overtime: true, turnSeconds: 4 });
  g.start(0);
  assert.equal(g.turnMs, 4000);
  g.submit('風紀', 100);
  assert.equal(g.turnMs, 3750);
  for (let i = 0; i < 10; i++) g.nextQuestion(0);
  assert.equal(g.turnMs, 3000);
  const flat = make({ longBonus: false });
  flat.start(0);
  assert.equal(flat.submit('風紀', 0).gain, 1);
});

test('注音符號集滿一輪：加一顆心、鍵盤重來；關掉就不加', async () => {
  const { ALL_SYMBOLS } = await import('../web/js/core.js');
  const rest = ALL_SYMBOLS.filter((s) => s !== 'ㄅ');
  const chars = [...'壹貳參肆伍陸柒捌玖拾甲乙丙丁戊己庚辛壬癸子丑寅卯'];
  const words = [];
  for (let i = 0; i < rest.length; i += 2) {
    words.push([`${chars[i / 2]}${chars[i / 2 + 1]}`, [`ㄅ${rest[i]} ㄅ${rest[i + 1]}`], 0]);
  }
  const idx = buildIndex(words);
  const run = (symbolBonus) => {
    const g = new Game({ index: idx, mode: 'initials', length: 2, difficulty: 'hard', minAnswers: 1, names: ['甲'], lives: 2, symbolBonus, seed: 'X' });
    g.start(0);
    const results = words.map(([w]) => g.submit(w, 0));
    return { g, results };
  };
  const on = run(true);
  assert.equal(on.g.players[0].lives, 3);
  assert.equal(on.g.players[0].stars, 1);
  assert.equal(on.g.players[0].symbols.size, 0);
  assert.equal(on.results.at(-1).star, true);
  assert.ok(on.results[0].newSymbols.length >= 2);
  const off = run(false);
  assert.equal(off.g.players[0].lives, 2);
});

test('已知字數：開局提示帶原字，答對與 examples 都是池裡的合法答案', () => {
  const g = make({ hint: 1 });
  g.start(0);
  assert.equal(g.hint, 1);
  assert.ok([...g.prompt].some((c) => !ALL_SYMBOLS.includes(c)), g.prompt);
  for (const ex of examples(g.pool, g.prompt, 5, () => 0)) {
    assert.equal(check({ index, pool: g.pool, mode: 'initials', length: 2, prompt: g.prompt, input: ex, used: new Set() }).ok, true, ex);
  }
  assert.equal(g.submit(g.pool.get(g.prompt)[0], 0).ok, true);
});

test('已知字數：同種子同設定題序相同；非注音縮寫忽略 hint', () => {
  assert.deepEqual(make({ hint: 1, seed: 'S1' }).order, make({ hint: 1, seed: 'S1' }).order);
  assert.equal(make({ mode: 'tones', hint: 1 }).hint, 0);
});
