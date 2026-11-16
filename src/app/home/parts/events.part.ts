import { computed, signal } from '@angular/core';
import { EventFilter } from '../../core/services/event-calendar.service';
import { AnnouncementAudience, SchoolEvent } from '../../core/models/school-event.models';
import { AttendancePart } from './attendance.part';

/** The event list and calendar, approvals, cancelling and moving events. */
export abstract class EventsPart extends AttendancePart {

  // ---- Events: filter + calendar ----
  readonly eventFilter = signal<EventFilter>('upcoming');
  readonly eventView = signal<'list' | 'calendar'>('list');
  readonly calendarMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly selectedDay = signal(this.calendar.toDateKey(new Date()));
  readonly todayKey = this.calendar.toDateKey(new Date());
  readonly weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly calendarCells = computed(() =>
    this.calendar.monthCells(
      this.calendarMonth().getFullYear(),
      this.calendarMonth().getMonth(),
      this.state().events,
    ),
  );
  readonly calendarTitle = computed(() =>
    this.calendarMonth().toLocaleDateString([], { month: 'long', year: 'numeric' }),
  );
  /** What the Events page lists: the chosen filter, or the tapped calendar day. */
  readonly visibleEvents = computed(() => {
    if (this.eventView() === 'calendar') {
      return this.calendar.eventsOn(this.state().events, this.selectedDay());
    }
    const listed = this.calendar.filter(this.state().events, this.eventFilter());
    const status = this.eventStatusFilter();
    return this.auth.role() === 'student' || status === 'all'
      ? listed
      : listed.filter((event) => (event.approvalStatus ?? 'approved') === status);
  });
  setEventFilter(value: unknown): void {
    if (value === 'upcoming' || value === 'past' || value === 'all') {
      this.eventFilter.set(value);
    }
  }
  setEventView(value: unknown): void {
    if (value === 'list' || value === 'calendar') this.eventView.set(value);
  }
  shiftCalendar(months: number): void {
    const current = this.calendarMonth();
    this.calendarMonth.set(new Date(current.getFullYear(), current.getMonth() + months, 1));
  }
  selectDay(date: string): void {
    this.selectedDay.set(date);
    const day = new Date(`${date}T12:00:00`);
    if (day.getMonth() !== this.calendarMonth().getMonth()) {
      this.calendarMonth.set(new Date(day.getFullYear(), day.getMonth(), 1));
    }
  }
  cellLabel(cell: { date: string; count: number }): string {
    const label = this.formatDate(cell.date);
    return cell.count ? `${label}, ${cell.count} event${cell.count === 1 ? '' : 's'}` : label;
  }
  selectedDayLabel(): string {
    return `${this.formatDate(this.selectedDay())}`;
  }
  eventsEmptyHeading(): string {
    if (this.eventView() === 'calendar') return 'No events on this day';
    return { upcoming: 'No upcoming events', past: 'No past events', all: 'No events yet' }[
      this.eventFilter()
    ];
  }
  eventsEmptyMessage(): string {
    if (this.eventView() === 'calendar') return 'Pick a day with a dot to see its events.';
    if (this.eventFilter() !== 'all') {
      return 'Try the other filter, or switch to All to see every event.';
    }
    return this.state().role === 'student'
      ? 'Approved school events will appear here.'
      : 'Create the first event to get your calendar started.';
  }

  // ======================= Admin: cancel / postpone an event =======================
  protected eventAudience(event: SchoolEvent): AnnouncementAudience {
    return event.requiredSections?.length
      ? { type: 'sections', sectionIds: [...event.requiredSections] }
      : { type: 'all' };
  }

  async cancelActiveEvent(): Promise<void> {
    const event = this.activeEvent();
    if (!event || event.cancelled || this.auth.role() !== 'super_admin') return;
    const reason = await this.askReason(
      'Cancel this event?',
      `Students will get an update and a text that "${event.name}" is cancelled. Give the reason.`,
      'For example: class suspended because of the typhoon',
      'Cancel event',
    );
    if (!reason) return;
    this.store.update((state) => {
      const target = state.events.find((item) => item.id === event.id);
      if (target) {
        target.cancelled = true;
        target.cancelReason = reason;
      }
    });
    this.scanResult.set(null);
    await this.publishAnnouncement(
      `Cancelled: ${event.name}`,
      `${event.name} on ${this.formatDate(event.date)} has been cancelled. ${reason}`,
      this.eventAudience(event),
    );
  }

  async reinstateActiveEvent(): Promise<void> {
    const event = this.activeEvent();
    if (!event?.cancelled || this.auth.role() !== 'super_admin') return;
    this.store.update((state) => {
      const target = state.events.find((item) => item.id === event.id);
      if (target) {
        target.cancelled = false;
        delete target.cancelReason;
      }
    });
    await this.syncWorkspace();
    this.showToast('Event is back on. Post an update so students know.');
  }

  postponeForm = { date: '', startTime: '08:00', endTime: '16:00', reason: '' };
  readonly postponeError = signal<string | null>(null);
  openPostpone(): void {
    const event = this.activeEvent();
    if (!event || this.auth.role() !== 'super_admin') return;
    this.postponeForm = {
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      reason: '',
    };
    this.postponeError.set(null);
    this.go('postpone-event');
  }
  async savePostpone(): Promise<void> {
    const event = this.activeEvent();
    if (!event) return;
    const { date, startTime, endTime, reason } = this.postponeForm;
    this.postponeError.set(null);
    if (!date || date < this.minimumEventDate) {
      this.postponeError.set('Choose today or a future date.');
      return;
    }
    if (!startTime || !endTime || endTime <= startTime) {
      this.postponeError.set('The end time must be after the start time.');
      return;
    }
    if (date === event.date && startTime === event.startTime && endTime === event.endTime) {
      this.postponeError.set('Change the date or the time to move the event.');
      return;
    }
    if (reason.trim().length < 3) {
      this.postponeError.set('Give a short reason for the change.');
      return;
    }
    const before = { date: event.date, startTime: event.startTime, endTime: event.endTime };
    this.store.update((state) => {
      const target = state.events.find((item) => item.id === event.id);
      if (!target) return;
      target.postponedFrom ??= before;
      target.date = date;
      target.startTime = startTime;
      target.endTime = endTime;
      target.cancelled = false;
      delete target.cancelReason;
    });
    this.go('event-details');
    await this.publishAnnouncement(
      `Moved: ${event.name}`,
      `${event.name} is moved from ${this.formatDate(before.date)} ${before.startTime} to ${this.formatDate(date)} ${startTime}–${endTime}. ${reason.trim()}`,
      this.eventAudience(event),
    );
  }
  async approveEvent(eventId: string): Promise<void> {
    this.store.update((state) => {
      const event = state.events.find((item) => item.id === eventId);
      if (event) {
        event.approvalStatus = 'approved';
        delete event.rejectionReason;
      }
    });
    await this.syncWorkspace();
    this.showToast('Event approved.');
  }

  openEvent(id: string): void {
    this.selectEvent(id);
    this.go('event-details');
  }

  // ---- Approval status ----
  readonly eventStatusFilter = signal<'all' | 'pending' | 'approved' | 'rejected'>('all');
  setEventStatusFilter(value: unknown): void {
    if (value === 'all' || value === 'pending' || value === 'approved' || value === 'rejected') {
      this.eventStatusFilter.set(value);
    }
  }
  readonly eventStatusCounts = computed(() => {
    const events = this.state().events;
    const count = (status: string) =>
      events.filter((event) => (event.approvalStatus ?? 'approved') === status).length;
    return { pending: count('pending'), approved: count('approved'), rejected: count('rejected') };
  });
  /** The admin can edit any event; an organizer only their own unapproved ones. */
  canEditEvent(event: SchoolEvent | undefined): boolean {
    if (!event) return false;
    if (this.auth.role() === 'super_admin') return true;
    return (
      this.auth.role() === 'organizer' &&
      !!this.auth.userId() &&
      event.createdBy === this.auth.userId() &&
      (event.approvalStatus ?? 'approved') !== 'approved'
    );
  }
  async rejectEvent(eventId: string): Promise<void> {
    const event = this.state().events.find((item) => item.id === eventId);
    if (!event) return;
    let alert: HTMLIonAlertElement;
    try {
      alert = await this.alertCtrl.create({
        header: 'Reject this event?',
        message: `Tell the organizer what to fix in "${event.name}".`,
        inputs: [
          {
            name: 'reason',
            type: 'textarea',
            placeholder: 'For example: choose the right sections',
            attributes: { maxlength: 200 },
          },
        ],
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Reject',
            role: 'confirm',
            cssClass: 'alert-danger',
            handler: (value: { reason?: string }) => !!value?.reason?.trim(),
          },
        ],
      });
      await alert.present();
    } catch {
      return;
    }
    const result = await alert.onDidDismiss();
    const reason = String(result.data?.values?.reason ?? '').trim();
    if (result.role !== 'confirm' || !reason) return;
    this.store.update((state) => {
      const target = state.events.find((item) => item.id === eventId);
      if (target) {
        target.approvalStatus = 'rejected';
        target.rejectionReason = reason.slice(0, 200);
      }
    });
    await this.syncWorkspace();
    this.showToast('Event rejected. The organizer can edit and resubmit it.', 'warning');
  }
  eventSeatingSummary(event: SchoolEvent): string {
    if (!event.seatingPlan) {
      return `${event.seats.filter((seat) => seat.studentId !== null).length} students`;
    }
    const chairs = event.seats.length;
    return `${chairs} chairs`;
  }
  eventSectionCount(event: SchoolEvent): number {
    return event.requiredSections?.length || event.sections.length;
  }
  updateGracePeriod(value: number): void {
    const event = this.activeEvent();
    if (event)
      this.events.save(
        {
          name: event.name,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
          venue: event.venue,
          description: event.description,
          graceMinutes: Number(value) || 0,
        },
        event.id,
      );
  }
}
