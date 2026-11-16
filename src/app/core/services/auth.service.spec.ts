import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { DeviceStateService } from './device-state.service';
import { WorkspaceApiService } from './workspace-api.service';

const loginResult = {
  token: 'token-1',
  username: 'PPYorganizer1',
  role: 'organizer' as const,
  studentId: null,
};

describe('AuthService remember me', () => {
  function createService(): AuthService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WorkspaceApiService,
          useValue: {
            login: () => Promise.resolve(loginResult),
            currentUser: () => Promise.resolve({ ...loginResult }),
            errorMessage: () => 'error',
          },
        },
        { provide: DeviceStateService, useValue: { load: () => Promise.resolve(null) } },
      ],
    });
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the session on the device when "keep me signed in" is ticked', async () => {
    const auth = createService();
    await auth.login('PPYorganizer1', 'example-password', true);

    expect(localStorage.getItem('school-event-auth-token-v1')).toBe('token-1');
    expect(sessionStorage.getItem('school-event-auth-token-v1')).toBeNull();
    expect(auth.lastUsername()).toBe('PPYorganizer1');
    expect(auth.rememberPreference()).toBe(true);
  });

  it('keeps the session only while the app is open when it is not ticked', async () => {
    const auth = createService();
    await auth.login('PPYorganizer1', 'example-password', false);

    expect(localStorage.getItem('school-event-auth-token-v1')).toBeNull();
    expect(sessionStorage.getItem('school-event-auth-token-v1')).toBe('token-1');
    expect(auth.lastUsername()).toBe('');

    // Closing the app clears session storage; the next launch is signed out.
    sessionStorage.clear();
    const relaunched = createService();
    await relaunched.initialize();
    expect(relaunched.authenticated()).toBe(false);
  });

  it('restores a remembered session on the next launch', async () => {
    await createService().login('PPYorganizer1', 'example-password', true);

    const relaunched = createService();
    await relaunched.initialize();

    expect(relaunched.authenticated()).toBe(true);
    expect(relaunched.username()).toBe('PPYorganizer1');
  });

  it('remembers the username after a manual sign out', async () => {
    const auth = createService();
    await auth.login('PPYorganizer1', 'example-password', true);
    auth.signOut();

    expect(auth.authenticated()).toBe(false);
    expect(localStorage.getItem('school-event-auth-token-v1')).toBeNull();
    expect(auth.lastUsername()).toBe('PPYorganizer1');
    expect(auth.rememberPreference()).toBe(true);
  });

  it('keeps existing installs signed in', async () => {
    localStorage.setItem('school-event-auth-token-v1', 'old-token');
    localStorage.setItem('school-event-auth-username-v1', 'PPYorganizer1');
    localStorage.setItem('school-event-auth-role-v1', 'organizer');
    const auth = createService();
    await auth.initialize();

    expect(auth.authenticated()).toBe(true);
  });
  it('keeps the profile picture offline and per account', async () => {
    const auth = createService();
    await auth.login('PPYorganizer1', 'example-password', true);
    auth.setAvatar('data:image/jpeg;base64,AAAA');

    expect(auth.avatar()).toBe('data:image/jpeg;base64,AAAA');
    expect(localStorage.getItem('school-event-avatar-v1:ppyorganizer1')).toBe(
      'data:image/jpeg;base64,AAAA',
    );

    auth.setAvatar(null);
    expect(localStorage.getItem('school-event-avatar-v1:ppyorganizer1')).toBeNull();
  });
  it('switches to the new session after a username change', async () => {
    const auth = createService();
    await auth.login('PPYorganizer1', 'example-password', true);
    auth.applySession({ ...loginResult, token: 'token-2', username: 'newname' });

    expect(auth.getToken()).toBe('token-2');
    expect(auth.username()).toBe('newname');
    expect(localStorage.getItem('school-event-auth-token-v1')).toBe('token-2');
    expect(auth.lastUsername()).toBe('newname');
  });
});
