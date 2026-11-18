import {
  DestroyRef,
  ElementRef,
  inject,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { isStudentRequired } from '../../core/services/event-roster';
import { clock12, dateTimeLabel, schoolDateKey, timeOfDay } from '../../core/services/time-format';
import { eventActions, isEventOver, isEventUpcoming } from '../../core/services/event-actions';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, LoadingController } from '@ionic/angular';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { ProfilePhotoService } from '../../core/services/profile-photo.service';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { AttendanceService } from '../../core/services/attendance.service';
import { AuthService } from '../../core/services/auth.service';
import { BulkSmsService } from '../../core/services/bulk-sms.service';
import { NativeSmsService } from '../../core/services/native-sms.service';
import { EventCalendarService } from '../../core/services/event-calendar.service';
import { MyAttendanceService } from '../../core/services/my-attendance.service';
import { AttendanceReportService } from '../../core/services/attendance-report.service';
import { DemoStoreService } from '../../core/services/demo-store.service';
import { EventService } from '../../core/services/event.service';
import { OfflineSyncService } from '../../core/services/offline-sync.service';
import { SmsService } from '../../core/services/sms.service';
import { WorkspaceSyncService } from '../../core/services/workspace-sync.service';
import { WorkspaceApiService, SchoolSection } from '../../core/services/workspace-api.service';
import { AttendanceStatus, SchoolEvent, Student, UserRole } from '../../core/models/school-event.models';
import { Directive } from '@angular/core';
import { TabItem, DisplayScan } from '../home.types';

/** Shared plumbing: the injected services, app state, toasts and dialogs, and navigation. */
@Directive()
export abstract class HomeBaseDirective {
  @ViewChild('camera') camera?: ElementRef<HTMLVideoElement>;
  @ViewChild('takePhoto') takePhotoInput?: ElementRef<HTMLInputElement>;
  @ViewChild('choosePhoto') choosePhotoInput?: ElementRef<HTMLInputElement>;
  protected readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly store = inject(DemoStoreService);
  readonly events = inject(EventService);
  readonly attendance = inject(AttendanceService);
  readonly sms = inject(SmsService);
  readonly bulkSms = inject(BulkSmsService);
  protected readonly nativeSms = inject(NativeSmsService);
  protected readonly profilePhoto = inject(ProfilePhotoService);
  protected readonly calendar = inject(EventCalendarService);
  protected readonly myAttendance = inject(MyAttendanceService);
  protected readonly reportPdf = inject(AttendanceReportService);
  readonly offline = inject(OfflineSyncService);
  readonly auth = inject(AuthService);
  readonly workspaceSync = inject(WorkspaceSyncService);
  protected readonly workspaceApi = inject(WorkspaceApiService);
  protected readonly loadingCtrl = inject(LoadingController);
  protected readonly alertCtrl = inject(AlertController);
  readonly state = this.store.state;
  readonly page = signal('login');
  readonly courses = ['BSIT', 'BSBA', 'BSED', 'BEED'];
  readonly yearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
  readonly sectionNames = ['A', 'B'];
  readonly schoolSections = signal<SchoolSection[]>([]);
  readonly pendingEvents = computed(() =>
    this.state().events.filter((event) => event.approvalStatus === 'pending'),
  );
  /**
   * The events this person should see listed. Students only see events their
   * section is part of; admins and organizers see everything.
   */
  readonly myEvents = computed(() => {
    this.schoolDay(); // a finished day moves its events into the past
    const events = this.state().events;
    if (this.auth.role() !== 'student') return events;
    const student = this.activeStudent();
    // Past events a student went to (checked in), by event id.
    const attended = new Set(
      this.state()
        .attendance.filter(
          (record) => record.studentId === student.id && !!record.timeIn && !record.excused,
        )
        .map((record) => record.eventId),
    );
    return events.filter((event) => {
      if (!isEventOver(event)) return isStudentRequired(event, student);
      // Once an event is over, keep it only if the student went and it was not cancelled.
      return !event.cancelled && attended.has(event.id);
    });
  });
  /**
   * Today's date in the Philippines. Many values depend on "today"; reading this
   * inside them makes them recompute when midnight passes, even if the app was
   * left open and nothing else changed.
   */
  readonly schoolDay = signal(schoolDateKey());
  private readonly dayWatcher = (() => {
    const check = (): void => {
      const today = schoolDateKey();
      if (today !== this.schoolDay()) this.schoolDay.set(today);
    };
    const timer = setInterval(check, 30_000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  })();
  /** True once the event is over (finished, or its day has passed). */
  isEventPast(event: SchoolEvent): boolean {
    return isEventOver(event);
  }
  /** True while the event day has not arrived yet (used by templates). */
  isUpcoming(event: SchoolEvent): boolean {
    return isEventUpcoming(event);
  }
  /** Numbers shown at the top of the admin home. */
  readonly adminStats = computed(() => {
    this.schoolDay(); // recompute when the school day changes (app left open overnight)
    const live = this.state().events.filter(
      (event) => (event.approvalStatus ?? 'approved') === 'approved' && !event.cancelled,
    );
    return {
      today: live.filter((event) => !isEventOver(event) && !isEventUpcoming(event)).length,
      upcoming: live.filter((event) => isEventUpcoming(event)).length,
      pending: this.pendingEvents().length,
      students: this.state().students.length,
    };
  });
  /** Events still to come or on today (rejected, cancelled and finished ones left out). */
  readonly adminUpcomingEvents = computed(() => {
    this.schoolDay(); // recompute when the school day changes (app left open overnight)
    return this.state()
      .events.filter(
        (event) =>
          event.approvalStatus !== 'rejected' && !event.cancelled && !isEventOver(event),
      )
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))
      .slice(0, 6);
  });
  /**
   * What is on today or coming up, soonest first, for the organizer's home. Finished,
   * cancelled and rejected events are left out; the Events page still lists everything.
   */
  readonly organizerEvents = computed(() => {
    this.schoolDay(); // a finished day moves its events out of the list
    return this.state()
      .events.filter(
        (event) => event.approvalStatus !== 'rejected' && !event.cancelled && !isEventOver(event),
      )
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  });
  /** The event featured at the top of the organizer's home. */
  readonly organizerNext = computed<SchoolEvent | undefined>(() => this.organizerEvents()[0]);
  /** The next five after it (the home page shows only a few; the Events page has the full list). */
  readonly organizerMore = computed(() => this.organizerEvents().slice(1, 6));
  /** A student's events that are not over yet, soonest first (cancelled ones left out). */
  private readonly studentUpcoming = computed(() => {
    this.schoolDay(); // recompute when the school day changes (app left open overnight)
    return this.myEvents()
      .filter(
        (event) =>
          (event.approvalStatus ?? 'approved') === 'approved' &&
          !event.cancelled &&
          !isEventOver(event),
      )
      .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  });
  /** The one event to feature on a student's home screen. */
  readonly nextEvent = computed(() => this.studentUpcoming()[0]);
  /** A few more events after the featured one. */
  readonly otherUpcoming = computed(() => this.studentUpcoming().slice(1, 6));
  /** "Today", "Tomorrow" or "In 5 days". */
  whenLabel(date: string): string {
    const days = Math.round(
      (new Date(`${date}T12:00:00Z`).getTime() -
        new Date(`${schoolDateKey()}T12:00:00Z`).getTime()) /
        86400000,
    );
    if (days <= 0) return 'Today';
    return days === 1 ? 'Tomorrow' : `In ${days} days`;
  }
  readonly activeEvent = computed(() => {
    const pool = this.myEvents();
    return (
      pool.find((item) => item.id === this.state().selectedEventId) ??
      pool[0] ??
      this.state().events.find((item) => item.id === this.state().selectedEventId) ??
      this.state().events[0]
    );
  });
  /** What the signed-in person may do with the open event, by status and role. */
  readonly actions = computed(() => {
    this.schoolDay(); // recompute when the school day changes (app left open overnight)
    const event = this.activeEvent();
    const hasAttendance = !!event && this.state().attendance.some((record) => record.eventId === event.id);
    return eventActions(event, this.auth.role(), this.auth.userId(), hasAttendance);
  });
  /** Approved events that are still on: the only ones that can be scanned, monitored or reported. */
  readonly workingEvents = computed(() =>
    this.state().events.filter(
      (event) => (event.approvalStatus ?? 'approved') === 'approved' && !event.cancelled,
    ),
  );
  /** Events that can be scanned right now: approved, on, and already started (today). */
  readonly scannableEvents = computed(() => {
    this.schoolDay(); // recompute when the school day changes (app left open overnight)
    return this.workingEvents().filter(
      (event) => !isEventOver(event) && !isEventUpcoming(event),
    );
  });
  readonly activeStudent = computed<Student>(
    () =>
      this.state().students.find(
        (item) => item.id === this.state().studentId,
      ) ??
      this.state().students[0] ?? {
        id: '',
        name: this.auth.username() || 'Student',
        section: '',
        mobile: '',
      },
  );
  readonly headerGreeting = computed(() => {
    if (this.auth.role() !== 'student') return '';
    const student = this.state().students.find(
      (item) => item.id === this.auth.studentId(),
    );
    const firstName = student?.name.trim().split(/\s+/)[0];
    return `Welcome, ${firstName || this.auth.username()}`;
  });
  readonly tabs = computed(() => {
    const role = this.auth.role();
    const home: TabItem = { screen: 'home', icon: 'home-outline', label: 'Home' };
    const events: TabItem = {
      screen: 'events',
      icon: 'calendar-outline',
      label: 'Events',
      badge: role === 'super_admin' ? this.pendingEvents().length : 0,
    };
    const scan: TabItem = { screen: 'scan', icon: 'scan-outline', label: 'Scan', scan: true };
    const updates: TabItem = {
      screen: 'announcements',
      icon: 'chatbubble-outline',
      label: 'Updates',
      badge: this.unreadAnnouncements().length,
    };
    const settings: TabItem = { screen: 'settings', icon: 'settings-outline', label: 'Settings' };
    const attendance: TabItem = {
      screen: 'history',
      icon: 'checkmark-done-outline',
      label: 'Attendance',
    };
    if (role === 'student') return [home, events, attendance, updates, settings];
    if (role === 'organizer') return [home, events, scan, updates, settings];
    return [home, events, scan, updates, settings];
  });
  readonly activeTab = computed(() => {
    const page = this.page();
    if (page === 'event-details') return 'events';
    return page.startsWith('settings') ? 'settings' : page;
  });
  statusColor(status: string): string {
    switch (status) {
      case 'Present':
      case 'Approved':
      case 'Sent':
        return 'success';
      case 'Late':
      case 'Incomplete':
      case 'Pending approval':
      case 'Queued':
      case 'Required':
        return 'warning';
      case 'Absent':
        return 'danger';
      default:
        return 'medium';
    }
  }
  readonly skeletonRows = [1, 2, 3];
  readonly requiresEvent = computed(() =>
    [
      'event-details',
      'edit-event',
      'scan',
      'attendance',
      'reports',
      'compose-sms',
    ].includes(this.page()),
  );
  readonly isOnline = this.offline.isOnline;
  readonly smsMessages = this.sms.messages;
  readonly authMode = signal<'login' | 'register'>('login');
  readonly syncProgress = this.workspaceSync.busy;
  readonly pendingCount = computed(
    () =>
      this.state().syncItems.filter((item) => item.status === 'Pending sync')
        .length,
  );
  readonly scanResult = signal<DisplayScan | null>(null);
  readonly visibleAnnouncements = computed(() => {
    const announcements = this.state().announcements;
    if (this.auth.role() !== 'student') return announcements;

    const student = this.state().students.find(
      (item) => item.id === this.auth.studentId(),
    );
    if (!student) return [];

    return announcements.filter((announcement) => {
      const audience = announcement.audience;
      if (!audience || audience.type === 'all') return true;
      if (audience.type === 'course') {
        return student.course === audience.course;
      }
      return (
        audience.type === 'sections' &&
        Array.isArray(audience.sectionIds) &&
        !!student.sectionId &&
        audience.sectionIds.includes(student.sectionId)
      );
    });
  });

  // ---- Read / unread announcements (remembered per signed-in user on this device) ----
  private readonly readStore = signal<Record<string, string[]>>(
    HomeBaseDirective.loadReadStore(),
  );
  readonly openAnnouncementId = signal<string | null>(null);
  private static loadReadStore(): Record<string, string[]> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem('announcementsRead') ?? '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  }
  private readKey(): string {
    return this.auth.userId() ?? this.auth.studentId() ?? this.auth.username() ?? 'guest';
  }
  readonly readAnnouncementIds = computed(
    () => new Set(this.readStore()[this.readKey()] ?? []),
  );
  readonly unreadAnnouncements = computed(() =>
    this.visibleAnnouncements().filter((item) => !this.readAnnouncementIds().has(item.id)),
  );
  readonly readAnnouncements = computed(() =>
    this.visibleAnnouncements().filter((item) => this.readAnnouncementIds().has(item.id)),
  );
  readonly openAnnouncement = computed(
    () => this.visibleAnnouncements().find((item) => item.id === this.openAnnouncementId()) ?? null,
  );
  viewAnnouncement(id: string): void {
    this.openAnnouncementId.set(id);
    const key = this.readKey();
    const current = this.readStore()[key] ?? [];
    if (current.includes(id)) return;
    const next = { ...this.readStore(), [key]: [...current, id] };
    this.readStore.set(next);
    try {
      localStorage.setItem('announcementsRead', JSON.stringify(next));
    } catch {
      // Read state just won't persist if storage is unavailable.
    }
  }
  closeAnnouncement(): void {
    this.openAnnouncementId.set(null);
  }

  protected async askReason(
    header: string,
    message: string,
    placeholder: string,
    confirmText: string,
  ): Promise<string | null> {
    try {
      const alert = await this.alertCtrl.create({
        header,
        message,
        inputs: [
          { name: 'reason', type: 'textarea', placeholder, attributes: { maxlength: 200 } },
        ],
        buttons: [
          { text: 'Back', role: 'cancel' },
          {
            text: confirmText,
            role: 'confirm',
            cssClass: 'alert-danger',
            handler: (value: { reason?: string }) => !!value?.reason?.trim(),
          },
        ],
      });
      await alert.present();
      const result = await alert.onDidDismiss();
      const reason = String(result.data?.values?.reason ?? '').trim();
      return result.role === 'confirm' && reason ? reason : null;
    } catch {
      return null;
    }
  }

  localMobile(mobile: string | undefined): string {
    return mobile?.startsWith('+63') ? `0${mobile.slice(3)}` : (mobile ?? '');
  }
  formatDateTime(value: string): string {
    return dateTimeLabel(value);
  }
  /** "08:00" → "8:00 AM" for event times. */
  clock12(value: string | null | undefined): string {
    return clock12(value);
  }
  authUsername = '';
  protected reader?: BrowserMultiFormatReader;
  protected scannerControls?: IScannerControls;

  /** True while the user refreshes a list; pages show skeletons, not stale content. */
  readonly refreshing = signal(false);
  async refreshNow(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      await this.syncWorkspace();
    } finally {
      this.refreshing.set(false);
    }
  }

  /** A small, non-blocking confirmation (ion-toast). */
  /**
   * The small message at the bottom of the screen. It is our own element fixed to the
   * screen (not Ionic's toast), so it stays put while the page scrolls.
   */
  readonly toastState = signal<{
    message: string;
    color: 'success' | 'danger' | 'warning';
    undo?: () => void;
  } | null>(null);
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected showToast(
    message: string,
    color: 'success' | 'danger' | 'warning' = 'success',
    undo?: () => void,
  ): void {
    this.buzz(color === 'success' ? 'light' : 'warning');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastState.set({ message, color, undo });
    this.toastTimer = setTimeout(() => this.dismissToast(), undo ? 5000 : 3200);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = undefined;
    this.toastState.set(null);
  }

  undoToast(): void {
    const undo = this.toastState()?.undo;
    this.dismissToast();
    undo?.();
  }

  /** Haptic feedback on a device; silently does nothing in a browser. */
  protected buzz(kind: 'light' | 'medium' | 'warning'): void {
    const call =
      kind === 'warning'
        ? Haptics.notification({ type: NotificationType.Warning })
        : Haptics.impact({
            style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light,
          });
    void Promise.resolve(call).catch(() => undefined);
  }

  /** Shows an ion-loading while work runs, and always dismisses it. */
  protected async withLoading<T>(message: string, work: () => Promise<T>): Promise<T> {
    const shown = this.loadingCtrl
      .create({ message, spinner: 'crescent', backdropDismiss: false })
      .then(async (loader) => {
        await loader.present();
        return loader;
      })
      .catch(() => undefined);
    try {
      return await work();
    } finally {
      void shown.then((loader) => loader?.dismiss()).catch(() => undefined);
    }
  }

  /** A blocking yes/no for destructive actions (ion-alert). */
  protected async confirm(
    header: string,
    message: string,
    confirmText: string,
    // The confirm button is red for things that cannot be undone; plain for an approval.
    danger = true,
  ): Promise<boolean> {
    try {
      const alert = await this.alertCtrl.create({
        header,
        message,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: confirmText, role: 'confirm', cssClass: danger ? 'alert-danger' : undefined },
        ],
      });
      await alert.present();
      const { role } = await alert.onDidDismiss();
      return role === 'confirm';
    } catch {
      return true;
    }
  }
  protected allowedScreens(role: UserRole): string[] {
    if (role === 'student') {
      return ['home', 'events', 'event-details', 'announcements', 'my-qr', 'history', 'excuse-request', 'settings', ];
    }
    if (role === 'organizer') {
      return ['home', 'events', 'event-details', 'create-event', 'edit-event', 'scan', 'attendance', 'reports', 'announcements', 'sms', 'settings'];
    }
    return [
      'home', 'events', 'students', 'event-details',
      'create-event', 'edit-event', 'scan', 'attendance', 'history', 'reports',
      'compose-sms', 'sms', 'my-qr', 'settings', 'settings-accounts',
      'settings-account-create', 'settings-account-reset', 'settings-sections',
      'settings-app', 'settings-advanced', 'announcements',
      'student-detail', 'settings-activity', 'settings-organizers', 'excuses',
      'settings-school-year', 'event-approvals',
    ];
  }
  protected homeScreenForRole(): string {
    return this.auth.role() === 'student' ? 'home' : 'home';
  }
  /** Staff pages that need a live event switch to one if the open event cannot be used. */
  protected ensureWorkingEvent(screen: string): void {
    if (!['scan', 'attendance', 'reports'].includes(screen)) return;
    if (this.auth.role() === 'student' || !this.auth.role()) return;
    // Past events stay viewable in reports; scanning and the live monitor need a live event.
    const actions = this.actions();
    if (screen === 'scan' ? actions.scan : screen === 'attendance' ? actions.monitor : actions.report) return;
    const today = schoolDateKey();
    const pool = screen === 'scan' ? this.scannableEvents() : this.workingEvents();
    const list = [...pool].sort((a, b) => {
      const rank = (e: SchoolEvent) => (e.date === today ? 0 : e.date > today ? 1 : 2);
      return rank(a) - rank(b) || (rank(a) === 2 ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
    });
    if (list.length) this.events.select(list[0].id);
  }
  go(screen: string): void {
    const role = this.auth.role();
    if (role && !this.allowedScreens(role).includes(screen)) {
      screen = this.homeScreenForRole();
    }
    this.stopScanner();
    this.ensureWorkingEvent(screen);
    void this.router.navigate(['/workspace', screen]);
  }
  protected stopScanner(): void {
    try {
      this.scannerControls?.stop();
    } catch {
      // The camera may already be released.
    }
    this.scannerControls = undefined;
  }
  selectEvent(id: string): void {
    this.events.select(id);
    this.scanResult.set(null);
  }
  studentName(id: string): string {
    return (
      this.state().students.find((student) => student.id === id)?.name ?? id
    );
  }
  initials(name: string): string {
    return name
      .split(' ')
      .map((part) => part[0])
      .slice(0, 2)
      .join('');
  }
  async syncWorkspace(): Promise<void> {
    try {
      await this.workspaceSync.syncNow();
      this.showToast('Workspace synced.');
    } catch (error) {
      this.workspaceSync.error.set(
        error instanceof Error ? error.message : 'Workspace sync failed.',
      );
      this.showToast('Could not sync. Check your connection.', 'danger');
    }
  }
  formatDate(value: string): string {
    return new Date(`${value}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  formatTime(value: string | null | undefined): string {
    return timeOfDay(value);
  }
  statusClass(status: AttendanceStatus | string): string {
    return status.toLowerCase().replaceAll(' ', '-');
  }
}
