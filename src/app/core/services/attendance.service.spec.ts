import { TestBed } from '@angular/core/testing';
import { AttendanceService } from './attendance.service';
import { DemoStoreService } from './demo-store.service';
import { EventService } from './event.service';
import { SeatingService } from './seating.service';

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
      }));
    });
    TestBed.inject(EventService).save(eventInput);
    attendance = TestBed.inject(AttendanceService);
  });

  it('records time-in and time-out for a student at their assigned section', () => {
    const event = store.state().events[0];
    const firstScan = attendance.scan(event.id, 'STU-001', true);
    const secondScan = attendance.scan(event.id, 'STU-001', true);

    expect(firstScan.accepted).toBe(true);
    expect(firstScan.message).toContain('IN');
    expect(firstScan.record?.timeOut).toBeNull();
    expect(secondScan.accepted).toBe(true);
    expect(secondScan.message).toContain('OUT');
    expect(secondScan.record?.timeOut).not.toBeNull();
    expect(secondScan.record?.durationMinutes).not.toBeNull();
  });

  it('identifies a student who is already out without changing their attendance', () => {
    const event = store.state().events[0];
    attendance.scan(event.id, 'STU-001', true);
    attendance.scan(event.id, 'STU-001', true);

    const result = attendance.scan(event.id, 'STU-001', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toBe('Already OUT for this event.');
    expect(result.record?.timeOut).not.toBeNull();
    expect(store.state().attendance).toHaveLength(1);
  });

  it('checks a student in without any gate check and logs no violation', () => {
    const event = store.state().events[0];
    const result = attendance.scan(event.id, 'STU-011', true);

    expect(result.accepted).toBe(true);
    expect(store.state().violations).toHaveLength(0);
    expect(store.state().attendance).toHaveLength(1);
  });

  it('rejects a student without an event seat', () => {
    const event = store.state().events[0];
    store.update((state) => {
      const seat = state.events[0].seats.find(
        (item) => item.studentId === 'STU-001',
      );
      if (seat) seat.studentId = null;
    });
    const result = attendance.scan(event.id, 'STU-001', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Not registered');
    expect(store.state().violations).toHaveLength(0);
  });

  it('does not allow assigning a student outside their section', () => {
    const event = store.state().events[0];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DemoStoreService, useValue: store }] });
    const service = TestBed.runInInjectionContext(() => new SeatingService());
    const otherSectionSeat = event.seats.find(
      (seat) => seat.section === 'Grade 10-B' && seat.studentId === null,
    )!;

    expect(service.assign(event.id, 'STU-001', otherSectionSeat.id)).toBe(
      false,
    );
    expect(
      store
        .state()
        .events[0].seats.filter((seat) => seat.studentId === 'STU-001'),
    ).toHaveLength(1);
  });

  it('creates a complete seat map whose IDs belong to the new event', () => {
    const service = TestBed.inject(EventService);
    const event = service.save(eventInput);

    expect(event.seats).toHaveLength(36);
    expect(
      event.seats.every((seat) => seat.id.startsWith(`${event.id}-`)),
    ).toBe(true);
    expect(event.seats.filter((seat) => seat.studentId !== null)).toHaveLength(
      30,
    );
  });

  it('allows a student to use any seat in their assigned gymnasium bench group', () => {
    const eventId = store.state().events[0].id;
    store.update((state) => {
      state.students = state.students.map((student) => ({
        ...student,
        sectionId: student.section === 'Grade 10-A' ? 'section-a' : 'section-b',
      }));
      const event = state.events.find((item) => item.id === eventId)!;
      event.requiredSections = ['section-a'];
      event.seatingPlan = {
        gymnasiumBenchGroups: [
          {
            id: 'left-1',
            side: 'left',
            number: 1,
            sectionId: 'section-a',
          },
        ],
        sectionSeatCounts: { 'section-a': 0 },
      };
      event.seats = [];
    });

    expect(
      attendance.scan(eventId, 'STU-001', true).accepted,
    ).toBe(true);
    expect(
      attendance.scan(eventId, 'STU-002', true).accepted,
    ).toBe(true);
  });

  it('enforces one shared chair capacity across all assigned sections', () => {
    const eventId = store.state().events[0].id;
    store.update((state) => {
      state.students = state.students.map((student) => ({
        ...student,
        sectionId: student.section === 'Grade 10-A' ? 'section-a' : 'section-b',
      }));
      const event = state.events.find((item) => item.id === eventId)!;
      event.requiredSections = ['section-a', 'section-b'];
      event.venue = 'Conference room';
      event.seatingPlan = {
        gymnasiumBenchGroups: [],
        sharedSeatCount: 1,
        sharedSectionIds: ['section-a', 'section-b'],
        sectionSeatCounts: {},
      };
      event.seats = [];
    });

    expect(
      attendance.scan(eventId, 'STU-001', true).accepted,
    ).toBe(true);
    const secondStudent = attendance.scan(
      eventId,
      'STU-011',
      true,
    );

    expect(secondStudent.accepted).toBe(false);
    expect(secondStudent.message).toBe(
      'All 1 chairs are currently occupied.',
    );
  });

  it('preserves section-specific capacity for previously saved seating plans', () => {
    const eventId = store.state().events[0].id;
    store.update((state) => {
      state.students = state.students.map((student) => ({
        ...student,
        sectionId: student.section === 'Grade 10-A' ? 'section-a' : 'section-b',
      }));
      const event = state.events.find((item) => item.id === eventId)!;
      event.requiredSections = ['section-a', 'section-b'];
      event.venue = 'Conference room';
      event.seatingPlan = {
        gymnasiumBenchGroups: [],
        sectionSeatCounts: { 'section-a': 1, 'section-b': 1 },
      };
      event.seats = [];
    });

    expect(
      attendance.scan(eventId, 'STU-001', true).accepted,
    ).toBe(true);
    expect(
      attendance.scan(eventId, 'STU-011', true).accepted,
    ).toBe(true);
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
