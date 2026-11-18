import { describe, expect, it } from 'vitest';
import {
  compareByLastName,
  composeFullName,
  lastNameFirst,
  studentClassInfo,
} from './student-name';

describe('student names', () => {
  it('joins the parts and skips an empty extension', () => {
    expect(
      composeFullName({ firstName: 'Juan', middleName: 'Santos', lastName: 'Dela Cruz' }),
    ).toBe('Juan Santos Dela Cruz');
    expect(
      composeFullName({ firstName: 'Juan', middleName: 'Santos', lastName: 'Cruz', extension: 'Jr.' }),
    ).toBe('Juan Santos Cruz Jr.');
  });

  it('shows last name first, using the parts when saved', () => {
    expect(
      lastNameFirst({
        name: 'Juan Santos Dela Cruz Jr.',
        firstName: 'Juan',
        middleName: 'Santos',
        lastName: 'Dela Cruz',
        extension: 'Jr.',
      }),
    ).toBe('Dela Cruz, Juan Santos Jr.');
  });

  it('guesses the last word as the last name for older records', () => {
    expect(lastNameFirst({ name: 'Marvin Pascual' })).toBe('Pascual, Marvin');
  });

  it('sorts alphabetically by last name', () => {
    const students = [
      { name: 'Marvin Pascual' },
      { name: 'Gabriel Flores' },
      { name: 'Ana Reyes', lastName: 'Aquino', firstName: 'Ana', middleName: 'R' },
    ];
    expect(students.sort(compareByLastName).map((s) => s.name)).toEqual([
      'Ana Reyes',
      'Gabriel Flores',
      'Marvin Pascual',
    ]);
  });

  it('reads course, year and section from the stored section label', () => {
    expect(studentClassInfo({ section: 'BSIT 4th Year A' })).toEqual({
      course: 'BSIT',
      year: '4th Year',
      section: 'A',
      label: 'BSIT 4-A',
    });
    expect(
      studentClassInfo({ section: 'BSBA 1st Year B', course: 'BSBA', yearLevel: '1st Year' }).label,
    ).toBe('BSBA 1-B');
  });
});

describe('compactClass', () => {
  it('writes the class as BSIT-4A', async () => {
    const { compactClass } = await import('./student-name');
    expect(compactClass({ section: 'BSIT 4th Year A', course: 'BSIT', yearLevel: '4th Year' })).toBe('BSIT-4A');
    expect(compactClass({ section: 'BSBA 1st Year B' })).toBe('BSBA-1B');
  });
});


describe('college of a course', () => {
  it('maps courses to the college printed on sheets', async () => {
    const { collegeForCourse, courseOfSection } = await import('./student-name');
    expect(collegeForCourse('BSIT')).toBe('COLLEGE OF INFORMATION AND COMMUNICATIONS TECHNOLOGY');
    expect(collegeForCourse('BSED')).toBe('COLLEGE OF EDUCATION');
    expect(collegeForCourse('BEED')).toBe('COLLEGE OF EDUCATION');
    expect(collegeForCourse('BSBA')).toBe('COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY');
    expect(collegeForCourse('bsba')).toBe('COLLEGE OF MANAGEMENT AND BUSINESS TECHNOLOGY');
    expect(courseOfSection('BSED 2nd Year B')).toBe('BSED');
    expect(courseOfSection('beed-1a')).toBe('BEED');
  });
});
