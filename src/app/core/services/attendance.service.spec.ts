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
    store = new DemoStoreService();
    store.update((state) => {
      state.students = Array.from({ length: 30 }, (_, index) => ({
        id: `STU-${String(index + 1).padStart(3, '0')}`,
        name: `Test student ${index + 1}`,
        section: `Grade ${index < 10 ? '10-A' : index < 20 ? '10-B' : '11-A'}`,
        mobile: `+6390000${String(index + 1).padStart(4, '0')}`,
      }));
    });
    new EventService(store).save(eventInput);
    attendance = new AttendanceService(store);
  });

  it('records time-in and time-out for a student at their assigned section', () => {
    const event = store.state().events[0];
    const firstScan = attendance.scan(event.id, 'STU-001', 'Grade 10-A', true);
    const secondScan = attendance.scan(event.id, 'STU-001', 'Grade 10-A', true);

    expect(firstScan.accepted).toBe(true);
    expect(firstScan.record?.timeOut).toBeNull();
    expect(secondScan.accepted).toBe(true);
    expect(secondScan.record?.timeOut).not.toBeNull();
    expect(secondScan.record?.durationMinutes).not.toBeNull();
  });

  it('rejects a student at the wrong section gate and logs the violation', () => {
    const event = store.state().events[0];
    const result = attendance.scan(event.id, 'STU-011', 'Grade 10-A', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Grade 10-B, Row 1, Seat 1');
    expect(store.state().violations).toHaveLength(1);
    expect(store.state().attendance).toHaveLength(0);
  });

  it('rejects a student without an event seat', () => {
    const event = store.state().events[0];
    store.update((state) => {
      const seat = state.events[0].seats.find(
        (item) => item.studentId === 'STU-001',
      );
      if (seat) seat.studentId = null;
    });
    const result = attendance.scan(event.id, 'STU-001', 'Grade 10-A', true);

    expect(result.accepted).toBe(false);
    expect(result.message).toContain('Not registered');
    expect(store.state().violations).toHaveLength(1);
  });

  it('does not allow assigning a student outside their section', () => {
    const event = store.state().events[0];
    const service = new SeatingService(store);
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
    const service = new EventService(store);
    const event = service.save(eventInput);

    expect(event.seats).toHaveLength(36);
    expect(
      event.seats.every((seat) => seat.id.startsWith(`${event.id}-`)),
    ).toBe(true);
    expect(event.seats.filter((seat) => seat.studentId !== null)).toHaveLength(
      30,
    );
  });
});
