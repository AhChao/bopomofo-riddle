// 回合狀態機（本地版）。每一題獨立計時：換人、換題就把時間重設成完整的一題時間。
// 時間由呼叫端傳入 now（毫秒），不自己開計時器，之後可原樣放進 Durable Object。
import { buildPool, promptOrder, check, scoreOf, examples, minAnswersFor, symbolsOf, ALL_SYMBOLS } from './core.js';

export const DEFAULTS = { lives: 3, turnSeconds: 10 };
export const MAX_LIVES = 10;
// 縮短計時：每過一題少 0.25 秒，最短 3 秒
const OVERTIME_STEP_MS = 250;
const OVERTIME_FLOOR_MS = 3000;

export class Game {
  constructor({ index, mode, length, difficulty, names, lives = DEFAULTS.lives, turnSeconds = DEFAULTS.turnSeconds, minAnswers, longBonus = true, overtime = false, symbolBonus = true, seed = 'default', rng = Math.random }) {
    this.index = index;
    this.mode = mode;
    this.length = length;
    this.baseMs = turnSeconds * 1000;
    this.turnMs = this.baseMs;
    this.seed = seed;
    this.symbolBonus = symbolBonus;
    this.longBonus = longBonus;
    this.overtime = overtime;
    this.log = []; // 每一題的結果：{ round, player, prompt, outcome: 'ok' | 'timeout', ... }
    this.wrong = []; // 答錯的輸入：{ round, player, prompt, input, reason }
    this.rng = rng;
    this.pool = buildPool(index, mode, length, minAnswers ?? minAnswersFor(mode, length, difficulty));
    this.order = promptOrder(this.pool, seed);
    this.players = names.map((name) => ({ name, lives, score: 0, words: [], streak: 0, bestStreak: 0, timeouts: 0, wrongTries: 0, best: null, symbols: new Set(), stars: 0 }));
    this.used = new Set();
    this.turn = 0;
    this.prompt = null;
    this.turnEnd = 0;
    this.over = false;
    this.round = 0;
  }

  start(now) {
    this.nextQuestion(now);
  }

  get current() {
    return this.players[this.turn];
  }

  // 新的一題：換提示、時間整題重算
  nextQuestion(now) {
    this.round += 1;
    this.turnMs = this.overtime ? Math.max(OVERTIME_FLOOR_MS, this.baseMs - (this.round - 1) * OVERTIME_STEP_MS) : this.baseMs;
    this.prompt = this.order[(this.round - 1) % this.order.length];
    this.turnEnd = now + this.turnMs;
  }

  msLeft(now) {
    return Math.max(0, this.turnEnd - now);
  }

  alive() {
    return this.players.filter((p) => p.lives > 0);
  }

  nextAlive() {
    let i = this.turn;
    do i = (i + 1) % this.players.length;
    while (this.players[i].lives <= 0);
    return i;
  }

  submit(input, now) {
    if (this.over) return { ok: false, reason: 'over' };
    const r = check({
      index: this.index, pool: this.pool, mode: this.mode, length: this.length,
      prompt: this.prompt, input, used: this.used,
    });
    const p = this.current;
    if (!r.ok) {
      if (r.reason !== 'empty') {
        p.wrongTries += 1;
        this.wrong.push({ round: this.round, player: p.name, prompt: this.prompt, input: String(input).trim(), reason: r.reason });
      }
      return r;
    }
    const gain = scoreOf(r.entry, this.longBonus);
    p.score += gain;
    p.streak += 1;
    p.bestStreak = Math.max(p.bestStreak, p.streak);
    if (!p.best || gain > p.best.gain) p.best = { w: r.entry.w, gain };
    this.log.push({ round: this.round, player: p.name, prompt: this.prompt, outcome: 'ok', word: r.entry.w, gain, idiom: r.entry.idiom });
    // 注音符號集滿一輪：加一顆心，鍵盤重來（心數上限 MAX_LIVES）
    let newSymbols = [];
    let star = false;
    let completed = false;
    if (this.symbolBonus) {
      for (const s of symbolsOf(r.entry)) if (!p.symbols.has(s)) { p.symbols.add(s); newSymbols.push(s); }
      if (p.symbols.size >= ALL_SYMBOLS.length) {
        p.symbols = new Set();
        completed = true;
        p.stars += 1;
        star = p.lives < MAX_LIVES;
        if (star) p.lives += 1;
      }
    }
    p.words.push(r.entry.w);
    this.used.add(r.entry.w);
    this.turn = this.nextAlive();
    this.nextQuestion(now);
    return { ok: true, entry: r.entry, gain, newSymbols, star, completed, player: p.name };
  }

  // 每個 tick 呼叫；時間到時回傳爆炸事件，否則 null
  tick(now) {
    if (this.over || now < this.turnEnd) return null;
    const p = this.current;
    p.lives -= 1;
    p.streak = 0;
    p.timeouts += 1;
    const event = {
      type: 'boom', player: p.name, prompt: this.prompt, eliminated: p.lives <= 0,
      hint: examples(this.pool, this.prompt, 3, this.rng),
    };
    this.log.push({ round: this.round, player: p.name, prompt: this.prompt, outcome: 'timeout', hint: event.hint });
    // 多人：剩一人就結束；單人：命用完就結束
    if (this.alive().length <= (this.players.length === 1 ? 0 : 1)) {
      this.over = true;
      event.over = true;
    } else {
      this.turn = this.nextAlive();
      this.nextQuestion(now);
    }
    return event;
  }

  // 結算用：每位玩家的答對、超時、答錯次數與最佳成績
  summary() {
    return this.ranking().map((p) => ({
      name: p.name, lives: p.lives, score: p.score, stars: p.stars, correct: p.words.length, timeouts: p.timeouts,
      wrongTries: p.wrongTries, bestStreak: p.bestStreak, best: p.best,
    }));
  }

  ranking() {
    return [...this.players].sort((a, b) => b.lives - a.lives || b.score - a.score);
  }
}
