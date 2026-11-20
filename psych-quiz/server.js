// Psych Rush: a live classroom quiz game.
// Start it with:  npm start   then open http://localhost:3000

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { GameManager, MODES } = require('./lib/game');
const importer = require('./lib/importer');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || '';
const SETS_DIR = process.env.SETS_DIR || path.join(__dirname, 'question-sets');

fs.mkdirSync(SETS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
const games = new GameManager(io);

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------- teacher password (optional) ----------

function passwordOk(given) {
  if (!TEACHER_PASSWORD) return true;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TEACHER_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireTeacher(req, res, next) {
  if (passwordOk(req.get('x-teacher-password'))) return next();
  res.status(401).json({ error: 'Wrong or missing teacher password.' });
}

app.get('/api/config', (req, res) => {
  res.json({ needsPassword: !!TEACHER_PASSWORD, modes: MODES });
});

app.post('/api/check-password', (req, res) => {
  res.json({ ok: passwordOk(req.body && req.body.password) });
});

// ---------- question sets (saved as JSON files) ----------

function safeId(id) {
  return /^[a-z0-9-]{1,80}$/.test(String(id || '')) ? id : null;
}

function slugify(title) {
  const base = String(title || 'question-set').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'question-set';
  return base + '-' + crypto.randomBytes(3).toString('hex');
}

function validateSet(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  if (!title) return { error: 'Please give the set a title.' };
  if (!Array.isArray(body.questions) || !body.questions.length) return { error: 'Add at least one question.' };
  if (body.questions.length > 300) return { error: 'A set can have at most 300 questions.' };
  const questions = [];
  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i] || {};
    const text = String(q.text || '').trim().slice(0, 500);
    const choices = Array.isArray(q.choices) ? q.choices.slice(0, 4).map(c => String(c || '').trim().slice(0, 200)) : [];
    const correct = parseInt(q.correct, 10);
    if (!text) return { error: `Question ${i + 1} is empty.` };
    if (choices.length !== 4 || choices.some(c => !c)) return { error: `Question ${i + 1} needs all four answer choices.` };
    if (!(correct >= 0 && correct <= 3)) return { error: `Question ${i + 1} needs a correct answer marked.` };
    const item = { text, choices, correct };
    const t = parseInt(q.time, 10);
    if (t >= 5 && t <= 240) item.time = t;
    questions.push(item);
  }
  return { set: { title, description: String(body.description || '').trim().slice(0, 300), questions } };
}

function readSet(id) {
  const entry = scanSets().get(id);
  if (!entry) return null;
  const full = path.join(SETS_DIR, entry.file);
  if (entry.kind === 'json') {
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    data.id = id;
    return data;
  }
  // A spreadsheet dropped straight into the question-sets folder.
  const { questions } = importer.importFile(fs.readFileSync(full), entry.file);
  return {
    id,
    fromFile: entry.file,
    title: entry.file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(),
    description: `From the spreadsheet "${entry.file}" in the question-sets folder.`,
    questions
  };
}

// Finds every set: saved .json sets plus .xlsx / .csv spreadsheets in the folder.
function scanSets() {
  const map = new Map();
  for (const f of fs.readdirSync(SETS_DIR)) {
    const lower = f.toLowerCase();
    if (lower.endsWith('.json')) {
      const id = f.slice(0, -5);
      if (safeId(id)) map.set(id, { file: f, kind: 'json' });
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.csv')) {
      if (f.startsWith('~$')) continue; // Excel lock files
      const id = 'sheet-' + f.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      if (safeId(id)) map.set(id, { file: f, kind: 'sheet' });
    }
  }
  return map;
}

function listSets() {
  const out = [];
  for (const [id, entry] of scanSets()) {
    try {
      const s = readSet(id);
      if (!s.questions || !s.questions.length) continue;
      out.push({ id, title: s.title, description: s.description || '', count: s.questions.length, fromFile: entry.kind === 'sheet' });
    } catch (e) { /* skip unreadable files */ }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

app.get('/api/sets', requireTeacher, (req, res) => res.json(listSets()));

app.get('/api/sets/:id', requireTeacher, (req, res) => {
  const id = safeId(req.params.id);
  const s = id && readSet(id);
  if (!s) return res.status(404).json({ error: 'Set not found.' });
  res.json(s);
});

app.get('/api/sets/:id/csv', requireTeacher, (req, res) => {
  const id = safeId(req.params.id);
  const s = id && readSet(id);
  if (!s) return res.status(404).send('Set not found.');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${id}.csv"`);
  res.send(importer.toCsv(s));
});

app.post('/api/sets', requireTeacher, (req, res) => {
  const v = validateSet(req.body || {});
  if (v.error) return res.status(400).json(v);
  const id = slugify(v.set.title);
  fs.writeFileSync(path.join(SETS_DIR, id + '.json'), JSON.stringify(v.set, null, 2));
  res.json({ id });
});

app.put('/api/sets/:id', requireTeacher, (req, res) => {
  const id = safeId(req.params.id);
  const entry = id && scanSets().get(id);
  if (!entry) return res.status(404).json({ error: 'Set not found.' });
  const v = validateSet(req.body || {});
  if (v.error) return res.status(400).json(v);
  // Edits to a spreadsheet-file set are saved as a new copy; the file is left alone.
  const saveId = entry.kind === 'json' ? id : slugify(v.set.title);
  fs.writeFileSync(path.join(SETS_DIR, saveId + '.json'), JSON.stringify(v.set, null, 2));
  res.json({ id: saveId, copied: saveId !== id });
});

app.delete('/api/sets/:id', requireTeacher, (req, res) => {
  const id = safeId(req.params.id);
  const entry = id && scanSets().get(id);
  if (!entry) return res.status(404).json({ error: 'Set not found.' });
  if (entry.kind !== 'json') return res.status(400).json({ error: `This set comes from the file "${entry.file}" in the question-sets folder. To remove it, delete that file (on GitHub or on your computer).` });
  fs.unlinkSync(path.join(SETS_DIR, entry.file));
  res.json({ ok: true });
});

// Pasted text (from Excel, Google Sheets, or typed with commas/tabs)
app.post('/api/import-text', requireTeacher, (req, res) => {
  try { res.json(importer.importText(req.body && req.body.text)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// Spreadsheet file upload (.xlsx or .csv), sent as raw bytes
app.post('/api/import-file', requireTeacher, express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'The file was empty.' });
    res.json(importer.importFile(req.body, decodeURIComponent(req.get('x-filename') || '')));
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not read that file.' });
  }
});

app.get('/template.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="question-template.csv"');
  res.send(importer.toCsv({
    questions: [
      { text: 'Who is considered the founder of psychoanalysis?', choices: ['Sigmund Freud', 'B. F. Skinner', 'Carl Rogers', 'Wilhelm Wundt'], correct: 0 },
      { text: 'Which part of the neuron receives messages from other neurons?', choices: ['Axon', 'Dendrites', 'Myelin sheath', 'Terminal buttons'], correct: 1, time: 30 }
    ]
  }));
});

// ---------- live game sockets ----------

io.on('connection', socket => {
  socket.on('host:create', (opts, ack) => {
    if (typeof ack !== 'function') return;
    opts = opts || {};
    if (!passwordOk(opts.password)) return ack({ error: 'Wrong teacher password.' });
    const id = safeId(opts.setId);
    let set;
    try { set = id && readSet(id); } catch (e) { set = null; }
    if (!set || !set.questions || !set.questions.length) return ack({ error: 'Pick a question set first.' });
    const game = games.createGame(socket, set, opts);
    ack({ ok: true, code: game.code, hostKey: game.hostKey, state: games.hostState(game) });
  });

  socket.on('host:rejoin', ({ code, hostKey } = {}, ack) => {
    if (typeof ack !== 'function') return;
    const game = games.rejoinHost(socket, String(code || ''), String(hostKey || ''));
    ack(game ? { ok: true, state: games.hostState(game) } : { error: 'gone' });
  });

  socket.on('host:start', () => { const g = games.hostGame(socket); if (g) games.startGame(g); });
  socket.on('host:next', () => { const g = games.hostGame(socket); if (g) games.advance(g); });
  socket.on('host:kick', ({ id } = {}) => { const g = games.hostGame(socket); if (g) games.kick(g, String(id || '')); });
  socket.on('host:end', () => { const g = games.hostGame(socket); if (g) games.endEarly(g); });

  socket.on('player:join', ({ code, name } = {}, ack) => {
    if (typeof ack !== 'function') return;
    ack(games.joinPlayer(socket, code, name));
  });
  socket.on('player:rejoin', ({ code, token } = {}, ack) => {
    if (typeof ack !== 'function') return;
    ack(games.rejoinPlayer(socket, code, String(token || '')));
  });
  socket.on('player:answer', ({ choice } = {}) => games.answer(socket, choice));
  socket.on('player:box', ({ index } = {}) => games.pickBox(socket, index));

  socket.on('disconnect', () => games.disconnect(socket));
});

server.listen(PORT, () => {
  const lan = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) lan.push(a.address);
  }
  console.log('\n  Psych Rush is running!\n');
  console.log(`  On this computer, open:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Same Wi-Fi devices can try: http://${ip}:${PORT}`);
  console.log(`\n  Teacher password: ${TEACHER_PASSWORD ? 'ON' : 'off (anyone can host and edit)'}`);
  console.log('  To stop the game server, press Ctrl+C in this window.\n');
});

module.exports = { app, server };
