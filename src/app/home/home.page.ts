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
} from '../core/services/workspace-api.service';
import {
  AttendanceRecord,
  AttendanceStatus,
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
  readonly requiresEvent = computed(() =>
    [
      'event-details',
      'seating',
      'scan',
      'attendance',
      'history',
      'reports',
      'compose-sms',
      'my-qr',
    ].includes(this.page()),
  );
  readonly isOnline = this.offline.isOnline;
  readonly smsMessages = this.sms.messages;
  readonly authMode = signal<'login' | 'register'>('register');
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
  readonly accountError = signal<string | null>(null);
  readonly accountMessage = signal<string | null>(null);

  scanStudentId = 'STU-001';
  gateSection = 'Grade 10-A';
  selectedStudentToAssign = 'STU-001';
  searchText = '';
  statusFilter = 'All';
  studentForm = { name: '', section: '', mobile: '' };
  eventForm = {
    name: '',
    date: '',
    startTime: '08:00',
    endTime: '16:00',
    venue: '',
    description: '',
    graceMinutes: 15,
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
  accountForm: {
    username: string;
    password: string;
    role: UserRole;
    studentId: string;
  } = { username: '', password: '', role: 'student', studentId: '' };
  resetAccountUsername = '';
  resetAccountPassword = '';
  private reader?: BrowserMultiFormatReader;
  private scannerControls?: IScannerControls;

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
      this.page.set(params.get('screen') ?? 'login');
      if (
        this.page() === 'settings' &&
        this.auth.role() === 'organizer'
      ) {
        void this.loadManagedAccounts();
      }
      if (this.page() === 'my-qr') void this.refreshQr();
    });
  }

  ngOnInit(): void {
    void this.refreshQr();
  }
  ngOnDestroy(): void {
    this.scannerControls?.stop();
  }

  chooseRole(role: UserRole): void {
    if (role !== this.auth.role()) return;
    this.store.update((state) => {
      state.role = role;
      state.studentId = this.auth.studentId() ?? '';
    });
    void this.router.navigate(['/workspace/home']);
  }
  async submitAuth(): Promise<void> {
    const username = this.authUsername.trim();
    try {
      this.workspaceApi.setBaseUrl(this.apiBaseUrl);
      this.apiCheckMessage.set(null);
      if (this.authMode() === 'register') {
        await this.auth.register(username, this.authPassword);
      } else {
        await this.auth.login(username, this.authPassword);
      }
      this.authPassword = '';
      try {
        await this.workspaceSync.connect();
      } catch {
        // The signed-in user can keep working locally while sync is unavailable.
      }
      if (this.auth.authenticated()) {
        void this.router.navigate(['/workspace/home']);
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
            section: student.section,
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
    };
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
    };
    this.go('create-event');
  }
  saveEvent(): void {
    const saved = this.events.save(
      {
        ...this.eventForm,
        graceMinutes: Number(this.eventForm.graceMinutes) || 0,
      },
      this.editingEventId,
    );
    this.selectEvent(saved.id);
    this.go('event-details');
  }

  scanStudent(studentId: string, gate = this.gateSection): void {
    const event = this.activeEvent();
    if (!event) return;
    const student = this.state().students.find((item) => item.id === studentId);
    const result = this.attendance.scan(
      event.id,
      studentId,
      gate,
      this.isOnline(),
    );
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
    if (result.accepted && student && seat && result.record) {
      const action = result.record.timeOut ? 'timed out' : 'timed in';
      void this.sms.send(
        student,
        `${student.name} ${action} at ${this.formatTime(result.record.timeOut ?? result.record.timeIn)} for ${event.name}, ${seat.section}, Row ${seat.row} Seat ${seat.number}.`,
        this.isOnline(),
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
    const students = this.state().students.filter((student) =>
      this.recipientMode === 'section'
        ? student.section === this.recipientSection
        : this.recipientMode === 'student'
          ? student.id === this.recipientStudentId
          : true,
    );
    if (!this.messageText.trim()) return;
    try {
      await this.sms.sendMany(
        students,
        (student) => this.messageText.trim().replaceAll('{name}', student.name),
        this.isOnline(),
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
    } catch (error) {
      this.workspaceSync.error.set(
        error instanceof Error ? error.message : 'Invalid API address.',
      );
    }
  }
  async loadManagedAccounts(): Promise<void> {
    if (!this.auth.authenticated() || this.auth.role() !== 'organizer') return;
    try {
      const result = await this.workspaceApi.listAccounts(this.auth.getToken());
      this.managedAccounts.set(result.accounts);
      this.accountError.set(null);
      if (!this.resetAccountUsername && result.accounts.length > 0) {
        this.resetAccountUsername = result.accounts[0].username;
      }
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async createManagedAccount(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
    try {
      await this.workspaceApi.createAccount(this.auth.getToken(), {
        ...this.accountForm,
        username: this.accountForm.username.trim(),
        studentId:
          this.accountForm.role === 'student'
            ? this.accountForm.studentId
            : null,
      });
      this.accountMessage.set(
        `${this.accountForm.role === 'student' ? 'Student' : 'Organizer'} account created.`,
      );
      this.accountForm = {
        username: '',
        password: '',
        role: 'student',
        studentId: '',
      };
      await this.loadManagedAccounts();
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async resetManagedAccountPassword(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
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
    if (!window.confirm('Clear all students, events, attendance, and messages?'))
      return;
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
