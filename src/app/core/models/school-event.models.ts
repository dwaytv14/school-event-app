export type UserRole = 'student' | 'organizer' | 'super_admin';
export type AttendanceStatus = 'Present' | 'Late' | 'Incomplete' | 'Absent' | 'Excused';
export type SyncStatus = 'Pending sync' | 'Synced';

export interface Student {
  id: string;
  name: string;
  section: string;
  mobile: string;
  course?: string;
  yearLevel?: string;
  sectionId?: string;
}

export interface SeatBlock {
  rows: number;
  seatsPerRow: number;
}

export interface Seat {
  id: string;
  block?: number;
  section: string;
  sectionId?: string;
  row: number;
  number: number;
  studentId: string | null;
}

export interface GymnasiumBenchGroup {
  id: string;
  side: 'left' | 'right';
  number: number;
  sectionId: string | null;
}

export interface EventSeatingPlan {
  gymnasiumBenchGroups: GymnasiumBenchGroup[];
  sharedSeatCount?: number;
  rows?: number;
  seatsPerRow?: number;
  blocks?: SeatBlock[];
  sharedSectionIds?: string[];
  sectionSeatCounts: Record<string, number>;
}

export interface Event {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  description: string;
  graceMinutes: number;
  sections: string[];
  seats: Seat[];
  seatingPlan?: EventSeatingPlan;
  requiredSections?: string[];
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdBy?: string;
  createdByName?: string;
  /** Set when an organizer edits and resubmits their own event. */
  resubmittedAt?: string;
  cancelled?: boolean;
  cancelReason?: string;
  /**
   * Saved when students are promoted to the next year level: section name -> the
   * ids of the students who were required. It keeps past events accurate.
   */
  roster?: Record<string, string[]>;
  /** The original schedule, kept when an event is moved to a new date or time. */
  postponedFrom?: { date: string; startTime: string; endTime: string };
}

export type SchoolEvent = Event;

export interface AttendanceRecord {
  id: string;
  eventId: string;
  studentId: string;
  timeIn: string;
  timeOut: string | null;
  durationMinutes: number | null;
  status: AttendanceStatus;
  syncStatus: SyncStatus;
  /** Added by a person (not a QR scan). */
  manual?: boolean;
  /** An excused absence: there is no check-in time. */
  excused?: boolean;
  /** Stamped by the server: which organizer recorded this entry. */
  recordedBy?: string;
  recordedByName?: string;
}

export interface SeatingViolation {
  id: string;
  eventId: string;
  studentId: string;
  reason: string;
  expectedSeatId: string | null;
  createdAt: string;
}

export interface SmsMessage {
  id: string;
  eventId?: string;
  recipientName: string;
  recipientNumber: string;
  text: string;
  createdAt: string;
  status: 'Queued' | 'Sent';
  syncStatus: SyncStatus;
}

export interface SyncItem {
  id: string;
  kind: 'attendance' | 'sms';
  createdAt: string;
  status: SyncStatus;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  audience?: AnnouncementAudience;
}

export type AnnouncementAudience =
  | { type: 'all' }
  | { type: 'course'; course: string }
  | { type: 'sections'; sectionIds: string[] };

export interface AppState {
  role: UserRole | null;
  studentId: string;
  selectedEventId: string;
  simulatedOffline: boolean;
  students: Student[];
  events: SchoolEvent[];
  attendance: AttendanceRecord[];
  violations: SeatingViolation[];
  messages: SmsMessage[];
  syncItems: SyncItem[];
  announcements: Announcement[];
}
