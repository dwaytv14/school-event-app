import { TestBed } from '@angular/core/testing';
import { AttendanceRecord, SchoolEvent, Student } from '../models/school-event.models';
import { AttendanceReportService, ReportSection } from './attendance-report.service';

const event: SchoolEvent = {
  id: 'EVT-1',
  name: 'Foundation Day Celebration',
  date: '2030-02-02',
  startTime: '08:00',
  endTime: '12:00',
  venue: 'Gymnasium',
  description: '',
  graceMinutes: 15,
  sections: [],
  seats: [],
  requiredSections: ['sec-a', 'sec-b', 'sec-empty'],
  approvalStatus: 'approved',
};

const students: Student[] = [
  { id: 'PPY-1', name: 'Zed Reyes', section: 'BSIT 1st Year A', sectionId: 'sec-a', mobile: '1' },
  { id: 'PPY-2', name: 'Ana Cruz', section: 'BSIT 1st Year A', sectionId: 'sec-a', mobile: '2' },
  { id: 'PPY-3', name: 'Ben Lim', section: 'BSIT 1st Year A', sectionId: 'sec-a', mobile: '3' },
  { id: 'PPY-4', name: 'Cy Tan', section: 'BSIT 1st Year B', sectionId: 'sec-b', mobile: '4' },
  { id: 'PPY-5', name: 'Not Required', section: 'BSBA 1st Year A', sectionId: 'sec-x', mobile: '5' },
];

function record(studentId: string, timeIn: string, extra: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: `ATT-${studentId}`,
    eventId: 'EVT-1',
    studentId,
    timeIn,
    timeOut: extra.excused ? null : '2030-02-02T11:30:00+08:00',
    durationMinutes: null,
    status: 'Present',
    syncStatus: 'Synced',
    ...extra,
  };
}

describe('AttendanceReportService', () => {
  const service = () => TestBed.inject(AttendanceReportService);
  const after = new Date('2030-02-03T09:00:00+08:00');

  it('builds one sheet per required section with every student and their status', () => {
    const records = [
      record('PPY-1', '2030-02-02T08:05:00+08:00'),
      record('PPY-2', '2030-02-02T08:40:00+08:00'),
      record('PPY-3', '', { excused: true, status: 'Excused' }),
    ];

    const sections = service().buildSections(event, students, records, (id) => `label-${id}`, after);

    expect(sections.map((s) => s.label)).toEqual([
      'BSIT 1st Year A',
      'BSIT 1st Year B',
      'label-sec-empty',
    ]);
    const a = sections[0];
    expect(a.rows.map((row) => row.name)).toEqual(['Ana Cruz', 'Ben Lim', 'Zed Reyes']);
    expect(a.rows.map((row) => row.status)).toEqual(['Late', 'Excused', 'Present']);
    expect(a).toMatchObject({ present: 1, late: 1, absent: 0, excused: 1 });
    expect(sections[1].rows[0].status).toBe('Absent'); // no record once the event is over
    expect(sections[2].rows).toHaveLength(0);
    expect(sections.flatMap((s) => s.rows.map((row) => row.studentId))).not.toContain('PPY-5');
  });

  it('calls students "Not yet here" while the event is still going', () => {
    const during = new Date('2030-02-02T09:00:00+08:00');
    const [first] = service().buildSections(event, students, [], (id) => id, during);

    expect(first.rows.every((row) => row.status === 'Not yet here')).toBe(true);
    expect(first.absent).toBe(3);
  });

  it('builds attendee print rows with the event date and blank signature cells', () => {
    const rows = service().buildAttendeeSheetRows(
      event,
      [students[0], students[1]],
      () => 'BSIT-1A',
    );

    expect(rows.map((row) => row.name)).toEqual(['Zed Reyes', 'Ana Cruz']);
    expect(rows[0].yearSection).toBe('BSIT-1A');
    expect(rows[0].date).toBe('02/02/2030');
    expect(rows.every((row) => row.signature === '')).toBe(true);
  });

  it('creates a printable attendee sheet PDF', async () => {
    const rows = service().buildAttendeeSheetRows(
      event,
      [students[0]],
      () => 'BSIT-1A',
    );
    const file = await service().createAttendeePdf(event, rows, 'BSIT-1A');

    expect(file.filename).toBe('foundation-day-celebration-bsit-1a-attendees.pdf');
    expect(atob(file.base64).startsWith('%PDF')).toBe(true);
  });

  it('creates a PDF with one page per section that has someone who attended', async () => {
    // Sections A and B each have an attendee; the empty section has nobody, so it gets no page.
    const records = [record('PPY-1', '2030-02-02T08:05:00+08:00'), record('PPY-4', '2030-02-02T08:10:00+08:00')];
    const sections = service().buildSections(event, students, records, (id) => id, after);

    const file = await service().createPdf(event, sections, after);
    const text = atob(file.base64);

    expect(file.filename).toBe('foundation-day-celebration-attendance.pdf');
    expect(text.startsWith('%PDF')).toBe(true);
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(2);
  });

  it('continues a long section onto more pages', async () => {
    const many: Student[] = Array.from({ length: 90 }, (_, index) => ({
      id: `PPY-${index}`,
      name: `Student ${String(index).padStart(3, '0')}`,
      section: 'BSIT 1st Year A',
      sectionId: 'sec-a',
      mobile: String(index),
    }));
    const single = { ...event, requiredSections: ['sec-a'] };
    const everyoneCame = many.map((student) => record(student.id, '2030-02-02T08:05:00+08:00'));
    const sections = service().buildSections(single, many, everyoneCame, (id) => id, after);

    const text = atob((await service().createPdf(single, sections, after)).base64);

    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(2);
  });
  it('lists a past event by the sections students had at the time, even after they moved up', () => {
    const past: SchoolEvent = {
      ...event,
      roster: { 'BSIT 1st Year A': ['PPY-1', 'PPY-2'], 'BSIT 1st Year B': ['PPY-4'] },
    };
    // Everyone has since moved up to 2nd year.
    const moved = students.map((student) => ({
      ...student,
      section: student.section.replace('1st', '2nd'),
      sectionId: `${student.sectionId}-next`,
    }));

    const sections = service().buildSections(past, moved, [], (id) => id, after);

    expect(sections.map((section) => section.label)).toEqual(['BSIT 1st Year A', 'BSIT 1st Year B']);
    expect(sections[0].rows.map((row) => row.name)).toEqual(['Ana Cruz', 'Zed Reyes']);
    expect(sections[1].rows.map((row) => row.name)).toEqual(['Cy Tan']);
  });
});

describe('AttendanceReportService: the event day, not the end time', () => {
  const service = () => TestBed.inject(AttendanceReportService);

  it('keeps students "Not yet here" after the end time on the event day', () => {
    // The event is on 2030-02-02; this is 11 PM that same day.
    const [first] = service().buildSections(
      event, students, [], (id) => id, new Date('2030-02-02T23:00:00+08:00'),
    );
    expect(first.rows.every((row) => row.status === 'Not yet here')).toBe(true);
  });

  it('calls them absent once the event is finished', () => {
    const [first] = service().buildSections(
      { ...event, finishedAt: '2030-02-02T17:00:00+08:00' },
      students, [], (id) => id, new Date('2030-02-02T18:00:00+08:00'),
    );
    expect(first.rows.every((row) => row.status === 'Absent')).toBe(true);
  });
});

describe('the college on printed sheets', () => {
  const service = () => TestBed.inject(AttendanceReportService);
  const section = (label: string): ReportSection => ({
    sectionId: label, label, present: 1, late: 0, absent: 0, excused: 0,
    rows: [{ no: 1, studentId: 'S', name: 'Ana Cruz', status: 'Present', timeIn: '8:05 AM', timeOut: '11:30 AM' }],
  });
  const text = async (labels: string[]) =>
    atob((await service().createPdf(event, labels.map(section))).base64);

  it('uses the college of the course, and the title of the event above the table', async () => {
    expect(await text(['BSIT 4th Year A'])).toContain('COLLEGE OF INFORMATION AND COMMUNICATIONS TECHNOLOGY');
    expect(await text(['BSED 2nd Year B'])).toContain('(COLLEGE OF EDUCATION)');
    expect(await text(['BEED 1st Year A'])).toContain('(COLLEGE OF EDUCATION)');
    expect(await text(['BSBA 3rd Year A'])).toContain('(COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY)');
    expect(await text(['BSIT 4th Year A'])).toContain('(Foundation Day Celebration)');
  });

  it('has the columns Name, Year & Section (like BSIT-4A), Date and a blank Signature', async () => {
    const pdf = await text(['BSIT 4th Year A']);
    for (const heading of ['(Name)', '(Year & Section)', '(Date)', '(Signature)']) expect(pdf).toContain(heading);
    expect(pdf).not.toContain('(Time-IN)');
    expect(pdf).not.toContain('(Status)');
    expect(pdf).toContain('(BSIT-4A)');
    expect(pdf).toContain('(1. Ana Cruz)');
  });

  it('changes the college page by page when a report covers several courses', async () => {
    const pdf = await text(['BSIT 1st Year A', 'BEED 1st Year A', 'BSBA 2nd Year B']);
    expect(pdf).toContain('COLLEGE OF INFORMATION AND COMMUNICATIONS TECHNOLOGY');
    expect(pdf).toContain('(COLLEGE OF EDUCATION)');
    expect(pdf).toContain('COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY');
  });

  it('gives each college its own page on an attendee sheet that mixes courses', async () => {
    const rows = ['BSIT-1A', 'BSED-2B', 'BSBA-3A'].map((yearSection, i) => ({
      name: 'Student ' + i, yearSection, date: '02/02/2030', signature: '' as const,
    }));
    const pdf = atob((await service().createAttendeePdf(event, rows, 'All sections')).base64);
    expect((pdf.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
    expect(pdf).toContain('(COLLEGE OF EDUCATION)');
    expect(pdf).toContain('COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY');
  });
});

describe('who is printed on the attendance report', () => {
  const service = () => TestBed.inject(AttendanceReportService);
  const row = (no: number, name: string, status: 'Present' | 'Late' | 'Absent' | 'Excused' | 'Not yet here') => ({
    no, studentId: 'S' + no, name, status, timeIn: '—', timeOut: '—',
  });
  const pdf = async (sections: ReportSection[]) => atob((await service().createPdf(event, sections)).base64);

  it('lists only the students who attended (present or late), numbered from 1', async () => {
    const text = await pdf([{
      sectionId: 'a', label: 'BSIT 1st Year A', present: 1, late: 1, absent: 1, excused: 1,
      rows: [
        row(1, 'Ana Present', 'Present'), row(2, 'Ben Absent', 'Absent'), row(3, 'Cy Late', 'Late'),
        row(4, 'Di Excused', 'Excused'), row(5, 'Ed NotYet', 'Not yet here'),
      ],
    }]);
    expect(text).toContain('(1. Ana Present)');
    expect(text).toContain('(2. Cy Late)'); // renumbered: the absent student is not counted
    expect(text).not.toContain('Ben Absent');
    expect(text).not.toContain('Di Excused');
    expect(text).not.toContain('Ed NotYet');
  });

  it('skips a section where nobody attended, and says so when nobody did anywhere', async () => {
    const nobody: ReportSection = {
      sectionId: 'a', label: 'BSIT 1st Year A', present: 0, late: 0, absent: 2, excused: 0,
      rows: [row(1, 'Ben Absent', 'Absent'), row(2, 'Di Absent', 'Absent')],
    };
    const text = await pdf([nobody]);
    expect(text).toContain('(Nobody has attended this event yet.)');
    expect(text).not.toContain('Ben Absent');
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(1);
  });
});
