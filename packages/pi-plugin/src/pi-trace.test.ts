import { describe, expect, mock, test } from "bun:test";

const ended: Array<{ name: string; attrs: Record<string, unknown> }> = [];
let active: { attrs: Record<string, unknown> } | undefined;
const spanFor = () =>
	active && {
		setAttributes: (more: Record<string, unknown>) => Object.assign(active!.attrs, more),
		recordError: () => {},
	};

mock.module("@earendil-works/pi-ai", () => ({
	withSpan: (name: string, attrs: Record<string, unknown>, fn: (span: unknown) => unknown) => {
		active = { attrs: { ...attrs } };
		const out = fn(spanFor());
		return Promise.resolve(out).finally(() => {
			ended.push({ name, attrs: active!.attrs });
			active = undefined;
		});
	},
	currentSpan: spanFor,
}));

describe("pi-trace bridge", () => {
	test("wraps the pass in a host span and stamps attributes set during it", async () => {
		const { tracedContextPass, setContextSpanAttributes } = await import("./pi-trace");
		const result = await tracedContextPass("context.transform", { "context.messages_in": 3 }, async () => {
			setContextSpanAttributes({ "context.messages_out": 2 });
			return "ok";
		});
		expect(result).toBe("ok");
		expect(ended).toEqual([
			{ name: "context.transform", attrs: { "context.messages_in": 3, "context.messages_out": 2 } },
		]);
	});

	test("setContextSpanAttributes outside a span is a no-op", async () => {
		const { setContextSpanAttributes } = await import("./pi-trace");
		expect(() => setContextSpanAttributes({ x: 1 })).not.toThrow();
	});
});
