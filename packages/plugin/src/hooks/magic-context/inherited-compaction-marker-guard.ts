import { getCompartments } from "../../features/magic-context/compartment-storage";
import { listSessionCompactionMarkers } from "../../features/magic-context/compaction-marker";
import type { ContextDatabase } from "../../features/magic-context/storage";
import { getPersistedCompactionMarkerState } from "../../features/magic-context/storage-meta-persisted";

export const INHERITED_MC_MARKER_MESSAGE =
    "Magic Context refused this request because the session contains a completed Magic Context compaction marker but this fork owns no matching context state. Continuing could silently lose pre-fork history. Return to the source session, or migrate/rebuild the fork with Magic Context state before retrying.";

/**
 * A forked OpenCode session can inherit the source session's completed marker rows
 * without inheriting Magic Context's session-scoped database state. OpenCode hides
 * everything before that marker before this transform receives the message array,
 * so raw passthrough or marker deletion would both silently change history.
 */
export class InheritedMagicContextMarkerError extends Error {
    readonly code: "INHERITED_MC_COMPACTION_MARKER" | "MC_MARKER_INSPECTION_FAILED";
    readonly recoverable = false;

    constructor(
        readonly sessionId: string,
        options?: { inspectionFailure?: unknown },
    ) {
        const inspectionFailed = options && "inspectionFailure" in options;
        super(
            inspectionFailed
                ? "Magic Context could not verify compaction-marker ownership, so this request was blocked rather than risk serving incomplete history. Retry after the storage error is resolved."
                : INHERITED_MC_MARKER_MESSAGE,
            inspectionFailed ? { cause: options.inspectionFailure } : undefined,
        );
        this.code = inspectionFailed
            ? "MC_MARKER_INSPECTION_FAILED"
            : "INHERITED_MC_COMPACTION_MARKER";
        this.name = "InheritedMagicContextMarkerError";
    }
}

function destinationOwnsMarkerState(
    db: ContextDatabase,
    sessionId: string,
    markers: ReturnType<typeof listSessionCompactionMarkers>,
): boolean {
    const persisted = getPersistedCompactionMarkerState(db, sessionId);
    const effectiveMarker = markers.at(-1);
    if (
        !persisted ||
        !effectiveMarker ||
        effectiveMarker.compactionPartId !== persisted.compactionPartId ||
        effectiveMarker.boundaryMessageId !== persisted.boundaryMessageId ||
        !effectiveMarker.summaryMessageIds.includes(persisted.summaryMessageId)
    ) {
        return false;
    }
    const compartments = getCompartments(db, sessionId);
    return compartments.some(
        (compartment) =>
            compartment.endMessage === persisted.boundaryOrdinal &&
            (persisted.targetEndMessageId === null ||
                compartment.endMessageId === persisted.targetEndMessageId),
    );
}

/** Run once, before either the TypeScript or Rust transform may dispatch. */
export function assertNoInheritedMagicContextMarker(args: {
    db: ContextDatabase;
    sessionId: string;
    firstTransform: boolean;
    isSubagent: boolean;
    compactionOff: boolean;
    /** Production OpenCode transforms always have a client; false is the headless unit-test seam. */
    inspectionEnabled?: boolean;
}): void {
    if (args.inspectionEnabled === false || !args.firstTransform) return;
    try {
        const markers = listSessionCompactionMarkers(args.sessionId);
        if (markers.length === 0) return;
        if (destinationOwnsMarkerState(args.db, args.sessionId, markers)) return;
        throw new InheritedMagicContextMarkerError(args.sessionId);
    } catch (error) {
        if (error instanceof InheritedMagicContextMarkerError) throw error;
        throw new InheritedMagicContextMarkerError(args.sessionId, {
            inspectionFailure: error,
        });
    }
}
