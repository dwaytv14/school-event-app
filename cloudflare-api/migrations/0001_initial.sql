PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_metadata (key, value)
VALUES ('bootstrap_complete', '0');

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'student')),
  student_id TEXT,
  created_at TEXT NOT NULL,
  CHECK ((role = 'student' AND student_id IS NOT NULL) OR role = 'organizer')
);

CREATE UNIQUE INDEX IF NOT EXISTS users_organization_student
ON users (organization_id, student_id)
WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS workspace_state (
  organization_id TEXT PRIMARY KEY NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
