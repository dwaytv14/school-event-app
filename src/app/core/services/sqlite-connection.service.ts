import { Injectable } from '@angular/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  SQLiteDBConnection,
} from '@capacitor-community/sqlite';

@Injectable({ providedIn: 'root' })
export class SqliteConnectionService {
  private readonly sqlite = new SQLiteConnection(CapacitorSQLite);
  private readonly connections = new Map<
    string,
    Promise<SQLiteDBConnection>
  >();
  private opening = Promise.resolve();

  open(databaseName: string): Promise<SQLiteDBConnection> {
    const existing = this.connections.get(databaseName);
    if (existing) return existing;

    const connection = this.opening.then(() =>
      this.openConnection(databaseName),
    );
    this.opening = connection.then(
      () => undefined,
      () => undefined,
    );
    this.connections.set(databaseName, connection);
    void connection.catch(() => {
      if (this.connections.get(databaseName) === connection) {
        this.connections.delete(databaseName);
      }
    });
    return connection;
  }

  private async openConnection(
    databaseName: string,
  ): Promise<SQLiteDBConnection> {
    const consistency = await this.sqlite.checkConnectionsConsistency();
    const exists = await this.sqlite.isConnection(databaseName, false);
    const database =
      consistency.result && exists.result
        ? await this.sqlite.retrieveConnection(databaseName, false)
        : await this.sqlite.createConnection(
            databaseName,
            false,
            'no-encryption',
            1,
            false,
          );

    if (!(await database.isDBOpen()).result) await database.open();
    return database;
  }
}
