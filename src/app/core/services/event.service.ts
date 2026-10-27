import { Injectable } from '@angular/core';
import { DemoStoreService } from './demo-store.service';
import { SchoolEvent, Student } from '../models/school-event.models';

@Injectable({ providedIn: 'root' })
export class EventService {
  constructor(private readonly store: DemoStoreService) {}

  select(id: string): void {
    this.store.update((state) => {
      state.selectedEventId = id;
    });
  }

  save(
    input: Omit<SchoolEvent, 'id' | 'sections' | 'seats'>,
    existingId?: string,
  ): SchoolEvent {
    const state = this.store.state();
    const existing = state.events.find((event) => event.id === existingId);
    const eventId = existing?.id ?? `EVT-${Date.now()}`;
    const requiredSections = input.requiredSections ?? [];
    const attendees = input.requiredSections
      ? state.students.filter(
          (student) =>
            student.sectionId !== undefined &&
            requiredSections.includes(student.sectionId),
        )
      : state.students;
    const eventSections = [...new Set(attendees.map((student) => student.section))];
    const event: SchoolEvent = existing
      ? { ...existing, ...input }
      : {
          ...input,
          id: eventId,
          sections: eventSections,
          seats: this.createSeats(eventId, attendees),
          requiredSections,
          approvalStatus: state.role === 'organizer' ? 'pending' : 'approved',
        };
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

  private createSeats(eventId: string, students: Student[]) {
    const sections = [...new Set(students.map((student) => student.section))];
    return sections.flatMap((section) => {
      const members = students.filter((student) => student.section === section);
      return Array.from({ length: 12 }, (_, index) => ({
        id: `${eventId}-${section.replaceAll(' ', '-').toLowerCase()}-${index + 1}`,
        section,
        row: Math.floor(index / 6) + 1,
        number: (index % 6) + 1,
        studentId: members[index]?.id ?? null,
      }));
    });
  }
}
