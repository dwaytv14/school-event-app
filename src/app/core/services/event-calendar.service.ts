import { Injectable } from '@angular/core';
import { SchoolEvent } from '../models/school-event.models';

export type EventFilter = 'upcoming' | 'past' | 'all';

export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  count: number;
}

/** Filtering and month-grid helpers for the Events page. */
@Injectable({ providedIn: 'root' })
export class EventCalendarService {
  isPast(event: SchoolEvent, now: Date = new Date()): boolean {
    const end = new Date(`${event.date}T${event.endTime || '23:59'}:00`).getTime();
    return Number.isFinite(end) && end < now.getTime();
  }

  filter(
    events: SchoolEvent[],
    filter: EventFilter,
    now: Date = new Date(),
  ): SchoolEvent[] {
    const key = (event: SchoolEvent) => `${event.date}${event.startTime}`;
    const shown = events.filter((event) =>
      filter === 'all' ? true : this.isPast(event, now) === (filter === 'past'),
    );
    // Soonest first for what is coming; most recent first for what is over.
    return [...shown].sort((left, right) =>
      filter === 'upcoming'
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
