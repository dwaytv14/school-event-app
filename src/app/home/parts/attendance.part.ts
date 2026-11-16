import { computed, signal } from '@angular/core';
import { BrowserMultiFormatReader } from '@zxing/browser';
import * as QRCode from 'qrcode';
import { isStudentRequired } from '../../core/services/event-roster';
import {
  AttendanceRecord,
  AttendanceStatus,
  SchoolEvent,
  Seat,
  Student,
} from '../../core/models/school-event.models';
import { CommsPart } from './comms.part';
import { MonitorState } from '../home.types';

/** Scanning, the live monitor, the seat map, attendance records and reports. */
export abstract class AttendancePart extends CommsPart {
  readonly qrCode = signal('');
  readonly selectedSeat = signal<Seat | null>(null);
  readonly selectedReportSection = signal('');
  readonly scannedCount = computed(
    () =>
      this.state().attendance.filter(
        (record) => record.eventId === this.state().selectedEventId,
      ).length,
  );

  selectedStudentToAssign = 'STU-001';
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
  seatRows(event: SchoolEvent): {
    block: number;
    rows: { row: number; seats: { seat: Seat; index: number }[] }[];
  }[] {
    const blocks = new Map<number, Map<number, { seat: Seat; index: number }[]>>();
    this.sharedSeats(event).forEach((seat, index) => {
      const blockRows = blocks.get(seat.block ?? 0) ?? new Map();
      const list = blockRows.get(seat.row) ?? [];
      list.push({ seat, index });
      blockRows.set(seat.row, list);
      blocks.set(seat.block ?? 0, blockRows);
    });
    return [...blocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([block, rows]) => ({
        block,
        rows: [...rows.entries()]
          .sort(([left], [right]) => left - right)
          .map(([row, seats]) => ({ row, seats })),
      }));
  }
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
    const seat = event.seats.find((item) => item.studentId === studentId);
    const result = this.attendance.scan(event.id, studentId, this.isOnline());
    if (result.accepted && typeof navigator !== 'undefined') {
      this.buzz('medium');
    }
    this.scanAvatar.set(null);
    if (student && result.accepted) void this.loadScanAvatar(student.id);
    this.scanResult.set({
      ...result,
      student,
      seat,
      seatLocation:
        event.seatingPlan && student
          ? this.plannedSeatLabel(student.id)
          : undefined,
      time: new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
    if (
      result.accepted &&
      student &&
      (seat || event.seatingPlan) &&
      result.record &&
      isStudentRequired(event, student)
    ) {
      const action = result.record.timeOut ? 'timed out' : 'timed in';
      const location = seat
        ? `${seat.section}, Row ${seat.row} Seat ${seat.number}`
        : this.plannedSeatLabel(student.id);
      void this.sms.send(
        student,
        `${student.name} ${action} at ${this.formatTime(result.record.timeOut ?? result.record.timeIn)} for ${event.name}, ${location}.`,
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
    if (event.seatingPlan) {
      const student = this.state().students.find((item) => item.id === studentId);
      if (!student?.sectionId) return 'Section seating';
      return `${student.section} · any free chair`;
    }
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
    return isStudentRequired(event, this.activeStudent());
  }
  canScanActiveEvent(): boolean {
    if (this.activeEvent()?.cancelled) return false;
    return this.auth.role() === 'super_admin' ||
      (this.auth.role() === 'organizer' &&
        this.activeEvent()?.approvalStatus === 'approved');
  }
  // ---- Live attendance monitor (admin and organizers) ----
  protected eventEnded(event: SchoolEvent): boolean {
    const end = new Date(`${event.date}T${event.endTime}:00`).getTime();
    return Number.isFinite(end) && Date.now() >= end;
  }
  protected isLateRecord(record: AttendanceRecord, event: SchoolEvent): boolean {
    const arrived = new Date(record.timeIn).getTime();
    const start = new Date(`${event.date}T${event.startTime}:00`).getTime();
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
  readonly monitorStates = computed(() => {
    const states = new Map<string, MonitorState>();
    const event = this.activeEvent();
    if (!event) return states;
    const records = new Map(
      this.state()
        .attendance.filter((record) => record.eventId === event.id)
        .map((record) => [record.studentId, record]),
    );
    const ended = this.eventEnded(event);
    for (const student of this.monitorRoster()) {
      const record = records.get(student.id);
      if (record?.excused) {
        states.set(student.id, { key: 'Excused', label: 'Excused', color: 'medium', late: false });
      } else if (record && !record.timeOut) {
        states.set(student.id, {
          key: 'Here',
          label: 'Here now',
          color: 'success',
          late: this.isLateRecord(record, event),
        });
      } else if (record) {
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
  seatStatus(seat: Seat): 'available' | 'assigned' | 'occupied' {
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
  sectionSeatOccupancy(sectionId: string): number {
    const activeEvent = this.activeEvent();
    if (!activeEvent) return 0;
    const activeStudentIds = new Set(
      this.state()
        .attendance.filter(
          (record) =>
            record.eventId === activeEvent.id && record.timeIn && !record.timeOut,
        )
        .map((record) => record.studentId),
    );
    return this.state().students.filter(
      (student) =>
        student.sectionId === sectionId && activeStudentIds.has(student.id),
    ).length;
  }
  sharedSeatOccupancy(): number {
    const activeEvent = this.activeEvent();
    if (!activeEvent?.seatingPlan) return 0;
    const sharedSectionIds = new Set(this.sharedSeatSectionIds(activeEvent));
    const activeStudentIds = new Set(
      this.state()
        .attendance.filter(
          (record) =>
            record.eventId === activeEvent.id && record.timeIn && !record.timeOut,
        )
        .map((record) => record.studentId),
    );
    return this.state().students.filter(
      (student) =>
        student.sectionId &&
        sharedSectionIds.has(student.sectionId) &&
        activeStudentIds.has(student.id),
    ).length;
  }
  sharedSeatSectionIds(event: SchoolEvent): string[] {
    return event.seatingPlan ? (event.requiredSections ?? []) : [];
  }
  sharedSeatCount(event: SchoolEvent): number {
    const seatingPlan = event.seatingPlan;
    if (!seatingPlan) return event.seats.length;
    return seatingPlan.sharedSeatCount ??
      Object.values(seatingPlan.sectionSeatCounts ?? {}).reduce(
        (total, count) => total + count,
        0,
      );
  }
  sharedSeats(event: SchoolEvent): Seat[] {
    if (!event.seatingPlan) return [];
    if (event.seatingPlan.sharedSeatCount !== undefined) return event.seats;
    const sharedSectionIds = new Set(this.sharedSeatSectionIds(event));
    return event.seats.filter(
      (seat) => seat.sectionId && sharedSectionIds.has(seat.sectionId),
    );
  }
  seatPoolStatus(index: number): 'available' | 'occupied' {
    return index < this.sharedSeatOccupancy()
      ? 'occupied'
      : 'available';
  }
  plannedSeatLabel(studentId: string): string {
    const event = this.activeEvent();
    const student = this.state().students.find((item) => item.id === studentId);
    if (!event?.seatingPlan || !student?.sectionId) return 'Unassigned';
    return 'Any free chair';
  }
  seatLabel(studentId: string): string {
    if (this.activeEvent()?.seatingPlan) return this.plannedSeatLabel(studentId);
    const seat = this.eventSeat(studentId);
    return seat
      ? `${seat.section} · Row ${seat.row} / Seat ${seat.number}`
      : 'Unassigned';
  }
  seatStudent(seat: Seat): Student | undefined {
    return this.state().students.find(
      (student) => student.id === seat.studentId,
    );
  }
  showSeat(seat: Seat): void {
    const students = this.state().students;
    if (!students.some((item) => item.id === this.selectedStudentToAssign)) {
      this.selectedStudentToAssign = students[0]?.id ?? '';
    }
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
    return this.eventSectionLabels(event).map((section) => {
      const savedIds = event.roster?.[section];
      const students = this.state().students.filter((student) =>
        savedIds ? savedIds.includes(student.id) : student.section === section,
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
        average: durations.length
          ? Math.round(
              durations.reduce((sum, value) => sum + value, 0) /
                durations.length,
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
