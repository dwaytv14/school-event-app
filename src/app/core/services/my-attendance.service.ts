import { inject, Injectable } from '@angular/core';
import {
  AttendanceRecord,
  SchoolEvent,
  Student,
} from '../models/school-event.models';
import { AttendanceService } from './attendance.service';
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
  /** null until there is at least one finished required event. */
  percentage: number | null;
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
    const own = new Map(
      records
        .filter((record) => record.studentId === student?.id)
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
      .sort((left, right) =>
        `${right.event.date}${right.event.startTime}`.localeCompare(
          `${left.event.date}${left.event.startTime}`,
        ),
      );
    const count = (status: AttendanceRowStatus) =>
      rows.filter((row) => row.required && row.status === status).length;
    const present = count('Present');
    const late = count('Late');
    const incomplete = count('Incomplete');
    const absent = count('Absent');
    const counted = present + late + incomplete + absent;
    const attended = present + late + incomplete;
    return {
      rows,
      counted,
      attended,
      present,
      late,
      absent,
      percentage: counted === 0 ? null : Math.round((attended / counted) * 100),
    };
  }

  private status(
    event: SchoolEvent,
    record: AttendanceRecord | undefined,
    required: boolean,
    now: Date,
  ): AttendanceRowStatus {
    const start = new Date(`${event.date}T${event.startTime}:00`).getTime();
    const end = new Date(`${event.date}T${event.endTime}:00`).getTime();
    const finished = Number.isFinite(end) && now.getTime() >= end;
    if (event.cancelled && !record) return 'Cancelled';
    if (record) {
      if (record.excused) return 'Excused';
      if (!record.timeOut && !finished) return 'Ongoing';
      return this.attendance.statusFor(record, event) as AttendanceRowStatus;
    }
    if (!required) return 'Not required';
    if (Number.isFinite(start) && now.getTime() < start) return 'Upcoming';
    return finished ? 'Absent' : 'Ongoing';
  }
}
