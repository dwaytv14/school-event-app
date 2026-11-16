-- A pending contact-number change, confirmed with a 6-digit code.
CREATE TABLE IF NOT EXISTS contact_changes (
  user_id TEXT PRIMARY KEY NOT NULL,
  mobile TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
