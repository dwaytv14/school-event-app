import { inject, Injectable } from '@angular/core';
import { DemoStoreService } from './demo-store.service';
import { SchoolEvent } from '../models/school-event.models';

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly store = inject(DemoStoreService);

  select(id: string): void {
    this.store.update((state) => {
      state.selectedEventId = id;
    });
  }

  save(
    input: Omit<SchoolEvent, 'id' | 'sections' | 'seats' | 'seatingPlan'>,
    existingId?: string,
    selectedSections: Array<{ id: string; label: string }> = [],
  ): SchoolEvent {
    const state = this.store.state();
    const existing = state.events.find((event) => event.id === existingId);
    if (existing) {
      // Partial updates must keep the event's selected sections.
      input = {
        ...input,
        requiredSections: input.requiredSections ?? existing.requiredSections,
      };
    }
    const eventId = existing?.id ?? `EVT-${Date.now()}`;
    const requiredSections = input.requiredSections ?? [];
    const eventSections = selectedSections.length
      ? [...new Set(selectedSections.map((section) => section.label))]
      : existing?.sections ?? [];
    const event: SchoolEvent = existing
      ? { ...existing, ...input, sections: eventSections }
      : {
        ...input,
        id: eventId,
        sections: eventSections,
        seats: [],
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
}
