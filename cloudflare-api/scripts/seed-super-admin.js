import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptDirectory, '..');
const wranglerEntrypoint = join(
  projectDirectory,
  'node_modules',
  'wrangler',
  'bin',
  'wrangler.js',
);
const password = process.env.SUPER_ADMIN_PASSWORD;

if (!password || password.length < 8 || password.length > 128) {
  throw new Error('Set SUPER_ADMIN_PASSWORD to an 8–128 character password before seeding.');
}

const salt = randomBytes(16);
const passwordHash = pbkdf2Sync(password, salt, 100_000, 32, 'sha256');
const storedHash = [
  'pbkdf2-sha256',
  '100000',
  salt.toString('base64url'),
  passwordHash.toString('base64url'),
].join('$');
const organizationId = randomUUID();
const now = new Date().toISOString();
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const args = [
  wranglerEntrypoint,
  'd1',
  'execute',
  'gather-school-data',
  '--remote',
  '--config',
  'wrangler.toml',
  '--command',
];

function execute(sql) {
  execFileSync(process.execPath, [...args, sql], {
    cwd: projectDirectory,
    stdio: 'inherit',
  });
}

execute(
  `INSERT OR IGNORE INTO organizations (id, name, created_at) ` +
    `SELECT ${quote(organizationId)}, 'School workspace', ${quote(now)} ` +
    `WHERE NOT EXISTS (SELECT 1 FROM organizations);`,
);
execute(
  `INSERT OR IGNORE INTO workspace_state (organization_id, revision, state_json, updated_at) ` +
    `SELECT id, 0, '{"students":[],"events":[],"attendance":[],"violations":[],"messages":[],"syncItems":[],"announcements":[]}', ${quote(now)} ` +
    `FROM organizations ORDER BY created_at LIMIT 1;`,
);
execute(
  `INSERT OR IGNORE INTO users (id, organization_id, username, password_hash, role, student_id, created_at) ` +
    `SELECT ${quote(randomUUID())}, id, 'PPY-ADMIN', ${quote(storedHash)}, 'super_admin', NULL, ${quote(now)} ` +
    `FROM organizations ORDER BY created_at LIMIT 1;`,
);

console.log('Super admin seed complete for username PPY-ADMIN.');
