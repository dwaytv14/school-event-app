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
  const now = new Date('2030-03-10T15:00:00+08:00');

  it('classifies required events and calculates the attendance rate', () => {
    const events = [
      event('on-time', '2030-03-01'),
      event('late', '2030-03-02'),
      event('missed', '2030-03-03'),
      event('next-week', '2030-03-20'),
    ];
    const records = [
      record('on-time', '2030-03-01T08:05:00+08:00', '2030-03-01T11:50:00+08:00'),
      record('late', '2030-03-02T08:40:00+08:00', '2030-03-02T11:50:00+08:00'),
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
      record('went', '2030-03-02T08:00:00+08:00', '2030-03-02T11:00:00+08:00'),
      record('live', '2030-03-10T09:00:00+08:00', null),
    ];

    const summary = service().summarize(events, records, student, now);

    expect(summary.rows.map((row) => row.event.id)).toEqual(['live', 'went']);
    expect(summary.rows[0].status).toBe('Ongoing');
  });
  it('does not count a cancelled event against the student', () => {
    const cancelled = { ...event('called-off', '2030-03-03'), cancelled: true };
    const summary = service().summarize(
      [event('on-time', '2030-03-01'), cancelled],
      [record('on-time', '2030-03-01T08:05:00+08:00', '2030-03-01T11:50:00+08:00')],
      student,
      now,
    );

    // A cancelled event that is already over is not listed at all, and never counts.
    expect(summary.rows.some((row) => row.event.id === 'called-off')).toBe(false);
    expect(summary.counted).toBe(1);
    expect(summary.percentage).toBe(100);
  });

  it('shows an excused absence without counting it against the student', () => {
    const excused = record('excused', '', null);
    excused.excused = true;
    const summary = service().summarize(
      [event('excused', '2030-03-03'), event('on-time', '2030-03-01')],
      [excused, record('on-time', '2030-03-01T08:05:00+08:00', '2030-03-01T11:50:00+08:00')],
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
      [record('past', '2030-03-01T08:05:00+08:00', '2030-03-01T11:50:00+08:00')],
      moved,
      now,
    );

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0]).toMatchObject({ status: 'Present', required: true });
  });
});

describe('MyAttendanceService: the event day, not the end time', () => {
  const service = () => TestBed.inject(MyAttendanceService);
  const student = { id: 'PPY-1', sectionId: 'sec-a' };
  // 5 PM on the event day, an hour after the listed 12:00 end time.
  const lateInDay = new Date('2030-03-10T17:00:00+08:00');

  it('is not absent after the listed end time while the event day is still on', () => {
    const [row] = service().summarize([event('today', '2030-03-10')], [], student, lateInDay).rows;
    expect(row.status).toBe('Ongoing');
  });

  it('is absent once the admin finishes the event', () => {
    const finished = { ...event('today', '2030-03-10'), finishedAt: '2030-03-10T16:00:00+08:00' };
    const [row] = service().summarize([finished], [], student, lateInDay).rows;
    expect(row.status).toBe('Absent');
  });

  it('is absent the next day', () => {
    const next = new Date('2030-03-11T07:00:00+08:00');
    const [row] = service().summarize([event('yesterday', '2030-03-10')], [], student, next).rows;
    expect(row.status).toBe('Absent');
  });
});

describe('MyAttendanceService: cancelled events', () => {
  const service = () => TestBed.inject(MyAttendanceService);
  const student = { id: 'PPY-1', sectionId: 'sec-a' };
  const now = new Date('2030-03-10T15:00:00+08:00');

  it('does not list a cancelled event that is already over, but keeps an upcoming one', () => {
    const rows = service().summarize(
      [
        { ...event('old-cancelled', '2030-03-01'), cancelled: true },
        { ...event('next-cancelled', '2030-03-20'), cancelled: true },
      ],
      [],
      student,
      now,
    ).rows;
    expect(rows.map((row) => row.event.id)).toEqual(['next-cancelled']);
    expect(rows[0].status).toBe('Cancelled');
  });
});

describe('MyAttendanceService: the numbers add up', () => {
  const service = () => TestBed.inject(MyAttendanceService);
  const student = { id: 'PPY-1', sectionId: 'sec-a' };
  const now = new Date('2030-03-10T15:00:00+08:00');

  it('counts someone who never checked out as out at 11:59 PM, so the numbers add up', () => {
    const summary = service().summarize(
      [event('full', '2030-03-01'), event('no-out', '2030-03-02'), event('missed', '2030-03-03')],
      [
        record('full', '2030-03-01T08:05:00+08:00', '2030-03-01T11:50:00+08:00'),
        record('no-out', '2030-03-02T08:05:00+08:00', null), // forgot to scan out; the day is over
      ],
      student,
      now,
    );
    expect(summary).toMatchObject({ present: 2, late: 0, absent: 1, counted: 3, attended: 2 });
    expect(summary.present + summary.late + summary.absent).toBe(summary.counted);
  });

  it('does not count a scan made before the event day, so an excuse letter can still be sent', () => {
    const upcoming = event('tomorrow', '2030-03-11');
    const early = record('tomorrow', '2030-03-09T16:06:00+08:00', null); // scanned two days early
    const [row] = service().summarize([upcoming], [early], student, now).rows;
    expect(row.record).toBeUndefined();
    expect(row.status).toBe('Upcoming');
  });

  it('still shows an excuse that was approved ahead of time', () => {
    const upcoming = event('tomorrow', '2030-03-11');
    const excused = { ...record('tomorrow', '', null), excused: true, status: 'Excused' as const };
    const [row] = service().summarize([upcoming], [excused], student, now).rows;
    expect(row.status).toBe('Excused');
  });
});
