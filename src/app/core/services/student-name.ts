import { Student } from '../models/school-event.models';

type NameParts = Pick<Student, 'name' | 'firstName' | 'middleName' | 'lastName' | 'extension'>;

/** "Juan Santos Dela Cruz Jr." from its parts: the order used everywhere the plain name shows. */
export function composeFullName(parts: {
  firstName: string;
  middleName: string;
  lastName: string;
  extension?: string;
}): string {
  return [parts.firstName, parts.middleName, parts.lastName, parts.extension]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * The last name used for sorting. Students registered before names were split
 * only have a full name, so the final word is used as a best guess.
 */
export function studentLastName(student: NameParts): string {
  if (student.lastName?.trim()) return student.lastName.trim();
  const words = student.name.trim().split(/\s+/);
  return words[words.length - 1] ?? '';
}

/** "Dela Cruz, Juan Santos Jr." for roster lists. */
export function lastNameFirst(student: NameParts): string {
  if (student.lastName?.trim() && student.firstName?.trim()) {
    const given = [student.firstName, student.middleName]
      .map((part) => (part ?? '').trim())
      .filter(Boolean)
      .join(' ');
    const extension = student.extension?.trim();
    return `${student.lastName.trim()}, ${given}${extension ? ` ${extension}` : ''}`;
  }
  const words = student.name.trim().split(/\s+/);
  if (words.length < 2) return student.name.trim();
  const last = words[words.length - 1];
  return `${last}, ${words.slice(0, -1).join(' ')}`;
}

export interface StudentClassInfo {
  course: string;
  /** "1st Year", "2nd Year"… as stored, or the digit when that is all we know. */
  year: string;
  section: string;
  /** For example "BSIT 4-A". */
  label: string;
}

/** Course, year and section of a student, from either the new or the older stored format. */
export function studentClassInfo(
  student: Pick<Student, 'section' | 'course' | 'yearLevel'>,
): StudentClassInfo {
  const text = (student.section ?? '').trim();
  const words = text.split(/\s+/).filter(Boolean);
  const course = student.course || words[0] || '';
  const digit = (student.yearLevel ?? text).match(/\d/)?.[0] ?? '';
  const section = words.length > 1 ? words[words.length - 1] : (words[0] ?? '');
  const year = digit ? `${digit}${['', 'st', 'nd', 'rd'][Number(digit)] || 'th'} Year` : '';
  const label = digit ? `${course} ${digit}-${section}`.trim() : text || '—';
  return { course, year, section, label };
}

/** Compact class code such as "BSIT-4A". */
export function compactClass(
  student: Pick<Student, 'section' | 'course' | 'yearLevel'>,
): string {
  const info = studentClassInfo(student);
  const year = info.year.match(/\d/)?.[0];
  if (!info.course || !year) return info.label;
  return `${info.course}-${year}${info.section}`;
}

/** Alphabetical by last name, then the rest of the name. */
export function compareByLastName(left: NameParts, right: NameParts): number {
  return (
    studentLastName(left).localeCompare(studentLastName(right), undefined, { sensitivity: 'base' }) ||
    lastNameFirst(left).localeCompare(lastNameFirst(right), undefined, { sensitivity: 'base' })
  );
}

/** The first word of a section or class code ("BSED 2nd Year B", "BSED-2B") is its course. */
export function courseOfSection(text: string): string {
  return (/^[A-Za-z]+/.exec((text ?? '').trim())?.[0] ?? '').toUpperCase();
}

/**
 * The college shown in the header of printed sheets:
 *  - BSED and BEED: College of Education
 *  - BSBA: College of Management and Business Technology
 *  - everything else (BSIT): College of Information and Communications Technology
 */
export function collegeForCourse(course: string): string {
  switch ((course ?? '').toUpperCase()) {
    case 'BSED':
    case 'BEED':
      return 'COLLEGE OF EDUCATION';
    case 'BSBA':
      return 'COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY';
    default:
      return 'COLLEGE OF INFORMATION AND COMMUNICATIONS TECHNOLOGY';
  }
}
