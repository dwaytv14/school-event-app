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
    const end = new Date(`${event.date}T${event.endTime}:00`).getTime();
    const ended = Number.isFinite(end) && now.getTime() >= end;
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

  /** Creates the PDF: one page (or more, if the list is long) per section. */
  async createPdf(
    event: SchoolEvent,
    sections: ReportSection[],
    generatedAt: Date = new Date(),
  ): Promise<{ filename: string; base64: string; blob: Blob }> {
    // Loaded only when a report is requested, so the app starts fast.
    const [{ jsPDF }, { autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const width = doc.internal.pageSize.getWidth();
    const margin = 14;
    const eventLine = `${this.dateLabel(event.date)} · ${event.startTime}–${event.endTime} · ${event.venue}`;

    const header = (sectionLabel: string, summary: string) => {
      doc.setTextColor(20, 35, 79);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      const title = event.cancelled ? `${event.name} (CANCELLED)` : event.name;
      doc.text(this.fit(doc, title, width - margin * 2), margin, 16);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(75, 86, 117);
      doc.text(eventLine, margin, 22);
      doc.setDrawColor(200, 207, 224);
      doc.line(margin, 25, width - margin, 25);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(20, 35, 79);
      doc.text(sectionLabel, margin, 33);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(75, 86, 117);
      doc.text(summary, width - margin, 33, { align: 'right' });
    };

    const colors: Record<ReportStatus, [number, number, number]> = {
      Present: [21, 111, 69],
      Late: [150, 100, 0],
      Absent: [179, 38, 30],
      Excused: [90, 98, 122],
      'Not yet here': [150, 100, 0],
    };

    const pages = sections.length > 0 ? sections : [];
    pages.forEach((section, index) => {
      if (index > 0) doc.addPage();
      const summary = `Total ${section.rows.length} · Present ${section.present} · Late ${section.late} · Absent ${section.absent} · Excused ${section.excused}`;
      header(section.label, summary);
      const startPage = doc.getNumberOfPages();
      autoTable(doc, {
        startY: 38,
        margin: { top: 38, left: margin, right: margin, bottom: 16 },
        head: [['#', 'Student ID', 'Full name', 'Status', 'Time in', 'Time out']],
        body:
          section.rows.length > 0
            ? section.rows.map((row) => [
                String(row.no),
                row.studentId,
                row.name,
                row.status,
                row.timeIn,
                row.timeOut,
              ])
            : [[{ content: 'No students are registered in this section yet.', colSpan: 6 }]],
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2.2, textColor: [20, 35, 79], lineColor: [200, 207, 224] },
        headStyles: { fillColor: [28, 56, 148], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [246, 248, 253] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 30 },
          3: { cellWidth: 26, fontStyle: 'bold' },
          4: { cellWidth: 22, halign: 'center' },
          5: { cellWidth: 22, halign: 'center' },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            const status = String(data.cell.raw) as ReportStatus;
            if (colors[status]) data.cell.styles.textColor = colors[status];
          }
        },
        // A long section continues on the next page with the same heading.
        didDrawPage: (data) => {
          if (data.pageNumber > startPage) {
            header(`${section.label} (continued)`, summary);
          }
        },
      });
    });
    if (pages.length === 0) {
      header('No sections', '');
      doc.setFontSize(11);
      doc.text('This event has no required sections to report on.', margin, 48);
    }

    // Page footers
    const total = doc.getNumberOfPages();
    for (let page = 1; page <= total; page += 1) {
      doc.setPage(page);
      const height = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(120, 128, 150);
      doc.text(
        `Generated ${generatedAt.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`,
        margin,
        height - 8,
      );
      doc.text(`Page ${page} of ${total}`, width - margin, height - 8, { align: 'right' });
    }

    const base64 = doc.output('datauristring').split(',')[1] ?? '';
    return {
      filename: `${this.slug(event.name)}-attendance.pdf`,
      base64,
      blob: doc.output('blob'),
    };
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
      : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  private dateLabel(value: string): string {
    return new Date(`${value}T12:00:00`).toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }

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
