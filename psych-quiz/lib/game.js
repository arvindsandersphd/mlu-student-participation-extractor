// Live game logic. Everything about a game (including student nicknames)
// lives only in this process's memory and is deleted when the game ends.

const crypto = require('crypto');

const MODES = {
  classic: {
    name: 'Classic',
    blurb: 'Right answers score 500–1000 points. The faster you answer, the more you get.'
  },
  streak: {
    name: 'Streak Surge',
    blurb: 'Speed points, multiplied by your streak: ×1, ×1.5, ×2, ×2.5, up to ×3. A wrong answer resets the streak.'
  },
  boxes: {
    name: 'Mystery Boxes',
    blurb: 'Answer right, then pick one of three boxes on your phone. Bonus points, doubles, steals… or an empty box!'
  },
  norush: {
    name: 'No Rush',
    blurb: 'Every right answer is worth 1000 points. Speed does not matter, so everyone can think it through.'
  }
};

const BOX_POOL = [
  { type: 'add', amount: 250, weight: 3 },
  { type: 'add', amount: 500, weight: 2 },
  { type: 'double', weight: 2 },
  { type: 'triple', weight: 0.6 },
  { type: 'steal', pct: 0.2, weight: 2 },
  { type: 'nothing', weight: 1.6 }
];

const BLOCKED_WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'dick', 'cock', 'pussy', 'whore', 'slut', 'rape', 'nazi', 'retard', 'penis', 'vagina', 'asshole'];

const MAX_PLAYERS = 400;
const REVEAL_GRACE_MS = 600;

function randomId(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWeighted(pool) {
  const total = pool.reduce((s, b) => s + b.weight, 0);
  let r = Math.random() * total;
  for (const b of pool) { r -= b.weight; if (r <= 0) return b; }
  return pool[pool.length - 1];
}

function cleanName(raw) {
  return String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function nameIsBlocked(name) {
  const squashed = name.toLowerCase().replace(/[^a-z]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's');
  return BLOCKED_WORDS.some(w => squashed.includes(w));
}

class GameManager {
  constructor(io) {
    this.io = io;
    this.games = new Map();
    setInterval(() => this.sweep(), 60 * 1000).unref();
  }

  newCode() {
    for (let i = 0; i < 1000; i++) {
      const code = String(crypto.randomInt(100000, 1000000));
      if (!this.games.has(code)) return code;
    }
    throw new Error('Could not make a game code.');
  }

  // ---------- host actions ----------

  createGame(hostSocket, set, opts) {
    const mode = MODES[opts.mode] ? opts.mode : 'classic';
    const timer = Math.min(240, Math.max(5, parseInt(opts.timer, 10) || 20));
    let questions = set.questions.map(q => ({
      text: q.text, choices: q.choices.slice(0, 4), correct: q.correct, time: q.time
    }));
    if (opts.shuffleQuestions) questions = shuffle(questions);
    if (opts.shuffleAnswers) {
      questions = questions.map(q => {
        const order = shuffle([0, 1, 2, 3]);
        return { ...q, choices: order.map(i => q.choices[i]), correct: order.indexOf(q.correct) };
      });
    }
    const limit = parseInt(opts.questionCount, 10);
    if (limit > 0 && limit < questions.length) questions = questions.slice(0, limit);

    const code = this.newCode();
    const game = {
      code,
      hostKey: randomId(18),
      hostSocketId: hostSocket.id,
      hostGoneSince: null,
      title: set.title,
      questions,
      mode,
      timer,
      phase: 'lobby',
      qIndex: -1,
      qStartedAt: 0,
      qLimitMs: 0,
      timerHandle: null,
      players: new Map(), // token -> player
      lastActivity: Date.now()
    };
    this.games.set(code, game);
    hostSocket.join(this.hostRoom(code));
    hostSocket.data.hostOf = code;
    return game;
  }

  hostRoom(code) { return 'host:' + code; }
  playerRoom(code) { return 'players:' + code; }

  rejoinHost(socket, code, hostKey) {
    const game = this.games.get(code);
    if (!game || game.hostKey !== hostKey) return null;
    game.hostSocketId = socket.id;
    game.hostGoneSince = null;
    socket.join(this.hostRoom(code));
    socket.data.hostOf = code;
    return game;
  }

  hostGame(socket) {
    const code = socket.data.hostOf;
    const game = code && this.games.get(code);
    if (game) game.lastActivity = Date.now();
    return game || null;
  }

  hostState(game) {
    const base = {
      code: game.code,
      title: game.title,
      mode: game.mode,
      modeName: MODES[game.mode].name,
      modeBlurb: MODES[game.mode].blurb,
      total: game.questions.length,
      phase: game.phase,
      players: this.lobbyList(game)
    };
    if (game.phase === 'question') Object.assign(base, { question: this.questionPayload(game), answered: this.answeredCount(game) });
    if (game.phase === 'reveal') Object.assign(base, { question: this.questionPayload(game), reveal: this.revealPayload(game) });
    return base;
  }

  lobbyList(game) {
    return [...game.players.values()].map(p => ({ id: p.id, name: p.name, connected: p.connected }));
  }

  startGame(game) {
    if (game.phase !== 'lobby') return;
    this.nextQuestion(game);
  }

  advance(game) {
    if (game.phase === 'question') return this.endQuestion(game);
    if (game.phase === 'reveal') {
      this.closeBoxes(game);
      if (game.qIndex + 1 >= game.questions.length) return this.finish(game);
      return this.nextQuestion(game);
    }
    if (game.phase === 'lobby') return this.startGame(game);
  }

  kick(game, playerId) {
    for (const [token, p] of game.players) {
      if (p.id === playerId) {
        game.players.delete(token);
        if (p.socketId) {
          const s = this.io.sockets.sockets.get(p.socketId);
          if (s) { s.emit('kicked'); s.leave(this.playerRoom(game.code)); s.data.playerOf = null; }
        }
        this.emitLobby(game);
        if (game.phase === 'question') this.checkAllAnswered(game);
        return;
      }
    }
  }

  // ---------- player actions ----------

  joinPlayer(socket, code, rawName) {
    const game = this.games.get(String(code || '').trim());
    if (!game) return { error: 'No game with that code. Check the code and try again.' };
    if (game.phase === 'end') return { error: 'That game has ended.' };
    const name = cleanName(rawName);
    if (!name) return { error: 'Please type a nickname.' };
    if (nameIsBlocked(name)) return { error: 'Please pick a different nickname.' };
    const taken = [...game.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase());
    if (taken) return { error: 'Someone already has that nickname. Try another one.' };
    if (game.players.size >= MAX_PLAYERS) return { error: 'This game is full.' };
    const player = {
      token: randomId(18),
      id: randomId(6),
      name,
      socketId: socket.id,
      connected: true,
      score: 0,
      streak: 0,
      correctCount: 0,
      answer: null,
      answerMs: 0,
      lastGain: 0,
      lastCorrect: false,
      box: null
    };
    game.players.set(player.token, player);
    this.attachPlayer(socket, game, player);
    this.emitLobby(game);
    return { ok: true, token: player.token, name, state: this.playerState(game, player) };
  }

  rejoinPlayer(socket, code, token) {
    const game = this.games.get(String(code || ''));
    const player = game && game.players.get(token);
    if (!player) return { error: 'gone' };
    player.socketId = socket.id;
    player.connected = true;
    this.attachPlayer(socket, game, player);
    this.emitLobby(game);
    return { ok: true, name: player.name, state: this.playerState(game, player) };
  }

  attachPlayer(socket, game, player) {
    socket.join(this.playerRoom(game.code));
    socket.data.playerOf = { code: game.code, token: player.token };
  }

  playerFor(socket) {
    const ref = socket.data.playerOf;
    if (!ref) return {};
    const game = this.games.get(ref.code);
    const player = game && game.players.get(ref.token);
    if (game) game.lastActivity = Date.now();
    return { game, player };
  }

  playerState(game, player) {
    const s = { phase: game.phase, mode: game.mode, modeName: MODES[game.mode].name, modeBlurb: MODES[game.mode].blurb, score: player.score, title: game.title };
    if (game.phase === 'question') {
      s.question = this.questionPayload(game);
      s.answered = player.answer !== null;
      s.myAnswer = player.answer;
    }
    if (game.phase === 'reveal') s.result = this.playerResult(game, player);
    return s;
  }

  answer(socket, choice) {
    const { game, player } = this.playerFor(socket);
    if (!game || !player || game.phase !== 'question' || player.answer !== null) return;
    choice = parseInt(choice, 10);
    if (!(choice >= 0 && choice <= 3)) return;
    player.answer = choice;
    player.answerMs = Math.min(Date.now() - game.qStartedAt, game.qLimitMs);
    socket.emit('answer-locked', { choice });
    this.io.to(this.hostRoom(game.code)).emit('answered', { answered: this.answeredCount(game), total: game.players.size });
    this.checkAllAnswered(game);
  }

  pickBox(socket, index) {
    const { game, player } = this.playerFor(socket);
    if (!game || !player || game.phase !== 'reveal' || !player.box || player.box.picked !== null) return;
    index = parseInt(index, 10);
    if (!(index >= 0 && index <= 2)) return;
    this.openBox(game, player, index);
    this.io.to(this.hostRoom(game.code)).emit('leaderboard', {
      leaderboard: this.leaderboard(game),
      boxesOpened: this.boxesOpened(game)
    });
  }

  disconnect(socket) {
    const hostCode = socket.data.hostOf;
    if (hostCode) {
      const game = this.games.get(hostCode);
      if (game && game.hostSocketId === socket.id) game.hostGoneSince = Date.now();
    }
    const { game, player } = this.playerFor(socket);
    if (game && player && player.socketId === socket.id) {
      player.connected = false;
      this.emitLobby(game);
      if (game.phase === 'question') this.checkAllAnswered(game);
    }
  }

  // ---------- flow ----------

  questionPayload(game) {
    const q = game.questions[game.qIndex];
    const remaining = game.phase === 'question' ? Math.max(0, game.qStartedAt + game.qLimitMs - Date.now()) : 0;
    return {
      index: game.qIndex,
      total: game.questions.length,
      text: q.text,
      choices: q.choices,
      seconds: Math.round(game.qLimitMs / 1000),
      remainingMs: remaining
    };
  }

  nextQuestion(game) {
    game.qIndex += 1;
    game.phase = 'question';
    const q = game.questions[game.qIndex];
    game.qLimitMs = (q.time || game.timer) * 1000;
    game.qStartedAt = Date.now() + REVEAL_GRACE_MS; // small head start for phones to render
    for (const p of game.players.values()) {
      p.answer = null; p.answerMs = 0; p.lastGain = 0; p.lastCorrect = false; p.box = null;
    }
    const payload = this.questionPayload(game);
    payload.remainingMs = game.qLimitMs;
    this.io.to(this.hostRoom(game.code)).emit('question', { ...payload, answered: 0, totalPlayers: game.players.size });
    this.io.to(this.playerRoom(game.code)).emit('question', payload);
    clearTimeout(game.timerHandle);
    game.timerHandle = setTimeout(() => this.endQuestion(game), game.qLimitMs + REVEAL_GRACE_MS + 250);
  }

  answeredCount(game) {
    let n = 0;
    for (const p of game.players.values()) if (p.answer !== null) n++;
    return n;
  }

  checkAllAnswered(game) {
    if (game.phase !== 'question') return;
    const active = [...game.players.values()].filter(p => p.connected);
    if (active.length && active.every(p => p.answer !== null)) {
      clearTimeout(game.timerHandle);
      game.timerHandle = setTimeout(() => this.endQuestion(game), 700);
    }
  }

  scoreFor(game, player) {
    const frac = game.qLimitMs ? Math.max(0, Math.min(1, player.answerMs / game.qLimitMs)) : 0;
    const speedPoints = Math.round(1000 - 500 * frac);
    if (game.mode === 'norush') return 1000;
    if (game.mode === 'streak') {
      const mult = 1 + 0.5 * Math.min(player.streak - 1, 4);
      return Math.round(speedPoints * mult);
    }
    return speedPoints;
  }

  endQuestion(game) {
    if (game.phase !== 'question') return;
    clearTimeout(game.timerHandle);
    game.phase = 'reveal';
    const q = game.questions[game.qIndex];
    for (const p of game.players.values()) {
      const correct = p.answer === q.correct;
      p.lastCorrect = correct;
      if (correct) {
        p.streak += 1;
        p.correctCount += 1;
        p.lastGain = this.scoreFor(game, p);
        p.score += p.lastGain;
        if (game.mode === 'boxes') {
          p.box = { options: [pickWeighted(BOX_POOL), pickWeighted(BOX_POOL), pickWeighted(BOX_POOL)], picked: null, outcome: null };
        }
      } else {
        p.streak = 0;
        p.lastGain = 0;
      }
    }
    this.io.to(this.hostRoom(game.code)).emit('reveal', this.revealPayload(game));
    for (const p of game.players.values()) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit('result', this.playerResult(game, p));
    }
  }

  revealPayload(game) {
    const q = game.questions[game.qIndex];
    const counts = [0, 0, 0, 0];
    for (const p of game.players.values()) if (p.answer !== null) counts[p.answer]++;
    return {
      correct: q.correct,
      counts,
      leaderboard: this.leaderboard(game),
      isLast: game.qIndex + 1 >= game.questions.length,
      boxesOpened: this.boxesOpened(game)
    };
  }

  boxesOpened(game) {
    if (game.mode !== 'boxes') return null;
    let total = 0, opened = 0;
    for (const p of game.players.values()) {
      if (p.box) { total++; if (p.box.picked !== null) opened++; }
    }
    return { opened, total };
  }

  rankOf(game, player) {
    return this.sorted(game).findIndex(p => p === player) + 1;
  }

  playerResult(game, player) {
    const q = game.questions[game.qIndex];
    return {
      correct: player.lastCorrect,
      answered: player.answer !== null,
      correctIndex: q.correct,
      correctText: q.choices[q.correct],
      gained: player.lastGain,
      score: player.score,
      streak: player.streak,
      rank: this.rankOf(game, player),
      totalPlayers: game.players.size,
      boxes: player.box && player.box.picked === null ? 3 : null,
      boxOutcome: player.box && player.box.outcome ? player.box.outcome : null
    };
  }

  openBox(game, player, index) {
    const box = player.box.options[index];
    let gain = 0;
    let text = '';
    let stolenFrom = null;
    if (box.type === 'add') { gain = box.amount; text = `+${box.amount} bonus points!`; }
    else if (box.type === 'double') { gain = player.lastGain; text = `Double! +${gain} more points!`; }
    else if (box.type === 'triple') { gain = player.lastGain * 2; text = `TRIPLE! +${gain} more points!`; }
    else if (box.type === 'nothing') { text = 'Empty box… better luck next time!'; }
    else if (box.type === 'steal') {
      const ahead = [...game.players.values()].filter(p => p !== player && p.score > player.score);
      if (ahead.length) {
        const victim = ahead[crypto.randomInt(ahead.length)];
        const amt = Math.max(100, Math.round(victim.score * box.pct));
        const take = Math.min(amt, victim.score);
        victim.score -= take;
        gain = take;
        stolenFrom = victim.name;
        text = `You swiped ${take} points from ${victim.name}!`;
        if (victim.socketId) this.io.to(victim.socketId).emit('robbed', { amount: take, by: player.name, score: victim.score });
      } else {
        gain = 300;
        text = 'Nobody ahead of you to steal from, so +300 instead!';
      }
    }
    player.score += gain;
    player.box.picked = index;
    player.box.outcome = {
      index, type: box.type, gain, text, stolenFrom,
      all: player.box.options.map(b => this.boxLabel(b))
    };
    const s = player.socketId && this.io.sockets.sockets.get(player.socketId);
    if (s) s.emit('box-opened', { ...player.box.outcome, score: player.score, rank: this.rankOf(game, player) });
  }

  boxLabel(b) {
    if (b.type === 'add') return `+${b.amount}`;
    if (b.type === 'double') return 'Double';
    if (b.type === 'triple') return 'Triple';
    if (b.type === 'steal') return 'Steal';
    return 'Empty';
  }

  closeBoxes(game) {
    if (game.mode !== 'boxes') return;
    for (const p of game.players.values()) {
      if (p.box && p.box.picked === null) this.openBox(game, p, crypto.randomInt(3));
    }
  }

  sorted(game) {
    return [...game.players.values()].sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.name.localeCompare(b.name));
  }

  leaderboard(game, n = 10) {
    return this.sorted(game).slice(0, n).map((p, i) => ({
      rank: i + 1, id: p.id, name: p.name, score: p.score, gained: p.lastGain, streak: p.streak, correct: p.lastCorrect
    }));
  }

  finish(game) {
    clearTimeout(game.timerHandle);
    game.phase = 'end';
    const sorted = this.sorted(game);
    const total = game.questions.length;
    const podium = sorted.slice(0, 3).map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, correctCount: p.correctCount }));
    this.io.to(this.hostRoom(game.code)).emit('podium', {
      podium,
      leaderboard: this.leaderboard(game, 10),
      totalQuestions: total,
      totalPlayers: sorted.length
    });
    sorted.forEach((p, i) => {
      if (p.socketId) this.io.to(p.socketId).emit('final', {
        rank: i + 1, score: p.score, correctCount: p.correctCount, totalQuestions: total, totalPlayers: sorted.length,
        podium: podium.map(x => ({ rank: x.rank, name: x.name, score: x.score }))
      });
    });
    this.destroy(game);
  }

  endEarly(game) {
    if (game.phase === 'lobby') {
      this.io.to(this.playerRoom(game.code)).emit('game-closed');
      this.destroy(game);
      return;
    }
    if (game.phase === 'question') this.endQuestion(game);
    this.closeBoxes(game);
    this.finish(game);
  }

  // Wipes the game, including every nickname, from memory.
  destroy(game) {
    clearTimeout(game.timerHandle);
    const room = this.playerRoom(game.code);
    for (const s of this.io.sockets.adapter.rooms.get(room) || []) {
      const sock = this.io.sockets.sockets.get(s);
      if (sock) { sock.data.playerOf = null; sock.leave(room); }
    }
    const hroom = this.hostRoom(game.code);
    for (const s of this.io.sockets.adapter.rooms.get(hroom) || []) {
      const sock = this.io.sockets.sockets.get(s);
      if (sock) { sock.data.hostOf = null; sock.leave(hroom); }
    }
    game.players.clear();
    game.questions = [];
    this.games.delete(game.code);
  }

  emitLobby(game) {
    this.io.to(this.hostRoom(game.code)).emit('players', { players: this.lobbyList(game), answered: this.answeredCount(game) });
  }

  // Removes abandoned games so names never linger.
  sweep() {
    const now = Date.now();
    for (const game of [...this.games.values()]) {
      const idle = now - game.lastActivity;
      const hostGone = game.hostGoneSince && now - game.hostGoneSince > 20 * 60 * 1000;
      if (hostGone || idle > 3 * 60 * 60 * 1000) {
        this.io.to(this.playerRoom(game.code)).emit('game-closed');
        this.destroy(game);
      }
    }
  }
}

module.exports = { GameManager, MODES };
