import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AttendanceRecord, SchoolEvent } from '../models/school-event.models';
import { WorkspaceSyncService } from './workspace-sync.service';
import { WorkspaceSnapshot } from './workspace-api.service';

const event: SchoolEvent = {
  id: 'E1', name: 'Fest', date: '2030-03-10', startTime: '08:00', endTime: '12:00',
  venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
};
const record = (id: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id, eventId: 'E1', studentId: id, timeIn: '', timeOut: null, durationMinutes: null,
  status: 'Excused', syncStatus: 'Synced', excused: true, ...extra,
});
const snapshot = (events: SchoolEvent[], attendance: AttendanceRecord[]): WorkspaceSnapshot => ({
  revision: 1,
  state: { students: [], events, attendance, violations: [], messages: [], syncItems: [], announcements: [] },
});

describe('WorkspaceSyncService merging', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });
  afterEach(() => TestBed.inject(WorkspaceSyncService).destroy());

  const merge = (remote: WorkspaceSnapshot, local: WorkspaceSnapshot): WorkspaceSnapshot =>
    (TestBed.inject(WorkspaceSyncService) as unknown as {
      mergeSnapshots(r: WorkspaceSnapshot, l: WorkspaceSnapshot): WorkspaceSnapshot;
    }).mergeSnapshots(remote, local);

  it('closes a check-in that arrives after the event was finished', () => {
    const finished = { ...event, finishedAt: '2030-03-10T17:00:00+08:00' };
    const straggler = record('C', { excused: false, timeIn: '2030-03-10T09:00:00+08:00', status: 'Incomplete' });
    const merged = merge(snapshot([finished], []), snapshot([finished], [straggler]));
    expect(merged.state.attendance[0].timeOut).toBe('2030-03-10T17:00:00+08:00');
  });
});
