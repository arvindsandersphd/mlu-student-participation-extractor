// Turns spreadsheet files (.xlsx, .csv) and pasted text into question lists.
// No extra libraries: .xlsx files are zip archives of XML, which we read with
// Node's built-in zlib.

const zlib = require('zlib');

// ---------- CSV / TSV ----------

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function guessDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (tabs >= 3) return '\t';
  if (semis > commas && semis >= 3) return ';';
  return commas >= 3 ? ',' : (tabs ? '\t' : ',');
}

// ---------- XLSX (zip + XML) ----------

function readZip(buf) {
  // Find "end of central directory" record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx spreadsheet.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = { method, compSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return name => {
    const f = files[name];
    if (!f) return null;
    const lp = f.localOffset;
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.subarray(start, start + f.compSize);
    if (f.method === 0) return data.toString('utf8');
    if (f.method === 8) return zlib.inflateRawSync(data).toString('utf8');
    throw new Error('Unsupported compression inside spreadsheet.');
  };
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

function textOf(xml) {
  // Join all <t>...</t> runs (rich text has several).
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += decodeXml(m[1]);
  return out;
}

function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXlsx(buf) {
  const read = readZip(buf);
  const shared = [];
  const ssXml = read('xl/sharedStrings.xml');
  if (ssXml) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(ssXml))) shared.push(textOf(m[1]));
  }
  // First sheet in workbook order.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = wb.match(/<sheet\b[^>]*r:id="([^"]+)"/);
    if (first) {
      const relRe = new RegExp(`<Relationship\\b[^>]*Id="${first[1]}"[^>]*>`);
      const rel = rels.match(relRe);
      const target = rel && rel[0].match(/Target="([^"]+)"/);
      if (target) {
        const t = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        sheetPath = 'xl/' + t;
      }
    }
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error('Could not find a worksheet in this file.');
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(sheet))) {
    const row = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const inner = cm[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      let value = '';
      if (type === 's') {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? (shared[parseInt(v[1], 10)] || '') : '';
      } else if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const v = inner.match(/<v>([\s\S]*?)<\/v>/);
        value = v ? decodeXml(v[1]) : '';
      }
      const idx = ref ? colIndex(ref) : row.length;
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows;
}

// ---------- Rows -> questions ----------

const HEADER_WORDS = /^(question|prompt|q|answer|choice|option|correct|time|seconds|a|b|c|d)\b/i;

function looksLikeHeader(row) {
  const cells = row.map(c => String(c || '').trim()).filter(Boolean);
  if (!cells.length) return false;
  const hits = cells.filter(c => HEADER_WORDS.test(c)).length;
  return hits >= 3;
}

function resolveCorrect(raw, choices) {
  const v = String(raw || '').trim();
  if (!v) return -1;
  const letter = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (['A', 'B', 'C', 'D'].includes(letter)) return letter.charCodeAt(0) - 65;
  if (['1', '2', '3', '4'].includes(letter)) return parseInt(letter, 10) - 1;
  const byText = choices.findIndex(c => c.trim().toLowerCase() === v.toLowerCase());
  return byText;
}

// Expected columns: Question, Choice A, Choice B, Choice C, Choice D, Correct, Seconds (optional)
function rowsToQuestions(rows) {
  const questions = [];
  const problems = [];
  rows = rows.filter(r => r && r.some(c => String(c || '').trim()));
  if (rows.length && looksLikeHeader(rows[0])) rows = rows.slice(1);
  rows.forEach((r, i) => {
    const cells = r.map(c => String(c == null ? '' : c).trim());
    const text = cells[0];
    const choices = cells.slice(1, 5);
    const lineNo = i + 1;
    if (!text) { problems.push(`Row ${lineNo}: the question is empty.`); return; }
    if (choices.filter(Boolean).length < 4) {
      problems.push(`Row ${lineNo}: needs four answer choices.`);
      return;
    }
    const correct = resolveCorrect(cells[5], choices);
    if (correct < 0) {
      problems.push(`Row ${lineNo}: the "Correct" column should be A, B, C, or D.`);
      return;
    }
    const q = { text, choices, correct };
    const secs = parseInt(cells[6], 10);
    if (secs >= 5 && secs <= 240) q.time = secs;
    questions.push(q);
  });
  return { questions, problems };
}

function importText(text) {
  text = String(text || '').replace(/^﻿/, '');
  return rowsToQuestions(parseDelimited(text, guessDelimiter(text)));
}

function importFile(buf, filename) {
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.xlsx') || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    return rowsToQuestions(parseXlsx(buf));
  }
  if (name.endsWith('.xls')) {
    throw new Error('Old .xls files are not supported. In Excel, choose File → Save As → "Excel Workbook (.xlsx)" or "CSV", then import again.');
  }
  return importText(buf.toString('utf8'));
}

function toCsv(set) {
  const esc = v => {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [['Question', 'Choice A', 'Choice B', 'Choice C', 'Choice D', 'Correct (A-D)', 'Seconds (optional)']];
  for (const q of set.questions) {
    lines.push([q.text, ...q.choices, 'ABCD'[q.correct], q.time || '']);
  }
  return '﻿' + lines.map(l => l.map(esc).join(',')).join('\r\n') + '\r\n';
}

module.exports = { importText, importFile, toCsv, parseDelimited, parseXlsx };
