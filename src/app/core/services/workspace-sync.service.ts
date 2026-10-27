import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { AppState, SmsMessage } from '../models/school-event.models';
import { AuthService } from './auth.service';
import { DemoStoreService } from './demo-store.service';
import { DeviceStateService } from './device-state.service';
import { SmsService } from './sms.service';
import {
  WorkspaceApiService,
  WorkspaceSnapshot,
} from './workspace-api.service';

const ACTIVE_WORKSPACE_KEY = 'school-event-active-workspace-v1';

@Injectable({ providedIn: 'root' })
export class WorkspaceSyncService {
  private readonly auth = inject(AuthService);
  private readonly store = inject(DemoStoreService);
  private readonly device = inject(DeviceStateService);
  private readonly api = inject(WorkspaceApiService);
  private readonly sms = inject(SmsService);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastSyncedAt = signal<string | null>(null);
  readonly pending = signal(false);

  private revision = 0;
  private initialized?: Promise<void>;
  private debounce?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setInterval>;
  private persistQueue = Promise.resolve();
  private suppressLocalChanges = false;
  private generation = 0;
  private resetPending = false;
  private unsubscribe: () => void;
  private readonly handleOnline = (): void => {
    if (this.auth.offline()) this.auth.offline.set(false);
    if (this.pending() && this.canSync()) {
      void this.syncNow().catch((error: unknown) => this.setError(error));
    }
  };

  constructor() {
    this.unsubscribe = this.store.subscribe((state) => {
      if (this.suppressLocalChanges || !this.auth.username()) return;
      this.generation += 1;
      this.pending.set(true);
      this.persistQueue = this.persistQueue
        .then(() => this.saveCache(state, true))
        .catch((error: unknown) => this.setError(error));
      if (this.canSync()) {
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          void this.syncNow().catch(() => undefined);
        }, 700);
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      this.poll = setInterval(() => {
        if (
          document.visibilityState === 'visible' &&
          this.auth.authenticated() &&
          this.canSync()
        ) {
          void this.syncNow().catch((error: unknown) => this.setError(error));
        }
      }, 15000);
    }
  }

  initialize(): Promise<void> {
    if (!this.initialized) {
      this.initialized = this.initializeWorkspace().catch((error: unknown) => {
        this.setError(error);
      });
    }
    return this.initialized;
  }

  async connect(): Promise<void> {
    if (!this.auth.authenticated()) {
      throw new Error('Sign in before connecting to a shared workspace.');
    }
    const username = this.auth.username();
    this.store.replace(
      {
        ...this.store.state(),
        role: this.auth.role(),
        studentId: this.auth.studentId() ?? '',
      },
      false,
    );
    await this.sms.initialize(username);
    const cached = await this.device.load(username);
    const previousUsername = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const switchedAccount =
      previousUsername !== null && previousUsername !== username;
    if (switchedAccount && !cached) {
      this.store.replace(
        {
          ...this.store.state(),
          role: null,
          studentId: '',
          selectedEventId: '',
          students: [],
          events: [],
          attendance: [],
          violations: [],
          messages: [],
          syncItems: [],
        },
        false,
      );
      await this.sms.replaceFromSync([]);
    }
    if (cached) {
      this.revision = cached.snapshot.revision;
      this.pending.set(cached.dirty);
      this.resetPending = cached.resetPending;
      await this.restoreCache(cached.snapshot);
    } else {
      this.resetPending = false;
      this.pending.set(
        !switchedAccount && this.hasLocalWorkspaceData(this.store.state()),
      );
    }
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, username);

    if (!this.canSync()) {
      if (!cached) {
        throw new Error('Internet is required for your first login.');
      }
      await this.saveCache(this.store.state(), this.pending());
      this.error.set('Offline mode: changes are saved on this device and will sync when online.');
      return;
    }

    this.busy.set(true);
    try {
      await this.persistQueue;
      const remote = await this.api.loadWorkspace(this.auth.getToken());
      const local = this.currentSnapshot(this.revision);
      const role = this.auth.role();
      const shouldPushLocalChanges =
        (role === 'super_admin' && this.pending()) ||
        (role === 'organizer' &&
          (this.pending() ||
            (this.isEmptyWorkspace(remote) &&
              this.hasLocalWorkspaceData(this.store.state()))));
      if (shouldPushLocalChanges) {
        await this.pushWithConflictResolution(
          this.resetPending ? local : this.mergeSnapshots(remote, local),
          remote.revision,
          this.resetPending,
        );
      } else {
        await this.applyRemote(remote);
      }
      this.error.set(null);
      this.lastSyncedAt.set(new Date().toISOString());
    } catch (error) {
      this.setError(error);
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  async syncNow(): Promise<void> {
    if (!this.auth.authenticated()) {
      throw new Error('Sign in before syncing this workspace.');
    }
    if (!this.canSync()) {
      throw new Error('Reconnect to the internet to sync this workspace.');
    }
    if (this.busy()) return;

    this.busy.set(true);
    try {
      await this.persistQueue;
      const remote = await this.api.loadWorkspace(this.auth.getToken());
      const local = this.currentSnapshot(this.revision);
      const role = this.auth.role();
      const shouldPushLocalChanges =
        (role === 'super_admin' && this.pending()) ||
        (role === 'organizer' &&
          (this.pending() ||
            (this.isEmptyWorkspace(remote) &&
              this.hasLocalWorkspaceData(this.store.state()))));
      if (shouldPushLocalChanges) {
        await this.pushWithConflictResolution(
          this.resetPending ? local : this.mergeSnapshots(remote, local),
          remote.revision,
          this.resetPending,
        );
      } else if (remote.revision !== this.revision || this.pending()) {
        await this.applyRemote(remote);
      }
      this.error.set(null);
      this.lastSyncedAt.set(new Date().toISOString());
    } catch (error) {
      this.setError(error);
      throw error;
    } finally {
      this.busy.set(false);
    }
  }

  destroy(): void {
    this.unsubscribe();
    if (this.debounce) clearTimeout(this.debounce);
    if (this.poll) clearInterval(this.poll);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
    }
  }

  markWorkspaceReset(): void {
    this.resetPending = this.auth.authenticated();
    this.pending.set(this.resetPending);
  }

  async flushLocalChanges(): Promise<void> {
    await this.persistQueue;
    if (this.auth.username()) {
      await this.saveCache(this.store.state(), this.pending());
    }
  }

  private async initializeWorkspace(): Promise<void> {
    await this.auth.initialize();
    await this.sms.initialize(this.auth.username());
    if (this.auth.authenticated()) {
      try {
        await this.connect();
      } catch {
        return;
      }
    }
  }

  private async pushWithConflictResolution(
    snapshot: WorkspaceSnapshot,
    revision: number,
    replaceOnConflict = false,
  ): Promise<void> {
    let next = { ...snapshot, revision };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = this.generation;
      try {
        const saved = await this.api.saveWorkspace(
          this.auth.getToken(),
          next,
        );
        this.revision = saved.revision;
        if (generation !== this.generation) {
          this.pending.set(true);
          await this.saveCache(this.store.state(), true);
          if (this.canSync()) {
            setTimeout(() => {
              void this.syncNow().catch((error: unknown) => this.setError(error));
            }, 0);
          }
          return;
        }
        this.pending.set(false);
        await this.applyRemote({ ...next, revision: saved.revision });
        return;
      } catch (error) {
        const conflict = this.api.conflictSnapshot(error);
        if (!conflict) throw error;
        next = replaceOnConflict
          ? this.currentSnapshot(conflict.revision)
          : this.mergeSnapshots(conflict, next);
        next.revision = conflict.revision;
        if (attempt === 2) {
          throw new Error(
            'The workspace changed repeatedly on another device. Your local changes remain saved; try syncing again.',
          );
        }
      }
    }
  }

  private async applyRemote(snapshot: WorkspaceSnapshot): Promise<void> {
    const generation = this.generation;
    const state: AppState = {
      ...this.store.state(),
      ...snapshot.state,
      events: snapshot.state.events.map((event) => ({
        ...event,
        requiredSections: event.requiredSections ?? [],
        approvalStatus: event.approvalStatus ?? 'approved',
      })),
      messages: [],
      announcements: snapshot.state.announcements ?? [],
    };
    this.store.replace(state, false);
    await this.sms.replaceFromSync(snapshot.state.messages);
    this.revision = snapshot.revision;
    const changedDuringApply = generation !== this.generation;
    this.pending.set(changedDuringApply);
    if (!changedDuringApply) this.resetPending = false;
    await this.saveCache(
      changedDuringApply ? this.store.state() : state,
      changedDuringApply,
    );
  }

  private async saveCache(
    state: AppState,
    dirty: boolean,
    resetPending = this.resetPending,
  ): Promise<void> {
    const username = this.auth.username();
    if (!username) return;
    const cacheState: AppState = {
      ...state,
      messages: this.sms.messages(),
    };
    await this.device.save(
      username,
      cacheState,
      this.revision,
      dirty,
      resetPending,
    );
  }

  private currentSnapshot(revision: number): WorkspaceSnapshot {
    const state: AppState = {
      ...this.store.state(),
      messages: this.sms.messages(),
    };
    return this.device.createSnapshot(state, revision);
  }

  private mergeSnapshots(
    remote: WorkspaceSnapshot,
    local: WorkspaceSnapshot,
  ): WorkspaceSnapshot {
    const organizer = this.auth.role() === 'organizer';
    return {
      revision: remote.revision,
      state: {
        students: organizer
          ? this.preferRemoteById(remote.state.students, local.state.students)
          : this.mergeById(remote.state.students, local.state.students),
        events: organizer
          ? this.preferRemoteById(remote.state.events, local.state.events)
          : this.mergeById(remote.state.events, local.state.events),
        attendance: this.mergeById(
          remote.state.attendance,
          local.state.attendance,
        ),
        violations: this.mergeById(
          remote.state.violations,
          local.state.violations,
        ),
        messages: this.mergeById(
          remote.state.messages,
          local.state.messages,
        ) as SmsMessage[],
        syncItems: this.mergeById(
          remote.state.syncItems,
          local.state.syncItems,
        ),
        announcements: organizer
          ? this.preferRemoteById(
              remote.state.announcements ?? [],
              local.state.announcements ?? [],
            )
          : this.mergeById(
              remote.state.announcements ?? [],
              local.state.announcements ?? [],
            ),
      },
    };
  }

  private preferRemoteById<T extends { id: string }>(
    remote: T[],
    local: T[],
  ): T[] {
    const remoteIds = new Set(remote.map((item) => item.id));
    return [...remote, ...local.filter((item) => !remoteIds.has(item.id))];
  }

  private mergeById<T extends { id: string }>(remote: T[], local: T[]): T[] {
    const merged = new Map(remote.map((item) => [item.id, item]));
    local.forEach((item) => merged.set(item.id, item));
    return [...merged.values()];
  }

  private hasLocalWorkspaceData(state: AppState): boolean {
    return (
      state.students.length > 0 ||
      state.events.length > 0 ||
      state.attendance.length > 0 ||
      state.violations.length > 0 ||
      this.sms.messages().length > 0
    );
  }

  private isEmptyWorkspace(snapshot: WorkspaceSnapshot): boolean {
    return Object.values(snapshot.state).every((records) => records.length === 0);
  }

  private setError(error: unknown): void {
    this.error.set(this.api.errorMessage(error));
  }

  private async restoreCache(snapshot: WorkspaceSnapshot): Promise<void> {
    const state: AppState = {
      ...this.store.state(),
      ...snapshot.state,
      messages: [],
    };
    this.store.replace(state, false);
    await this.sms.replaceFromSync(snapshot.state.messages);
  }

  private canSync(): boolean {
    return (
      this.auth.authenticated() &&
      !this.auth.offline() &&
      (Capacitor.isNativePlatform() ||
        (typeof navigator !== 'undefined' && navigator.onLine)) &&
      !this.store.state().simulatedOffline
    );
  }
}
