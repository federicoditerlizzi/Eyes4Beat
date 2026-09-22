import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export class SqliteD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    this.sqlite.exec(readFileSync(new URL('../../migrations/0001_init.sql', import.meta.url), 'utf8'));
    this.sqlite.exec(readFileSync(new URL('../../migrations/0002_media_uploaders.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const db = this.sqlite;
    return { bind(...values) {
      const statement = db.prepare(sql);
      const bound = values.map(value => value === undefined ? null : value);
      return { first: async () => statement.get(...bound) || null,
        all: async () => ({ results: statement.all(...bound) }),
        run: async () => ({ meta: { changes: statement.run(...bound).changes } }),
        execute: () => statement.run(...bound) };
    } };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try { const result = statements.map(statement => statement.execute()); this.sqlite.exec('COMMIT'); return result; }
    catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}

export class FakeR2 {
  constructor() { this.objects = new Map(); }
  async put(key, bytes) { this.objects.set(key, new Uint8Array(bytes)); }
  async head(key) { return this.objects.has(key) ? { key } : null; }
  async get(key) { const bytes = this.objects.get(key); return bytes ? { body: bytes } : null; }
}
