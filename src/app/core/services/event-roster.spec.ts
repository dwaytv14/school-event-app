import { SchoolEvent } from '../models/school-event.models';
import { isStudentRequired } from './event-roster';

const base: SchoolEvent = {
  id: 'E', name: 'E', date: '2030-01-01', startTime: '08:00', endTime: '10:00',
  venue: 'Gym', description: '', graceMinutes: 15, sections: [], seats: [],
};

describe('isStudentRequired', () => {
  it('uses the student section when the event has no saved roster', () => {
    const event = { ...base, requiredSections: ['sec-1a'] };

    expect(isStudentRequired(event, { id: 'S1', sectionId: 'sec-1a' })).toBe(true);
    expect(isStudentRequired(event, { id: 'S2', sectionId: 'sec-2a' })).toBe(false);
    expect(isStudentRequired(event, { id: 'S3' })).toBe(false);
  });

  it('uses the saved roster once students moved up, whatever section they are in now', () => {
    const event = {
      ...base,
      requiredSections: ['sec-1a'],
      roster: { 'BSIT 1st Year A': ['S1'] },
    };

    // S1 is now in 2nd year, but was required then. S2 only joined that section later.
    expect(isStudentRequired(event, { id: 'S1', sectionId: 'sec-2a' })).toBe(true);
    expect(isStudentRequired(event, { id: 'S2', sectionId: 'sec-1a' })).toBe(false);
  });
});
