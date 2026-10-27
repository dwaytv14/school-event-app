const WORKSPACE_KEYS = [
  'students',
  'events',
  'attendance',
  'violations',
  'messages',
  'syncItems',
  'announcements',
];
const COURSES = ['BSIT', 'BSBA', 'BSED', 'BEED'];
const YEAR_LEVELS = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
const PASSWORD_HASH_ITERATIONS = 100_000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function emptyWorkspace() {
  return Object.fromEntries(WORKSPACE_KEYS.map((key) => [key, []]));
}

function validWorkspaceState(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    WORKSPACE_KEYS.every((key) => Array.isArray(value[key]))
  );
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_HASH_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2-sha256$${PASSWORD_HASH_ITERATIONS}$${base64Url(salt)}$${base64Url(new Uint8Array(derived))}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [algorithm, iterationsText, saltText, expectedText] = stored.split('$');
  if (
    algorithm !== 'pbkdf2-sha256' ||
    iterationsText !== String(PASSWORD_HASH_ITERATIONS)
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-256',
        salt: decodeBase64Url(saltText),
        iterations: Number(iterationsText),
      },
      key,
      256,
    ),
  );
  const expected = decodeBase64Url(expectedText);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

async function signToken(payload, secret) {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(unsigned),
  );
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  return typeof payload.exp === 'number' && payload.exp > Date.now() / 1000
    ? payload
    : null;
}

async function issueToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  return signToken(
    {
      sub: user.id,
      username: user.username,
      organizationId: user.organization_id,
      role: user.role,
      studentId: user.student_id,
      authVersion: user.auth_version ?? 0,
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
    },
    secret,
  );
}

function authUser(claims) {
  return {
    id: claims.id ?? claims.sub,
    username: claims.username,
    organizationId: claims.organizationId ?? claims.organization_id,
    role: claims.role,
    studentId: claims.studentId ?? claims.student_id ?? null,
  };
}

function validUsername(username) {
  return typeof username === 'string' && /^[a-z0-9._-]{3,64}$/i.test(username.trim());
}

function validPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.CLIENT_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (!origin || allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  return headers;
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 2 * 1024 * 1024) {
    throw json({ error: 'Request body is too large.' }, 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2 * 1024 * 1024) {
    throw json({ error: 'Request body is too large.' }, 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw json({ error: 'Request body must be valid JSON.' }, 400);
  }
}

async function requireUser(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return { error: json({ error: 'Sign in to continue.' }, 401) };
  }
  const token = authorization.slice(7);
  if (token.length > 4096) {
    return { error: json({ error: 'The session token is invalid.' }, 401) };
  }
  let claims;
  try {
    claims = await verifyToken(token, env.JWT_SECRET);
  } catch {
    return { error: json({ error: 'The session could not be verified.' }, 401) };
  }
  if (!claims?.sub || !claims.organizationId || !claims.role) {
    return { error: json({ error: 'Your session expired. Please sign in again.' }, 401) };
  }
  const row = await env.DB.prepare(
    `SELECT id, username, organization_id, role, student_id, auth_version
     FROM users WHERE id = ?`,
  )
    .bind(claims.sub)
    .first();
  if (!row) {
    return { error: json({ error: 'Your account is no longer available.' }, 401) };
  }
  if (
    row.organization_id !== claims.organizationId ||
    row.role !== claims.role ||
    (row.student_id ?? null) !== (claims.studentId ?? null) ||
    row.auth_version !== (claims.authVersion ?? 0)
  ) {
    return { error: json({ error: 'Your session has changed. Please sign in again.' }, 401) };
  }
  return { user: row };
}

function normalizedMobile(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^09\d{9}$/.test(trimmed)) return `+63${trimmed.slice(1)}`;
  if (/^\+639\d{9}$/.test(trimmed)) return trimmed;
  return null;
}

function sectionLabel(course, yearLevel, sectionName) {
  return `${course} ${yearLevel} ${sectionName}`;
}

function addStudentToEvent(event, student) {
  if (!(event.requiredSections ?? []).includes(student.sectionId)) return;
  if (!Array.isArray(event.sections)) event.sections = [];
  if (!event.sections.includes(student.section)) event.sections.push(student.section);
  if (!Array.isArray(event.seats)) event.seats = [];
  if (event.seats.some((seat) => seat.studentId === student.id)) return;

  const sectionSeats = event.seats.filter(
    (seat) => seat.section === student.section,
  );
  const availableSeat = sectionSeats.find((seat) => !seat.studentId);
  if (availableSeat) {
    availableSeat.studentId = student.id;
    return;
  }
  const sectionSlug = student.section.replaceAll(' ', '-').toLowerCase();
  if (sectionSeats.length === 0) {
    event.seats.push(
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `${event.id}-${sectionSlug}-${index + 1}`,
        section: student.section,
        row: Math.floor(index / 6) + 1,
        number: (index % 6) + 1,
        studentId: index === 0 ? student.id : null,
      })),
    );
    return;
  }
  const seatCount = sectionSeats.length;
  event.seats.push({
    id: `${event.id}-${sectionSlug}-${seatCount + 1}`,
    section: student.section,
    row: Math.floor(seatCount / 6) + 1,
    number: (seatCount % 6) + 1,
    studentId: student.id,
  });
}

async function registerStudent(body, env) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const course = typeof body?.course === 'string' ? body.course : '';
  const yearLevel = typeof body?.yearLevel === 'string' ? body.yearLevel : '';
  const sectionId = typeof body?.sectionId === 'string' ? body.sectionId : '';
  const mobile = normalizedMobile(body?.mobile);
  if (!validUsername(username)) {
    return json(
      { error: 'Username must be 3–64 characters: letters, numbers, dots, dashes, or underscores.' },
      400,
    );
  }
  if (!validPassword(password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }
  if (!name || name.length > 120) {
    return json({ error: 'Enter a full name of up to 120 characters.' }, 400);
  }
  if (!COURSES.includes(course) || !YEAR_LEVELS.includes(yearLevel) || !sectionId) {
    return json({ error: 'Select a course, year level, and section.' }, 400);
  }
  if (!mobile) {
    return json({ error: 'Enter a valid Philippine mobile number, such as 09XXXXXXXXX.' }, 400);
  }

  const organization = await env.DB.prepare(
    'SELECT id FROM organizations ORDER BY created_at LIMIT 1',
  ).first();
  if (!organization) {
    return json({ error: 'The school is not set up yet. Ask the super admin to initialize it.' }, 503);
  }
  const section = await env.DB.prepare(
    `SELECT id, course, year_level, name FROM sections
     WHERE id = ? AND organization_id = ?`,
  )
    .bind(sectionId, organization.id)
    .first();
  if (
    !section ||
    section.course !== course ||
    section.year_level !== yearLevel
  ) {
    return json({ error: 'Choose a section that belongs to the selected course and year.' }, 400);
  }
  const userId = crypto.randomUUID();
  const studentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const student = {
    id: studentId,
    name,
    course,
    yearLevel,
    sectionId,
    section: sectionLabel(course, yearLevel, section.name),
    mobile,
  };
  let inserted = false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const workspace = await env.DB.prepare(
        'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
      )
        .bind(organization.id)
        .first();
      if (!workspace) return json({ error: 'The school workspace was not found.' }, 503);
      let state;
      try {
        state = JSON.parse(workspace.state_json);
      } catch {
        return json({ error: 'The saved school workspace is invalid.' }, 500);
      }
      if (!Array.isArray(state.students) || !Array.isArray(state.events)) {
        return json({ error: 'The saved school workspace is invalid.' }, 500);
      }
      state.announcements ??= [];
      state.students.push(student);
      state.events.forEach((event) => addStudentToEvent(event, student));
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE workspace_state
           SET revision = revision + 1, state_json = ?, updated_at = ?
           WHERE organization_id = ? AND revision = ?`,
        ).bind(
          JSON.stringify(state),
          now,
          organization.id,
          workspace.revision,
        ),
        env.DB.prepare(
          `INSERT INTO users
            (id, organization_id, username, password_hash, role, student_id, created_at)
           SELECT ?, ?, ?, ?, 'student', ?, ?
           WHERE changes() = 1`,
        ).bind(userId, organization.id, username, passwordHash, studentId, now),
      ]);
      if (results[0]?.meta?.changes === 1) {
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      return json({ error: 'The workspace changed during signup. Please try again.' }, 409);
    }
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed: users.username')) {
      return json({ error: 'That username is already registered.' }, 409);
    }
    if (error?.message?.includes('users.organization_id, users.student_id')) {
      return json({ error: 'A student account already exists for this profile.' }, 409);
    }
    console.error('Student registration failed:', error);
    return json({ error: 'The student account and profile could not be created.' }, 500);
  }
  const user = await env.DB.prepare(
    'SELECT id, username, organization_id, role, student_id, auth_version FROM users WHERE id = ?',
  )
    .bind(userId)
    .first();
  if (!user) {
    return json({ error: 'The new student account could not be loaded.' }, 500);
  }
  return json(
    { token: await issueToken(user, env.JWT_SECRET), ...authUser(user) },
    201,
  );
}

async function login(body, env) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!validUsername(username)) {
    return json({ error: 'Enter a valid username.' }, 400);
  }
  if (!validPassword(password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }
  const user = await env.DB.prepare(
    `SELECT id, username, organization_id, role, student_id, auth_version, password_hash
     FROM users WHERE username = ? COLLATE NOCASE`,
  )
    .bind(username)
    .first();
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return json({ error: 'Username or password is incorrect.' }, 401);
  }
  return json({ token: await issueToken(user, env.JWT_SECRET), ...authUser(user) });
}

async function listAccounts(user, env) {
  const { results } = await env.DB.prepare(
    `SELECT username, role, student_id AS studentId, created_at AS createdAt
     FROM users WHERE organization_id = ? ORDER BY username COLLATE NOCASE`,
  )
    .bind(user.organization_id)
    .all();
  return json({ accounts: results });
}

async function createAccount(request, user, env) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can create organizer accounts.' }, 403);
  }
  const body = await readJson(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!validUsername(username)) {
    return json({ error: 'Enter a username using 3–64 letters, numbers, dots, dashes, or underscores.' }, 400);
  }
  if (!validPassword(password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }
  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, organization_id, username, password_hash, role, student_id, created_at)
       VALUES (?, ?, ?, ?, 'organizer', NULL, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.organization_id,
        username,
        await hashPassword(password),
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed: users.username')) {
      return json({ error: 'That username is already registered.' }, 409);
    }
    console.error('Account creation failed:', error);
    return json({ error: 'The account could not be created.' }, 500);
  }
  return json({ username, role: 'organizer', studentId: null }, 201);
}

async function resetAccountPassword(request, user, env, username) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can reset account passwords.' }, 403);
  }
  const body = await readJson(request);
  if (!validPassword(body?.password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }
  const result = await env.DB.prepare(
    `UPDATE users SET password_hash = ?, auth_version = auth_version + 1
     WHERE organization_id = ? AND username = ? COLLATE NOCASE`,
  )
    .bind(await hashPassword(body.password), user.organization_id, username)
    .run();
  if (result.meta.changes === 0) {
    return json({ error: 'That account was not found in this school.' }, 404);
  }
  return json({ username, passwordReset: true });
}

function studentWorkspace(state, studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return emptyWorkspace();
  return {
    students: [student],
    events: state.events
      .filter((event) => event.approvalStatus === 'approved')
      .map((event) => ({
        ...event,
        seats: Array.isArray(event.seats)
          ? event.seats.filter((seat) => seat.studentId === studentId)
          : [],
      })),
    attendance: [],
    violations: [],
    messages: [],
    syncItems: [],
    announcements: Array.isArray(state.announcements)
      ? state.announcements.filter((announcement) =>
          announcementVisibleToStudent(announcement, student),
        )
      : [],
  };
}

function announcementVisibleToStudent(announcement, student) {
  const audience = announcement?.audience;
  if (!audience || audience.type === 'all') return true;
  if (audience.type === 'course') {
    return (
      typeof audience.course === 'string' &&
      student.course === audience.course
    );
  }
  if (audience.type === 'sections') {
    return (
      Array.isArray(audience.sectionIds) &&
      typeof student.sectionId === 'string' &&
      audience.sectionIds.includes(student.sectionId)
    );
  }
  return false;
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function validateOrganizerWorkspace(state, nextState, user, env) {
  if (
    !sameJson(state.students, nextState.students) ||
    !sameJson(state.announcements ?? [], nextState.announcements ?? [])
  ) {
    return 'Organizers cannot change student profiles or announcements.';
  }
  const previousEvents = new Map(state.events.map((event) => [event.id, event]));
  const nextEvents = new Map(nextState.events.map((event) => [event.id, event]));
  if (nextEvents.size !== nextState.events.length || previousEvents.size !== state.events.length) {
    return 'The event list contains duplicate identifiers.';
  }
  for (const [id, event] of previousEvents) {
    const submitted = nextEvents.get(id);
    if (
      !submitted ||
      !sameJson(
        event,
        {
          ...submitted,
          approvalStatus: submitted.approvalStatus ?? 'approved',
          requiredSections: submitted.requiredSections ?? [],
        },
      )
    ) {
      return 'Organizers can create events but cannot edit or approve existing events.';
    }
  }
  const approvedEventIds = new Set(
    state.events
      .filter((event) => event.approvalStatus === 'approved')
      .map((event) => event.id),
  );
  if (
    nextState.attendance.some((record) => !approvedEventIds.has(record.eventId))
  ) {
    return 'Attendance can only be recorded for approved events.';
  }
  const previousMessages = new Map(state.messages.map((message) => [message.id, message]));
  const nextMessages = new Map(nextState.messages.map((message) => [message.id, message]));
  if (nextMessages.size !== nextState.messages.length) {
    return 'The SMS outbox contains duplicate identifiers.';
  }
  for (const [id, message] of previousMessages) {
    const submitted = nextMessages.get(id);
    if (!submitted) return 'Organizers cannot remove saved SMS messages.';
    const originalContent = { ...message };
    const submittedContent = { ...submitted };
    delete originalContent.status;
    delete originalContent.syncStatus;
    delete submittedContent.status;
    delete submittedContent.syncStatus;
    if (!sameJson(originalContent, submittedContent)) {
      return 'Organizers cannot edit saved SMS messages.';
    }
  }
  const newMessages = nextState.messages.filter(
    (message) => !previousMessages.has(message.id),
  );
  const approvedEvents = new Map(
    state.events
      .filter((event) => event.approvalStatus === 'approved')
      .map((event) => [event.id, event]),
  );
  for (const message of newMessages) {
    const event = approvedEvents.get(message.eventId);
    const eligibleStudent = event && state.students.some(
      (student) =>
        student.mobile === message.recipientNumber &&
        (event.requiredSections ?? []).includes(student.sectionId ?? ''),
    );
    if (!eligibleStudent) {
      return 'SMS can only be sent to students in the selected sections of approved events.';
    }
  }
  const additions = nextState.events.filter((event) => !previousEvents.has(event.id));
  if (
    additions.some(
      (event) =>
        !Array.isArray(event.requiredSections) ||
        event.requiredSections.length === 0,
    )
  ) {
    return 'Every new event must include its required section IDs.';
  }
  if (additions.some((event) => !event.id || event.approvalStatus !== 'pending')) {
    return 'Organizer-created events must be pending super-admin approval.';
  }
  const sectionIds = [...new Set(additions.flatMap((event) => event.requiredSections))];
  if (sectionIds.some((id) => typeof id !== 'string')) {
    return 'An event contains an invalid required section.';
  }
  if (sectionIds.length) {
    const placeholders = sectionIds.map(() => '?').join(', ');
    const { results } = await env.DB.prepare(
      `SELECT id FROM sections WHERE organization_id = ? AND id IN (${placeholders})`,
    )
      .bind(user.organization_id, ...sectionIds)
      .all();
    if (results.length !== sectionIds.length) {
      return 'An event refers to a section that is no longer available.';
    }
  }
  nextState.events = [
    ...state.events,
    ...additions.map((event) => ({
      ...event,
      approvalStatus: 'pending',
      createdBy: user.id,
    })),
  ];
  return null;
}

async function workspace(request, user, env) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!row) return json({ error: 'The school workspace was not found.' }, 404);
    const state = JSON.parse(row.state_json);
    state.announcements ??= [];
    if (!validWorkspaceState(state)) {
      return json({ error: 'The saved school workspace is invalid.' }, 500);
    }
    return json({
      revision: row.revision,
      state: user.role === 'student' ? studentWorkspace(state, user.student_id) : state,
    });
  }

  if (user.role === 'student') {
    return json({ error: 'Student accounts cannot change shared school data.' }, 403);
  }
  const body = await readJson(request);
  if (
    !Number.isSafeInteger(body?.revision) ||
    body.revision < 0 ||
    !validWorkspaceState(body?.state)
  ) {
    return json({ error: 'Workspace state or revision is invalid.' }, 400);
  }

  const current = await env.DB.prepare(
    'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  if (!current) return json({ error: 'The school workspace was not found.' }, 404);
  if (user.role === 'organizer') {
    let currentState;
    try {
      currentState = JSON.parse(current.state_json);
    } catch {
      return json({ error: 'The saved school workspace is invalid.' }, 500);
    }
    const validationError = await validateOrganizerWorkspace(
      currentState,
      body.state,
      user,
      env,
    );
    if (validationError) return json({ error: validationError }, 403);
  }

  const result = await env.DB.prepare(
    `UPDATE workspace_state
     SET revision = revision + 1, state_json = ?, updated_at = ?
     WHERE organization_id = ? AND revision = ?`,
  )
    .bind(
      JSON.stringify(body.state),
      new Date().toISOString(),
      user.organization_id,
      body.revision,
    )
    .run();
  if (result.meta.changes === 0) {
    const current = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!current) return json({ error: 'The school workspace was not found.' }, 404);
    return json(
      { error: 'This workspace changed on another device.', revision: current.revision, state: JSON.parse(current.state_json) },
      409,
    );
  }
  return json({ revision: body.revision + 1 });
}

async function listSections(user, env) {
  const { results } = await env.DB.prepare(
    `SELECT id, course, year_level AS yearLevel, name
     FROM sections WHERE organization_id = ?
     ORDER BY course, year_level, name COLLATE NOCASE`,
  )
    .bind(user.organization_id)
    .all();
  return json({ sections: results });
}

async function listPublicSections(env) {
  const organization = await env.DB.prepare(
    'SELECT id FROM organizations ORDER BY created_at LIMIT 1',
  ).first();
  if (!organization) return json({ sections: [] });
  const { results } = await env.DB.prepare(
    `SELECT id, course, year_level AS yearLevel, name
     FROM sections WHERE organization_id = ?
     ORDER BY course, year_level, name COLLATE NOCASE`,
  )
    .bind(organization.id)
    .all();
  return json({ sections: results });
}

async function saveSection(request, user, env, sectionId = null) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can manage sections.' }, 403);
  }
  const body = await readJson(request);
  const course = body?.course;
  const yearLevel = body?.yearLevel;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!COURSES.includes(course) || !YEAR_LEVELS.includes(yearLevel) || !name || name.length > 32) {
    return json({ error: 'Choose a valid course and year, and enter a section name up to 32 characters.' }, 400);
  }
  try {
    if (sectionId) {
      const result = await env.DB.prepare(
        `UPDATE sections SET course = ?, year_level = ?, name = ?
         WHERE id = ? AND organization_id = ?`,
      )
        .bind(course, yearLevel, name, sectionId, user.organization_id)
        .run();
      if (result.meta.changes === 0) return json({ error: 'That section was not found.' }, 404);
      await env.DB.prepare(
        `UPDATE workspace_state
         SET revision = revision + 1,
             state_json = json_set(
               state_json,
               '$.students',
               json(COALESCE((
                 SELECT json_group_array(
                   CASE
                     WHEN json_extract(student.value, '$.sectionId') = ?
                       THEN json_set(
                         student.value,
                         '$.course', ?,
                         '$.yearLevel', ?,
                         '$.section', ?
                       )
                     ELSE student.value
                   END
                 )
                 FROM json_each(workspace_state.state_json, '$.students') AS student
               ), '[]'))),
             updated_at = ?
         WHERE organization_id = ?`,
      )
        .bind(
          sectionId,
          course,
          yearLevel,
          sectionLabel(course, yearLevel, name),
          new Date().toISOString(),
          user.organization_id,
        )
        .run();
    } else {
      sectionId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO sections (id, organization_id, course, year_level, name)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(sectionId, user.organization_id, course, yearLevel, name)
        .run();
    }
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed')) {
      return json({ error: 'That section already exists for the selected course and year.' }, 409);
    }
    console.error('Section save failed:', error);
    return json({ error: 'The section could not be saved.' }, 500);
  }
  return json({ id: sectionId, course, yearLevel, name });
}

async function handle(request, env) {
  if (!env.DB || !env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    console.error('Cloudflare D1 or JWT_SECRET is not configured.');
    return json({ error: 'The shared service is not configured yet.' }, 503);
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method === 'GET' && new URL(request.url).pathname === '/api/health') {
    await env.DB.prepare('SELECT 1').first();
    return json({ status: 'ok' });
  }

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (request.method === 'POST' && path === '/api/auth/register') {
    return registerStudent(await readJson(request), env);
  }
  if (request.method === 'GET' && path === '/api/sections') {
    return listPublicSections(env);
  }
  if (request.method === 'POST' && path === '/api/auth/login') {
    return login(await readJson(request), env);
  }

  const authenticated = await requireUser(request, env);
  if (authenticated.error) return authenticated.error;
  const user = authenticated.user;

  if (request.method === 'GET' && path === '/api/auth/me') {
    return json(authUser(user));
  }
  if (path === '/api/workspace' && ['GET', 'PUT'].includes(request.method)) {
    return workspace(request, user, env);
  }
  if (path === '/api/sections' && request.method === 'GET') {
    return listSections(user, env);
  }
  if (path === '/api/sections' && request.method === 'POST') {
    return saveSection(request, user, env);
  }
  const sectionMatch = path.match(/^\/api\/sections\/([^/]+)$/);
  if (sectionMatch && request.method === 'PUT') {
    return saveSection(request, user, env, decodeURIComponent(sectionMatch[1]));
  }
  if (path === '/api/accounts' && request.method === 'GET') {
    if (user.role !== 'super_admin') {
      return json({ error: 'Only the super admin can view school accounts.' }, 403);
    }
    return listAccounts(user, env);
  }
  if (path === '/api/accounts' && request.method === 'POST') {
    return createAccount(request, user, env);
  }
  const resetMatch = path.match(/^\/api\/accounts\/([^/]+)\/password$/);
  if (resetMatch && request.method === 'POST') {
    return resetAccountPassword(
      request,
      user,
      env,
      decodeURIComponent(resetMatch[1]),
    );
  }
  return json({ error: 'Not found.' }, 404);
}

export default {
  async fetch(request, env) {
    const headers = corsHeaders(request, env);
    let response;
    try {
      response = await handle(request, env);
    } catch (error) {
      if (error instanceof Response) {
        response = error;
      } else {
        console.error('Request failed:', error);
        response = json({ error: 'The shared service could not complete the request.' }, 500);
      }
    }
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (value) responseHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
