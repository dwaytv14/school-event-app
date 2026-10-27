PRAGMA foreign_keys = ON;

DROP INDEX IF EXISTS users_organization_student;
ALTER TABLE users RENAME TO users_before_roles;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'student', 'super_admin')),
  student_id TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (role = 'student' AND student_id IS NOT NULL) OR
    (role IN ('organizer', 'super_admin') AND student_id IS NULL)
  )
);

INSERT INTO users (
  id, organization_id, username, password_hash, auth_version, role, student_id, created_at
)
SELECT id, organization_id, username, password_hash, auth_version, role, student_id, created_at
FROM users_before_roles;

DROP TABLE users_before_roles;

CREATE UNIQUE INDEX users_organization_student
ON users (organization_id, student_id)
WHERE student_id IS NOT NULL;

CREATE TABLE sections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  course TEXT NOT NULL CHECK (course IN ('BSIT', 'BSBA', 'BSED', 'BEED')),
  year_level TEXT NOT NULL CHECK (year_level IN ('1st Year', '2nd Year', '3rd Year', '4th Year')),
  name TEXT NOT NULL,
  UNIQUE (organization_id, course, year_level, name)
);

UPDATE workspace_state
SET state_json = json_set(state_json, '$.announcements', json('[]'))
WHERE json_type(state_json, '$.announcements') IS NULL;

UPDATE workspace_state
SET state_json = json_set(
  state_json,
  '$.events',
  json(COALESCE((
    SELECT json_group_array(
      CASE
        WHEN json_type(event.value, '$.approvalStatus') IS NULL
          THEN json_set(event.value, '$.approvalStatus', 'approved')
        ELSE event.value
      END
    )
    FROM json_each(workspace_state.state_json, '$.events') AS event
  ), '[]'))
);
