import { computed, signal } from '@angular/core';
import {
  AuditEntry,
  ExcuseRequest,
  ExcuseStatus,
  SchoolYearSettings,
  WorkspaceAccount,
  SchoolSection,
} from '../../core/services/workspace-api.service';
import { Student } from '../../core/models/school-event.models';
import { StudentPart } from './student.part';

/** Accounts, student details, organizers, the school year, the activity log and excuse review. */
export abstract class AdminPart extends StudentPart {
  readonly managedAccounts = signal<WorkspaceAccount[]>([]);
  readonly accountsLoading = signal(false);
  readonly accountRoleFilter = signal<'all' | 'organizer' | 'student'>('organizer');
  readonly accountCourseFilter = signal('');
  readonly accountYearFilter = signal('');
  readonly accountSectionFilter = signal('');
  readonly accountSearch = signal('');
  readonly filteredManagedAccountList = computed(() => {
    const query = this.accountSearch().trim().toLowerCase();
    const roleFilter = this.accountRoleFilter();
    return this.managedAccounts().filter((account) => {
      if (roleFilter !== 'all' && account.role !== roleFilter) return false;

      const student = this.studentForAccount(account);
      const section = this.sectionForAccount(account);
      const course = student?.course ?? section?.course ?? '';
      const yearLevel = student?.yearLevel ?? section?.yearLevel ?? '';
      const sectionName = section?.name ?? student?.section ?? '';

      if (roleFilter === 'student') {
        if (this.accountCourseFilter() && course !== this.accountCourseFilter()) {
          return false;
        }
        if (this.accountYearFilter() && yearLevel !== this.accountYearFilter()) {
          return false;
        }
        if (
          this.accountSectionFilter() &&
          (student?.sectionId ?? '') !== this.accountSectionFilter()
        ) {
          return false;
        }
      }

      const searchText = [
        account.username,
        account.role,
        student?.name,
        course,
        yearLevel,
        sectionName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !query || searchText.includes(query);
    });
  });
  visibleAccountLimit = 100;
  readonly accountError = signal<string | null>(null);
  readonly accountMessage = signal<string | null>(null);
  readonly resetBusy = signal(false);

  // ======================= Admin: students, accounts, organizers =======================
  readonly detailStudentId = signal('');
  readonly detailStudent = computed(() =>
    this.state().students.find((student) => student.id === this.detailStudentId()),
  );
  readonly detailSummary = computed(() =>
    this.myAttendance.summarize(
      this.state().events,
      this.state().attendance,
      this.detailStudent(),
    ),
  );
  readonly detailAccount = computed(() =>
    this.managedAccounts().find((account) => account.studentId === this.detailStudentId()),
  );
  readonly accountBusy = signal(false);

  openStudent(studentId: string): void {
    this.detailStudentId.set(studentId);
    this.go('student-detail');
  }

  async setAccountDisabled(account: WorkspaceAccount, disabled: boolean): Promise<void> {
    if (this.accountBusy()) return;
    if (
      disabled &&
      !(await this.confirm(
        `Turn off ${account.username}?`,
        'They are signed out right away and cannot sign in until you turn the account back on. Nothing is deleted.',
        'Turn off',
      ))
    ) {
      return;
    }
    this.accountBusy.set(true);
    try {
      await this.workspaceApi.setAccountDisabled(this.auth.getToken(), account.username, disabled);
      await this.loadManagedAccounts();
      this.showToast(
        disabled ? `${account.username} is turned off.` : `${account.username} is turned on.`,
        disabled ? 'warning' : 'success',
      );
    } catch (error) {
      this.showToast(this.workspaceApi.errorMessage(error), 'danger');
    } finally {
      this.accountBusy.set(false);
    }
  }

  async deleteAccount(account: WorkspaceAccount): Promise<void> {
    if (this.accountBusy()) return;
    const student = account.role === 'student';
    const confirmed = await this.confirm(
      `Delete ${account.username}?`,
      student
        ? 'The student, their account, their attendance records and their excuse requests are removed for good. This cannot be undone. To keep the history, turn the account off instead.'
        : 'The account is removed for good. Events they created stay.',
      'Delete',
    );
    if (!confirmed) return;
    this.accountBusy.set(true);
    try {
      await this.workspaceApi.deleteAccount(this.auth.getToken(), account.username);
      if (student) {
        await this.workspaceSync.syncNow().catch(() => undefined);
        if (this.page() === 'student-detail') this.go('students');
      }
      await this.loadManagedAccounts();
      this.showToast(`${account.username} was deleted.`, 'warning');
    } catch (error) {
      this.showToast(this.workspaceApi.errorMessage(error), 'danger');
    } finally {
      this.accountBusy.set(false);
    }
  }

  /** Organizers with what they did: events they created and entries they recorded. */
  readonly organizerList = computed(() =>
    this.managedAccounts()
      .filter((account) => account.role === 'organizer')
      .map((account) => ({
        account,
        events: this.state().events.filter((event) => event.createdBy === account.id).length,
        scans: this.state().attendance.filter((record) => record.recordedBy === account.id)
          .length,
      })),
  );

  // ======================= Admin: school year and automatic promotion =======================
  readonly schoolYear = signal<SchoolYearSettings | null>(null);
  readonly schoolYearLoading = signal(false);
  readonly schoolYearBusy = signal(false);
  readonly schoolYearError = signal<string | null>(null);
  schoolYearForm = { enabled: false, endDate: '' };

  async loadSchoolYear(): Promise<void> {
    if (this.auth.role() !== 'super_admin') return;
    this.schoolYearLoading.set(true);
    this.schoolYearError.set(null);
    try {
      const settings = await this.workspaceApi.getSchoolYear(this.auth.getToken());
      this.schoolYear.set(settings);
      this.schoolYearForm = { enabled: settings.enabled, endDate: settings.endDate ?? '' };
    } catch (error) {
      this.schoolYearError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.schoolYearLoading.set(false);
    }
  }

  async saveSchoolYear(): Promise<void> {
    const { enabled, endDate } = this.schoolYearForm;
    this.schoolYearError.set(null);
    if (enabled) {
      if (!endDate) {
        this.schoolYearError.set('Choose the date the school year ends.');
        return;
      }
      if (endDate < this.minimumEventDate) {
        this.schoolYearError.set('The end date cannot be in the past.');
        return;
      }
      const graduating = this.schoolYear()?.preview?.graduating ?? 0;
      const confirmed = await this.confirm(
        'Turn on automatic promotion?',
        `The night after ${this.formatDate(endDate)}, every student moves up one year level by themselves. 4th year students graduate: their accounts and attendance are permanently deleted (${graduating} students if it ran today). A backup is saved first.`,
        'Turn on',
      );
      if (!confirmed) return;
    }
    this.schoolYearBusy.set(true);
    try {
      const saved = await this.workspaceApi.saveSchoolYear(this.auth.getToken(), {
        enabled,
        endDate: endDate || null,
      });
      this.schoolYear.set(saved);
      this.showToast(enabled ? 'Automatic promotion is on.' : 'Automatic promotion is off.');
    } catch (error) {
      this.schoolYearError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.schoolYearBusy.set(false);
    }
  }

  // ======================= Admin: activity log =======================
  readonly auditEntries = signal<AuditEntry[]>([]);
  readonly auditNext = signal<string | null>(null);
  readonly auditLoading = signal(false);
  readonly auditError = signal<string | null>(null);
  readonly auditFilter = signal<'all' | 'events' | 'attendance' | 'accounts' | 'excuses'>('all');
  readonly filteredAudit = computed(() =>
    this.auditEntries().filter(
      (entry) => this.auditFilter() === 'all' || this.auditGroup(entry.action) === this.auditFilter(),
    ),
  );
  auditGroup(action: string): 'events' | 'attendance' | 'accounts' | 'excuses' {
    if (/^(event_|announcement)/.test(action)) return 'events';
    if (/^attendance_/.test(action)) return 'attendance';
    if (/^excuse_/.test(action)) return 'excuses';
    return 'accounts';
  }
  setAuditFilter(value: unknown): void {
    if (['all', 'events', 'attendance', 'accounts', 'excuses'].includes(String(value))) {
      this.auditFilter.set(value as 'all' | 'events' | 'attendance' | 'accounts' | 'excuses');
    }
  }
  async loadAudit(reset: boolean): Promise<void> {
    if (this.auth.role() !== 'super_admin' || this.auditLoading()) return;
    this.auditLoading.set(true);
    this.auditError.set(null);
    try {
      const page = await this.workspaceApi.auditLog(
        this.auth.getToken(),
        reset ? undefined : (this.auditNext() ?? undefined),
      );
      this.auditEntries.update((entries) => (reset ? page.entries : [...entries, ...page.entries]));
      this.auditNext.set(page.next);
    } catch (error) {
      this.auditError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.auditLoading.set(false);
    }
  }
  readonly excuseList = signal<ExcuseRequest[]>([]);
  readonly excuseFilter = signal<ExcuseStatus>('pending');
  readonly pendingExcuseCount = signal(0);
  readonly excuseLoading = signal(false);
  readonly excuseDetail = signal<ExcuseRequest | null>(null);

  setExcuseFilter(value: unknown): void {
    if (value === 'pending' || value === 'approved' || value === 'rejected') {
      this.excuseFilter.set(value);
      void this.loadExcuses();
    }
  }

  async loadExcuses(): Promise<void> {
    if (this.auth.role() !== 'super_admin' || !this.isOnline()) return;
    this.excuseLoading.set(true);
    try {
      const result = await this.workspaceApi.listExcuses(this.auth.getToken(), this.excuseFilter());
      this.excuseList.set(result.excuses);
      this.pendingExcuseCount.set(result.pending);
    } catch {
      this.excuseList.set([]);
    } finally {
      this.excuseLoading.set(false);
    }
  }

  async openExcuse(excuse: ExcuseRequest): Promise<void> {
    this.excuseDetail.set(excuse); // show the text now, add the photo when it arrives
    if (!excuse.hasPhoto) return;
    try {
      this.excuseDetail.set(await this.workspaceApi.getExcuse(this.auth.getToken(), excuse.id));
    } catch {
      // Keep showing the request without its photo.
    }
  }

  async decideExcuse(decision: 'approved' | 'rejected'): Promise<void> {
    const excuse = this.excuseDetail();
    if (!excuse || this.excuseBusy()) return;
    let note = '';
    if (decision === 'rejected') {
      const reason = await this.askReason(
        'Reject this request?',
        `Tell ${excuse.studentName} why.`,
        'For example: please bring a medical certificate',
        'Reject',
      );
      if (!reason) return;
      note = reason;
    }
    this.excuseBusy.set(true);
    try {
      await this.workspaceApi.reviewExcuse(this.auth.getToken(), excuse.id, decision, note);
      this.excuseDetail.set(null);
      await this.loadExcuses();
      if (decision === 'approved') await this.syncWorkspace();
      this.showToast(
        decision === 'approved'
          ? `${excuse.studentName} is now excused.`
          : 'Request rejected.',
        decision === 'approved' ? 'success' : 'warning',
      );
    } catch (error) {
      this.showToast(this.workspaceApi.errorMessage(error), 'danger');
    } finally {
      this.excuseBusy.set(false);
    }
  }
  accountForm = { username: '', password: '' };
  resetAccountUsername = '';
  resetAccountPassword = '';
  clearWorkspaceConfirmation = '';

  visibleManagedAccounts(): WorkspaceAccount[] {
    return this.filteredManagedAccountList().slice(0, this.visibleAccountLimit);
  }

  showMoreManagedAccounts(): void {
    this.visibleAccountLimit += 100;
  }

  accountCourses(): string[] {
    return [
      ...new Set([
        ...this.schoolSections().map((section) => section.course),
        ...this.managedAccounts()
          .filter((account) => account.role === 'student')
          .map((account) => this.studentForAccount(account)?.course)
          .filter((course): course is string => !!course),
      ]),
    ].sort();
  }

  accountYears(): string[] {
    return [
      ...new Set(
        this.schoolSections()
          .filter(
            (section) =>
            !this.accountCourseFilter() ||
            section.course === this.accountCourseFilter(),
          )
          .map((section) => section.yearLevel),
      ),
    ].sort(
      (left, right) =>
        this.yearLevels.indexOf(left) - this.yearLevels.indexOf(right),
    );
  }

  accountSections(): SchoolSection[] {
    return this.schoolSections().filter(
      (section) =>
        (!this.accountCourseFilter() ||
          section.course === this.accountCourseFilter()) &&
        (!this.accountYearFilter() ||
          section.yearLevel === this.accountYearFilter()),
    );
  }

  protected studentForAccount(account: WorkspaceAccount): Student | undefined {
    return account.studentId
      ? this.state().students.find((student) => student.id === account.studentId)
      : undefined;
  }

  protected sectionForAccount(account: WorkspaceAccount): SchoolSection | undefined {
    const sectionId = this.studentForAccount(account)?.sectionId;
    return sectionId
      ? this.schoolSections().find((section) => section.id === sectionId)
      : undefined;
  }

  accountSummary(account: WorkspaceAccount): string {
    if (account.role !== 'student') {
      return `${account.role === 'super_admin' ? 'Super admin' : 'Organizer'} account`;
    }
    const student = this.studentForAccount(account);
    const section = this.sectionForAccount(account);
    return [
      student?.course ?? section?.course,
      student?.yearLevel ?? section?.yearLevel,
      section?.name ?? student?.section,
    ]
      .filter(Boolean)
      .join(' · ') || 'Student account';
  }

  accountName(account: WorkspaceAccount): string {
    return this.studentForAccount(account)?.name || account.username;
  }

  accountCourseChanged(): void {
    this.accountYearFilter.set('');
    this.accountSectionFilter.set('');
    this.visibleAccountLimit = 100;
  }

  accountYearChanged(): void {
    this.accountSectionFilter.set('');
    this.visibleAccountLimit = 100;
  }

  accountFiltersChanged(): void {
    this.visibleAccountLimit = 100;
  }

  selectManagedAccount(username: string): void {
    this.resetAccountUsername = username;
    this.accountError.set(null);
    this.accountMessage.set(null);
  }
  async loadManagedAccounts(): Promise<void> {
    if (!this.auth.authenticated() || this.auth.role() !== 'super_admin') return;
    this.accountsLoading.set(true);
    try {
      const result = await this.workspaceApi.listAccounts(this.auth.getToken());
      this.managedAccounts.set(result.accounts);
      this.accountError.set(null);
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    } finally {
      this.accountsLoading.set(false);
    }
  }
  async createManagedAccount(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
    try {
      await this.workspaceApi.createAccount(this.auth.getToken(), {
        username: this.accountForm.username.trim(),
        password: this.accountForm.password,
      });
      this.accountMessage.set('Organizer account created.');
      this.showToast('Organizer account created.');
      this.accountForm = { username: '', password: '' };
      await this.loadManagedAccounts();
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async resetManagedAccountPassword(): Promise<void> {
    this.accountError.set(null);
    this.accountMessage.set(null);
    if (!this.resetAccountUsername) {
      this.accountError.set('Select an account before resetting its password.');
      return;
    }
    try {
      await this.workspaceApi.resetAccountPassword(
        this.auth.getToken(),
        this.resetAccountUsername,
        this.resetAccountPassword,
      );
      this.resetAccountPassword = '';
      this.accountMessage.set(
        `Password reset for ${this.resetAccountUsername}.`,
      );
      this.showToast('Password reset.');
      if (
        this.resetAccountUsername.toLowerCase() ===
        this.auth.username().toLowerCase()
      ) {
        this.auth.error.set(
          'Your password was reset. Sign in again with the new password.',
        );
        this.auth.signOut();
        this.store.update((state) => {
          state.role = null;
        });
        this.authMode.set('login');
        this.authUsername = this.resetAccountUsername;
        void this.router.navigate(['/login']);
      }
    } catch (error) {
      this.accountError.set(this.workspaceApi.errorMessage(error));
    }
  }
  async resetWorkspace(): Promise<void> {
    if (this.clearWorkspaceConfirmation !== 'DELETE' || this.resetBusy()) return;
    if (
      !(await this.confirm(
        'Delete all shared data?',
        'Every student, event, attendance record and message will be permanently deleted. This cannot be undone.',
        'Delete everything',
      ))
    ) {
      return;
    }
    this.resetBusy.set(true);
    this.workspaceSync.error.set(null);
    let sharedReset = false;
    try {
      const { revision } = await this.workspaceApi.resetSharedWorkspace(
        this.auth.getToken(),
      );
      sharedReset = true;
      await this.workspaceSync.acceptRemoteReset(revision);
      this.clearWorkspaceConfirmation = '';
      this.showToast('Shared app reset. Admin account kept.');
      this.go('home');
    } catch (error) {
      const detail = this.workspaceApi.errorMessage(error);
      this.workspaceSync.error.set(
        sharedReset
          ? `Shared data was deleted, but this device could not finish clearing its local cache: ${detail}`
          : `The shared app was not reset: ${detail}`,
      );
    } finally {
      this.resetBusy.set(false);
    }
  }
}
