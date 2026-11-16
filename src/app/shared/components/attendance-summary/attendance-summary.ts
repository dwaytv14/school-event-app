import { Component, input, output } from '@angular/core';
import { IonChip } from '@ionic/angular';
import { AttendanceSummary } from '../../../core/services/my-attendance.service';
import { ExcuseRequest } from '../../../core/services/workspace-api.service';
import { StatePanelComponent } from '../state-panel/state-panel';

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
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
