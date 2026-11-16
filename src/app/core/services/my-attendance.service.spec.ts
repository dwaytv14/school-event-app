import { TestBed } from '@angular/core/testing';
import { AttendanceRecord, SchoolEvent } from '../models/school-event.models';
import { MyAttendanceService } from './my-attendance.service';

function event(id: string, date: string, required = true): SchoolEvent {
  return {
    id,
    name: id,
    date,
    startTime: '08:00',
    endTime: '12:00',
    venue: 'Gymnasium',
    description: '',
    graceMinutes: 15,
    sections: [],
    seats: [],
    requiredSections: required ? ['sec-a'] : ['sec-other'],
    approvalStatus: 'approved',
  };
}

function record(eventId: string, timeIn: string, timeOut: string | null): AttendanceRecord {
  return {
    id: `ATT-${eventId}`,
    eventId,
    studentId: 'PPY-1',
    timeIn,
    timeOut,
    durationMinutes: null,
    status: 'Incomplete',
    syncStatus: 'Synced',
  };
}

describe('MyAttendanceService', () => {
  const service = () => TestBed.inject(MyAttendanceService);
  const student = { id: 'PPY-1', sectionId: 'sec-a' };
  const now = new Date('2030-03-10T15:00:00');

  it('classifies required events and calculates the attendance rate', () => {
    const events = [
      event('on-time', '2030-03-01'),
      event('late', '2030-03-02'),
      event('missed', '2030-03-03'),
      event('next-week', '2030-03-20'),
    ];
    const records = [
      record('on-time', '2030-03-01T08:05:00', '2030-03-01T11:50:00'),
      record('late', '2030-03-02T08:40:00', '2030-03-02T11:50:00'),
    ];

    const summary = service().summarize(events, records, student, now);
    const byId = Object.fromEntries(summary.rows.map((row) => [row.event.id, row.status]));

    expect(byId).toEqual({
      'on-time': 'Present',
      late: 'Late',
      missed: 'Absent',
      'next-week': 'Upcoming',
    });
    expect(summary.counted).toBe(3);
    expect(summary.attended).toBe(2);
    expect(summary.percentage).toBe(67);
  });

  it('shows no percentage before any required event has finished', () => {
    const summary = service().summarize([event('soon', '2030-03-20')], [], student, now);

    expect(summary.percentage).toBeNull();
    expect(summary.rows[0].status).toBe('Upcoming');
  });

  it('hides optional events unless the student went, and shows checked-in events as ongoing', () => {
    const live = event('live', '2030-03-10');
    live.endTime = '18:00';
    const events = [event('optional', '2030-03-01', false), event('went', '2030-03-02', false), live];
    const records = [
      record('went', '2030-03-02T08:00:00', '2030-03-02T11:00:00'),
      record('live', '2030-03-10T09:00:00', null),
    ];

    const summary = service().summarize(events, records, student, now);

    expect(summary.rows.map((row) => row.event.id)).toEqual(['live', 'went']);
    expect(summary.rows[0].status).toBe('Ongoing');
  });
  it('does not count a cancelled event against the student', () => {
    const cancelled = { ...event('called-off', '2030-03-03'), cancelled: true };
    const summary = service().summarize(
      [event('on-time', '2030-03-01'), cancelled],
      [record('on-time', '2030-03-01T08:05:00', '2030-03-01T11:50:00')],
      student,
      now,
    );

    expect(summary.rows.find((row) => row.event.id === 'called-off')?.status).toBe('Cancelled');
    expect(summary.counted).toBe(1);
    expect(summary.percentage).toBe(100);
  });

  it('shows an excused absence without counting it against the student', () => {
    const excused = record('excused', '', null);
    excused.excused = true;
    const summary = service().summarize(
      [event('excused', '2030-03-03'), event('on-time', '2030-03-01')],
      [excused, record('on-time', '2030-03-01T08:05:00', '2030-03-01T11:50:00')],
      student,
      now,
    );

    expect(summary.rows.find((row) => row.event.id === 'excused')?.status).toBe('Excused');
    expect(summary.counted).toBe(1);
  });
  it('keeps a past event in the history after the student moved up a year', () => {
    const past = { ...event('past', '2030-03-01'), roster: { 'BSIT 1st Year A': ['PPY-1'] } };
    const moved = { id: 'PPY-1', sectionId: 'sec-2a' };

    const summary = service().summarize(
      [past],
      [record('past', '2030-03-01T08:05:00', '2030-03-01T11:50:00')],
      moved,
      now,
    );

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({ status: 'Present', required: true });
  });
});
