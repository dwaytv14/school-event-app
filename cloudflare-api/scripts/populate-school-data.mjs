// Fills the school app with a realistic school year by using the real API: organizers create events, the admin
// approves / rejects / cancels / moves them, organizers record attendance, students
// ask to be excused, and updates are posted.
//
// Usage (PowerShell, from the cloudflare-api folder):
//   $env:ADMIN_PASSWORD = "your admin password"
//   $env:ORGANIZER_PASSWORD = "the shared password of PPYorganizer1 to 5"
//   node scripts/populate-school-data.mjs
//
// Optional: API (default: the hosted API), ADMIN_USER (default PPY-ADMIN),
// STUDENT_PASSWORD (default student123, the password of the test students).
// It only signs in with real accounts; it never touches the database directly.
// Events that already exist are left alone, so it is safe to run twice.
const API = (process.env.API ?? 'https://gather-school-api.gather-school-api.workers.dev/api').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER ?? 'PPY-ADMIN';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ORGANIZER_PASSWORD = process.env.ORGANIZER_PASSWORD;
const STUDENT_PASSWORD = process.env.STUDENT_PASSWORD ?? 'student123';
if (!ADMIN_PASSWORD || !ORGANIZER_PASSWORD) {
  console.error('Set ADMIN_PASSWORD and ORGANIZER_PASSWORD (the shared password of PPYorganizer1 to 5) first.');
  process.exit(1);
}

// ---------------------------------------------------------------- helpers
let seed = 2026;
const rng = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (list) => list[Math.floor(rng() * list.length)];
const between = (min, max) => min + Math.floor(rng() * (max - min + 1));
const log = (...args) => console.log(...args);

async function call(method, path, token, body) {
  const response = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await response.json(); } catch { data = null; }
  return { status: response.status, data };
}
const must = (result, what) => { if (result.status >= 300) throw new Error(`${what} failed (HTTP ${result.status}): ${JSON.stringify(result.data)}`); return result.data; };


const iso = (date, time) => new Date(`${date}T${time}:00+08:00`).toISOString();
const addMinutes = (value, minutes) => new Date(new Date(value).getTime() + minutes * 60000).toISOString();
const dayLabel = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

async function login(username, password) { return must(await call('POST', '/auth/login', null, { username, password }), `login ${username}`); }

// Reads the workspace, lets `change` edit it, and saves it (retrying if it moved).
async function edit(token, change, what) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = must(await call('GET', '/workspace', token), `read workspace for ${what}`);
    const next = structuredClone(current.state);
    change(next);
    const saved = await call('PUT', '/workspace', token, { revision: current.revision, state: next });
    if (saved.status === 200) return next;
    if (saved.status !== 409) throw new Error(`${what} failed (HTTP ${saved.status}): ${JSON.stringify(saved.data)}`);
  }
  throw new Error(`${what}: the workspace kept changing`);
}

// ---------------------------------------------------------------- the school year
const sectionsAll = must(await call('GET', '/sections'), 'sections').sections;
const group = (predicate) => sectionsAll.filter(predicate).map((section) => section.id);
const ALL = group(() => true);
const YEAR = (...years) => group((s) => years.includes(s.yearLevel));
const COURSE = (...courses) => group((s) => courses.includes(s.course));
const BOTH = (courses, years) => group((s) => courses.includes(s.course) && years.includes(s.yearLevel));
const label = (id) => { const s = sectionsAll.find((x) => x.id === id); return `${s.course} ${s.yearLevel} ${s.name}`; };

const EVENTS = [
  // ---- already happened (approved, with attendance) ----
  { id: 'EVT-20260821-freshmen-orientation', name: 'Freshmen Orientation and Campus Tour', date: '2026-08-21', start: '08:00', end: '11:30', venue: 'Gymnasium', by: 'PPYorganizer2', groups: YEAR('1st Year'), rows: [[6, 10], [6, 10]], rate: 0.97, late: 0.08, scanners: ['PPYorganizer2', 'PPYorganizer5'],
    desc: 'Welcome program for incoming freshmen: introduction to the college officers, the student handbook, and a guided tour of the campus facilities.' },
  { id: 'EVT-20260828-intramurals-opening', name: 'Intramurals 2026 Opening Program', date: '2026-08-28', start: '13:00', end: '17:00', venue: 'Gymnasium', by: 'PPYorganizer1', groups: ALL, rows: [[10, 10], [10, 10]], rate: 0.91, late: 0.14, scanners: ['PPYorganizer1', 'PPYorganizer3'],
    desc: 'Parade of colleges, presentation of the team muses, opening remarks, and the lighting of the torch.' },
  { id: 'EVT-20260911-nutrition-seminar', name: 'Nutrition Month Seminar', date: '2026-09-11', start: '09:00', end: '12:00', venue: 'Conference room', by: 'PPYorganizer3', groups: COURSE('BSED', 'BEED'), rows: [[8, 10], [8, 10]], rate: 0.86, late: 0.11, scanners: ['PPYorganizer3'],
    desc: 'A talk on healthy eating habits for students and future teachers, with a school-feeding program demonstration.' },
  { id: 'EVT-20260918-cybersecurity-talk', name: 'Cybersecurity Awareness Talk', date: '2026-09-18', start: '13:30', end: '16:30', venue: 'Conference room', by: 'PPYorganizer4', groups: COURSE('BSIT'), rows: [[6, 10]], rate: 0.89, late: 0.10, scanners: ['PPYorganizer4'],
    desc: 'Guest speaker from the provincial ICT office on phishing, password hygiene, and safe use of social media.' },
  { id: 'EVT-20260925-leadership-training', name: 'Leadership Training for Student Leaders', date: '2026-09-25', start: '08:00', end: '16:00', venue: 'Gymnasium', by: 'PPYorganizer5', groups: YEAR('3rd Year', '4th Year'), rows: [[8, 10], [8, 10]], rate: 0.94, late: 0.07, scanners: ['PPYorganizer5', 'PPYorganizer2'],
    desc: 'Full-day workshop on leadership, project management, and parliamentary procedure for class officers and organization leaders.' },
  { id: 'EVT-20261009-mental-health-forum', name: 'Mental Health Awareness Forum', date: '2026-10-09', start: '09:00', end: '11:30', venue: 'Gymnasium', by: 'PPYorganizer2', groups: ALL, rows: [[10, 10], [10, 10]], rate: 0.88, late: 0.12, scanners: ['PPYorganizer2', 'PPYorganizer4'],
    desc: 'Open forum with the guidance office and a licensed psychologist on stress, study habits, and where to find support on campus.' },
  { id: 'EVT-20261016-ojt-orientation', name: 'OJT Orientation and Career Talk', date: '2026-10-16', start: '13:00', end: '16:00', venue: 'Conference room', by: 'PPYorganizer1', groups: BOTH(['BSIT', 'BSBA'], ['3rd Year']), rows: [[6, 10]], rate: 0.93, late: 0.09, scanners: ['PPYorganizer1'],
    desc: 'Requirements, partner companies, and expectations for the on-the-job training of third year students.' },
  { id: 'EVT-20261023-research-colloquium', name: 'Research Colloquium', date: '2026-10-23', start: '08:30', end: '16:00', venue: 'Conference room', by: 'PPYorganizer3', groups: YEAR('4th Year'), rows: [[6, 10], [6, 10]], rate: 0.96, late: 0.06, scanners: ['PPYorganizer3', 'PPYorganizer1'],
    desc: 'Oral presentation of the capstone and thesis defenses of graduating students before the college panel.' },
  { id: 'EVT-20261030-blood-donation', name: 'Blood Donation Drive', date: '2026-10-30', start: '08:00', end: '15:00', venue: 'Gymnasium', by: 'PPYorganizer4', groups: ALL, rows: [[8, 10]], rate: 0.72, late: 0.18, scanners: ['PPYorganizer4', 'PPYorganizer5'],
    desc: 'Bloodletting activity with the Philippine Red Cross. Students who cannot donate are still expected to assist and support their classmates.' },
  { id: 'EVT-20261106-environmental-seminar', name: 'Environmental Awareness Seminar', date: '2026-11-06', start: '09:00', end: '12:00', venue: 'Gymnasium', by: 'PPYorganizer5', groups: BOTH(['BSED', 'BEED'], ['1st Year', '2nd Year']), rows: [[8, 10]], rate: 0.9, late: 0.1, scanners: ['PPYorganizer5'],
    desc: 'Seminar on waste segregation and climate action, with a tree-planting pledge signing.' },
  { id: 'EVT-20261113-academic-convocation', name: 'College Academic Convocation', date: '2026-11-13', start: '08:00', end: '11:30', venue: 'Gymnasium', by: 'PPYorganizer1', groups: ALL, rows: [[10, 10], [10, 10]], rate: 0.95, late: 0.09, scanners: ['PPYorganizer1', 'PPYorganizer2'],
    desc: 'Recognition of academic achievers, the dean\'s message, and the presentation of this semester\'s activities.' },
  // ---- cancelled because of the weather ----
  { id: 'EVT-20261112-sports-fest-finals', name: 'Sports Fest Finals', date: '2026-11-12', start: '13:00', end: '17:00', venue: 'Gymnasium', by: 'PPYorganizer1', groups: ALL, rows: [[10, 10], [10, 10]], cancel: 'Typhoon signal no. 2 was raised over Nueva Ecija, so all activities were suspended. A new schedule will be announced.' },
  // ---- coming up ----
  { id: 'EVT-20261120-student-council-assembly', name: 'Student Council General Assembly', date: '2026-11-20', start: '13:00', end: '16:00', venue: 'Gymnasium', by: 'PPYorganizer2', groups: ALL, rows: [[10, 10], [10, 10]],
    desc: 'Report of the student council on projects and finances, and the open forum for student concerns.' },
  { id: 'EVT-20261127-christmas-lighting', name: 'Christmas Tree Lighting and Caroling', date: '2026-11-27', start: '17:00', end: '20:00', venue: 'Gymnasium', by: 'PPYorganizer5', groups: ALL, rows: [[10, 10], [10, 10]],
    desc: 'Caroling contest among the courses and the lighting of the campus Christmas tree.' },
  { id: 'EVT-20261204-scholarship-info', name: 'Scholarship and Financial Assistance Briefing', date: '2026-12-04', start: '09:00', end: '11:00', venue: 'Conference room', by: 'admin', groups: ALL, rows: [[8, 10], [8, 10]],
    desc: 'Information session on the CHED scholarships, the tertiary education subsidy, and the college financial assistance program.' },
  { id: 'EVT-20261205-alumni-homecoming', name: 'Alumni Homecoming', date: '2026-12-05', start: '08:00', end: '12:00', venue: 'Gymnasium', by: 'admin', groups: ALL, rows: [[10, 10], [10, 10]], moveTo: { date: '2026-12-12', start: '14:00', end: '18:00', reason: 'The venue is reserved for the provincial examination on December 5.' },
    desc: 'Reunion of graduates with the faculty and the current students, with a short program and a fellowship meal.' },
  { id: 'EVT-20261217-outreach-feeding', name: 'Outreach Program: Feeding Activity', date: '2026-12-17', start: '08:00', end: '12:00', venue: 'Gymnasium', by: 'PPYorganizer5', groups: COURSE('BEED', 'BSED'), rows: [[6, 10]], rejectFirst: { reason: 'December 15 conflicts with the Christmas Party preparations. Please move it to December 17 or later.', original: '2026-12-15' },
    desc: 'Community feeding activity for the children of Barangay Papaya, organized by the education students.' },
  { id: 'EVT-20261218-christmas-party', name: 'Christmas Party and Awarding', date: '2026-12-18', start: '09:00', end: '15:00', venue: 'Gymnasium', by: 'PPYorganizer1', groups: ALL, rows: [[10, 10], [10, 10]],
    desc: 'Christmas program, exchange gifts per section, and the awarding of the semester\'s outstanding students.' },
  { id: 'EVT-20270112-enrollment-orientation', name: 'Second Semester Enrollment Orientation', date: '2027-01-12', start: '09:00', end: '11:00', venue: 'Conference room', by: 'admin', groups: ALL, rows: [[8, 10], [8, 10]],
    desc: 'Enrollment schedule, advising procedure, and the requirements for the second semester.' },
  // ---- waiting for the admin ----
  { id: 'EVT-20261208-programming-contest', name: 'Intercollegiate Programming Contest 2026', date: '2026-12-08', start: '08:00', end: '16:00', venue: 'Conference room', by: 'PPYorganizer4', groups: COURSE('BSIT'), rows: [[6, 10]], pending: true,
    desc: 'Team-based programming contest for BSIT students, with prizes from our industry partners.' },
  { id: 'EVT-20261210-entrepreneurship-bazaar', name: 'Entrepreneurship Bazaar', date: '2026-12-10', start: '09:00', end: '17:00', venue: 'Gymnasium', by: 'PPYorganizer3', groups: COURSE('BSBA'), rows: [[8, 10]], pending: true,
    desc: 'Student-run booths showcasing business plans and products made in the entrepreneurship classes.' },
  // ---- turned down and left as is ----
  { id: 'EVT-20261119-film-showing', name: 'Film Showing: Philippine Cinema Night', date: '2026-11-19', start: '17:30', end: '20:00', venue: 'Conference room', by: 'PPYorganizer2', groups: COURSE('BSED', 'BEED', 'BSBA'), rows: [[6, 10]], rejected: 'This overlaps with the General Assembly preparations on November 19. Please choose another date.',
    desc: 'Screening of two Filipino films followed by a short discussion led by the English faculty.' },
];

const ANNOUNCEMENTS = [
  { at: '2026-08-19T09:10', by: 'admin', title: 'Welcome to the new school year', body: 'Welcome back, students! Classes for the first semester start on Monday, August 24. Please check your section and schedule at the registrar\'s office.', audience: { type: 'all' } },
  { at: '2026-08-26T16:30', by: 'PPYorganizer1', title: 'Intramurals: reminders', body: 'The Intramurals opening is this Friday at 1:00 PM at the Gymnasium. Wear your team shirt and bring your own water bottle.', audience: { type: 'all' } },
  { at: '2026-09-08T10:00', by: 'PPYorganizer3', title: 'Nutrition Month Seminar', body: 'BSED and BEED students: the seminar is on September 11, 9:00 AM at the Conference room. Please wear your PE uniform.', audience: { type: 'sections', of: COURSE('BSED', 'BEED') } },
  { at: '2026-10-05T14:15', by: 'admin', title: 'Midterm examination schedule', body: 'The midterm examinations are from October 19 to 23. The final schedule per subject is posted on the bulletin board of each department.', audience: { type: 'all' } },
  { at: '2026-10-14T11:20', by: 'PPYorganizer1', title: 'OJT Orientation for 3rd year BSIT and BSBA', body: 'The OJT orientation is on October 16 at 1:00 PM at the Conference room. Attendance is required. Bring a pen and your résumé draft.', audience: { type: 'sections', of: BOTH(['BSIT', 'BSBA'], ['3rd Year']) } },
  { at: '2026-11-10T15:45', by: 'admin', title: 'Academic Convocation: dress code', body: 'The convocation is on Friday, November 13 at 8:00 AM. Wear your complete uniform and bring your school ID. Students without ID will not be allowed inside the Gymnasium.', audience: { type: 'all' } },
  { at: '2026-11-16T09:05', by: 'admin', title: 'Scholarship application deadline', body: 'The deadline for scholarship applications is on November 27. Submit your requirements at the guidance office. See the briefing on December 4.', audience: { type: 'all' } },
  { at: '2026-11-17T08:40', by: 'PPYorganizer2', title: 'General Assembly on November 20', body: 'The Student Council General Assembly is on Friday, 1:00 PM at the Gymnasium. Attendance is required for all students. Class presidents, please remind your classmates.', audience: { type: 'all' } },
];

const EXCUSE_REASONS = [
  'Nagkaroon po ako ng lagnat at pinayuhan ng doktor na magpahinga ng dalawang araw.',
  'I had a scheduled medical check-up that morning at the Rural Health Unit.',
  'Namatayan po kami ng lolo kaya umuwi ako sa probinsya para sa burol.',
  'My mother was admitted to the hospital and I had to stay with her.',
  'Binaha po ang daan sa aming barangay at walang masakyang jeep papunta sa campus.',
  'I was a delegate of the college to the regional athletics meet on that date.',
  'May schedule po ako ng bakuna sa health center ng aming bayan ngayong araw.',
  'I was sick with a stomach flu and could not leave the house.',
];
const REJECT_NOTES = ['Please attach a medical certificate and ask again.', 'This reason is not covered by the excuse policy.', 'No supporting document was provided.'];

// ---------------------------------------------------------------- run
const summary = {};
try {
  const admin = (await login(ADMIN_USER, ADMIN_PASSWORD)).token;
  const organizers = {};
  for (let n = 1; n <= 5; n += 1) organizers[`PPYorganizer${n}`] = (await login(`PPYorganizer${n}`, ORGANIZER_PASSWORD)).token;
  const tokenFor = (name) => (name === 'admin' ? admin : organizers[name]);
  log('signed in as the admin and 5 organizers');

  const before = must(await call('GET', '/workspace', admin), 'read workspace').state;
  const existingIds = new Set(before.events.map((event) => event.id));
  const dwayt = before.students.find((student) => student.id === 'PPY-0081');
  const seatsFor = (id, blocks) => { const seats = []; blocks.forEach(([rows, per], block) => { for (let i = 0; i < rows * per; i += 1) seats.push({ id: `${id}-shared-${seats.length + 1}`, block, section: 'Shared seating', row: Math.floor(i / per) + 1, number: (i % per) + 1, studentId: null }); }); return seats; };
  const toEvent = (spec, status) => ({
    id: spec.id, name: spec.name, date: spec.rejectFirst ? spec.rejectFirst.original : spec.date, startTime: spec.start, endTime: spec.end, venue: spec.venue,
    description: spec.desc, graceMinutes: 15, sections: spec.groups.map(label), seats: seatsFor(spec.id, spec.rows), requiredSections: spec.groups,
    seatingPlan: { gymnasiumBenchGroups: [], sharedSeatCount: spec.rows.reduce((n, [r, p]) => n + r * p, 0), rows: spec.rows[0][0], seatsPerRow: spec.rows[0][1], blocks: spec.rows.map(([rows, seatsPerRow]) => ({ rows, seatsPerRow })), sharedSectionIds: spec.groups, sectionSeatCounts: {} },
    approvalStatus: status,
  });

  // 1. organizers create their events (pending); the admin creates hers directly
  const fresh = EVENTS.filter((spec) => !existingIds.has(spec.id));
  for (const by of ['admin', ...Object.keys(organizers)]) {
    const mine = fresh.filter((spec) => spec.by === by);
    if (!mine.length) continue;
    await edit(tokenFor(by), (state) => { for (const spec of mine) state.events.push(toEvent(spec, by === 'admin' ? 'approved' : 'pending')); }, `${by} creates events`);
    log(`${by}: created ${mine.length} event(s)`);
  }

  // 2. the admin reviews what is waiting
  await edit(admin, (state) => {
    for (const spec of fresh.filter((s) => s.by !== 'admin' && !s.pending)) {
      const event = state.events.find((item) => item.id === spec.id);
      if (spec.rejected) { event.approvalStatus = 'rejected'; event.rejectionReason = spec.rejected; }
      else if (spec.rejectFirst) { event.approvalStatus = 'rejected'; event.rejectionReason = spec.rejectFirst.reason; }
      else event.approvalStatus = 'approved';
    }
  }, 'admin reviews events');
  log('admin approved, rejected, and left some pending');

  // 3. the organizer fixes a rejected event and sends it again
  for (const spec of fresh.filter((s) => s.rejectFirst)) {
    await edit(tokenFor(spec.by), (state) => {
      const event = state.events.find((item) => item.id === spec.id);
      event.date = spec.date; event.approvalStatus = 'pending'; event.resubmittedAt = new Date().toISOString(); delete event.rejectionReason;
    }, `${spec.by} resubmits`);
    await edit(admin, (state) => { state.events.find((item) => item.id === spec.id).approvalStatus = 'approved'; }, 'admin approves the resubmission');
    log(`${spec.name}: rejected, edited by the organizer, approved`);
  }

  // 4. cancel one event, move another, and tell the students
  const announcements = [];
  for (const spec of fresh.filter((s) => s.cancel)) {
    await edit(admin, (state) => { const event = state.events.find((item) => item.id === spec.id); event.cancelled = true; event.cancelReason = spec.cancel; }, 'admin cancels');
    announcements.push({ at: '2026-11-11T19:20', by: 'admin', title: `Cancelled: ${spec.name}`, body: `${spec.name} on ${dayLabel(spec.date)} has been cancelled. ${spec.cancel}`, audience: { type: 'all' } });
  }
  for (const spec of fresh.filter((s) => s.moveTo)) {
    await edit(admin, (state) => { const event = state.events.find((item) => item.id === spec.id); event.postponedFrom = { date: spec.date, startTime: spec.start, endTime: spec.end }; event.date = spec.moveTo.date; event.startTime = spec.moveTo.start; event.endTime = spec.moveTo.end; }, 'admin moves an event');
    announcements.push({ at: '2026-11-16T13:00', by: 'admin', title: `Moved: ${spec.name}`, body: `${spec.name} is moved from ${dayLabel(spec.date)} ${spec.start} to ${dayLabel(spec.moveTo.date)} ${spec.moveTo.start}–${spec.moveTo.end}. ${spec.moveTo.reason}`, audience: { type: 'all' } });
  }
  log('one event cancelled, one moved');

  // 5. attendance for everything that already happened
  const state1 = must(await call('GET', '/workspace', admin), 'read workspace').state;
  const students = state1.students;
  const past = fresh.filter((spec) => spec.rate && spec.date < '2026-11-17');
  const toIso = (spec, time) => iso(spec.date, time);
  let totalRecords = 0;
  for (const spec of past) {
    const event = state1.events.find((item) => item.id === spec.id);
    const roster = students.filter((s) => spec.groups.includes(s.sectionId)).sort((a, b) => a.name.localeCompare(b.name));
    const start = toIso(spec, spec.start); const end = toIso(spec, spec.end);
    const records = [];
    roster.forEach((student, index) => {
      const mustAttend = student.id === 'PPY-0081';
      if (!mustAttend && rng() > spec.rate) return; // absent
      const late = !mustAttend && rng() < spec.late;
      const timeIn = late ? addMinutes(start, 15 + between(4, 40)) : addMinutes(start, -between(1, 22));
      let timeOut = addMinutes(end, -between(0, 14));
      const roll = rng();
      if (roll < 0.04) timeOut = null; else if (roll < 0.14) timeOut = addMinutes(end, -between(25, 80));
      const duration = timeOut ? Math.max(0, Math.round((new Date(timeOut) - new Date(timeIn)) / 60000)) : null;
      const manual = rng() < 0.03;
      records.push({ roster: index, record: { id: `ATT-${spec.id.slice(4, 12)}-${student.id.slice(4)}`, eventId: spec.id, studentId: student.id, timeIn, timeOut, durationMinutes: duration, status: !timeOut ? 'Incomplete' : late ? 'Late' : 'Present', syncStatus: 'Synced', ...(manual ? { manual: true } : {}) } });
    });
    // two check-in tables: each organizer scans half of the line
    const cut = Math.ceil(roster.length / 2);
    for (const [i, scanner] of spec.scanners.entries()) {
      const slice = records.filter((r) => (spec.scanners.length === 1 ? true : i === 0 ? r.roster < cut : r.roster >= cut)).map((r) => r.record);
      if (!slice.length) continue;
      await edit(tokenFor(scanner), (state) => { const known = new Set(state.attendance.map((a) => a.id)); for (const record of slice) if (!known.has(record.id)) state.attendance.push(record); }, `${scanner} records attendance`);
      totalRecords += slice.length;
    }
    summary[spec.name] = { required: roster.length, recorded: records.length };
    log(`${spec.name}: ${records.length} of ${roster.length} recorded`);
  }

  // 6. students who missed an event ask to be excused; the admin answers most of them
  const afterAttendance = must(await call('GET', '/workspace', admin), 'read workspace').state;
  const sessions = new Map();
  const studentToken = async (username) => { if (!sessions.has(username)) sessions.set(username, (await login(username, STUDENT_PASSWORD)).token); return sessions.get(username); };
  const accounts = must(await call('GET', '/accounts', admin), 'accounts').accounts;
  const usernameOf = Object.fromEntries(accounts.filter((a) => a.studentId).map((a) => [a.studentId, a.username]));
  let asked = 0, approved = 0, rejected = 0, waiting = 0;
  for (const spec of past) {
    const attended = new Set(afterAttendance.attendance.filter((a) => a.eventId === spec.id).map((a) => a.studentId));
    const absent = students.filter((s) => spec.groups.includes(s.sectionId) && !attended.has(s.id) && s.id !== 'PPY-0081' && usernameOf[s.id]);
    const count = Math.min(absent.length, Math.max(1, Math.round(absent.length * 0.3)));
    for (const student of absent.slice(0, count)) {
      const token = await studentToken(usernameOf[student.id]);
      const request = await call('POST', '/excuses', token, { eventId: spec.id, reason: pick(EXCUSE_REASONS), photo: null });
      if (request.status !== 201) continue;
      asked += 1;
      const recent = spec.date >= '2026-11-01';
      const outcome = rng();
      if (recent && outcome < 0.5) { waiting += 1; continue; } // left for the admin to review
      if (outcome < 0.75) { must(await call('POST', `/excuses/${request.data.id}/review`, admin, { decision: 'approved', note: '' }), 'approve excuse'); approved += 1; }
      else { must(await call('POST', `/excuses/${request.data.id}/review`, admin, { decision: 'rejected', note: pick(REJECT_NOTES) }), 'reject excuse'); rejected += 1; }
    }
  }
  log(`excuse requests: ${asked} sent, ${approved} approved, ${rejected} rejected, ${waiting} waiting`);

  // 7. announcements (oldest first, newest on top)
  const all = [...ANNOUNCEMENTS, ...announcements].map((a, i) => ({ ...a, audience: a.audience.type === 'sections' ? { type: 'sections', sectionIds: a.audience.of } : a.audience, createdAt: new Date(`${a.at}:00+08:00`).toISOString(), id: `ANN-${new Date(`${a.at}:00+08:00`).getTime() + i}` }));
  for (const by of ['admin', ...Object.keys(organizers)]) {
    const mine = all.filter((a) => a.by === by);
    if (!mine.length) continue;
    await edit(tokenFor(by), (state) => { const known = new Set(state.announcements.map((a) => a.id)); for (const a of mine) if (!known.has(a.id)) state.announcements.push({ id: a.id, title: a.title, body: a.body, createdAt: a.createdAt, audience: a.audience }); state.announcements.sort((x, y) => y.createdAt.localeCompare(x.createdAt)); }, `${by} posts updates`);
  }
  log(`${all.length} updates posted`);
  log('TOTAL attendance records written by organizers:', totalRecords);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
