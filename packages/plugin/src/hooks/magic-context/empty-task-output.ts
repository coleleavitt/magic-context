import { isRecord } from "../../shared/record-type-guard";

export const EMPTY_TASK_OUTPUT_SENTINEL = "<magic-context-empty-task-output>";
const EMPTY_COMPLETED_TASK_RESULT =
    /^<task\b[^>]*\bstate="completed"[^>]*>[\s\S]*<task_result>\s*<\/task_result>\s*<\/task>\s*$/;

export function annotateEmptyTaskOutput(tool: string, output: unknown): void {
    if (tool !== "task" || !isRecord(output)) return;
    if (typeof output.output !== "string") return;
    if (output.output.includes(EMPTY_TASK_OUTPUT_SENTINEL)) return;
    if (!EMPTY_COMPLETED_TASK_RESULT.test(output.output)) return;

    Reflect.set(
        output,
        "output",
        `${output.output}\n${EMPTY_TASK_OUTPUT_SENTINEL}
The subagent completed without a final text response. Context-fill truncation may have omitted its final output, or its provider may have emitted reasoning only; inspect the child session and retry with a low-reasoning model or variant.`,
    );
}
