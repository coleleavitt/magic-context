import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
    assertNoOpenCodeProviderContextEdits,
    ProviderContextEditsConflictError,
} from "./provider-context-edit-guard";

const anthropicModel = {
    providerID: "anthropic",
    api: { npm: "@ai-sdk/anthropic" },
};

const vertexAnthropicModel = {
    providerID: "google-vertex-anthropic",
    api: { npm: "@ai-sdk/google-vertex/anthropic" },
};

describe("OpenCode provider context edit ownership guard", () => {
    for (const [label, options] of [
        ["camel case", { contextManagement: { edits: [{ type: "compact_20260112" }] } }],
        ["snake case", { context_management: { edits: [{ type: "clear_tool_uses_20250919" }] } }],
        ["Anthropic namespace + camel case", { anthropic: { contextManagement: { edits: [{}] } } }],
        [
            "Anthropic namespace + snake case",
            { anthropic: { context_management: { edits: [{}] } } },
        ],
    ] as const) {
        test(`rejects ${label} edits on an Anthropic wire model`, () => {
            expect(() =>
                assertNoOpenCodeProviderContextEdits(anthropicModel, options, false),
            ).toThrow(ProviderContextEditsConflictError);
        });
    }

    test("allows a provably empty edits list by identity", () => {
        const options = { anthropic: { contextManagement: { edits: [] } } };
        expect(assertNoOpenCodeProviderContextEdits(anthropicModel, options, false)).toBe(options);
    });

    test("fails closed on a malformed edits declaration", () => {
        expect(() =>
            assertNoOpenCodeProviderContextEdits(
                anthropicModel,
                { contextManagement: { edits: "future-provider-shape" } },
                false,
            ),
        ).toThrow(ProviderContextEditsConflictError);
    });

    test("recognizes the Vertex Anthropic wire adapter", () => {
        expect(() =>
            assertNoOpenCodeProviderContextEdits(
                vertexAnthropicModel,
                { contextManagement: { edits: [{}] } },
                false,
            ),
        ).toThrow(ProviderContextEditsConflictError);
    });

    test("passes through and preserves ordinary options by identity", () => {
        const options = { thinking: { type: "enabled" }, temperature: 0.2 };
        expect(assertNoOpenCodeProviderContextEdits(anthropicModel, options, false)).toBe(options);
    });

    test("rejects explicit edits even when a custom adapter hides the Anthropic route", () => {
        const options = { contextManagement: { edits: [{}] } };
        const model = { providerID: "custom", api: { npm: "@ai-sdk/custom-gateway" } };
        expect(() => assertNoOpenCodeProviderContextEdits(model, options, false)).toThrow(
            ProviderContextEditsConflictError,
        );
    });

    test("compaction-off passes conflicting options through by identity", () => {
        const options = { contextManagement: { edits: [{}] } };
        expect(assertNoOpenCodeProviderContextEdits(anthropicModel, options, true)).toBe(options);
    });

    test("rejects edits injected by a hook that ran before Magic Context", () => {
        const options: Record<string, unknown> = { effort: "high" };
        options.contextManagement = { edits: [{ type: "compact_20260112" }] };
        expect(() => assertNoOpenCodeProviderContextEdits(anthropicModel, options, false)).toThrow(
            ProviderContextEditsConflictError,
        );
    });

    test("entry registers the guard at chat.params", () => {
        const entry = readFileSync(join(import.meta.dir, "..", "index.ts"), "utf8");
        expect(entry).toContain('"chat.params": async (input, output) =>');
        expect(entry).toContain("assertNoOpenCodeProviderContextEdits(");
        expect(entry).toContain("!pluginConfig.enabled ||");
        expect(entry).toContain("magicContextRuntime.magicContext === undefined");
    });

    test("documents the unavoidable later-hook ordering limit", () => {
        const options: Record<string, unknown> = { effort: "high" };
        expect(assertNoOpenCodeProviderContextEdits(anthropicModel, options, false)).toBe(options);
        // OpenCode offers no post-all-plugins request hook. A later chat.params
        // handler can mutate this same object after Magic Context has returned.
        options.contextManagement = { edits: [{}] };
        expect(options.contextManagement).toEqual({ edits: [{}] });
    });
});
