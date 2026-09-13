/// <reference types="bun-types" />

import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";

setDefaultTimeout(30_000);
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCompartments } from "../../features/magic-context/compartment-storage";
import { closeDatabase, openDatabase } from "../../features/magic-context/storage";
import { setPersistedCompactionMarkerState } from "../../features/magic-context/storage-meta-persisted";
import { Database } from "../../shared/sqlite";
import { closeQuietly } from "../../shared/sqlite-helpers";
import {
    assertNoInheritedMagicContextMarker,
    InheritedMagicContextMarkerError,
} from "./inherited-compaction-marker-guard";

const tempDirs: string[] = [];
const originalXdgDataHome = process.env.XDG_DATA_HOME;

function setup(): { sessionId: string; contextDb: ReturnType<typeof openDatabase>; openCodeDb: Database } {
    const dir = mkdtempSync(join(tmpdir(), "mc-inherited-marker-"));
    tempDirs.push(dir);
    process.env.XDG_DATA_HOME = dir;
    mkdirSync(join(dir, "opencode"), { recursive: true });
    const openCodeDb = new Database(join(dir, "opencode", "opencode.db"));
    openCodeDb.exec("CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    openCodeDb.exec("CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
    return { sessionId: "ses-fork", contextDb: openDatabase(), openCodeDb };
}

function addMarker(
    db: Database,
    sessionId: string,
    providerID = "magic-context",
    suffix = "",
    time = 100,
): void {
    const boundary = `msg-boundary${suffix}`;
    const summary = `msg-summary${suffix}`;
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
        boundary,
        sessionId,
        time,
        time,
        JSON.stringify({ role: "user" }),
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
        `prt-compaction${suffix}`,
        boundary,
        sessionId,
        time + 1,
        time + 1,
        JSON.stringify({ type: "compaction" }),
    );
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
        summary,
        sessionId,
        time + 2,
        time + 2,
        JSON.stringify({
            role: "assistant",
            parentID: boundary,
            summary: true,
            finish: "stop",
            providerID,
        }),
    );
}

afterEach(() => {
    closeDatabase();
    if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = originalXdgDataHome;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    tempDirs.length = 0;
});

describe("inherited Magic Context marker guard", () => {
    it("refuses a first primary transform when a completed MC marker has no owned state", () => {
        const { sessionId, contextDb, openCodeDb } = setup();
        addMarker(openCodeDb, sessionId);
        closeQuietly(openCodeDb);

        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).toThrow(InheritedMagicContextMarkerError);
        try {
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            });
        } catch (error) {
            expect((error as InheritedMagicContextMarkerError).code).toBe(
                "INHERITED_MC_COMPACTION_MARKER",
            );
            expect((error as Error).message).toContain("silently lose pre-fork history");
        }
    });

    it("does not refuse ordinary roots, native markers, or later passes", () => {
        const cases = [
            { marker: false, firstTransform: true, isSubagent: false, compactionOff: false },
            { marker: true, firstTransform: false, isSubagent: false, compactionOff: false },
        ];
        for (const [index, item] of cases.entries()) {
            closeDatabase();
            const state = setup();
            if (item.marker) addMarker(state.openCodeDb, state.sessionId);
            closeQuietly(state.openCodeDb);
            expect(() =>
                assertNoInheritedMagicContextMarker({
                    db: state.contextDb,
                    sessionId: state.sessionId,
                    firstTransform: item.firstTransform,
                    isSubagent: item.isSubagent,
                    compactionOff: item.compactionOff,
                }),
            ).not.toThrow();
        }

        closeDatabase();
        const native = setup();
        addMarker(native.openCodeDb, native.sessionId, "anthropic");
        closeQuietly(native.openCodeDb);
        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: native.contextDb,
                sessionId: native.sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).not.toThrow();
    });

    it("accepts a completed MC marker when destination owns corresponding marker state", () => {
        const { sessionId, contextDb, openCodeDb } = setup();
        addMarker(openCodeDb, sessionId);
        closeQuietly(openCodeDb);
        appendCompartments(contextDb, sessionId, [
            {
                sequence: 1,
                startMessage: 1,
                endMessage: 12,
                startMessageId: "msg-start",
                endMessageId: "msg-end",
                title: "owned",
                content: "owned history",
            },
        ]);
        setPersistedCompactionMarkerState(contextDb, sessionId, {
            boundaryMessageId: "msg-boundary",
            summaryMessageId: "msg-summary",
            compactionPartId: "prt-compaction",
            summaryPartId: "prt-summary",
            boundaryOrdinal: 12,
            targetEndMessageId: "msg-end",
        });

        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).not.toThrow();
    });
    it("rejects unrelated persisted marker state instead of treating any state as ownership", () => {
        const { sessionId, contextDb, openCodeDb } = setup();
        addMarker(openCodeDb, sessionId);
        closeQuietly(openCodeDb);
        setPersistedCompactionMarkerState(contextDb, sessionId, {
            boundaryMessageId: "different-boundary",
            summaryMessageId: "different-summary",
            compactionPartId: "different-part",
            summaryPartId: "different-summary-part",
            boundaryOrdinal: 3,
            targetEndMessageId: "different-end",
        });

        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).toThrow(InheritedMagicContextMarkerError);
    });

    it("does not bypass an unowned marker for subagent or compaction-off classifications", () => {
        for (const overrides of [
            { isSubagent: true, compactionOff: false },
            { isSubagent: false, compactionOff: true },
        ]) {
            closeDatabase();
            const state = setup();
            addMarker(state.openCodeDb, state.sessionId);
            closeQuietly(state.openCodeDb);
            expect(() =>
                assertNoInheritedMagicContextMarker({
                    db: state.contextDb,
                    sessionId: state.sessionId,
                    firstTransform: true,
                    ...overrides,
                }),
            ).toThrow(InheritedMagicContextMarkerError);
        }
    });


    it("rejects an exact marker blob when the covered compartment is missing", () => {
        const { sessionId, contextDb, openCodeDb } = setup();
        addMarker(openCodeDb, sessionId);
        closeQuietly(openCodeDb);
        setPersistedCompactionMarkerState(contextDb, sessionId, {
            boundaryMessageId: "msg-boundary",
            summaryMessageId: "msg-summary",
            compactionPartId: "prt-compaction",
            summaryPartId: "prt-summary",
            boundaryOrdinal: 12,
            targetEndMessageId: "msg-end",
        });
        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).toThrow(InheritedMagicContextMarkerError);
    });


    it("requires ownership of the newest effective marker when an older marker also exists", () => {
        const { sessionId, contextDb, openCodeDb } = setup();
        addMarker(openCodeDb, sessionId, "magic-context", "-old", 100);
        addMarker(openCodeDb, sessionId, "magic-context", "-new", 200);
        closeQuietly(openCodeDb);
        appendCompartments(contextDb, sessionId, [
            {
                sequence: 1,
                startMessage: 1,
                endMessage: 12,
                startMessageId: "msg-start",
                endMessageId: "msg-end",
                title: "owned old history",
                content: "owned old history",
            },
        ]);
        setPersistedCompactionMarkerState(contextDb, sessionId, {
            boundaryMessageId: "msg-boundary-old",
            summaryMessageId: "msg-summary-old",
            compactionPartId: "prt-compaction-old",
            summaryPartId: "prt-summary-old",
            boundaryOrdinal: 12,
            targetEndMessageId: "msg-end",
        });
        expect(() =>
            assertNoInheritedMagicContextMarker({
                db: contextDb,
                sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            }),
        ).toThrow(InheritedMagicContextMarkerError);
    });

    it("fails closed when marker inspection cannot prove ownership", () => {
        const state = setup();
        state.openCodeDb.exec("DROP TABLE message");
        closeQuietly(state.openCodeDb);
        try {
            assertNoInheritedMagicContextMarker({
                db: state.contextDb,
                sessionId: state.sessionId,
                firstTransform: true,
                isSubagent: false,
                compactionOff: false,
            });
            throw new Error("expected inspection refusal");
        } catch (error) {
            expect(error).toBeInstanceOf(InheritedMagicContextMarkerError);
            expect((error as InheritedMagicContextMarkerError).code).toBe(
                "MC_MARKER_INSPECTION_FAILED",
            );
        }
    });

});
