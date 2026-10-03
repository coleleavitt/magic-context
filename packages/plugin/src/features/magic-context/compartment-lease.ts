import { sessionLog } from "../../shared/logger";
import { isPidAlive } from "../../shared/rpc-utils";
import type { Database } from "../../shared/sqlite";

export const COMPARTMENT_LEASE_TTL_MS = 5 * 60 * 1000;
export const COMPARTMENT_LEASE_RENEWAL_MS = 60 * 1000;

export interface LeaseAcquired {
    sessionId: string;
    holderId: string;
    acquiredAt: number;
    expiresAt: number;
    ownerPid: number;
}

export interface CompartmentLeaseBlocker {
    holderId: string;
    ownerPid: number | null;
    acquiredAt: number;
    expiresAt: number;
}

export function getCompartmentLeaseBlocker(
    db: Database,
    sessionId: string,
): CompartmentLeaseBlocker | null {
    const row = db
        .prepare(
            `SELECT holder_id AS holderId, owner_pid AS ownerPid,
                    acquired_at AS acquiredAt, expires_at AS expiresAt
               FROM compartment_state_lease
              WHERE session_id = ? AND expires_at > ?`,
        )
        .get(sessionId, Date.now()) as CompartmentLeaseBlocker | undefined;
    return row ?? null;
}

const HOLDER_PID_SUFFIX = "#pid=";

/**
 * A holder id that carries the owning pid so a lease left behind by a process
 * that died (a forced daemon shutdown, a crash) can be reclaimed at once
 * instead of stalling the historian for the full TTL. The database is host
 * local, so a pid check is meaningful; ids without the suffix (older
 * processes, remote holders) keep TTL-only semantics.
 */
export function createCompartmentLeaseHolderId(random: string): string {
    return `${random}${HOLDER_PID_SUFFIX}${process.pid}`;
}

export function holderPid(holderId: string): number | undefined {
    const index = holderId.lastIndexOf(HOLDER_PID_SUFFIX);
    if (index < 0) return undefined;
    const pid = Number(holderId.slice(index + HOLDER_PID_SUFFIX.length));
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM: the process exists but belongs to another user -> alive.
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Drop a live-looking lease whose holder process is gone. Returns true when a
 * row was removed. Never throws; a failed check just falls back to the TTL.
 */
export function reclaimDeadHolderLease(db: Database, sessionId: string, now = Date.now()): boolean {
    try {
        const row = db
            .prepare(
                "SELECT holder_id AS holderId FROM compartment_state_lease WHERE session_id = ? AND expires_at > ?",
            )
            .get(sessionId, now) as { holderId: string } | undefined;
        if (!row) return false;
        const pid = holderPid(row.holderId);
        if (pid === undefined || pid === process.pid || processAlive(pid)) return false;
        const result = db
            .prepare("DELETE FROM compartment_state_lease WHERE session_id = ? AND holder_id = ?")
            .run(sessionId, row.holderId);
        return result.changes === 1;
    } catch {
        return false;
    }
}

export function acquireCompartmentLease(
    db: Database,
    sessionId: string,
    holderId: string,
): LeaseAcquired | null {
    const acquiredAt = Date.now();
    reclaimDeadHolderLease(db, sessionId, acquiredAt);
    const expiresAt = acquiredAt + COMPARTMENT_LEASE_TTL_MS;
    const ownerPid = process.pid;
    const blocker = getCompartmentLeaseBlocker(db, sessionId);
    if (blocker?.ownerPid && isPidAlive(blocker.ownerPid) === "dead") {
        const reclaimed = db
            .prepare(
                `DELETE FROM compartment_state_lease
                  WHERE session_id = ? AND holder_id = ? AND owner_pid = ?
                    AND acquired_at = ? AND expires_at = ?`,
            )
            .run(
                sessionId,
                blocker.holderId,
                blocker.ownerPid,
                blocker.acquiredAt,
                blocker.expiresAt,
            );
        if (reclaimed.changes === 1) {
            sessionLog(
                sessionId,
                `reclaimed compartment lease from dead owner holder=${blocker.holderId} pid=${blocker.ownerPid}`,
            );
        }
    }
    const result = db
        .prepare(
            `INSERT INTO compartment_state_lease
                (session_id, holder_id, owner_pid, acquired_at, expires_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                holder_id = excluded.holder_id,
                owner_pid = excluded.owner_pid,
                acquired_at = excluded.acquired_at,
                expires_at = excluded.expires_at
             WHERE compartment_state_lease.holder_id = excluded.holder_id
                OR compartment_state_lease.expires_at <= ?`,
        )
        .run(sessionId, holderId, ownerPid, acquiredAt, expiresAt, acquiredAt);

    if (result.changes !== 1) {
        return null;
    }

    return { sessionId, holderId, acquiredAt, expiresAt, ownerPid };
}

export function renewCompartmentLease(db: Database, sessionId: string, holderId: string): boolean {
    const now = Date.now();
    const expiresAt = now + COMPARTMENT_LEASE_TTL_MS;
    const result = db
        .prepare(
            `UPDATE compartment_state_lease
             SET expires_at = ?, acquired_at = ?
             WHERE session_id = ? AND holder_id = ? AND expires_at > ?`,
        )
        .run(expiresAt, now, sessionId, holderId, now);
    return result.changes === 1;
}

export function releaseCompartmentLease(db: Database, sessionId: string, holderId: string): void {
    db.prepare("DELETE FROM compartment_state_lease WHERE session_id = ? AND holder_id = ?").run(
        sessionId,
        holderId,
    );
}

/**
 * A failed release is safe: another holder can reclaim the row after its TTL passes.
 * Do not let transient SQLite contention turn cleanup into an unhandled background failure.
 */
export function releaseCompartmentLeaseBestEffort(
    db: Database,
    sessionId: string,
    holderId: string,
    log: typeof sessionLog = sessionLog,
): void {
    try {
        releaseCompartmentLease(db, sessionId, holderId);
    } catch (err) {
        log(
            sessionId,
            `lease release failed (${err instanceof Error ? err.message : String(err)}); row expires on its TTL`,
        );
    }
}

export function isCompartmentLeaseHeld(db: Database, sessionId: string, holderId: string): boolean {
    const row = db
        .prepare(
            "SELECT 1 FROM compartment_state_lease WHERE session_id = ? AND holder_id = ? AND expires_at > ?",
        )
        .get(sessionId, holderId, Date.now());
    return row != null;
}
