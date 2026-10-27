import { Injectable } from '@angular/core';
import {
  AttendanceRecord,
  AttendanceStatus,
  SchoolEvent,
} from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';

export interface ScanResult {
  accepted: boolean;
  tone: 'success' | 'warning' | 'rejected';
  message: string;
  record?: AttendanceRecord;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  constructor(private readonly store: DemoStoreService) {}

  scan(
    eventId: string,
    studentId: string,
    gateSection: string,
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

    const seat = event.seats.find((item) => item.studentId === studentId);
    if (!seat)
      return this.reject(
        eventId,
        studentId,
        'Not registered for this event.',
        null,
      );
    if (gateSection !== seat.section) {
      return this.reject(
        eventId,
        studentId,
        `Wrong section gate. Go to ${seat.section}, Row ${seat.row}, Seat ${seat.number}.`,
        seat.id,
      );
    }
    const occupant = state.attendance.find(
      (record) =>
        record.eventId === eventId &&
        record.studentId !== studentId &&
        record.timeIn &&
        !record.timeOut &&
        event.seats.find((item) => item.studentId === record.studentId)?.id ===
          seat.id,
    );
    if (occupant)
      return this.reject(
        eventId,
        studentId,
        `Seat already occupied. Assigned seat: ${seat.section}, Row ${seat.row}, Seat ${seat.number}.`,
        seat.id,
      );
    const prior = state.attendance.find(
      (record) => record.eventId === eventId && record.studentId === studentId,
    );
    if (prior?.timeOut)
      return {
        accepted: false,
        tone: 'rejected',
        message: 'Time-out is already recorded for this event.',
      };

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
      if (existing) {
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
    const action = record!.timeOut ? 'TIME-OUT recorded' : 'TIME-IN recorded';
    return {
      accepted: true,
      tone: !record!.timeOut && late ? 'warning' : 'success',
      message: `${action}${!record!.timeOut && late ? ' · Late arrival' : ''}`,
      record: record!,
    };
  }

  statusFor(
    record: AttendanceRecord | undefined,
    event: SchoolEvent,
  ): AttendanceStatus {
    if (!record) return 'Absent';
    if (!record.timeOut) return 'Incomplete';
    const timeIn = new Date(record.timeIn);
    const eventStart = new Date(`${event.date}T${event.startTime}:00`);
    return timeIn.getTime() > eventStart.getTime() + event.graceMinutes * 60000
      ? 'Late'
      : 'Present';
  }

  private reject(
    eventId: string,
    studentId: string,
    reason: string,
    expectedSeatId: string | null,
  ): ScanResult {
    this.store.update((state) =>
      state.violations.push({
        id: `VIO-${Date.now()}`,
        eventId,
        studentId,
        reason,
        expectedSeatId,
        createdAt: new Date().toISOString(),
      }),
    );
    return { accepted: false, tone: 'rejected', message: reason };
  }
}
