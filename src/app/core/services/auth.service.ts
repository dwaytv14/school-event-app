import { inject, Injectable, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { UserRole } from '../models/school-event.models';
import {
  AuthenticationResponse,
  StudentRegistration,
  WorkspaceApiService,
} from './workspace-api.service';
import { DeviceStateService } from './device-state.service';

const TOKEN_KEY = 'school-event-auth-token-v1';
const USERNAME_KEY = 'school-event-auth-username-v1';
const ROLE_KEY = 'school-event-auth-role-v1';
const STUDENT_ID_KEY = 'school-event-auth-student-id-v1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(WorkspaceApiService);
  private readonly device = inject(DeviceStateService);
  readonly authenticated = signal(false);
  readonly username = signal('');
  readonly role = signal<UserRole | null>(null);
  readonly studentId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly offline = signal(false);

  private token = '';

  async initialize(): Promise<void> {
    const token = localStorage.getItem(TOKEN_KEY);
    const savedUsername = localStorage.getItem(USERNAME_KEY);
    const savedRole = localStorage.getItem(ROLE_KEY);
    if (!token || !savedUsername) return;

    this.token = token;
    this.username.set(savedUsername);
    if (
      savedRole === 'organizer' ||
      savedRole === 'student' ||
      savedRole === 'super_admin'
    ) {
      this.role.set(savedRole);
    }
    this.studentId.set(localStorage.getItem(STUDENT_ID_KEY));
    try {
      const user = await this.api.currentUser(token);
      this.setIdentity(user);
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        this.signOut();
        return;
      }
      if (error instanceof HttpErrorResponse && error.status === 0) {
        const cached = await this.device.load(savedUsername);
        if (this.role() && cached) {
          this.authenticated.set(true);
          this.offline.set(true);
        } else {
          this.signOut();
          this.error.set('Internet is required for your first login.');
        }
      } else {
        this.error.set(this.api.errorMessage(error));
      }
    }
  }

  async login(username: string, password: string): Promise<void> {
    await this.authenticate(() => this.api.login(username, password), true);
  }

  async register(
    username: string,
    password: string,
    student: StudentRegistration,
  ): Promise<void> {
    await this.authenticate(
      () => this.api.register(username, password, student),
      true,
      'Internet is required to create an account.',
    );
  }

  getToken(): string {
    return this.token;
  }

  hasSavedSession(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  signOut(): void {
    this.token = '';
    this.username.set('');
    this.role.set(null);
    this.studentId.set(null);
    this.authenticated.set(false);
    this.offline.set(false);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(STUDENT_ID_KEY);
  }

  private async authenticate(
    request: () => Promise<AuthenticationResponse>,
    firstLogin = false,
    offlineMessage = 'Internet is required for your first login.',
  ): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.offline.set(false);
    try {
      const result = await request();
      this.token = result.token;
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USERNAME_KEY, result.username);
      this.setIdentity(result);
    } catch (error) {
      const message =
        firstLogin &&
        error instanceof HttpErrorResponse &&
        error.status === 0
          ? offlineMessage
          : this.api.errorMessage(error);
      this.error.set(message);
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  private setIdentity(user: Omit<AuthenticationResponse, 'token'>): void {
    this.username.set(user.username);
    this.role.set(user.role);
    this.studentId.set(user.studentId);
    this.authenticated.set(true);
    this.offline.set(false);
    localStorage.setItem(USERNAME_KEY, user.username);
    localStorage.setItem(ROLE_KEY, user.role);
    if (user.studentId) {
      localStorage.setItem(STUDENT_ID_KEY, user.studentId);
    } else {
      localStorage.removeItem(STUDENT_ID_KEY);
    }
  }
}
