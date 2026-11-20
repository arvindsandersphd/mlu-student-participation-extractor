// Host (teacher / TA) screen.
(() => {
  Sound.wireButtons();
  const socket = io();
  const screens = ['setup', 'lobby', 'question', 'reveal', 'podium'];
  let stopTimer = () => {};
  let state = { code: null, phase: null, total: 0, mode: 'classic', question: null };
  let sets = [];
  let modes = {};
  let selectedMode = 'classic';
  let lastPlayerCount = 0;

  function show(name) {
    stopTimer();
    screens.forEach(s => $('#s-' + s).classList.toggle('hidden', s !== name));
    if (name === 'lobby') Sound.startMusic(); else Sound.stopMusic();
  }

  $('#fs-btn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  });

  // ---------- setup ----------
  teacherGate($('#gate'), async cfg => {
    modes = cfg.modes;
    renderModes();
    try { await loadSets(); } catch (e) { $('#setup-error').textContent = e.message; }
    tryRejoin();
  });

  function renderModes() {
    const box = $('#modes');
    box.innerHTML = '';
    Object.entries(modes).forEach(([key, m]) => {
      const l = document.createElement('label');
      l.className = 'mode-card' + (key === selectedMode ? ' sel' : '');
      l.innerHTML = `<input type="radio" name="mode" value="${key}" ${key === selectedMode ? 'checked' : ''}><b>${esc(m.name)}</b><span class="small muted">${esc(m.blurb)}</span>`;
      l.addEventListener('click', () => {
        selectedMode = key;
        $$('.mode-card').forEach(x => x.classList.toggle('sel', x === l));
      });
      box.appendChild(l);
    });
  }

  async function loadSets() {
    sets = await api('/api/sets');
    const sel = $('#set-select');
    sel.innerHTML = sets.length ? sets.map(s => `<option value="${esc(s.id)}">${esc(s.title)} (${s.count} questions)</option>`).join('')
      : '<option value="">No question sets yet. Make one in the editor.</option>';
    const want = new URLSearchParams(location.search).get('set') || getPref('psychrush-lastset', '');
    if (sets.some(s => s.id === want)) sel.value = want;
    updateSetInfo();
  }

  function updateSetInfo() {
    const s = sets.find(x => x.id === $('#set-select').value);
    $('#set-info').textContent = s ? s.description : '';
    const qc = $('#qcount');
    qc.innerHTML = '<option value="0">All of them</option>';
    if (s) for (const n of [5, 10, 15, 20, 25, 30, 40, 50]) if (n < s.count) qc.innerHTML += `<option value="${n}">${n} questions</option>`;
  }
  $('#set-select').addEventListener('change', updateSetInfo);

  $('#create-btn').addEventListener('click', () => {
    const setId = $('#set-select').value;
    $('#setup-error').textContent = '';
    if (!setId) { $('#setup-error').textContent = 'Pick a question set first.'; return; }
    setPref('psychrush-lastset', setId);
    $('#create-btn').disabled = true;
    socket.emit('host:create', {
      setId,
      mode: selectedMode,
      timer: $('#timer').value,
      questionCount: $('#qcount').value,
      shuffleQuestions: $('#shuffle-q').checked,
      shuffleAnswers: $('#shuffle-a').checked,
      password: teacherPassword()
    }, res => {
      $('#create-btn').disabled = false;
      if (res.error) { $('#setup-error').textContent = res.error; return; }
      setSession('psychrush-host', JSON.stringify({ code: res.code, hostKey: res.hostKey }));
      applyState(res.state);
    });
  });

  // If the host page reloads, pick the game back up.
  function tryRejoin() {
    let saved = null;
    try { saved = JSON.parse(getSession('psychrush-host') || 'null'); } catch (e) { saved = null; }
    if (!saved) { show('setup'); return; }
    socket.emit('host:rejoin', saved, res => {
      if (res.error) { setSession('psychrush-host', null); show('setup'); return; }
      applyState(res.state);
    });
  }
  socket.on('connect', () => { if (state.code) tryRejoin(); });

  function applyState(s) {
    state = Object.assign(state, s);
    $('#top-mode').hidden = false;
    $('#top-mode').textContent = s.modeName;
    if (s.phase === 'lobby') renderLobby(s);
    else if (s.phase === 'question') { renderQuestion(s.question); setAnswered(s.answered, s.players.length); }
    else if (s.phase === 'reveal') renderReveal(s.question, s.reveal);
  }

  // ---------- lobby ----------
  function renderLobby(s) {
    show('lobby');
    const url = location.origin;
    $('#join-url').textContent = url.replace(/^https?:\/\//, '');
    $('#code').textContent = s.code;
    $('#lobby-mode').textContent = 'Mode: ' + s.modeName;
    $('#lobby-blurb').textContent = s.modeBlurb;
    renderPlayers(s.players);
  }

  $('#copy-link').addEventListener('click', async () => {
    const link = `${location.origin}/?code=${state.code}`;
    try { await navigator.clipboard.writeText(link); $('#copied').textContent = 'Copied! ' + link; }
    catch (e) { $('#copied').textContent = link; }
  });

  function renderPlayers(players) {
    $('#player-count').textContent = players.length + (players.length === 1 ? ' player' : ' players');
    $('#start-btn').disabled = players.length === 0;
    $('#waiting').classList.toggle('hidden', players.length > 0);
    const box = $('#players');
    box.innerHTML = '';
    players.forEach(p => {
      const c = document.createElement('span');
      c.className = 'chip' + (p.connected ? '' : ' off');
      c.innerHTML = `${esc(p.name)} <button type="button" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">✕</button>`;
      c.querySelector('button').addEventListener('click', () => {
        if (confirm(`Remove "${p.name}" from the game?`)) socket.emit('host:kick', { id: p.id });
      });
      box.appendChild(c);
    });
    if (players.length > lastPlayerCount) Sound.play('join');
    lastPlayerCount = players.length;
  }

  socket.on('players', ({ players, answered }) => {
    state.players = players;
    if (state.phase === 'lobby' || !state.phase) renderPlayers(players);
    if (state.phase === 'question') setAnswered(answered, players.length);
  });

  $('#start-btn').addEventListener('click', () => socket.emit('host:start'));
  $('#cancel-btn').addEventListener('click', () => {
    if (!confirm('Cancel this game? Players will be sent back to the join screen.')) return;
    socket.emit('host:end');
    setSession('psychrush-host', null);
    state = { code: null };
    show('setup');
  });

  // ---------- question ----------
  function renderQuestion(q) {
    show('question');
    state.phase = 'question';
    state.question = q;
    $('#q-count').textContent = `Question ${q.index + 1} of ${q.total}`;
    $('#q-text').textContent = q.text;
    $('#q-answers').innerHTML = q.choices.map((c, i) =>
      `<div class="answer a${i}"><span class="shape" aria-hidden="true">${SHAPES[i]}</span><span>${esc(c)}</span></div>`).join('');
    stopTimer = countdown($('#q-timer'), q.remainingMs, left => { if (left <= 5 && left > 0) Sound.play('tick'); });
  }
  function setAnswered(n, total) {
    $('#q-answered').textContent = `${n} / ${total} answered`;
  }

  socket.on('question', q => {
    Sound.play('start');
    renderQuestion(q);
    setAnswered(0, q.totalPlayers);
  });
  socket.on('answered', ({ answered, total }) => setAnswered(answered, total));
  $('#skip-btn').addEventListener('click', () => socket.emit('host:next'));

  // ---------- reveal ----------
  function renderReveal(q, r) {
    show('reveal');
    state.phase = 'reveal';
    $('#r-count').textContent = `Question ${q.index + 1} of ${q.total}`;
    $('#r-text').textContent = q.text;
    $('#r-answers').innerHTML = q.choices.map((c, i) =>
      `<div class="answer a${i} ${i === r.correct ? 'right' : 'dim'}"><span class="shape" aria-hidden="true">${i === r.correct ? '✔' : SHAPES[i]}</span><span>${esc(c)}</span><span class="count">${r.counts[i]}</span></div>`).join('');
    renderBoard($('#r-board'), r.leaderboard, true);
    renderBoxes(r.boxesOpened);
    $('#next-btn').textContent = r.isLast ? 'Show podium 🏆' : 'Next question ▶';
  }

  function renderBoxes(b) {
    const el = $('#r-boxes');
    el.classList.toggle('hidden', !b || !b.total);
    if (b) el.textContent = `🎁 ${b.opened} / ${b.total} boxes opened`;
  }

  function renderBoard(el, rows, showGain) {
    el.innerHTML = rows.length ? rows.map((p, i) => `<li style="animation-delay:${i * 0.06}s"><span class="rk">${p.rank}</span><span class="nm">${esc(p.name)}${p.streak >= 3 ? ' 🔥' : ''}</span>${showGain && p.gained ? `<span class="gain">+${p.gained}</span>` : ''}<span class="sc">${p.score.toLocaleString()}</span></li>`).join('')
      : '<li><span class="nm muted">No players</span></li>';
  }

  socket.on('reveal', r => {
    Sound.play('reveal');
    renderReveal(state.question, r);
  });
  socket.on('leaderboard', ({ leaderboard, boxesOpened }) => {
    if (state.phase !== 'reveal') return;
    renderBoard($('#r-board'), leaderboard, true);
    renderBoxes(boxesOpened);
  });
  $('#next-btn').addEventListener('click', () => socket.emit('host:next'));
  $('#end-btn').addEventListener('click', () => {
    if (confirm('End the game now and show the podium?')) socket.emit('host:end');
  });

  // Space bar or Enter = next, for clickers and keyboards.
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea, button')) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight' || e.key === 'PageDown') {
      if (state.phase === 'reveal' || state.phase === 'question') { e.preventDefault(); socket.emit('host:next'); }
    }
  });

  // ---------- podium ----------
  socket.on('podium', p => {
    setSession('psychrush-host', null);
    state.phase = 'end';
    show('podium');
    const order = [p.podium[1], p.podium[0], p.podium[2]];
    const cls = ['p2', 'p1', 'p3'];
    $('#podium').innerHTML = order.map((x, i) => x ? `<div class="step ${cls[i]}"><div class="who">${esc(x.name)}</div><div class="pts">${x.score.toLocaleString()} pts</div><div class="block">${x.rank}</div></div>` : '').join('');
    renderBoard($('#final-board'), p.leaderboard, false);
    Sound.play('reveal');
    setTimeout(() => { Sound.play('fanfare'); confetti(160); }, 1700);
  });
})();
