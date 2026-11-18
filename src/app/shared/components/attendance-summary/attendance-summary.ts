import { Component, computed, input, output, signal } from '@angular/core';
import { IonChip } from '@ionic/angular';
import { AttendanceRow, AttendanceSummary, canExcuseRow } from '../../../core/services/my-attendance.service';
import { ExcuseRequest } from '../../../core/services/workspace-api.service';
import { clock12, timeOfDay } from '../../../core/services/time-format';
import { StatePanelComponent } from '../state-panel/state-panel';

export type AttendanceFilter = 'all' | 'upcoming' | 'attended' | 'absent' | 'excused';

/** Which filter group a row belongs to, so upcoming events are kept apart from past ones. */
export function filterGroup(row: AttendanceRow): Exclude<AttendanceFilter, 'all'> {
  switch (row.status) {
    case 'Upcoming':
    case 'Ongoing':
    case 'Cancelled':
      return 'upcoming';
    case 'Absent':
      return 'absent';
    case 'Excused':
      return 'excused';
    default:
      return 'attended'; // Present, Late (and anything else the student actually went to)
  }
}

/** A student's attendance rate and the list of their events (dumb component). */
@Component({
  selector: 'app-attendance-summary',
  standalone: true,
  imports: [IonChip, StatePanelComponent],
  templateUrl: './attendance-summary.html',
  styleUrl: './attendance-summary.scss',
})
export class AttendanceSummaryComponent {
  readonly summary = input.required<AttendanceSummary>();
  readonly excuses = input<ExcuseRequest[]>([]);
  /** Students can ask to be excused from an event they missed. */
  readonly allowExcuse = input(false);
  readonly excuse = output<string>();
  readonly withdraw = output<string>();

  /** Which events the list shows. */
  readonly filter = signal<AttendanceFilter>('all');
  readonly filterOptions: { key: AttendanceFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'attended', label: 'Attended' },
    { key: 'absent', label: 'Absent' },
    { key: 'excused', label: 'Excused' },
  ];
  readonly counts = computed(() => {
    const counts: Record<AttendanceFilter, number> = { all: 0, upcoming: 0, attended: 0, absent: 0, excused: 0 };
    for (const row of this.summary().rows) {
      counts.all += 1;
      counts[filterGroup(row)] += 1;
    }
    return counts;
  });
  readonly visibleRows = computed(() => {
    const filter = this.filter();
    const rows = this.summary().rows.filter((row) => filter === 'all' || filterGroup(row) === filter);
    // The list is newest first; what is coming up reads better soonest first.
    return filter === 'upcoming'
      ? [...rows].sort((a, b) => `${a.event.date}${a.event.startTime}`.localeCompare(`${b.event.date}${b.event.startTime}`))
      : rows;
  });

  color(status: string): string {
    switch (status) {
      case 'Present':
        return 'success';
      case 'Late':
      case 'Incomplete':
        return 'warning';
      case 'Absent':
        return 'danger';
      case 'Ongoing':
      case 'Upcoming':
        return 'primary';
      default:
        return 'medium';
    }
  }

  /**
   * A student can send an excuse letter from the day before the event, during
   * it (not yet checked in), or after missing it (absent).
   */
  canExcuse(row: AttendanceRow, now: Date = new Date()): boolean {
    return canExcuseRow(row, now);
  }

  requestFor(eventId: string): ExcuseRequest | undefined {
    return this.excuses().find(
      (item) => item.eventId === eventId && item.status !== 'approved',
    );
  }

  date(value: string): string {
    return new Date(`${value}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

  time(value: string | null | undefined): string {
    return timeOfDay(value);
  }

  clock(value: string): string {
    return clock12(value);
  }
}
