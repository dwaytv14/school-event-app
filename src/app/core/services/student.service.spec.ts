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

  it('adds a student without creating a seat assignment', () => {
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
      sections: ['Grade 10-A'],
      seats: [],
      requiredSections: ['section-a'],
    };
    store.update((state) => state.events.push(event));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DemoStoreService, useValue: store }] });
    const service = TestBed.runInInjectionContext(() => new StudentService());

    const student = service.add({
      name: 'Alex Student',
      section: 'Grade 10-A',
      sectionId: 'section-a',
      mobile: '+639123456789',
    });

    const savedEvent = store.state().events[0];
    expect(store.state().students).toEqual([student]);
    expect(savedEvent.seats).toEqual([]);
  });

  it('does not assign a student to legacy seat records', () => {
    const store = new DemoStoreService();
    const event = {
      id: 'EVT-section-event',
      name: 'Gym day',
      date: '2026-12-01',
      startTime: '09:00',
      endTime: '15:00',
      venue: 'Gymnasium',
      description: '',
      graceMinutes: 10,
      sections: [],
      requiredSections: ['section-a'],
      seats: [
        {
          id: 'legacy-seat',
          section: 'BSIT 1st Year A',
          row: 1,
          number: 1,
          studentId: null,
        },
      ],
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
    expect(store.state().events[0].seats[0].studentId).toBeNull();
  });
});