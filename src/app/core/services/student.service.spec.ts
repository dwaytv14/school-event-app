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
    const service = new StudentService(store);

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
});