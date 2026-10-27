import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
  capTask,
} from '@capacitor-community/sqlite';
import {
  SmsMessage,
  Student,
  SyncItem,
} from '../models/school-event.models';
import { DemoStoreService } from './demo-store.service';

const DATABASE_NAME = 'school_event_sms';
const BROWSER_STORAGE_KEY = 'school-event-sms-outbox-v1';
const DEFAULT_ACCOUNT_KEY = '__default__';
const INSERT_MESSAGE = `INSERT OR IGNORE INTO sms_messages
  (id, account_key, recipientName, recipientNumber, text, createdAt, status, syncStatus, eventId)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

@Injectable({ providedIn: 'root' })
export class SmsService {
  private readonly store = inject(DemoStoreService);
  readonly messages = signal<SmsMessage[]>([]);
  readonly ready = signal(false);
  readonly error = signal<string | null>(null);

  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private database?: SQLiteDBConnection;
  private storageReady?: Promise<void>;
  private accountKey = DEFAULT_ACCOUNT_KEY;

  async initialize(username?: string): Promise<void> {
    if (!this.storageReady) {
      this.storageReady = this.openStorage().catch((error: unknown) => {
        this.storageReady = undefined;
        this.reportError(error);
        throw error;
      });
    }
    await this.storageReady;
    const nextAccountKey =
      username === undefined
        ? this.accountKey
        : username.trim().toLowerCase() || DEFAULT_ACCOUNT_KEY;
    if (this.accountKey !== nextAccountKey || !this.ready()) {
      this.accountKey = nextAccountKey;
      await this.loadAccountMessages();
    }
  }

  async send(
    recipient: Student,
    text: string,
    online: boolean,
    eventId?: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const message: SmsMessage = {
      id: `SMS-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      eventId,
      recipientName: recipient.name,
      recipientNumber: recipient.mobile,
      text,
      createdAt: timestamp,
      status: online ? 'Sent' : 'Queued',
      syncStatus: online ? 'Synced' : 'Pending sync',
    };

    await this.saveMessages([message]);
    this.store.update((state) => {
      state.syncItems.push({
        id: `SYNC-${message.id}`,
        kind: 'sms',
        createdAt: timestamp,
        status: online ? 'Synced' : 'Pending sync',
      });
    });
  }

  async sendMany(
    recipients: Student[],
    text: (recipient: Student) => string,
    online: boolean,
    eventId?: string,
  ): Promise<void> {
    if (recipients.length === 0) return;

    const timestamp = new Date().toISOString();
    const messages = recipients.map((recipient) => ({
      id: `SMS-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      eventId,
      recipientName: recipient.name,
      recipientNumber: recipient.mobile,
      text: text(recipient),
      createdAt: timestamp,
      status: online ? ('Sent' as const) : ('Queued' as const),
      syncStatus: online ? ('Synced' as const) : ('Pending sync' as const),
    }));

    await this.saveMessages(messages);
    this.store.update((state) => {
      const items: SyncItem[] = messages.map((message) => ({
        id: `SYNC-${message.id}`,
        kind: 'sms',
        createdAt: timestamp,
        status: online ? 'Synced' : 'Pending sync',
      }));
      state.syncItems.push(...items);
    });
  }

  async markAllSynced(): Promise<void> {
    await this.initialize();
    try {
      if (this.database) {
        await this.database.run(
          "UPDATE sms_messages SET status = 'Sent', syncStatus = 'Synced' WHERE account_key = ?",
          [this.accountKey],
        );
      } else {
        const updated = this.messages().map((message) => ({
          ...message,
          status: 'Sent' as const,
          syncStatus: 'Synced' as const,
        }));
        this.writeBrowserMessages(updated);
      }
      this.messages.update((messages): SmsMessage[] =>
        messages.map((message) => ({
          ...message,
          status: 'Sent',
          syncStatus: 'Synced',
        })),
      );
      this.error.set(null);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  async clear(): Promise<void> {
    await this.initialize();
    try {
      if (this.database) {
        await this.database.run(
          'DELETE FROM sms_messages WHERE account_key = ?',
          [this.accountKey],
        );
      } else {
        localStorage.removeItem(this.browserStorageKey());
      }
      this.messages.set([]);
      this.error.set(null);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  async replaceFromSync(messages: SmsMessage[]): Promise<void> {
    await this.initialize();
    try {
      if (this.database) {
        await this.database.executeTransaction([
          {
            statement: 'DELETE FROM sms_messages WHERE account_key = ?',
            values: [this.accountKey],
          },
          ...messages.map((message) => this.insertTask(message)),
        ]);
      } else {
        this.writeBrowserMessages(messages);
      }
      this.messages.set(messages);
      this.error.set(null);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  reportError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.error.set(`SMS storage failed: ${detail}`);
  }

  private async openStorage(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await this.openDatabase();
    }
  }

  private async loadAccountMessages(): Promise<void> {
    const legacyMessages = this.store.state().messages;
    let messages: SmsMessage[];
    if (this.database) {
      if (this.accountKey !== DEFAULT_ACCOUNT_KEY) {
        const legacy = await this.database.query(
          `SELECT id, recipientName, recipientNumber, text, createdAt, status, syncStatus, eventId
           FROM sms_messages WHERE account_key = ? ORDER BY createdAt DESC`,
          [DEFAULT_ACCOUNT_KEY],
        );
        const legacyRows = this.readMessages(legacy.values ?? []);
        if (legacyRows.length > 0) {
          await this.database.executeTransaction([
            ...legacyRows.map((message) => this.insertTask(message)),
            {
              statement: 'DELETE FROM sms_messages WHERE account_key = ?',
              values: [DEFAULT_ACCOUNT_KEY],
            },
          ]);
        }
      }
      if (legacyMessages.length > 0) {
        await this.database.executeTransaction(
          legacyMessages.map((message) => this.insertTask(message)),
        );
      }
      const result = await this.database.query(
        `SELECT id, recipientName, recipientNumber, text, createdAt, status, syncStatus, eventId
         FROM sms_messages WHERE account_key = ?
         ORDER BY createdAt DESC, rowid DESC`,
        [this.accountKey],
      );
      messages = this.readMessages(result.values ?? []);
    } else {
      const storageKey = this.browserStorageKey();
      let saved = localStorage.getItem(storageKey);
      const migratingLegacyStorage =
        saved === null &&
        this.accountKey !== DEFAULT_ACCOUNT_KEY &&
        localStorage.getItem(BROWSER_STORAGE_KEY) !== null;
      if (saved === null && this.accountKey !== DEFAULT_ACCOUNT_KEY) {
        saved = localStorage.getItem(BROWSER_STORAGE_KEY);
      }
      messages =
        saved === null ? legacyMessages : this.parseBrowserMessages(saved);
      if (legacyMessages.length > 0) {
        const merged = new Map(messages.map((message) => [message.id, message]));
        legacyMessages.forEach((message) => merged.set(message.id, message));
        messages = [...merged.values()].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        );
      }
      this.writeBrowserMessages(messages);
      if (migratingLegacyStorage) {
        localStorage.removeItem(BROWSER_STORAGE_KEY);
      }
    }

    if (legacyMessages.length > 0) {
      this.store.update((state) => {
        state.messages = [];
      });
    }
    this.messages.set(messages);
    this.ready.set(true);
    this.error.set(null);
  }

  private async openDatabase(): Promise<SQLiteDBConnection> {
    const consistent = await this.sqlite.checkConnectionsConsistency();
    const connected = await this.sqlite.isConnection(DATABASE_NAME, false);
    const database =
      consistent.result && connected.result
        ? await this.sqlite.retrieveConnection(DATABASE_NAME, false)
        : await this.sqlite.createConnection(
            DATABASE_NAME,
            false,
            'no-encryption',
            1,
            false,
          );

    if (!(await database.isDBOpen()).result) await database.open();
    await database.execute(`CREATE TABLE IF NOT EXISTS sms_messages (
      id TEXT PRIMARY KEY NOT NULL,
      account_key TEXT NOT NULL DEFAULT '${DEFAULT_ACCOUNT_KEY}',
      recipientName TEXT NOT NULL,
      recipientNumber TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('Queued', 'Sent')),
      syncStatus TEXT NOT NULL CHECK (syncStatus IN ('Pending sync', 'Synced')),
      eventId TEXT
    )`);
    const columns = await database.query('PRAGMA table_info(sms_messages)');
    const hasAccountKey = (columns.values ?? []).some(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        'name' in row &&
        row.name === 'account_key',
    );
    if (!hasAccountKey) {
      await database.execute(
        `ALTER TABLE sms_messages ADD COLUMN account_key TEXT NOT NULL DEFAULT '${DEFAULT_ACCOUNT_KEY}'`,
      );
    }
    const hasEventId = (columns.values ?? []).some(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        'name' in row &&
        row.name === 'eventId',
    );
    if (!hasEventId) {
      await database.execute('ALTER TABLE sms_messages ADD COLUMN eventId TEXT');
    }
    this.database = database;
    return database;
  }

  private async saveMessages(messages: SmsMessage[]): Promise<void> {
    await this.initialize();
    try {
      if (this.database) {
        const tasks: capTask[] = messages.map((message) =>
          this.insertTask(message),
        );
        await this.database.executeTransaction(tasks);
      } else {
        this.writeBrowserMessages([...messages, ...this.messages()]);
      }
      this.messages.update((current) => [...messages, ...current]);
      this.error.set(null);
    } catch (error) {
      this.reportError(error);
      throw error;
    }
  }

  private insertTask(message: SmsMessage): capTask {
    return {
      statement: INSERT_MESSAGE,
      values: [
        message.id,
        this.accountKey,
        message.recipientName,
        message.recipientNumber,
        message.text,
        message.createdAt,
        message.status,
        message.syncStatus,
        message.eventId ?? null,
      ],
    };
  }

  private readMessages(rows: unknown[]): SmsMessage[] {
    return rows.map((row) => {
      if (!this.isSmsMessage(row)) {
        throw new Error('The SMS database contains an invalid message row.');
      }
      return row.eventId === null ? { ...row, eventId: undefined } : row;
    });
  }

  private parseBrowserMessages(serialized: string): SmsMessage[] {
    const parsed: unknown = JSON.parse(serialized);
    if (!Array.isArray(parsed) || !parsed.every((row) => this.isSmsMessage(row))) {
      throw new Error('The browser SMS outbox contains invalid data.');
    }
    return parsed;
  }

  private isSmsMessage(value: unknown): value is SmsMessage {
    if (typeof value !== 'object' || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
      typeof row['id'] === 'string' &&
      (row['eventId'] === undefined || row['eventId'] === null || typeof row['eventId'] === 'string') &&
      typeof row['recipientName'] === 'string' &&
      typeof row['recipientNumber'] === 'string' &&
      typeof row['text'] === 'string' &&
      typeof row['createdAt'] === 'string' &&
      (row['status'] === 'Queued' || row['status'] === 'Sent') &&
      (row['syncStatus'] === 'Pending sync' || row['syncStatus'] === 'Synced')
    );
  }

  private writeBrowserMessages(messages: SmsMessage[]): void {
    localStorage.setItem(this.browserStorageKey(), JSON.stringify(messages));
  }

  private browserStorageKey(): string {
    return `${BROWSER_STORAGE_KEY}:${this.accountKey}`;
  }
}
