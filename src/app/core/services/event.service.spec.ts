import { TestBed } from '@angular/core/testing';

import { DemoStoreService } from './demo-store.service';
import { EventService } from './event.service';

describe('EventService', () => {
  let events: EventService;
  let store: DemoStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    events = TestBed.inject(EventService);
    store = TestBed.inject(DemoStoreService);
    store.replace({
      ...store.state(),
      role: 'super_admin',
      selectedEventId: '',
      students: [],
      events: [],
    });
  });

  it('creates an event for selected sections without seat data', () => {
    const event = events.save(
      {
        name: 'Campus day',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Quadrangle',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a', 'section-b'],
      },
      undefined,
      [
        { id: 'section-a', label: 'BSIT 1st Year A' },
        { id: 'section-b', label: 'BSIT 1st Year B' },
      ],
    );

    expect(event.sections).toEqual(['BSIT 1st Year A', 'BSIT 1st Year B']);
    expect(event.seats).toEqual([]);
    expect(event.seatingPlan).toBeUndefined();
  });

  it('updates selected sections without creating seats', () => {
    const existing = events.save(
      {
        name: 'Campus day',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Quadrangle',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
      },
      undefined,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );

    const updated = events.save(
      {
        name: 'Campus day',
        date: existing.date,
        startTime: existing.startTime,
        endTime: existing.endTime,
        venue: existing.venue,
        description: existing.description,
        graceMinutes: existing.graceMinutes,
        requiredSections: ['section-b'],
      },
      existing.id,
      [{ id: 'section-b', label: 'BSIT 1st Year B' }],
    );

    expect(updated.sections).toEqual(['BSIT 1st Year B']);
    expect(updated.seats).toEqual([]);
  });

  it('keeps selected sections when only the grace period changes', () => {
    const created = events.save(
      {
        name: 'Assembly',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Conference room',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
      },
      undefined,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );

    const updated = events.save(
      {
        name: created.name,
        date: created.date,
        startTime: created.startTime,
        endTime: created.endTime,
        venue: created.venue,
        description: created.description,
        graceMinutes: 30,
      },
      created.id,
    );

    expect(updated.graceMinutes).toBe(30);
    expect(updated.requiredSections).toEqual(['section-a']);
    expect(updated.sections).toEqual(['BSIT 1st Year A']);
    expect(updated.seats).toEqual([]);
    expect(updated.seatingPlan).toBeUndefined();
  });
  it('sends an edited organizer event back for approval and clears the rejection', () => {
    const created = events.save(
      {
        name: 'Campus day',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Gymnasium',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
      },
      undefined,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );
    store.update((state) => {
      state.role = 'organizer';
      const event = state.events.find((item) => item.id === created.id);
      if (event) {
        event.approvalStatus = 'rejected';
        event.rejectionReason = 'Pick the right sections';
      }
    });

    const edited = events.save(
      {
        name: 'Campus day (fixed)',
        date: created.date,
        startTime: created.startTime,
        endTime: created.endTime,
        venue: created.venue,
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
      },
      created.id,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );

    expect(edited.approvalStatus).toBe('pending');
    expect(edited.rejectionReason).toBeUndefined();
    expect(edited.resubmittedAt).toBeTruthy();
  });
});
