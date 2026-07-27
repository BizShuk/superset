import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
    new URL("../.github/workflows/release.yml", import.meta.url)
);
const workflow = readFileSync(workflowPath, "utf8");
const packageJson = JSON.parse(
    readFileSync(
        fileURLToPath(new URL("../package.json", import.meta.url)),
        "utf8"
    )
) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
};

describe("GitHub release workflow", () => {
    it("publishes the VSIX with the fixed superset.vsix filename", () => {
        expect(workflow).toContain(
            'mv "${vsix_files[0]}" superset.vsix'
        );
        expect(workflow).toMatch(
            /gh release create[\s\S]*?"superset\.vsix"\s*$/m
        );
    });

    it("builds without repository write permission and grants it only to release", () => {
        expect(workflow).toMatch(/^permissions:\n  contents: read$/m);
        expect(workflow).toMatch(
            /^  build:\n(?: {4,}.*\n)*?    permissions:\n      contents: read$/m
        );
        expect(workflow).toMatch(
            /^  release:\n(?: {4,}.*\n)*?    needs: build\n(?: {4,}.*\n)*?    permissions:\n      contents: write$/m
        );
    });

    it("pins every third-party action to a full commit SHA", () => {
        const actionRefs = Array.from(
            workflow.matchAll(/^\s+uses:\s+(\S+)$/gm),
            (match) => match[1]
        );

        expect(actionRefs).toContain(
            "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
        );
        expect(actionRefs).toContain(
            "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020"
        );
        expect(actionRefs).toContain(
            "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02"
        );
        expect(actionRefs).toContain(
            "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093"
        );
        expect(actionRefs.every((ref) => /@[0-9a-f]{40}$/.test(ref))).toBe(
            true
        );
    });

    it("does not persist checkout credentials and passes the VSIX through an artifact", () => {
        expect(workflow).toMatch(
            /actions\/checkout@[0-9a-f]{40}\n\s+with:\n\s+persist-credentials: false/
        );
        expect(workflow).toContain("name: superset-vsix");
        expect(workflow).toContain("needs: build");
        expect(workflow).toContain("path: dist");
    });

    it("uses npm ci for a reproducible clean build", () => {
        expect(packageJson.scripts.build).toContain("npm ci");
        expect(packageJson.scripts.build).not.toContain("npm install");
        expect(packageJson.scripts.build).not.toContain("npx");
        expect(packageJson.devDependencies["@vscode/vsce"]).toBe("3.9.2");
    });
});
