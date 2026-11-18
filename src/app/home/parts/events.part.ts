import { clock12, schoolDateKey } from '../../core/services/time-format';
import { computed, signal } from '@angular/core';
import { eventActions, isEventOver, isEventUpcoming } from '../../core/services/event-actions';
import { EventFilter } from '../../core/services/event-calendar.service';
import { AnnouncementAudience, SchoolEvent } from '../../core/models/school-event.models';
import { AttendancePart } from './attendance.part';

/** The event list and calendar, approvals, cancelling and moving events. */
export abstract class EventsPart extends AttendancePart {

  // ---- Events: filter + calendar ----
  readonly eventFilter = signal<EventFilter>('upcoming');
  readonly eventView = signal<'list' | 'calendar'>('list');
  readonly calendarMonth = signal(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  readonly selectedDay = signal(schoolDateKey());
  get todayKey(): string {
    this.schoolDay(); // updates at midnight
    return schoolDateKey();
  }
  readonly weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  readonly calendarCells = computed(() =>
    this.calendar.monthCells(
      this.calendarMonth().getFullYear(),
      this.calendarMonth().getMonth(),
      this.myEvents(),
    ),
  );
  readonly calendarTitle = computed(() =>
    this.calendarMonth().toLocaleDateString([], { month: 'long', year: 'numeric' }),
  );
  /** What the Events page lists: the chosen filter, or the tapped calendar day. */
  readonly visibleEvents = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    if (this.eventView() === 'calendar') {
      return this.calendar.eventsOn(this.myEvents(), this.selectedDay());
    }
    const listed = this.calendar.filter(this.myEvents(), this.eventFilter());
    const status = this.eventStatusFilter();
    return this.auth.role() === 'student' || status === 'all'
      ? listed
      : listed.filter((event) => (event.approvalStatus ?? 'approved') === status);
  });
  /** How many events fall in each group of the filter, so nothing is hidden by surprise. */
  readonly eventPhaseCounts = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    const counts = { ongoing: 0, upcoming: 0, past: 0, all: 0 };
    const status = this.eventStatusFilter();
    const events = this.myEvents().filter(
      (event) =>
        this.auth.role() === 'student' ||
        status === 'all' ||
        (event.approvalStatus ?? 'approved') === status,
    );
    for (const event of events) {
      counts[this.calendar.phase(event)] += 1;
      counts.all += 1;
    }
    return counts;
  });
  /** Events the live monitor can open: approved, already started, and not finished yet. */
  readonly liveEvents = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    return this.workingEvents().filter(
      (event) => !isEventOver(event) && !isEventUpcoming(event),
    );
  });
  /** Events with something to report: approved and already started (today or past). */
  readonly reportEvents = computed(() => {
    this.schoolDay();
    return this.workingEvents().filter((event) => !isEventUpcoming(event));
  });
  // ---- Reports: the admin picks the event first ----
  /** True while the report page shows the list of events to choose from. */
  readonly reportPicking = signal(false);
  /** The report was opened from that list, so Back returns to it. */
  readonly reportFromList = signal(false);
  readonly reportEventSearch = signal('');
  readonly reportPickList = computed(() => {
    const query = this.reportEventSearch().trim().toLowerCase();
    return [...this.reportEvents()]
      .filter((event) => !query || event.name.toLowerCase().includes(query))
      .sort((a, b) => `${b.date}${b.startTime}`.localeCompare(`${a.date}${a.startTime}`));
  });
  /** The Reports card on the home: choose an event first, nothing is opened for you. */
  openReportPicker(): void {
    this.reportPicking.set(true);
    this.reportFromList.set(false);
    this.reportEventSearch.set('');
    this.go('reports');
  }
  chooseReportEvent(id: string): void {
    this.selectEvent(id);
    this.reportPicking.set(false);
    this.reportFromList.set(true);
  }
  /** The Attendance report button on an event: that event's report, straight away. */
  openReport(): void {
    this.reportPicking.set(false);
    this.reportFromList.set(false);
    this.go('reports');
  }
  reportBack(): void {
    if (this.reportFromList()) {
      this.reportPicking.set(true);
      this.reportFromList.set(false);
      return;
    }
    this.go('event-details');
  }
  setEventFilter(value: unknown): void {
    if (value === 'ongoing' || value === 'upcoming' || value === 'past' || value === 'all') {
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
    return {
      ongoing: 'No ongoing events',
      upcoming: 'No upcoming events',
      past: 'No past events',
      all: 'No events yet',
    }[this.eventFilter()];
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

  // ======================= Admin: cancel an event =======================
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

  /** Everyone still checked in at the open event (no time-out yet). */
  stillHereCount(): number {
    const event = this.activeEvent();
    if (!event) return 0;
    return this.state().attendance.filter(
      (record) =>
        record.eventId === event.id && !!record.timeIn && !record.timeOut && !record.excused,
    ).length;
  }

  /**
   * The admin presses this when the event really ends. Everyone still checked in
   * is checked out at this moment and scanning closes.
   */
  async finishActiveEvent(): Promise<void> {
    const event = this.activeEvent();
    if (!event || !this.actions().finish) return;
    const here = this.stillHereCount();
    const confirmed = await this.confirm(
      'Finish this event now?',
      here > 0
        ? `"${event.name}" ends now. The ${here} student${here === 1 ? '' : 's'} still checked in will be checked out at this moment, and scanning will close. This cannot be undone.`
        : `"${event.name}" ends now and scanning will close. This cannot be undone.`,
      'Finish event',
    );
    if (!confirmed) return;
    const closed = this.attendance.finishEvent(event.id, this.isOnline());
    this.stopScanner();
    this.scanResult.set(null);
    await this.syncWorkspace();
    this.showToast(
      closed > 0
        ? `Event finished. ${closed} student${closed === 1 ? '' : 's'} checked out.`
        : 'Event finished.',
    );
  }

  async deleteActiveEvent(): Promise<void> {
    const event = this.activeEvent();
    if (!event || !this.actions().delete) return;
    const confirmed = await this.confirm(
      'Delete this event?',
      `"${event.name}" will be removed for good. This cannot be undone.`,
      'Delete event',
    );
    if (!confirmed) return;
    try {
      await this.workspaceApi.deleteEvent(this.auth.getToken(), event.id);
      this.store.update((state) => {
        state.events = state.events.filter((item) => item.id !== event.id);
        state.attendance = state.attendance.filter((record) => record.eventId !== event.id);
        state.selectedEventId = state.events[0]?.id ?? '';
      });
      this.go('events');
      this.showToast('Event deleted.', 'warning');
    } catch (error) {
      this.showToast(this.workspaceApi.errorMessage(error), 'danger');
    }
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

  async approveEvent(eventId: string): Promise<void> {
    const named = this.state().events.find((item) => item.id === eventId);
    const confirmed = await this.confirm(
      'Approve this event?',
      `"${named?.name ?? 'This event'}" will be approved. Scanning, attendance and reports open for it, and the students in its sections will see it.`,
      'Approve',
      false,
    );
    if (!confirmed) return;
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
  readonly eventStatusFilter = signal<'all' | 'pending' | 'approved' | 'rejected'>('approved');
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
    return eventActions(event, this.auth.role(), this.auth.userId(), false).edit;
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
    const confirmed = await this.confirm(
      'Send this rejection?',
      `"${event.name}" goes back to the organizer with this reason: "${reason.slice(0, 200)}". They can edit it and send it again.`,
      'Reject event',
    );
    if (!confirmed) return;
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
  eventAttendeeCount(event: SchoolEvent): number {
    if (event.roster) {
      return new Set(Object.values(event.roster).flat()).size;
    }
    if (
      this.auth.role() === 'student' &&
      Number.isInteger(event.expectedAttendeeCount) &&
      (event.expectedAttendeeCount ?? -1) >= 0
    ) {
      return event.expectedAttendeeCount ?? 0;
    }
    const requiredSections = new Set(event.requiredSections ?? []);
    return this.state().students.filter(
      (student) =>
        requiredSections.has(student.sectionId ?? '') ||
        event.sections.includes(student.section),
    ).length;
  }
  eventSectionCount(event: SchoolEvent): number {
    return event.requiredSections?.length || event.sections.length;
  }
}
