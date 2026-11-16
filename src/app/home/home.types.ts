import { ScanResult } from '../core/services/attendance.service';
import { EventSeatingPlan, Seat, Student } from '../core/models/school-event.models';

export interface MonitorState {
  key: 'Here' | 'Out' | 'Excused' | 'Not yet';
  label: string;
  color: string;
  late: boolean;
}

export interface TabItem {
  screen: string;
  icon: string;
  label: string;
  badge?: number;
  scan?: boolean;
}

export interface DisplayScan extends ScanResult {
  student?: Student;
  seat?: Seat;
  seatLocation?: string;
  time: string;
}

export function emptySeatingPlan(): EventSeatingPlan {
  return {
    gymnasiumBenchGroups: [],
    sharedSeatCount: 0,
    rows: 0,
    seatsPerRow: 10,
    blocks: [{ rows: 0, seatsPerRow: 10 }],
    sharedSectionIds: [],
    sectionSeatCounts: {},
  };
}
