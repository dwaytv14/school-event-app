import { inject, Injectable } from '@angular/core';
import {
  AttendanceRecord,
  AttendanceStatus,
  SchoolEvent,
} from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';
import { isStudentRequired } from './event-roster';

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

    const seat = event.seats.find((item) => item.studentId === studentId);
    if (event.seatingPlan) {
      const sectionId = student.sectionId ?? '';
      if (!isStudentRequired(event, student)) {
        return this.reject('Not registered for this event.');
      }
      const sharedSeatCount =
        event.seatingPlan.sharedSeatCount ??
        Object.values(event.seatingPlan.sectionSeatCounts ?? {}).reduce(
          (total, count) => total + count,
          0,
        );
      // Every required section sits in the event's chairs. Only enforce the
      // chair limit when chairs were actually set up.
      if (!prior && sharedSeatCount > 0) {
        const occupied = state.attendance.filter((record) => {
          if (
            record.eventId !== eventId ||
            record.studentId === studentId ||
            !record.timeIn ||
            record.timeOut
          ) {
            return false;
          }
          const attendee = state.students.find(
            (item) => item.id === record.studentId,
          );
          return !!attendee && isStudentRequired(event, attendee);
        }).length;
        if (occupied >= sharedSeatCount) {
          return this.reject(
            `All ${sharedSeatCount} chairs are currently occupied.`,
          );
        }
      }
    } else {
      if (!seat)
        return this.reject('Not registered for this event.');
    }

    const now = new Date();
    const timestamp = now.toISOString();
    const eventStart = new Date(`${event.date}T${event.startTime}:00`);
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

  statusFor(
    record: AttendanceRecord | undefined,
    event: SchoolEvent,
  ): AttendanceStatus {
    if (!record) return 'Absent';
    if (record.excused) return 'Excused';
    if (!record.timeOut) return 'Incomplete';
    const timeIn = new Date(record.timeIn);
    const eventStart = new Date(`${event.date}T${event.startTime}:00`);
    return timeIn.getTime() > eventStart.getTime() + event.graceMinutes * 60000
      ? 'Late'
      : 'Present';
  }

  private reject(reason: string): ScanResult {
    return { accepted: false, tone: 'rejected', message: reason };
  }
}
