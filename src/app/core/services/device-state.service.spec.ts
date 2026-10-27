import { TestBed } from '@angular/core/testing';
import { AppState } from '../models/school-event.models';
import { DeviceStateService } from './device-state.service';
import { SqliteConnectionService } from './sqlite-connection.service';

const emptyState: AppState = {
  role: null,
  studentId: '',
  selectedEventId: '',
  simulatedOffline: false,
  students: [],
  events: [],
  attendance: [],
  violations: [],
  messages: [],
  syncItems: [],
  announcements: [],
};

describe('DeviceStateService', () => {
  let device: DeviceStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [DeviceStateService, SqliteConnectionService],
    });
    device = TestBed.inject(DeviceStateService);
  });

  it('persists a pending full-workspace reset', async () => {
    await device.save('organizer', emptyState, 4, true, true);

    await expect(device.load('organizer')).resolves.toEqual({
      snapshot: device.createSnapshot(emptyState, 4),
      dirty: true,
      resetPending: true,
    });
  });

  it('loads existing browser cache entries without reset metadata', async () => {
    const snapshot = device.createSnapshot(emptyState, 2);
    localStorage.setItem(
      'school-event-workspace-cache-v1:organizer',
      JSON.stringify({ snapshot, dirty: true }),
    );

    await expect(device.load('organizer')).resolves.toEqual({
      snapshot,
      dirty: true,
      resetPending: false,
    });
  });
});
