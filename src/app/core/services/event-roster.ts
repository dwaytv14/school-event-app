import { SchoolEvent } from '../models/school-event.models';

/**
 * Whether a student was required at an event. Past events keep a saved roster
 * (so moving students to the next year never rewrites history); other events
 * use the student's current section.
 */
export function isStudentRequired(
  event: SchoolEvent,
  student: { id: string; sectionId?: string },
): boolean {
  if (event.roster) {
    return Object.values(event.roster).some((ids) => ids.includes(student.id));
  }
  return !!student.sectionId && (event.requiredSections ?? []).includes(student.sectionId);
}
