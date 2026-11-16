import { computed, signal } from '@angular/core';
import { AdminPart } from './admin.part';

/** Signing in and up, account security, and the profile photo. */
export abstract class AuthPart extends AdminPart {
  readonly apiAddressSaved = signal(false);
  readonly apiCheckBusy = signal(false);
  readonly apiCheckMessage = signal<string | null>(null);
  signupForm = {
    studentNumber: '',
    name: '',
    course: '',
    yearLevel: '',
    section: '',
    mobile: '',
  };

  // ---- Change contact number (students) ----
  readonly contactStep = signal<'enter' | 'verify'>('enter');
  readonly contactTarget = signal('');
  readonly contactBusy = signal(false);
  contactForm = { mobile: '', currentPassword: '', code: '' };

  currentMobileLocal(): string {
    const mobile = this.activeStudent().mobile ?? '';
    return mobile.startsWith('+63') ? `0${mobile.slice(3)}` : mobile;
  }
  openContactForm(): void {
    this.contactForm = { mobile: '', currentPassword: '', code: '' };
    this.contactStep.set('enter');
    this.securityError.set(null);
    this.go('settings-contact');
  }
  normalizeContactMobile(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const clean = input.value.replace(/\D/g, '').slice(0, 11);
    input.value = clean;
    this.contactForm.mobile = clean;
  }
  normalizeContactCode(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const clean = input.value.replace(/\D/g, '').slice(0, 6);
    input.value = clean;
    this.contactForm.code = clean;
  }
  /** Step 1: the code is texted to the new number from this phone's SIM. */
  async sendContactCode(): Promise<void> {
    this.securityError.set(null);
    if (!/^09\d{9}$/.test(this.contactForm.mobile)) {
      this.securityError.set('Enter the new number as 11 digits starting with 09, for example 09123456789.');
      return;
    }
    if (!this.contactForm.currentPassword) {
      this.securityError.set('Enter your current password.');
      return;
    }
    if (!this.nativeSms.available()) {
      this.securityError.set(
        'Open the Android app to verify your number. The code is texted from your phone.',
      );
      return;
    }
    this.contactBusy.set(true);
    try {
      if (!(await this.nativeSms.ensurePermission())) {
        throw new Error('Allow SMS permission so the app can text you the code.');
      }
      const target = this.contactForm.mobile;
      await this.withLoading('Texting your code…', async () => {
        const result = await this.workspaceApi.requestContactChange(
          this.auth.getToken(),
          target,
          this.contactForm.currentPassword,
        );
        await this.nativeSms.send(
          result.mobile,
          `GATHER code: ${result.code}. Enter it in the app to confirm your new number.`,
        );
      });
      this.contactTarget.set(target);
      this.contactForm.code = '';
      this.contactStep.set('verify');
    } catch (error) {
      this.securityError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.contactBusy.set(false);
    }
  }
  async resendContactCode(): Promise<void> {
    this.contactForm.mobile = this.contactTarget();
    await this.sendContactCode();
  }
  /** Step 2: the typed code proves the student can read texts on the new number. */
  async confirmContactCode(): Promise<void> {
    this.securityError.set(null);
    if (!/^\d{6}$/.test(this.contactForm.code)) {
      this.securityError.set('Enter the 6-digit code.');
      return;
    }
    this.contactBusy.set(true);
    try {
      await this.withLoading('Confirming your number…', () =>
        this.workspaceApi.confirmContactChange(this.auth.getToken(), this.contactForm.code),
      );
      await this.workspaceSync.syncNow().catch(() => undefined);
      this.contactForm = { mobile: '', currentPassword: '', code: '' };
      this.showToast('Contact number updated.');
      this.go('settings');
    } catch (error) {
      this.securityError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.contactBusy.set(false);
    }
  }

  readonly securityBusy = signal(false);
  readonly securityError = signal<string | null>(null);
  securityForm = {
    currentPassword: '',
    newUsername: '',
    newPassword: '',
    confirmPassword: '',
  };

  openSecurityForm(screen: 'settings-username' | 'settings-password'): void {
    this.securityForm = {
      currentPassword: '',
      newUsername: '',
      newPassword: '',
      confirmPassword: '',
    };
    this.securityError.set(null);
    this.go(screen);
  }

  async saveNewPassword(): Promise<void> {
    const { currentPassword, newPassword, confirmPassword } = this.securityForm;
    this.securityError.set(null);
    if (!currentPassword) {
      this.securityError.set('Enter your current password.');
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      this.securityError.set('The new password must be 8–128 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.securityError.set('The new password and its confirmation do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      this.securityError.set('Choose a password that is different from the current one.');
      return;
    }
    this.securityBusy.set(true);
    try {
      const session = await this.withLoading('Saving your password…', () =>
        this.workspaceApi.changePassword(this.auth.getToken(), currentPassword, newPassword),
      );
      this.auth.applySession(session);
      this.securityForm.currentPassword = '';
      this.securityForm.newPassword = '';
      this.securityForm.confirmPassword = '';
      this.showToast('Password changed.');
      this.go('settings');
    } catch (error) {
      this.securityError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.securityBusy.set(false);
    }
  }

  async saveNewUsername(): Promise<void> {
    const username = this.securityForm.newUsername.trim();
    this.securityError.set(null);
    if (!/^[a-z0-9._-]{3,64}$/i.test(username)) {
      this.securityError.set(
        'Username must be 3–64 characters: letters, numbers, dots, dashes, or underscores.',
      );
      return;
    }
    if (username === this.auth.username()) {
      this.securityError.set('That is already your username.');
      return;
    }
    if (!this.securityForm.currentPassword) {
      this.securityError.set('Enter your current password.');
      return;
    }
    this.securityBusy.set(true);
    try {
      await this.withLoading('Saving your username…', async () => {
        // Local data is stored under the username, so save everything first.
        if (this.workspaceSync.pending()) await this.workspaceSync.syncNow();
        const session = await this.workspaceApi.changeUsername(
          this.auth.getToken(),
          this.securityForm.currentPassword,
          username,
        );
        this.auth.applySession(session);
        await this.workspaceSync.connect();
      });
      this.securityForm.currentPassword = '';
      this.securityForm.newUsername = '';
      this.showToast('Username changed.');
      this.go('settings');
    } catch (error) {
      this.securityError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.securityBusy.set(false);
    }
  }

  readonly photoBusy = signal(false);
  readonly photoViewerOpen = signal(false);

  readonly photoMenuOpen = signal(false);
  /** The choices shown when you tap your picture (they depend on whether you have one). */
  readonly photoMenuLabels = computed(() =>
    this.auth.avatar() ? ['View photo', 'Change photo'] : ['Take photo', 'Choose photo'],
  );

  /** Tapping your own picture opens a centred dialog with the choices that fit. */
  openPhotoMenu(): void {
    if (this.photoBusy()) return;
    this.photoMenuOpen.set(true);
  }

  pickPhoto(action: 'take' | 'choose' | 'view'): void {
    // Open the picker straight from the tap so the browser allows it.
    if (action === 'take') this.takePhotoInput?.nativeElement.click();
    if (action === 'choose') this.choosePhotoInput?.nativeElement.click();
    this.photoMenuOpen.set(false);
    if (action === 'view') this.photoViewerOpen.set(true);
  }

  async removePhotoFromViewer(): Promise<void> {
    this.photoViewerOpen.set(false);
    await this.removePhoto();
  }
  readonly photoError = signal<string | null>(null);

  /** The user chose or took a photo: shrink it, save it, and show it. */
  async onPhotoSelected(event: Event): Promise<void> {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.photoError.set(null);
    this.photoBusy.set(true);
    try {
      const image = await this.profilePhoto.prepare(file);
      this.auth.setAvatar(image); // show it right away
      const saved = await this.workspaceApi.saveAvatar(this.auth.getToken(), image);
      this.auth.setAvatar(saved.avatar);
      this.showToast('Profile picture updated.');
    } catch (error) {
      this.photoError.set(
        error instanceof Error && !('status' in error)
          ? error.message
          : this.workspaceApi.errorMessage(error),
      );
      // Show what the server really has if the save failed.
      this.showToast('Could not save your profile picture.', 'danger');
    } finally {
      this.photoBusy.set(false);
    }
  }

  async removePhoto(): Promise<void> {
    if (!this.auth.avatar()) return;
    const previous = this.auth.avatar();
    this.photoError.set(null);
    this.auth.setAvatar(null);
    try {
      await this.workspaceApi.removeAvatar(this.auth.getToken());
      this.showToast('Profile picture removed.', 'warning', () => {
        if (!previous) return;
        this.auth.setAvatar(previous);
        void this.workspaceApi
          .saveAvatar(this.auth.getToken(), previous)
          .catch(() => this.showToast('Could not restore the picture.', 'danger'));
      });
    } catch (error) {
      this.auth.setAvatar(previous);
      this.photoError.set(this.workspaceApi.errorMessage(error));
    }
  }
  keepSignedIn = false;
  authPassword = '';
  apiBaseUrl = '';
  signupYears(): string[] {
    if (!this.schoolSections().length) return this.yearLevels;
    const years = this.schoolSections()
      .filter((section) => section.course === this.signupForm.course)
      .map((section) => section.yearLevel);
    return [...new Set(years)].sort(
      (a, b) => this.yearLevels.indexOf(a) - this.yearLevels.indexOf(b),
    );
  }
  signupSectionNames(): string[] {
    if (!this.schoolSections().length) return this.sectionNames;
    return this.schoolSections()
      .filter(
        (section) =>
          section.course === this.signupForm.course &&
          section.yearLevel === this.signupForm.yearLevel,
      )
      .map((section) => section.name)
      .sort();
  }
  showRegistration(): void {
    void this.loadSections();
    this.authMode.set('register');
    this.auth.error.set(null);
    this.signupForm = {
      studentNumber: '',
      name: '',
      course: '',
      yearLevel: '',
      section: '',
      mobile: '',
    };
  }
  showSignIn(): void {
    this.authMode.set('login');
    this.auth.error.set(null);
  }
  normalizeStudentNumber(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      const clean = input.value.replace(/\D/g, '');
      input.value = clean;
      this.signupForm.studentNumber = clean;
    }
  }
  /** Full name: letters (including accents and ñ) and single spaces only. */
  normalizeName(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      const clean = input.value
        .replace(/[^\p{L} ]/gu, '')
        .replace(/ {2,}/g, ' ')
        .replace(/^ /, '');
      input.value = clean;
      this.signupForm.name = clean;
    }
  }
  /** Contact number: digits only, at most 11 (09XXXXXXXXX). */
  normalizeMobile(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) {
      const clean = input.value.replace(/\D/g, '').slice(0, 11);
      input.value = clean;
      this.signupForm.mobile = clean;
    }
  }
  /** Returns a message when the registration details are not valid. */
  protected signupProblem(): string | null {
    const name = this.signupForm.name.trim();
    if (!/^\p{L}+( \p{L}+)*$/u.test(name)) {
      return 'Full name can contain letters and spaces only.';
    }
    if (!/^09\d{9}$/.test(this.signupForm.mobile.trim())) {
      return 'Enter your contact number as 11 digits starting with 09, for example 09123456789.';
    }
    return null;
  }
  async submitAuth(): Promise<void> {
    const username = this.authUsername.trim();
    const registering = this.authMode() === 'register';
    if (registering) {
      const problem = this.signupProblem();
      if (problem) {
        this.auth.error.set(problem);
        return;
      }
    }
    try {
      this.apiCheckMessage.set(null);
      await this.withLoading(
        registering ? 'Creating your account…' : 'Signing in…',
        async () => {
      if (registering) {
        await this.auth.register(username, this.authPassword, {
          studentNumber: `PPY-${this.signupForm.studentNumber}`,
          name: this.signupForm.name.trim(),
          course: this.signupForm.course,
          yearLevel: this.signupForm.yearLevel,
          section: this.signupForm.section,
          sectionId: this.schoolSections().find(
            (section) =>
              section.course === this.signupForm.course &&
              section.yearLevel === this.signupForm.yearLevel &&
              section.name === this.signupForm.section,
          )?.id,
          mobile: this.signupForm.mobile.trim(),
        }, false);
      } else {
        await this.auth.login(username, this.authPassword, this.keepSignedIn);
      }
      this.authPassword = '';
      try {
        await this.workspaceSync.connect();
      } catch (error) {
        this.workspaceSync.error.set(
          error instanceof Error
            ? error.message
            : 'The shared workspace could not be loaded.',
        );
      }
        },
      );
      if (this.auth.authenticated()) {
        this.store.update((state) => {
          state.role = this.auth.role();
          state.studentId = this.auth.studentId() ?? '';
        });
        void this.router.navigate(['/workspace', this.homeScreenForRole()]);
        void this.refreshQr();
        this.showToast(registering ? 'Account created.' : 'Welcome back.');
      }
    } catch (error) {
      if (!this.auth.error()) {
        this.auth.error.set(
          error instanceof Error ? error.message : 'Unable to sign in.',
        );
      }
      return;
    }
  }
  async testApiConnection(): Promise<void> {
    this.apiCheckBusy.set(true);
    this.apiCheckMessage.set(null);
    this.auth.error.set(null);
    try {
      this.workspaceApi.setBaseUrl(this.apiBaseUrl);
      await this.workspaceApi.checkHealth();
      this.apiCheckMessage.set('Server connection successful. You can sign in.');
    } catch (error) {
      this.apiCheckMessage.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.apiCheckBusy.set(false);
    }
  }
  async confirmSignOut(): Promise<void> {
    if (await this.confirm('Sign out?', 'You will need to sign in again to use the app.', 'Sign out')) {
      this.signOut();
    }
  }
  signOut(): void {
    this.stopScanner();
    this.auth.signOut();
    this.authUsername = this.auth.lastUsername();
    this.keepSignedIn = this.auth.rememberPreference();
    this.authPassword = '';
    this.store.update((state) => {
      state.role = null;
    });
    void this.router.navigate(['/login']);
  }
  saveApiAddress(): void {
    this.apiAddressSaved.set(false);
    try {
      this.workspaceApi.setBaseUrl(this.apiBaseUrl);
      this.workspaceSync.error.set(null);
      this.apiAddressSaved.set(true);
      this.showToast('API address saved.');
    } catch (error) {
      this.workspaceSync.error.set(
        error instanceof Error ? error.message : 'Invalid API address.',
      );
    }
  }
}
