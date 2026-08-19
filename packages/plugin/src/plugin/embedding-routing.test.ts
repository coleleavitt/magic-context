import { afterEach, describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { MagicContextConfigSchema } from "../config/schema/magic-context";
import { resolveEmbeddingRouting } from "./embedding-routing";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

afterEach(() => {
    if (originalPlatformDescriptor) {
        Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
});

describe("embedding routing", () => {
    it("reports the local lane unavailable under Bun on Windows", async () => {
        // Given
        Object.defineProperty(process, "platform", {
            ...originalPlatformDescriptor,
            value: "win32",
        });
        const config = MagicContextConfigSchema.parse({
            embedding: { provider: "local" },
        });

        // When
        const routing = await resolveEmbeddingRouting({ config, projectRoot: "C:\\repo" });

        // Then
        expect(routing.primary.provider).toBe("local");
        expect(routing.warnings.join(" ")).toContain("Bun on Windows");
    });

    it("keeps Synapse transport settings out of the resolved fallback config", async () => {
        const config = MagicContextConfigSchema.parse({
            embedding: { provider: "synapse", fallback_provider: "local" },
            subc: { connection_file: "~/run/subc.json" },
        });
        const routing = await resolveEmbeddingRouting({
            config,
            projectRoot: "/repo",
            session: "ses-routing",
        });
        expect(routing.primary).toEqual({
            provider: "local",
            model: "Xenova/all-MiniLM-L6-v2",
        });
        expect(routing.primary).not.toHaveProperty("fallback_provider");
        expect(config.subc?.connection_file).toBe(`${homedir()}/run/subc.json`);
        expect(routing.warnings.some((warning) => warning.includes("Synapse"))).toBe(true);
    });

    it("warns and falls back when Synapse has no transport block", async () => {
        const config = MagicContextConfigSchema.parse({
            embedding: { provider: "synapse", fallback_provider: "off" },
        });
        const routing = await resolveEmbeddingRouting({ config, projectRoot: "/repo" });
        expect(routing.primary).toEqual({ provider: "off" });
        expect(routing.shadow).toBeNull();
        expect(routing.warnings.join(" ")).toContain("subc");
    });
});
