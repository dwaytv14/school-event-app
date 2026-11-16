import { TestBed } from '@angular/core/testing';
import { AttendanceRecord, SchoolEvent, Student } from '../models/school-event.models';
import { AttendanceReportService } from './attendance-report.service';

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
    timeOut: extra.excused ? null : '2030-02-02T11:30:00',
    durationMinutes: null,
    status: 'Present',
    syncStatus: 'Synced',
    ...extra,
  };
}

describe('AttendanceReportService', () => {
  const service = () => TestBed.inject(AttendanceReportService);
  const after = new Date('2030-02-03T09:00:00');

  it('builds one sheet per required section with every student and their status', () => {
    const records = [
      record('PPY-1', '2030-02-02T08:05:00'),
      record('PPY-2', '2030-02-02T08:40:00'),
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
    const during = new Date('2030-02-02T09:00:00');
    const [first] = service().buildSections(event, students, [], (id) => id, during);

    expect(first.rows.every((row) => row.status === 'Not yet here')).toBe(true);
    expect(first.absent).toBe(3);
  });

  it('creates a PDF with one page per section', async () => {
    const sections = service().buildSections(event, students, [], (id) => id, after);

    const file = await service().createPdf(event, sections, after);
    const text = atob(file.base64);

    expect(file.filename).toBe('foundation-day-celebration-attendance.pdf');
    expect(text.startsWith('%PDF')).toBe(true);
    expect((text.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(3);
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
    const sections = service().buildSections(single, many, [], (id) => id, after);

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
