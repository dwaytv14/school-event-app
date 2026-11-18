import { computed, signal } from '@angular/core';
import { BrowserMultiFormatReader } from '@zxing/browser';
import * as QRCode from 'qrcode';
import { eventMoment, timeOfDay } from '../../core/services/time-format';
import { compactClass, studentClassInfo } from '../../core/services/student-name';
import { isEventOver, isEventUpcoming } from '../../core/services/event-actions';
import { isStudentRequired } from '../../core/services/event-roster';
import {
  AttendanceRecord,
  AttendanceStatus,
  SchoolEvent,
  Student,
} from '../../core/models/school-event.models';
import { CommsPart } from './comms.part';
import { MonitorState } from '../home.types';

/** Scanning, the live monitor, attendance records and reports. */
export abstract class AttendancePart extends CommsPart {
  readonly qrCode = signal('');
  readonly selectedReportSection = signal('');

  // ---- Section report: find the section you are looking for ----
  readonly reportSearch = signal('');
  readonly reportCourse = signal('');
  readonly reportYear = signal('');
  /** The sections of the open event with their course and year, worked out once. */
  private readonly reportSections = computed(() => {
    this.schoolDay(); // a finished day changes who counts as absent
    return this.sectionReport().map((section) => {
      const match = /^(\S+)\s+(\d+)\S*\s+Year\b/i.exec(section.section);
      const year = match ? Number(match[2]) : 0;
      return {
        ...section,
        course: match?.[1] ?? '',
        year: year ? `${year}${['', 'st', 'nd', 'rd'][year] || 'th'} Year` : '',
      };
    });
  });
  readonly reportTotal = computed(() => this.reportSections().length);
  readonly reportCourses = computed(() =>
    [...new Set(this.reportSections().map((section) => section.course).filter(Boolean))].sort(),
  );
  readonly reportYears = computed(() =>
    [...new Set(this.reportSections().map((section) => section.year).filter(Boolean))].sort(),
  );
  /** What the report page lists, after the search and the course and year choices. */
  readonly visibleReportSections = computed(() => {
    const query = this.reportSearch().trim().toLowerCase();
    const course = this.reportCourse();
    const year = this.reportYear();
    return this.reportSections().filter(
      (section) =>
        (!course || section.course === course) &&
        (!year || section.year === year) &&
        (!query || section.section.toLowerCase().includes(query)),
    );
  });
  /** The whole event at a glance, across every section. */
  readonly reportOverall = computed(() => {
    const total = { students: 0, present: 0, late: 0, incomplete: 0, absent: 0, notYet: 0, excused: 0 };
    for (const section of this.reportSections()) {
      total.students += section.total;
      total.present += section.present;
      total.late += section.late;
      total.incomplete += section.incomplete;
      total.absent += section.absent;
      total.notYet += section.notYet;
      total.excused += section.excused;
    }
    const counted = total.students - total.excused; // an excused student does not count against anyone
    const attended = total.present + total.late + total.incomplete;
    return { ...total, percentage: counted > 0 ? Math.round((attended / counted) * 100) : 0 };
  });
  /** Sections under their course, so a long list reads in short blocks. */
  readonly reportGroups = computed(() => {
    const groups = new Map<string, ReturnType<typeof this.visibleReportSections>>();
    for (const section of this.visibleReportSections()) {
      const key = section.course || 'Other';
      groups.set(key, [...(groups.get(key) ?? []), section]);
    }
    return [...groups].map(([course, sections]) => ({ course, sections }));
  });
  clearReportFilters(): void {
    this.reportSearch.set('');
    this.reportCourse.set('');
    this.reportYear.set('');
  }
  /** Opens one section's student list; opening another closes the first, so the page stays short. */
  toggleReportSection(section: string): void {
    this.selectedReportSection.set(this.selectedReportSection() === section ? '' : section);
  }
  readonly attendeePrintSection = signal('');
  readonly scannedCount = computed(
    () =>
      this.state().attendance.filter(
        (record) =>
          record.eventId === this.state().selectedEventId && !record.excused && !!record.timeIn,
      ).length,
  );

  /** Who has been scanned for the selected event, newest first. */
  readonly scannedList = computed(() => {
    const state = this.state();
    return state.attendance
      .filter(
        (record) =>
          record.eventId === state.selectedEventId && !record.excused && !!record.timeIn,
      )
      .map((record) => {
        const student = state.students.find((item) => item.id === record.studentId);
        const event = state.events.find((item) => item.id === record.eventId);
        const [year, month, day] = (event?.date ?? '').split('-');
        return {
          id: record.id,
          name: student?.name ?? record.studentId,
          cys: student ? this.courseYearSection(student) : '—',
          date: event?.date ? `${month}/${day}/${year}` : '—',
          timeIn: record.timeIn,
          timeOut: record.timeOut,
        };
      })
      .sort((a, b) => (b.timeOut ?? b.timeIn ?? '').localeCompare(a.timeOut ?? a.timeIn ?? ''));
  });

  /** Section picked in the scan table filter ('' means all sections). */
  readonly scanSectionFilter = signal('');
  readonly scannedSections = computed(() =>
    [...new Set(this.scannedList().map((row) => row.cys))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  readonly visibleScanned = computed(() => {
    const section = this.scanSectionFilter();
    return this.scannedList().filter((row) => !section || row.cys === section);
  });

  /** "BSIT-4A" for the student pass. */
  passClass(student: Student): string {
    return compactClass(student);
  }

  eventDateNumeric(date: string): string {
    const [year, month, day] = (date ?? '').split('-');
    return date ? `${month}/${day}/${year}` : '—';
  }

  /** "BSIT 4-A": the one place that writes Course Year-Section. */
  courseYearSection(student: Student): string {
    return studentClassInfo(student).label;
  }

  searchText = '';
  statusFilter = 'All';
  readonly scanAvatar = signal<string | null>(null);
  protected readonly studentAvatars = new Map<string, string | null>();

  /** Shows the scanned student's photo so staff can check who they are scanning. */
  protected async loadScanAvatar(studentId: string): Promise<void> {
    this.scanAvatar.set(this.studentAvatars.get(studentId) ?? null);
    if (this.studentAvatars.has(studentId) || !this.isOnline()) return;
    try {
      const { avatar } = await this.workspaceApi.studentAvatar(
        this.auth.getToken(),
        studentId,
      );
      this.studentAvatars.set(studentId, avatar);
      if (this.scanResult()?.student?.id === studentId) this.scanAvatar.set(avatar);
    } catch {
      // A missing photo never blocks a scan.
    }
  }
  protected lastScanText = '';
  protected lastScanAt = 0;
  setStudent(id: string): void {
    this.store.update((state) => {
      state.studentId = id;
    });
    void this.refreshQr();
  }

  async refreshQr(): Promise<void> {
    const student = this.activeStudent();
    if (!student?.id) {
      this.qrCode.set('');
      return;
    }
    try {
      this.qrCode.set(
        await QRCode.toDataURL(
          JSON.stringify({ studentId: student.id }),
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

  scanStudent(studentId: string): void {
    const event = this.activeEvent();
    if (!event) return;
    if (!this.canScanActiveEvent()) {
      const message = this.scanBlockedMessage();
      this.scanResult.set({
        accepted: false,
        tone: 'rejected',
        message,
        time: timeOfDay(new Date()),
      });
      this.showToast(message, 'warning');
      return;
    }
    const student = this.state().students.find((item) => item.id === studentId);
    const result = this.attendance.scan(event.id, studentId, this.isOnline());
    this.scanAvatar.set(null);
    if (student && result.accepted) void this.loadScanAvatar(student.id);
    this.scanResult.set({
      ...result,
      student,
      time: timeOfDay(new Date()),
    });
    this.showToast(
      `${student?.name ?? 'Student'}: ${result.message}`,
      result.tone === 'rejected' ? 'danger' : result.tone,
    );
    if (
      result.accepted &&
      student &&
      result.record &&
      isStudentRequired(event, student)
    ) {
      const action = result.record.timeOut ? 'timed out' : 'timed in';
      void this.sms.send(
        student,
        `${student.name} ${action} at ${this.formatTime(result.record.timeOut ?? result.record.timeIn)} for ${event.name}.`,
        this.isOnline(),
        event.id,
      ).catch((error: unknown) => this.sms.reportError(error));
    }
  }

  scanPayload(raw: string): void {
    try {
      let studentId = raw.trim();
      try {
        const payload: unknown = JSON.parse(studentId);
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'studentId' in payload &&
          typeof payload.studentId === 'string'
        ) {
          studentId = payload.studentId;
        }
      } catch {
        // Accept a QR containing only the student ID as well as the app's JSON payload.
      }
      if (!this.state().students.some((student) => student.id === studentId)) {
        throw new Error('unknown student');
      }
      this.scanStudent(studentId);
    } catch {
      const message = 'QR code is not a recognized student pass.';
      this.scanResult.set({
        accepted: false,
        tone: 'rejected',
        message,
        time: timeOfDay(new Date()),
      });
      this.showToast(message, 'danger');
    }
  }
  protected async ensureCameraPermission(): Promise<boolean> {
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
        time: timeOfDay(new Date()),
      });
      return false;
    }
  }

  async startCamera(): Promise<void> {
    if (!this.canScanActiveEvent()) {
      this.scanResult.set({
        accepted: false,
        tone: 'warning',
        message: this.scanBlockedMessage(),
        time: timeOfDay(new Date()),
      });
      return;
    }
    if (!this.camera) return;

    const hasPermission = await this.ensureCameraPermission();
    if (!hasPermission) return;

    this.stopScanner();
    this.lastScanText = '';
    this.lastScanAt = 0;
    this.reader = new BrowserMultiFormatReader();
    void this.reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        this.camera.nativeElement,
        (result, _error, controls) => {
          this.scannerControls = controls;
          if (result) {
            // Keep the camera live; ignore the same code for a few seconds so
            // one QR held in view is not recorded as IN and then OUT.
            const text = result.getText();
            const now = Date.now();
            if (
              text === this.lastScanText &&
              now - this.lastScanAt < 3500
            ) {
              return;
            }
            this.lastScanText = text;
            this.lastScanAt = now;
            this.scanPayload(text);
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
          time: timeOfDay(new Date()),
        }),
      );
  }

  recordFor(studentId: string): AttendanceRecord | undefined {
    const active = this.activeEvent();
    const found = this.state().attendance.find(
      (record) => record.eventId === active?.id && record.studentId === studentId,
    );
    // Before the event day only an approved excuse can exist; ignore stray scans.
    if (active && isEventUpcoming(active) && !found?.excused) return undefined;
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
    return isStudentRequired(event, this.activeStudent());
  }
  canScanActiveEvent(): boolean {
    const event = this.activeEvent();
    return this.actions().scan && !!event && !this.eventEnded(event);
  }
  /** Why scanning is closed for the active event. */
  scanBlockedMessage(): string {
    const event = this.activeEvent();
    if (event && this.eventEnded(event) && (event.approvalStatus ?? 'approved') === 'approved' && !event.cancelled) {
      return 'This event has already ended. Scanning is closed.';
    }
    if (event && isEventUpcoming(event)) {
      return `This event has not started yet. Scanning opens on ${this.eventDateNumeric(event.date)}.`;
    }
    return 'There is no approved event to scan yet. Scanning opens once an event is approved.';
  }
  // ---- Live attendance monitor (admin and organizers) ----
  protected eventEnded(event: SchoolEvent): boolean {
    return isEventOver(event);
  }
  protected isLateRecord(record: AttendanceRecord, event: SchoolEvent): boolean {
    const arrived = new Date(record.timeIn).getTime();
    const start = eventMoment(event.date, event.startTime).getTime();
    return (
      Number.isFinite(arrived) &&
      Number.isFinite(start) &&
      arrived > start + event.graceMinutes * 60000
    );
  }
  /** The students expected at the active event (its required sections). */
  readonly monitorRoster = computed(() => {
    const event = this.activeEvent();
    if (!event) return [] as Student[];
    const required = new Set(event.requiredSections ?? []);
    return this.state().students.filter(
      (student) =>
        event.roster
          ? isStudentRequired(event, student)
          : required.size === 0 || required.has(student.sectionId ?? ''),
    );
  });
  readonly scannedAttendees = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    const eventId = this.activeEvent()?.id;
    const active = this.activeEvent();
    if (!eventId || !active || isEventUpcoming(active)) return [];
    const students = new Map(this.state().students.map((student) => [student.id, student]));
    return this.state()
      .attendance.filter(
          (record) =>
            record.eventId === eventId && !!record.timeIn && !record.excused,
      )
      .flatMap((record) => {
          const student = students.get(record.studentId);
          return student ? [{ student, record }] : [];
      })
      .sort((left, right) => left.record.timeIn.localeCompare(right.record.timeIn));
  });
  readonly attendeePrintSections = computed(() => {
    const sections = new Map<string, string>();
    for (const student of this.monitorRoster()) {
      sections.set(student.section, this.studentYearSection(student));
    }
    return [...sections].map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  });
  readonly attendeePrintRows = computed(() => {
    const section = this.attendeePrintSection();
    return this.scannedAttendees().filter(
      ({ student }) => !section || student.section === section,
    );
  });
  readonly monitorStates = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    const states = new Map<string, MonitorState>();
    const event = this.activeEvent();
    if (!event) return states;
    // Nobody can be here before the event day; ignore any stray early records.
    const records = new Map(
      this.state()
        .attendance.filter(
          (record) =>
            record.eventId === event.id && (!isEventUpcoming(event) || !!record.excused),
        )
        .map((record) => [record.studentId, record]),
    );
    const ended = this.eventEnded(event);
    for (const student of this.monitorRoster()) {
      const record = records.get(student.id);
      if (record?.excused) {
        states.set(student.id, { key: 'Excused', label: 'Excused', color: 'medium', late: false });
      } else if (record && !record.timeOut && !ended) {
        states.set(student.id, {
          key: 'Here',
          label: 'Here now',
          color: 'success',
          late: this.isLateRecord(record, event),
        });
      } else if (record) {
        // Once the event day is over nobody is "here" any more.
        states.set(student.id, {
          key: 'Out',
          label: 'Checked out',
          color: 'primary',
          late: this.isLateRecord(record, event),
        });
      } else {
        states.set(student.id, {
          key: 'Not yet',
          label: ended ? 'Absent' : 'Not yet here',
          color: ended ? 'danger' : 'warning',
          late: false,
        });
      }
    }
    return states;
  });
  readonly monitorSummary = computed(() => {
    this.schoolDay(); // recompute when the school day changes
    const event = this.activeEvent();
    if (!event) return null;
    const roster = this.monitorRoster();
    const states = this.monitorStates();
    const count = (key: MonitorState['key']) =>
      roster.filter((student) => states.get(student.id)?.key === key).length;
    const sections = new Map<string, { section: string; arrived: number; total: number }>();
    for (const student of roster) {
      const entry = sections.get(student.section) ?? {
        section: student.section,
        arrived: 0,
        total: 0,
      };
      entry.total += 1;
      const key = states.get(student.id)?.key;
      if (key === 'Here' || key === 'Out') entry.arrived += 1;
      sections.set(student.section, entry);
    }
    const here = count('Here');
    const out = count('Out');
    return {
      total: roster.length,
      here,
      out,
      arrived: here + out,
      excused: count('Excused'),
      notYet: count('Not yet'),
      late: roster.filter((student) => states.get(student.id)?.late).length,
      ended: this.eventEnded(event),
      sections: [...sections.values()].sort((a, b) => a.section.localeCompare(b.section)),
    };
  });
  monitorState(studentId: string): MonitorState | undefined {
    return this.monitorStates().get(studentId);
  }
  monitorStudents(): Student[] {
    const query = this.searchText.toLowerCase();
    return this.monitorRoster().filter((student) => {
      if (!`${student.name} ${student.section} ${student.id}`.toLowerCase().includes(query)) {
        return false;
      }
      const state = this.monitorState(student.id);
      if (this.statusFilter === 'All') return true;
      if (this.statusFilter === 'Late') return !!state?.late;
      return state?.key === this.statusFilter;
    });
  }
  monitorTableStudents(): Student[] {
    return this.monitorStudents().sort((left, right) => {
      const leftTime = this.recordFor(left.id)?.timeIn ?? '';
      const rightTime = this.recordFor(right.id)?.timeIn ?? '';
      if (leftTime && rightTime) return leftTime.localeCompare(rightTime);
      if (leftTime) return -1;
      if (rightTime) return 1;
      return left.name.localeCompare(right.name);
    });
  }
  /** "BSIT-4A" */
  studentYearSection(student: Student): string {
    return compactClass(student);
  }
  /** Check in/out or excuse a student by hand, with Undo for the easy mistakes. */
  manualMark(student: Student, action: 'in' | 'out' | 'excused' | 'clear'): void {
    const event = this.activeEvent();
    if (!event || !this.canScanActiveEvent()) return;
    const result = this.attendance.markManual(event.id, student.id, action, this.isOnline());
    if (!result.accepted) {
      this.showToast(result.message, 'warning');
      return;
    }
    const undo =
      action === 'in' || action === 'excused'
        ? () => {
            this.attendance.markManual(event.id, student.id, 'clear', this.isOnline());
          }
        : undefined;
    this.showToast(`${student.name}: ${result.message}`, 'success', undo);
  }
  sectionReport() {
    const event = this.activeEvent();
    if (!event) return [];
    return this.eventSectionLabels(event).map((section) => {
      const savedIds = event.roster?.[section];
      const students = this.state().students.filter((student) =>
        savedIds ? savedIds.includes(student.id) : student.section === section,
      );
      // Students who scanned come first (earliest time-in first); absent and
      // excused students go last, alphabetically.
      const over = isEventOver(event);
      const rows = students
        .map((student) => {
          const record = this.recordFor(student.id);
          // Nobody is "absent" until the event is over (finished, or its day has passed).
          const status: AttendanceStatus | 'Not yet' =
            !record && !over ? 'Not yet' : this.studentStatus(student.id);
          return { student, status, record };
        })
        .sort((left, right) => {
          const leftIn = left.record?.timeIn ?? '';
          const rightIn = right.record?.timeIn ?? '';
          if (leftIn && rightIn) return leftIn.localeCompare(rightIn);
          if (leftIn) return -1;
          if (rightIn) return 1;
          return left.student.name.localeCompare(right.student.name);
        });
      const count = (status: AttendanceStatus | 'Not yet') =>
        rows.filter((row) => row.status === status).length;
      return {
        section,
        rows,
        total: students.length,
        present: count('Present'),
        late: count('Late'),
        incomplete: count('Incomplete'),
        absent: count('Absent'),
        notYet: count('Not yet'),
        excused: count('Excused'),
        // Excused students do not count against the section.
        percentage:
          students.length - count('Excused') > 0
            ? Math.round(
                ((count('Present') + count('Late') + count('Incomplete')) /
                  (students.length - count('Excused'))) *
                  100,
              )
            : 0,
      };
    });
  }
  readonly reportBusy = signal(false);
  /** A printable PDF: one page per section, listing every student and their status. */
  async downloadReportPdf(): Promise<void> {
    const event = this.activeEvent();
    if (!event || this.reportBusy()) return;
    this.reportBusy.set(true);
    try {
      const sections = this.reportPdf.buildSections(
        event,
        this.state().students,
        this.state().attendance,
        (id) => this.requiredSectionLabel(id),
      );
      const file = await this.withLoading('Preparing the printable report…', () =>
        this.reportPdf.createPdf(event, sections),
      );
      await this.reportPdf.deliver(file);
      this.showToast('Report ready. Choose Print or Save.');
    } catch (error) {
      // Closing the share sheet is not an error.
      const message = error instanceof Error ? error.message : '';
      if (!/cancel/i.test(message)) {
        this.showToast('The report could not be created. Try again.', 'danger');
      }
    } finally {
      this.reportBusy.set(false);
    }
  }
  async printAttendeeSheet(): Promise<void> {
    const event = this.activeEvent();
    const attendees = this.attendeePrintRows();
    if (!event || this.reportBusy()) return;
    if (!attendees.length) {
      this.showToast('No checked-in attendees match this section yet.', 'warning');
      return;
    }

    this.reportBusy.set(true);
    try {
      const rows = this.reportPdf.buildAttendeeSheetRows(
        event,
        attendees.map(({ student }) => student),
        (student) => this.studentYearSection(student),
      );
      const selectedSection = this.attendeePrintSection();
      const sectionLabel = selectedSection
        ? this.attendeePrintSections().find((section) => section.value === selectedSection)?.label ??
          selectedSection
        : 'All sections';
      const file = await this.withLoading('Preparing the attendee print sheet…', () =>
        this.reportPdf.createAttendeePdf(event, rows, sectionLabel),
      );
      await this.reportPdf.deliver(file);
      this.showToast('Attendee sheet ready. Choose Print or Save.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/cancel/i.test(message)) {
        this.showToast('The attendee sheet could not be created. Try again.', 'danger');
      }
    } finally {
      this.reportBusy.set(false);
    }
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
        'Not yet',
        'Attendance %',
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
        String(row.notYet),
        String(row.percentage),
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
    const url = URL.createObjectURL(blob);
    const fileName = (this.activeEvent()?.name ?? 'event')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    anchor.href = url;
    anchor.download = `${fileName || 'event'}-attendance.csv`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    this.showToast('CSV exported.');
  }
  protected count(status: AttendanceStatus): number {
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
