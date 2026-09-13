import { isRecord } from "./record-type-guard";

export const PROVIDER_CONTEXT_EDITS_CONFLICT_MESSAGE =
    "Magic Context cannot run while Anthropic context management edits are enabled. " +
    "Remove contextManagement.edits/context_management.edits, or disable Magic Context compaction. " +
    "The request was blocked because provider-side edits can rewrite history below Magic Context's transform.";

/** A request-level ownership conflict that must block, rather than sanitize, the request. */
export class ProviderContextEditsConflictError extends Error {
    constructor() {
        super(PROVIDER_CONTEXT_EDITS_CONFLICT_MESSAGE);
        this.name = "ProviderContextEditsConflictError";
    }
}

function hasActiveOrMalformedEdits(value: unknown): boolean {
    if (!isRecord(value) || !Object.hasOwn(value, "edits")) return false;
    // A provably empty SDK default cannot rewrite history. Unknown/malformed
    // declarations fail closed because a later provider version could interpret
    // them, and Magic Context cannot safely share history ownership.
    return !Array.isArray(value.edits) || value.edits.length > 0;
}

function hasContextEdits(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return (
        hasActiveOrMalformedEdits(value.contextManagement) ||
        hasActiveOrMalformedEdits(value.context_management)
    );
}

/**
 * Guard OpenCode's last provider-option seam available to this plugin.
 *
 * `output.options` is normally the flat effective model option object. Some
 * OpenCode/provider versions expose an already-namespaced Anthropic object, so
 * both shapes are checked. This hook cannot see edits added by a different
 * plugin whose `chat.params` handler runs after Magic Context.
 */
export function assertNoOpenCodeProviderContextEdits<T>(
    _model: { providerID?: string; api?: { npm?: string } },
    options: T,
    compactionOff: boolean,
): T {
    if (compactionOff) return options;
    const conflict =
        hasContextEdits(options) || (isRecord(options) && hasContextEdits(options.anthropic));
    if (conflict) throw new ProviderContextEditsConflictError();
    return options;
}

/**
 * Guard Pi's raw provider payload at its final extension seam. `ctx.abort()` is
 * required because Pi catches extension exceptions; the throw still records a
 * loud extension error. A later-loaded extension can still add edits after this
 * handler, which Pi's hook ordering does not let Magic Context inspect.
 */
export function guardPiProviderContextEdits<T>(
    payload: T,
    compactionOff: boolean,
    abort: () => void,
): T {
    if (compactionOff || !hasContextEdits(payload)) return payload;
    abort();
    throw new ProviderContextEditsConflictError();
}
