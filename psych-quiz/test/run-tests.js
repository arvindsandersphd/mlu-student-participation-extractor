// Plays full simulated games against a real server and checks the results.
// Run with:  npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const importer = require('../lib/importer');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
const PW = 'test-pass';
let passed = 0;

function ok(name) { passed++; console.log('  ✓ ' + name); }
const wait = ms => new Promise(r => setTimeout(r, ms));
const once = (s, ev, ms = 8000) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout waiting for ' + ev)), ms);
  s.once(ev, d => { clearTimeout(t); res(d); });
});
const emitAck = (s, ev, data) => new Promise(r => s.emit(ev, data, r));

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, {
    method: opts.method || 'GET',
    headers: Object.assign({ 'x-teacher-password': PW, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function playGame(setId, mode, answerPlan) {
  const host = io(BASE, { forceNew: true });
  const res = await emitAck(host, 'host:create', { setId, mode, timer: 10, password: PW });
  assert.ok(res.ok, 'host can create game: ' + JSON.stringify(res));
  assert.match(res.code, /^\d{6}$/);

  const names = ['Ada', 'Bo', 'Cy'];
  const players = [];
  for (const name of names) {
    const s = io(BASE, { forceNew: true });
    const j = await emitAck(s, 'player:join', { code: res.code, name });
    assert.ok(j.ok, 'player joins');
    s.results = [];
    s.on('result', r => s.results.push(r));
    s.on('result', r => { if (r.boxes) setTimeout(() => s.emit('player:box', { index: 1 }), 50); });
    players.push(s);
  }
  const dup = io(BASE, { forceNew: true });
  const d = await emitAck(dup, 'player:join', { code: res.code, name: 'ada' });
  assert.ok(d.error && /already/.test(d.error), 'duplicate nickname rejected');
  dup.close();

  const total = res.state.total;
  let podium;
  host.on('podium', p => { podium = p; });
  for (let qi = 0; qi < total; qi++) {
    const qp = Promise.all(players.map(p => once(p, 'question')));
    host.emit(qi === 0 ? 'host:start' : 'host:next');
    const qs = await qp;
    assert.strictEqual(qs[0].index, qi);
    assert.ok(qs[0].text && qs[0].choices.length === 4, 'phones get the question text and 4 choices');
    const reveal = once(host, 'reveal');
    players.forEach((p, i) => setTimeout(() => p.emit('player:answer', { choice: answerPlan(i, qi) }), 700 + i * 400));
    await reveal; // ends early because everyone answered
    await wait(mode === 'boxes' ? 300 : 50);
  }
  const fin = Promise.all(players.map(p => once(p, 'final')));
  host.emit('host:next');
  const finals = await fin;
  await wait(100);
  assert.ok(podium && podium.podium.length === 3, 'podium has top 3');
  players.forEach(p => p.close());
  host.close();
  return { code: res.code, podium, finals, players };
}

(async () => {
  const setsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psychrush-'));
  fs.copyFileSync(path.join(ROOT, 'question-sets/intro-psych-sample.json'), path.join(setsDir, 'intro-psych-sample.json'));
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, TEACHER_PASSWORD: PW, SETS_DIR: setsDir }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  srv.stdout.on('data', c => { out += c; });
  try {
    for (let i = 0; i < 50 && !out.includes('running'); i++) await wait(100);

    console.log('Importer');
    const csv = importer.importText('Question,A,B,C,D,Correct\n"Who said ""cogito""?",Descartes,Locke,Hume,Kant,A\nBad row,x,y\nQ2,a,b,c,d,b,30\nQ3,one,two,three,four,three');
    assert.strictEqual(csv.questions.length, 3);
    assert.strictEqual(csv.questions[0].text, 'Who said "cogito"?');
    assert.strictEqual(csv.questions[1].correct, 1);
    assert.strictEqual(csv.questions[1].time, 30);
    assert.strictEqual(csv.questions[2].correct, 2);
    assert.strictEqual(csv.problems.length, 1);
    ok('CSV with header, quotes, letters, answer text, and a bad row');
    const tsv = importer.importText('What?\tw\tx\ty\tz\tD');
    assert.strictEqual(tsv.questions[0].correct, 3);
    ok('pasted tab-separated rows (from Excel / Google Sheets)');
    const xl = importer.importFile(fs.readFileSync(path.join(ROOT, 'examples/intro-psych-sample.xlsx')), 'x.xlsx');
    assert.strictEqual(xl.questions.length, 10);
    assert.strictEqual(xl.questions[1].time, 30);
    const sample = JSON.parse(fs.readFileSync(path.join(ROOT, 'question-sets/intro-psych-sample.json')));
    xl.questions.forEach((q, i) => { assert.strictEqual(q.text, sample.questions[i].text); assert.strictEqual(q.correct, sample.questions[i].correct); });
    ok('.xlsx spreadsheet import (10 questions match the sample set)');
    const round = importer.importText(importer.toCsv(sample));
    assert.deepStrictEqual(round.questions.map(q => q.text), sample.questions.map(q => q.text));
    ok('download-as-CSV can be imported back');

    console.log('Web API');
    assert.strictEqual((await api('/api/sets', { headers: { 'x-teacher-password': 'wrong' } })).status, 401);
    ok('teacher password is required for sets');
    const created = await api('/api/sets', { method: 'POST', body: JSON.stringify({ title: 'Mini', questions: sample.questions.slice(0, 3) }) });
    assert.ok(created.data.id);
    const bad = await api('/api/sets', { method: 'POST', body: JSON.stringify({ title: 'Bad', questions: [{ text: 'x', choices: ['a', 'b'], correct: 0 }] }) });
    assert.strictEqual(bad.status, 400);
    const listed = (await api('/api/sets')).data;
    assert.ok(listed.some(s => s.id === created.data.id && s.count === 3));
    const upd = await api('/api/sets/' + created.data.id, { method: 'PUT', body: JSON.stringify({ title: 'Mini 2', questions: sample.questions.slice(0, 4) }) });
    assert.strictEqual(upd.status, 200);
    assert.strictEqual((await api('/api/sets/' + created.data.id)).data.questions.length, 4);
    assert.strictEqual((await api('/api/sets/..%2Fserver')).status, 404);
    ok('create, validate, list, update sets; path tricks blocked');
    const upload = await fetch(BASE + '/api/import-file', { method: 'POST', headers: { 'x-teacher-password': PW, 'x-filename': encodeURIComponent('Psych é.xlsx') }, body: fs.readFileSync(path.join(ROOT, 'examples/intro-psych-sample.xlsx')) });
    assert.strictEqual((await upload.json()).questions.length, 10);
    ok('spreadsheet upload through the web page');
    for (const p of ['/', '/host', '/editor', '/template.csv', '/socket.io/socket.io.js']) {
      assert.strictEqual((await fetch(BASE + p)).status, 200, p);
    }
    ok('pages load');
    fs.copyFileSync(path.join(ROOT, 'examples/intro-psych-sample.xlsx'), path.join(setsDir, 'Chapter 1 Quiz.xlsx'));
    const withSheet = (await api('/api/sets')).data;
    const sheetSet = withSheet.find(s => s.id === 'sheet-chapter-1-quiz');
    assert.ok(sheetSet && sheetSet.count === 10 && sheetSet.title === 'Chapter 1 Quiz', JSON.stringify(withSheet));
    assert.strictEqual((await api('/api/sets/sheet-chapter-1-quiz', { method: 'DELETE' })).status, 400);
    const copy = await api('/api/sets/sheet-chapter-1-quiz', { method: 'PUT', body: JSON.stringify({ title: 'Ch 1 edited', questions: sample.questions.slice(0, 2) }) });
    assert.ok(copy.data.copied && copy.data.id !== 'sheet-chapter-1-quiz');
    assert.ok(fs.existsSync(path.join(setsDir, 'Chapter 1 Quiz.xlsx')));
    const sheetHost = io(BASE, { forceNew: true });
    assert.ok((await emitAck(sheetHost, 'host:create', { setId: 'sheet-chapter-1-quiz', password: PW })).ok);
    sheetHost.close();
    ok('spreadsheets placed in the question-sets folder show up and can be hosted');

    console.log('Games');
    const hostBad = io(BASE, { forceNew: true });
    assert.ok((await emitAck(hostBad, 'host:create', { setId: 'intro-psych-sample', password: 'nope' })).error);
    hostBad.close();
    ok('cannot host without the password');

    const correctIdx = sample.questions.map(q => q.correct);
    // Mini set (4 Qs). Ada always right & fastest, Bo always right & slower, Cy always wrong.
    const plan = (pi, qi) => pi === 2 ? (correctIdx[qi] + 1) % 4 : correctIdx[qi];
    const classic = await playGame(created.data.id, 'classic', plan);
    assert.strictEqual(classic.podium.podium[0].name, 'Ada');
    assert.strictEqual(classic.podium.podium[1].name, 'Bo');
    assert.strictEqual(classic.podium.podium[2].score, 0);
    const adaQ1 = classic.players[0].results[0].gained;
    assert.ok(adaQ1 > 900 && adaQ1 <= 1000, 'fast right answer ≈ 1000, got ' + adaQ1);
    assert.ok(classic.players[1].results[0].gained < adaQ1, 'slower right answer earns less');
    assert.strictEqual(classic.finals[0].correctCount, 4);
    ok('Classic: speed matters, ranking and podium correct');

    const norush = await playGame(created.data.id, 'norush', plan);
    assert.strictEqual(norush.finals[0].score, 4000);
    assert.strictEqual(norush.finals[1].score, 4000);
    ok('No Rush: every right answer is exactly 1000');

    const streak = await playGame(created.data.id, 'streak', plan);
    const g = streak.players[0].results.map(r => r.gained);
    assert.ok(g[1] > g[0] * 1.3 && g[3] > g[0] * 2.2, 'streak multiplier grows: ' + g.join(','));
    assert.strictEqual(streak.players[0].results[3].streak, 4);
    ok('Streak Surge: multiplier grows with the streak');

    const boxes = await playGame(created.data.id, 'boxes', plan);
    assert.ok(boxes.finals[0].score > 0);
    ok('Mystery Boxes: game completes with box picks');

    const probe = io(BASE, { forceNew: true });
    const after = await emitAck(probe, 'player:join', { code: classic.code, name: 'Late' });
    assert.ok(after.error, 'game is gone after it ends');
    probe.close();
    ok('game and all nicknames are deleted when the game ends');

    console.log(`\nAll ${passed} checks passed.`);
  } catch (e) {
    console.error('\nFAILED:', e);
    process.exitCode = 1;
  } finally {
    srv.kill();
    fs.rmSync(setsDir, { recursive: true, force: true });
    setTimeout(() => process.exit(), 200);
  }
})();
