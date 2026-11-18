import { ScanResult } from '../core/services/attendance.service';
import { Student } from '../core/models/school-event.models';

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
  time: string;
}
