import { describe, expect, it } from 'vitest';
import { AttendanceRecord } from '../models/school-event.models';
import {
  AttendancePull,
  AttendanceSyncInfo,
  applyPulled,
  emptyAttendanceSync,
  localChanges,
  recordHash,
} from './attendance-sync';

const record = (id: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id, eventId: 'E1', studentId: `S-${id}`, timeIn: '2030-03-10T08:00:00+08:00', timeOut: null,
  durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced', ...extra,
});

/** The same rules as the real server: a cursor that moves forward, removals are kept as markers. */
class FakeServer {
  private seq = 0;
  private rows = new Map<string, { record: AttendanceRecord; deleted: boolean; seq: number }>();
  pull(after: number): AttendancePull & { cursor: number } {
    const records: AttendanceRecord[] = [];
    const removed: string[] = [];
    for (const [id, row] of this.rows) {
      if (row.seq <= after) continue;
      if (row.deleted) removed.push(id);
      else records.push(row.record);
    }
    return { records, removed, cursor: this.seq };
  }
  push(records: AttendanceRecord[], removed: string[]): void {
    this.seq += 1;
    for (const r of records) this.rows.set(r.id, { record: structuredClone(r), deleted: false, seq: this.seq });
    for (const id of removed) {
      const row = this.rows.get(id);
      if (row) this.rows.set(id, { ...row, deleted: true, seq: this.seq });
    }
  }
  live(): string[] {
    return [...this.rows].filter(([, row]) => !row.deleted).map(([id]) => id).sort();
  }
}

/** One phone: its records and what it knows about the server. */
class Device {
  records: AttendanceRecord[] = [];
  info: AttendanceSyncInfo = emptyAttendanceSync();
  constructor(private readonly server: FakeServer) {}
  sync(): void {
    this.pull();
    const { changed, removed } = localChanges(this.records, this.info);
    if (changed.length || removed.length) {
      this.server.push(changed, removed);
      for (const r of changed) this.info.hashes[r.id] = recordHash(r);
      for (const id of removed) delete this.info.hashes[id];
      this.pull();
    }
  }
  private pull(): void {
    const page = this.server.pull(this.info.cursor);
    this.records = applyPulled(this.records, this.info, page);
    this.info.cursor = page.cursor;
  }
  ids(): string[] {
    return this.records.map((r) => r.id).sort();
  }
}

describe('attendance sync', () => {
  it('shares a new check-in with the other phone', () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    a.records.push(record('1'));
    a.sync();
    b.sync();
    expect(b.ids()).toEqual(['1']);
  });

  it('sends only what changed, not everything again', () => {
    const server = new FakeServer();
    const a = new Device(server);
    a.records = [record('1'), record('2'), record('3')];
    a.sync();
    expect(localChanges(a.records, a.info)).toEqual({ changed: [], removed: [] });
    a.records[1] = { ...a.records[1], timeOut: '2030-03-10T11:00:00+08:00' };
    expect(localChanges(a.records, a.info).changed.map((r) => r.id)).toEqual(['2']);
  });

  it('keeps an undo undone, on this phone and on the other phone', () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    a.records.push(record('1'), record('2'));
    a.sync();
    b.sync();
    a.records = a.records.filter((r) => r.id !== '1'); // undo on A
    a.sync();
    expect(a.ids()).toEqual(['2']); // the server copy does not come back
    b.sync();
    expect(b.ids()).toEqual(['2']);
    expect(server.live()).toEqual(['2']);
  });

  it('does not lose a change made here while the server also moved on', () => {
    const server = new FakeServer();
    const a = new Device(server);
    const b = new Device(server);
    a.records.push(record('1'));
    a.sync();
    b.sync();
    // B checks the student out; A (not yet synced) also edits another record.
    b.records[0] = { ...b.records[0], timeOut: '2030-03-10T11:00:00+08:00', status: 'Present' };
    a.records.push(record('2'));
    b.sync();
    a.sync();
    expect(a.ids()).toEqual(['1', '2']);
    expect(a.records.find((r) => r.id === '1')?.timeOut).toBe('2030-03-10T11:00:00+08:00');
  });

  it('keeps a local change that has not been sent when the server sends an older copy', () => {
    const info = emptyAttendanceSync();
    const synced = record('1');
    info.hashes['1'] = recordHash(synced);
    const edited = { ...synced, timeOut: '2030-03-10T11:00:00+08:00' };
    const result = applyPulled([edited], info, { records: [synced], removed: [] });
    expect(result[0].timeOut).toBe('2030-03-10T11:00:00+08:00');
    expect(localChanges(result, info).changed.map((r) => r.id)).toEqual(['1']);
  });

  it('treats an identical record on a first run as already in sync', () => {
    const info = emptyAttendanceSync();
    const mine = record('1');
    const result = applyPulled([mine], info, { records: [structuredClone(mine)], removed: [] });
    expect(result).toHaveLength(1);
    expect(localChanges(result, info)).toEqual({ changed: [], removed: [] });
  });

  it('is not fooled by the order of fields inside a record', () => {
    const one = { id: 'x', eventId: 'E', studentId: 'S', timeIn: 't', timeOut: null, durationMinutes: null, status: 'Present', syncStatus: 'Synced' } as AttendanceRecord;
    const two = { syncStatus: 'Synced', status: 'Present', durationMinutes: null, timeOut: null, timeIn: 't', studentId: 'S', eventId: 'E', id: 'x' } as AttendanceRecord;
    expect(recordHash(one)).toBe(recordHash(two));
    expect(recordHash(one)).not.toBe(recordHash({ ...one, status: 'Late' }));
  });

  it('handles a school-size history quickly', () => {
    const many = Array.from({ length: 20000 }, (_, i) => record(String(i)));
    const info = emptyAttendanceSync();
    const started = Date.now();
    const first = applyPulled([], info, { records: many, removed: [] });
    const diff = localChanges(first, info);
    expect(first).toHaveLength(20000);
    expect(diff.changed).toHaveLength(0);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
