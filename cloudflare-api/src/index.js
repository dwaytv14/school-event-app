const WORKSPACE_KEYS = [
  'students',
  'events',
  'attendance',
  'violations',
  'messages',
  'syncItems',
];
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

async function registerFirstOrganizer(body, env) {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  if (!validUsername(username)) {
    return json(
      { error: 'Username must be 3–64 characters: letters, numbers, dots, dashes, or underscores.' },
      400,
    );
  }
  if (!validPassword(password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }

  const userId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, created_at)
         SELECT ?, 'School workspace', ?
         WHERE (SELECT value FROM app_metadata WHERE key = 'bootstrap_complete') = '0'`,
      ).bind(organizationId, now),
      env.DB.prepare(
        `INSERT INTO users
          (id, organization_id, username, password_hash, role, student_id, created_at)
         SELECT ?, ?, ?, ?, 'organizer', NULL, ?
         WHERE (SELECT value FROM app_metadata WHERE key = 'bootstrap_complete') = '0'`,
      ).bind(userId, organizationId, username, passwordHash, now),
      env.DB.prepare(
        `INSERT INTO workspace_state (organization_id, revision, state_json, updated_at)
         SELECT ?, 0, ?, ?
         WHERE (SELECT value FROM app_metadata WHERE key = 'bootstrap_complete') = '0'`,
      ).bind(organizationId, JSON.stringify(emptyWorkspace()), now),
      env.DB.prepare(
        `UPDATE app_metadata SET value = '1'
         WHERE key = 'bootstrap_complete' AND value = '0'`,
      ),
    ]);
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed: users.username')) {
      return json({ error: 'That username is already registered.' }, 409);
    }
    console.error('Organizer bootstrap failed:', error);
    return json({ error: 'The first organizer account could not be created.' }, 500);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, organization_id, role, student_id, auth_version FROM users WHERE id = ?',
  )
    .bind(userId)
    .first();
  if (!user) {
    return json(
      { error: 'The school workspace has already been set up. Ask an organizer to create your account.' },
      403,
    );
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
  if (user.role !== 'organizer') {
    return json({ error: 'Only organizers can manage accounts.' }, 403);
  }
  const body = await readJson(request);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = body?.password;
  const role = body?.role;
  const studentId = typeof body?.studentId === 'string' ? body.studentId.trim() : '';
  if (!validUsername(username)) {
    return json({ error: 'Enter a username using 3–64 letters, numbers, dots, dashes, or underscores.' }, 400);
  }
  if (!validPassword(password)) {
    return json({ error: 'Password must be 8–128 characters.' }, 400);
  }
  if (!['organizer', 'student'].includes(role)) {
    return json({ error: 'Choose organizer or student as the account role.' }, 400);
  }
  if (role === 'student' && !studentId) {
    return json({ error: 'Select the roster student linked to this account.' }, 400);
  }
  if (role === 'organizer' && studentId) {
    return json({ error: 'Organizer accounts cannot be linked to a student record.' }, 400);
  }

  const workspace = await env.DB.prepare(
    'SELECT state_json FROM workspace_state WHERE organization_id = ?',
  )
    .bind(user.organization_id)
    .first();
  if (!workspace) return json({ error: 'The school workspace was not found.' }, 404);
  if (role === 'student') {
    let state;
    try {
      state = JSON.parse(workspace.state_json);
    } catch {
      return json({ error: 'The saved school workspace is invalid.' }, 500);
    }
    if (!state.students?.some((student) => student.id === studentId)) {
      return json({ error: 'Add this student to the roster and sync before creating an account.' }, 400);
    }
  }

  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, organization_id, username, password_hash, role, student_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.organization_id,
        username,
        await hashPassword(password),
        role,
        role === 'student' ? studentId : null,
        new Date().toISOString(),
      )
      .run();
  } catch (error) {
    if (error?.message?.includes('UNIQUE constraint failed: users.username')) {
      return json({ error: 'That username is already registered.' }, 409);
    }
    if (error?.message?.includes('users.organization_id, users.student_id')) {
      return json({ error: 'A login account is already linked to this student.' }, 409);
    }
    console.error('Account creation failed:', error);
    return json({ error: 'The account could not be created.' }, 500);
  }
  return json({ username, role, studentId: role === 'student' ? studentId : null }, 201);
}

async function resetAccountPassword(request, user, env, username) {
  if (user.role !== 'organizer') {
    return json({ error: 'Only organizers can reset account passwords.' }, 403);
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
      .filter((event) => Array.isArray(event.sections) && event.sections.includes(student.section))
      .map((event) => ({
        ...event,
        seats: Array.isArray(event.seats)
          ? event.seats.filter((seat) => seat.studentId === studentId)
          : [],
      })),
    attendance: state.attendance.filter((record) => record.studentId === studentId),
    violations: state.violations.filter((item) => item.studentId === studentId),
    messages: [],
    syncItems: [],
  };
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
    if (!validWorkspaceState(state)) {
      return json({ error: 'The saved school workspace is invalid.' }, 500);
    }
    return json({
      revision: row.revision,
      state: user.role === 'student' ? studentWorkspace(state, user.student_id) : state,
    });
  }

  if (user.role !== 'organizer') {
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
    return registerFirstOrganizer(await readJson(request), env);
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
  if (path === '/api/accounts' && request.method === 'GET') {
    if (user.role !== 'organizer') {
      return json({ error: 'Only organizers can view school accounts.' }, 403);
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
