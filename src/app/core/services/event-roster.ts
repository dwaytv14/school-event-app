import { SchoolEvent } from '../models/school-event.models';

/**
 * Whether a student was required at an event. Past events keep a saved roster
 * (so moving students to the next year never rewrites history); other events
 * use the student's current section.
 */
export function isStudentRequired(
  event: SchoolEvent,
  student: { id: string; sectionId?: string; section?: string },
): boolean {
  if (event.roster) {
    return Object.values(event.roster).some((ids) => ids.includes(student.id));
  }
  const requiredSections = event.requiredSections ?? [];
  return (
    (!!student.sectionId && requiredSections.includes(student.sectionId)) ||
    event.sections.includes(student.section ?? '')
  );
}
