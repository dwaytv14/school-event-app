import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppState, UserRole } from '../models/school-event.models';

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

export interface AuthenticationResponse {
  token: string;
  username: string;
  role: UserRole;
  studentId: string | null;
}

export interface WorkspaceAccount {
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
  name: string;
  course: string;
  yearLevel: string;
  sectionId: string;
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
      this.http.get<WorkspaceSnapshot>(`${this.baseUrl()}/workspace`, {
        headers: this.authorization(token),
      }),
    );
  }

  saveWorkspace(
    token: string,
    snapshot: WorkspaceSnapshot,
  ): Promise<{ revision: number }> {
    return firstValueFrom(
      this.http.put<{ revision: number }>(
        `${this.baseUrl()}/workspace`,
        snapshot,
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
