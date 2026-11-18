import { inject, Injectable } from '@angular/core';
import {
  AttendanceSyncInfo,
  applyPulled,
  emptyAttendanceSync,
  localChanges,
  recordHash,
} from './attendance-sync';
import { closeRecordsOfFinishedEvents } from './attendance.service';
import { AuthService } from './auth.service';
import { DemoStoreService } from './demo-store.service';
import { WorkspaceApiService } from './workspace-api.service';

const PUSH_BATCH = 500;
const REMOVE_BATCH = 2000;

/**
 * Keeps this device's attendance in step with the server in small steps:
 * it asks only for what changed since last time and sends only what it changed,
 * so the amount of data per sync stays small however long the history gets.
 */
@Injectable({ providedIn: 'root' })
export class AttendanceSyncService {
  private readonly api = inject(WorkspaceApiService);
  private readonly auth = inject(AuthService);
  private readonly store = inject(DemoStoreService);
  private info: AttendanceSyncInfo = emptyAttendanceSync();

  /** Loads what was saved with the offline copy (or starts fresh). */
  restore(info?: AttendanceSyncInfo | null): void {
    this.info = info
      ? { cursor: info.cursor, hashes: { ...info.hashes } }
      : emptyAttendanceSync();
  }

  snapshot(): AttendanceSyncInfo {
    return { cursor: this.info.cursor, hashes: { ...this.info.hashes } };
  }

  /** True when something recorded or removed here has not reached the server yet. */
  hasUnsynced(): boolean {
    if (!this.canPush()) return false;
    const { changed, removed } = localChanges(this.store.state().attendance, this.info);
    return changed.length > 0 || removed.length > 0;
  }

  /** Pull what changed, send what we changed, then pull again to see the server's final copies. */
  async sync(): Promise<void> {
    const token = this.auth.getToken();
    await this.pull(token);
    this.closeLeftovers();
    if (this.canPush() && (await this.push(token))) {
      await this.pull(token);
      this.closeLeftovers();
    }
  }

  /** Anyone still checked in after their event ended is checked out (11:59 PM of that day, or when it was finished). */
  private closeLeftovers(): void {
    const state = this.store.state();
    const closed = closeRecordsOfFinishedEvents(state.events, state.attendance);
    if (closed !== state.attendance) this.store.replace({ ...state, attendance: closed }, false);
  }

  private canPush(): boolean {
    const role = this.auth.role();
    return role === 'super_admin' || role === 'organizer';
  }

  private async pull(token: string): Promise<void> {
    for (let page = 0; page < 500; page += 1) {
      const result = await this.api.loadAttendance(token, this.info.cursor);
      if (result.reset) {
        // The server's history is older than ours (for example it was restored): start over.
        this.info = emptyAttendanceSync();
      }
      if (result.records.length || result.removed.length) {
        const next = applyPulled(this.store.state().attendance, this.info, result);
        this.store.replace({ ...this.store.state(), attendance: next }, false);
      }
      this.info.cursor = result.cursor;
      if (!result.more) return;
    }
  }

  /** Returns true when anything was sent. */
  private async push(token: string): Promise<boolean> {
    let sent = false;
    for (let round = 0; round < 200; round += 1) {
      const { changed, removed } = localChanges(this.store.state().attendance, this.info);
      if (!changed.length && !removed.length) return sent;
      const records = changed.slice(0, PUSH_BATCH);
      const removedIds = removed.slice(0, REMOVE_BATCH);
      const result = await this.api.saveAttendance(token, { records, removed: removedIds });
      sent = true;
      // What we sent is now what the server has (the server may adjust it, handled below).
      for (const record of records) this.info.hashes[record.id] = recordHash(record);
      for (const id of removedIds) delete this.info.hashes[id];

      let attendance = this.store.state().attendance;
      if (result.dropped.length) {
        // The server refused these (for example a check-in outside the event day).
        const refused = new Set(result.dropped);
        attendance = attendance.filter((record) => !refused.has(record.id));
        for (const id of refused) delete this.info.hashes[id];
      }
      if (result.records.length) {
        attendance = applyPulled(attendance, this.info, { records: result.records, removed: [] });
      }
      this.store.replace({ ...this.store.state(), attendance }, false);
    }
    return sent;
  }
}
