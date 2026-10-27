import {
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  alertCircleOutline,
  arrowBackOutline,
  calendarOutline,
  checkmarkCircleOutline,
  checkmarkDoneOutline,
  chevronForwardOutline,
  chatbubbleOutline,
  cloudOfflineOutline,
  closeOutline,
  createOutline,
  downloadOutline,
  gridOutline,
  homeOutline,
  locationOutline,
  logOutOutline,
  peopleOutline,
  personOutline,
  qrCodeOutline,
  scanOutline,
  schoolOutline,
  searchOutline,
  sendOutline,
  settingsOutline,
  shieldCheckmarkOutline,
  statsChartOutline,
  syncOutline,
  timeOutline,
  addOutline,
} from 'ionicons/icons';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import * as QRCode from 'qrcode';
import {
  AttendanceService,
  ScanResult,
} from '../core/services/attendance.service';
import { AuthService } from '../core/services/auth.service';
import { DemoStoreService } from '../core/services/demo-store.service';
import { EventService } from '../core/services/event.service';
import { OfflineSyncService } from '../core/services/offline-sync.service';
import { SeatingService } from '../core/services/seating.service';
import { SmsService } from '../core/services/sms.service';
import { StudentService } from '../core/services/student.service';
import { WorkspaceSyncService } from '../core/services/workspace-sync.service';
import {
  WorkspaceAccount,
  WorkspaceApiService,
  SchoolSection,
} from '../core/services/workspace-api.service';
import {
  AttendanceRecord,
  AttendanceStatus,
  Announcement,
  AnnouncementAudience,
  SchoolEvent,
  Seat,
  Student,
  UserRole,
} from '../core/models/school-event.models';

interface DisplayScan extends ScanResult {
  student?: Student;
  seat?: Seat;
  time: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [FormsModule, RouterLink, IonIcon],
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('camera') camera?: ElementRef<HTMLVideoElement>;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(DemoStoreService);
  readonly events = inject(EventService);
  readonly attendance = inject(AttendanceService);
  readonly seating = inject(SeatingService);
  readonly sms = inject(SmsService);
  readonly students = inject(StudentService);
  readonly offline = inject(OfflineSyncService);
  readonly auth = inject(AuthService);
  readonly workspaceSync = inject(WorkspaceSyncService);
  private readonly workspaceApi = inject(WorkspaceApiService);
  readonly state = this.store.state;
  readonly page = signal('login');
  readonly courses = ['BSIT', 'BSBA', 'BSED', 'BEED'];
  readonly yearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
  readonly schoolSections = signal<SchoolSection[]>([]);
  readonly selectedEventRequiredSections = signal<string[]>([]);
  readonly pendingEvents = computed(() =>
    this.state().events.filter((event) => event.approvalStatus === 'pending'),
  );
  readonly activeEvent = computed(
    () =>
      this.state().events.find(
        (item) => item.id === this.state().selectedEventId,
      ) ?? this.state().events[0],
  );
  readonly activeStudent = computed(
    () =>
      this.state().students.find(
        (item) => item.id === this.state().studentId,
      ) ?? this.state().students[0],
  );
  readonly headerGreeting = computed(() => {
    if (this.auth.role() !== 'student') return '';
    const student = this.state().students.find(
      (item) => item.id === this.auth.studentId(),
    );
    const firstName = student?.name.trim().split(/\s+/)[0];
    return `Welcome, ${firstName || this.auth.username()}`;
  });
  readonly requiresEvent = computed(() =>
    [
      'event-details',
      'seating',
      'scan',
      'attendance',
      'history',
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
  readonly qrCode = signal('');
  readonly scanResult = signal<DisplayScan | null>(null);
  readonly selectedSeat = signal<Seat | null>(null);
  readonly selectedReportSection = signal('');
  readonly apiAddressSaved = signal(false);
  readonly apiCheckBusy = signal(false);
  readonly apiCheckMessage = signal<string | null>(null);
  readonly managedAccounts = signal<WorkspaceAccount[]>([]);
  readonly accountsLoading = signal(false);
  readonly accountRoleFilter = signal<'all' | 'organizer' | 'student'>('organizer');
  readonly accountCourseFilter = signal('');
  readonly accountYearFilter = signal('');
  readonly accountSectionFilter = signal('');
  readonly accountSearch = signal('');
  readonly filteredManagedAccountList = computed(() => {
    const query = this.accountSearch().trim().toLowerCase();
    const roleFilter = this.accountRoleFilter();
    return this.managedAccounts().filter((account) => {
      if (roleFilter !== 'all' && account.role !== roleFilter) return false;

      const student = this.studentForAccount(account);
      const section = this.sectionForAccount(account);
      const course = student?.course ?? section?.course ?? '';
      const yearLevel = student?.yearLevel ?? section?.yearLevel ?? '';
      const sectionName = section?.name ?? student?.section ?? '';

      if (roleFilter === 'student') {
        if (this.accountCourseFilter() && course !== this.accountCourseFilter()) {
          return false;
        }
        if (this.accountYearFilter() && yearLevel !== this.accountYearFilter()) {
          return false;
        }
        if (
          this.accountSectionFilter() &&
          (student?.sectionId ?? '') !== this.accountSectionFilter()
        ) {
          return false;
        }
      }

      const searchText = [
        account.username,
        account.role,
        student?.name,
        course,
        yearLevel,
        sectionName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !query || searchText.includes(query);
    });
  });
  visibleAccountLimit = 100;
  readonly accountError = signal<string | null>(null);
  readonly accountMessage = signal<string | null>(null);
  readonly sectionError = signal<string | null>(null);
  readonly sectionsLoading = signal(false);
  readonly eventError = signal<string | null>(null);
  readonly toastMessage = signal<string | null>(null);
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
  readonly scannedCount = computed(
    () =>
      this.state().attendance.filter(
        (record) => record.eventId === this.state().selectedEventId,
      ).length,
  );

  scanStudentId = 'STU-001';
  gateSection = 'Grade 10-A';
  selectedStudentToAssign = 'STU-001';
  searchText = '';
  statusFilter = 'All';
  studentForm = { name: '', section: '', mobile: '' };
  signupForm = {
    name: '',
    course: 'BSIT',
    yearLevel: '',
    sectionId: '',
    mobile: '',
  };
  signupSectionGroup = { course: 'BSIT', yearLevel: '', sectionIds: [] as string[] };
  sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
  editingSectionId = '';
  announcementForm = { title: '', body: '' };
  announcementAudience: 'all' | 'sections' = 'all';
  announcementCourse = 'BSIT';
  announcementYearLevel = '';
  announcementSectionIds: string[] = [];
  readonly selectedAnnouncementSectionIds = signal<string[]>([]);
  readonly announcementError = signal<string | null>(null);
  eventForm = {
    name: '',
    date: '',
    startTime: '08:00',
    endTime: '16:00',
    venue: '',
    description: '',
    graceMinutes: 15,
    requiredSections: [] as string[],
  };
  editingEventId?: string;
  recipientMode: 'all' | 'section' | 'student' = 'all';
  recipientSection = 'Grade 10-A';
  recipientStudentId = 'STU-001';
  messageTemplate = 'Event reminder';
  messageText = '';
  authUsername = '';
  authPassword = '';
  apiBaseUrl = '';
  accountForm = { username: '', password: '' };
  resetAccountUsername = '';
  resetAccountPassword = '';
  private reader?: BrowserMultiFormatReader;
  private scannerControls?: IScannerControls;
  private lastScreen = '';
  private readonly screenScrollPositions = new Map<string, number>();
  private toastTimer?: ReturnType<typeof setTimeout>;
  private pullStartY?: number;
  clearWorkspaceConfirmation = '';

  constructor() {
    this.apiBaseUrl = this.workspaceApi.baseUrl();
    addIcons({
      alertCircleOutline,
      arrowBackOutline,
      calendarOutline,
      checkmarkCircleOutline,
      checkmarkDoneOutline,
      chevronForwardOutline,
      chatbubbleOutline,
      cloudOfflineOutline,
      closeOutline,
      createOutline,
      downloadOutline,
      gridOutline,
      homeOutline,
      locationOutline,
      logOutOutline,
      peopleOutline,
      personOutline,
      qrCodeOutline,
      scanOutline,
      schoolOutline,
      searchOutline,
      sendOutline,
      settingsOutline,
      shieldCheckmarkOutline,
      statsChartOutline,
      syncOutline,
      timeOutline,
      addOutline,
    });
    this.route.paramMap.subscribe((params) => {
      const screen = params.get('screen') ?? 'login';
      const role = this.auth.role();
      if (!role && screen !== 'login') {
        this.page.set('login');
        void this.router.navigate(['/login']);
        return;
      }
      if (this.lastScreen && this.lastScreen !== screen) {
        this.screenScrollPositions.set(this.lastScreen, window.scrollY);
      }
      if (role && !this.allowedScreens(role).includes(screen)) {
        this.page.set(this.homeScreenForRole());
        void this.router.navigate(['/workspace', this.homeScreenForRole()]);
        return;
      }
      this.page.set(screen);
      this.lastScreen = screen;
      requestAnimationFrame(() => {
        window.scrollTo({
          top: this.screenScrollPositions.get(screen) ?? 0,
          behavior: 'instant',
        });
      });
      if (
        ['settings-accounts', 'settings-account-create', 'settings-account-reset'].includes(screen) &&
        this.auth.role() === 'super_admin'
      ) {
        void this.loadManagedAccounts();
      }
      if (screen === 'settings-sections' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'settings-account-reset' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'announcements' && this.auth.role() === 'super_admin') {
        void this.loadSections();
      }
      if (screen === 'create-event' && this.auth.role()) {
        void this.loadSections();
      }
      if (this.page() === 'my-qr') void this.refreshQr();
    });
  }

  ngOnInit(): void {
    void this.initializePage();
  }
  ngOnDestroy(): void {
    this.scannerControls?.stop();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  capturePullStart(event: TouchEvent): void {
    const listScreen = ['events', 'announcements', 'students'].includes(this.page());
    this.pullStartY =
      listScreen && window.scrollY <= 0 ? event.touches[0]?.clientY : undefined;
  }

  completePullRefresh(event: TouchEvent): void {
    const startY = this.pullStartY;
    this.pullStartY = undefined;
    const endY = event.changedTouches[0]?.clientY;
    if (startY !== undefined && endY !== undefined && endY - startY >= 72) {
      void this.syncWorkspace();
    }
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastMessage.set(null), 3200);
    if (typeof navigator !== 'undefined') navigator.vibrate?.(18);
  }

  private async initializePage(): Promise<void> {
    await this.workspaceSync.initialize();
    if (this.auth.authenticated()) {
      this.store.update((state) => {
        state.role = this.auth.role();
        state.studentId = this.auth.studentId() ?? '';
      });
      if (this.page() === 'login') {
        void this.router.navigate(['/workspace/home']);
      }
      void this.refreshQr();
    }
  }

  visibleManagedAccounts(): WorkspaceAccount[] {
    return this.filteredManagedAccountList().slice(0, this.visibleAccountLimit);
  }

  showMoreManagedAccounts(): void {
    this.visibleAccountLimit += 100;
  }

  accountCourses(): string[] {
    return [
      ...new Set([
        ...this.schoolSections().map((section) => section.course),
        ...this.managedAccounts()
          .filter((account) => account.role === 'student')
          .map((account) => this.studentForAccount(account)?.course)
          .filter((course): course is string => !!course),
      ]),
    ].sort();
  }

  accountYears(): string[] {
    return [
      ...new Set(
        this.schoolSections()
          .filter(
            (section) =>
            !this.accountCourseFilter() ||
            section.course === this.accountCourseFilter(),
          )
          .map((section) => section.yearLevel),
      ),
    ].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
  }

  accountSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        (!this.accountCourseFilter() ||
          section.course === this.accountCourseFilter()) &&
        (!this.accountYearFilter() ||
          section.yearLevel === this.accountYearFilter()),
    );
  }

  private studentForAccount(account: WorkspaceAccount): Student | undefined {
    return account.studentId
      ? this.state().students.find((student) => student.id === account.studentId)
      : undefined;
  }

  private sectionForAccount(account: WorkspaceAccount): SchoolSection | undefined {
    const sectionId = this.studentForAccount(account)?.sectionId;
    return sectionId
      ? this.schoolSections().find((section) => section.id === sectionId)
      : undefined;
  }

  accountSummary(account: WorkspaceAccount): string {
    if (account.role !== 'student') {
      return `${account.role === 'super_admin' ? 'Super admin' : 'Organizer'} account`;
    }
    const student = this.studentForAccount(account);
    const section = this.sectionForAccount(account);
    return [
      student?.course ?? section?.course,
      student?.yearLevel ?? section?.yearLevel,
      section?.name ?? student?.section,
    ]
      .filter(Boolean)
      .join(' · ') || 'Student account';
  }

  accountName(account: WorkspaceAccount): string {
    return this.studentForAccount(account)?.name || account.username;
  }

  accountCourseChanged(): void {
    this.accountYearFilter.set('');
    this.accountSectionFilter.set('');
    this.visibleAccountLimit = 100;
  }

  accountYearChanged(): void {
    this.accountSectionFilter.set('');
    this.visibleAccountLimit = 100;
  }

  accountFiltersChanged(): void {
    this.visibleAccountLimit = 100;
  }

  selectManagedAccount(username: string): void {
    this.resetAccountUsername = username;
    this.accountError.set(null);
    this.accountMessage.set(null);
  }
  private allowedScreens(role: UserRole): string[] {
    if (role === 'student') {
      return ['home', 'events', 'event-details', 'announcements', 'my-qr', 'settings'];
    }
    if (role === 'organizer') {
      return ['home', 'events', 'event-details', 'create-event', 'scan', 'settings'];
    }
    return [
      'home', 'events', 'students', 'create-student', 'event-details',
      'create-event', 'seating', 'scan', 'attendance', 'history', 'reports',
      'compose-sms', 'sms', 'my-qr', 'settings', 'settings-accounts',
      'settings-account-create', 'settings-account-reset', 'settings-sections',
      'settings-attendance', 'settings-app', 'settings-advanced', 'announcements',
    ];
  }
  private homeScreenForRole(): string {
    return this.auth.role() === 'student' ? 'home' : 'home';
  }
  showRegistration(): void {
    this.authMode.set('register');
    this.auth.error.set(null);
    this.signupForm = {
      name: '',
      course: this.courses[0],
      yearLevel: '',
      sectionId: '',
      mobile: '',
    };
    void this.loadSections();
  }
  showSignIn(): void {
    this.authMode.set('login');
    this.auth.error.set(null);
  }
  signupYears(): string[] {
    return [
      ...new Set(
        this.schoolSections()
          .filter((section) => section.course === this.signupForm.course)
          .map((section) => section.yearLevel),
      ),
    ].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
  }
  signupSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        section.course === this.signupForm.course &&
        section.yearLevel === this.signupForm.yearLevel,
    );
  }
  signupCourseChanged(): void {
    this.signupForm.yearLevel = this.signupYears()[0] ?? '';
    this.syncSignupSection();
  }
  signupYearChanged(): void {
    this.syncSignupSection();
  }
  private syncSignupSection(): void {
    const options = this.signupSections();
    this.signupForm.sectionId =
      options.length === 1
        ? options[0].id
        : options.some((section) => section.id === this.signupForm.sectionId)
          ? this.signupForm.sectionId
          : '';
  }
  eventGroupYears(): string[] {
    const years = [...new Set(
      this.schoolSections()
        .filter((section) => section.course === this.signupSectionGroup.course)
        .map((section) => section.yearLevel),
    )].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
    return years.length ? ['All years', ...years] : [];
  }
  availableCourses(): string[] {
    const sectionCourses = [
      ...new Set(this.schoolSections().map((section) => section.course)),
    ].sort();
    return sectionCourses.length ? sectionCourses : this.courses;
  }
  eventGroupSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        section.course === this.signupSectionGroup.course &&
        (this.signupSectionGroup.yearLevel === 'All years' ||
          section.yearLevel === this.signupSectionGroup.yearLevel),
    );
  }
  eventGroupCourseChanged(): void {
    this.signupSectionGroup.yearLevel = this.eventGroupYears()[0] ?? '';
    this.signupSectionGroup.sectionIds = [];
    this.syncEventGroupSections();
  }
  eventGroupYearChanged(): void {
    this.signupSectionGroup.sectionIds = [];
    this.syncEventGroupSections();
  }
  private syncEventGroupSections(): void {
    const options = this.eventGroupSections();
    if (options.length === 1) {
      this.signupSectionGroup.sectionIds = [options[0].id];
    } else {
      this.signupSectionGroup.sectionIds =
        this.signupSectionGroup.sectionIds.filter((id) =>
          options.some((section) => section.id === id),
        );
    }
  }
  toggleEventGroupSection(sectionId: string, selected: boolean): void {
    const current = new Set(this.signupSectionGroup.sectionIds);
    if (selected) current.add(sectionId);
    else current.delete(sectionId);
    this.signupSectionGroup.sectionIds = [...current];
  }
  setEventGroupSection(event: Event, sectionId: string): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.toggleEventGroupSection(sectionId, event.target.checked);
  }
  selectAllEventGroupSections(): void {
    this.signupSectionGroup.sectionIds = this.eventGroupSections().map(
      (section) => section.id,
    );
  }
  addEventSectionGroup(): void {
    const sections = this.eventGroupSections();
    const selected = this.signupSectionGroup.sectionIds;
    if (!selected.length) return;
    const validIds = new Set(sections.map((section) => section.id));
    const next = new Set(this.selectedEventRequiredSections());
    selected.forEach((id) => {
      if (validIds.has(id)) next.add(id);
    });
    this.selectedEventRequiredSections.set([...next]);
    this.signupSectionGroup.sectionIds = [];
  }
  requiredSectionLabel(id: string): string {
    const section = this.schoolSections().find((item) => item.id === id);
    return section
      ? `${section.course} ${section.yearLevel} ${section.name}`
      : id;
  }
  removeRequiredSection(id: string): void {
    this.selectedEventRequiredSections.update((sections) =>
      sections.filter((sectionId) => sectionId !== id),
    );
  }
  async loadSections(): Promise<void> {
    this.sectionsLoading.set(true);
    this.sectionError.set(null);
    try {
      const { sections } = await this.workspaceApi.listSections(
        this.auth.getToken() || undefined,
      );
      this.schoolSections.set(sections);
      if (!this.availableCourses().includes(this.announcementCourse)) {
        this.announcementCourse = this.availableCourses()[0] ?? this.courses[0];
      }
      if (
        !this.announcementYears().includes(this.announcementYearLevel)
      ) {
        this.announcementYearLevel = this.announcementYears()[0] ?? '';
      }
      this.announcementYearChanged();
      if (this.signupForm.yearLevel && this.signupForm.course) {
        this.syncSignupSection();
      } else {
        this.signupCourseChanged();
      }
      if (!this.eventGroupYears().length) {
        this.signupSectionGroup.course =
          this.availableCourses().find((course) =>
            this.schoolSections().some((section) => section.course === course),
          ) ?? this.availableCourses()[0];
      }
      if (this.signupSectionGroup.course && this.eventGroupYears().length) {
        if (!this.eventGroupYears().includes(this.signupSectionGroup.yearLevel)) {
          this.signupSectionGroup.yearLevel = this.eventGroupYears()[0];
        }
        this.syncEventGroupSections();
      } else {
        this.signupSectionGroup.yearLevel = '';
        this.signupSectionGroup.sectionIds = [];
      }
    } catch (error) {
      this.sectionError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.sectionsLoading.set(false);
    }
  }
  editSection(section: SchoolSection): void {
    this.editingSectionId = section.id;
    this.sectionForm = {
      course: section.course,
      yearLevel: section.yearLevel,
      name: section.name,
    };
  }
  cancelSectionEdit(): void {
    this.editingSectionId = '';
    this.sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
  }
  async saveSection(): Promise<void> {
    this.sectionError.set(null);
    try {
      if (this.editingSectionId) {
        await this.workspaceApi.updateSection(
          this.auth.getToken(),
          this.editingSectionId,
          this.sectionForm,
        );
      } else {
        await this.workspaceApi.createSection(
          this.auth.getToken(),
          this.sectionForm,
        );
      }
      this.editingSectionId = '';
      this.sectionForm = { course: 'BSIT', yearLevel: '1st Year', name: '' };
      await this.loadSections();
      this.showToast('Section saved.');
    } catch (error) {
      this.sectionError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async approveEvent(eventId: string): Promise<void> {
    this.store.update((state) => {
      const event = state.events.find((item) => item.id === eventId);
      if (event) event.approvalStatus = 'approved';
    });
    await this.syncWorkspace();
    this.showToast('Event approved.');
  }
  announcementYears(): string[] {
    const years = [...new Set(
      this.schoolSections()
        .filter((section) => section.course === this.announcementCourse)
        .map((section) => section.yearLevel),
    )].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
    return years.length ? ['All years', ...years] : [];
  }
  announcementSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        section.course === this.announcementCourse &&
        (this.announcementYearLevel === 'All years' ||
          section.yearLevel === this.announcementYearLevel),
    );
  }
  announcementCourseChanged(): void {
    this.announcementYearLevel = this.announcementYears()[0] ?? '';
    this.announcementSectionIds = [];
  }
  announcementYearChanged(): void {
    const availableIds = new Set(
      this.announcementSections().map((section) => section.id),
    );
    this.announcementSectionIds = this.announcementSectionIds.filter((id) =>
      availableIds.has(id),
    );
  }
  setAnnouncementSection(event: Event, sectionId: string): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const selectedIds = new Set(this.announcementSectionIds);
    if (event.target.checked) selectedIds.add(sectionId);
    else selectedIds.delete(sectionId);
    this.announcementSectionIds = [...selectedIds];
  }
  selectAllAnnouncementSections(): void {
    this.announcementSectionIds = this.announcementSections().map(
      (section) => section.id,
    );
  }
  addAnnouncementSectionGroup(): void {
    const availableIds = new Set(
      this.announcementSections().map((section) => section.id),
    );
    const next = new Set(this.selectedAnnouncementSectionIds());
    this.announcementSectionIds.forEach((id) => {
      if (availableIds.has(id)) next.add(id);
    });
    if (next.size === this.selectedAnnouncementSectionIds().length) {
      this.announcementError.set('Select at least one section for this audience group.');
      return;
    }
    this.selectedAnnouncementSectionIds.set([...next]);
    this.announcementSectionIds = [];
    this.announcementError.set(null);
  }
  removeAnnouncementSection(sectionId: string): void {
    this.selectedAnnouncementSectionIds.update((ids) =>
      ids.filter((id) => id !== sectionId),
    );
  }
  async createAnnouncement(): Promise<void> {
    const title = this.announcementForm.title.trim();
    const body = this.announcementForm.body.trim();
    if (!title || !body) return;
    this.announcementError.set(null);
    let audience: AnnouncementAudience = { type: 'all' };
    if (this.announcementAudience === 'sections') {
      const selectedIds = this.selectedAnnouncementSectionIds();
      if (!selectedIds.length) {
        this.announcementError.set(
          'Add at least one course, year, or section group before publishing.',
        );
        return;
      }
      audience = { type: 'sections', sectionIds: selectedIds };
    }
    this.store.update((state) => {
      state.announcements.unshift({
        id: `ANN-${Date.now()}`,
        title,
        body,
        createdAt: new Date().toISOString(),
        audience,
      });
    });
    this.announcementForm = { title: '', body: '' };
    this.announcementAudience = 'all';
    this.announcementSectionIds = [];
    this.selectedAnnouncementSectionIds.set([]);
    try {
      await this.workspaceSync.syncNow();
      this.showToast('Announcement published.');
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : 'The shared server could not be reached.';
      this.workspaceSync.error.set(
        `Announcement saved on this device but not published: ${detail}`,
      );
    }
  }
  announcementAudienceLabel(announcement: Announcement): string {
    const audience = announcement.audience;
    if (!audience || audience.type === 'all') return 'All students';
    if (audience.type === 'course') return `${audience.course} students`;
    const count = audience.sectionIds?.length ?? 0;
    return count ? `Selected audience · ${count} section${count === 1 ? '' : 's'}` : 'Selected sections';
  }
  async submitAuth(): Promise<void> {
    const username = this.authUsername.trim();
    const hadSavedSession = this.auth.hasSavedSession();
    const registering = this.authMode() === 'register';
    try {
      this.apiCheckMessage.set(null);
      if (registering) {
        await this.auth.register(username, this.authPassword, {
          name: this.signupForm.name.trim(),
          course: this.signupForm.course,
          yearLevel: this.signupForm.yearLevel,
          sectionId: this.signupForm.sectionId,
          mobile: this.signupForm.mobile.trim(),
        });
      } else {
        await this.auth.login(username, this.authPassword);
      }
      this.authPassword = '';
      try {
        await this.workspaceSync.connect();
      } catch (error) {
        if (!hadSavedSession) {
          this.auth.signOut();
          this.store.update((state) => {
            state.role = null;
          });
          this.auth.error.set(
            registering
              ? 'Your account was created, but the shared workspace could not be saved to this device. Reconnect and sign in again.'
              : 'Internet is required for your first login.',
          );
          return;
        }
        this.workspaceSync.error.set(
          error instanceof Error ? error.message : 'The shared workspace could not be loaded.',
        );
      }
      if (this.auth.authenticated()) {
        this.store.update((state) => {
          state.role = this.auth.role();
          state.studentId = this.auth.studentId() ?? '';
        });
        void this.router.navigate(['/workspace', this.homeScreenForRole()]);
        void this.refreshQr();
        this.showToast(registering ? 'Account created.' : 'Welcome back.');
      }
    } catch (error) {
      if (!this.auth.error()) {
        this.auth.error.set(
          error instanceof Error ? error.message : 'Unable to sign in.',
        );
      }
      return;
    }
  }
  async testApiConnection(): Promise<void> {
    this.apiCheckBusy.set(true);
    this.apiCheckMessage.set(null);
    this.auth.error.set(null);
    try {
      this.workspaceApi.setBaseUrl(this.apiBaseUrl);
      await this.workspaceApi.checkHealth();
      this.apiCheckMessage.set('Server connection successful. You can sign in.');
    } catch (error) {
      this.apiCheckMessage.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.apiCheckBusy.set(false);
    }
  }
  go(screen: string): void {
    const role = this.auth.role();
    if (role && !this.allowedScreens(role).includes(screen)) {
      screen = this.homeScreenForRole();
    }
    if (this.page() === 'scan') this.scannerControls?.stop();
    void this.router.navigate(['/workspace', screen]);
  }
  signOut(): void {
    this.auth.signOut();
    this.store.update((state) => {
      state.role = null;
    });
    void this.router.navigate(['/login']);
  }
  selectEvent(id: string): void {
    this.events.select(id);
    this.scanResult.set(null);
  }
  setStudent(id: string): void {
    this.store.update((state) => {
      state.studentId = id;
    });
    void this.refreshQr();
  }

  async refreshQr(): Promise<void> {
    const student = this.activeStudent();
    if (!student) return;
    try {
      this.qrCode.set(
        await QRCode.toDataURL(
          JSON.stringify({
            studentId: student.id,
            name: student.name,
            course: student.course,
            yearLevel: student.yearLevel,
            section: student.section,
            mobile: student.mobile,
          }),
          {
            width: 240,
            margin: 1,
            color: { dark: '#143d32', light: '#ffffff' },
          },
        ),
      );
    } catch {
      this.qrCode.set('');
    }
  }

  openEvent(id: string): void {
    this.selectEvent(id);
    this.go('event-details');
  }
  createEvent(): void {
    this.editingEventId = undefined;
    this.eventForm = {
      name: '',
      date: '',
      startTime: '08:00',
      endTime: '16:00',
      venue: '',
      description: '',
      graceMinutes: 15,
      requiredSections: [],
    };
    this.selectedEventRequiredSections.set([]);
    this.signupSectionGroup.course = this.courses[0];
    this.signupSectionGroup.yearLevel = '';
    this.signupSectionGroup.sectionIds = [];
    this.go('create-event');
  }
  createStudent(): void {
    this.studentForm = { name: '', section: '', mobile: '' };
    this.go('create-student');
  }
  saveStudent(): void {
    const student = this.students.add(this.studentForm);
    this.scanStudentId = student.id;
    this.selectedStudentToAssign = student.id;
    this.recipientStudentId = student.id;
    this.studentForm = { name: '', section: '', mobile: '' };
    this.showToast('Student saved.');
    this.go('students');
  }
  editEvent(): void {
    const event = this.activeEvent();
    if (!event) return;
    this.editingEventId = event.id;
    this.eventForm = {
      name: event.name,
      date: event.date,
      startTime: event.startTime,
      endTime: event.endTime,
      venue: event.venue,
      description: event.description,
      graceMinutes: event.graceMinutes,
      requiredSections: event.requiredSections ?? [],
    };
    this.selectedEventRequiredSections.set(event.requiredSections ?? []);
    this.go('create-event');
  }
  saveEvent(): void {
    if (this.selectedEventRequiredSections().length === 0) {
      this.eventError.set('Select at least one required section group.');
      return;
    }
    this.eventError.set(null);
    const saved = this.events.save(
      {
        ...this.eventForm,
        graceMinutes: Number(this.eventForm.graceMinutes) || 0,
        requiredSections: this.selectedEventRequiredSections(),
      },
      this.editingEventId,
    );
    this.selectEvent(saved.id);
    this.showToast(this.editingEventId ? 'Event updated.' : 'Event created.');
    this.go('event-details');
  }

  scanStudent(studentId: string, gate = this.gateSection): void {
    const event = this.activeEvent();
    if (!event) return;
    if (this.auth.role() === 'organizer' && event.approvalStatus !== 'approved') {
      this.scanResult.set({
        accepted: false,
        tone: 'rejected',
        message: 'This event must be approved before attendance scanning.',
        time: new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      });
      return;
    }
    const student = this.state().students.find((item) => item.id === studentId);
    const result = this.attendance.scan(
      event.id,
      studentId,
      gate,
      this.isOnline(),
    );
    if (result.accepted && typeof navigator !== 'undefined') {
      navigator.vibrate?.(35);
    }
    const seat = event.seats.find((item) => item.studentId === studentId);
    this.scanResult.set({
      ...result,
      student,
      seat,
      time: new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
    if (
      result.accepted &&
      student &&
      seat &&
      result.record &&
      (event.requiredSections ?? []).includes(student.sectionId ?? '')
    ) {
      const action = result.record.timeOut ? 'timed out' : 'timed in';
      void this.sms.send(
        student,
        `${student.name} ${action} at ${this.formatTime(result.record.timeOut ?? result.record.timeIn)} for ${event.name}, ${seat.section}, Row ${seat.row} Seat ${seat.number}.`,
        this.isOnline(),
        event.id,
      ).catch((error: unknown) => this.sms.reportError(error));
    }
  }
  scanPayload(raw: string): void {
    try {
      const payload = JSON.parse(raw) as { studentId?: string };
      if (!payload.studentId) throw new Error('missing student ID');
      this.scanStudent(payload.studentId);
    } catch {
      this.scanResult.set({
        accepted: false,
        tone: 'rejected',
        message: 'QR code is not a recognized student pass.',
        time: new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      });
    }
  }
  private async ensureCameraPermission(): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera capture is not supported on this device.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera permission is blocked. Allow camera access for this app in Android Settings, then try again.'
          : error instanceof DOMException && error.name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : error instanceof DOMException && error.name === 'NotReadableError'
              ? 'The camera is busy or unavailable. Close other apps using the camera and try again.'
              : error instanceof Error
                ? error.message
                : 'Camera could not be opened.';
      this.scanResult.set({
        accepted: false,
        tone: 'rejected',
        message: `${message} Use the simulated student list below if camera access remains unavailable.`,
        time: new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      });
      return false;
    }
  }

  async startCamera(): Promise<void> {
    if (!this.canScanActiveEvent()) {
      this.scanResult.set({
        accepted: false,
        tone: 'warning',
        message: 'Attendance scanning is available after this event is approved.',
        time: new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      });
      return;
    }
    if (!this.camera) return;

    const hasPermission = await this.ensureCameraPermission();
    if (!hasPermission) return;

    this.reader = new BrowserMultiFormatReader();
    void this.reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        this.camera.nativeElement,
        (result, _error, controls) => {
          this.scannerControls = controls;
          if (result) {
            this.scanPayload(result.getText());
            controls.stop();
          }
        },
      )
      .then((controls) => {
        this.scannerControls = controls;
      })
      .catch(() =>
        this.scanResult.set({
          accepted: false,
          tone: 'rejected',
          message: 'Camera unavailable. Use the simulated student list below.',
          time: new Date().toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          }),
        }),
      );
  }

  eventSeat(studentId: string): Seat | undefined {
    return this.activeEvent()?.seats.find(
      (seat) => seat.studentId === studentId,
    );
  }
  recordFor(studentId: string): AttendanceRecord | undefined {
    return this.state().attendance.find(
      (record) =>
        record.eventId === this.activeEvent()?.id &&
        record.studentId === studentId,
    );
  }
  recordForEvent(
    eventId: string,
    studentId: string,
  ): AttendanceRecord | undefined {
    return this.state().attendance.find(
      (record) => record.eventId === eventId && record.studentId === studentId,
    );
  }
  eventStudentStatus(event: SchoolEvent, studentId: string): AttendanceStatus {
    return this.attendance.statusFor(
      this.recordForEvent(event.id, studentId),
      event,
    );
  }
  historySeatLabel(event: SchoolEvent, studentId: string): string {
    const seat = event.seats.find((item) => item.studentId === studentId);
    return seat
      ? `${seat.section} · Row ${seat.row} / Seat ${seat.number}`
      : 'Unassigned';
  }
  durationLabel(studentId: string): string {
    const record = this.recordFor(studentId);
    if (!record) return 'Duration —';
    return record.durationMinutes === null
      ? 'In progress'
      : `${record.durationMinutes} min`;
  }
  studentStatus(studentId: string): AttendanceStatus {
    const event = this.activeEvent();
    return event
      ? this.attendance.statusFor(this.recordFor(studentId), event)
      : 'Absent';
  }
  isEventRequired(event: SchoolEvent): boolean {
    const sectionId = this.activeStudent()?.sectionId;
    return !!sectionId && (event.requiredSections ?? []).includes(sectionId);
  }
  canScanActiveEvent(): boolean {
    return this.auth.role() === 'super_admin' ||
      (this.auth.role() === 'organizer' &&
        this.activeEvent()?.approvalStatus === 'approved');
  }
  monitorStudents(): Student[] {
    return this.state().students.filter(
      (student) =>
        `${student.name} ${student.section} ${student.id}`
          .toLowerCase()
          .includes(this.searchText.toLowerCase()) &&
        (this.statusFilter === 'All' ||
          this.studentStatus(student.id) === this.statusFilter),
    );
  }
  seatStatus(seat: Seat): 'available' | 'assigned' | 'occupied' | 'violation' {
    if (
      this.state().violations.some(
        (item) =>
          item.eventId === this.activeEvent()?.id &&
          item.expectedSeatId === seat.id,
      )
    )
      return 'violation';
    if (!seat.studentId) return 'available';
    return this.recordFor(seat.studentId)?.timeIn ? 'occupied' : 'assigned';
  }
  seatsInSection(section: string): Seat[] {
    return (
      this.activeEvent()?.seats.filter((seat) => seat.section === section) ?? []
    );
  }
  sectionAssignedCount(section: string): number {
    return this.seatsInSection(section).filter(
      (seat) => seat.studentId !== null,
    ).length;
  }
  assignmentCount(): number {
    return (
      this.activeEvent()?.seats.filter((seat) => seat.studentId !== null)
        .length ?? 0
    );
  }
  eventViolations() {
    return this.state().violations.filter(
      (item) => item.eventId === this.activeEvent()?.id,
    );
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
  seatLabel(studentId: string): string {
    const seat = this.eventSeat(studentId);
    return seat
      ? `${seat.section} · Row ${seat.row} / Seat ${seat.number}`
      : 'Unassigned';
  }
  smsUri(message: { recipientNumber: string; text: string }): string {
    return `sms:${message.recipientNumber}?body=${encodeURIComponent(message.text)}`;
  }
  seatStudent(seat: Seat): Student | undefined {
    return this.state().students.find(
      (student) => student.id === seat.studentId,
    );
  }
  showSeat(seat: Seat): void {
    this.selectedSeat.set(seat);
  }
  assignSelectedStudent(): void {
    const seat = this.selectedSeat();
    if (
      seat &&
      this.activeEvent() &&
      this.seating.assign(
        this.activeEvent()!.id,
        this.selectedStudentToAssign,
        seat.id,
      )
    )
      this.selectedSeat.set(null);
  }

  sectionReport() {
    const event = this.activeEvent();
    if (!event) return [];
    return event.sections.map((section) => {
      const students = this.state().students.filter(
        (student) => student.section === section,
      );
      const rows = students.map((student) => ({
        student,
        status: this.studentStatus(student.id),
        record: this.recordFor(student.id),
      }));
      const count = (status: AttendanceStatus) =>
        rows.filter((row) => row.status === status).length;
      const durations = rows
        .map((row) => row.record?.durationMinutes)
        .filter(
          (value): value is number => value !== null && value !== undefined,
        );
      return {
        section,
        rows,
        total: students.length,
        present: count('Present'),
        late: count('Late'),
        incomplete: count('Incomplete'),
        absent: count('Absent'),
        percentage: students.length
          ? Math.round(
              ((count('Present') + count('Late') + count('Incomplete')) /
                students.length) *
                100,
            )
          : 0,
        average: durations.length
          ? Math.round(
              durations.reduce((sum, value) => sum + value, 0) /
                durations.length,
            )
          : 0,
      };
    });
  }
  exportCsv(): void {
    const rows = [
      [
        'Section',
        'Total',
        'Present',
        'Late',
        'Incomplete',
        'Absent',
        'Attendance %',
        'Average duration (min)',
      ],
    ];
    this.sectionReport().forEach((row) =>
      rows.push([
        row.section,
        String(row.total),
        String(row.present),
        String(row.late),
        String(row.incomplete),
        String(row.absent),
        String(row.percentage),
        String(row.average),
      ]),
    );
    const blob = new Blob(
      [
        rows
          .map((row) =>
            row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','),
          )
          .join('\n'),
      ],
      { type: 'text/csv;charset=utf-8' },
    );
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${this.activeEvent()?.name.toLowerCase().replaceAll(' ', '-')}-attendance.csv`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  chooseTemplate(template: string): void {
    this.messageTemplate = template;
    const event = this.activeEvent();
    const messages: Record<string, string> = {
      'Event reminder': `Reminder: ${event?.name} is on ${event ? this.formatDate(event.date) : ''} at ${event?.startTime}. See you there!`,
      'Schedule change': `Schedule update for ${event?.name}: check event details for the latest time and venue.`,
      Cancellation: `${event?.name} has been cancelled. Please contact your organizer for more information.`,
      'Attendance confirmation': `Your attendance for ${event?.name} has been recorded.`,
    };
    this.messageText = messages[template] ?? '';
  }
  async sendMessage(): Promise<void> {
    const requiredSections = this.activeEvent()?.requiredSections ?? [];
    const students = this.state().students.filter((student) =>
      requiredSections.includes(student.sectionId ?? '') &&
      (this.recipientMode === 'section'
        ? student.section === this.recipientSection
        : this.recipientMode === 'student'
          ? student.id === this.recipientStudentId
          : true),
    );
    if (!this.messageText.trim()) return;
    try {
      await this.sms.sendMany(
        students,
        (student) => this.messageText.trim().replaceAll('{name}', student.name),
        this.isOnline(),
        this.activeEvent()?.id,
      );
      this.messageText = '';
      this.go('sms');
    } catch (error) {
      this.sms.reportError(error);
    }
  }
  async syncWorkspace(): Promise<void> {
    try {
      await this.workspaceSync.syncNow();
      this.showToast('Workspace synced.');
    } catch (error) {
      this.workspaceSync.error.set(
        error instanceof Error ? error.message : 'Workspace sync failed.',
      );
    }
  }
  saveApiAddress(): void {
    this.apiAddressSaved.set(false);
    try {
      this.workspaceApi.setBaseUrl(this.apiBaseUrl);
      this.workspaceSync.error.set(null);
      this.apiAddressSaved.set(true);
      this.showToast('API address saved.');
    } catch (error) {
      this.workspaceSync.error.set(
        error instanceof Error ? error.message : 'Invalid API address.',
      );
    }
  }
  async loadManagedAccounts(): Promise<void> {
    if (!this.auth.authenticated() || this.auth.role() !== 'super_admin') return;
    this.accountsLoading.set(true);
    try {
      const result = await this.workspaceApi.listAccounts(this.auth.getToken());
      this.managedAccounts.set(result.accounts);
      this.accountError.set(null);
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.accountsLoading.set(false);
    }
  }
  async createManagedAccount(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
    try {
      await this.workspaceApi.createAccount(this.auth.getToken(), {
        username: this.accountForm.username.trim(),
        password: this.accountForm.password,
      });
      this.accountMessage.set('Organizer account created.');
      this.showToast('Organizer account created.');
      this.accountForm = { username: '', password: '' };
      await this.loadManagedAccounts();
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async resetManagedAccountPassword(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
    if (!this.resetAccountUsername) {
      this.accountError.set('Select an account before resetting its password.');
      return;
    }
    try {
      await this.workspaceApi.resetAccountPassword(
        this.auth.getToken(),
        this.resetAccountUsername,
        this.resetAccountPassword,
      );
      this.resetAccountPassword = '';
      this.accountMessage.set(
        `Password reset for ${this.resetAccountUsername}.`,
      );
      this.showToast('Password reset.');
      if (
        this.resetAccountUsername.toLowerCase() ===
        this.auth.username().toLowerCase()
      ) {
        this.auth.error.set(
          'Your password was reset. Sign in again with the new password.',
        );
        this.auth.signOut();
        this.store.update((state) => {
          state.role = null;
        });
        this.authMode.set('login');
        this.authUsername = this.resetAccountUsername;
        void this.router.navigate(['/login']);
      }
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
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
  async resetWorkspace(): Promise<void> {
    if (this.clearWorkspaceConfirmation !== 'CLEAR') return;
    try {
      await this.sms.clear();
    } catch (error) {
      this.sms.reportError(error);
      return;
    }
    this.workspaceSync.markWorkspaceReset();
    this.store.reset();
    try {
      await this.workspaceSync.flushLocalChanges();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.workspaceSync.error.set(
        `Workspace cleared on this device, but its offline cache could not be saved: ${detail}`,
      );
    }
    this.clearWorkspaceConfirmation = '';
    this.go('home');
  }
  formatDate(value: string): string {
    return new Date(`${value}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }
  formatTime(value: string | null | undefined): string {
    return value
      ? new Date(value).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })
      : '—';
  }
  statusClass(status: AttendanceStatus | string): string {
    return status.toLowerCase().replaceAll(' ', '-');
  }
  private count(status: AttendanceStatus): number {
    return this.state().students.filter(
      (student) => this.studentStatus(student.id) === status,
    ).length;
  }
  get presentCount(): number {
    return this.count('Present');
  }
  get incompleteCount(): number {
    return this.count('Incomplete');
  }
  get absentCount(): number {
    return this.count('Absent');
  }
}
