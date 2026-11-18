-- Attendance used to live inside the one big workspace JSON. That row has a size
-- limit, so it would stop saving after a few thousand check-ins. Every record
-- now has its own row, and apps only download what changed since last time.

CREATE TABLE IF NOT EXISTS attendance_records (
  organization_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  data TEXT NOT NULL,
  -- 1 = removed. The row is kept so every device learns about the removal.
  deleted INTEGER NOT NULL DEFAULT 0,
  -- Moves forward every time the row changes; apps ask for "everything after N".
  seq INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, id)
);

CREATE INDEX IF NOT EXISTS attendance_by_seq
  ON attendance_records (organization_id, seq);
CREATE INDEX IF NOT EXISTS attendance_by_event
  ON attendance_records (organization_id, event_id);
CREATE INDEX IF NOT EXISTS attendance_by_student
  ON attendance_records (organization_id, student_id, seq);

CREATE TABLE IF NOT EXISTS attendance_cursor (
  organization_id TEXT PRIMARY KEY NOT NULL,
  value INTEGER NOT NULL DEFAULT 0
);

-- Move the records that are already saved out of the workspace JSON.
INSERT OR IGNORE INTO attendance_records
  (organization_id, id, event_id, student_id, data, deleted, seq, updated_at)
SELECT organization_id, id, event_id, student_id, data, 0,
       ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY ord),
       datetime('now')
FROM (
  SELECT w.organization_id AS organization_id,
         json_extract(a.value, '$.id') AS id,
         json_extract(a.value, '$.eventId') AS event_id,
         json_extract(a.value, '$.studentId') AS student_id,
         a.value AS data,
         a.key AS ord
  FROM workspace_state w, json_each(w.state_json, '$.attendance') a
  WHERE json_extract(a.value, '$.id') IS NOT NULL
    AND json_extract(a.value, '$.eventId') IS NOT NULL
    AND json_extract(a.value, '$.studentId') IS NOT NULL
);

INSERT OR IGNORE INTO attendance_cursor (organization_id, value)
SELECT id, 0 FROM organizations;

UPDATE attendance_cursor
SET value = COALESCE(
  (SELECT MAX(seq) FROM attendance_records r
   WHERE r.organization_id = attendance_cursor.organization_id), 0);

-- The workspace JSON no longer carries attendance.
UPDATE workspace_state
SET state_json = json_set(state_json, '$.attendance', json('[]'))
WHERE json_type(state_json, '$.attendance') IS NOT NULL;
