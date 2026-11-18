import { inject, Injectable } from '@angular/core';
import {
  AttendanceRecord,
  SchoolEvent,
  Student,
} from '../models/school-event.models';
import { AttendanceService, attendanceStatus } from './attendance.service';
import { isEventOver, isEventUpcoming } from './event-actions';
import { addDaysToKey, schoolDateKey } from './time-format';
import { isStudentRequired } from './event-roster';

export type AttendanceRowStatus =
  | 'Present'
  | 'Late'
  | 'Incomplete'
  | 'Absent'
  | 'Upcoming'
  | 'Ongoing'
  | 'Excused'
  | 'Cancelled'
  | 'Not required';

export interface AttendanceRow {
  event: SchoolEvent;
  record?: AttendanceRecord;
  status: AttendanceRowStatus;
  required: boolean;
}

export interface AttendanceSummary {
  rows: AttendanceRow[];
  /** Required events that have finished (or that the student attended). */
  counted: number;
  attended: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** null until there is at least one finished required event. */
  percentage: number | null;
}

/**
 * A student can send an excuse letter from the day before the event, during it
 * (not yet checked in), or after missing it (absent). Never for an event they
 * already attended, one that is cancelled, or one that is not theirs.
 */
export function canExcuseRow(row: AttendanceRow, now: Date = new Date()): boolean {
  if (row.record) return false;
  if (row.status === 'Absent' || row.status === 'Ongoing') return true;
  if (row.status !== 'Upcoming') return false;
  // Early letters open the day before the event, not months ahead.
  return schoolDateKey(now) >= addDaysToKey(row.event.date, -1);
}

/** The first day an excuse letter can be sent for an event (the day before it). */
export function excuseOpensOn(event: SchoolEvent): string {
  return addDaysToKey(event.date, -1);
}

/** Turns a student's events and records into a readable attendance history. */
@Injectable({ providedIn: 'root' })
export class MyAttendanceService {
  private readonly attendance = inject(AttendanceService);

  summarize(
    events: SchoolEvent[],
    records: AttendanceRecord[],
    student: Pick<Student, 'id' | 'sectionId'> | undefined,
    now: Date = new Date(),
  ): AttendanceSummary {
    const eventsById = new Map(events.map((event) => [event.id, event]));
    const own = new Map(
      records
        .filter((record) => record.studentId === student?.id)
        // Nobody can have attended an event that has not started; only an excuse counts early.
        .filter((record) => {
          const event = eventsById.get(record.eventId);
          return record.excused || !event || !isEventUpcoming(event, now);
        })
        .map((record) => [record.eventId, record]),
    );
    const rows = events
      .map((event): AttendanceRow => {
        const record = own.get(event.id);
        const required = !!student && isStudentRequired(event, student);
        return { event, record, required, status: this.status(event, record, required, now) };
      })
      // Optional events only matter if the student actually went.
      .filter((row) => row.required || row.record)
      // A cancelled event that is already over is not worth listing.
      .filter((row) => !(row.event.cancelled && !row.record && isEventOver(row.event, now)))
      .sort((left, right) =>
        `${right.event.date}${right.event.startTime}`.localeCompare(
          `${left.event.date}${left.event.startTime}`,
        ),
      );
    const count = (status: AttendanceRowStatus) =>
      rows.filter((row) => row.required && row.status === status).length;
    const present = count('Present');
    const late = count('Late');
    const absent = count('Absent');
    const counted = present + late + absent;
    const attended = present + late;
    return {
      rows,
      counted,
      attended,
      present,
      late,
      absent,
      excused: rows.filter((row) => row.status === 'Excused').length,
      percentage: counted === 0 ? null : Math.round((attended / counted) * 100),
    };
  }

  private status(
    event: SchoolEvent,
    record: AttendanceRecord | undefined,
    required: boolean,
    now: Date,
  ): AttendanceRowStatus {
    // An event is over once the admin finishes it or its day has passed, not at its end time.
    const finished = isEventOver(event, now);
    if (event.cancelled && !record) return 'Cancelled';
    if (record) {
      if (record.excused) return 'Excused';
      if (!record.timeOut && !finished) return 'Ongoing';
      return attendanceStatus(record, event, now) as AttendanceRowStatus;
    }
    if (!required) return 'Not required';
    if (isEventUpcoming(event, now)) return 'Upcoming';
    return finished ? 'Absent' : 'Ongoing';
  }
}
