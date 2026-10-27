import { Injectable } from '@angular/core';
import { DemoStoreService } from './demo-store.service';

@Injectable({ providedIn: 'root' })
export class SeatingService {
  constructor(private readonly store: DemoStoreService) {}

  assign(eventId: string, studentId: string, seatId: string): boolean {
    let assigned = false;
    this.store.update((state) => {
      const event = state.events.find((item) => item.id === eventId);
      const student = state.students.find((item) => item.id === studentId);
      const target = event?.seats.find((seat) => seat.id === seatId);
      if (
        !event ||
        !student ||
        !target ||
        target.section !== student.section ||
        (target.studentId && target.studentId !== studentId)
      )
        return;
      const occupied = state.attendance.some(
        (record) =>
          record.eventId === eventId &&
          record.studentId !== studentId &&
          record.timeIn &&
          !record.timeOut &&
          event.seats.find((seat) => seat.studentId === record.studentId)
            ?.id === seatId,
      );
      if (occupied) return;
      event.seats.forEach((seat) => {
        if (seat.studentId === studentId) seat.studentId = null;
      });
      target.studentId = studentId;
      assigned = true;
    });
    return assigned;
  }
}
