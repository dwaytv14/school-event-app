import { SchoolEvent, UserRole } from '../models/school-event.models';
import { schoolDateKey } from './time-format';

/** What the signed-in person may do with one event, decided by status and role. */
export interface EventActions {
  scan: boolean;
  monitor: boolean;
  report: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  reinstate: boolean;
  /** End the event now and check everyone out (super admin, on the event day). */
  finish: boolean;
}

const NONE: EventActions = {
  scan: false, monitor: false, report: false, edit: false,
  delete: false, approve: false, reject: false, cancel: false, reinstate: false,
  finish: false,
};

/**
 * An event is over once its day has passed (the next calendar day), whatever
 * its end time says: events often run overtime.
 */
export function isEventOver(event: SchoolEvent, now: Date = new Date()): boolean {
  return !!event.finishedAt || (!!event.date && event.date < localDateKey(now));
}

/** The event day is here and the admin has not finished the event yet. */
export function canFinishEvent(event: SchoolEvent, now: Date = new Date()): boolean {
  return !event.finishedAt && event.date === localDateKey(now);
}

/** An event has not started until its day arrives. */
export function isEventUpcoming(event: SchoolEvent, now: Date = new Date()): boolean {
  return !!event.date && event.date > localDateKey(now);
}

function localDateKey(now: Date): string {
  return schoolDateKey(now);
}

export function eventActions(
  event: SchoolEvent | undefined | null,
  role: UserRole | null | undefined,
  userId: string | null | undefined,
  hasAttendance: boolean,
): EventActions {
  if (!event || (role !== 'super_admin' && role !== 'organizer')) return { ...NONE };
  const admin = role === 'super_admin';
  const owner = role === 'organizer' && !!userId && event.createdBy === userId;
  const status = event.approvalStatus ?? 'approved';

  if (status === 'pending') {
    return { ...NONE, edit: admin || owner, delete: admin || owner, approve: admin, reject: admin };
  }
  if (status === 'rejected') {
    return { ...NONE, edit: admin || owner, delete: admin || owner };
  }
  if (event.cancelled) {
    return { ...NONE, reinstate: admin, delete: admin && !hasAttendance };
  }
  if (isEventOver(event)) {
    // Finished events are read-only: only the report and delete remain.
    return {
      ...NONE,
      report: true,
      delete: admin && !hasAttendance,
    };
  }
  return {
    ...NONE,
    // Scanning opens on the event day.
    scan: !isEventUpcoming(event),
    // Live attendance and the report open when the event starts (its day).
    finish: admin && canFinishEvent(event),
    monitor: !isEventUpcoming(event),
    report: !isEventUpcoming(event),
    edit: admin,
    cancel: admin,
    delete: admin && !hasAttendance,
  };
}
