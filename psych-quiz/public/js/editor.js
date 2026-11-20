// Question set editor: make, edit, paste, import, and save sets.
(() => {
  let editing = { id: null, title: '', description: '', questions: [] };
  let dirty = false;

  teacherGate($('#gate'), () => {
    const id = new URLSearchParams(location.search).get('id');
    if (id) openSet(id); else showList();
  });

  function view(name) {
    $('#v-list').classList.toggle('hidden', name !== 'list');
    $('#v-edit').classList.toggle('hidden', name !== 'edit');
    window.scrollTo(0, 0);
  }

  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- list ----------
  async function showList() {
    if (dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    dirty = false;
    history.replaceState(null, '', '/editor');
    view('list');
    const ul = $('#set-list');
    ul.innerHTML = '<li class="muted">Loading…</li>';
    try {
      const sets = await api('/api/sets');
      ul.innerHTML = sets.length ? '' : '<li class="muted">No sets yet. Click "New set" or import a spreadsheet.</li>';
      sets.forEach(s => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="t">${s.fromFile ? '📄 ' : ''}${esc(s.title)}<br><span class="small muted">${s.count} questions${s.description ? ' · ' + esc(s.description) : ''}</span></span>
          <a class="btn tiny green" href="/host?set=${encodeURIComponent(s.id)}">Host ▶</a>
          <button class="btn tiny" data-act="edit" type="button">Edit</button>
          <button class="btn tiny ghost" data-act="copy" type="button">Duplicate</button>
          <button class="btn tiny ghost" data-act="csv" type="button">Download</button>
          <button class="btn tiny red" data-act="del" type="button">Delete</button>`;
        li.querySelector('[data-act=edit]').onclick = () => openSet(s.id);
        li.querySelector('[data-act=copy]').onclick = () => duplicate(s.id);
        li.querySelector('[data-act=csv]').onclick = () => downloadCsv(s.id);
        li.querySelector('[data-act=del]').onclick = async () => {
          if (!confirm(`Delete "${s.title}"? This cannot be undone. (Tip: click Download first to keep a copy.)`)) return;
          try { await api('/api/sets/' + s.id, { method: 'DELETE' }); showList(); } catch (e) { alert(e.message); }
        };
        ul.appendChild(li);
      });
    } catch (e) {
      ul.innerHTML = `<li class="error">${esc(e.message)}</li>`;
    }
  }

  async function downloadCsv(id) {
    const r = await fetch('/api/sets/' + id + '/csv', { headers: { 'x-teacher-password': teacherPassword() } });
    if (!r.ok) { alert('Could not download.'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = id + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function duplicate(id) {
    try {
      const s = await api('/api/sets/' + id);
      await api('/api/sets', { method: 'POST', json: { title: s.title + ' (copy)', description: s.description, questions: s.questions } });
      showList();
    } catch (e) { alert(e.message); }
  }

  $('#new-btn').addEventListener('click', () => {
    editing = { id: null, title: '', description: '', questions: [blankQ()] };
    renderEditor();
    $('#title').focus();
  });

  $('#import-new').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    $('#import-new-error').textContent = '';
    try {
      const res = await importFile(file);
      if (!res.questions.length) { $('#import-new-error').textContent = 'No questions found. ' + (res.problems[0] || ''); return; }
      editing = { id: null, title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), description: '', questions: res.questions };
      renderEditor();
      showProblems(res.problems);
      dirty = true;
      setStatus(`Imported ${res.questions.length} questions. Check them, then click Save.`);
    } catch (err) {
      $('#import-new-error').textContent = err.message;
    }
    e.target.value = '';
  });

  // ---------- edit ----------
  function blankQ() { return { text: '', choices: ['', '', '', ''], correct: 0 }; }

  async function openSet(id) {
    try {
      const s = await api('/api/sets/' + id);
      editing = { id, title: s.title, description: s.description || '', questions: s.questions };
      renderEditor();
      history.replaceState(null, '', '/editor?id=' + encodeURIComponent(id));
    } catch (e) { alert(e.message); showList(); }
  }

  function renderEditor() {
    view('edit');
    dirty = false;
    $('#title').value = editing.title;
    $('#desc').value = editing.description;
    $('#save-error').textContent = '';
    setStatus(editing.id ? 'Saved' : 'Not saved yet');
    showProblems([]);
    renderQuestions();
  }

  function setStatus(t) { $('#save-status').textContent = t; }
  function markDirty() { dirty = true; setStatus('Unsaved changes'); }

  $('#title').addEventListener('input', () => { editing.title = $('#title').value; markDirty(); });
  $('#desc').addEventListener('input', () => { editing.description = $('#desc').value; markDirty(); });

  function renderQuestions() {
    const box = $('#questions');
    box.innerHTML = '';
    $('#q-heading').textContent = `Questions (${editing.questions.length})`;
    editing.questions.forEach((q, qi) => {
      const d = document.createElement('div');
      d.className = 'qedit';
      d.innerHTML = `
        <div class="qhead">
          <span class="qnum">${qi + 1}</span>
          <span class="spacer"></span>
          <label class="small" style="margin:0;display:flex;align-items:center;gap:6px">Seconds
            <input type="number" min="5" max="240" placeholder="auto" style="width:90px;padding:6px 8px;font-size:1rem" data-f="time" value="${q.time || ''}"></label>
          <button class="btn tiny ghost" data-act="up" type="button" title="Move up" aria-label="Move up">↑</button>
          <button class="btn tiny ghost" data-act="down" type="button" title="Move down" aria-label="Move down">↓</button>
          <button class="btn tiny red" data-act="del" type="button" title="Delete question" aria-label="Delete question">✕</button>
        </div>
        <textarea data-f="text" style="min-height:60px;font-size:1.05rem" placeholder="Type the question…">${esc(q.text)}</textarea>
        ${[0, 1, 2, 3].map(i => `
          <div class="choice-row">
            <input type="radio" name="c${qi}" value="${i}" ${q.correct === i ? 'checked' : ''} title="Mark as the right answer" aria-label="Choice ${LETTERS[i]} is correct">
            <span class="sw" style="background:var(--${['red', 'blue', 'yellow', 'green'][i]})"></span>
            <input type="text" data-c="${i}" maxlength="200" placeholder="Choice ${LETTERS[i]}" value="${esc(q.choices[i] || '')}">
          </div>`).join('')}`;
      d.querySelector('[data-f=text]').addEventListener('input', e => { q.text = e.target.value; markDirty(); });
      d.querySelector('[data-f=time]').addEventListener('input', e => {
        const v = parseInt(e.target.value, 10);
        if (v >= 5 && v <= 240) q.time = v; else delete q.time;
        markDirty();
      });
      d.querySelectorAll('[data-c]').forEach(inp => inp.addEventListener('input', e => { q.choices[+e.target.dataset.c] = e.target.value; markDirty(); }));
      d.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', e => { q.correct = +e.target.value; markDirty(); }));
      d.querySelector('[data-act=up]').onclick = () => move(qi, -1);
      d.querySelector('[data-act=down]').onclick = () => move(qi, 1);
      d.querySelector('[data-act=del]').onclick = () => {
        if ((q.text || q.choices.some(Boolean)) && !confirm(`Delete question ${qi + 1}?`)) return;
        editing.questions.splice(qi, 1);
        markDirty();
        renderQuestions();
      };
      box.appendChild(d);
    });
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= editing.questions.length) return;
    const qs = editing.questions;
    [qs[i], qs[j]] = [qs[j], qs[i]];
    markDirty();
    renderQuestions();
  }

  function addQ(atTop) {
    if (atTop) editing.questions.unshift(blankQ()); else editing.questions.push(blankQ());
    markDirty();
    renderQuestions();
    const all = $$('.qedit textarea');
    const t = atTop ? all[0] : all[all.length - 1];
    if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
  }
  $('#add-btn').addEventListener('click', () => addQ(false));
  $('#add-top').addEventListener('click', () => addQ(true));
  $('#back-btn').addEventListener('click', showList);

  async function save() {
    $('#save-error').textContent = '';
    const body = { title: editing.title, description: editing.description, questions: editing.questions };
    try {
      if (editing.id) {
        const r = await api('/api/sets/' + editing.id, { method: 'PUT', json: body });
        if (r.copied) {
          editing.id = r.id;
          history.replaceState(null, '', '/editor?id=' + encodeURIComponent(r.id));
          alert('This set came from a spreadsheet file, so your changes were saved as a new set. The original file was not changed.');
        }
      } else {
        const r = await api('/api/sets', { method: 'POST', json: body });
        editing.id = r.id;
        history.replaceState(null, '', '/editor?id=' + encodeURIComponent(r.id));
      }
      dirty = false;
      setStatus('✅ Saved');
    } catch (e) {
      $('#save-error').textContent = e.message;
      setStatus('Not saved');
    }
  }
  $('#save-btn').addEventListener('click', save);
  $('#save-btn-2').addEventListener('click', save);

  // ---------- tabs, paste, file ----------
  $$('.tabs .btn').forEach(b => b.addEventListener('click', () => {
    $$('.tabs .btn').forEach(x => x.classList.toggle('active', x === b));
    $$('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab));
  }));

  function appendQuestions(qs) {
    // Replace a single empty starter question rather than keeping it.
    const qsNow = editing.questions;
    if (qsNow.length === 1 && !qsNow[0].text && !qsNow[0].choices.some(Boolean)) qsNow.length = 0;
    editing.questions.push(...qs);
    markDirty();
    renderQuestions();
  }

  function showProblems(list) {
    const el = $('#problems');
    el.classList.toggle('hidden', !list.length);
    el.innerHTML = list.length ? `<b>Some rows were skipped:</b><br>${list.slice(0, 15).map(esc).join('<br>')}${list.length > 15 ? `<br>…and ${list.length - 15} more` : ''}` : '';
  }

  $('#paste-btn').addEventListener('click', async () => {
    const text = $('#paste-box').value;
    if (!text.trim()) return;
    try {
      const res = await api('/api/import-text', { method: 'POST', json: { text } });
      appendQuestions(res.questions);
      showProblems(res.problems);
      $('#paste-msg').textContent = `Added ${res.questions.length} question${res.questions.length === 1 ? '' : 's'}. Remember to Save.`;
      if (res.questions.length) $('#paste-box').value = '';
    } catch (e) { $('#paste-msg').textContent = e.message; }
  });

  function importFile(file) {
    return fetch('/api/import-file', {
      method: 'POST',
      headers: { 'x-teacher-password': teacherPassword(), 'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
      body: file
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not read that file.');
      return data;
    });
  }

  $('#file-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const res = await importFile(file);
      appendQuestions(res.questions);
      showProblems(res.problems);
      $('#file-msg').textContent = `Added ${res.questions.length} question${res.questions.length === 1 ? '' : 's'} from ${file.name}. Remember to Save.`;
    } catch (err) { $('#file-msg').textContent = err.message; }
    e.target.value = '';
  });
})();
