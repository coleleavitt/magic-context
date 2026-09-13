import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type WorkerRecord = {
    pid: number;
    dataHome?: string;
    dbPath: string;
};

const pluginDir = join(import.meta.dir, "..");
const fixtureFiles = [
    "./test-fixtures/parallel-db-isolation/worker-a.ts",
    "./test-fixtures/parallel-db-isolation/worker-b.ts",
];

function runProbe(probeDir: string, sharedDataHome?: string) {
    mkdirSync(probeDir, { recursive: true });
    const startedAt = Date.now();
    const result = spawnSync(
        process.execPath,
        ["test", "--parallel=2", "--parallel-delay=0", "--timeout=30000", ...fixtureFiles],
        {
            cwd: pluginDir,
            encoding: "utf8",
            env: {
                ...process.env,
                MC_PARALLEL_DB_PROBE_DIR: probeDir,
                ...(sharedDataHome ? { MC_PARALLEL_DB_PROBE_SHARED_DATA_HOME: sharedDataHome } : {}),
            },
        },
    );
    return { ...result, durationMs: Date.now() - startedAt };
}

function outputOf(result: ReturnType<typeof runProbe>): string {
    return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function readRecord(probeDir: string, name: string): WorkerRecord {
    return JSON.parse(readFileSync(join(probeDir, name), "utf8")) as WorkerRecord;
}

function main(): void {
    const root = mkdtempSync(join(tmpdir(), "mc-parallel-db-probe-"));
    try {
        const sharedDir = join(root, "shared-data-home");
        const shared = runProbe(join(root, "shared"), sharedDir);
        const sharedOutput = outputOf(shared);
        if (shared.status !== 0) {
            throw new Error(
                `shared-data-home current-schema probe failed; read/open paths must not require a writer lock:
${sharedOutput}`,
            );
        }
        const sharedA = readRecord(join(root, "shared"), "worker-a.json");
        const sharedB = readRecord(join(root, "shared"), "worker-b.json");
        if (sharedA.dbPath !== sharedB.dbPath) {
            throw new Error("shared-data-home probe did not exercise one shared database");
        }

        const isolated = runProbe(join(root, "isolated"));
        const isolatedOutput = outputOf(isolated);
        if (isolated.status !== 0) {
            throw new Error(`worker-isolated probe failed:\n${isolatedOutput}`);
        }

        const workerA = readRecord(join(root, "isolated"), "worker-a.json");
        const workerB = readRecord(join(root, "isolated"), "worker-b.json");
        if (workerA.pid === workerB.pid) {
            throw new Error("--parallel=2 did not use two worker processes");
        }
        if (!workerA.dataHome || !workerB.dataHome || workerA.dataHome === workerB.dataHome) {
            throw new Error("parallel workers shared MAGIC_CONTEXT_TEST_DATA_DIR");
        }
        if (workerA.dbPath === workerB.dbPath) {
            throw new Error("parallel workers resolved the same default database path");
        }

        console.log(
            `shared data-home: current-schema open remained non-writing across one locked database (${shared.durationMs}ms); ` +
                `isolated workers: pid ${workerA.pid} -> ${workerA.dataHome}, pid ${workerB.pid} -> ${workerB.dataHome}`,
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

main();
