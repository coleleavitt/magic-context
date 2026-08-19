import { describe, expect, test } from "bun:test";
import { annotateEmptyTaskOutput, EMPTY_TASK_OUTPUT_SENTINEL } from "./empty-task-output";

describe("annotateEmptyTaskOutput", () => {
    test("surfaces a completed native task that returned no final text", () => {
        const output = {
            output: '<task id="ses-child" state="completed">\n<task_result>\n\n</task_result>\n</task>',
        };

        annotateEmptyTaskOutput("task", output);

        expect(output.output).toContain(EMPTY_TASK_OUTPUT_SENTINEL);
    });

    test("leaves non-empty and non-task outputs unchanged", () => {
        const taskOutput = { output: "completed" };
        const toolOutput = { output: "" };

        annotateEmptyTaskOutput("task", taskOutput);
        annotateEmptyTaskOutput("read", toolOutput);

        expect(taskOutput.output).toBe("completed");
        expect(toolOutput.output).toBe("");
    });
});
