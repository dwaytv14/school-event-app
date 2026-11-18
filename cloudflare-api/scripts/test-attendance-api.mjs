// Runs the real migrations and the real worker code against a real SQLite database.
//   node scripts/test-attendance-api.mjs
// It checks that attendance (one row per record, synced in steps) behaves correctly:
// the migration, paging, removals, the attendance rules, finishing an event,
// the old-app compatibility, and that the workspace row stays small.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');
const { default: worker } = await import('../src/index.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : detail);
  if (!ok) failures += 1;
};

// ---- a D1-shaped wrapper around node:sqlite ----
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const wrap = (sql) => {
    const statement = sqlite.prepare(sql);
    let args = [];
    const api = {
      bind(...values) { args = values; return api; },
      first() { return statement.get(...args) ?? null; },
      all() { return { results: statement.all(...args) }; },
      run() { const r = statement.run(...args); return { meta: { changes: Number(r.changes) } }; },
    };
    return api;
  };
  return {
    raw: sqlite,
    prepare: wrap,
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const out = statements.map((s) => s.run());
        sqlite.exec('COMMIT');
        return Promise.resolve(out);
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
// D1 methods are async; wrap so `await` works the same.
function asyncDb(db) {
  return {
    raw: db.raw,
    prepare(sql) {
      const s = db.prepare(sql);
      const api = {
        bind(...v) { s.bind(...v); return api; },
        first: async () => s.first(),
        all: async () => s.all(),
        run: async () => s.run(),
        _run: () => s.run(),
      };
      return api;
    },
    batch: (statements) => db.batch(statements.map((s) => ({ run: () => s._run() }))),
  };
}

const sqliteDb = makeDb();
const DB = asyncDb(sqliteDb);
const env = { DB, JWT_SECRET: 'x'.repeat(48), CLIENT_ORIGINS: '' };

const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const file of migrationFiles.filter((f) => f < '0007')) {
  sqliteDb.raw.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
}

// ---- seed: a school whose attendance still lives inside the workspace JSON ----
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return `pbkdf2-sha256$100000$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}
const manilaToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const manilaYesterday = new Date(Date.now() + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
const ORG = 'org-1';
const at = (time, date = manilaToday) => `${date}T${time}+08:00`;
const student = (n) => ({ id: `PPY-${n}`, name: `Student ${n}`, section: 'BSIT 1st Year A', sectionId: 'sec-a', course: 'BSIT', yearLevel: '1st Year', mobile: `+63900000${String(n).padStart(4, '0')}` });
const event = (id, extra = {}) => ({
  id, name: id, date: manilaToday, startTime: '08:00', endTime: '17:00', venue: 'Gym', description: '',
  graceMinutes: 15, sections: [], seats: [], requiredSections: ['sec-a'], approvalStatus: 'approved', ...extra,
});
const students = Array.from({ length: 12 }, (_, i) => student(i + 1));
const oldRecords = [
  { id: 'OLD-1', eventId: 'E1', studentId: 'PPY-1', timeIn: at('08:05'), timeOut: at('11:00'), durationMinutes: 175, status: 'Present', syncStatus: 'Synced' },
  { id: 'OLD-2', eventId: 'E1', studentId: 'PPY-2', timeIn: at('08:30'), timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced' },
  { id: 'OLD-3', eventId: 'E1', studentId: 'PPY-3', timeIn: '', timeOut: null, durationMinutes: null, status: 'Excused', syncStatus: 'Synced', excused: true, manual: true },
];
sqliteDb.raw.prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)').run(ORG, 'School', new Date().toISOString());
const passwordHash = await hashPassword('password123');
const addUser = (id, username, role, studentId = null) =>
  sqliteDb.raw.prepare('INSERT INTO users (id, organization_id, username, password_hash, auth_version, role, student_id, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, ORG, username, passwordHash, 0, role, studentId, new Date().toISOString());
addUser('u-admin', 'admin', 'super_admin');
addUser('u-org', 'organizer1', 'organizer');
addUser('u-s1', 'student1', 'student', 'PPY-1');
sqliteDb.raw.prepare('INSERT INTO workspace_state (organization_id, revision, state_json, updated_at) VALUES (?,?,?,?)').run(
  ORG, 1,
  JSON.stringify({
    students, events: [event('E1'), event('E-pending', { approvalStatus: 'pending', createdBy: 'u-org' }), event('E-old', { date: manilaYesterday })],
    attendance: oldRecords, violations: [], messages: [], syncItems: [], announcements: [],
  }),
  new Date().toISOString(),
);
sqliteDb.raw.prepare('INSERT INTO sections (id, organization_id, course, year_level, name) VALUES (?,?,?,?,?)').run('sec-a', ORG, 'BSIT', '1st Year', 'A');

// ---- 1. the migration moves the old records out of the workspace JSON ----
sqliteDb.raw.exec(fs.readFileSync(path.join(migrationsDir, '0007_attendance_records.sql'), 'utf8'));
const moved = sqliteDb.raw.prepare('SELECT COUNT(*) AS n FROM attendance_records').get().n;
check('migration copies every existing record into the table', moved === 3, `rows=${moved}`);
const blob = JSON.parse(sqliteDb.raw.prepare('SELECT state_json FROM workspace_state').get().state_json);
check('migration empties attendance in the workspace JSON', blob.attendance.length === 0);
check('migration keeps the cursor in step', sqliteDb.raw.prepare('SELECT value FROM attendance_cursor').get().value === 3);
const copy = JSON.parse(sqliteDb.raw.prepare("SELECT data FROM attendance_records WHERE id = 'OLD-1'").get().data);
check('a migrated record is unchanged', copy.timeIn === at('08:05') && copy.status === 'Present');

// ---- helpers to talk to the worker ----
async function call(method, url, token, body) {
  const response = await worker.fetch(new Request(`https://api.test${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
async function login(username) {
  const r = await call('POST', '/api/auth/login', null, { username, password: 'password123' });
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}
const admin = await login('admin');
const organizer = await login('organizer1');
const studentToken = await login('student1');
const pull = (token, after = 0) => call('GET', `/api/attendance?after=${after}`, token);
async function pullAll(token, after = 0) {
  const records = [];
  const removed = [];
  let cursor = after;
  for (let guard = 0; guard < 60; guard += 1) {
    const page = await pull(token, cursor);
    records.push(...page.body.records);
    removed.push(...page.body.removed);
    cursor = page.body.cursor;
    if (!page.body.more) break;
  }
  return { records, removed, cursor };
}
const rec = (id, studentId, timeIn, extra = {}) => ({ id, eventId: 'E1', studentId, timeIn, timeOut: null, durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced', ...extra });

// ---- 2. pulling ----
let r = await pull(admin);
check('staff can pull all records', r.status === 200 && r.body.records.length === 3 && r.body.cursor === 3 && r.body.more === false, JSON.stringify(r.body).slice(0, 200));
r = await pull(studentToken);
check('a student only gets their own records', r.body.records.length === 1 && r.body.records[0].studentId === 'PPY-1');
r = await pull(admin, 3);
check('pulling again from the cursor returns nothing new', r.body.records.length === 0 && r.body.cursor === 3);

// ---- 3. pushing ----
r = await call('PUT', '/api/attendance', organizer, { records: [rec('N-1', 'PPY-4', at('08:10'))], removed: [] });
check('an organizer can record a check-in on the event day', r.status === 200 && r.body.dropped.length === 0, JSON.stringify(r.body));
r = await pull(admin, 3);
check('the new record shows up for others, stamped with who recorded it', r.body.records.length === 1 && r.body.records[0].recordedByName === 'organizer1' && r.body.cursor === 4, JSON.stringify(r.body).slice(0, 300));
r = await call('PUT', '/api/attendance', studentToken, { records: [rec('X-1', 'PPY-1', at('08:00'))], removed: [] });
check('a student cannot record attendance', r.status === 403);

// ---- 4. the rules ----
r = await call('PUT', '/api/attendance', organizer, { records: [
  rec('R-early', 'PPY-5', at('08:00', manilaYesterday)),
  rec('R-pending', 'PPY-6', at('08:00'), { eventId: 'E-pending' }),
  rec('R-nostudent', 'PPY-999', at('08:00')),
  rec('R-ok', 'PPY-7', at('09:00')),
  rec('R-overtime', 'PPY-8', `${new Date(Date.parse(`${manilaToday}T00:00:00+08:00`) + 25 * 3600000).toISOString()}`),
], removed: [] });
check('a check-in from the day before is dropped', r.body.dropped.includes('R-early'));
check('a check-in at an unapproved event is dropped', r.body.dropped.includes('R-pending'));
check('a check-in for an unknown student is dropped', r.body.dropped.includes('R-nostudent'));
check('a valid check-in is kept', !r.body.dropped.includes('R-ok'));
check('a check-in just after midnight (overtime) is kept', !r.body.dropped.includes('R-overtime'));
r = await call('PUT', '/api/attendance', admin, { records: [rec('A-pend', 'PPY-6', at('08:00'), { eventId: 'E-pending' })], removed: [] });
check('the admin may record at any event', r.body.dropped.length === 0);

// ---- 5. removing (undo) ----
r = await call('PUT', '/api/attendance', admin, { records: [], removed: ['N-1'] });
const after = await pull(admin, 4);
check('a removal is passed on to every device', after.body.removed.includes('N-1'));
r = await pull(admin, 0);
check('a full pull does not include removed records', !r.body.records.some((x) => x.id === 'N-1') && r.body.removed.includes('N-1'));
const kept = sqliteDb.raw.prepare("SELECT data FROM attendance_records WHERE id = 'N-1'").get();
check('a removed record is kept in the table (recoverable)', !!kept);

// ---- 6. finishing an event closes everyone still inside ----
let ws = await call('GET', '/api/workspace?attendance=separate', admin);
check('the workspace no longer carries attendance', ws.status === 200 && ws.body.state.attendance.length === 0);
const finishedAt = at('15:00');
const state = { ...ws.body.state, events: ws.body.state.events.map((e) => (e.id === 'E1' ? { ...e, finishedAt } : e)) };
r = await call('PUT', '/api/workspace?attendance=separate', admin, { revision: ws.body.revision, state });
check('the admin can finish an event', r.status === 200, JSON.stringify(r.body));
r = await pull(admin, 0);
const open = r.body.records.filter((x) => x.eventId === 'E1' && x.timeIn && !x.excused && !x.timeOut);
check('everyone still inside is checked out at the finish time', open.length === 0, `still open: ${open.map((x) => x.id)}`);
const two = r.body.records.find((x) => x.id === 'OLD-2');
check('their time-out is the finish time', two.timeOut === finishedAt && two.durationMinutes === 390);
r = await call('PUT', '/api/attendance', organizer, { records: [rec('late-scan', 'PPY-9', at('16:00'))], removed: [] });
check('a new check-in after the event was finished is dropped', r.body.dropped.includes('late-scan'));

// ---- 7. paging: lots of records, nothing lost or repeated ----
const many = [];
for (let i = 0; i < 7200; i += 1) many.push({ id: `BULK-${i}`, eventId: 'E-old', studentId: `PPY-${(i % 12) + 1}`, timeIn: '', timeOut: null, durationMinutes: null, status: 'Excused', syncStatus: 'Synced', excused: true, manual: true });
for (let i = 0; i < many.length; i += 500) {
  const res = await call('PUT', '/api/attendance', admin, { records: many.slice(i, i + 500), removed: [] });
  if (res.status !== 200 || res.body.dropped.length) check(`bulk push ${i}`, false, JSON.stringify(res.body).slice(0, 200));
}
let cursor = 0;
const seen = new Map();
let pages = 0;
while (true) {
  const page = await pull(admin, cursor);
  pages += 1;
  for (const record of page.body.records) seen.set(record.id, (seen.get(record.id) ?? 0) + 1);
  cursor = page.body.cursor;
  if (!page.body.more) break;
  if (pages > 50) break;
}
const bulkSeen = [...seen.keys()].filter((id) => id.startsWith('BULK-')).length;
check('7,200 records come back across several pages with none missing', bulkSeen === 7200, `got ${bulkSeen} in ${pages} pages`);
check('no record is delivered twice', [...seen.values()].every((n) => n === 1));
check('paging needed more than one page', pages > 1, `pages=${pages}`);
const rowSize = sqliteDb.raw.prepare('SELECT LENGTH(state_json) AS n FROM workspace_state').get().n;
check('the workspace row stays small however much attendance there is', rowSize < 20000, `bytes=${rowSize}`);

// ---- 8. old apps still work ----
const legacyGet = await call('GET', '/api/workspace', admin);
check('an old app still receives attendance inside the workspace', legacyGet.body.state.attendance.length > 7000);
const legacyState = { ...legacyGet.body.state, attendance: [...legacyGet.body.state.attendance.slice(0, 5), rec('LEGACY-1', 'PPY-10', at('10:00'), { eventId: 'E-old' })] };
legacyState.events = legacyState.events.map((e) => e);
// (E-old is yesterday: a brand-new check-in there must be refused; use today's event instead)
legacyState.attendance[5] = rec('LEGACY-2', 'PPY-10', at('10:00'), { eventId: 'E-pending' });
const legacyPut = await call('PUT', '/api/workspace', admin, { revision: legacyGet.body.revision, state: legacyState });
check('an old app can still save', legacyPut.status === 200, JSON.stringify(legacyPut.body));
const afterLegacy = sqliteDb.raw.prepare("SELECT COUNT(*) AS n FROM attendance_records WHERE id IN ('LEGACY-1','LEGACY-2')").get().n;
check('an old app\'s valid records are kept, invalid ones dropped', afterLegacy === 1, `rows=${afterLegacy}`);
const blobAfter = JSON.parse(sqliteDb.raw.prepare('SELECT state_json FROM workspace_state').get().state_json);
check('the old app did not put attendance back into the workspace row', blobAfter.attendance.length === 0);

// ---- 9. texts and bookkeeping are trimmed ----
ws = await call('GET', '/api/workspace?attendance=separate', admin);
const oldMs = Date.now() - 20 * 86400000;
const messages = [
  { id: 'M-old', recipientName: 'A', recipientNumber: '+639', text: 't', createdAt: new Date(oldMs).toISOString(), status: 'Sent', syncStatus: 'Synced' },
  { id: 'M-new', recipientName: 'A', recipientNumber: '+639', text: 't', createdAt: new Date().toISOString(), status: 'Sent', syncStatus: 'Synced' },
  { id: 'M-queued-old', recipientName: 'A', recipientNumber: '+639', text: 't', createdAt: new Date(oldMs).toISOString(), status: 'Queued', syncStatus: 'Pending sync' },
];
const syncItems = [
  { id: 'S1', kind: 'attendance', createdAt: new Date().toISOString(), status: 'Synced' },
  { id: 'S2', kind: 'attendance', createdAt: new Date().toISOString(), status: 'Pending sync' },
];
r = await call('PUT', '/api/workspace?attendance=separate', admin, { revision: ws.body.revision, state: { ...ws.body.state, messages, syncItems } });
check('the save tells the app when it trimmed texts', r.status === 200 && r.body.refresh === true, JSON.stringify(r.body));
ws = await call('GET', '/api/workspace?attendance=separate', admin);
const ids = ws.body.state.messages.map((m) => m.id).sort();
check('old sent texts are dropped, recent and unsent ones are kept', JSON.stringify(ids) === JSON.stringify(['M-new', 'M-queued-old']), JSON.stringify(ids));
check('finished sync bookkeeping is dropped, pending is kept', ws.body.state.syncItems.length === 1 && ws.body.state.syncItems[0].id === 'S2');

// ---- 9b. dead seating data is dropped ----
ws = await call('GET', '/api/workspace?attendance=separate', admin);
const withSeats = { ...ws.body.state, events: ws.body.state.events.map((e) => ({ ...e, seats: Array.from({ length: 150 }, (_, i) => ({ id: 's' + i, row: 1, number: i, section: 'x', studentId: null })), seatingPlan: { sharedSectionIds: [] } })) };
r = await call('PUT', '/api/workspace?attendance=separate', admin, { revision: ws.body.revision, state: withSeats });
check('saving still works with old seat data in the events', r.status === 200, JSON.stringify(r.body));
ws = await call('GET', '/api/workspace?attendance=separate', admin);
check('old seat lists are no longer stored', ws.body.state.events.every((e) => e.seats.length === 0 && e.seatingPlan === undefined));

// ---- 10. an organizer's save is not blocked by an aging text ----
const orgWs = await call('GET', '/api/workspace?attendance=separate', organizer);
const orgSave = await call('PUT', '/api/workspace?attendance=separate', organizer, { revision: orgWs.body.revision, state: orgWs.body.state });
check('an organizer can save with the trimmed workspace', orgSave.status === 200, JSON.stringify(orgSave.body));

// ---- 10b. anyone left inside is checked out at 11:59 PM of the event day ----
r = await call('PUT', '/api/attendance', admin, { records: [rec('left-in', 'PPY-12', at('10:00', manilaYesterday), { eventId: 'E-old' })], removed: [] });
const lateClose = (await pullAll(admin, 0)).records.find((x) => x.id === 'left-in');
check('a check-in for a past event with no time-out is closed at 11:59 PM of its day', lateClose?.timeOut === new Date(manilaYesterday + 'T23:59:00+08:00').toISOString(), JSON.stringify(lateClose));
// an open record that got into the table some other way is swept up by the daily job
sqliteDb.raw.prepare("INSERT INTO attendance_records (organization_id, id, event_id, student_id, data, deleted, seq, updated_at) VALUES (?, 'sneaky', 'E-old', 'PPY-3', ?, 0, 9999999, ?)")
  .run(ORG, JSON.stringify(rec('sneaky', 'PPY-3', at('09:00', manilaYesterday), { eventId: 'E-old' })), new Date().toISOString());
await worker.scheduled({}, env, { waitUntil: (p) => p });
await new Promise((resolve) => setTimeout(resolve, 300));
const swept = JSON.parse(sqliteDb.raw.prepare("SELECT data FROM attendance_records WHERE id = 'sneaky'").get().data);
check('the daily job checks out anyone still inside a past event', swept.timeOut === new Date(manilaYesterday + 'T23:59:00+08:00').toISOString(), JSON.stringify(swept));
const stillOn = JSON.parse(sqliteDb.raw.prepare("SELECT data FROM attendance_records WHERE id = 'A-pend'").get().data);
check('but not anyone at an event that is still on today', stillOn.timeOut === null, JSON.stringify(stillOn));

// ---- 11. excuses and deletes use the table ----
sqliteDb.raw.prepare(`INSERT INTO excuse_requests (id, organization_id, event_id, event_name, student_id, student_name, section_label, reason, status, created_at)
  VALUES ('X1', ?, 'E1', 'E1', 'PPY-11', 'Student 11', 'BSIT 1st Year A', 'sick for the day', 'pending', ?)`).run(ORG, new Date().toISOString());
r = await call('POST', '/api/excuses/X1/review', admin, { decision: 'approved' });
check('approving an excuse records an excused absence', r.status === 200, JSON.stringify(r.body));
r = await pullAll(admin, 0);
check('the excused absence is delivered to the apps', r.records.some((x) => x.studentId === 'PPY-11' && x.eventId === 'E1' && x.excused));
r = await call('DELETE', '/api/events/E1', admin);
check('an approved event with attendance cannot be deleted', r.status === 409, JSON.stringify(r.body));
r = await call('DELETE', '/api/admin/users/student1', admin);
check('deleting a student removes their attendance', r.status === 200, JSON.stringify(r.body));
r = await pullAll(admin, 0);
check('and every device is told', r.removed.includes('OLD-1') && !r.records.some((x) => x.studentId === 'PPY-1'));

// ---- 12. account changes need the current password ----
const rename = (token, body) => call('POST', '/api/account/username', token, body);
r = await rename(organizer, { username: 'prank-name' });
check('changing the username without the current password is refused', r.status === 403, JSON.stringify(r.body));
r = await rename(organizer, { username: 'prank-name', currentPassword: '' });
check('an empty current password is refused', r.status === 403);
r = await rename(organizer, { username: 'prank-name', currentPassword: 'not-the-password' });
check('a wrong current password is refused', r.status === 403);
const stillOld = await call('POST', '/api/auth/login', null, { username: 'organizer1', password: 'password123' });
check('after those attempts the username is unchanged', stillOld.status === 200);
r = await rename(organizer, { username: 'real-new-name', currentPassword: 'password123' });
check('with the right current password the username changes', r.status === 200, JSON.stringify(r.body));
addUser('u-s2', 'student2', 'student', 'PPY-2');
const student2 = await login('student2');
r = await call('POST', '/api/account/password', student2, { newPassword: 'another-pass-1' });
check('changing the password without the current one is refused', r.status === 403 || r.status === 400, JSON.stringify(r.body));
r = await call('POST', '/api/account/contact/request', student2, { mobile: '09123456789' });
check('changing the contact number without the current password is refused', r.status === 403, JSON.stringify(r.body));

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll attendance API checks passed');
process.exit(failures ? 1 : 0);
