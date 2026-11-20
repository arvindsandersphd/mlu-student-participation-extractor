// Student (phone) screen.
(() => {
  Sound.wireButtons();
  const socket = io();
  const screens = ['join', 'lobby', 'question', 'locked', 'result', 'final', 'closed'];
  let stopTimer = () => {};
  let currentChoices = [];
  let joined = false;

  function show(name) {
    stopTimer();
    screens.forEach(s => $('#s-' + s).classList.toggle('hidden', s !== name));
    window.scrollTo(0, 0);
  }

  // Pre-fill code from a link like /?code=123456
  const params = new URLSearchParams(location.search);
  if (params.get('code')) $('#code').value = params.get('code').replace(/\D/g, '').slice(0, 6);
  if ($('#code').value) $('#name').focus();

  function saveSeat(code, token, name) {
    setSession('psychrush-seat', JSON.stringify({ code, token, name }));
  }
  function clearSeat() { setSession('psychrush-seat', null); }

  function setMe(name, score) {
    const me = $('#me');
    me.classList.remove('hidden');
    me.textContent = score == null ? name : `${name} · ${score.toLocaleString()}`;
  }
  let myName = '';

  $('#join-form').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#code').value.trim();
    const name = $('#name').value.trim();
    $('#join-error').textContent = '';
    if (!/^\d{6}$/.test(code)) { $('#join-error').textContent = 'The game code is 6 numbers.'; return; }
    if (!name) { $('#join-error').textContent = 'Please type a nickname.'; return; }
    socket.emit('player:join', { code, name }, res => {
      if (res.error) { $('#join-error').textContent = res.error; return; }
      Sound.play('join');
      joined = true;
      myName = res.name;
      saveSeat(code, res.token, res.name);
      applyState(res.state);
    });
  });

  function applyState(state) {
    setMe(myName, state.score);
    $('#lobby-mode').textContent = 'Game mode: ' + state.modeName;
    $('#lobby-blurb').textContent = state.modeBlurb;
    if (state.phase === 'lobby') show('lobby');
    else if (state.phase === 'question') {
      if (state.answered) showLocked(state.myAnswer, state.question.choices);
      else showQuestion(state.question);
    } else if (state.phase === 'reveal') showResult(state.result);
  }

  // Reconnect automatically if the phone sleeps or the Wi-Fi blips.
  socket.on('connect', () => {
    let seat = null;
    try { seat = JSON.parse(getSession('psychrush-seat') || 'null'); } catch (e) { seat = null; }
    if (!seat) return;
    socket.emit('player:rejoin', { code: seat.code, token: seat.token }, res => {
      if (res.error) {
        clearSeat();
        if (joined) { showClosed('This game has closed', 'Thanks for playing!'); }
        return;
      }
      joined = true;
      myName = res.name;
      applyState(res.state);
    });
  });

  function showQuestion(q) {
    show('question');
    currentChoices = q.choices;
    $('#q-count').textContent = `Question ${q.index + 1} of ${q.total}`;
    $('#q-text').textContent = q.text;
    const box = $('#q-answers');
    box.innerHTML = '';
    q.choices.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer a' + i;
      b.innerHTML = `<span class="shape" aria-hidden="true">${SHAPES[i]}</span><span>${esc(c)}</span>`;
      b.setAttribute('aria-label', `${LETTERS[i]}: ${c}`);
      b.addEventListener('click', () => {
        $$('#q-answers .answer').forEach(x => { x.disabled = true; });
        Sound.play('click');
        socket.emit('player:answer', { choice: i });
      });
      box.appendChild(b);
    });
    stopTimer = countdown($('#q-timer'), q.remainingMs);
  }

  function showLocked(choice, choices) {
    show('locked');
    const c = (choices || currentChoices)[choice];
    $('#locked-choice').innerHTML = c != null ? `You picked <b>${SHAPES[choice]} ${esc(c)}</b>` : '';
  }

  function showResult(r) {
    show('result');
    const card = $('#result-card');
    card.className = 'result-card ' + (r.correct ? 'good' : 'bad');
    if (r.correct) {
      $('#r-emoji').textContent = r.streak >= 3 ? '🔥' : '✅';
      $('#r-title').textContent = 'Correct!';
      $('#r-gain').textContent = '+' + r.gained.toLocaleString();
    } else {
      $('#r-emoji').textContent = r.answered ? '❌' : '⌛';
      $('#r-title').textContent = r.answered ? 'Not quite' : "Time's up";
      $('#r-gain').textContent = '+0';
    }
    $('#r-answer').innerHTML = r.correct ? '' : `Right answer: <b>${SHAPES[r.correctIndex]} ${esc(r.correctText)}</b>`;
    $('#r-score').textContent = `Score: ${r.score.toLocaleString()}`;
    $('#r-rank').textContent = `${ordinal(r.rank)} of ${r.totalPlayers}`;
    $('#r-streak').classList.toggle('hidden', !(r.streak >= 2));
    $('#r-streak').textContent = `🔥 Streak ${r.streak}`;
    setMe(myName, r.score);
    Sound.play(r.correct ? 'correct' : 'wrong');

    const area = $('#box-area');
    area.classList.add('hidden');
    if (r.boxes || r.boxOutcome) {
      area.classList.remove('hidden');
      const boxes = $('#boxes');
      boxes.innerHTML = '';
      $('#box-msg').textContent = '';
      $('#box-title').textContent = 'Pick a mystery box!';
      for (let i = 0; i < 3; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'box';
        b.textContent = '🎁';
        b.setAttribute('aria-label', 'Mystery box ' + (i + 1));
        b.addEventListener('click', () => {
          $$('#boxes .box').forEach(x => { x.disabled = true; });
          socket.emit('player:box', { index: i });
        });
        boxes.appendChild(b);
      }
      if (r.boxOutcome) showBox(r.boxOutcome, r.score, r.rank);
    }
  }

  function showBox(o, score, rank) {
    const boxes = $$('#boxes .box');
    o.all.forEach((label, i) => {
      const b = boxes[i];
      if (!b) return;
      b.classList.add('open');
      b.disabled = true;
      b.classList.toggle('mine', i === o.index);
      b.textContent = label;
    });
    $('#box-title').textContent = 'Your box:';
    $('#box-msg').textContent = o.text;
    if (score != null) {
      $('#r-score').textContent = `Score: ${score.toLocaleString()}`;
      if (rank) $('#r-rank').textContent = `${ordinal(rank)} place`;
      setMe(myName, score);
    }
  }

  function showClosed(title, detail) {
    clearSeat();
    joined = false;
    $('#me').classList.add('hidden');
    $('#closed-title').textContent = title;
    $('#closed-detail').textContent = detail;
    show('closed');
  }

  socket.on('question', q => { if (joined) { Sound.play('start'); showQuestion(q); } });
  socket.on('answer-locked', ({ choice }) => showLocked(choice));
  socket.on('result', r => showResult(r));
  socket.on('box-opened', o => { Sound.play(o.gain > 0 ? 'box' : 'wrong'); showBox(o, o.score, o.rank); });
  socket.on('robbed', ({ amount, by, score }) => {
    Sound.play('robbed');
    setMe(myName, score);
    const msg = $('#box-msg');
    if (!$('#s-result').classList.contains('hidden')) {
      $('#box-area').classList.remove('hidden');
      if (!$('#boxes').children.length) $('#box-title').textContent = 'Uh oh!';
      msg.textContent = `😱 ${by} stole ${amount} points from you!`;
      $('#r-score').textContent = `Score: ${score.toLocaleString()}`;
    }
  });
  socket.on('final', f => {
    clearSeat();
    joined = false;
    show('final');
    $('#f-emoji').textContent = f.rank === 1 ? '🏆' : f.rank <= 3 ? '🥇' : '🎉';
    $('#f-title').textContent = f.rank <= 3 ? `You placed ${ordinal(f.rank)}!` : 'Game over!';
    $('#f-detail').textContent = `You finished ${ordinal(f.rank)} of ${f.totalPlayers} with ${f.score.toLocaleString()} points (${f.correctCount} of ${f.totalQuestions} right).`;
    $('#f-podium').innerHTML = f.podium.map(p => `<li><span class="rk">${p.rank}</span><span class="nm">${esc(p.name)}</span><span class="sc">${p.score.toLocaleString()}</span></li>`).join('');
    if (f.rank <= 3) { Sound.play('fanfare'); confetti(80); } else Sound.play('correct');
  });
  socket.on('kicked', () => showClosed('You were removed from the game', 'You can join again with a different nickname.'));
  socket.on('game-closed', () => showClosed('This game has closed', 'The host ended the game.'));
})();
