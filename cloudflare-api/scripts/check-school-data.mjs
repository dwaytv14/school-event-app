// Checks that the generated school data is consistent, the way the app will read it.
//
// Usage (PowerShell, from the cloudflare-api folder):
//   $env:ADMIN_PASSWORD = "your admin password"
//   node scripts/check-school-data.mjs
// Read-only: it only reads data and prints what looks wrong.
const API = (process.env.API ?? 'https://gather-school-api.gather-school-api.workers.dev/api').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER ?? 'PPY-ADMIN';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? 'student123';
if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD to the admin account password first.');
  process.exit(1);
}
async function call(method, path, token, body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
let fails = 0;
const ok = (name, cond, extra = '') => { if (!cond) fails += 1; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra); };

try {
  const admin = (await call('POST', '/auth/login', null, { username: ADMIN_USER, password: ADMIN_PASSWORD })).data?.token;
  if (!admin) throw new Error('The admin sign-in failed. Check ADMIN_USER and ADMIN_PASSWORD.');
  const ws = (await call('GET', '/workspace', admin)).data;
  const { students, events, attendance, announcements } = ws.state;
  const accounts = (await call('GET', '/accounts', admin)).data.accounts;
  const excuses = (await call('GET', '/excuses', admin)).data.excuses;
  const audit = (await call('GET', '/admin/audit?limit=200', admin)).data.entries;
  console.log(`\nstudents ${students.length} | events ${events.length} | attendance ${attendance.length} | updates ${announcements.length} | excuses ${excuses.length} | log entries ${audit.length} | state ${(JSON.stringify(ws.state).length / 1024).toFixed(0)} KB\n`);

  // ---- events
  const byStatus = (s) => events.filter((e) => (e.approvalStatus ?? 'approved') === s).length;
  console.log(`events: ${byStatus('approved')} approved, ${byStatus('pending')} pending, ${byStatus('rejected')} rejected, ${events.filter((e) => e.cancelled).length} cancelled, ${events.filter((e) => e.postponedFrom).length} moved`);
  ok('every organizer-made event records who made it', events.filter((e) => e.createdBy).every((e) => !!e.createdByName));
  ok('rejected events have a reason', events.filter((e) => e.approvalStatus === 'rejected').every((e) => !!e.rejectionReason));
  ok('cancelled events have a reason and no attendance', events.filter((e) => e.cancelled).every((e) => e.cancelReason && !attendance.some((a) => a.eventId === e.id)));
  ok('the resubmitted event is approved with no leftover reason', (() => { const e = events.find((x) => x.id === 'EVT-20261217-outreach-feeding'); return e?.approvalStatus === 'approved' && !e.rejectionReason && !!e.resubmittedAt; })());
  ok('the moved event kept its original schedule', (() => { const e = events.find((x) => x.id === 'EVT-20261205-alumni-homecoming'); return e?.postponedFrom?.date === '2026-12-05' && e.date === '2026-12-12'; })());

  // ---- attendance
  const eventsById = new Map(events.map((e) => [e.id, e]));
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const keys = new Set();
  let dup = 0, notRequired = 0, badTime = 0, badStatus = 0, unknown = 0, onUnapproved = 0;
  for (const r of attendance) {
    const e = eventsById.get(r.eventId), s = studentsById.get(r.studentId);
    if (!e || !s) { unknown += 1; continue; }
    if (keys.has(`${r.eventId}|${r.studentId}`)) dup += 1; keys.add(`${r.eventId}|${r.studentId}`);
    if ((e.approvalStatus ?? 'approved') !== 'approved') onUnapproved += 1;
    if (!(e.requiredSections ?? []).includes(s.sectionId)) notRequired += 1;
    if (r.excused) continue;
    const start = new Date(`${e.date}T${e.startTime}:00+08:00`).getTime(), end = new Date(`${e.date}T${e.endTime}:00+08:00`).getTime();
    const inAt = new Date(r.timeIn).getTime();
    if (!(inAt >= start - 30 * 60000 && inAt <= end) || (r.timeOut && new Date(r.timeOut) <= new Date(r.timeIn))) badTime += 1;
    const late = inAt > start + e.graceMinutes * 60000;
    const expected = !r.timeOut ? 'Incomplete' : late ? 'Late' : 'Present';
    if (r.status !== expected) badStatus += 1;
  }
  ok('no attendance for missing students or events', unknown === 0, String(unknown));
  ok('nobody is recorded twice for the same event', dup === 0, String(dup));
  ok('only students who were required are recorded', notRequired === 0, String(notRequired));
  ok('attendance only exists for approved events', onUnapproved === 0, String(onUnapproved));
  ok('check-in and check-out times are realistic', badTime === 0, String(badTime));
  ok('Present, Late and Incomplete match the grace period', badStatus === 0, String(badStatus));
  const stamped = attendance.filter((r) => !r.excused);
  const scanners = {};
  for (const r of stamped) scanners[r.recordedByName ?? '(none)'] = (scanners[r.recordedByName ?? '(none)'] ?? 0) + 1;
  console.log('check-ins by organizer:', JSON.stringify(scanners));
  ok('every check-in says which organizer recorded it', stamped.every((r) => !!r.recordedByName));
  ok('some entries were made by hand', attendance.some((r) => r.manual && !r.excused));

  // ---- excuses
  const approved = excuses.filter((x) => x.status === 'approved'), excusedRecords = attendance.filter((r) => r.excused);
  console.log(`excuses: ${approved.length} approved, ${excuses.filter((x) => x.status === 'rejected').length} rejected, ${excuses.filter((x) => x.status === 'pending').length} waiting`);
  ok('each approved excuse became an excused record', approved.every((x) => excusedRecords.some((r) => r.eventId === x.eventId && r.studentId === x.studentId)) && excusedRecords.length === approved.length, `${excusedRecords.length} vs ${approved.length}`);
  ok('rejected excuses have a reason', excuses.filter((x) => x.status === 'rejected').every((x) => !!x.reviewerNote));
  ok('rejected and waiting excuses did not excuse anyone', excuses.filter((x) => x.status !== 'approved').every((x) => !excusedRecords.some((r) => r.eventId === x.eventId && r.studentId === x.studentId)));

  // ---- updates and the activity log
  ok('updates are newest first', announcements.every((a, i) => i === 0 || announcements[i - 1].createdAt >= a.createdAt));
  const actions = {};
  for (const e of audit) actions[e.action] = (actions[e.action] ?? 0) + 1;
  console.log('activity log:', JSON.stringify(actions));
  ok('the activity log has the main actions', ['event_created', 'event_approved', 'event_rejected', 'event_cancelled', 'announcement', 'excuse_requested', 'excuse_approved', 'excuse_rejected'].every((a) => actions[a]));

  // ---- per-event table
  console.log('\nevent'.padEnd(46), 'status'.padEnd(10), 'req'.padStart(4), 'here'.padStart(5), 'late'.padStart(5), 'exc'.padStart(4), 'abs'.padStart(4));
  for (const e of [...events].sort((a, b) => a.date.localeCompare(b.date))) {
    const required = students.filter((s) => (e.requiredSections ?? []).includes(s.sectionId)).length;
    const rs = attendance.filter((r) => r.eventId === e.id);
    const exc = rs.filter((r) => r.excused).length, late = rs.filter((r) => r.status === 'Late').length, here = rs.length - exc;
    const status = e.cancelled ? 'cancelled' : (e.approvalStatus ?? 'approved');
    console.log(`${e.date} ${e.name}`.slice(0, 45).padEnd(46), status.padEnd(10), String(required).padStart(4), String(here).padStart(5), String(late).padStart(5), String(exc).padStart(4), String(rs.length ? required - here - exc : 0).padStart(4));
  }

  // ---- what a student sees
  const sample = excuses.find((x) => x.status === 'approved');
  const username = accounts.find((a) => a.studentId === sample.studentId).username;
  const student = (await call('POST', '/auth/login', null, { username, password: STUDENT_PASSWORD })).data;
  const view = (await call('GET', '/workspace', student.token)).data.state;
  ok('a student gets only their own record', view.students.length === 1 && view.attendance.every((r) => r.studentId === student.studentId));
  ok('a student sees only approved events', view.events.length > 0 && view.events.every((e) => e.approvalStatus === 'approved'));
  ok('a student never sees pending or rejected events', !view.events.some((e) => ['EVT-20261208-programming-contest', 'EVT-20261119-film-showing'].includes(e.id)));
  const mine = (await call('GET', '/excuses/mine', student.token)).data.excuses;
  ok('a student sees their own excuse requests', mine.length > 0 && mine.every((x) => x.studentId === student.studentId));
  const dwayt = attendance.filter((r) => r.studentId === 'PPY-0081');
  console.log(`dwayt.v has ${dwayt.length} attendance records`);
  console.log(`\n${fails} failures`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
