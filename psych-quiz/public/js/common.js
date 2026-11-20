// Shared helpers: sounds (made in the browser, no audio files), mute button,
// teacher password, and small utilities.

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function store(kind) {
  try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch (e) { return null; }
}
function getPref(key, fallback) {
  try { const v = store('local').getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function setPref(key, val) { try { store('local').setItem(key, val); } catch (e) { /* ignore */ } }
function getSession(key) { try { return store('session').getItem(key); } catch (e) { return null; } }
function setSession(key, val) {
  try { if (val === null) store('session').removeItem(key); else store('session').setItem(key, val); } catch (e) { /* ignore */ }
}

// ---------- Sound ----------
const Sound = (() => {
  let ctx = null;
  let muted = getPref('psychrush-muted', '0') === '1';
  let musicTimer = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, type = 'sine', vol = 0.18) {
    const c = ac();
    if (!c || muted) return;
    const t = c.currentTime + start;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const fx = {
    click() { tone(660, 0, 0.08, 'triangle', 0.12); },
    join() { tone(523, 0, 0.1, 'triangle'); tone(784, 0.07, 0.14, 'triangle'); },
    tick() { tone(1200, 0, 0.05, 'square', 0.06); },
    start() { [392, 523, 659, 784].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle')); },
    correct() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.08, 0.22, 'triangle', 0.16)); },
    wrong() { tone(220, 0, 0.22, 'sawtooth', 0.1); tone(160, 0.18, 0.35, 'sawtooth', 0.1); },
    reveal() { tone(440, 0, 0.12, 'square', 0.08); tone(660, 0.1, 0.25, 'square', 0.08); },
    box() { [600, 800, 1000, 1400].forEach((f, i) => tone(f, i * 0.05, 0.12, 'sine', 0.12)); },
    robbed() { tone(500, 0, 0.12, 'sawtooth', 0.09); tone(350, 0.12, 0.25, 'sawtooth', 0.09); },
    fanfare() {
      const notes = [[523, 0], [523, 0.15], [523, 0.3], [698, 0.45], [880, 0.75], [784, 1.05], [1046, 1.3]];
      notes.forEach(([f, s]) => { tone(f, s, 0.35, 'triangle', 0.18); tone(f / 2, s, 0.35, 'sine', 0.1); });
    }
  };

  // Gentle looping lobby tune for the host screen.
  function startMusic() {
    stopMusic();
    const pattern = [262, 330, 392, 330, 294, 349, 440, 349, 262, 330, 392, 523, 494, 392, 330, 294];
    let i = 0;
    musicTimer = setInterval(() => {
      if (muted) return;
      tone(pattern[i % pattern.length], 0, 0.25, 'triangle', 0.06);
      if (i % 4 === 0) tone(pattern[i % pattern.length] / 2, 0, 0.5, 'sine', 0.06);
      i++;
    }, 260);
  }
  function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

  function setMuted(m) {
    muted = m;
    setPref('psychrush-muted', m ? '1' : '0');
    $$('.sound-btn[data-sound]').forEach(b => { b.innerHTML = m ? '🔇<span class="lbl"> Sound off</span>' : '🔊<span class="lbl"> Sound on</span>'; b.title = m ? 'Sound is off. Click to turn on.' : 'Sound is on. Click to turn off.'; b.setAttribute('aria-pressed', String(!m)); });
  }

  function wireButtons() {
    $$('.sound-btn[data-sound]').forEach(b => b.addEventListener('click', () => { setMuted(!muted); if (!muted) { ac(); fx.click(); } }));
    setMuted(muted);
    // Browsers only allow sound after the first tap/click.
    const unlock = () => { ac(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
  }

  return { play: name => fx[name] && fx[name](), startMusic, stopMusic, wireButtons, isMuted: () => muted };
})();

// ---------- Teacher password ----------
async function getConfig() {
  const r = await fetch('/api/config');
  return r.json();
}

function teacherPassword() { return getSession('psychrush-pw') || ''; }

async function api(path, opts = {}) {
  const headers = Object.assign({ 'x-teacher-password': teacherPassword() }, opts.headers || {});
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const r = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body });
  let data = null;
  try { data = await r.json(); } catch (e) { /* ignore */ }
  if (!r.ok) throw new Error((data && data.error) || 'Something went wrong.');
  return data;
}

// Shows the password box if the server needs one. Resolves when unlocked.
async function teacherGate(gateEl, onReady) {
  const cfg = await getConfig();
  if (!cfg.needsPassword) { gateEl.classList.add('hidden'); return onReady(cfg); }
  const tryPw = async pw => {
    const r = await fetch('/api/check-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    return (await r.json()).ok;
  };
  const saved = teacherPassword();
  if (saved && await tryPw(saved)) { gateEl.classList.add('hidden'); return onReady(cfg); }
  gateEl.classList.remove('hidden');
  const form = gateEl.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pw = form.querySelector('input').value;
    if (await tryPw(pw)) {
      setSession('psychrush-pw', pw);
      gateEl.classList.add('hidden');
      onReady(cfg);
    } else {
      form.querySelector('.error').textContent = 'That password is not right.';
    }
  });
}

function confetti(n = 120) {
  const colors = ['#ef3b5a', '#1f7aff', '#ffb400', '#18b26b', '#ffffff', '#ff7ad9'];
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'confetti';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.background = colors[i % colors.length];
    d.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
    d.style.animationDelay = Math.random() * 1.5 + 's';
    d.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 6500);
  }
}

// Counts down on screen using the time the server sent.
function countdown(el, ms, onTick) {
  const end = Date.now() + ms;
  let last = null;
  const id = setInterval(update, 100);
  function update() {
    const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    if (left !== last) {
      last = left;
      el.textContent = left;
      el.classList.toggle('low', left <= 5);
      if (onTick) onTick(left);
    }
    if (left <= 0) clearInterval(id);
  }
  update();
  return () => clearInterval(id);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
