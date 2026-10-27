import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { AppState } from '../models/school-event.models';
import { WorkspaceSnapshot } from './workspace-api.service';

const DATABASE_NAME = 'school_event_device';
const BROWSER_CACHE_KEY = 'school-event-workspace-cache-v1';

export interface CachedWorkspace {
  snapshot: WorkspaceSnapshot;
  dirty: boolean;
  resetPending: boolean;
}

@Injectable({ providedIn: 'root' })
export class DeviceStateService {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private database?: SQLiteDBConnection;

  async load(username: string): Promise<CachedWorkspace | null> {
    const key = this.accountKey(username);
    if (Capacitor.isNativePlatform()) {
      const database = await this.open();
      const result = await database.query(
        'SELECT snapshot_json, dirty FROM workspace_cache WHERE account_key = ?',
        [key],
      );
      const row = result.values?.[0] as
        | { snapshot_json?: unknown; dirty?: unknown }
        | undefined;
      if (typeof row?.snapshot_json !== 'string') return null;
      const saved: unknown = JSON.parse(row.snapshot_json);
      if (this.isStoredWorkspace(saved)) {
        return {
          snapshot: saved.snapshot,
          dirty: Number(row.dirty) === 1,
          resetPending: saved.resetPending,
        };
      }
      return {
        snapshot: this.parseSnapshot(row.snapshot_json),
        dirty: Number(row.dirty) === 1,
        resetPending: false,
      };
    }

    const saved = localStorage.getItem(`${BROWSER_CACHE_KEY}:${key}`);
    if (saved === null) return null;
    const value: unknown = JSON.parse(saved);
    if (this.isCachedWorkspace(value)) return value;
    if (this.isLegacyCachedWorkspace(value)) {
      return { ...value, resetPending: false };
    }
    throw new Error('The saved offline workspace data is invalid.');
  }

  async save(
    username: string,
    state: AppState,
    revision: number,
    dirty: boolean,
    resetPending = false,
  ): Promise<void> {
    const key = this.accountKey(username);
    const snapshot = this.createSnapshot(state, revision);
    const serialized = JSON.stringify({ snapshot, dirty, resetPending });
    if (Capacitor.isNativePlatform()) {
      const database = await this.open();
      await database.run(
        `INSERT INTO workspace_cache (account_key, snapshot_json, dirty)
         VALUES (?, ?, ?)
         ON CONFLICT(account_key) DO UPDATE SET
           snapshot_json = excluded.snapshot_json,
           dirty = excluded.dirty`,
        [key, serialized, dirty ? 1 : 0],
      );
      return;
    }
    localStorage.setItem(`${BROWSER_CACHE_KEY}:${key}`, serialized);
  }

  createSnapshot(state: AppState, revision: number): WorkspaceSnapshot {
    return {
      revision,
      state: {
        students: state.students,
        events: state.events,
        attendance: state.attendance,
        violations: state.violations,
        messages: state.messages,
        syncItems: state.syncItems,
      },
    };
  }

  private async open(): Promise<SQLiteDBConnection> {
    if (this.database) return this.database;
    const consistency = await this.sqlite.checkConnectionsConsistency();
    const exists = await this.sqlite.isConnection(DATABASE_NAME, false);
    const database =
      consistency.result && exists.result
        ? await this.sqlite.retrieveConnection(DATABASE_NAME, false)
        : await this.sqlite.createConnection(
            DATABASE_NAME,
            false,
            'no-encryption',
            1,
            false,
          );
    if (!(await database.isDBOpen()).result) await database.open();
    await database.execute(`CREATE TABLE IF NOT EXISTS workspace_cache (
      account_key TEXT PRIMARY KEY NOT NULL,
      snapshot_json TEXT NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 0
    )`);
    this.database = database;
    return database;
  }

  private parseSnapshot(serialized: string): WorkspaceSnapshot {
    const parsed: unknown = JSON.parse(serialized);
    if (!this.isSnapshot(parsed)) {
      throw new Error('The saved offline workspace snapshot is invalid.');
    }
    return parsed;
  }

  private isCachedWorkspace(value: unknown): value is CachedWorkspace {
    return (
      typeof value === 'object' &&
      value !== null &&
      'dirty' in value &&
      typeof value.dirty === 'boolean' &&
      'resetPending' in value &&
      typeof value.resetPending === 'boolean' &&
      'snapshot' in value &&
      this.isSnapshot(value.snapshot)
    );
  }

  private isLegacyCachedWorkspace(
    value: unknown,
  ): value is Omit<CachedWorkspace, 'resetPending'> {
    return (
      typeof value === 'object' &&
      value !== null &&
      'dirty' in value &&
      typeof value.dirty === 'boolean' &&
      !('resetPending' in value) &&
      'snapshot' in value &&
      this.isSnapshot(value.snapshot)
    );
  }

  private isStoredWorkspace(
    value: unknown,
  ): value is { snapshot: WorkspaceSnapshot; resetPending: boolean } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'resetPending' in value &&
      typeof value.resetPending === 'boolean' &&
      'snapshot' in value &&
      this.isSnapshot(value.snapshot)
    );
  }

  private isSnapshot(value: unknown): value is WorkspaceSnapshot {
    if (typeof value !== 'object' || value === null) return false;
    const snapshot = value as Partial<WorkspaceSnapshot>;
    const state = snapshot.state;
    return (
      typeof snapshot.revision === 'number' &&
      typeof state === 'object' &&
      state !== null &&
      ['students', 'events', 'attendance', 'violations', 'messages', 'syncItems']
        .every((key) => Array.isArray(state[key as keyof typeof state]))
    );
  }

  private accountKey(username: string): string {
    return username.trim().toLowerCase();
  }
}
