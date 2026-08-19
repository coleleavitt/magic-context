/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { Database } from "../../shared/sqlite";
import { closeQuietly } from "../../shared/sqlite-helpers";
import { LATEST_MIGRATION_VERSION, runMigrations } from "./migrations";
import { initializeDatabase, LATEST_SUPPORTED_VERSION } from "./storage-db";

function seedAppliedVersion(db: Database, version: number): void {
    db.exec(`
        CREATE TABLE schema_migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        );
    `);
    const insert = db.prepare(
        "INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)",
    );
    for (let current = 1; current <= version; current += 1) {
        insert.run(current, `seed v${current}`, Date.now());
    }
}

function columnNames(db: Database, table: string): string[] {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
        (column) => column.name,
    );
}

describe("migration v80: tokenless usage observation timestamp", () => {
    test("fresh databases include the timestamp and align the schema fence", () => {
        const db = new Database(":memory:");
        try {
            initializeDatabase(db);
            runMigrations(db);

            expect(columnNames(db, "session_meta")).toContain("last_usage_observed_at");
            expect(LATEST_SUPPORTED_VERSION).toBe(80);
            expect(LATEST_SUPPORTED_VERSION).toBe(LATEST_MIGRATION_VERSION);
        } finally {
            closeQuietly(db);
        }
    });

    test("replaying from v79 adds the timestamp once with a fail-closed default", () => {
        const db = new Database(":memory:");
        try {
            seedAppliedVersion(db, 79);
            db.exec(`
                CREATE TABLE session_meta (
                    session_id TEXT PRIMARY KEY,
                    last_context_percentage REAL DEFAULT 0,
                    last_input_tokens INTEGER DEFAULT 0,
                    last_response_time INTEGER
                );
                INSERT INTO session_meta (
                    session_id, last_context_percentage, last_input_tokens, last_response_time
                ) VALUES ('ses-legacy', 50, 50000, 123);
            `);

            runMigrations(db);
            runMigrations(db);

            expect(
                db
                    .prepare("SELECT last_usage_observed_at FROM session_meta WHERE session_id = ?")
                    .get("ses-legacy"),
            ).toEqual({ last_usage_observed_at: 0 });
            expect(
                db
                    .prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 80")
                    .get(),
            ).toEqual({ count: 1 });
        } finally {
            closeQuietly(db);
        }
    });
});
