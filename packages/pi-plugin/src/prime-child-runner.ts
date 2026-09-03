import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	SubagentRunner,
	SubagentRunOptions,
	SubagentRunResult,
} from "@magic-context/core/shared/subagent-runner";

export type PrimeRunAgentTools = "none" | "active" | { allow: string[] };

export interface PrimeRunAgentRequest {
	prompt: string;
	model?: string;
}

export interface PrimeRunAgentOptions {
	tools?: PrimeRunAgentTools;
	signal?: AbortSignal;
	maxTurns?: number;
	tokenBudget?: number;
	onProgress?: (progress: unknown) => void;
}

export interface PrimeRunAgentResult {
	status: "completed" | "aborted" | "turn_limit" | "budget_exceeded" | "error";
	output: string;
	messages: unknown[];
	model: string;
	turns: number;
	toolCalls: number;
	usage: unknown;
	error?: string;
}

interface PrimeRunAgentContext {
	runAgent(request: PrimeRunAgentRequest, options?: PrimeRunAgentOptions): Promise<PrimeRunAgentResult>;
}

/** Published Pi 0.83 does not declare Prime's extension. Keep the feature test local and structural. */
export function hasPrimeRunAgent(context: unknown): context is PrimeRunAgentContext {
	if (typeof context !== "object" || context === null) return false;
	return typeof (context as { runAgent?: unknown }).runAgent === "function";
}

const NO_TOOL_AGENTS = new Set([
	"magic-context-historian",
	"historian",
	"historian-recomp",
	"historian-editor",
	"compressor",
	"recomp",
	"smart-note-compiler",
	"dreamer-classifier",
	"dreamer-reviewer",
	"dreamer-retrospective",
]);

const REPO_INVESTIGATOR_TOOLS: Readonly<Record<string, readonly string[]>> = {
	sidekick: ["read", "grep", "find", "ls", "ctx_search", "aft_search"],
	"dreamer-primer-investigator": ["read", "grep", "find", "ls", "ctx_search", "aft_outline", "aft_zoom", "aft_search"],
	"dreamer-memory-mapper": ["read", "grep", "find", "ls", "aft_outline", "aft_zoom", "aft_search"],
};

const MUTATION_AGENTS = new Set([
	"dreamer",
	"magic-context-dreamer",
	"dreamer-docs",
]);

export interface PrimeChildRunnerConfiguration {
	/** Exact Prime tool names granted to mutation dreamers. Absent means subprocess-only. */
	mutationTools?: readonly string[];
}

export interface HostBoundChildRunner extends SubagentRunner {
	bindHost(context: ExtensionContext | unknown): void;
	configure(configuration: PrimeChildRunnerConfiguration): void;
}

function promptFor(options: SubagentRunOptions): string {
	return options.systemPrompt.length > 0
		? `${options.systemPrompt}

${options.userMessage}`
		: options.userMessage;
}

function failure(
	status: PrimeRunAgentResult["status"],
	error: string | undefined,
	durationMs: number,
): SubagentRunResult {
	if (status === "aborted") return { ok: false, reason: "abort", error: error ?? "Prime child agent aborted", durationMs };
	if (status === "turn_limit") return { ok: false, reason: "truncated", error: error ?? "Prime child agent reached its turn limit", durationMs };
	if (status === "budget_exceeded") return { ok: false, reason: "truncated", error: error ?? "Prime child agent exceeded its token budget", durationMs };
	return { ok: false, reason: "model_failed", error: error ?? "Prime child agent failed", durationMs };
}

/** One deep execution seam. Prime is preferred when safely scoped; portable Pi CLI remains the fallback. */
export class PrimePreferredChildRunner implements HostBoundChildRunner {
	readonly harness = "pi";
	private host: PrimeRunAgentContext | undefined;
	private mutationTools: readonly string[] | undefined;

	constructor(private readonly fallback: SubagentRunner) {}

	bindHost(context: ExtensionContext | unknown): void {
		this.host = hasPrimeRunAgent(context) ? context : undefined;
	}

	configure(configuration: PrimeChildRunnerConfiguration): void {
		this.mutationTools = configuration.mutationTools?.slice();
	}

	async run(options: SubagentRunOptions): Promise<SubagentRunResult> {
		const host = this.host;
		const tools = this.toolsFor(options.agent);
		if (!host || tools === undefined) return this.fallback.run(options);
		const startedAt = Date.now();
		if (options.signal?.aborted) {
			return { ok: false, reason: "abort", error: "Prime child agent aborted by caller", durationMs: 0 };
		}
		const timeoutController = new AbortController();
		const abort = () => timeoutController.abort(options.signal?.reason);
		options.signal?.addEventListener("abort", abort, { once: true });
		const timer = options.timeoutMs === undefined
			? undefined
			: setTimeout(() => timeoutController.abort(new Error("timeout")), options.timeoutMs);
		try {
			const result = await host.runAgent(
				{ prompt: promptFor(options), ...(options.model ? { model: options.model } : {}) },
				{
					tools,
					signal: timeoutController.signal,
					maxTurns: tools === "none" ? 1 : MUTATION_AGENTS.has(options.agent) ? 12 : 8,
					...(options.maxOutputTokens === undefined ? {} : { tokenBudget: options.maxOutputTokens }),
				},
			);
			const durationMs = Date.now() - startedAt;
			if (result.status !== "completed") {
				if (timeoutController.signal.aborted && !options.signal?.aborted) {
					return { ok: false, reason: "timeout", error: `Prime child agent timed out after ${options.timeoutMs}ms`, durationMs };
				}
				return failure(result.status, result.error, durationMs);
			}
			const assistantText = result.output.trim();
			return assistantText.length === 0
				? { ok: false, reason: "no_assistant", error: "Prime child agent completed without assistant output", durationMs }
				: { ok: true, assistantText, durationMs, toolCallCount: result.toolCalls, meta: { status: result.status, model: result.model, turns: result.turns, usage: result.usage } };
		} catch (error) {
			const durationMs = Date.now() - startedAt;
			if (timeoutController.signal.aborted) {
				return options.signal?.aborted
					? { ok: false, reason: "abort", error: "Prime child agent aborted by caller", durationMs }
					: { ok: false, reason: "timeout", error: `Prime child agent timed out after ${options.timeoutMs}ms`, durationMs };
			}
			return { ok: false, reason: "model_failed", error: error instanceof Error ? error.message : String(error), durationMs };
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		}
	}

	private toolsFor(agent: string): PrimeRunAgentTools | undefined {
		if (NO_TOOL_AGENTS.has(agent)) return "none";
		const investigator = REPO_INVESTIGATOR_TOOLS[agent];
		if (investigator) return { allow: [...investigator] };
		if (!MUTATION_AGENTS.has(agent)) return "none";
		if (!this.mutationTools || this.mutationTools.length === 0) return undefined;
		// Exact configured names only. Never broaden legacy read/bash/edit into Prime's ipython.
		return { allow: [...this.mutationTools.filter((tool) => tool !== "ipython")] };
	}
}
