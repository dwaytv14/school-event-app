import { TestBed } from '@angular/core/testing';
import { DemoStoreService } from './demo-store.service';
import { StudentService } from './student.service';

describe('student setup', () => {
  beforeEach(() => localStorage.clear());

  it('starts with no sample students or events', () => {
    const store = new DemoStoreService();

    expect(store.state().students).toEqual([]);
    expect(store.state().events).toEqual([]);
  });

  it('adds a student and creates seats for their section in existing events', () => {
    const store = new DemoStoreService();
    const event = {
      id: 'EVT-user-created',
      name: 'User event',
      date: '2026-12-01',
      startTime: '09:00',
      endTime: '15:00',
      venue: 'Main hall',
      description: '',
      graceMinutes: 10,
      sections: [],
      seats: [],
    };
    store.update((state) => state.events.push(event));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DemoStoreService, useValue: store }] });
    const service = TestBed.runInInjectionContext(() => new StudentService());

    const student = service.add({
      name: 'Alex Student',
      section: 'Grade 10-A',
      mobile: '+639123456789',
    });

    const savedEvent = store.state().events[0];
    expect(store.state().students).toEqual([student]);
    expect(savedEvent.sections).toContain('Grade 10-A');
    expect(savedEvent.seats).toHaveLength(12);
    expect(savedEvent.seats[0].studentId).toBe(student.id);
  });

  it('does not make individual seat assignments for section-based seating plans', () => {
    const store = new DemoStoreService();
    const event = {
      id: 'EVT-section-seating',
      name: 'Gym day',
      date: '2026-12-01',
      startTime: '09:00',
      endTime: '15:00',
      venue: 'Gymnasium',
      description: '',
      graceMinutes: 10,
      sections: [],
      seats: [],
      requiredSections: ['section-a'],
      seatingPlan: {
        gymnasiumBenchGroups: [
          {
            id: 'left-1',
            side: 'left' as const,
            number: 1,
            sectionId: 'section-a',
          },
        ],
        sectionSeatCounts: { 'section-a': 0 },
      },
    };
    store.update((state) => state.events.push(event));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DemoStoreService, useValue: store }] });
    const service = TestBed.runInInjectionContext(() => new StudentService());

    const student = service.add({
      name: 'Alex Student',
      section: 'BSIT 1st Year A',
      sectionId: 'section-a',
      course: 'BSIT',
      yearLevel: '1st Year',
      mobile: '+639123456789',
    });

    expect(store.state().events[0].sections).toContain(student.section);
    expect(store.state().events[0].seats).toEqual([]);
  });
});