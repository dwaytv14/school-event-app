import { TestBed } from '@angular/core/testing';
import { SchoolEvent } from '../models/school-event.models';
import { EventCalendarService } from './event-calendar.service';

function event(id: string, date: string, start = '08:00', end = '12:00'): SchoolEvent {
  return {
    id,
    name: id,
    date,
    startTime: start,
    endTime: end,
    venue: 'Gymnasium',
    description: '',
    graceMinutes: 15,
    sections: [],
    seats: [],
  };
}

describe('EventCalendarService', () => {
  const service = () => TestBed.inject(EventCalendarService);
  const now = new Date('2030-03-10T15:00:00');
  const events = [
    event('old', '2030-03-01'),
    event('today-over', '2030-03-10', '08:00', '12:00'),
    event('today-later', '2030-03-10', '16:00', '18:00'),
    event('soon', '2030-03-15'),
    event('later', '2030-04-02'),
  ];

  it('splits upcoming and past, soonest first and latest first', () => {
    expect(service().filter(events, 'upcoming', now).map((e) => e.id)).toEqual([
      'today-later',
      'soon',
      'later',
    ]);
    expect(service().filter(events, 'past', now).map((e) => e.id)).toEqual([
      'today-over',
      'old',
    ]);
    expect(service().filter(events, 'all', now)).toHaveLength(5);
  });

  it('builds a 6-week month grid with event counts', () => {
    const cells = service().monthCells(2030, 2, events);

    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2030-02-24'); // March 2030 starts on a Friday
    expect(cells.find((cell) => cell.date === '2030-03-10')?.count).toBe(2);
    expect(cells.find((cell) => cell.date === '2030-03-15')?.count).toBe(1);
    expect(cells.find((cell) => cell.date === '2030-04-02')?.inMonth).toBe(false);
  });

  it('lists a day\'s events in time order', () => {
    expect(service().eventsOn(events, '2030-03-10').map((e) => e.id)).toEqual([
      'today-over',
      'today-later',
    ]);
  });
});
