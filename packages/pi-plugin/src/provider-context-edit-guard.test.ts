import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	guardPiProviderContextEdits,
	ProviderContextEditsConflictError,
} from "@magic-context/core/shared/provider-context-edit-guard";

describe("Pi provider context edit ownership guard", () => {
	test("rejects raw context_management.edits and aborts the request", () => {
		let aborts = 0;
		expect(() =>
			guardPiProviderContextEdits(
				{ context_management: { edits: [{ type: "compact_20260112" }] } },
				false,
				() => aborts++,
			),
		).toThrow(ProviderContextEditsConflictError);
		expect(aborts).toBe(1);
	});

	test("allows an empty edits list by identity while compaction is enabled", () => {
		let aborts = 0;
		const payload = { context_management: { edits: [] } };
		expect(guardPiProviderContextEdits(payload, false, () => aborts++)).toBe(
			payload,
		);
		expect(aborts).toBe(0);
	});

	test("fails closed on malformed edits while compaction is enabled", () => {
		let aborts = 0;
		expect(() =>
			guardPiProviderContextEdits(
				{ context_management: { edits: "future-provider-shape" } },
				false,
				() => aborts++,
			),
		).toThrow(ProviderContextEditsConflictError);
		expect(aborts).toBe(1);
	});

	test("passes ordinary payloads through by identity without aborting", () => {
		let aborts = 0;
		const payload = { model: "claude", messages: [] };
		expect(guardPiProviderContextEdits(payload, false, () => aborts++)).toBe(
			payload,
		);
		expect(aborts).toBe(0);
	});

	test("compaction-off passes conflicting payloads through by identity", () => {
		let aborts = 0;
		const payload = { context_management: { edits: [] } };
		expect(guardPiProviderContextEdits(payload, true, () => aborts++)).toBe(
			payload,
		);
		expect(aborts).toBe(0);
	});

	test("rejects edits injected by an earlier before_provider_request handler", () => {
		const payload: Record<string, unknown> = { messages: [] };
		payload.context_management = {
			edits: [{ type: "clear_thinking_20251015" }],
		};
		expect(() => guardPiProviderContextEdits(payload, false, () => {})).toThrow(
			ProviderContextEditsConflictError,
		);
	});

	test("main extension registers the guard at before_provider_request", () => {
		const entry = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
		expect(entry).toContain('pi.on("before_provider_request", (event, ctx) =>');
		expect(entry).toContain(
			"guardPiProviderContextEdits(event.payload, compactionOff",
		);
	});

	test("documents the unavoidable later-extension ordering limit", () => {
		const payload: Record<string, unknown> = { messages: [] };
		expect(guardPiProviderContextEdits(payload, false, () => {})).toBe(payload);
		// Pi chains replacements in load order. A later-loaded extension can add
		// edits after Magic Context because no post-all-handlers hook exists.
		payload.context_management = { edits: [{}] };
		expect(payload.context_management).toEqual({ edits: [{}] });
	});
});
