import { TestBed } from '@angular/core/testing';

import { DemoStoreService } from './demo-store.service';
import { EventService } from './event.service';
import { EventSeatingPlan } from '../models/school-event.models';

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

  it('creates sections and seats for selected sections with no students', () => {
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
    expect(event.seats).toHaveLength(24);
    expect(event.seats.every((seat) => seat.studentId === null)).toBe(true);
  });

  it('updates selected sections without keeping seats from removed sections', () => {
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
    expect(updated.seats).toHaveLength(12);
    expect(updated.seats.every((seat) => seat.section === 'BSIT 1st Year B')).toBe(true);
  });

  it('creates only the configured shared chairs and keeps gymnasium bench groups', () => {
    const gymnasiumBenchGroups: EventSeatingPlan['gymnasiumBenchGroups'] = [
      ...(['left', 'right'] as const).flatMap((side) =>
        Array.from({ length: 5 }, (_, index) => ({
          id: `${side}-${index + 1}`,
          side,
          number: index + 1,
          sectionId: null,
        })),
      ),
    ];
    gymnasiumBenchGroups[0].sectionId = 'section-a';
    const seatingPlan: EventSeatingPlan = {
      gymnasiumBenchGroups,
      sharedSeatCount: 3,
      sharedSectionIds: ['section-b'],
      sectionSeatCounts: {},
    };
    const event = events.save(
      {
        name: 'Campus day',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Gymnasium',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a', 'section-b'],
        seatingPlan,
      },
      undefined,
      [
        { id: 'section-a', label: 'BSIT 1st Year A' },
        { id: 'section-b', label: 'BSIT 1st Year B' },
      ],
    );

    expect(event.seats).toHaveLength(3);
    expect(event.seats.every((seat) => seat.sectionId === undefined)).toBe(true);
    expect(event.seats.map((seat) => seat.number)).toEqual([1, 2, 3]);
    expect(event.seats.every((seat) => seat.studentId === null)).toBe(true);
    expect(event.seatingPlan?.gymnasiumBenchGroups).toHaveLength(10);
    expect(event.seatingPlan?.gymnasiumBenchGroups[0].sectionId).toBe(
      'section-a',
    );
  });
  it('keeps the seating plan and required sections when only the grace period changes', () => {
    const plan: EventSeatingPlan = {
      gymnasiumBenchGroups: [],
      sharedSeatCount: 5,
      sharedSectionIds: ['section-a'],
      sectionSeatCounts: {},
    };
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
        seatingPlan: plan,
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
    expect(updated.seatingPlan).toEqual(plan);
    expect(updated.seats).toHaveLength(5);
  });
  it('lays out chairs in the rows and chairs-per-row the organizer chose', () => {
    const event = events.save(
      {
        name: 'Assembly',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Conference room',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
        seatingPlan: {
          gymnasiumBenchGroups: [],
          sharedSeatCount: 24,
          rows: 3,
          seatsPerRow: 8,
          sharedSectionIds: ['section-a'],
          sectionSeatCounts: {},
        },
      },
      undefined,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );

    expect(event.seats).toHaveLength(24);
    expect(event.seats[0]).toMatchObject({ row: 1, number: 1 });
    expect(event.seats[7]).toMatchObject({ row: 1, number: 8 });
    expect(event.seats[8]).toMatchObject({ row: 2, number: 1 });
    expect(event.seats[23]).toMatchObject({ row: 3, number: 8 });
  });
  it('builds two separate lines of chairs and adds their totals', () => {
    const event = events.save(
      {
        name: 'Assembly',
        date: '2030-01-01',
        startTime: '08:00',
        endTime: '16:00',
        venue: 'Gymnasium',
        description: '',
        graceMinutes: 15,
        requiredSections: ['section-a'],
        seatingPlan: {
          gymnasiumBenchGroups: [],
          sharedSeatCount: 200,
          blocks: [
            { rows: 10, seatsPerRow: 10 },
            { rows: 10, seatsPerRow: 10 },
          ],
          sharedSectionIds: ['section-a'],
          sectionSeatCounts: {},
        },
      },
      undefined,
      [{ id: 'section-a', label: 'BSIT 1st Year A' }],
    );

    expect(event.seats).toHaveLength(200);
    expect(event.seats.filter((seat) => seat.block === 0)).toHaveLength(100);
    expect(event.seats.filter((seat) => seat.block === 1)).toHaveLength(100);
    expect(event.seats[100]).toMatchObject({ block: 1, row: 1, number: 1 });
    expect(event.seats[199]).toMatchObject({ block: 1, row: 10, number: 10 });
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
