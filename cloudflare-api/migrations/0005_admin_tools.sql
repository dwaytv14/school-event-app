-- Turn an account off without deleting it.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;

-- Who did what, and when.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_org_at ON audit_log (organization_id, at);

-- Student requests to be excused from an event.
CREATE TABLE IF NOT EXISTS excuse_requests (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  section_label TEXT NOT NULL,
  reason TEXT NOT NULL,
  photo TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_note TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_name TEXT
);
CREATE INDEX IF NOT EXISTS excuse_requests_org_status ON excuse_requests (organization_id, status, created_at);
CREATE INDEX IF NOT EXISTS excuse_requests_student ON excuse_requests (organization_id, student_id);
