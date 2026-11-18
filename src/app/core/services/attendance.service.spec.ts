import { TestBed } from '@angular/core/testing';
import { AttendanceService } from './attendance.service';
import { DemoStoreService } from './demo-store.service';
import { EventService } from './event.service';

const eventInput = {
  name: 'Test event',
  date: '2026-12-01',
  startTime: '09:00',
  endTime: '15:00',
  venue: 'Test hall',
  description: '',
  graceMinutes: 10,
};

describe('event attendance rules', () => {
  let store: DemoStoreService;
  let attendance: AttendanceService;
  const sections = [
    { id: 'grade-10-a', label: 'Grade 10-A' },
    { id: 'grade-10-b', label: 'Grade 10-B' },
    { id: 'grade-11-a', label: 'Grade 11-A' },
  ];

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AttendanceService, DemoStoreService],
    });
    store = TestBed.inject(DemoStoreService);
    store.update((state) => {
      state.students = Array.from({ length: 30 }, (_, index) => ({
        id: `STU-${String(index + 1).padStart(3, '0')}`,
        name: `Test student ${index + 1}`,
        section: `Grade ${index < 10 ? '10-A' : index < 20 ? '10-B' : '11-A'}`,
        mobile: `+6390000${String(index + 1).padStart(4, '0')}`,
        sectionId: sections[index < 10 ? 0 : index < 20 ? 1 : 2].id,
      }));
    });
    TestBed.inject(EventService).save(
      { ...eventInput, requiredSections: sections.map((section) => section.id) },
      undefined,
      sections,
    );
    attendance = TestBed.inject(AttendanceService);
  });

  it('records time-in and time-out for a student in a selected section', () => {
    const event = store.state().events[0];
    const firstScan = attendance.scan(event.id, 'STU-001', true);
    const secondScan = attendance.scan(event.id, 'STU-001', true, new Date(Date.now() + 3 * 60000));

    expect(firstScan.accepted).toBe(true);
    expect(firstScan.message).toContain('IN');
    expect(firstScan.record?.timeOut).toBeNull();
    expect(secondScan.accepted).toBe(true);
    expect(secondScan.message).toContain('OUT');
    expect(secondScan.record?.timeOut).not.toBeNull();
    expect(secondScan.record?.durationMinutes).not.toBeNull();
  });

  it('does not check a student OUT seconds after checking them IN', () => {
    const event = store.state().events[0];
    attendance.scan(event.id, 'STU-001', true);

    const tooSoon = attendance.scan(event.id, 'STU-001', true, new Date(Date.now() + 5000));
    expect(tooSoon.accepted).toBe(false);
    expect(tooSoon.message).toContain('Check-out opens in');
    expect(store.state().attendance[0].timeOut).toBeNull();

    const afterTwoMinutes = attendance.scan(event.id, 'STU-001', true, new Date(Date.now() + 2 * 60000 + 1000));
    expect(afterTwoMinutes.accepted).toBe(true);
    expect(afterTwoMinutes.message).toContain('OUT');
  });

  it('finishing the event checks out everyone still in, at that moment', () => {
    const event = store.state().events[0];
    attendance.scan(event.id, 'STU-001', true); // in
    attendance.scan(event.id, 'STU-002', true); // in
    attendance.scan(event.id, 'STU-002', true, new Date(Date.now() + 3 * 60000)); // out already
    const outBefore = store.state().attendance.find((r) => r.studentId === 'STU-002')!.timeOut;

    const finishedAt = new Date(Date.now() + 3600000);
    const closed = attendance.finishEvent(event.id, true, finishedAt);

    expect(closed).toBe(1);
    const records = store.state().attendance;
    const first = records.find((r) => r.studentId === 'STU-001')!;
    expect(first.timeOut).toBe(finishedAt.toISOString());
    expect(first.durationMinutes).toBeGreaterThanOrEqual(59);
    // Someone who already left keeps their own time-out.
    expect(records.find((r) => r.studentId === 'STU-002')!.timeOut).toBe(outBefore);
    expect(store.state().events[0].finishedAt).toBe(finishedAt.toISOString());
    // Finishing twice changes nothing; scanning is closed afterwards.
    expect(attendance.finishEvent(event.id, true)).toBe(0);
    expect(attendance.scan(event.id, 'STU-003', true).accepted).toBe(false);
  });

  it('identifies a student who is already out without changing their attendance', () => {
    const event = store.state().events[0];
    attendance.scan(event.id, 'STU-001', true);
    attendance.scan(event.id, 'STU-001', true, new Date(Date.now() + 3 * 60000));

    const result = attendance.scan(event.id, 'STU-001', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toBe('Already OUT for this event.');
    expect(result.record?.timeOut).not.toBeNull();
    expect(store.state().attendance).toHaveLength(1);
  });

  it('checks an eligible student in without a seat assignment', () => {
    const event = store.state().events[0];
    const result = attendance.scan(event.id, 'STU-011', true);

    expect(result.accepted).toBe(true);
    expect(store.state().events[0].seats).toEqual([]);
    expect(store.state().attendance).toHaveLength(1);
  });

  it('rejects a student outside the selected sections', () => {
    const event = store.state().events[0];
    store.update((state) => {
      const student = state.students.find((item) => item.id === 'STU-001');
      if (student) {
        student.section = 'Grade 12-A';
        student.sectionId = 'grade-12-a';
      }
    });
    const result = attendance.scan(event.id, 'STU-001', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Not registered');
  });

  it('creates an event without seat data', () => {
    const service = TestBed.inject(EventService);
    const event = service.save(eventInput);

    expect(event.seats).toEqual([]);
    expect(event.seatingPlan).toBeUndefined();
  });
  describe('manual check-in and excused absences', () => {
    it('checks a student in and out by hand and tags the record as manual', () => {
      const event = store.state().events[0];

      const checkedIn = attendance.markManual(event.id, 'STU-001', 'in', true);
      expect(checkedIn.accepted).toBe(true);
      expect(store.state().attendance[0]).toMatchObject({ studentId: 'STU-001', manual: true });
      expect(store.state().attendance[0].timeIn).not.toBe('');

      expect(attendance.markManual(event.id, 'STU-001', 'in', true).accepted).toBe(false);

      const checkedOut = attendance.markManual(event.id, 'STU-001', 'out', true);
      expect(checkedOut.accepted).toBe(true);
      expect(store.state().attendance[0].timeOut).not.toBeNull();
    });

    it('marks an excused absence, which can be undone', () => {
      const event = store.state().events[0];

      expect(attendance.markManual(event.id, 'STU-002', 'excused', true).accepted).toBe(true);
      const record = store.state().attendance[0];
      expect(record).toMatchObject({ excused: true, timeIn: '', status: 'Excused' });
      expect(attendance.statusFor(record, event)).toBe('Excused');

      attendance.markManual(event.id, 'STU-002', 'clear', true);
      expect(store.state().attendance).toHaveLength(0);
    });

    it('will not excuse a student who already checked in', () => {
      const event = store.state().events[0];
      attendance.markManual(event.id, 'STU-003', 'in', true);

      expect(attendance.markManual(event.id, 'STU-003', 'excused', true).accepted).toBe(false);
    });

    it('turns an excused student into a normal check-in when they scan in', () => {
      const event = store.state().events[0];
      attendance.markManual(event.id, 'STU-001', 'excused', true);

      const result = attendance.scan(event.id, 'STU-001', true);

      expect(result.accepted).toBe(true);
      const record = store.state().attendance[0];
      expect(record.excused).toBe(false);
      expect(record.timeIn).not.toBe('');
      expect(record.timeOut).toBeNull();
    });
  });
  it('does not accept scans or by-hand entries for a cancelled event', () => {
    const event = store.state().events[0];
    store.update((state) => {
      state.events[0].cancelled = true;
    });

    expect(attendance.scan(event.id, 'STU-001', true)).toMatchObject({
      accepted: false,
      message: 'This event was cancelled.',
    });
    expect(attendance.markManual(event.id, 'STU-001', 'in', true).accepted).toBe(false);
    expect(store.state().attendance).toHaveLength(0);
  });
});

import {
  attendanceStatus,
  closeRecordsOfFinishedEvents,
} from './attendance.service';
import { applyPulled, emptyAttendanceSync, localChanges, recordHash } from './attendance-sync';
import { AttendanceRecord, SchoolEvent } from '../models/school-event.models';

describe('records of a finished event', () => {
  const event: SchoolEvent = {
    id: 'E1', name: 'Fest', date: '2030-03-10', startTime: '08:00', endTime: '12:00',
    venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
    finishedAt: '2030-03-10T17:00:00+08:00',
  };
  const open = (id: string, timeIn: string): AttendanceRecord => ({
    id, eventId: 'E1', studentId: id, timeIn, timeOut: null, durationMinutes: null,
    status: 'Incomplete', syncStatus: 'Synced',
  });

  it('closes records that still have no time-out, at the moment the event finished', () => {
    const result = closeRecordsOfFinishedEvents([event], [
      open('A', '2030-03-10T08:05:00+08:00'),
      { ...open('B', '2030-03-10T08:30:00+08:00'), timeOut: '2030-03-10T10:00:00+08:00' },
      { ...open('C', ''), excused: true },
    ]);
    expect(result[0].timeOut).toBe('2030-03-10T17:00:00+08:00');
    expect(result[0].status).toBe('Present');
    expect(result[1].timeOut).toBe('2030-03-10T10:00:00+08:00'); // already out: untouched
    expect(result[2].timeOut).toBeNull(); // excused: untouched
  });

  it('leaves events that are not finished alone', () => {
    const live = { ...event, finishedAt: undefined };
    const records = [open('A', '2030-03-10T08:05:00+08:00')];
    expect(closeRecordsOfFinishedEvents([live], records)).toBe(records);
  });

  it('reads lateness in Philippine time', () => {
    const late: AttendanceRecord = {
      ...open('L', '2030-03-10T08:20:00+08:00'), timeOut: '2030-03-10T11:00:00+08:00',
    };
    expect(attendanceStatus(late, event)).toBe('Late'); // 8:20 is after 8:00 + 15 min
  });
});

describe('undoing a manual entry', () => {
  it('is noticed by the sync as a removal, and is not brought back by the server copy', () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [AttendanceService, DemoStoreService] });
    const store = TestBed.inject(DemoStoreService);
    const service = TestBed.inject(AttendanceService);
    store.update((state) => {
      state.students = [{ id: 'S1', name: 'Ana', section: 'A', mobile: '1', sectionId: 'sec' }];
    });
    TestBed.inject(EventService).save(
      { name: 'E', date: '2026-12-01', startTime: '08:00', endTime: '10:00', venue: 'V',
        description: '', graceMinutes: 10, requiredSections: ['sec'] },
      undefined, [{ id: 'sec', label: 'A' }],
    );
    const eventId = store.state().events[0].id;
    service.markManual(eventId, 'S1', 'excused', true);
    const record = store.state().attendance[0];
    // The server already has this record.
    const info = emptyAttendanceSync();
    info.hashes[record.id] = recordHash(record);

    service.markManual(eventId, 'S1', 'clear', true);

    expect(store.state().attendance).toHaveLength(0);
    expect(localChanges(store.state().attendance, info).removed).toEqual([record.id]);
    // Pulling the server's (still old) copy must not undo the removal on a later round,
    // because the removal is sent first; and once sent, the server reports it as removed.
    const afterSend = { cursor: 1, hashes: {} as Record<string, string> };
    expect(applyPulled([], afterSend, { records: [], removed: [record.id] })).toEqual([]);
  });
});

describe('everyone is checked out at 11:59 PM of the event day', () => {
  const event: SchoolEvent = {
    id: 'E1', name: 'Fest', date: '2030-03-10', startTime: '08:00', endTime: '12:00',
    venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
  };
  const open: AttendanceRecord = {
    id: 'A', eventId: 'E1', studentId: 'S', timeIn: '2030-03-10T08:05:00+08:00', timeOut: null,
    durationMinutes: null, status: 'Incomplete', syncStatus: 'Synced',
  };
  const during = new Date('2030-03-10T15:00:00+08:00');
  const nextDay = new Date('2030-03-11T00:30:00+08:00');

  it('leaves people inside while the event day is still on', () => {
    expect(closeRecordsOfFinishedEvents([event], [open], during)).toEqual([open]);
    expect(attendanceStatus(open, event, during)).toBe('Incomplete');
  });

  it('checks them out at 11:59 PM once the day has passed', () => {
    const [closed] = closeRecordsOfFinishedEvents([event], [open], nextDay);
    expect(closed.timeOut).toBe(new Date('2030-03-10T23:59:00+08:00').toISOString());
    expect(closed.durationMinutes).toBe(954); // 8:05 AM to 11:59 PM
    expect(closed.status).toBe('Present');
  });

  it('counts them as present or late, never as incomplete, after the day', () => {
    expect(attendanceStatus(open, event, nextDay)).toBe('Present');
    const late = { ...open, timeIn: '2030-03-10T09:00:00+08:00' };
    expect(attendanceStatus(late, event, nextDay)).toBe('Late');
  });

  it('uses the moment the admin finished the event instead, when that happened', () => {
    const finished = { ...event, finishedAt: '2030-03-10T17:00:00+08:00' };
    const [closed] = closeRecordsOfFinishedEvents([finished], [open], during);
    expect(closed.timeOut).toBe('2030-03-10T17:00:00+08:00');
  });
});
