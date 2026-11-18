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
const AVATAR_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_AVATAR_LENGTH = 150_000;
const CONTACT_CODE_TTL_MS = 10 * 60 * 1000;
const CONTACT_RESEND_MS = 60 * 1000;
const CONTACT_MAX_ATTEMPTS = 5;
const MAX_EXCUSE_PHOTO_LENGTH = 250_000;
const AUDIT_KEEP_DAYS = 180;

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
  if (await isDisabled(env, row.id)) {
    return {
      error: json({ error: 'This account has been turned off. Please ask the admin.' }, 401),
    };
  }
  return { user: row };
}

function normalizedMobile(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Digits only: 09XXXXXXXXX (stored as +639XXXXXXXXX).
  if (/^09\d{9}$/.test(trimmed)) return `+63${trimmed.slice(1)}`;
  return null;
}

function sectionLabel(course, yearLevel, sectionName) {
  return `${course} ${yearLevel} ${sectionName}`;
}

// Past events keep a saved list of who was required (event.roster), so student
// promotions never change history. Other events use the student's section.
function isStudentRequired(event, student) {
  if (event.roster) {
    return Object.values(event.roster).some((ids) => ids.includes(student.id));
  }
  const requiredSections = event.requiredSections ?? [];
  return (
    requiredSections.includes(student.sectionId ?? '') ||
    (event.sections ?? []).includes(student.section)
  );
}

function addStudentToEvent(event, student) {
  if (event.roster || !isStudentRequired(event, student)) return;
  if (!Array.isArray(event.sections)) event.sections = [];
  if (!event.sections.includes(student.section)) event.sections.push(student.section);
}

async function registerStudent(body, env) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  const studentNumber =
    typeof body?.studentNumber === 'string' ? body.studentNumber.trim() : '';
  const namePart = (value) =>
    typeof value === 'string' ? value.trim().replace(/ {2,}/g, ' ') : '';
  const firstName = namePart(body?.firstName);
  const middleName = namePart(body?.middleName);
  const lastName = namePart(body?.lastName);
  const extension = namePart(body?.extension);
  const splitName = Boolean(firstName || middleName || lastName);
  const name = splitName
    ? [firstName, middleName, lastName, extension].filter(Boolean).join(' ')
    : typeof body?.name === 'string'
      ? body.name.trim()
      : '';
  let course = typeof body?.course === 'string' ? body.course : '';
  let yearLevel = typeof body?.yearLevel === 'string' ? body.yearLevel : '';
  const sectionName = typeof body?.section === 'string' ? body.section.trim() : '';
  const requestedSectionId =
    typeof body?.sectionId === 'string' ? body.sectionId : '';
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
  if (!/^PPY-\d{1,5}$/.test(studentNumber)) {
    return json({ error: 'Student ID must use the format PPY- followed by up to 5 numbers.' }, 400);
  }
  if (splitName) {
    if (!firstName || !middleName || !lastName) {
      return json({ error: 'Enter your first name, middle name, and last name.' }, 400);
    }
    const lettersOnly = /^\p{L}+( \p{L}+)*$/u;
    if (
      ![firstName, middleName, lastName].every(
        (part) => part.length <= 60 && lettersOnly.test(part),
      )
    ) {
      return json({ error: 'Names can contain letters and spaces only.' }, 400);
    }
    if (extension && !/^\p{L}+\.?$/u.test(extension)) {
      return json({ error: 'Extension can be something like Jr., Sr., II or III.' }, 400);
    }
  } else {
    if (!name || name.length > 120) {
      return json({ error: 'Enter a full name of up to 120 characters.' }, 400);
    }
    if (!/^\p{L}+( \p{L}+)*$/u.test(name)) {
      return json({ error: 'Full name can contain letters and spaces only.' }, 400);
    }
  }
  if (
    !requestedSectionId &&
    (!COURSES.includes(course) ||
      !YEAR_LEVELS.includes(yearLevel) ||
      !sectionName ||
      sectionName.length > 32)
  ) {
    return json({ error: 'Select a course, year level, and an available section.' }, 400);
  }
  if (!mobile) {
    return json({ error: 'Contact number must be numbers only: 11 digits starting with 09, such as 09123456789.' }, 400);
  }

  const organization = await env.DB.prepare(
    'SELECT id FROM organizations ORDER BY created_at LIMIT 1',
  ).first();
  if (!organization) {
    return json({ error: 'The school is not set up yet. Ask the super admin to initialize it.' }, 503);
  }
  let section;
  if (requestedSectionId) {
    section = await env.DB.prepare(
      `SELECT id, course, year_level, name FROM sections
       WHERE organization_id = ? AND id = ?`,
    )
      .bind(organization.id, requestedSectionId)
      .first();
    if (!section) {
      return json({ error: 'That section is no longer available. Choose another section.' }, 400);
    }
    course = section.course;
    yearLevel = section.year_level;
  } else {
    section = await env.DB.prepare(
      `SELECT id, course, year_level, name FROM sections
       WHERE organization_id = ? AND course = ? AND year_level = ? AND name = ?`,
    )
      .bind(organization.id, course, yearLevel, sectionName)
      .first();
    if (!section && ['A', 'B'].includes(sectionName)) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO sections (id, organization_id, course, year_level, name)
         VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(crypto.randomUUID(), organization.id, course, yearLevel, sectionName)
        .run();
      section = await env.DB.prepare(
        `SELECT id, course, year_level, name FROM sections
         WHERE organization_id = ? AND course = ? AND year_level = ? AND name = ?`,
      )
        .bind(organization.id, course, yearLevel, sectionName)
        .first();
    }
    if (!section) {
      return json(
        { error: 'That section is not set up. Ask the super admin to add it in Settings > Courses & sections.' },
        400,
      );
    }
  }
  if (!section) return json({ error: 'The selected section could not be created.' }, 500);
  const userId = crypto.randomUUID();
  const studentId = studentNumber;
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const student = {
    id: studentId,
    name,
    ...(splitName ? { firstName, middleName, lastName, extension } : {}),
    course,
    yearLevel,
    sectionId: section.id,
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
      if (state.students.some((student) => student.id === studentId)) {
        return json({ error: 'That student ID is already registered.' }, 409);
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
      return json({ error: 'That student ID is already registered.' }, 409);
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
  if (await isDisabled(env, user.id)) {
    return json({ error: 'This account has been turned off. Please ask the admin.' }, 403);
  }
  return json({
    token: await issueToken(user, env.JWT_SECRET),
    ...authUser(user),
    avatar: await avatarOf(env, user.id),
  });
}

// A missing avatar column (migration not applied yet) must never break sign-in.
async function avatarOf(env, userId) {
  try {
    const row = await env.DB.prepare('SELECT avatar FROM users WHERE id = ?')
      .bind(userId)
      .first();
    return row?.avatar ?? null;
  } catch {
    return null;
  }
}

async function saveAvatar(request, user, env) {
  const body = await readJson(request);
  const image = body?.image;
  if (
    typeof image !== 'string' ||
    image.length > MAX_AVATAR_LENGTH ||
    !AVATAR_PATTERN.test(image)
  ) {
    return json(
      { error: 'Choose a JPEG, PNG, or WebP picture (it is shrunk automatically).' },
      400,
    );
  }
  try {
    await env.DB.prepare('UPDATE users SET avatar = ? WHERE id = ?')
      .bind(image, user.id)
      .run();
  } catch (error) {
    console.error('Avatar save failed:', error);
    return json({ error: 'The profile picture could not be saved yet. Try again later.' }, 500);
  }
  return json({ avatar: image });
}

async function removeAvatar(user, env) {
  try {
    await env.DB.prepare('UPDATE users SET avatar = NULL WHERE id = ?')
      .bind(user.id)
      .run();
  } catch (error) {
    console.error('Avatar removal failed:', error);
    return json({ error: 'The profile picture could not be removed yet.' }, 500);
  }
  return json({ avatar: null });
}

// Staff can see a student's photo (to check who they are scanning); students see their own.
async function studentAvatar(user, env, studentId) {
  if (user.role === 'student' && user.student_id !== studentId) {
    return json({ error: 'You can only view your own profile picture.' }, 403);
  }
  let row = null;
  try {
    row = await env.DB.prepare(
      'SELECT avatar FROM users WHERE organization_id = ? AND student_id = ?',
    )
      .bind(user.organization_id, studentId)
      .first();
  } catch {
    row = null;
  }
  return json({ avatar: row?.avatar ?? null });
}

async function freshSession(env, userId) {
  const fresh = await env.DB.prepare(
    'SELECT id, username, organization_id, role, student_id, auth_version FROM users WHERE id = ?',
  )
    .bind(userId)
    .first();
  return {
    token: await issueToken(fresh, env.JWT_SECRET),
    ...authUser(fresh),
    avatar: await avatarOf(env, userId),
  };
}

async function checkCurrentPassword(env, userId, password) {
  const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first();
  return (
    typeof password === 'string' &&
    !!row &&
    (await verifyPassword(password, row.password_hash))
  );
}

// Everyone can change their own password. Other sessions are signed out.
async function changeOwnPassword(request, user, env) {
  const body = await readJson(request);
  if (!validPassword(body?.newPassword)) {
    return json({ error: 'The new password must be 8–128 characters.' }, 400);
  }
  if (!(await checkCurrentPassword(env, user.id, body?.currentPassword))) {
    return json({ error: 'Your current password is incorrect.' }, 403);
  }
  if (body.newPassword === body.currentPassword) {
    return json({ error: 'Choose a password that is different from the current one.' }, 400);
  }
  await env.DB.prepare(
    'UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?',
  )
    .bind(await hashPassword(body.newPassword), user.id)
    .run();
  await audit(env, user, 'password_changed', 'Changed their own password');
  return json(await freshSession(env, user.id));
}

// Everyone can change their own username (their current password is required).
async function changeOwnUsername(request, user, env) {
  const body = await readJson(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  if (!validUsername(username)) {
    return json(
      { error: 'Username must be 3–64 characters: letters, numbers, dots, dashes, or underscores.' },
      400,
    );
  }
  if (username === user.username) {
    return json({ error: 'That is already your username.' }, 400);
  }
  if (!(await checkCurrentPassword(env, user.id, body?.currentPassword))) {
    return json({ error: 'Your current password is incorrect.' }, 403);
  }
  try {
    await env.DB.prepare('UPDATE users SET username = ? WHERE id = ?')
      .bind(username, user.id)
      .run();
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed: users.username')) {
      return json({ error: 'That username is already taken.' }, 409);
    }
    console.error('Username change failed:', error);
    return json({ error: 'The username could not be changed.' }, 500);
  }
  await audit(env, user, 'username_changed', `Changed username from ${user.username} to ${username}`);
  return json(await freshSession(env, user.id));
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Step 1: the student asks to change their number. The code is texted to the NEW
// number from the student's own phone, and typed back in to confirm (step 2).
async function requestContactChange(request, user, env) {
  if (user.role !== 'student') {
    return json({ error: 'Only student accounts have a contact number to change.' }, 403);
  }
  const body = await readJson(request);
  const mobile = normalizedMobile(body?.mobile);
  if (!mobile) {
    return json({ error: 'Contact number must be numbers only: 11 digits starting with 09, such as 09123456789.' }, 400);
  }
  if (!(await checkCurrentPassword(env, user.id, body?.currentPassword))) {
    return json({ error: 'Your current password is incorrect.' }, 403);
  }
  const workspace = await env.DB.prepare(
    'SELECT state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  const student = JSON.parse(workspace?.state_json ?? '{"students":[]}').students?.find(
    (item) => item.id === user.student_id,
  );
  if (student?.mobile === mobile) {
    return json({ error: 'That is already your contact number.' }, 400);
  }
  let existing = null;
  try {
    existing = await env.DB.prepare('SELECT created_at FROM contact_changes WHERE user_id = ?')
      .bind(user.id)
      .first();
  } catch {
    return json({ error: 'Changing the contact number is not available yet. Try again later.' }, 503);
  }
  if (existing && Date.now() - Date.parse(existing.created_at) < CONTACT_RESEND_MS) {
    return json({ error: 'Please wait a minute before asking for another code.' }, 429);
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const now = new Date();
  await env.DB.prepare(
    `INSERT INTO contact_changes (user_id, mobile, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       mobile = excluded.mobile, code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`,
  )
    .bind(
      user.id,
      mobile,
      await sha256Hex(`${user.id}:${mobile}:${code}`),
      new Date(now.getTime() + CONTACT_CODE_TTL_MS).toISOString(),
      now.toISOString(),
    )
    .run();
  return json({ code, mobile, expiresInSeconds: CONTACT_CODE_TTL_MS / 1000 });
}

async function confirmContactChange(request, user, env) {
  if (user.role !== 'student') {
    return json({ error: 'Only student accounts have a contact number to change.' }, 403);
  }
  const body = await readJson(request);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return json({ error: 'Enter the 6-digit code.' }, 400);
  }
  let pending = null;
  try {
    pending = await env.DB.prepare(
      'SELECT mobile, code_hash, expires_at, attempts FROM contact_changes WHERE user_id = ?',
    )
      .bind(user.id)
      .first();
  } catch {
    return json({ error: 'Changing the contact number is not available yet. Try again later.' }, 503);
  }
  const discard = () =>
    env.DB.prepare('DELETE FROM contact_changes WHERE user_id = ?').bind(user.id).run();
  if (!pending) return json({ error: 'Request a new code first.' }, 400);
  if (Date.parse(pending.expires_at) < Date.now()) {
    await discard();
    return json({ error: 'That code has expired. Request a new one.' }, 400);
  }
  if (pending.attempts >= CONTACT_MAX_ATTEMPTS) {
    await discard();
    return json({ error: 'Too many wrong codes. Request a new code.' }, 429);
  }
  if ((await sha256Hex(`${user.id}:${pending.mobile}:${code}`)) !== pending.code_hash) {
    await env.DB.prepare('UPDATE contact_changes SET attempts = attempts + 1 WHERE user_id = ?')
      .bind(user.id)
      .run();
    return json({ error: 'That code is not correct.' }, 400);
  }
  let saved = false;
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    const workspace = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!workspace) return json({ error: 'The school workspace was not found.' }, 503);
    const state = JSON.parse(workspace.state_json);
    const student = state.students?.find((item) => item.id === user.student_id);
    if (!student) return json({ error: 'Your student profile was not found.' }, 404);
    student.mobile = pending.mobile;
    const result = await env.DB.prepare(
      `UPDATE workspace_state
       SET revision = revision + 1, state_json = ?, updated_at = ?
       WHERE organization_id = ? AND revision = ?`,
    )
      .bind(JSON.stringify(state), new Date().toISOString(), user.organization_id, workspace.revision)
      .run();
    saved = result.meta.changes === 1;
  }
  if (!saved) return json({ error: 'The workspace changed. Please try again.' }, 409);
  await discard();
  await audit(env, user, 'contact_changed', `Changed contact number to ${pending.mobile}`);
  return json({ mobile: pending.mobile });
}

async function isDisabled(env, userId) {
  try {
    const row = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?')
      .bind(userId)
      .first();
    return !!row?.disabled;
  } catch {
    return false;
  }
}

// ---------------- activity log ----------------
async function audit(env, actor, action, summary) {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log
        (id, organization_id, at, actor_id, actor_name, actor_role, action, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        actor.organization_id,
        new Date().toISOString(),
        actor.id ?? null,
        actor.username ?? 'unknown',
        actor.role ?? 'unknown',
        action,
        String(summary).slice(0, 300),
      )
      .run();
  } catch {
    // The log is best effort; it must never break the action itself.
  }
}

// Works out what changed in a saved workspace and writes one log line for each.
async function auditWorkspaceChange(env, user, before, after) {
  const lines = [];
  const students = new Map((after.students ?? []).map((item) => [item.id, item]));
  const eventName = (id) =>
    (after.events ?? []).find((item) => item.id === id)?.name ??
    (before.events ?? []).find((item) => item.id === id)?.name ??
    id;
  const earlier = new Map((before.events ?? []).map((item) => [item.id, item]));
  for (const event of after.events ?? []) {
    const old = earlier.get(event.id);
    if (!old) {
      lines.push(['event_created', `Created the event "${event.name}" (${event.approvalStatus ?? 'approved'})`]);
      continue;
    }
    const was = old.approvalStatus ?? 'approved';
    const now = event.approvalStatus ?? 'approved';
    if (was !== now) {
      const verb = { approved: 'Approved', rejected: 'Rejected', pending: 'Resubmitted' }[now] ?? now;
      const reason = now === 'rejected' && event.rejectionReason ? ` (${event.rejectionReason})` : '';
      lines.push([`event_${now}`, `${verb} the event "${event.name}"${reason}`]);
    }
    if (!old.finishedAt && event.finishedAt) {
      lines.push(['event_finished', `Finished the event "${event.name}"`]);
    }
    if (!!old.cancelled !== !!event.cancelled) {
      lines.push([
        event.cancelled ? 'event_cancelled' : 'event_reinstated',
        `${event.cancelled ? 'Cancelled' : 'Reinstated'} the event "${event.name}"`,
      ]);
    } else if (
      old.date !== event.date ||
      old.startTime !== event.startTime ||
      old.endTime !== event.endTime ||
      old.venue !== event.venue ||
      old.name !== event.name
    ) {
      lines.push(['event_edited', `Changed the details of "${event.name}"`]);
    }
  }
  const knownAnnouncements = new Set((before.announcements ?? []).map((item) => item.id));
  for (const item of after.announcements ?? []) {
    if (!knownAnnouncements.has(item.id)) {
      lines.push(['announcement', `Posted the update "${item.title}"`]);
    }
  }
  for (const [action, summary] of lines.slice(0, 40)) {
    await audit(env, user, action, summary);
  }
}

async function listAudit(request, user, env) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can view the activity log.' }, 403);
  }
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
  const before = url.searchParams.get('before');
  const cutoff = new Date(Date.now() - AUDIT_KEEP_DAYS * 86_400_000).toISOString();
  try {
    const statement = before
      ? env.DB.prepare(
          `SELECT id, at, actor_name AS actorName, actor_role AS actorRole, action, summary
           FROM audit_log WHERE organization_id = ? AND at < ? ORDER BY at DESC LIMIT ?`,
        ).bind(user.organization_id, before, limit + 1)
      : env.DB.prepare(
          `SELECT id, at, actor_name AS actorName, actor_role AS actorRole, action, summary
           FROM audit_log WHERE organization_id = ? ORDER BY at DESC LIMIT ?`,
        ).bind(user.organization_id, limit + 1);
    const { results } = await statement.all();
    // Old entries are dropped as the log is read.
    await env.DB.prepare('DELETE FROM audit_log WHERE organization_id = ? AND at < ?')
      .bind(user.organization_id, cutoff)
      .run();
    const entries = results.slice(0, limit);
    return json({
      entries,
      next: results.length > limit ? entries[entries.length - 1].at : null,
    });
  } catch {
    return json({ error: 'The activity log is not available yet. Apply the latest database update.' }, 503);
  }
}

// ---------------- generic workspace update with retries ----------------
async function mutateWorkspace(env, organizationId, mutate) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(organizationId)
      .first();
    if (!row) return { error: 'The school workspace was not found.', status: 503 };
    const state = JSON.parse(row.state_json);
    const outcome = mutate(state);
    if (outcome?.error) return outcome;
    const result = await env.DB.prepare(
      `UPDATE workspace_state
       SET revision = revision + 1, state_json = ?, updated_at = ?
       WHERE organization_id = ? AND revision = ?`,
    )
      .bind(JSON.stringify(state), new Date().toISOString(), organizationId, row.revision)
      .run();
    if (result.meta.changes === 1) return { ok: true };
  }
  return { error: 'The workspace changed. Please try again.', status: 409 };
}

// ---------------- turn off / delete an account (admin) ----------------
async function findManagedUser(admin, env, username) {
  const target = await env.DB.prepare(
    `SELECT id, username, role, student_id FROM users
     WHERE organization_id = ? AND username = ? COLLATE NOCASE`,
  )
    .bind(admin.organization_id, username)
    .first();
  if (!target) return { error: json({ error: 'That account was not found.' }, 404) };
  if (target.id === admin.id) {
    return { error: json({ error: 'You cannot change your own account here.' }, 400) };
  }
  if (target.role === 'super_admin') {
    return { error: json({ error: 'The admin account cannot be turned off or deleted.' }, 400) };
  }
  return { target };
}

async function setUserDisabled(request, admin, env, username) {
  const body = await readJson(request);
  if (typeof body?.disabled !== 'boolean') {
    return json({ error: 'Say whether the account should be turned off or on.' }, 400);
  }
  const { target, error } = await findManagedUser(admin, env, username);
  if (error) return error;
  try {
    // A new auth version signs the person out of every phone right away.
    await env.DB.prepare(
      'UPDATE users SET disabled = ?, auth_version = auth_version + 1 WHERE id = ?',
    )
      .bind(body.disabled ? 1 : 0, target.id)
      .run();
  } catch {
    return json({ error: 'Apply the latest database update first, then try again.' }, 503);
  }
  await audit(
    env,
    admin,
    body.disabled ? 'account_disabled' : 'account_enabled',
    `${body.disabled ? 'Turned off' : 'Turned on'} the ${target.role} account ${target.username}`,
  );
  return json({ username: target.username, disabled: body.disabled });
}

async function deleteManagedUser(admin, env, username) {
  const { target, error } = await findManagedUser(admin, env, username);
  if (error) return error;
  if (target.role === 'student' && target.student_id) {
    const studentId = target.student_id;
    const outcome = await mutateWorkspace(env, admin.organization_id, (state) => {
      state.students = (state.students ?? []).filter((item) => item.id !== studentId);
      state.violations = (state.violations ?? []).filter((item) => item.studentId !== studentId);
      (state.events ?? []).forEach((event) =>
        (event.seats ?? []).forEach((seat) => {
          if (seat.studentId === studentId) seat.studentId = null;
        }),
      );
    });
    if (outcome.error) return json({ error: outcome.error }, outcome.status ?? 500);
    await removeAttendanceWhere(env, admin.organization_id, 'student_id', [studentId]);
    try {
      await env.DB.prepare('DELETE FROM excuse_requests WHERE organization_id = ? AND student_id = ?')
        .bind(admin.organization_id, studentId)
        .run();
    } catch {
      // No excuse table yet.
    }
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(target.id).run();
  await audit(env, admin, 'account_deleted', `Deleted the ${target.role} account ${target.username}`);
  return json({ username: target.username, deleted: true });
}

// ---------------- delete an event ----------------
async function deleteEvent(user, env, eventId) {
  if (user.role !== 'super_admin' && user.role !== 'organizer') {
    return json({ error: 'You cannot delete events.' }, 403);
  }
  let deletedName = '';
  const hasAttendance = (await liveAttendanceCount(env, user.organization_id, eventId)) > 0;
  const outcome = await mutateWorkspace(env, user.organization_id, (state) => {
    const event = (state.events ?? []).find((item) => item.id === eventId);
    if (!event) return { error: 'That event was not found.', status: 404 };
    const status = event.approvalStatus ?? 'approved';
    if (user.role === 'organizer') {
      if (event.createdBy !== user.id || status === 'approved') {
        return { error: 'You can only delete your own events that are not approved.', status: 403 };
      }
    }
    if (status === 'approved' && hasAttendance) {
      return { error: 'This event already has attendance. Cancel it instead of deleting it.', status: 409 };
    }
    deletedName = event.name;
    state.events = state.events.filter((item) => item.id !== eventId);
    if (state.selectedEventId === eventId) state.selectedEventId = state.events[0]?.id ?? '';
    return null;
  });
  if (outcome.error) return json({ error: outcome.error }, outcome.status ?? 500);
  await removeAttendanceWhere(env, user.organization_id, 'event_id', [eventId]);
  try {
    await env.DB.prepare('DELETE FROM excuse_requests WHERE organization_id = ? AND event_id = ?')
      .bind(user.organization_id, eventId)
      .run();
  } catch {
    // No excuse table yet.
  }
  await audit(env, user, 'event_deleted', `Deleted the event "${deletedName}"`);
  return json({ deleted: true });
}

// ---------------- excuse requests ----------------
function excuseRow(row, withPhoto = false) {
  return {
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    studentId: row.student_id,
    studentName: row.student_name,
    section: row.section_label,
    reason: row.reason,
    status: row.status,
    reviewerNote: row.reviewer_note ?? null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by_name ?? null,
    hasPhoto: !!row.photo,
    ...(withPhoto ? { photo: row.photo ?? null } : {}),
  };
}

async function createExcuse(request, user, env) {
  if (user.role !== 'student') {
    return json({ error: 'Only students can ask to be excused.' }, 403);
  }
  const body = await readJson(request);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 10 || reason.length > 500) {
    return json({ error: 'Explain the reason in 10 to 500 characters.' }, 400);
  }
  const photo = body?.photo ?? null;
  if (
    photo !== null &&
    (typeof photo !== 'string' ||
      photo.length > MAX_EXCUSE_PHOTO_LENGTH ||
      !AVATAR_PATTERN.test(photo))
  ) {
    return json({ error: 'The photo must be a JPEG, PNG, or WebP picture.' }, 400);
  }
  const workspace = await env.DB.prepare(
    'SELECT state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  const state = JSON.parse(workspace?.state_json ?? '{}');
  const event = (state.events ?? []).find((item) => item.id === body?.eventId);
  const student = (state.students ?? []).find((item) => item.id === user.student_id);
  if (!event || event.approvalStatus === 'pending' || event.approvalStatus === 'rejected') {
    return json({ error: 'That event was not found.' }, 404);
  }
  if (event.cancelled) {
    return json({ error: 'That event was cancelled, so there is nothing to excuse.' }, 400);
  }
  if (!student || !isStudentRequired(event, student)) {
    return json({ error: 'Your section is not required at that event.' }, 403);
  }
  // Excuse letters open the day before the event (school time, UTC+8).
  const schoolToday = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const opens = new Date(`${event.date}T12:00:00Z`);
  opens.setUTCDate(opens.getUTCDate() - 1);
  if (event.date && schoolToday < opens.toISOString().slice(0, 10)) {
    return json({ error: 'You can send an excuse starting the day before the event.' }, 400);
  }
  const attended = (await findAttendance(env, user.organization_id, event.id, student.id)).find(
    (record) => !record.excused,
  );
  if (attended) {
    return json({ error: 'You already have attendance recorded for that event.' }, 409);
  }
  try {
    const existing = await env.DB.prepare(
      `SELECT id FROM excuse_requests
       WHERE organization_id = ? AND student_id = ? AND event_id = ?
         AND status IN ('pending', 'approved')`,
    )
      .bind(user.organization_id, student.id, event.id)
      .first();
    if (existing) {
      return json({ error: 'You already sent a request for that event.' }, 409);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO excuse_requests
        (id, organization_id, event_id, event_name, student_id, student_name,
         section_label, reason, photo, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        id,
        user.organization_id,
        event.id,
        event.name,
        student.id,
        student.name,
        student.section ?? '',
        reason,
        photo,
        new Date().toISOString(),
      )
      .run();
    await audit(env, user, 'excuse_requested', `${student.name} asked to be excused from "${event.name}"`);
    return json({ id, status: 'pending' }, 201);
  } catch (error) {
    console.error('Excuse request failed:', error);
    return json({ error: 'Excuse requests are not available yet. Try again later.' }, 503);
  }
}

async function myExcuses(user, env) {
  if (user.role !== 'student') return json({ excuses: [] });
  try {
    const { results } = await env.DB.prepare(
      `SELECT * FROM excuse_requests WHERE organization_id = ? AND student_id = ?
       ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(user.organization_id, user.student_id)
      .all();
    return json({ excuses: results.map((row) => excuseRow(row)) });
  } catch {
    return json({ excuses: [] });
  }
}

async function listExcuses(request, user, env) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can review excuse requests.' }, 403);
  }
  const status = new URL(request.url).searchParams.get('status');
  try {
    const statement =
      status === 'pending' || status === 'approved' || status === 'rejected'
        ? env.DB.prepare(
            `SELECT * FROM excuse_requests WHERE organization_id = ? AND status = ?
             ORDER BY created_at DESC LIMIT 200`,
          ).bind(user.organization_id, status)
        : env.DB.prepare(
            `SELECT * FROM excuse_requests WHERE organization_id = ?
             ORDER BY created_at DESC LIMIT 200`,
          ).bind(user.organization_id);
    const { results } = await statement.all();
    const pending = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM excuse_requests
       WHERE organization_id = ? AND status = 'pending'`,
    )
      .bind(user.organization_id)
      .first();
    return json({ excuses: results.map((row) => excuseRow(row)), pending: pending?.total ?? 0 });
  } catch {
    return json({ excuses: [], pending: 0 });
  }
}

async function getExcuse(user, env, id) {
  const row = await env.DB.prepare(
    'SELECT * FROM excuse_requests WHERE id = ? AND organization_id = ?',
  )
    .bind(id, user.organization_id)
    .first();
  if (!row) return json({ error: 'That request was not found.' }, 404);
  if (user.role === 'student' && row.student_id !== user.student_id) {
    return json({ error: 'You can only view your own requests.' }, 403);
  }
  if (user.role === 'organizer') {
    return json({ error: 'Only the super admin can review excuse requests.' }, 403);
  }
  return json(excuseRow(row, true));
}

async function cancelExcuse(user, env, id) {
  const row = await env.DB.prepare(
    'SELECT student_id, status FROM excuse_requests WHERE id = ? AND organization_id = ?',
  )
    .bind(id, user.organization_id)
    .first();
  if (!row || row.student_id !== user.student_id) {
    return json({ error: 'That request was not found.' }, 404);
  }
  if (row.status !== 'pending') {
    return json({ error: 'Only a request that is still waiting can be withdrawn.' }, 409);
  }
  await env.DB.prepare('DELETE FROM excuse_requests WHERE id = ?').bind(id).run();
  return json({ id, withdrawn: true });
}

async function reviewExcuse(request, admin, env, id) {
  if (admin.role !== 'super_admin') {
    return json({ error: 'Only the super admin can review excuse requests.' }, 403);
  }
  const body = await readJson(request);
  const decision = body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return json({ error: 'Choose to approve or reject the request.' }, 400);
  }
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 200) : '';
  if (decision === 'rejected' && !note) {
    return json({ error: 'Tell the student why the request was rejected.' }, 400);
  }
  const row = await env.DB.prepare(
    'SELECT * FROM excuse_requests WHERE id = ? AND organization_id = ?',
  )
    .bind(id, admin.organization_id)
    .first();
  if (!row) return json({ error: 'That request was not found.' }, 404);
  if (row.status !== 'pending') {
    return json({ error: 'That request was already reviewed.' }, 409);
  }
  if (decision === 'approved') {
    // Approving records an excused absence for that student at that event.
    const state = await coreState(env, admin.organization_id);
    if (!(state.events ?? []).some((item) => item.id === row.event_id)) {
      return json({ error: 'That event no longer exists.' }, 404);
    }
    const existing = (await findAttendance(env, admin.organization_id, row.event_id, row.student_id))[0];
    if (existing && !existing.excused) {
      return json({ error: 'This student already has attendance for that event.' }, 409);
    }
    if (!existing) {
      await writeAttendance(env, admin.organization_id, [{
        id: `ATT-EX-${crypto.randomUUID().slice(0, 8)}`,
        eventId: row.event_id,
        studentId: row.student_id,
        timeIn: '',
        timeOut: null,
        durationMinutes: null,
        status: 'Excused',
        syncStatus: 'Synced',
        manual: true,
        excused: true,
        recordedBy: admin.id,
        recordedByName: admin.username,
      }], []);
    }
  }
  await env.DB.prepare(
    `UPDATE excuse_requests
     SET status = ?, reviewer_note = ?, reviewed_at = ?, reviewed_by_name = ? WHERE id = ?`,
  )
    .bind(decision, note || null, new Date().toISOString(), admin.username, id)
    .run();
  await audit(
    env,
    admin,
    decision === 'approved' ? 'excuse_approved' : 'excuse_rejected',
    `${decision === 'approved' ? 'Approved' : 'Rejected'} the excuse of ${row.student_name} for "${row.event_name}"`,
  );
  return json(excuseRow({ ...row, status: decision, reviewer_note: note || null, reviewed_at: new Date().toISOString(), reviewed_by_name: admin.username }));
}

// ---------------- school year and automatic promotion ----------------
function philippineToday(env) {
  // TODAY_OVERRIDE exists only so the logic can be tested; it is never set in production.
  if (env.TODAY_OVERRIDE) return env.TODAY_OVERRIDE;
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
}

async function getSchoolYear(env, organizationId) {
  try {
    const row = await env.DB.prepare(
      `SELECT school_year_end AS endDate, promotion_enabled AS enabled,
              last_promoted_for AS lastPromotedFor
       FROM school_settings WHERE organization_id = ?`,
    )
      .bind(organizationId)
      .first();
    return {
      endDate: row?.endDate ?? null,
      enabled: !!row?.enabled,
      lastPromotedFor: row?.lastPromotedFor ?? null,
      available: true,
    };
  } catch {
    return { endDate: null, enabled: false, lastPromotedFor: null, available: false };
  }
}

// Works out who moves up a year and who graduates (4th year). Missing next-year
// sections are planned so they can be created.
function planPromotion(state, sections) {
  const key = (course, year, name) => `${course}|${year}|${name}`;
  const byId = new Map(sections.map((section) => [section.id, section]));
  const byKey = new Map(sections.map((s) => [key(s.course, s.year_level, s.name), s]));
  const create = [];
  const sectionMap = new Map(); // old section id -> new id, null (graduates) or undefined (unknown)
  const nextOf = (old) => {
    if (sectionMap.has(old.id)) return sectionMap.get(old.id);
    const index = YEAR_LEVELS.indexOf(old.year_level);
    let result;
    if (index < 0) result = undefined;
    else if (index === YEAR_LEVELS.length - 1) result = null;
    else {
      const year = YEAR_LEVELS[index + 1];
      let next = byKey.get(key(old.course, year, old.name));
      if (!next) {
        next = { id: crypto.randomUUID(), course: old.course, year_level: year, name: old.name };
        byKey.set(key(old.course, year, old.name), next);
        create.push(next);
      }
      result = next.id;
    }
    sectionMap.set(old.id, result);
    return result;
  };
  const moved = [];
  const graduates = [];
  let skipped = 0;
  for (const student of state.students ?? []) {
    const old = student.sectionId ? byId.get(student.sectionId) : undefined;
    const next = old ? nextOf(old) : undefined;
    if (next === undefined) skipped += 1;
    else if (next === null) graduates.push(student);
    else moved.push({ student, nextId: next, from: old.year_level });
  }
  // Map every section (even empty ones), so events that name them are updated too.
  for (const section of sections) nextOf(section);
  const nextSectionById = new Map([...byKey.values()].map((s) => [s.id, s]));
  const steps = YEAR_LEVELS.map((year, index) => ({
    from: year,
    to: YEAR_LEVELS[index + 1] ?? null,
    students:
      index === YEAR_LEVELS.length - 1
        ? graduates.length
        : moved.filter((item) => item.from === year).length,
  }));
  return { sectionMap, create, moved, graduates, skipped, steps, nextSectionById };
}

async function loadSections(env, organizationId) {
  const { results } = await env.DB.prepare(
    'SELECT id, course, year_level, name FROM sections WHERE organization_id = ?',
  )
    .bind(organizationId)
    .all();
  return results;
}

async function previewPromotion(env, organizationId) {
  const row = await env.DB.prepare(
    'SELECT state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(organizationId)
    .first();
  const plan = planPromotion(JSON.parse(row?.state_json ?? '{"students":[]}'), await loadSections(env, organizationId));
  return {
    steps: plan.steps,
    graduating: plan.graduates.length,
    promoting: plan.moved.length,
    skipped: plan.skipped,
    newSections: plan.create.length,
  };
}

async function runPromotion(env, organizationId, today, endDate) {
  // 1. Make sure every next-year section exists.
  let sections = await loadSections(env, organizationId);
  const first = planPromotion(
    JSON.parse(
      (await env.DB.prepare('SELECT state_json FROM workspace_state WHERE organization_id = ?')
        .bind(organizationId)
        .first())?.state_json ?? '{"students":[]}',
    ),
    sections,
  );
  for (const section of first.create) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sections (id, organization_id, course, year_level, name)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(section.id, organizationId, section.course, section.year_level, section.name)
      .run();
  }
  sections = await loadSections(env, organizationId);

  // 2. Keep a copy of the data before anything changes.
  let graduates = [];
  let summary = { promoted: 0, graduated: 0, skipped: 0 };
  const outcome = await mutateWorkspace(env, organizationId, (state) => {
    const plan = planPromotion(state, sections);
    graduates = plan.graduates.map((student) => ({ id: student.id, name: student.name }));
    const graduateIds = new Set(graduates.map((student) => student.id));
    const label = (section) => `${section.course} ${section.year_level} ${section.name}`;
    const nextById = new Map(sections.map((section) => [section.id, section]));
    const remapped = (ids) =>
      [...new Set((ids ?? []).flatMap((id) => {
        const next = plan.sectionMap.get(id);
        return next === null ? [] : [next ?? id];
      }))];

    // Past events keep who was required, so their history stays the same.
    const movedIds = new Set(plan.moved.map((item) => item.student.id));
    for (const event of state.events ?? []) {
      if (event.date < today) {
        if (!event.roster) {
          const roster = {};
          for (const student of state.students ?? []) {
            if (graduateIds.has(student.id)) continue;
            if (!(event.requiredSections ?? []).includes(student.sectionId ?? '')) continue;
            (roster[student.section] ??= []).push(student.id);
          }
          event.roster = roster;
        }
      } else {
        event.requiredSections = remapped(event.requiredSections);
        if (event.seatingPlan?.sharedSectionIds) {
          event.seatingPlan.sharedSectionIds = remapped(event.seatingPlan.sharedSectionIds);
        }
      }
    }
    for (const item of state.announcements ?? []) {
      if (item.audience?.type === 'sections') {
        item.audience.sectionIds = remapped(item.audience.sectionIds);
      }
    }
    for (const { student, nextId } of plan.moved) {
      const next = nextById.get(nextId);
      student.yearLevel = next.year_level;
      student.sectionId = next.id;
      student.section = label(next);
    }
    state.students = (state.students ?? []).filter((student) => !graduateIds.has(student.id));
    state.violations = (state.violations ?? []).filter((r) => !graduateIds.has(r.studentId));
    for (const event of state.events ?? []) {
      for (const seat of event.seats ?? []) {
        if (graduateIds.has(seat.studentId)) seat.studentId = null;
      }
      if (event.roster) {
        for (const [section, ids] of Object.entries(event.roster)) {
          event.roster[section] = ids.filter((id) => !graduateIds.has(id));
        }
      }
    }
    summary = { promoted: movedIds.size, graduated: graduateIds.size, skipped: plan.skipped };
  });
  if (outcome.error) throw new Error(outcome.error);

  // 3. Remove the graduates' accounts, attendance and requests.
  for (let index = 0; index < graduates.length; index += 50) {
    const chunk = graduates.slice(index, index + 50).map((student) => student.id);
    const marks = chunk.map(() => '?').join(', ');
    await removeAttendanceWhere(env, organizationId, 'student_id', chunk);
    await env.DB.prepare(
      `DELETE FROM users WHERE organization_id = ? AND role = 'student' AND student_id IN (${marks})`,
    )
      .bind(organizationId, ...chunk)
      .run();
    try {
      await env.DB.prepare(
        `DELETE FROM excuse_requests WHERE organization_id = ? AND student_id IN (${marks})`,
      )
        .bind(organizationId, ...chunk)
        .run();
    } catch {
      // No excuse table yet.
    }
  }
  return summary;
}

async function backupWorkspace(env, organizationId, reason) {
  const row = await env.DB.prepare('SELECT state_json FROM workspace_state WHERE organization_id = ?')
    .bind(organizationId)
    .first();
  if (!row) return;
  const { results: users } = await env.DB.prepare(
    `SELECT id, username, role, student_id FROM users WHERE organization_id = ? AND role = 'student'`,
  )
    .bind(organizationId)
    .all();
  await env.DB.prepare(
    `INSERT INTO workspace_backups (id, organization_id, created_at, reason, state_json, users_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), organizationId, new Date().toISOString(), reason, row.state_json, JSON.stringify(users))
    .run();
  // Keep only the three most recent copies.
  await env.DB.prepare(
    `DELETE FROM workspace_backups WHERE organization_id = ? AND id NOT IN (
       SELECT id FROM workspace_backups WHERE organization_id = ? ORDER BY created_at DESC LIMIT 3)`,
  )
    .bind(organizationId, organizationId)
    .run();
}

// The daily job: promote after the school year ended, once, and only when the
// admin turned it on and the date is recent.
async function maybePromote(env, organizationId) {
  const today = philippineToday(env);
  const settings = await getSchoolYear(env, organizationId);
  const system = { organization_id: organizationId, id: null, username: 'System', role: 'system' };
  if (!settings.available || !settings.enabled || !settings.endDate) return { ran: false, reason: 'off' };
  if (settings.lastPromotedFor === settings.endDate) return { ran: false, reason: 'already' };
  if (today <= settings.endDate) return { ran: false, reason: 'not-yet' };
  const daysLate = (Date.parse(today) - Date.parse(settings.endDate)) / 86_400_000;
  if (daysLate > 30) {
    await audit(env, system, 'school_year_skipped',
      `Did not promote students: the school year ended on ${settings.endDate}, more than 30 days ago. Set a new end date.`);
    await env.DB.prepare('UPDATE school_settings SET promotion_enabled = 0, updated_at = ? WHERE organization_id = ?')
      .bind(new Date().toISOString(), organizationId).run();
    return { ran: false, reason: 'too-late' };
  }
  // Record the run first, so a crash can never promote the same students twice.
  await env.DB.prepare(
    'UPDATE school_settings SET last_promoted_for = ?, updated_at = ? WHERE organization_id = ?',
  )
    .bind(settings.endDate, new Date().toISOString(), organizationId)
    .run();
  try {
    await backupWorkspace(env, organizationId, `Before promoting students after ${settings.endDate}`);
    const summary = await runPromotion(env, organizationId, today, settings.endDate);
    await audit(env, system, 'school_year_promoted',
      `School year ${settings.endDate} ended: promoted ${summary.promoted} students, deleted ${summary.graduated} graduates, skipped ${summary.skipped}.`);
    return { ran: true, ...summary };
  } catch (error) {
    console.error('Promotion failed:', error);
    await audit(env, system, 'school_year_failed',
      `Promoting students after ${settings.endDate} failed. A backup of the data was saved first.`);
    return { ran: false, reason: 'failed' };
  }
}

async function runScheduled(env) {
  try {
    // Removal markers older than 180 days are no longer needed by any device.
    await env.DB.prepare('DELETE FROM attendance_records WHERE deleted = 1 AND updated_at < ?')
      .bind(new Date(Date.now() - 180 * 86400000).toISOString())
      .run();
  } catch (error) {
    console.error('Attendance cleanup failed:', error);
  }
  const { results } = await env.DB.prepare('SELECT id FROM organizations').all();
  for (const organization of results) {
    try {
      await closeAllOpenRecords(env, organization.id);
    } catch (error) {
      console.error('Closing open attendance failed:', error);
    }
    try {
      await maybePromote(env, organization.id);
    } catch (error) {
      console.error('Scheduled promotion failed:', error);
    }
  }
}

async function schoolYearSettings(user, env) {
  const settings = await getSchoolYear(env, user.organization_id);
  let preview = null;
  try {
    preview = await previewPromotion(env, user.organization_id);
  } catch {
    preview = null;
  }
  return json({ ...settings, today: philippineToday(env), preview });
}

async function saveSchoolYear(request, user, env) {
  const body = await readJson(request);
  const enabled = body?.enabled === true;
  const endDate = typeof body?.endDate === 'string' ? body.endDate : null;
  if (enabled) {
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || Number.isNaN(Date.parse(endDate))) {
      return json({ error: 'Choose the date the school year ends.' }, 400);
    }
    if (endDate < philippineToday(env)) {
      return json({ error: 'The end date cannot be in the past.' }, 400);
    }
    const current = await getSchoolYear(env, user.organization_id);
    if (current.lastPromotedFor === endDate) {
      return json({ error: 'Students were already promoted for that date. Choose a new end date.' }, 409);
    }
  }
  try {
    await env.DB.prepare(
      `INSERT INTO school_settings (organization_id, school_year_end, promotion_enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(organization_id) DO UPDATE SET
         school_year_end = excluded.school_year_end,
         promotion_enabled = excluded.promotion_enabled,
         updated_at = excluded.updated_at`,
    )
      .bind(user.organization_id, endDate, enabled ? 1 : 0, new Date().toISOString())
      .run();
  } catch {
    return json({ error: 'Apply the latest database update first, then try again.' }, 503);
  }
  await audit(env, user, 'school_year_set',
    enabled
      ? `Turned on automatic promotion after the school year ends on ${endDate}`
      : 'Turned off automatic promotion');
  return json(await (await schoolYearSettings(user, env)).json());
}

async function listAccounts(user, env) {
  let results;
  try {
    ({ results } = await env.DB.prepare(
      `SELECT id, username, role, student_id AS studentId, created_at AS createdAt, disabled
       FROM users WHERE organization_id = ? ORDER BY username COLLATE NOCASE`,
    )
      .bind(user.organization_id)
      .all());
  } catch {
    // Before the latest database update there is no "disabled" column.
    ({ results } = await env.DB.prepare(
      `SELECT id, username, role, student_id AS studentId, created_at AS createdAt
       FROM users WHERE organization_id = ? ORDER BY username COLLATE NOCASE`,
    )
      .bind(user.organization_id)
      .all());
  }
  return json({
    accounts: results.map((account) => ({ ...account, disabled: !!account.disabled })),
  });
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
  await audit(env, user, 'account_created', `Created the organizer account ${username}`);
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
  await audit(env, user, 'password_reset', `Reset the password of ${username}`);
  return json({ username, passwordReset: true });
}

async function resetSharedApp(user, env) {
  if (user.role !== 'super_admin') {
    return json({ error: 'Only the super admin can reset the shared app.' }, 403);
  }
  const workspace = await env.DB.prepare(
    'SELECT revision FROM workspace_state WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  if (!workspace) return json({ error: 'The school workspace was not found.' }, 404);

  const statements = [
    env.DB.prepare(
      'DELETE FROM users WHERE organization_id = ? AND id <> ?',
    ).bind(user.organization_id, user.id),
    env.DB.prepare(
      'DELETE FROM sections WHERE organization_id = ?',
    ).bind(user.organization_id),
    ...COURSES.flatMap((course) =>
      YEAR_LEVELS.flatMap((yearLevel) =>
        ['A', 'B'].map((name) =>
          env.DB.prepare(
            `INSERT INTO sections (id, organization_id, course, year_level, name)
             VALUES (?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            user.organization_id,
            course,
            yearLevel,
            name,
          ),
        ),
      ),
    ),
    env.DB.prepare(
      `UPDATE workspace_state
       SET revision = revision + 1, state_json = ?, updated_at = ?
       WHERE organization_id = ?`,
    ).bind(
      JSON.stringify(emptyWorkspace()),
      new Date().toISOString(),
      user.organization_id,
    ),
  ];
  try {
    await env.DB.batch(statements);
    await removeAttendanceWhere(env, user.organization_id, null, []);
    const updated = await env.DB.prepare(
      'SELECT revision FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!updated) return json({ error: 'The reset workspace could not be loaded.' }, 500);
    try {
      await env.DB.prepare('DELETE FROM excuse_requests WHERE organization_id = ?')
        .bind(user.organization_id)
        .run();
    } catch {
      // The table does not exist until the latest database update is applied.
    }
    await audit(env, user, 'workspace_reset', 'Deleted all shared data except the admin account');
    return json({ revision: updated.revision });
  } catch (error) {
    console.error('Shared app reset failed:', error);
    return json({ error: 'The shared app could not be reset.' }, 500);
  }
}

function studentWorkspace(state, studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return emptyWorkspace();
  return {
    students: [student],
    // A student only receives the events their own section is part of.
    events: state.events
      .filter(
        (event) =>
          event.approvalStatus === 'approved' && isStudentRequired(event, student),
      )
      .map((event) => {
        const studentEvent = {
          ...event,
          seats: [],
          expectedAttendeeCount: event.roster
            ? new Set(Object.values(event.roster).flat()).size
            : (state.students ?? []).filter((item) =>
                isStudentRequired(event, item),
              ).length,
        };
        delete studentEvent.seatingPlan;
        return studentEvent;
      }),
    // Students see only their own attendance records.
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

function validAnnouncementAudience(audience) {
  if (audience === undefined) return true;
  if (typeof audience !== 'object' || audience === null) return false;
  if (audience.type === 'all') return true;
  if (audience.type === 'course') return typeof audience.course === 'string';
  if (audience.type === 'sections') {
    return (
      Array.isArray(audience.sectionIds) &&
      audience.sectionIds.length <= 500 &&
      audience.sectionIds.every((id) => typeof id === 'string')
    );
  }
  return false;
}

// Organizers may post new announcements, but never edit or remove existing ones.
function validateOrganizerAnnouncements(previous, next) {
  const nextById = new Map(next.map((item) => [item?.id, item]));
  if (nextById.size !== next.length) {
    return 'The announcement list contains duplicate identifiers.';
  }
  for (const item of previous) {
    const submitted = nextById.get(item.id);
    if (!submitted || !sameJson(item, submitted)) {
      return 'Organizers cannot edit or remove existing announcements.';
    }
  }
  const previousIds = new Set(previous.map((item) => item.id));
  for (const item of next) {
    if (previousIds.has(item.id)) continue;
    if (
      typeof item?.id !== 'string' ||
      typeof item.title !== 'string' ||
      !item.title.trim() ||
      item.title.length > 120 ||
      typeof item.body !== 'string' ||
      !item.body.trim() ||
      item.body.length > 2000 ||
      typeof item.createdAt !== 'string' ||
      !validAnnouncementAudience(item.audience)
    ) {
      return 'An announcement is missing its title, message, or audience.';
    }
  }
  return null;
}

async function validateOrganizerWorkspace(state, nextState, user, env) {
  if (!sameJson(state.students, nextState.students)) {
    return 'Organizers cannot change student profiles.';
  }
  const announcementError = validateOrganizerAnnouncements(
    state.announcements ?? [],
    nextState.announcements ?? [],
  );
  if (announcementError) return announcementError;
  const previousEvents = new Map(state.events.map((event) => [event.id, event]));
  const nextEvents = new Map(nextState.events.map((event) => [event.id, event]));
  if (nextEvents.size !== nextState.events.length || previousEvents.size !== state.events.length) {
    return 'The event list contains duplicate identifiers.';
  }
  // Organizers may edit and resubmit only their own events that are not approved.
  const resubmitted = new Map();
  for (const [id, event] of previousEvents) {
    const submitted = nextEvents.get(id);
    if (!submitted) return 'Organizers cannot delete events.';
    const normalized = {
      ...submitted,
      approvalStatus: submitted.approvalStatus ?? 'approved',
      requiredSections: submitted.requiredSections ?? [],
    };
    if (sameJson(event, normalized)) continue;
    const editable =
      event.createdBy === user.id &&
      ['pending', 'rejected'].includes(event.approvalStatus);
    if (!editable) {
      return 'Organizers can only edit their own events that are not approved yet.';
    }
    if (
      submitted.approvalStatus !== 'pending' ||
      !Array.isArray(submitted.requiredSections) ||
      submitted.requiredSections.length === 0
    ) {
      return 'Resubmit your event as pending, with at least one required section.';
    }
    const { rejectionReason: _removed, ...clean } = submitted;
    resubmitted.set(id, {
      ...clean,
      approvalStatus: 'pending',
      createdBy: event.createdBy,
      createdByName: event.createdByName,
    });
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
    // Announcement texts have no event: they may go to any registered student.
    const event = message.eventId ? approvedEvents.get(message.eventId) : null;
    const eligibleStudent = message.eventId
      ? event && state.students.some(
          (student) =>
            student.mobile === message.recipientNumber &&
            isStudentRequired(event, student),
        )
      : state.students.some(
          (student) => student.mobile === message.recipientNumber,
        );
    if (!eligibleStudent) {
      return 'SMS can only be sent to registered students, or to the selected sections of approved events.';
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
  const sectionIds = [
    ...new Set(
      [...additions, ...resubmitted.values()].flatMap((event) => event.requiredSections),
    ),
  ];
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
    ...state.events.map((event) => resubmitted.get(event.id) ?? event),
    ...additions.map((event) => ({
      ...event,
      approvalStatus: 'pending',
      createdBy: user.id,
      createdByName: user.username,
    })),
  ];
  return null;
}

// ---------------- attendance (one row per record, synced in small steps) ----------------
// Attendance is NOT stored inside the workspace JSON any more: that row has a size limit
// and would stop saving after a few thousand check-ins. Apps ask for "everything after
// cursor N" and send only the records they changed.
const ATTENDANCE_PAGE = 3000;
const ATTENDANCE_PUSH_MAX = 500;
const ATTENDANCE_REMOVE_MAX = 2000;
const MESSAGE_KEEP_DAYS = 14;
const MESSAGE_KEEP_MAX = 1500;
const SYNC_ITEMS_KEEP = 200;

function plainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validAttendanceShape(record) {
  return (
    plainRecord(record) &&
    typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 200 &&
    typeof record.eventId === 'string' && record.eventId.length > 0 && record.eventId.length <= 200 &&
    typeof record.studentId === 'string' && record.studentId.length > 0 && record.studentId.length <= 200 &&
    JSON.stringify(record).length <= 4000
  );
}

// Attendance rules the server enforces on every record it receives:
//  - the event and the student must exist (and an organizer may only record at approved events);
//  - a NEW check-in must fall on the event's day (Philippine time, until 6 AM the next
//    morning for events that run past midnight) and must not be after the event was finished;
//  - once an event is finished nobody can still be inside, so a record with no time-out is
//    closed at the moment the event was finished.
// Records that were valid when they were scanned are kept even if they sync much later.
function checkAttendanceBatch(records, events, studentIds, knownIds, role) {
  const accepted = [];
  const dropped = [];
  for (const record of records) {
    if (!validAttendanceShape(record)) {
      if (plainRecord(record) && typeof record.id === 'string') dropped.push(record.id);
      continue;
    }
    const event = events.get(record.eventId);
    if (!event || !studentIds.has(record.studentId)) {
      dropped.push(record.id);
      continue;
    }
    if (role === 'organizer' && (event.approvalStatus ?? 'approved') !== 'approved') {
      dropped.push(record.id);
      continue;
    }
    if (!knownIds.has(record.id) && record.timeIn && !record.excused) {
      const at = Date.parse(record.timeIn);
      const dayStart = Date.parse(`${event.date}T00:00:00+08:00`);
      const insideEventDay = at >= dayStart && at < dayStart + 30 * 3600000;
      const afterFinish = event.finishedAt && at > Date.parse(event.finishedAt);
      if (!insideEventDay || afterFinish) {
        dropped.push(record.id);
        continue;
      }
    }
    accepted.push(closeIfFinished(record, event));
  }
  return { accepted, dropped };
}

// When everyone still inside an event is checked out by itself:
//  - the moment the admin finished it; otherwise
//  - 11:59 PM of the event's day (Philippine time), once that day has passed.
function eventClosedAt(event) {
  if (event.finishedAt) return event.finishedAt;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  return event.date && event.date < today
    ? new Date(`${event.date}T23:59:00+08:00`).toISOString()
    : null;
}

function closeIfFinished(record, event) {
  const closeAt = eventClosedAt(event);
  if (!closeAt || !record.timeIn || record.timeOut || record.excused) return record;
  const timeOut = Date.parse(closeAt) < Date.parse(record.timeIn) ? record.timeIn : closeAt;
  return {
    ...record,
    timeOut,
    durationMinutes: Math.max(
      0,
      Math.round((Date.parse(timeOut) - Date.parse(record.timeIn)) / 60000),
    ),
  };
}

async function coreState(env, organizationId) {
  const row = await env.DB.prepare(
    'SELECT state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(organizationId)
    .first();
  try {
    return JSON.parse(row?.state_json ?? '{}');
  } catch {
    return {};
  }
}

// Writes records and removals in one step and moves the cursor forward once.
// At most ATTENDANCE_PUSH_MAX upserts per call so one cursor value never covers a huge group.
async function writeAttendance(env, organizationId, upserts, removedIds) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO attendance_cursor (organization_id, value) VALUES (?, 0)',
  )
    .bind(organizationId)
    .run();
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      'UPDATE attendance_cursor SET value = value + 1 WHERE organization_id = ?',
    ).bind(organizationId),
  ];
  if (upserts.length) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO attendance_records
           (organization_id, id, event_id, student_id, data, deleted, seq, updated_at)
         SELECT ?1, json_extract(v.value, '$.id'), json_extract(v.value, '$.eventId'),
                json_extract(v.value, '$.studentId'), v.value, 0,
                (SELECT value FROM attendance_cursor WHERE organization_id = ?1), ?2
         FROM json_each(?3) v WHERE true
         ON CONFLICT (organization_id, id) DO UPDATE SET
           event_id = excluded.event_id, student_id = excluded.student_id,
           data = excluded.data, deleted = 0, seq = excluded.seq,
           updated_at = excluded.updated_at`,
      ).bind(organizationId, now, JSON.stringify(upserts)),
    );
  }
  if (removedIds.length) {
    statements.push(
      env.DB.prepare(
        `UPDATE attendance_records
         SET deleted = 1, updated_at = ?2,
             seq = (SELECT value FROM attendance_cursor WHERE organization_id = ?1)
         WHERE organization_id = ?1 AND deleted = 0
           AND id IN (SELECT value FROM json_each(?3))`,
      ).bind(organizationId, now, JSON.stringify(removedIds)),
    );
  }
  await env.DB.batch(statements);
}

// Marks records as removed (never really deleted, so every device learns about it and an
// accidental removal can still be recovered from the table for a while).
// `column` is 'event_id', 'student_id', or null for every record of the school.
async function removeAttendanceWhere(env, organizationId, column, values) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO attendance_cursor (organization_id, value) VALUES (?, 0)',
  )
    .bind(organizationId)
    .run();
  const now = new Date().toISOString();
  const filter = column
    ? `AND ${column === 'event_id' ? 'event_id' : 'student_id'} IN (SELECT value FROM json_each(?3))`
    : '';
  const statement = env.DB.prepare(
    `UPDATE attendance_records
     SET deleted = 1, updated_at = ?2,
         seq = (SELECT value FROM attendance_cursor WHERE organization_id = ?1)
     WHERE organization_id = ?1 AND deleted = 0 ${filter}`,
  );
  await env.DB.batch([
    env.DB.prepare(
      'UPDATE attendance_cursor SET value = value + 1 WHERE organization_id = ?',
    ).bind(organizationId),
    column
      ? statement.bind(organizationId, now, JSON.stringify(values))
      : statement.bind(organizationId, now),
  ]);
}

async function liveAttendanceCount(env, organizationId, eventId) {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM attendance_records WHERE organization_id = ? AND event_id = ? AND deleted = 0',
  )
    .bind(organizationId, eventId)
    .first();
  return row?.total ?? 0;
}

async function findAttendance(env, organizationId, eventId, studentId) {
  const { results } = await env.DB.prepare(
    `SELECT data FROM attendance_records
     WHERE organization_id = ? AND event_id = ? AND student_id = ? AND deleted = 0`,
  )
    .bind(organizationId, eventId, studentId)
    .all();
  return results.map((row) => JSON.parse(row.data));
}

// Everyone still inside an event that has just been finished is checked out at that moment.
async function closeOpenRecordsForEvents(env, organizationId, finishedEvents) {
  for (const event of finishedEvents) {
    const { results } = await env.DB.prepare(
      `SELECT data FROM attendance_records
       WHERE organization_id = ? AND event_id = ? AND deleted = 0
         AND json_extract(data, '$.timeOut') IS NULL
         AND COALESCE(json_extract(data, '$.timeIn'), '') <> ''
         AND COALESCE(json_extract(data, '$.excused'), 0) = 0`,
    )
      .bind(organizationId, event.id)
      .all();
    const closed = results.map((row) => closeIfFinished(JSON.parse(row.data), event));
    for (let index = 0; index < closed.length; index += ATTENDANCE_PUSH_MAX) {
      await writeAttendance(env, organizationId, closed.slice(index, index + ATTENDANCE_PUSH_MAX), []);
    }
  }
}

// Checks out everyone still inside an event that is over (see eventClosedAt).
async function closeAllOpenRecords(env, organizationId) {
  const state = await coreState(env, organizationId);
  const events = new Map((state.events ?? []).map((event) => [event.id, event]));
  const { results } = await env.DB.prepare(
    `SELECT data FROM attendance_records
     WHERE organization_id = ? AND deleted = 0
       AND json_extract(data, '$.timeOut') IS NULL
       AND COALESCE(json_extract(data, '$.timeIn'), '') <> ''
       AND COALESCE(json_extract(data, '$.excused'), 0) = 0`,
  )
    .bind(organizationId)
    .all();
  const closed = [];
  for (const row of results) {
    const record = JSON.parse(row.data);
    const event = events.get(record.eventId);
    if (!event) continue;
    const after = closeIfFinished(record, event);
    if (after !== record) closed.push(after);
  }
  for (let index = 0; index < closed.length; index += ATTENDANCE_PUSH_MAX) {
    await writeAttendance(env, organizationId, closed.slice(index, index + ATTENDANCE_PUSH_MAX), []);
  }
  return closed.length;
}

// GET /api/attendance?after=N  ->  what changed since the app's cursor.
async function listAttendance(url, user, env) {
  const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
  const cursorRow = await env.DB.prepare(
    'SELECT value FROM attendance_cursor WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  const latest = cursorRow?.value ?? 0;
  // An app that is "ahead" of the server (for example the database was restored) starts over.
  const reset = after > latest;
  const from = reset ? 0 : after;
  const onlyOwn = user.role === 'student';
  const filter = onlyOwn ? 'AND student_id = ?' : '';
  const bindings = onlyOwn
    ? [user.organization_id, from, user.student_id ?? '', ATTENDANCE_PAGE + 1]
    : [user.organization_id, from, ATTENDANCE_PAGE + 1];
  const { results } = await env.DB.prepare(
    `SELECT id, data, deleted, seq FROM attendance_records
     WHERE organization_id = ? AND seq > ? ${filter}
     ORDER BY seq, id LIMIT ?`,
  )
    .bind(...bindings)
    .all();
  let rows = results;
  let more = false;
  if (rows.length > ATTENDANCE_PAGE) {
    more = true;
    // Never split a group that shares one seq across two pages.
    const edge = rows[ATTENDANCE_PAGE].seq;
    const whole = rows.filter((row) => row.seq < edge);
    if (whole.length > 0) {
      rows = whole;
    } else {
      const group = await env.DB.prepare(
        `SELECT id, data, deleted, seq FROM attendance_records
         WHERE organization_id = ? AND seq = ? ${filter} ORDER BY id`,
      )
        .bind(...(onlyOwn ? [user.organization_id, edge, user.student_id ?? ''] : [user.organization_id, edge]))
        .all();
      rows = group.results;
    }
  }
  const records = [];
  const removed = [];
  for (const row of rows) {
    if (row.deleted) removed.push(row.id);
    else records.push(JSON.parse(row.data));
  }
  const cursor = rows.length ? rows[rows.length - 1].seq : more ? from : latest;
  return json({ cursor, records, removed, more, reset });
}

// PUT /api/attendance  { records: [...], removed: [ids] }
async function saveAttendance(request, user, env) {
  if (user.role !== 'super_admin' && user.role !== 'organizer') {
    return json({ error: 'Only staff can record attendance.' }, 403);
  }
  const body = await readJson(request);
  const records = Array.isArray(body?.records) ? body.records : [];
  const removed = Array.isArray(body?.removed)
    ? body.removed.filter((id) => typeof id === 'string' && id.length <= 200)
    : [];
  if (records.length > ATTENDANCE_PUSH_MAX || removed.length > ATTENDANCE_REMOVE_MAX) {
    return json({ error: 'Send attendance in smaller groups.' }, 413);
  }
  const state = await coreState(env, user.organization_id);
  const events = new Map((state.events ?? []).map((event) => [event.id, event]));
  const studentIds = new Set((state.students ?? []).map((student) => student.id));
  const ids = records.filter(validAttendanceShape).map((record) => record.id);
  const existing = new Map();
  if (ids.length) {
    const { results } = await env.DB.prepare(
      `SELECT id, data FROM attendance_records
       WHERE organization_id = ? AND id IN (SELECT value FROM json_each(?))`,
    )
      .bind(user.organization_id, JSON.stringify(ids))
      .all();
    for (const row of results) existing.set(row.id, JSON.parse(row.data));
  }
  const { accepted, dropped } = checkAttendanceBatch(
    records, events, studentIds, new Set(existing.keys()), user.role,
  );
  // Tell the app about anything the server changed, so both sides agree.
  const sentById = new Map(records.filter(plainRecord).map((record) => [record.id, record]));
  const adjusted = accepted.filter(
    (record) => JSON.stringify(record) !== JSON.stringify(sentById.get(record.id)),
  );
  // Remember which organizer recorded each new entry.
  const stamped = accepted.map((record) =>
    user.role === 'organizer' && !existing.has(record.id)
      ? { ...record, recordedBy: user.id, recordedByName: user.username }
      : record,
  );
  await writeAttendance(env, user.organization_id, stamped, removed);
  try {
    const eventName = (id) => events.get(id)?.name ?? id;
    const studentName = (id) => (state.students ?? []).find((s) => s.id === id)?.name ?? id;
    for (const record of accepted.slice(0, 40)) {
      const before = existing.get(record.id);
      if (record.manual && (!before || !before.manual || before.excused !== record.excused)) {
        await audit(env, user, record.excused ? 'attendance_excused' : 'attendance_manual',
          record.excused
            ? `Marked ${studentName(record.studentId)} excused for "${eventName(record.eventId)}"`
            : `Checked ${studentName(record.studentId)} in/out by hand at "${eventName(record.eventId)}"`);
      }
    }
    for (const id of removed.slice(0, 40)) {
      const { results } = await env.DB.prepare(
        'SELECT data FROM attendance_records WHERE organization_id = ? AND id = ?',
      ).bind(user.organization_id, id).all();
      const old = results[0] ? JSON.parse(results[0].data) : null;
      if (old?.manual) {
        await audit(env, user, 'attendance_undo',
          `Undid a by-hand entry for ${studentName(old.studentId)} at "${eventName(old.eventId)}"`);
      }
    }
  } catch {
    // Logging must never block saving.
  }
  return json({ dropped, records: adjusted });
}

// Older app versions still send and expect attendance inside the workspace.
async function legacyAttendanceInto(env, user, state, incoming) {
  const events = new Map((state.events ?? []).map((event) => [event.id, event]));
  const studentIds = new Set((state.students ?? []).map((student) => student.id));
  const valid = incoming.filter(validAttendanceShape).slice(0, 20000);
  for (let index = 0; index < valid.length; index += ATTENDANCE_PUSH_MAX) {
    const chunk = valid.slice(index, index + ATTENDANCE_PUSH_MAX);
    const { results } = await env.DB.prepare(
      `SELECT id, data FROM attendance_records
       WHERE organization_id = ? AND id IN (SELECT value FROM json_each(?))`,
    )
      .bind(user.organization_id, JSON.stringify(chunk.map((record) => record.id)))
      .all();
    const known = new Map(results.map((row) => [row.id, row.data]));
    const { accepted } = checkAttendanceBatch(chunk, events, studentIds, new Set(known.keys()), user.role);
    const changed = accepted.filter((record) => known.get(record.id) !== JSON.stringify(record));
    if (changed.length) await writeAttendance(env, user.organization_id, changed, []);
  }
}

async function legacyAttendanceFor(env, user) {
  const onlyOwn = user.role === 'student';
  const { results } = await env.DB.prepare(
    `SELECT data FROM attendance_records
     WHERE organization_id = ? AND deleted = 0 ${onlyOwn ? 'AND student_id = ?' : ''}`,
  )
    .bind(...(onlyOwn ? [user.organization_id, user.student_id ?? ''] : [user.organization_id]))
    .all();
  return results.map((row) => JSON.parse(row.data));
}

// Keeps the workspace row small: old sent texts and finished sync bookkeeping are dropped.
function pruneWorkspace(state) {
  const cutoff = Date.now() - MESSAGE_KEEP_DAYS * 86400000;
  const messages = Array.isArray(state.messages) ? state.messages : [];
  const queued = messages.filter((message) => message.status !== 'Sent');
  const sent = messages
    .filter((message) => message.status === 'Sent' && Date.parse(message.createdAt) >= cutoff)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, Math.max(0, MESSAGE_KEEP_MAX - queued.length));
  const keep = new Set([...queued, ...sent]);
  const syncItems = (Array.isArray(state.syncItems) ? state.syncItems : [])
    .filter((item) => item.status === 'Pending sync')
    .slice(-SYNC_ITEMS_KEEP);
  // The seating feature was removed; its old seat lists made up most of the workspace row.
  const events = (Array.isArray(state.events) ? state.events : []).map((event) => {
    if (!event || (!event.seatingPlan && (!event.seats || event.seats.length === 0))) return event;
    const { seatingPlan: _seatingPlan, ...rest } = event;
    return { ...rest, seats: [] };
  });
  return {
    ...state,
    events,
    attendance: [],
    messages: messages.filter((message) => keep.has(message)),
    syncItems,
  };
}

async function workspace(request, user, env) {
  // New apps ask for ?attendance=separate and sync attendance through /api/attendance.
  // Older apps keep sending and receiving attendance inside the workspace.
  const separate = new URL(request.url).searchParams.get('attendance') === 'separate';
  if (request.method === 'GET') {
    const row = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!row) return json({ error: 'The school workspace was not found.' }, 404);
    const state = JSON.parse(row.state_json);
    state.announcements ??= [];
    state.attendance = [];
    if (!validWorkspaceState(state)) {
      return json({ error: 'The saved school workspace is invalid.' }, 500);
    }
    const visible = user.role === 'student' ? studentWorkspace(state, user.student_id) : state;
    return json({
      revision: row.revision,
      state: separate ? visible : { ...visible, attendance: await legacyAttendanceFor(env, user) },
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
  let previousState;
  try {
    previousState = JSON.parse(current.state_json);
  } catch {
    return json({ error: 'The saved school workspace is invalid.' }, 500);
  }
  // Attendance never goes into the workspace row; old texts and finished bookkeeping are dropped.
  const incomingAttendance = Array.isArray(body.state.attendance) ? body.state.attendance : [];
  const cleaned = pruneWorkspace(body.state);
  const messagesPruned = (body.state.messages ?? []).length !== cleaned.messages.length;
  if (user.role === 'organizer') {
    const validationError = await validateOrganizerWorkspace(
      pruneWorkspace(previousState),
      cleaned,
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
      JSON.stringify(cleaned),
      new Date().toISOString(),
      user.organization_id,
      body.revision,
    )
    .run();
  if (result.meta.changes === 0) {
    const latest = await env.DB.prepare(
      'SELECT revision, state_json FROM workspace_state WHERE organization_id = ?',
    )
      .bind(user.organization_id)
      .first();
    if (!latest) return json({ error: 'The school workspace was not found.' }, 404);
    return json(
      { error: 'This workspace changed on another device.', revision: latest.revision, state: JSON.parse(latest.state_json) },
      409,
    );
  }
  try {
    // Events the admin has just finished: everyone still inside is checked out.
    const wasFinished = new Set(
      (previousState.events ?? []).filter((event) => event.finishedAt).map((event) => event.id),
    );
    const justFinished = (cleaned.events ?? []).filter(
      (event) => event.finishedAt && !wasFinished.has(event.id),
    );
    if (justFinished.length) await closeOpenRecordsForEvents(env, user.organization_id, justFinished);
    if (!separate && incomingAttendance.length) {
      await legacyAttendanceInto(env, user, cleaned, incomingAttendance);
    }
  } catch (error) {
    console.error('Attendance follow-up failed:', error);
  }
  try {
    await auditWorkspaceChange(env, user, previousState, cleaned);
  } catch {
    // Logging must never block saving.
  }
  // `refresh` tells the app the server trimmed something, so it should reload.
  return json({ revision: body.revision + 1, refresh: messagesPruned });
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
  await audit(env, user, 'section_saved', `Saved the section ${course} ${yearLevel} ${name}`);
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
    return json({ ...authUser(user), avatar: await avatarOf(env, user.id) });
  }
  if (path === '/api/account/password' && request.method === 'POST') {
    return changeOwnPassword(request, user, env);
  }
  const eventMatch = path.match(/^\/api\/events\/([^/]+)$/);
  if (eventMatch && request.method === 'DELETE') {
    return deleteEvent(user, env, decodeURIComponent(eventMatch[1]));
  }
  const adminUserMatch = path.match(/^\/api\/admin\/users\/([^/]+)(?:\/(disabled))?$/);
  if (adminUserMatch) {
    if (user.role !== 'super_admin') {
      return json({ error: 'Only the super admin can manage accounts.' }, 403);
    }
    const username = decodeURIComponent(adminUserMatch[1]);
    if (request.method === 'POST' && adminUserMatch[2] === 'disabled') {
      return setUserDisabled(request, user, env, username);
    }
    if (request.method === 'DELETE' && !adminUserMatch[2]) {
      return deleteManagedUser(user, env, username);
    }
  }
  if (path === '/api/admin/school-year') {
    if (user.role !== 'super_admin') {
      return json({ error: 'Only the super admin can manage the school year.' }, 403);
    }
    if (request.method === 'GET') return schoolYearSettings(user, env);
    if (request.method === 'PUT') return saveSchoolYear(request, user, env);
  }
  if (path === '/api/admin/audit' && request.method === 'GET') {
    return listAudit(request, user, env);
  }
  if (path === '/api/excuses' && request.method === 'POST') {
    return createExcuse(request, user, env);
  }
  if (path === '/api/excuses' && request.method === 'GET') {
    return listExcuses(request, user, env);
  }
  if (path === '/api/excuses/mine' && request.method === 'GET') {
    return myExcuses(user, env);
  }
  const excuseMatch = path.match(/^\/api\/excuses\/([^/]+)(?:\/(review))?$/);
  if (excuseMatch) {
    const excuseId = decodeURIComponent(excuseMatch[1]);
    if (request.method === 'POST' && excuseMatch[2] === 'review') {
      return reviewExcuse(request, user, env, excuseId);
    }
    if (request.method === 'GET' && !excuseMatch[2]) return getExcuse(user, env, excuseId);
    if (request.method === 'DELETE' && !excuseMatch[2]) return cancelExcuse(user, env, excuseId);
  }
  if (path === '/api/account/contact/request' && request.method === 'POST') {
    return requestContactChange(request, user, env);
  }
  if (path === '/api/account/contact/confirm' && request.method === 'POST') {
    return confirmContactChange(request, user, env);
  }
  if (path === '/api/account/username' && request.method === 'POST') {
    return changeOwnUsername(request, user, env);
  }
  if (path === '/api/profile/avatar' && request.method === 'PUT') {
    return saveAvatar(request, user, env);
  }
  if (path === '/api/profile/avatar' && request.method === 'DELETE') {
    return removeAvatar(user, env);
  }
  const avatarMatch = path.match(/^\/api\/students\/([^/]+)\/avatar$/);
  if (avatarMatch && request.method === 'GET') {
    return studentAvatar(user, env, decodeURIComponent(avatarMatch[1]));
  }
  if (request.method === 'DELETE' && path === '/api/admin/reset') {
    return resetSharedApp(user, env);
  }
  if (path === '/api/attendance' && request.method === 'GET') {
    return listAttendance(url, user, env);
  }
  if (path === '/api/attendance' && request.method === 'PUT') {
    return saveAttendance(request, user, env);
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
  // The daily trigger (see wrangler.toml).
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
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
