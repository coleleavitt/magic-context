import { afterEach, describe, expect, test } from "bun:test";
import { configureTraceApiForTests, setContextSpanAttributes, tracedContextPass } from "./pi-trace";

describe("pi-trace bridge", () => {
	afterEach(() => configureTraceApiForTests(undefined));

	test("wraps the pass in a host span and stamps attributes set during it", async () => {
		const ended: Array<{ name: string; attrs: Record<string, unknown> }> = [];
		let active: { attrs: Record<string, unknown> } | undefined;
		const spanFor = () =>
			active && {
				setAttributes: (more: Record<string, unknown>) => Object.assign(active!.attrs, more),
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
		const result = await tracedContextPass("context.transform", { "context.messages_in": 3 }, async () => {
			setContextSpanAttributes({ "context.messages_out": 2 });
			return "ok";
		});
		expect(result).toBe("ok");
		expect(ended).toEqual([
			{ name: "context.transform", attrs: { "context.messages_in": 3, "context.messages_out": 2 } },
		]);
	});

	test("runs the pass directly when the host has no tracing", async () => {
		configureTraceApiForTests(null);
		expect(await tracedContextPass("context.transform", {}, async () => 7)).toBe(7);
		expect(() => setContextSpanAttributes({ x: 1 })).not.toThrow();
	});
});
