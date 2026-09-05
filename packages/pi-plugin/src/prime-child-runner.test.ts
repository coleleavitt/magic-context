import { describe, expect, it, mock } from "bun:test";
import type {
	SubagentRunner,
	SubagentRunOptions,
} from "@magic-context/core/shared/subagent-runner";
import {
	hasPrimeRunAgent,
	PrimePreferredChildRunner,
	type PrimeRunAgentResult,
} from "./prime-child-runner";

const base: SubagentRunOptions = {
	agent: "magic-context-historian",
	systemPrompt: "system",
	userMessage: "input",
	model: "provider/model",
	timeoutMs: 500,
	maxOutputTokens: 1234,
};

function completed(output = "done"): PrimeRunAgentResult {
	return {
		status: "completed",
		output,
		messages: [],
		model: "provider/model",
		turns: 1,
		toolCalls: 0,
		usage: {},
	};
}

function setup(result: PrimeRunAgentResult | Error = completed()) {
	const fallbackRun = mock(async () => ({
		ok: true as const,
		assistantText: "fallback",
		durationMs: 1,
	}));
	const fallback: SubagentRunner = { harness: "pi", run: fallbackRun };
	const runAgent = mock(async () => {
		if (result instanceof Error) throw result;
		return result;
	});
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
		expect(result).toMatchObject({
			ok: true,
			assistantText: "done",
			toolCallCount: 0,
		});
		expect(fallbackRun).not.toHaveBeenCalled();
		expect(runAgent).toHaveBeenCalledTimes(1);
		expect(runAgent.mock.calls[0]?.[0]).toEqual({
			prompt: "system\n\ninput",
			model: "provider/model",
		});
		expect(runAgent.mock.calls[0]?.[1]).toMatchObject({
			tools: "none",
			maxTurns: 1,
			tokenBudget: 1234,
		});
	});

	it("uses exact narrow host tool allowlists for repository investigators", async () => {
		const { runner, runAgent } = setup();
		await runner.run({ ...base, agent: "dreamer-primer-investigator" });
		expect(runAgent.mock.calls[0]?.[1]?.tools).toEqual({
			allow: [
				"read",
				"grep",
				"find",
				"ls",
				"ctx_search",
				"aft_outline",
				"aft_zoom",
				"aft_search",
			],
		});
	});

	it("requires explicit mutation capability and never escalates legacy names to ipython", async () => {
		const { runner, runAgent, fallbackRun } = setup();
		const mutation = { ...base, agent: "dreamer-docs" };
		await runner.run(mutation);
		expect(fallbackRun).toHaveBeenCalledWith(mutation);
		expect(runAgent).not.toHaveBeenCalled();
		runner.configure({
			mutationTools: ["read", "bash", "edit", "ipython", "write_file"],
		});
		await runner.run(mutation);
		expect(runAgent.mock.calls[0]?.[1]?.tools).toEqual({
			allow: ["read", "bash", "edit", "write_file"],
		});
	});

	it("maps terminal limits without unsafe replay and falls back after native model errors", async () => {
		for (const [status, reason] of [
			["turn_limit", "truncated"],
			["budget_exceeded", "truncated"],
		] as const) {
			const { runner, fallbackRun } = setup({
				...completed(""),
				status,
				error: "detail",
			});
			expect(await runner.run(base)).toMatchObject({
				ok: false,
				reason,
				error: "detail",
			});
			expect(fallbackRun).not.toHaveBeenCalled();
		}
		for (const nativeFailure of [
			{ ...completed(""), status: "error" as const, error: "detail" },
			new Error("host exploded"),
		]) {
			const { runner, fallbackRun } = setup(nativeFailure);
			expect(await runner.run(base)).toMatchObject({
				ok: true,
				assistantText: "fallback",
			});
			expect(fallbackRun).toHaveBeenCalledWith(base);
		}
	});

	it("enforces timeout through the host signal", async () => {
		const fallback: SubagentRunner = {
			harness: "pi",
			run: async () => completed() as never,
		};
		const runner = new PrimePreferredChildRunner(fallback);
		runner.bindHost({
			runAgent: async (_request: unknown, options: { signal?: AbortSignal }) =>
				await new Promise<PrimeRunAgentResult>((resolve) =>
					options.signal?.addEventListener(
						"abort",
						() => resolve({ ...completed(""), status: "aborted" }),
						{ once: true },
					),
				),
		});
		expect(await runner.run({ ...base, timeoutMs: 1 })).toMatchObject({
			ok: false,
			reason: "timeout",
		});
	});

	it("forwards cancellation and reports abort", async () => {
		const controller = new AbortController();
		let observed: AbortSignal | undefined;
		const fallback: SubagentRunner = {
			harness: "pi",
			run: async () => completed() as never,
		};
		const runner = new PrimePreferredChildRunner(fallback);
		runner.bindHost({
			runAgent: async (
				_request: unknown,
				options: { signal?: AbortSignal },
			) => {
				observed = options.signal;
				return await new Promise<PrimeRunAgentResult>((resolve) =>
					options.signal?.addEventListener(
						"abort",
						() => resolve({ ...completed(""), status: "aborted" }),
						{ once: true },
					),
				);
			},
		});
		const promise = runner.run({ ...base, signal: controller.signal });
		controller.abort();
		expect(await promise).toMatchObject({ ok: false, reason: "abort" });
		expect(observed?.aborted).toBe(true);
	});
	it("tries the primary and fallback models through Prime in declaration order", async () => {
		const fallbackRun = mock(async () => ({
			ok: true as const,
			assistantText: "portable",
			durationMs: 1,
		}));
		const runAgent = mock(async (request: { model?: string }) =>
			request.model === "google/last"
				? completed("last worked")
				: {
						...completed(""),
						status: "error" as const,
						error: `unavailable ${request.model}`,
					},
		);
		const runner = new PrimePreferredChildRunner({
			harness: "pi",
			run: fallbackRun,
		});
		runner.bindHost({ runAgent });
		const result = await runner.run({
			...base,
			fallbackModels: [
				{ model: "openai/second", qualifier: "low" },
				"google/last",
			],
		});
		expect(result).toMatchObject({ ok: true, assistantText: "last worked" });
		expect(runAgent.mock.calls.map((call) => call[0].model)).toEqual([
			"provider/model",
			"openai/second",
			"google/last",
		]);
		expect(fallbackRun).not.toHaveBeenCalled();
	});

	it("uses the portable runner after safe native model exhaustion", async () => {
		const fallbackRun = mock(async () => ({
			ok: true as const,
			assistantText: "portable worked",
			durationMs: 2,
		}));
		const runner = new PrimePreferredChildRunner({
			harness: "pi",
			run: fallbackRun,
		});
		runner.bindHost({
			runAgent: mock(async () => ({
				...completed(""),
				status: "error",
				error: "native auth failed",
			})),
		});
		const options = { ...base, fallbackModels: ["openai/fallback"] };
		expect(await runner.run(options)).toMatchObject({
			ok: true,
			assistantText: "portable worked",
		});
		expect(fallbackRun).toHaveBeenCalledWith(options);
	});

	it("reports the terminal aggregate chain when native and portable attempts all fail", async () => {
		const fallbackRun = mock(async () => ({
			ok: false as const,
			reason: "model_failed" as const,
			error: "portable terminal failure",
			durationMs: 2,
		}));
		const runner = new PrimePreferredChildRunner({
			harness: "pi",
			run: fallbackRun,
		});
		runner.bindHost({
			runAgent: mock(async (request: { model?: string }) => ({
				...completed(""),
				status: "error",
				error:
					request.model === "provider/model"
						? "stale haiku failure"
						: "native fallback failure",
			})),
		});
		const result = await runner.run({
			...base,
			fallbackModels: ["openai/fallback"],
		});
		expect(result).toMatchObject({ ok: false, reason: "model_failed" });
		if (result.ok) throw new Error("expected failure");
		expect(result.error).toContain("portable terminal failure");
		expect(result.error).toContain("native fallback failure");
		expect(result.error).not.toBe("stale haiku failure");
	});
});
