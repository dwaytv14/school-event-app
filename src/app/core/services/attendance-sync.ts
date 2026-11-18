import { AttendanceRecord } from '../models/school-event.models';

/**
 * What this device knows about the server's attendance:
 *  - `cursor`: "I have everything up to here", so the next pull only brings what changed;
 *  - `hashes`: a short fingerprint of every record as the server last had it. A record whose
 *    fingerprint changed (or is missing) must be sent; a fingerprint with no record left
 *    means the record was removed here and the removal must be sent.
 */
export interface AttendanceSyncInfo {
  cursor: number;
  hashes: Record<string, string>;
}

export interface AttendancePull {
  records: AttendanceRecord[];
  removed: string[];
}

export function emptyAttendanceSync(): AttendanceSyncInfo {
  return { cursor: 0, hashes: {} };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a record (two independent 32-bit hashes + length). */
export function recordHash(record: AttendanceRecord): string {
  const text = stable(record);
  let first = 0x811c9dc5;
  let second = 0x1b873593;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second + code, 0x85ebca6b) ^ (second >>> 13);
  }
  return `${(first >>> 0).toString(36)}.${(second >>> 0).toString(36)}.${text.length.toString(36)}`;
}

/** What has to be sent: records that are new or changed here, and ids removed here. */
export function localChanges(
  local: AttendanceRecord[],
  info: AttendanceSyncInfo,
): { changed: AttendanceRecord[]; removed: string[] } {
  const present = new Set<string>();
  const changed: AttendanceRecord[] = [];
  for (const record of local) {
    present.add(record.id);
    if (info.hashes[record.id] !== recordHash(record)) changed.push(record);
  }
  const removed = Object.keys(info.hashes).filter((id) => !present.has(id));
  return { changed, removed };
}

/**
 * Applies what the server sent. A record that was changed here and not sent yet is kept
 * (it will be sent next), everything else takes the server's version.
 * `info.hashes` is updated in place; the new list of records is returned.
 */
export function applyPulled(
  local: AttendanceRecord[],
  info: AttendanceSyncInfo,
  pulled: AttendancePull,
): AttendanceRecord[] {
  const byId = new Map(local.map((record) => [record.id, record]));
  const removedHere = new Set<string>();
  const replacements = new Map<string, AttendanceRecord>();

  for (const id of pulled.removed) {
    const mine = byId.get(id);
    if (!mine) {
      delete info.hashes[id];
    } else if (info.hashes[id] === recordHash(mine)) {
      removedHere.add(id);
      delete info.hashes[id];
    }
    // else: changed here after the removal; keep it, it will be sent again.
  }

  for (const incoming of pulled.records) {
    const mine = byId.get(incoming.id);
    const known = info.hashes[incoming.id];
    if (mine && known !== recordHash(mine)) {
      // Changed here and not sent yet. On a first run (nothing known) an identical copy is simply in sync.
      if (known === undefined && recordHash(mine) === recordHash(incoming)) {
        info.hashes[incoming.id] = recordHash(incoming);
      }
      continue;
    }
    replacements.set(incoming.id, incoming);
    info.hashes[incoming.id] = recordHash(incoming);
  }

  const kept = local
    .filter((record) => !removedHere.has(record.id))
    .map((record) => replacements.get(record.id) ?? record);
  const existing = new Set(local.map((record) => record.id));
  for (const [id, record] of replacements) {
    if (!existing.has(id)) kept.push(record);
  }
  return kept;
}
