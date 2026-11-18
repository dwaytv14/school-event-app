import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppState, AttendanceRecord, UserRole } from '../models/school-event.models';

const API_URL_STORAGE_KEY = 'school-event-api-url-v2';

export interface WorkspaceSnapshot {
  revision: number;
  state: Pick<
    AppState,
    | 'students'
    | 'events'
    | 'attendance'
    | 'violations'
    | 'messages'
    | 'syncItems'
    | 'announcements'
  >;
}

/** One step of the attendance sync: what changed on the server after the app's cursor. */
export interface AttendancePage {
  cursor: number;
  records: AttendanceRecord[];
  removed: string[];
  more: boolean;
  reset: boolean;
}

export interface AttendancePushResult {
  /** Records the server refused (for example a check-in outside the event day). */
  dropped: string[];
  /** Records the server adjusted (for example closed because the event was finished). */
  records: AttendanceRecord[];
}

export interface AuthenticationResponse {
  token: string;
  id?: string;
  username: string;
  role: UserRole;
  studentId: string | null;
  avatar?: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorName: string;
  actorRole: string;
  action: string;
  summary: string;
}

export interface PromotionPreview {
  steps: { from: string; to: string | null; students: number }[];
  graduating: number;
  promoting: number;
  skipped: number;
  newSections: number;
}

export interface SchoolYearSettings {
  endDate: string | null;
  enabled: boolean;
  lastPromotedFor: string | null;
  available: boolean;
  today: string;
  preview: PromotionPreview | null;
}

export type ExcuseStatus = 'pending' | 'approved' | 'rejected';

export interface ExcuseRequest {
  id: string;
  eventId: string;
  eventName: string;
  studentId: string;
  studentName: string;
  section: string;
  reason: string;
  status: ExcuseStatus;
  reviewerNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  hasPhoto: boolean;
  photo?: string | null;
}

export interface WorkspaceAccount {
  id?: string;
  disabled?: boolean;
  username: string;
  role: UserRole;
  studentId: string | null;
  createdAt: string;
}

export interface SchoolSection {
  id: string;
  course: string;
  yearLevel: string;
  name: string;
}

export interface StudentRegistration {
  studentNumber: string;
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  extension?: string;
  course: string;
  yearLevel: string;
  section: string;
  sectionId?: string;
  mobile: string;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceApiService {
  private readonly http = inject(HttpClient);
  readonly defaultBaseUrl = environment.apiBaseUrl;
  readonly baseUrl = signal(
    (localStorage.getItem(API_URL_STORAGE_KEY) || environment.apiBaseUrl)
      .replace(/\/+$/, ''),
  );

  setBaseUrl(value: string): void {
    const baseUrl = value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/]+(?:\/[^/]+)*\/api$/i.test(baseUrl)) {
      throw new Error('Enter the full API address ending in /api.');
    }
    this.baseUrl.set(baseUrl);
    localStorage.setItem(API_URL_STORAGE_KEY, baseUrl);
  }

  register(
    username: string,
    password: string,
    student: StudentRegistration,
  ): Promise<AuthenticationResponse> {
    return firstValueFrom(
      this.http.post<AuthenticationResponse>(`${this.baseUrl()}/auth/register`, {
        username,
        password,
        ...student,
      }),
    );
  }

  login(username: string, password: string): Promise<AuthenticationResponse> {
    return firstValueFrom(
      this.http.post<AuthenticationResponse>(`${this.baseUrl()}/auth/login`, {
        username,
        password,
      }),
    );
  }

  async checkHealth(): Promise<void> {
    const health = await firstValueFrom(
      this.http.get<{ status?: unknown }>(`${this.baseUrl()}/health`),
    );
    if (health.status !== 'ok') {
      throw new Error('The shared server responded, but its health check failed.');
    }
  }

  currentUser(token: string): Promise<Omit<AuthenticationResponse, 'token'>> {
    return firstValueFrom(
      this.http.get<Omit<AuthenticationResponse, 'token'>>(
        `${this.baseUrl()}/auth/me`,
        { headers: this.authorization(token) },
      ),
    );
  }

  loadWorkspace(token: string): Promise<WorkspaceSnapshot> {
    return firstValueFrom(
      this.http.get<WorkspaceSnapshot>(`${this.baseUrl()}/workspace?attendance=separate`, {
        headers: this.authorization(token),
      }),
    );
  }

  loadAttendance(token: string, after: number): Promise<AttendancePage> {
    return firstValueFrom(
      this.http.get<AttendancePage>(`${this.baseUrl()}/attendance?after=${after}`, {
        headers: this.authorization(token),
      }),
    );
  }

  saveAttendance(
    token: string,
    body: { records: AttendanceRecord[]; removed: string[] },
  ): Promise<AttendancePushResult> {
    return firstValueFrom(
      this.http.put<AttendancePushResult>(`${this.baseUrl()}/attendance`, body, {
        headers: this.authorization(token),
      }),
    );
  }

  saveWorkspace(
    token: string,
    snapshot: WorkspaceSnapshot,
  ): Promise<{ revision: number; refresh?: boolean }> {
    return firstValueFrom(
      this.http.put<{ revision: number; refresh?: boolean }>(
        `${this.baseUrl()}/workspace?attendance=separate`,
        // Attendance has its own sync; it never goes inside the workspace.
        { ...snapshot, state: { ...snapshot.state, attendance: [] } },
        { headers: this.authorization(token) },
      ),
    );
  }

  requestContactChange(
    token: string,
    mobile: string,
    currentPassword: string,
  ): Promise<{ code: string; mobile: string; expiresInSeconds: number }> {
    return firstValueFrom(
      this.http.post<{ code: string; mobile: string; expiresInSeconds: number }>(
        `${this.baseUrl()}/account/contact/request`,
        { mobile, currentPassword },
        { headers: this.authorization(token) },
      ),
    );
  }

  confirmContactChange(token: string, code: string): Promise<{ mobile: string }> {
    return firstValueFrom(
      this.http.post<{ mobile: string }>(
        `${this.baseUrl()}/account/contact/confirm`,
        { code },
        { headers: this.authorization(token) },
      ),
    );
  }

  changePassword(
    token: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthenticationResponse> {
    return firstValueFrom(
      this.http.post<AuthenticationResponse>(
        `${this.baseUrl()}/account/password`,
        { currentPassword, newPassword },
        { headers: this.authorization(token) },
      ),
    );
  }

  changeUsername(
    token: string,
    currentPassword: string,
    username: string,
  ): Promise<AuthenticationResponse> {
    return firstValueFrom(
      this.http.post<AuthenticationResponse>(
        `${this.baseUrl()}/account/username`,
        { currentPassword, username },
        { headers: this.authorization(token) },
      ),
    );
  }

  getSchoolYear(token: string): Promise<SchoolYearSettings> {
    return firstValueFrom(
      this.http.get<SchoolYearSettings>(`${this.baseUrl()}/admin/school-year`, {
        headers: this.authorization(token),
      }),
    );
  }

  saveSchoolYear(
    token: string,
    settings: { enabled: boolean; endDate: string | null },
  ): Promise<SchoolYearSettings> {
    return firstValueFrom(
      this.http.put<SchoolYearSettings>(`${this.baseUrl()}/admin/school-year`, settings, {
        headers: this.authorization(token),
      }),
    );
  }

  setAccountDisabled(
    token: string,
    username: string,
    disabled: boolean,
  ): Promise<{ username: string; disabled: boolean }> {
    return firstValueFrom(
      this.http.post<{ username: string; disabled: boolean }>(
        `${this.baseUrl()}/admin/users/${encodeURIComponent(username)}/disabled`,
        { disabled },
        { headers: this.authorization(token) },
      ),
    );
  }

  deleteAccount(token: string, username: string): Promise<{ deleted: boolean }> {
    return firstValueFrom(
      this.http.delete<{ deleted: boolean }>(
        `${this.baseUrl()}/admin/users/${encodeURIComponent(username)}`,
        { headers: this.authorization(token) },
      ),
    );
  }

  deleteEvent(token: string, eventId: string): Promise<{ deleted: boolean }> {
    return firstValueFrom(
      this.http.delete<{ deleted: boolean }>(
        `${this.baseUrl()}/events/${encodeURIComponent(eventId)}`,
        { headers: this.authorization(token) },
      ),
    );
  }

  auditLog(
    token: string,
    before?: string,
  ): Promise<{ entries: AuditEntry[]; next: string | null }> {
    const query = before ? `&before=${encodeURIComponent(before)}` : '';
    return firstValueFrom(
      this.http.get<{ entries: AuditEntry[]; next: string | null }>(
        `${this.baseUrl()}/admin/audit?limit=50${query}`,
        { headers: this.authorization(token) },
      ),
    );
  }

  createExcuse(
    token: string,
    request: { eventId: string; reason: string; photo: string | null },
  ): Promise<{ id: string; status: ExcuseStatus }> {
    return firstValueFrom(
      this.http.post<{ id: string; status: ExcuseStatus }>(
        `${this.baseUrl()}/excuses`,
        request,
        { headers: this.authorization(token) },
      ),
    );
  }

  myExcuses(token: string): Promise<{ excuses: ExcuseRequest[] }> {
    return firstValueFrom(
      this.http.get<{ excuses: ExcuseRequest[] }>(`${this.baseUrl()}/excuses/mine`, {
        headers: this.authorization(token),
      }),
    );
  }

  listExcuses(
    token: string,
    status?: ExcuseStatus,
  ): Promise<{ excuses: ExcuseRequest[]; pending: number }> {
    const query = status ? `?status=${status}` : '';
    return firstValueFrom(
      this.http.get<{ excuses: ExcuseRequest[]; pending: number }>(
        `${this.baseUrl()}/excuses${query}`,
        { headers: this.authorization(token) },
      ),
    );
  }

  getExcuse(token: string, id: string): Promise<ExcuseRequest> {
    return firstValueFrom(
      this.http.get<ExcuseRequest>(`${this.baseUrl()}/excuses/${encodeURIComponent(id)}`, {
        headers: this.authorization(token),
      }),
    );
  }

  withdrawExcuse(token: string, id: string): Promise<{ withdrawn: boolean }> {
    return firstValueFrom(
      this.http.delete<{ withdrawn: boolean }>(
        `${this.baseUrl()}/excuses/${encodeURIComponent(id)}`,
        { headers: this.authorization(token) },
      ),
    );
  }

  reviewExcuse(
    token: string,
    id: string,
    decision: 'approved' | 'rejected',
    note: string,
  ): Promise<ExcuseRequest> {
    return firstValueFrom(
      this.http.post<ExcuseRequest>(
        `${this.baseUrl()}/excuses/${encodeURIComponent(id)}/review`,
        { decision, note },
        { headers: this.authorization(token) },
      ),
    );
  }

  saveAvatar(token: string, image: string): Promise<{ avatar: string | null }> {
    return firstValueFrom(
      this.http.put<{ avatar: string | null }>(
        `${this.baseUrl()}/profile/avatar`,
        { image },
        { headers: this.authorization(token) },
      ),
    );
  }

  removeAvatar(token: string): Promise<{ avatar: string | null }> {
    return firstValueFrom(
      this.http.delete<{ avatar: string | null }>(
        `${this.baseUrl()}/profile/avatar`,
        { headers: this.authorization(token) },
      ),
    );
  }

  studentAvatar(token: string, studentId: string): Promise<{ avatar: string | null }> {
    return firstValueFrom(
      this.http.get<{ avatar: string | null }>(
        `${this.baseUrl()}/students/${encodeURIComponent(studentId)}/avatar`,
        { headers: this.authorization(token) },
      ),
    );
  }

  listAccounts(token: string): Promise<{ accounts: WorkspaceAccount[] }> {
    return firstValueFrom(
      this.http.get<{ accounts: WorkspaceAccount[] }>(
        `${this.baseUrl()}/accounts`,
        { headers: this.authorization(token) },
      ),
    );
  }

  listSections(token?: string): Promise<{ sections: SchoolSection[] }> {
    return firstValueFrom(
      this.http.get<{ sections: SchoolSection[] }>(`${this.baseUrl()}/sections`, {
        headers: token ? this.authorization(token) : undefined,
      }),
    );
  }

  createSection(
    token: string,
    section: Omit<SchoolSection, 'id'>,
  ): Promise<SchoolSection> {
    return firstValueFrom(
      this.http.post<SchoolSection>(`${this.baseUrl()}/sections`, section, {
        headers: this.authorization(token),
      }),
    );
  }

  updateSection(
    token: string,
    id: string,
    section: Omit<SchoolSection, 'id'>,
  ): Promise<SchoolSection> {
    return firstValueFrom(
      this.http.put<SchoolSection>(
        `${this.baseUrl()}/sections/${encodeURIComponent(id)}`,
        section,
        { headers: this.authorization(token) },
      ),
    );
  }

  createAccount(
    token: string,
    account: {
      username: string;
      password: string;
    },
  ): Promise<Omit<WorkspaceAccount, 'createdAt'>> {
    return firstValueFrom(
      this.http.post<Omit<WorkspaceAccount, 'createdAt'>>(
        `${this.baseUrl()}/accounts`,
        account,
        { headers: this.authorization(token) },
      ),
    );
  }

  resetAccountPassword(
    token: string,
    username: string,
    password: string,
  ): Promise<{ username: string; passwordReset: boolean }> {
    return firstValueFrom(
      this.http.post<{ username: string; passwordReset: boolean }>(
        `${this.baseUrl()}/accounts/${encodeURIComponent(username)}/password`,
        { password },
        { headers: this.authorization(token) },
      ),
    );
  }

  resetSharedWorkspace(token: string): Promise<{ revision: number }> {
    return firstValueFrom(
      this.http.delete<{ revision: number }>(`${this.baseUrl()}/admin/reset`, {
        headers: this.authorization(token),
      }),
    );
  }

  errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = this.parseErrorBody(error.error);
      const serverMessage = body?.['error'] ?? body?.['message'];
      if (typeof serverMessage === 'string') return serverMessage;
      if (error.status === 0) {
        return `Cannot reach ${this.baseUrl()}. Check the Cloudflare Workers API URL and your internet connection.`;
      }
      if (error.status > 0) {
        return `The shared server returned HTTP ${error.status}${error.statusText ? ` (${error.statusText})` : ''}.`;
      }
    }
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (typeof error === 'object' && error !== null) {
      try {
        const details = JSON.stringify(error);
        if (details && details !== '{}') return `Request failed: ${details}`;
      } catch {
        return 'The request failed with an unreadable error response.';
      }
    }
    return 'The request failed for an unknown reason.';
  }

  private parseErrorBody(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null
          ? (parsed as Record<string, unknown>)
          : null;
      } catch {
        return value.trim() ? { error: value } : null;
      }
    }
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : null;
  }

  isConflict(error: unknown): error is HttpErrorResponse {
    return error instanceof HttpErrorResponse && error.status === 409;
  }

  conflictSnapshot(error: unknown): WorkspaceSnapshot | undefined {
    if (!this.isConflict(error)) return undefined;
    const body = error.error as Partial<WorkspaceSnapshot>;
    if (
      typeof body.revision !== 'number' ||
      typeof body.state !== 'object' ||
      body.state === null
    ) {
      return undefined;
    }
    return body as WorkspaceSnapshot;
  }

  private authorization(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
