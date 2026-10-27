import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express from 'express';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const requiredEnvironment = ['MYSQL_HOST', 'MYSQL_USER', 'MYSQL_DATABASE', 'JWT_SECRET'];
const mysqlEnvironment = {
  MYSQL_HOST: process.env.MYSQLHOST || process.env.MYSQL_HOST,
  MYSQL_USER: process.env.MYSQLUSER || process.env.MYSQL_USER,
  MYSQL_DATABASE: process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE,
  MYSQL_PORT: process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306',
  MYSQL_PASSWORD: process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '',
};
const missingEnvironment = requiredEnvironment.filter((name) => {
  if (name === 'JWT_SECRET') return !process.env.JWT_SECRET;
  return !mysqlEnvironment[name];
});
if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must contain at least 32 characters.');
}

const pool = mysql.createPool({
  host: mysqlEnvironment.MYSQL_HOST,
  port: Number(mysqlEnvironment.MYSQL_PORT),
  user: mysqlEnvironment.MYSQL_USER,
  password: mysqlEnvironment.MYSQL_PASSWORD,
  database: mysqlEnvironment.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

const app = express();
const allowedOrigins = (process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('This app origin is not allowed by CORS.'));
      }
    },
  }),
);
app.use(express.json({ limit: '2mb' }));

function emptyWorkspace() {
  return {
    students: [],
    events: [],
    attendance: [],
    violations: [],
    messages: [],
    syncItems: [],
  };
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '30d', issuer: 'school-event-api', audience: 'school-event-app' },
  );
}

function requireAuth(request, response, next) {
  const authorization = request.get('authorization') || '';
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : '';
  if (!token) {
    response.status(401).json({ error: 'Sign in to access this workspace.' });
    return;
  }
  try {
    request.user = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'school-event-api',
      audience: 'school-event-app',
    });
    next();
  } catch {
    response.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}

function validWorkspaceState(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['students', 'events', 'attendance', 'violations', 'messages', 'syncItems']
      .every((key) => Array.isArray(value[key]))
  );
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/auth/register', async (request, response, next) => {
  try {
    const username =
      typeof request.body?.username === 'string'
        ? request.body.username.trim().toLowerCase()
        : '';
    const password =
      typeof request.body?.password === 'string' ? request.body.password : '';
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
      response.status(400).json({
        error: 'Username must be 3–64 characters: letters, numbers, dots, dashes, or underscores.',
      });
      return;
    }
    if (password.length < 8 || password.length > 128) {
      response.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(password, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)',
        [userId, username, passwordHash],
      );
      await connection.execute(
        'INSERT INTO workspace_state (user_id, revision, state_json) VALUES (?, 0, ?)',
        [userId, JSON.stringify(emptyWorkspace())],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        response.status(409).json({ error: 'That username is already registered.' });
        return;
      }
      throw error;
    } finally {
      connection.release();
    }
    response.status(201).json({
      token: issueToken({ id: userId, username }),
      username,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const username =
      typeof request.body?.username === 'string'
        ? request.body.username.trim().toLowerCase()
        : '';
    const password =
      typeof request.body?.password === 'string' ? request.body.password : '';
    const [rows] = await pool.execute(
      'SELECT id, username, password_hash FROM users WHERE username = ?',
      [username],
    );
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      response.status(401).json({ error: 'Username or password is incorrect.' });
      return;
    }
    response.json({
      token: issueToken(user),
      username: user.username,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, (request, response) => {
  response.json({ username: request.user.username });
});

app.get('/api/workspace', requireAuth, async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT revision, state_json FROM workspace_state WHERE user_id = ?',
      [request.user.sub],
    );
    const workspace = rows[0];
    if (!workspace) {
      response.status(404).json({ error: 'Workspace was not found.' });
      return;
    }
    response.json({
      revision: Number(workspace.revision),
      state: JSON.parse(workspace.state_json),
    });
  } catch (error) {
    next(error);
  }
});

app.put('/api/workspace', requireAuth, async (request, response, next) => {
  if (
    !Number.isSafeInteger(request.body?.revision) ||
    request.body.revision < 0 ||
    !validWorkspaceState(request.body?.state)
  ) {
    response.status(400).json({ error: 'Workspace state or revision is invalid.' });
    return;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT revision, state_json FROM workspace_state WHERE user_id = ? FOR UPDATE',
      [request.user.sub],
    );
    const workspace = rows[0];
    if (!workspace) {
      await connection.rollback();
      response.status(404).json({ error: 'Workspace was not found.' });
      return;
    }
    const currentRevision = Number(workspace.revision);
    if (currentRevision !== request.body.revision) {
      await connection.rollback();
      response.status(409).json({
        error: 'This workspace changed on another device.',
        revision: currentRevision,
        state: JSON.parse(workspace.state_json),
      });
      return;
    }

    const revision = currentRevision + 1;
    await connection.execute(
      'UPDATE workspace_state SET revision = ?, state_json = ? WHERE user_id = ?',
      [revision, JSON.stringify(request.body.state), request.user.sub],
    );
    await connection.commit();
    response.json({ revision });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  if (response.headersSent) return;
  response.status(500).json({ error: 'The server could not complete the request.' });
});

const port = Number(process.env.PORT || 3000);
await pool.query(`CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`);
await pool.query(`CREATE TABLE IF NOT EXISTS workspace_state (
  user_id CHAR(36) NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  state_json LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_workspace_state_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`);
await pool.query('SELECT 1');
app.listen(port, '0.0.0.0', () => {
  console.log(`School Event API listening on port ${port}`);
});
