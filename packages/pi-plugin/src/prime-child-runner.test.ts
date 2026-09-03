import { describe, expect, it, mock } from "bun:test";
import type { SubagentRunner, SubagentRunOptions } from "@magic-context/core/shared/subagent-runner";
import { PrimePreferredChildRunner, hasPrimeRunAgent, type PrimeRunAgentResult } from "./prime-child-runner";

const base: SubagentRunOptions = {
	agent: "magic-context-historian",
	systemPrompt: "system",
	userMessage: "input",
	model: "provider/model",
	timeoutMs: 500,
	maxOutputTokens: 1234,
};

function completed(output = "done"): PrimeRunAgentResult {
	return { status: "completed", output, messages: [], model: "provider/model", turns: 1, toolCalls: 0, usage: {} };
}

function setup(result: PrimeRunAgentResult | Error = completed()) {
	const fallbackRun = mock(async () => ({ ok: true as const, assistantText: "fallback", durationMs: 1 }));
	const fallback: SubagentRunner = { harness: "pi", run: fallbackRun };
	const runAgent = mock(async () => { if (result instanceof Error) throw result; return result; });
	const runner = new PrimePreferredChildRunner(fallback);
	runner.bindHost({ runAgent });
	return { runner, runAgent, fallbackRun };
}

describe("PrimePreferredChildRunner", () => {
	it("feature-detects without any and falls back unchanged when absent", async () => {
		const { runner, fallbackRun } = setup();
		runner.bindHost({});
		expect(hasPrimeRunAgent({ runAgent() {} })).toBe(true);
		expect((await runner.run(base)).ok).toBe(true);
		expect(fallbackRun).toHaveBeenCalledWith(base);
	});

	it("selects Prime, sends one non-duplicated prompt, current model, and no tools for complete-input work", async () => {
		const { runner, runAgent, fallbackRun } = setup();
		const result = await runner.run(base);
		expect(result).toMatchObject({ ok: true, assistantText: "done", toolCallCount: 0 });
		expect(fallbackRun).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent.mock.calls[0]?.[0]).toEqual({ prompt: "system\n\ninput", model: "provider/model" });
		expect(runAgent.mock.calls[0]?.[1]).toMatchObject({ tools: "none", maxTurns: 1, tokenBudget: 1234 });
	});

	it("uses exact narrow host tool allowlists for repository investigators", async () => {
		const { runner, runAgent } = setup();
		await runner.run({ ...base, agent: "dreamer-primer-investigator" });
		expect(runAgent.mock.calls[0]?.[1]?.tools).toEqual({ allow: ["read", "grep", "find", "ls", "ctx_search", "aft_outline", "aft_zoom", "aft_search"] });
	});

	it("requires explicit mutation capability and never escalates legacy names to ipython", async () => {
		const { runner, runAgent, fallbackRun } = setup();
		const mutation = { ...base, agent: "dreamer-docs" };
		await runner.run(mutation);
		expect(fallbackRun).toHaveBeenCalledWith(mutation);
		expect(runAgent).not.toHaveBeenCalled();
		runner.configure({ mutationTools: ["read", "bash", "edit", "ipython", "write_file"] });
		await runner.run(mutation);
		expect(runAgent.mock.calls[0]?.[1]?.tools).toEqual({ allow: ["read", "bash", "edit", "write_file"] });
	});

	it("maps structured terminal statuses and errors", async () => {
		for (const [status, reason] of [["turn_limit", "truncated"], ["budget_exceeded", "truncated"], ["error", "model_failed"]] as const) {
			const { runner } = setup({ ...completed(""), status, error: "detail" });
			expect(await runner.run(base)).toMatchObject({ ok: false, reason, error: "detail" });
		}
		const { runner } = setup(new Error("host exploded"));
		expect(await runner.run(base)).toMatchObject({ ok: false, reason: "model_failed", error: "host exploded" });
	});

	it("enforces timeout through the host signal", async () => {
		const fallback: SubagentRunner = { harness: "pi", run: async () => completed() as never };
		const runner = new PrimePreferredChildRunner(fallback);
		runner.bindHost({ runAgent: async (_request: unknown, options: { signal?: AbortSignal }) =>
			await new Promise<PrimeRunAgentResult>((resolve) => options.signal?.addEventListener("abort", () => resolve({ ...completed(""), status: "aborted" }), { once: true })) });
		expect(await runner.run({ ...base, timeoutMs: 1 })).toMatchObject({ ok: false, reason: "timeout" });
	});

	it("forwards cancellation and reports abort", async () => {
		const controller = new AbortController();
		let observed: AbortSignal | undefined;
		const fallback: SubagentRunner = { harness: "pi", run: async () => completed() as never };
		const runner = new PrimePreferredChildRunner(fallback);
		runner.bindHost({ runAgent: async (_request: unknown, options: { signal?: AbortSignal }) => {
			observed = options.signal;
			return await new Promise<PrimeRunAgentResult>((resolve) => options.signal?.addEventListener("abort", () => resolve({ ...completed(""), status: "aborted" }), { once: true }));
		} });
		const promise = runner.run({ ...base, signal: controller.signal });
		controller.abort();
		expect(await promise).toMatchObject({ ok: false, reason: "abort" });
		expect(observed?.aborted).toBe(true);
	});
});
