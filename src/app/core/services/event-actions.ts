import { SchoolEvent, UserRole } from '../models/school-event.models';

/** What the signed-in person may do with one event, decided by status and role. */
export interface EventActions {
  scan: boolean;
  monitor: boolean;
  report: boolean;
  seating: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  reject: boolean;
  cancel: boolean;
  move: boolean;
  reinstate: boolean;
}

const NONE: EventActions = {
  scan: false, monitor: false, report: false, seating: false, edit: false,
  delete: false, approve: false, reject: false, cancel: false, move: false, reinstate: false,
};

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
  return {
    ...NONE,
    scan: true,
    monitor: true,
    report: true,
    seating: true,
    edit: admin,
    cancel: admin,
    move: admin,
    delete: admin && !hasAttendance,
  };
}
