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
	withSpan<T>(name: string, attrs: Attrs | undefined, fn: (span: SpanLike) => T): T;
	currentSpan?: () => SpanLike | undefined;
}

let api: TraceApi | null | undefined;

async function resolve(): Promise<TraceApi | null> {
	if (api !== undefined) return api;
	try {
		const mod = (await import("@earendil-works/pi-ai")) as Partial<TraceApi>;
		api = typeof mod.withSpan === "function" ? (mod as TraceApi) : null;
	} catch {
		api = null;
	}
	return api;
}

/** Run `fn` inside a host span when tracing is available, else directly. */
export async function tracedContextPass<T>(name: string, attrs: Attrs, fn: () => Promise<T>): Promise<T> {
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
