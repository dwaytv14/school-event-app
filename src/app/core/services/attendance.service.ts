import { inject, Injectable } from '@angular/core';
import {
  AttendanceRecord,
  AttendanceStatus,
  SchoolEvent,
} from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';
import { isStudentRequired } from './event-roster';
import { eventMoment, schoolDateKey } from './time-format';

/** How long after checking in a student can be checked out (stops IN then OUT from one long scan). */
export const MIN_STAY_MS = 2 * 60 * 1000;

/**
 * The moment everyone still inside an event is checked out by itself:
 *  - when the admin finishes the event, that moment;
 *  - otherwise 11:59 PM of the event's day (Philippine time), once that day has passed.
 * Returns null while the event is still on.
 */
export function eventClosedAt(event: SchoolEvent, now: Date = new Date()): string | null {
  if (event.finishedAt) return event.finishedAt;
  if (event.date && event.date < schoolDateKey(now)) {
    return new Date(`${event.date}T23:59:00+08:00`).toISOString();
  }
  return null;
}

/** Present, Late or Excused for one record (pure, no store needed). */
export function attendanceStatus(
  record: AttendanceRecord | undefined,
  event: SchoolEvent,
  now: Date = new Date(),
): AttendanceStatus {
  if (!record) return 'Absent';
  if (record.excused) return 'Excused';
  // A student still inside is checked out by itself when the event is over, so they count as out.
  if (!record.timeOut && !eventClosedAt(event, now)) return 'Incomplete';
  const timeIn = new Date(record.timeIn);
  const eventStart = eventMoment(event.date, event.startTime);
  return timeIn.getTime() > eventStart.getTime() + event.graceMinutes * 60000
    ? 'Late'
    : 'Present';
}

/**
 * Once an event is over nobody can still be inside. Any record of that event with no
 * time-out is closed at the moment it ended (see eventClosedAt). Returns the same array
 * when nothing needed closing.
 */
export function closeRecordsOfFinishedEvents(
  events: SchoolEvent[],
  attendance: AttendanceRecord[],
  now: Date = new Date(),
): AttendanceRecord[] {
  const closeAt = new Map<string, { event: SchoolEvent; at: string }>();
  for (const event of events) {
    const at = eventClosedAt(event, now);
    if (at) closeAt.set(event.id, { event, at });
  }
  if (!closeAt.size) return attendance;
  let changed = false;
  const result = attendance.map((record) => {
    const closing = closeAt.get(record.eventId);
    if (!closing || record.excused || !record.timeIn || record.timeOut) return record;
    const timeOut = Date.parse(closing.at) < Date.parse(record.timeIn) ? record.timeIn : closing.at;
    const closed: AttendanceRecord = {
      ...record,
      timeOut,
      durationMinutes: Math.max(
        0,
        Math.round((Date.parse(timeOut) - Date.parse(record.timeIn)) / 60000),
      ),
    };
    closed.status = attendanceStatus(closed, closing.event, now);
    changed = true;
    return closed;
  });
  return changed ? result : attendance;
}

export interface ScanResult {
  accepted: boolean;
  tone: 'success' | 'warning' | 'rejected';
  message: string;
  record?: AttendanceRecord;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private readonly store = inject(DemoStoreService);

  scan(
    eventId: string,
    studentId: string,
    online: boolean,
    now: Date = new Date(),
  ): ScanResult {
    const state = this.store.state();
    const event = state.events.find((item) => item.id === eventId);
    const student = state.students.find((item) => item.id === studentId);
    if (!event || !student)
      return {
        accepted: false,
        tone: 'rejected',
        message: 'Student or event not found.',
      };
    if (event.cancelled) return this.reject('This event was cancelled.');
    if (event.finishedAt) return this.reject('This event has already finished.');
    if (!isStudentRequired(event, student)) {
      return this.reject('Not registered for this event.');
    }

    const prior = state.attendance.find(
      (record) => record.eventId === eventId && record.studentId === studentId,
    );
    if (prior?.timeOut)
      return {
        accepted: false,
        tone: 'warning',
        message: 'Already OUT for this event.',
        record: prior,
      };

    // A second scan right after the first one is the same visit, not the student leaving.
    if (prior && !prior.excused && prior.timeIn && !prior.timeOut) {
      const waitMs = MIN_STAY_MS - (now.getTime() - Date.parse(prior.timeIn));
      if (waitMs > 0) {
        return {
          accepted: false,
          tone: 'warning',
          message: `Already checked IN. Check-out opens in ${Math.ceil(waitMs / 60000)} min.`,
          record: prior,
        };
      }
    }

    const timestamp = now.toISOString();
    const eventStart = eventMoment(event.date, event.startTime);
    const late =
      now.getTime() > eventStart.getTime() + event.graceMinutes * 60000;
    let record: AttendanceRecord;
    this.store.update((current) => {
      const existing = current.attendance.find(
        (item) => item.eventId === eventId && item.studentId === studentId,
      );
      if (existing?.excused) {
        // An excused student who shows up anyway is simply checked in.
        existing.excused = false;
        existing.manual = false;
        existing.timeIn = timestamp;
        existing.timeOut = null;
        existing.durationMinutes = null;
        existing.status = 'Incomplete';
        existing.syncStatus = online ? 'Synced' : 'Pending sync';
        record = existing;
      } else if (existing) {
        existing.timeOut = timestamp;
        existing.durationMinutes = Math.max(
          0,
          Math.round(
            (now.getTime() - new Date(existing.timeIn).getTime()) / 60000,
          ),
        );
        existing.status = this.statusFor(existing, event);
        existing.syncStatus = online ? 'Synced' : 'Pending sync';
        record = existing;
      } else {
        record = {
          id: `ATT-${Date.now()}`,
          eventId,
          studentId,
          timeIn: timestamp,
          timeOut: null,
          durationMinutes: null,
          status: 'Incomplete',
          syncStatus: online ? 'Synced' : 'Pending sync',
        };
        current.attendance.push(record);
      }
      current.syncItems.push({
        id: `SYNC-${Date.now()}`,
        kind: 'attendance',
        createdAt: timestamp,
        status: online ? 'Synced' : 'Pending sync',
      });
    });
    const action = record!.timeOut
      ? 'OUT · Check-out recorded'
      : 'IN · Check-in recorded';
    return {
      accepted: true,
      tone: !record!.timeOut && late ? 'warning' : 'success',
      message: `${action}${!record!.timeOut && late ? ' · Late arrival' : ''}`,
      record: record!,
    };
  }

  /**
   * Staff fallback for when a QR cannot be scanned: check a student in or out
   * by hand, mark an excused absence, or undo one of those.
   */
  markManual(
    eventId: string,
    studentId: string,
    action: 'in' | 'out' | 'excused' | 'clear',
    online: boolean,
  ): ScanResult {
    const state = this.store.state();
    const event = state.events.find((item) => item.id === eventId);
    const student = state.students.find((item) => item.id === studentId);
    if (!event || !student) return this.reject('Student or event not found.');
    if (event.cancelled) return this.reject('This event was cancelled.');
    const existing = state.attendance.find(
      (item) => item.eventId === eventId && item.studentId === studentId,
    );
    const warn = (message: string): ScanResult => ({
      accepted: false,
      tone: 'warning',
      message,
      record: existing,
    });
    if (action === 'in' && existing && !existing.excused) {
      return warn(existing.timeOut ? 'Already checked out.' : 'Already checked in.');
    }
    if (action === 'out' && (!existing || existing.excused || existing.timeOut)) {
      return warn('This student is not checked in.');
    }
    if (action === 'excused' && existing && !existing.excused) {
      return warn('This student already has attendance for this event.');
    }
    if (action === 'clear' && !existing?.manual) return warn('Nothing to undo.');

    const now = new Date();
    const timestamp = now.toISOString();
    const syncStatus = online ? 'Synced' : 'Pending sync';
    let record: AttendanceRecord | undefined;
    this.store.update((current) => {
      const index = current.attendance.findIndex(
        (item) => item.eventId === eventId && item.studentId === studentId,
      );
      if (action === 'clear') {
        // The sync notices the record is gone and tells the server.
        if (index >= 0) current.attendance.splice(index, 1);
        return;
      }
      if (action === 'out') {
        const item = current.attendance[index];
        item.timeOut = timestamp;
        item.durationMinutes = Math.max(
          0,
          Math.round((now.getTime() - new Date(item.timeIn).getTime()) / 60000),
        );
        item.status = this.statusFor(item, event);
        item.syncStatus = syncStatus;
        item.manual = true;
        record = item;
      } else {
        const excused = action === 'excused';
        const fresh: AttendanceRecord = {
          id: index >= 0 ? current.attendance[index].id : `ATT-${Date.now()}`,
          eventId,
          studentId,
          timeIn: excused ? '' : timestamp,
          timeOut: null,
          durationMinutes: null,
          status: excused ? 'Excused' : 'Incomplete',
          syncStatus,
          manual: true,
          excused,
        };
        if (index >= 0) current.attendance[index] = fresh;
        else current.attendance.push(fresh);
        record = fresh;
      }
      current.syncItems.push({
        id: `SYNC-${Date.now()}`,
        kind: 'attendance',
        createdAt: timestamp,
        status: syncStatus,
      });
    });
    const message = {
      in: 'Checked in by hand',
      out: 'Checked out by hand',
      excused: 'Marked as excused',
      clear: 'Undone',
    }[action];
    return { accepted: true, tone: 'success', message, record };
  }

  /**
   * Ends the event right now: everyone still checked in (no time-out) is checked
   * out at this moment, since the event is over. Returns how many were closed.
   */
  finishEvent(eventId: string, online: boolean, now: Date = new Date()): number {
    let closed = 0;
    const stamp = now.toISOString();
    this.store.update((current) => {
      const event = current.events.find((item) => item.id === eventId);
      if (!event || event.finishedAt) return;
      event.finishedAt = stamp;
      for (const record of current.attendance) {
        if (record.eventId !== eventId || record.excused || !record.timeIn || record.timeOut) {
          continue;
        }
        record.timeOut = stamp;
        record.durationMinutes = Math.max(
          0,
          Math.round((now.getTime() - new Date(record.timeIn).getTime()) / 60000),
        );
        record.status = this.statusFor(record, event);
        record.syncStatus = online ? 'Synced' : 'Pending sync';
        closed += 1;
      }
    });
    return closed;
  }

  statusFor(
    record: AttendanceRecord | undefined,
    event: SchoolEvent,
  ): AttendanceStatus {
    return attendanceStatus(record, event);
  }

  private reject(reason: string): ScanResult {
    return { accepted: false, tone: 'rejected', message: reason };
  }
}
