export type UserRole = 'student' | 'organizer' | 'super_admin';
export type AttendanceStatus = 'Present' | 'Late' | 'Incomplete' | 'Absent';
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

export interface Seat {
  id: string;
  section: string;
  row: number;
  number: number;
  studentId: string | null;
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
  requiredSections?: string[];
  approvalStatus?: 'pending' | 'approved';
  createdBy?: string;
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
