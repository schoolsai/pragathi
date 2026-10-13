/**
 * School Marks & Analytics — Google Apps Script backend
 * Setup: open your Google Sheet → Extensions → Apps Script → paste this file.
 * Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 * Optional (Project Settings → Script properties):
 *   APP_PIN            – shared PIN the app must send (recommended)
 *   ANTHROPIC_API_KEY  – enables AI-written feedback in the app
 * Database sheets (Classes, Students, Marks) and the report sheets (Class 5, Class 6-7, Class 8-10)
 * are created automatically; report sheets are rebuilt after every save (or use menu Marks > Rebuild report sheets).
 */

const SHEETS = {
  Classes:  ['id', 'grade', 'section', 'year', 'subjects'],
  Students: ['id', 'classId', 'roll', 'name', 'reg'],
  Marks:    ['key', 'classId', 'studentId', 'subject', 'assessment', 'marks', 'updatedAt']
};

/* ---------- Report sheets: "Class 5", "Class 6-7", "Class 8-10" (rebuilt automatically on every save) ---------- */
const ASSESS_BASE = [['FA1','Formative Assessment 1',50],['FA2','Formative Assessment 2',50],['FA3','Formative Assessment 3',50],['FA4','Formative Assessment 4',50],
                ['SA1','Summative Assessment 1',100],['SA2','Summative Assessment 2',100],['PF1','Pre Final 1',100],['PF2','Pre Final 2',100],['PF3','Pre Final 3',100]];
// Class 10 Mission March Tests: one 20-mark test per day in one subject. Assessment code is 'MMT@YYYY-MM-DD'.
function mmtName_(code) {
  const d = code.indexOf('@') > 0 ? code.slice(code.indexOf('@') + 1) : '';
  if (!d) return 'Mission March Test';
  const t = new Date(d + 'T00:00:00');
  return 'Mission March Test – ' + (isNaN(t) ? d : Utilities.formatDate(t, Session.getScriptTimeZone() || 'Asia/Kolkata', 'dd MMM yyyy'));
}
function assessList_(marksKeys) {
  const codes = {};
  marksKeys.forEach(k => { const a = k.split('|')[2]; if (a && a.indexOf('MMT@') === 0) codes[a] = 1; });
  const mmt = Object.keys(codes).sort().map(a => [a, mmtName_(a), 20]);
  return ASSESS_BASE.concat(mmt);
}
const G_NAMES = ['A1','A2','B1','B2','C1','C2','D1','D2'];
// CCE New Grading (GO Ms No.41, 07.06.2016): lower bound of A1..D2 for each maximum.
const T1 = {20:[18,16,14,12,10,8,7,0],40:[36,32,28,24,20,16,14,0],50:[46,41,36,31,26,21,18,0],80:[73,65,57,49,41,33,28,0],100:[91,81,71,61,51,41,35,0],
            300:[273,243,213,183,153,123,105,0],350:[319,284,249,214,179,144,123,0],600:[546,486,426,366,306,246,210,0],1000:[910,810,710,610,510,410,350,0]};
const T2 = {20:[18,16,14,11,9,7,4,0],40:[36,32,28,23,18,14,8,0],50:[45,40,34,29,23,18,10,0],80:[72,63,54,46,37,28,16,0],100:[90,79,68,57,46,35,20,0],
            300:[270,237,204,171,138,105,60,0],350:[315,277,238,200,161,123,70,0],600:[540,474,408,342,276,210,120,0],1000:[900,790,680,570,460,350,200,0]};
const REPORTS = {
  'Class 5':    { subs: ['Telugu','English','Mathematics','EVS'],
                  head: ['S.No.','Unique Id No.','Student Name','Name of the Assessment','Telugu','English','Mathematics','EVS','Total','Grade','Class'] },
  'Class 6-7':  { subs: ['Telugu','Hindi','English','Mathematics','Science','Social Studies'],
                  head: ['S.No.','Unique Id No.','Student Name','Name of the Assessment','Telugu','Grade','Hindi','Grade','English','Grade','Mathematics','Grade','Science','Grade','Social Studies','Grade','Total','Total Grade','Class'] },
  'Class 8-10': { subs: ['Telugu','Hindi','English','Mathematics','Physical Science','Biological Science','Social Studies'],
                  head: ['S.No.','Unique Id No.','Student Name','Name of the Assessment','Telugu','Grade','Hindi','Grade','English','Grade','Mathematics','Grade','Physical Sciences','Grade','Biological Science','Grade','Total Science','Grade','Social Studies','Grade','Total','Total Grade','Class'] }
};

function grade_(sub, marks, max) {
  const T = sub === 'Hindi' ? T2 : T1; let cols = T[max];
  if (!cols) { marks = marks / max * 100; cols = T[100]; }
  const m = Math.round(marks + 1e-9), i = cols.findIndex(lo => m >= lo);
  return G_NAMES[i < 0 ? 7 : i];
}
function maxOf_(sub, a) {
  const row = ASSESS.filter(x => x[0] === a)[0], base = row ? row[2] : (a.indexOf('MMT@') === 0 ? 20 : 100);
  const half = (sub === 'Physical Science' || sub === 'Biological Science') && (a.indexOf('FA') === 0 || a.indexOf('SA') === 0 || a.indexOf('PF') === 0);
  return half ? base / 2 : base;
}
const num_ = v => v === 'AB' ? 0 : v;
let ASSESS = ASSESS_BASE; // refreshed per rebuild to include that day's Mission March Tests

function reportRow_(group, c, s, a, marks) {
  const g = (sub) => marks[s.id + '|' + sub + '|' + a[0]];
  const subs = REPORTS[group].subs;
  if (!subs.some(sub => g(sub) !== undefined)) return null;
  const cls = c.grade + (c.section ? '-' + c.section : '');
  const head = [s.roll, String(s.reg === undefined ? '' : s.reg), s.name, a[1]];
  const cell = sub => { const v = g(sub); return v === undefined ? ['', ''] : (v === 'AB' ? ['AB', 'AB'] : [v, grade_(sub, v, maxOf_(sub, a[0]))]); };
  let complete = true, total = 0, tmax = 0;
  const addTot = (v, mx) => { if (v === undefined) complete = false; else { total += num_(v); tmax += mx; } };
  if (group === 'Class 5') {
    const out = head.slice();
    subs.forEach(sub => { const v = g(sub); out.push(v === undefined ? '' : v); addTot(v, maxOf_(sub, a[0])); });
    out.push(complete ? total : '', complete ? grade_(undefined, total, tmax) : '', cls);
    return out;
  }
  const out = head.slice();
  subs.forEach(sub => {
    const cc = cell(sub); out.push(cc[0], cc[1]);
    if (group === 'Class 8-10' && sub === 'Biological Science') {
      const x = g('Physical Science'), y = g('Biological Science'), mx = maxOf_('Physical Science', a[0]) + maxOf_('Biological Science', a[0]);
      if (x === undefined || y === undefined) { out.push('', ''); addTot(undefined, mx); }
      else { const t = num_(x) + num_(y); out.push(t, grade_(undefined, t, mx)); addTot(t, mx); }
    } else if (group !== 'Class 8-10' || (sub !== 'Physical Science' && sub !== 'Biological Science')) {
      addTot(g(sub), maxOf_(sub, a[0]));
    }
  });
  out.push(complete ? total : '', complete ? grade_(undefined, total, tmax) : '', cls);
  return out;
}

function rebuildReports_() {
  const classes = rows_('Classes').sort((p, q) => Number(p.grade) - Number(q.grade) || String(p.section).localeCompare(String(q.section)));
  const students = rows_('Students');
  const marks = {};
  rows_('Marks').forEach(r => marks[String(r.key)] = (r.marks === 'AB') ? 'AB' : Number(r.marks));
  ASSESS = assessList_(Object.keys(marks));
  const data = { 'Class 5': [], 'Class 6-7': [], 'Class 8-10': [] };
  classes.forEach(c => {
    const gr = Number(c.grade), group = gr <= 5 ? 'Class 5' : gr <= 7 ? 'Class 6-7' : 'Class 8-10';
    const studs = students.filter(s => String(s.classId) === String(c.id))
      .map(s => ({ id: String(s.id), roll: s.roll, reg: s.reg, name: String(s.name) }))
      .sort((p, q) => (parseFloat(p.roll) || 1e9) - (parseFloat(q.roll) || 1e9) || p.name.localeCompare(q.name));
    ASSESS.forEach(a => studs.forEach(s => { const r = reportRow_(group, c, s, a, marks); if (r) data[group].push(r); }));
  });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(REPORTS).forEach(name => {
    const head = REPORTS[name].head, rows = data[name];
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#e0e7ff').setWrap(true).setHorizontalAlignment('center');
    sh.setFrozenRows(1); sh.setFrozenColumns(3);
    if (rows.length) {
      sh.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    }
  });
}
function rebuildReports() { rebuildReports_(); }
function onOpen() { SpreadsheetApp.getUi().createMenu('Marks').addItem('Rebuild report sheets', 'rebuildReports').addToUi(); }
const MUTATING = { saveClass: 1, deleteClass: 1, saveStudents: 1, deleteStudent: 1, saveMarks: 1 };

function doGet() { return out_({ ok: true, data: 'Marks backend is running' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    const b = JSON.parse(e.postData.contents);
    const pin = PropertiesService.getScriptProperties().getProperty('APP_PIN');
    if (pin && String(b.pin) !== String(pin)) throw new Error('Wrong PIN');
    let data = null;
    switch (b.action) {
      case 'getAll':      data = getAll_(); break;
      case 'saveClass':
        upsert_('Classes', 'id', [{ id: b.id, grade: b.grade, section: b.section, year: b.year, subjects: (b.subjects || []).join(',') }]); break;
      case 'deleteClass':
        remove_('Classes', r => r.id === b.id);
        remove_('Students', r => r.classId === b.id);
        remove_('Marks', r => r.classId === b.id); break;
      case 'saveStudents': upsert_('Students', 'id', b.students || []); break;
      case 'deleteStudent':
        remove_('Students', r => r.id === b.id);
        remove_('Marks', r => r.studentId === b.id); break;
      case 'saveMarks': saveMarks_(b.entries || []); break;
      case 'aiFeedback': data = ai_(b.prompt); break;
      case 'rebuildReports': rebuildReports_(); break;
      default: throw new Error('Unknown action: ' + b.action);
    }
    if (MUTATING[b.action] && !b.skipReport) {
      try { rebuildReports_(); } catch (re) { data = { reportError: String(re.message || re) }; }
    }
    return out_({ ok: true, data: data });
  } catch (err) {
    return out_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let s = ss.getSheetByName(name);
  if (s) { // keep headers in sync if columns were added in a newer version
    const n = SHEETS[name].length, h = s.getRange(1, 1, 1, n).getValues()[0];
    if (h.join('|') !== SHEETS[name].join('|')) s.getRange(1, 1, 1, n).setValues([SHEETS[name]]).setFontWeight('bold');
  }
  if (!s) {
    s = ss.insertSheet(name);
    s.appendRow(SHEETS[name]);
    s.setFrozenRows(1);
    s.getRange(1, 1, 1, SHEETS[name].length).setFontWeight('bold').setBackground('#e0e7ff');
  }
  return s;
}

function rows_(name) {
  const cols = SHEETS[name], s = sheet_(name), last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, cols.length).getValues().map(r => {
    const o = {}; cols.forEach((c, i) => o[c] = r[i]); return o;
  });
}

function writeAll_(name, objs) {
  const cols = SHEETS[name], s = sheet_(name), last = s.getLastRow();
  if (last > 1) s.getRange(2, 1, last - 1, cols.length).clearContent();
  if (objs.length) s.getRange(2, 1, objs.length, cols.length).setValues(objs.map(o => cols.map(c => o[c] === undefined ? '' : o[c])));
}

function upsert_(name, keyField, items) {
  const all = rows_(name), idx = {};
  all.forEach((r, i) => idx[String(r[keyField])] = i);
  items.forEach(o => {
    const k = String(o[keyField]);
    if (k in idx) all[idx[k]] = o; else { all.push(o); idx[k] = all.length - 1; }
  });
  writeAll_(name, all);
}

function remove_(name, pred) { writeAll_(name, rows_(name).filter(r => !pred(r))); }

function saveMarks_(entries) {
  const del = {}, up = [];
  entries.forEach(e => {
    const key = e.studentId + '|' + e.subject + '|' + e.assessment;
    if (e.marks === null || e.marks === '' || e.marks === undefined) del[key] = true;
    else up.push({ key: key, classId: e.classId, studentId: e.studentId, subject: e.subject, assessment: e.assessment, marks: e.marks, updatedAt: new Date() });
  });
  if (Object.keys(del).length) remove_('Marks', r => del[r.key]);
  if (up.length) upsert_('Marks', 'key', up);
}

function getAll_() {
  const classes = rows_('Classes').map(r => ({
    id: String(r.id), grade: Number(r.grade), section: String(r.section), year: String(r.year),
    subjects: String(r.subjects).split(',').filter(Boolean)
  }));
  const students = rows_('Students').map(r => ({ id: String(r.id), classId: String(r.classId), roll: r.roll, name: String(r.name), reg: String(r.reg === undefined ? '' : r.reg) }));
  const marks = {};
  rows_('Marks').forEach(r => { marks[String(r.key)] = (r.marks === 'AB') ? 'AB' : Number(r.marks); });
  return { classes: classes, students: students, marks: marks };
}

function ai_(prompt) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Script properties');
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 800, messages: [{ role: 'user', content: String(prompt).slice(0, 12000) }] })
  });
  const j = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error((j.error && j.error.message) || 'AI request failed');
  return j.content.map(c => c.text || '').join('').trim();
}
