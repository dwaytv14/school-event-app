import { isEventOver } from './event-actions';
import type { RowInput } from 'jspdf-autotable';
import { collegeForCourse, compactClass, courseOfSection } from './student-name';
import { timeOfDay } from './time-format';
import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  AttendanceRecord,
  SchoolEvent,
  Student,
} from '../models/school-event.models';
import { AttendanceService } from './attendance.service';

export type ReportStatus = 'Present' | 'Late' | 'Absent' | 'Excused' | 'Not yet here';

export interface ReportRow {
  no: number;
  studentId: string;
  name: string;
  status: ReportStatus;
  timeIn: string;
  timeOut: string;
}

export interface ReportSection {
  sectionId: string;
  label: string;
  rows: ReportRow[];
  present: number;
  late: number;
  absent: number;
  excused: number;
}

/** The attendee sheet follows the school's template: 8.5 x 13 in paper, in points. */
const SHEET = {
  width: 612,
  height: 936,
  headerHeight: 103,
  /** Where the template prints the college name: centred, white, Times bold 12 pt. */
  collegeBaseline: 89.3,
  collegeSize: 12,
  footerTop: 838,
  tableTop: 124.5,
  tableLeft: 87.4,
  tableRight: 554.9,
  /** The Signature column always keeps at least this much room to sign. */
  signatureMin: 95,
  /** The Name column is never narrower than this, even when every name is short. */
  nameMin: 195,
};

export interface AttendeeSheetRow {
  name: string;
  yearSection: string;
  date: string;
  signature: '';
}

/** Builds the per-section attendance sheets and turns them into a printable PDF. */
@Injectable({ providedIn: 'root' })
export class AttendanceReportService {
  private readonly attendance = inject(AttendanceService);

  /** One sheet per required section, each listing every student in it. */
  buildSections(
    event: SchoolEvent,
    students: Student[],
    records: AttendanceRecord[],
    labelFor: (sectionId: string) => string,
    now: Date = new Date(),
  ): ReportSection[] {
    const ended = isEventOver(event, now);
    const byStudent = new Map(
      records
        .filter((record) => record.eventId === event.id)
        .map((record) => [record.studentId, record]),
    );
    const build = (sectionId: string, label: string, members: Student[]): ReportSection => {
      const sorted = [...members].sort((left, right) => left.name.localeCompare(right.name));
      const rows = sorted.map((student, index): ReportRow => {
        const record = byStudent.get(student.id);
        return {
          no: index + 1,
          studentId: student.id,
          name: student.name,
          status: this.status(record, event, ended),
          timeIn: this.time(record?.timeIn),
          timeOut: this.time(record?.timeOut),
        };
      });
      const count = (status: ReportStatus) => rows.filter((row) => row.status === status).length;
      return {
        sectionId,
        label,
        rows,
        present: count('Present'),
        late: count('Late'),
        absent: count('Absent') + count('Not yet here'),
        excused: count('Excused'),
      };
    };
    // After students move up a year, past events use the roster saved at that time.
    if (event.roster) {
      return Object.entries(event.roster)
        .map(([label, ids]) =>
          build(label, label, students.filter((student) => ids.includes(student.id))),
        )
        .filter((section) => section.rows.length > 0)
        .sort((left, right) => left.label.localeCompare(right.label));
    }
    const sectionIds = event.requiredSections?.length
      ? event.requiredSections
      : [...new Set(students.map((student) => student.sectionId ?? ''))];
    return sectionIds
      .map((sectionId) => {
        const members = students.filter((student) => (student.sectionId ?? '') === sectionId);
        return build(sectionId, members[0]?.section ?? labelFor(sectionId), members);
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  buildAttendeeSheetRows(
    event: SchoolEvent,
    students: Student[],
    sectionLabelFor: (student: Student) => string,
  ): AttendeeSheetRow[] {
    const [year, month, day] = event.date.split('-');
    const date = `${month}/${day}/${year}`;
    return students.map((student) => ({
      name: student.name,
      yearSection: sectionLabelFor(student),
      date,
      signature: '',
    }));
  }

  /**
   * The printable attendee sheet, laid out like the school's template: the college header
   * and footer on every page, and a plain Name / Year & Section / Date / Signature table.
   * The paper is 8.5 x 13 in (612 x 936 pt), the same as the template.
   */
  async createAttendeePdf(
    event: SchoolEvent,
    rows: AttendeeSheetRow[],
    sectionLabel: string,
  ): Promise<{ filename: string; base64: string; blob: Blob }> {
    const sheet = await this.startTemplateSheet();
    // Courses of different colleges do not share a sheet: each college gets its own page(s).
    const byCollege = new Map<string, AttendeeSheetRow[]>();
    for (const row of rows) {
      const college = collegeForCourse(courseOfSection(row.yearSection));
      byCollege.set(college, [...(byCollege.get(college) ?? []), row]);
    }
    if (byCollege.size === 0) byCollege.set(collegeForCourse(''), []);
    let first = true;
    for (const [college, group] of byCollege) {
      if (!first) sheet.newPage();
      first = false;
      sheet.table(
        ['Name', 'Year & Section', 'Date', 'Signature'],
        group.map((row, index) => [`${index + 1}. ${row.name}`, row.yearSection, row.date, row.signature]),
        [1, 1, 1, 1.5],
        { college, title: this.eventTitle(event) },
      );
    }
    return {
      filename: `${this.slug(event.name)}-${this.slug(sectionLabel)}-attendees.pdf`,
      ...sheet.finish(),
    };
  }

  /**
   * The attendance report, in the same template as the attendee sheet: one page (or more,
   * for a long list) per section, with Name, Year & Section (written like BSIT-4A), Date and a
   * blank Signature column. Only the students who attended (present or late) are listed;
   * absent and excused students are not, and a section with nobody present has no page.
   */
  async createPdf(
    event: SchoolEvent,
    sections: ReportSection[],
    // Kept so callers need not change; the template has no "generated at" line.
    _generatedAt: Date = new Date(),
  ): Promise<{ filename: string; base64: string; blob: Blob }> {
    const sheet = await this.startTemplateSheet();
    const [year, month, day] = event.date.split('-');
    const date = `${month}/${day}/${year}`;
    const head = ['Name', 'Year & Section', 'Date', 'Signature'];
    const widths = [1, 1, 1, 1.5];

    const withAttendees = sections
      .map((section) => ({
        section,
        attended: section.rows.filter((row) => row.status === 'Present' || row.status === 'Late'),
      }))
      .filter((item) => item.attended.length > 0);

    withAttendees.forEach(({ section, attended }, index) => {
      if (index > 0) sheet.newPage();
      const yearSection = compactClass({ section: section.label });
      const frame = { college: collegeForCourse(courseOfSection(section.label)), title: this.eventTitle(event) };
      sheet.table(
        head,
        // The numbers count the people listed, not everyone in the section.
        attended.map((row, position) => [`${position + 1}. ${row.name}`, yearSection, date, '']),
        widths,
        frame,
      );
    });
    if (withAttendees.length === 0) {
      sheet.table(
        head,
        [[{ content: 'Nobody has attended this event yet.', colSpan: 4 }]],
        widths,
        { college: collegeForCourse(''), title: this.eventTitle(event) },
      );
    }
    return { filename: `${this.slug(event.name)}-attendance.pdf`, ...sheet.finish() };
  }

  /**
   * A blank sheet in the school's template (header and footer on every page) that tables
   * are drawn on. Used by both the attendance report and the attendee sheet.
   */
  private async startTemplateSheet() {
    // Loaded only when a PDF is requested, so the app starts fast.
    const [{ jsPDF }, { autoTable }, header, footer] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
      this.templateImage('header'),
      this.templateImage('footer'),
    ]);
    const doc = new jsPDF({ unit: 'pt', format: [SHEET.width, SHEET.height] });
    const centre = (SHEET.tableLeft + SHEET.tableRight) / 2;
    const drawFrame = (frame: { college: string; title: string }): void => {
      if (header) doc.addImage(header, 'JPEG', 0, 0, SHEET.width, SHEET.headerHeight);
      if (footer) doc.addImage(footer, 'JPEG', 0, SHEET.footerTop, SHEET.width, SHEET.height - SHEET.footerTop);
      // The college name, on the header bar.
      doc.setFont('times', 'bold');
      doc.setFontSize(SHEET.collegeSize);
      doc.setTextColor(255, 255, 255);
      doc.text(frame.college, SHEET.width / 2, SHEET.collegeBaseline, { align: 'center' });
      // The event title, just above the table (not inside it).
      doc.setTextColor(0, 0, 0);
      // A long title is made a little smaller (down to 9 pt) before it is shortened.
      const room = SHEET.tableRight - SHEET.tableLeft;
      let size = 12;
      doc.setFontSize(size);
      while (size > 9 && doc.getTextWidth(frame.title) > room) {
        size -= 0.5;
        doc.setFontSize(size);
      }
      doc.text(this.fit(doc, frame.title, room), centre, SHEET.tableTop - 9, { align: 'center' });
    };
    const tableWidth = SHEET.tableRight - SHEET.tableLeft;
    return {
      /** Adds a table; column widths are shares of the table's width. */
      table: (
        head: string[],
        body: RowInput[],
        shares: number[],
        frame: { college: string; title: string },
      ): void => {
        // The Name column takes the room the longest name needs (at least SHEET.nameMin). Every
        // other column keeps enough room for its own heading and values, and the Signature
        // column keeps room to sign; whatever is left over is shared out by `shares`.
        const cellText = (cell: unknown): string =>
          typeof cell === 'object' && cell !== null && 'content' in cell
            ? String((cell as { content: unknown }).content)
            : String(cell ?? '');
        const textWidth = (text: string, style: 'normal' | 'bold'): number => {
          doc.setFont('times', style);
          doc.setFontSize(10);
          return doc.getTextWidth(text);
        };
        const longest = Math.max(
          textWidth(head[0], 'bold'),
          ...body.map((row) => (Array.isArray(row) ? textWidth(cellText(row[0]), 'normal') : 0)),
        );
        const needs = head.slice(1).map((heading, index, rest) => {
          const column = index + 1;
          const widest = Math.max(
            textWidth(heading, 'bold'),
            ...body.map((row) =>
              Array.isArray(row) && row.length === head.length ? textWidth(cellText(row[column]), 'normal') : 0,
            ),
          );
          const isLast = index === rest.length - 1;
          return Math.max(widest + 12, isLast ? SHEET.signatureMin : 40);
        });
        const shared = shares.slice(1);
        const sharedTotal = shared.reduce((sum, share) => sum + share, 0);
        const needTotal = needs.reduce((sum, need) => sum + need, 0);
        const nameWidth = Math.min(Math.max(longest + 12, SHEET.nameMin), tableWidth - needTotal);
        const extra = tableWidth - nameWidth - needTotal;
        const widths = [nameWidth, ...needs.map((need, index) => need + (extra * shared[index]) / sharedTotal)];
        autoTable(doc, {
          startY: SHEET.tableTop,
          margin: {
            left: SHEET.tableLeft,
            right: SHEET.width - SHEET.tableRight,
            top: SHEET.tableTop,
            bottom: SHEET.height - SHEET.footerTop + 8,
          },
          head: [head],
          body,
          theme: 'grid',
          styles: {
            font: 'times',
            fontSize: 10,
            textColor: 0,
            lineColor: 0,
            lineWidth: 0.5,
            cellPadding: { top: 2, bottom: 2, left: 5, right: 3 },
            minCellHeight: 13.8,
            valign: 'middle',
          },
          headStyles: { fillColor: false, textColor: 0, fontStyle: 'bold', halign: 'center' },
          columnStyles: Object.fromEntries(
            widths.map((width, index) => [
              index,
              {
                cellWidth: width,
                // The middle columns (Year & Section, Date) are centred; Name stays on the left.
                halign: index > 0 && index < widths.length - 1 ? ('center' as const) : ('left' as const),
              },
            ]),
          ),
          didDrawPage: () => drawFrame(frame),
        });
      },
      /** Starts the next section on a fresh page. */
      newPage: (): void => {
        doc.addPage();
      },
      finish: () => ({
        base64: doc.output('datauristring').split(',')[1] ?? '',
        blob: doc.output('blob'),
      }),
    };
  }

  private readonly templateImages = new Map<string, Promise<string | null>>();

  /** The template's header or footer picture as a data URL, or null if it cannot be loaded. */
  private templateImage(name: 'header' | 'footer'): Promise<string | null> {
    let image = this.templateImages.get(name);
    if (!image) {
      image = fetch(`/assets/pdf/${name}.jpg`)
        .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('missing'))))
        .then(
          (blob) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(blob);
            }),
        )
        .catch(() => {
          this.templateImages.delete(name); // try again next time
          return null;
        });
      this.templateImages.set(name, image);
    }
    return image;
  }

  /** Opens the phone's share sheet (print, save, send) or downloads on the web. */
  async deliver(file: { filename: string; base64: string; blob: Blob }): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      const [{ Filesystem, Directory }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ]);
      await Filesystem.writeFile({
        path: file.filename,
        data: file.base64,
        directory: Directory.Cache,
      });
      const { uri } = await Filesystem.getUri({
        path: file.filename,
        directory: Directory.Cache,
      });
      await Share.share({
        title: file.filename,
        url: uri,
        dialogTitle: 'Print or save the attendance report',
      });
      return;
    }
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private status(
    record: AttendanceRecord | undefined,
    event: SchoolEvent,
    ended: boolean,
  ): ReportStatus {
    if (!record) return ended ? 'Absent' : 'Not yet here';
    const status = this.attendance.statusFor(record, event);
    if (status === 'Excused') return 'Excused';
    if (status === 'Late') return 'Late';
    return 'Present'; // checked in, even if they never checked out
  }

  private time(value: string | null | undefined): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '—'
      : timeOfDay(date);
  }

  private eventTitle(event: SchoolEvent): string {
    return event.cancelled ? `${event.name} (CANCELLED)` : event.name;
  }

  /** Shortens text with "…" until it fits the width. */
  private fit(doc: { getTextWidth(text: string): number }, text: string, max: number): string {
    if (doc.getTextWidth(text) <= max) return text;
    let shortened = text;
    while (shortened.length > 1 && doc.getTextWidth(`${shortened}…`) > max) {
      shortened = shortened.slice(0, -1);
    }
    return `${shortened}…`;
  }

  private slug(value: string): string {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'event'
    );
  }
}
