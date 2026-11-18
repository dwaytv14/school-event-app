import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AttendanceRecord } from '../models/school-event.models';
import { AttendanceSyncService } from './attendance-sync.service';
import { AuthService } from './auth.service';
import { DemoStoreService } from './demo-store.service';
import { AttendancePage, AttendancePushResult, WorkspaceApiService } from './workspace-api.service';

const record = (id: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id, eventId: 'E1', studentId: `S-${id}`, timeIn: '2030-03-10T08:00:00+08:00', timeOut: null,
  durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced', ...extra,
});

describe('AttendanceSyncService', () => {
  const role = signal<'super_admin' | 'organizer' | 'student'>('organizer');
  const pages: AttendancePage[] = [];
  const pushes: { records: AttendanceRecord[]; removed: string[] }[] = [];
  const pulls: number[] = [];
  let pushResult: AttendancePushResult = { dropped: [], records: [] };

  const api = {
    loadAttendance: async (_token: string, after: number): Promise<AttendancePage> => {
      pulls.push(after);
      return pages.shift() ?? { cursor: after, records: [], removed: [], more: false, reset: false };
    },
    saveAttendance: async (_token: string, body: { records: AttendanceRecord[]; removed: string[] }) => {
      pushes.push(body);
      return pushResult;
    },
  };

  beforeEach(() => {
    localStorage.clear();
    pages.length = 0;
    pushes.length = 0;
    pulls.length = 0;
    pushResult = { dropped: [], records: [] };
    role.set('organizer');
    TestBed.configureTestingModule({
      providers: [
        { provide: WorkspaceApiService, useValue: api },
        { provide: AuthService, useValue: { role, getToken: () => 'token' } },
      ],
    });
  });

  const state = () => TestBed.inject(DemoStoreService).state().attendance;
  const setLocal = (records: AttendanceRecord[]) => {
    const store = TestBed.inject(DemoStoreService);
    store.replace({ ...store.state(), attendance: records }, false);
  };

  it('downloads every page, one after the other, from where it left off', async () => {
    pages.push(
      { cursor: 3, records: [record('1'), record('2')], removed: [], more: true, reset: false },
      { cursor: 5, records: [record('3')], removed: [], more: false, reset: false },
    );
    const service = TestBed.inject(AttendanceSyncService);
    await service.sync();
    expect(state().map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(pulls).toEqual([0, 3]);
    expect(service.snapshot().cursor).toBe(5);
    await service.sync();
    expect(pulls.at(-1)).toBe(5); // the next sync only asks for what is new
  });

  it('sends what was recorded here, and only once', async () => {
    const service = TestBed.inject(AttendanceSyncService);
    setLocal([record('1')]);
    expect(service.hasUnsynced()).toBe(true);
    await service.sync();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].records.map((r) => r.id)).toEqual(['1']);
    expect(service.hasUnsynced()).toBe(false);
    await service.sync();
    expect(pushes).toHaveLength(1);
  });

  it('sends a removal made here', async () => {
    const service = TestBed.inject(AttendanceSyncService);
    setLocal([record('1')]);
    await service.sync();
    setLocal([]);
    expect(service.hasUnsynced()).toBe(true);
    await service.sync();
    expect(pushes.at(-1)).toEqual({ records: [], removed: ['1'] });
    expect(service.hasUnsynced()).toBe(false);
  });

  it('drops a record the server refused and takes the server\'s adjusted copy of another', async () => {
    const service = TestBed.inject(AttendanceSyncService);
    setLocal([record('bad'), record('open')]);
    pushResult = {
      dropped: ['bad'],
      records: [record('open', { timeOut: '2030-03-10T17:00:00+08:00', status: 'Present' })],
    };
    await service.sync();
    expect(state().map((r) => r.id)).toEqual(['open']);
    expect(state()[0].timeOut).toBe('2030-03-10T17:00:00+08:00');
    expect(service.hasUnsynced()).toBe(false);
  });

  it('a student only downloads, never sends', async () => {
    role.set('student');
    const service = TestBed.inject(AttendanceSyncService);
    setLocal([record('mine')]);
    pages.push({ cursor: 1, records: [record('mine', { timeOut: '2030-03-10T11:00:00+08:00' })], removed: [], more: false, reset: false });
    expect(service.hasUnsynced()).toBe(false);
    await service.sync();
    expect(pushes).toHaveLength(0);
  });

  it('starts over when the server says its history is older', async () => {
    const service = TestBed.inject(AttendanceSyncService);
    service.restore({ cursor: 900, hashes: {} });
    pages.push({ cursor: 2, records: [record('1')], removed: [], more: false, reset: true });
    await service.sync();
    expect(service.snapshot().cursor).toBe(2);
    expect(state().map((r) => r.id)).toEqual(['1']);
  });

  it('keeps unsent changes if sending fails, and tries again next time', async () => {
    const service = TestBed.inject(AttendanceSyncService);
    setLocal([record('1')]);
    const original = api.saveAttendance;
    api.saveAttendance = async () => { throw new Error('offline'); };
    await expect(service.sync()).rejects.toThrow('offline');
    expect(service.hasUnsynced()).toBe(true);
    api.saveAttendance = original;
    await service.sync();
    expect(service.hasUnsynced()).toBe(false);
  });
});
