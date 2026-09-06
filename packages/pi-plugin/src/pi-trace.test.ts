import { afterEach, describe, expect, test } from "bun:test";
import {
	configureTraceApiForTests,
	setContextSpanAttributes,
	setSpanAttributes,
	tracedContextPass,
	tracedSpan,
} from "./pi-trace";

describe("pi-trace bridge", () => {
	afterEach(() => configureTraceApiForTests(undefined));

	test("wraps the pass in a host span and stamps attributes set during it", async () => {
		const ended: Array<{ name: string; attrs: Record<string, unknown> }> = [];
		let active: { attrs: Record<string, unknown> } | undefined;
		const spanFor = () =>
			active && {
				setAttributes: (more: Record<string, unknown>) =>
					Object.assign(active!.attrs, more),
				recordError: () => {},
			};
		configureTraceApiForTests({
			withSpan: (name, attrs, fn) => {
				active = { attrs: { ...attrs } };
				const out = fn(spanFor()!);
				return Promise.resolve(out).finally(() => {
					ended.push({ name, attrs: active!.attrs });
					active = undefined;
				}) as ReturnType<typeof fn>;
			},
			currentSpan: spanFor,
		});
		const result = await tracedContextPass(
			"context.transform",
			{ "context.messages_in": 3 },
			async () => {
				setContextSpanAttributes({ "context.messages_out": 2 });
				return "ok";
			},
		);
		expect(result).toBe("ok");
		expect(ended).toEqual([
			{
				name: "context.transform",
				attrs: { "context.messages_in": 3, "context.messages_out": 2 },
			},
		]);
	});

	test("runs the pass directly when the host has no tracing", async () => {
		configureTraceApiForTests(null);
		expect(
			await tracedContextPass("context.transform", {}, async () => 7),
		).toBe(7);
		expect(() => setContextSpanAttributes({ x: 1 })).not.toThrow();
	});
});

describe("tracedSpan", () => {
	afterEach(() => configureTraceApiForTests(undefined));

	function recordingTraceApi() {
		const spans: Array<{
			name: string;
			attrs: Record<string, unknown>;
			parent: string | null;
			errors: unknown[];
		}> = [];
		const stack: Array<(typeof spans)[number]> = [];
		const handleFor = (span: (typeof spans)[number]) => ({
			setAttributes: (more: Record<string, unknown>) => {
				Object.assign(span.attrs, more);
			},
			recordError: (error: unknown) => {
				span.errors.push(error);
			},
		});
		configureTraceApiForTests({
			withSpan: (name, attrs, fn) => {
				const span = {
					name,
					attrs: { ...attrs },
					parent: stack[stack.length - 1]?.name ?? null,
					errors: [],
				};
				spans.push(span);
				stack.push(span);
				const out = fn(handleFor(span));
				return Promise.resolve(out).finally(() => {
					stack.splice(stack.indexOf(span), 1);
				}) as ReturnType<typeof fn>;
			},
			currentSpan: () => {
				const top = stack[stack.length - 1];
				return top ? handleFor(top) : undefined;
			},
		});
		return spans;
	}

	test("opens a named host span, hands `fn` a handle for late attributes, and nests children", async () => {
		const spans = recordingTraceApi();
		const result = await tracedSpan(
			"historian.run",
			{ "historian.model": "m" },
			async (run) => {
				const inner = await tracedSpan(
					"historian.subagent",
					{ "historian.pass": "first" },
					async (pass) => {
						pass.setAttributes({ "historian.outcome": "ok" });
						setSpanAttributes({ "historian.via_current": true });
						return 1;
					},
				);
				run.setAttributes({ "historian.status": "success" });
				return inner + 1;
			},
		);
		expect(result).toBe(2);
		expect(spans).toEqual([
			{
				name: "historian.run",
				attrs: { "historian.model": "m", "historian.status": "success" },
				parent: null,
				errors: [],
			},
			{
				name: "historian.subagent",
				attrs: {
					"historian.pass": "first",
					"historian.outcome": "ok",
					"historian.via_current": true,
				},
				parent: "historian.run",
				errors: [],
			},
		]);
	});

	test("propagates `fn` rejections unchanged and records them on the span", async () => {
		const spans = recordingTraceApi();
		const boom = new Error("boom");
		await expect(
			tracedSpan("historian.publish", {}, async (span) => {
				span.recordError(boom);
				throw boom;
			}),
		).rejects.toBe(boom);
		expect(spans[0]?.errors).toEqual([boom]);
	});

	test("runs `fn` directly with a no-op handle when the host has no tracing", async () => {
		configureTraceApiForTests(null);
		const out = await tracedSpan("historian.run", { a: 1 }, async (span) => {
			expect(() => span.setAttributes({ b: 2 })).not.toThrow();
			expect(() => span.recordError(new Error("x"))).not.toThrow();
			return "direct";
		});
		expect(out).toBe("direct");
		expect(() => setSpanAttributes({ x: 1 })).not.toThrow();
	});

	test("degrades to a plain call when the host span machinery fails before running `fn`", async () => {
		configureTraceApiForTests({
			withSpan: () => {
				throw new Error("host tracing broken");
			},
		});
		let ran = false;
		const out = await tracedSpan("historian.run", {}, async () => {
			ran = true;
			return 42;
		});
		expect(ran).toBe(true);
		expect(out).toBe(42);
	});

	test("swallows host errors from the span handle so tracing never affects the traced work", async () => {
		configureTraceApiForTests({
			withSpan: (_name, _attrs, fn) =>
				fn({
					setAttributes: () => {
						throw new Error("setAttributes exploded");
					},
					recordError: () => {
						throw new Error("recordError exploded");
					},
				}),
			currentSpan: () => {
				throw new Error("currentSpan exploded");
			},
		});
		const out = await tracedSpan("historian.run", {}, async (span) => {
			span.setAttributes({ a: 1 });
			span.recordError(new Error("ignored"));
			setSpanAttributes({ b: 2 });
			return "survived";
		});
		expect(out).toBe("survived");
	});
});
