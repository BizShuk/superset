import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
    new URL("../.github/workflows/release.yml", import.meta.url)
);
const workflow = readFileSync(workflowPath, "utf8");

describe("GitHub release workflow", () => {
    it("publishes the VSIX with the fixed superset.vsix filename", () => {
        expect(workflow).toContain(
            'mv "${vsix_files[0]}" superset.vsix'
        );
        expect(workflow).toMatch(
            /gh release create[\s\S]*?"superset\.vsix"\s*$/m
        );
    });
});
