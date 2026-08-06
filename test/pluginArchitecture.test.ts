import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const srcRoot = join(root, "src");

function typescriptFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = join(directory, entry.name);
        if (entry.isDirectory()) return typescriptFiles(target);
        return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
    });
}

describe("plugin architecture", () => {
    it("uses one direct PluginContext lifecycle without compatibility files", () => {
        const obsoleteFiles = [
            "src/shared.ts",
            "src/plugin/featureContext.ts",
            "src/plugin/legacyAdapter.ts",
            "src/crossModuleState",
        ];
        expect(
            obsoleteFiles.filter((file) => existsSync(join(root, file)))
        ).toEqual([]);
    });

    it("has no production imports of legacy or ambient lifecycle modules", () => {
        const forbiddenImport =
            /from\s+["'][^"']*(?:\/shared|legacyAdapter|featureContext|crossModuleState)["']/;
        const offenders = typescriptFiles(srcRoot)
            .filter((file) => forbiddenImport.test(readFileSync(file, "utf8")))
            .map((file) => relative(root, file));

        expect(offenders).toEqual([]);
    });
});
