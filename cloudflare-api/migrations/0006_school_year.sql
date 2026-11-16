-- The school year end date and the automatic year-level promotion.
CREATE TABLE IF NOT EXISTS school_settings (
  organization_id TEXT PRIMARY KEY NOT NULL,
  school_year_end TEXT,
  promotion_enabled INTEGER NOT NULL DEFAULT 0,
  last_promoted_for TEXT,
  updated_at TEXT NOT NULL
);

-- A copy of the school data taken right before students are promoted or removed.
CREATE TABLE IF NOT EXISTS workspace_backups (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  state_json TEXT NOT NULL,
  users_json TEXT
);
CREATE INDEX IF NOT EXISTS workspace_backups_org ON workspace_backups (organization_id, created_at);
