import { Injectable } from '@angular/core';
import { SchoolEvent } from '../models/school-event.models';
import { schoolDateKey } from './time-format';

export type EventFilter = 'ongoing' | 'upcoming' | 'past' | 'all';

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  count: number;
}

/** Filtering and month-grid helpers for the Events page. */
@Injectable({ providedIn: 'root' })
export class EventCalendarService {
  /**
   * Where an event stands by its day, not its clock times: events often run
   * over, so an event stays "ongoing" for the whole day it is held.
   */
  phase(event: SchoolEvent, now: Date = new Date()): 'ongoing' | 'upcoming' | 'past' {
    const today = schoolDateKey(now);
    if (event.finishedAt) return 'past';
    if (event.date === today) return 'ongoing';
    return event.date > today ? 'upcoming' : 'past';
  }

  isPast(event: SchoolEvent, now: Date = new Date()): boolean {
    return this.phase(event, now) === 'past';
  }

  filter(
    events: SchoolEvent[],
    filter: EventFilter,
    now: Date = new Date(),
  ): SchoolEvent[] {
    const key = (event: SchoolEvent) => `${event.date}${event.startTime}`;
    const shown = events.filter((event) =>
      filter === 'all' ? true : this.phase(event, now) === filter,
    );
    // Soonest first for what is coming or happening; most recent first for what is over.
    return [...shown].sort((left, right) =>
      filter === 'upcoming' || filter === 'ongoing'
        ? key(left).localeCompare(key(right))
        : key(right).localeCompare(key(left)),
    );
  }

  /** A 6-week grid (Sunday first) for the given month, with event counts per day. */
  monthCells(year: number, month: number, events: SchoolEvent[]): CalendarCell[] {
    const counts = new Map<string, number>();
    events.forEach((event) =>
      counts.set(event.date, (counts.get(event.date) ?? 0) + 1),
    );
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const date = this.toDateKey(day);
      return {
        date,
        day: day.getDate(),
        inMonth: day.getMonth() === month,
        count: counts.get(date) ?? 0,
      };
    });
  }

  eventsOn(events: SchoolEvent[], date: string): SchoolEvent[] {
    return events
      .filter((event) => event.date === date)
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }

  toDateKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }
}
