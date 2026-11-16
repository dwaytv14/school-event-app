import { inject, Injectable } from '@angular/core';
import { DemoStoreService } from './demo-store.service';
import { EventSeatingPlan, SchoolEvent, Student } from '../models/school-event.models';

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly store = inject(DemoStoreService);

  select(id: string): void {
    this.store.update((state) => {
      state.selectedEventId = id;
    });
  }

  save(
    input: Omit<SchoolEvent, 'id' | 'sections' | 'seats'>,
    existingId?: string,
    selectedSections: Array<{ id: string; label: string }> = [],
  ): SchoolEvent {
    const state = this.store.state();
    const existing = state.events.find((event) => event.id === existingId);
    if (existing) {
      // Partial updates (for example the grace period setting) must not wipe the
      // seating plan or required sections the event already has.
      input = {
        ...input,
        seatingPlan: input.seatingPlan ?? existing.seatingPlan,
        requiredSections: input.requiredSections ?? existing.requiredSections,
      };
    }
    const eventId = existing?.id ?? `EVT-${Date.now()}`;
    const requiredSections = input.requiredSections ?? [];
    const attendees = input.requiredSections
      ? state.students.filter(
          (student) =>
            student.sectionId !== undefined &&
            requiredSections.includes(student.sectionId),
        )
      : state.students;
    const eventSections = [
      ...new Set([
        ...selectedSections.map((section) => section.label),
        ...attendees.map((student) => student.section),
      ]),
    ];
    const seats = input.seatingPlan
      ? this.createConfiguredSeats(
          eventId,
          input.seatingPlan,
          existing?.seats ?? [],
        )
      : this.createLegacySeats(
          eventId,
          attendees,
          eventSections,
          existing?.seats ?? [],
        );
    const event: SchoolEvent = existing
      ? { ...existing, ...input, sections: eventSections, seats }
      : {
        ...input,
        id: eventId,
        sections: eventSections,
        seats,
        requiredSections,
        approvalStatus: state.role === 'organizer' ? 'pending' : 'approved',
        };
    if (existing && state.role === 'organizer') {
      // An edit by the organizer is a new submission for the admin to review.
      event.approvalStatus = 'pending';
      event.resubmittedAt = new Date().toISOString();
      delete event.rejectionReason;
    }
    if (existing && state.role === 'super_admin' && existing.approvalStatus === 'rejected') {
      // Changing a rejected event sends it back for approval.
      event.approvalStatus = 'pending';
      delete event.rejectionReason;
    }
    this.store.update((current) => {
      if (existing)
        current.events = current.events.map((item) =>
          item.id === existing.id ? event : item,
        );
      else current.events = [event, ...current.events];
      current.selectedEventId = event.id;
    });
    return event;
  }

  private createConfiguredSeats(
    eventId: string,
    plan: EventSeatingPlan,
    existingSeats: SchoolEvent['seats'],
  ): SchoolEvent['seats'] {
    const seats: SchoolEvent['seats'] = [];
    const previous = existingSeats.filter((seat) => !seat.sectionId);
    if (plan.blocks?.length) {
      plan.blocks.forEach((block, blockIndex) => {
        for (let index = 0; index < block.rows * block.seatsPerRow; index += 1) {
          const position = seats.length;
          seats.push({
            id: previous[position]?.id ?? `${eventId}-shared-${position + 1}`,
            block: blockIndex,
            section: 'Shared seating',
            row: Math.floor(index / block.seatsPerRow) + 1,
            number: (index % block.seatsPerRow) + 1,
            studentId: null,
          });
        }
      });
      return seats;
    }
    const count =
      plan.sharedSeatCount ??
      Object.values(plan.sectionSeatCounts ?? {}).reduce(
        (total, sectionCount) => total + sectionCount,
        0,
      );
    const perRow =
      plan.seatsPerRow && plan.seatsPerRow > 0 ? plan.seatsPerRow : 0;
    for (let index = 0; index < count; index += 1) {
      seats.push({
        id: previous[index]?.id ?? `${eventId}-shared-${index + 1}`,
        section: 'Shared seating',
        row: Math.floor(index / (perRow || 10)) + 1,
        number: perRow ? (index % perRow) + 1 : index + 1,
        studentId: null,
      });
    }
    return seats;
  }

  private createLegacySeats(
    eventId: string,
    students: Student[],
    sections: string[],
    existingSeats: SchoolEvent['seats'],
  ): SchoolEvent['seats'] {
    const seats = existingSeats
      .filter((seat) => sections.includes(seat.section))
      .map((seat) => ({ ...seat }));

    sections.forEach((section) => {
      const members = students.filter((student) => student.section === section);
      const sectionSeats = seats.filter((seat) => seat.section === section);
      while (sectionSeats.length < Math.max(12, members.length)) {
        const index = sectionSeats.length;
        const seat: SchoolEvent['seats'][number] = {
          id: `${eventId}-${section.replaceAll(' ', '-').toLowerCase()}-${index + 1}`,
          section,
          row: Math.floor(index / 6) + 1,
          number: (index % 6) + 1,
          studentId: null,
        };
        sectionSeats.push(seat);
        seats.push(seat);
      }

      members.forEach((student) => {
        if (sectionSeats.some((seat) => seat.studentId === student.id)) return;
        const availableSeat = sectionSeats.find((seat) => seat.studentId === null);
        if (availableSeat) availableSeat.studentId = student.id;
      });
    });

    return seats;
  }
}
