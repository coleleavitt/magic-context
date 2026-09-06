/**
 * Optional bridge to the host's trace context (Prime Agent's pi-ai exposes
 * `withSpan` / `currentSpan`; stock Pi may not). Everything here degrades to a
 * plain call when the host has no tracing, so the plugin keeps loading on
 * older hosts. Spans land in the host's trace log next to `llm.request`, which
 * is what makes a context transform visible in `prime-agent trace <id>`:
 * messages in/out, the usage the transform saw, and its duration.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
interface SpanLike {
	setAttributes(attrs: Attrs): void;
	recordError(error: unknown): void;
}
interface TraceApi {
	withSpan<T>(
		name: string,
		attrs: Attrs | undefined,
		fn: (span: SpanLike) => T,
	): T;
	currentSpan?: () => SpanLike | undefined;
}

let api: TraceApi | null | undefined;

/** Test seam: force the bridge to use `next` (null = no tracing, undefined = re-resolve). */
export function configureTraceApiForTests(
	next: TraceApi | null | undefined,
): void {
	api = next;
}

async function resolve(): Promise<TraceApi | null> {
	if (api !== undefined) return api;
	try {
		// Must stay a bare specifier and be marked --external in the bun build:
		// if pi-ai is inlined into dist, this resolves to a private copy whose
		// span sink is never installed, and every span here goes nowhere.
		const mod = (await import("@earendil-works/pi-ai")) as Partial<TraceApi>;
		api = typeof mod.withSpan === "function" ? (mod as TraceApi) : null;
	} catch {
		api = null;
	}
	return api;
}

/** Run `fn` inside a host span when tracing is available, else directly. */
export async function tracedContextPass<T>(
	name: string,
	attrs: Attrs,
	fn: () => Promise<T>,
): Promise<T> {
	const trace = await resolve();
	if (!trace) return fn();
	return trace.withSpan(name, attrs, () => fn());
}

/** Merge attributes onto the active host span (no-op without tracing). */
export function setContextSpanAttributes(attrs: Attrs): void {
	try {
		api?.currentSpan?.()?.setAttributes(attrs);
	} catch {
		// tracing must never affect the transform
	}
}

/** Attribute bag accepted by the trace helpers. */
export type TraceAttrs = Attrs;

/**
 * Handle for the span opened by {@link tracedSpan}. Every method swallows
 * host errors, so callers can stamp attributes unconditionally.
 */
export interface TraceSpan {
	/** Merge attributes onto this span (no-op without tracing). */
	setAttributes(attrs: Attrs): void;
	/** Mark this span failed (the host reports it with `status: "error"`). */
	recordError(error: unknown): void;
}

const NOOP_SPAN: TraceSpan = {
	setAttributes: () => {},
	recordError: () => {},
};

function guardSpan(span: SpanLike | undefined): TraceSpan {
	if (!span) return NOOP_SPAN;
	return {
		setAttributes: (attrs) => {
			try {
				span.setAttributes(attrs);
			} catch {
				// tracing must never affect the traced work
			}
		},
		recordError: (error) => {
			try {
				span.recordError(error);
			} catch {
				// tracing must never affect the traced work
			}
		},
	};
}

/**
 * Generic form of {@link tracedContextPass}: run `fn` inside a host span named
 * `name` when tracing is available, else directly. `fn` receives a guarded
 * span handle so it can stamp late attributes (outcome, counts) on the span it
 * runs in — independent of the host's ambient current-span lookup. The host's
 * child spans (e.g. `rlm.run_agent` from a subagent spawn) nest under it
 * automatically. Never throws on the tracing side: a host `withSpan` that
 * fails before invoking `fn` degrades to a plain call.
 */
export async function tracedSpan<T>(
	name: string,
	attrs: Attrs,
	fn: (span: TraceSpan) => Promise<T>,
): Promise<T> {
	const trace = await resolve();
	if (!trace) return fn(NOOP_SPAN);
	let invoked = false;
	try {
		return await trace.withSpan(name, attrs, (span) => {
			invoked = true;
			return fn(guardSpan(span));
		});
	} catch (error) {
		if (invoked) throw error;
		// The host span machinery failed before running `fn`: run it untraced.
		return fn(NOOP_SPAN);
	}
}

/** Merge attributes onto the active host span (no-op without tracing). Alias of {@link setContextSpanAttributes}. */
export function setSpanAttributes(attrs: Attrs): void {
	setContextSpanAttributes(attrs);
}
