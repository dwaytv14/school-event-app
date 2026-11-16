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
const REMEMBER_KEY = 'school-event-auth-remember-v1';
const LAST_USERNAME_KEY = 'school-event-last-username-v1';
const AVATAR_KEY_PREFIX = 'school-event-avatar-v1:';
const USER_ID_KEY = 'school-event-auth-user-id-v1';
const SESSION_KEYS = [TOKEN_KEY, USERNAME_KEY, ROLE_KEY, STUDENT_ID_KEY, USER_ID_KEY];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(WorkspaceApiService);
  private readonly device = inject(DeviceStateService);
  readonly authenticated = signal(false);
  readonly username = signal('');
  readonly role = signal<UserRole | null>(null);
  readonly studentId = signal<string | null>(null);
  /** The account's id, used to tell which events this organizer created. */
  readonly userId = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly offline = signal(false);
  /** The signed-in user's profile picture (a small data URL), if they set one. */
  readonly avatar = signal<string | null>(null);

  private token = '';
  /**
   * True: the session is kept on the device and survives closing the app.
   * False: it lives only while the app is open (sessionStorage), so closing
   * the app signs the user out. Older installs have no flag and keep their
   * existing signed-in session.
   */
  private remember = localStorage.getItem(REMEMBER_KEY) !== '0';

  /** The username from the last "keep me signed in" login. */
  lastUsername(): string {
    return localStorage.getItem(LAST_USERNAME_KEY) ?? '';
  }

  /** Whether the checkbox was ticked last time. */
  rememberPreference(): boolean {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  }

  private store(): Storage {
    return this.remember ? localStorage : sessionStorage;
  }

  async initialize(): Promise<void> {
    this.remember = localStorage.getItem(REMEMBER_KEY) !== '0';
    const storage = this.store();
    const token = storage.getItem(TOKEN_KEY);
    const savedUsername = storage.getItem(USERNAME_KEY);
    const savedRole = storage.getItem(ROLE_KEY);
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
    this.studentId.set(storage.getItem(STUDENT_ID_KEY));
    this.userId.set(storage.getItem(USER_ID_KEY));
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

  async login(
    username: string,
    password: string,
    keepSignedIn = false,
  ): Promise<void> {
    await this.authenticate(
      () => this.api.login(username, password),
      true,
      undefined,
      keepSignedIn,
    );
  }

  async register(
    username: string,
    password: string,
    student: StudentRegistration,
    keepSignedIn = false,
  ): Promise<void> {
    await this.authenticate(
      () => this.api.register(username, password, student),
      true,
      'Internet is required to create an account.',
      keepSignedIn,
    );
  }

  /** Takes over a fresh session returned after a password or username change. */
  applySession(result: AuthenticationResponse): void {
    this.token = result.token;
    this.store().setItem(TOKEN_KEY, result.token);
    this.store().setItem(USERNAME_KEY, result.username);
    if (this.rememberPreference()) {
      localStorage.setItem(LAST_USERNAME_KEY, result.username);
    }
    this.setIdentity(result);
  }

  getToken(): string {
    return this.token;
  }

  hasSavedSession(): boolean {
    return !!this.store().getItem(TOKEN_KEY);
  }

  signOut(): void {
    this.token = '';
    this.username.set('');
    this.role.set(null);
    this.studentId.set(null);
    this.userId.set(null);
    this.authenticated.set(false);
    this.offline.set(false);
    // The saved username and checkbox choice stay, so the sign-in form can
    // be pre-filled after a manual sign out.
    for (const key of SESSION_KEYS) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }
  }

  private async authenticate(
    request: () => Promise<AuthenticationResponse>,
    firstLogin = false,
    offlineMessage = 'Internet is required for your first login.',
    keepSignedIn = false,
  ): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.offline.set(false);
    try {
      const result = await request();
      this.token = result.token;
      this.remember = keepSignedIn;
      localStorage.setItem(REMEMBER_KEY, keepSignedIn ? '1' : '0');
      if (keepSignedIn) {
        localStorage.setItem(LAST_USERNAME_KEY, result.username);
      } else {
        localStorage.removeItem(LAST_USERNAME_KEY);
      }
      // Keep the session in exactly one place.
      const other = keepSignedIn ? sessionStorage : localStorage;
      for (const key of SESSION_KEYS) other.removeItem(key);
      this.store().setItem(TOKEN_KEY, result.token);
      this.store().setItem(USERNAME_KEY, result.username);
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

  /** Updates the picture and keeps a copy so it still shows offline. */
  setAvatar(avatar: string | null): void {
    this.avatar.set(avatar);
    const key = AVATAR_KEY_PREFIX + this.username().toLowerCase();
    try {
      if (avatar) localStorage.setItem(key, avatar);
      else localStorage.removeItem(key);
    } catch {
      // The picture is a convenience; storage may be full.
    }
  }

  private setIdentity(user: Omit<AuthenticationResponse, 'token'>): void {
    this.username.set(user.username);
    if (user.avatar !== undefined) {
      this.setAvatar(user.avatar);
    } else {
      this.avatar.set(
        localStorage.getItem(AVATAR_KEY_PREFIX + user.username.toLowerCase()),
      );
    }
    this.role.set(user.role);
    this.studentId.set(user.studentId);
    this.authenticated.set(true);
    this.offline.set(false);
    const storage = this.store();
    if (user.id) {
      this.userId.set(user.id);
      storage.setItem(USER_ID_KEY, user.id);
    }
    storage.setItem(USERNAME_KEY, user.username);
    storage.setItem(ROLE_KEY, user.role);
    if (user.studentId) {
      storage.setItem(STUDENT_ID_KEY, user.studentId);
    } else {
      storage.removeItem(STUDENT_ID_KEY);
    }
  }
}
