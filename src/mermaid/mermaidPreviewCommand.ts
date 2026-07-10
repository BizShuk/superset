import * as vscode from "vscode";
import { writeFile, mkdir } from "fs/promises";
import * as os from "os";
import * as path from "path";

/**
 * Preview command for mermaid diagrams captured by the terminal link
 * provider. Per the user's directive we DO NOT bundle a mermaid
 * renderer — instead we hand the diagram to whichever Mermaid Preview
 * extension the user has installed (typical candidates below). If none
 * is present we fall back to opening the source as a plain markdown
 * document and surface a notification pointing at the marketplace.
 *
 * The temp-file path keeps each preview session isolated: VSCode's
 * markdown preview cache is keyed on URI, so a fresh file per click
 * guarantees the user always sees the most recent diagram rather
 * than a stale preview.
 *
 * Fenced code: a markdown mermaid block uses the language hint
 * `mermaid` directly. We do not bother with TOC or front-matter — the
 * user opens the preview to see the diagram, not navigate.
 */

const KNOWN_MERMAID_PACKAGES = [
    "bierner.markdown-mermaid",
    "tomasmcm.vscode-markdown-mermaid",
    "hediet.vscode-drawio",
    "mermaidchart.vscode-mermaid-chart",
];

const PREVIEW_TEMP_PREFIX = "superset-mermaid-";
const PREVIEW_TEMP_SUFFIX = ".md";

export interface MermaidPreviewOptions {
    /**
     * Override the temp directory used for the preview markdown file.
     * Tests use this to keep sandbox writes inside a tempdir they
     * control; production leaves it undefined to use `os.tmpdir()`.
     */
    tempDir?: string;
    /**
     * Override the timestamp source for unique file names. Tests can
     * pass a counter to get deterministic names.
     */
    nextId?: () => string;
    /**
     * Override the filesystem implementation. Defaults to `fs/promises`.
     * Tests use this to capture writes without touching disk.
     */
    fsAdapter?: { writeFile: typeof writeFile; mkdir: typeof mkdir };
    /**
     * Override the installed-extension list. Tests pass a fixed array
     * to drive the "installed"/"not installed" branch without having
     * to mock `vscode.extensions.all` getters. Production leaves it
     * undefined to scan the real `vscode.extensions.all`.
     */
    installedExtensions?: readonly vscode.Extension<unknown>[];
    /** Diagnostic sink. */
    log?: (msg: string) => void;
}

export function registerMermaidPreviewCommand(
    opts: MermaidPreviewOptions = {}
): vscode.Disposable {
    return vscode.commands.registerCommand(
        "superset.mermaidPreview",
        async (body: string | undefined) => {
            await runMermaidPreview(body ?? "", opts);
        }
    );
}

/**
 * Test-friendly entry point: the same logic as the registered command
 * but without `vscode.commands.registerCommand` so unit tests can call
 * it directly with stubs of `executeCommand` / `showInformationMessage`.
 */
export async function runMermaidPreview(
    body: string,
    opts: MermaidPreviewOptions = {}
): Promise<{ uri?: vscode.Uri; installed: boolean }> {
    const log = opts.log;
    if (body.trim().length === 0) {
        log?.("[mermaid-preview] empty body, refusing to write preview");
        return { installed: false };
    }
    const text = formatPreviewMarkdown(body);
    const tempDir = opts.tempDir ?? os.tmpdir();
    const id = opts.nextId?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filePath = path.join(tempDir, `${PREVIEW_TEMP_PREFIX}${id}${PREVIEW_TEMP_SUFFIX}`);
    const fsAdapter = opts.fsAdapter ?? { writeFile, mkdir };
    try {
        await fsAdapter.mkdir(tempDir, { recursive: true });
        await fsAdapter.writeFile(filePath, text, "utf8");
    } catch (err) {
        log?.(`[mermaid-preview] write failed: ${err}`);
        await vscode.window.showErrorMessage(
            `Superset: failed to write mermaid preview (${err})`
        );
        return { installed: false };
    }
    const uri = vscode.Uri.file(filePath);

    const installed = isMermaidExtensionInstalled(opts.installedExtensions);
    if (installed) {
        log?.(`[mermaid-preview] detected mermaid extension; opening preview for ${filePath}`);
        try {
            await vscode.commands.executeCommand("markdown.showPreview", uri);
        } catch (err) {
            log?.(`[mermaid-preview] markdown.showPreview failed: ${err}`);
            // Fall through to the no-extension path so the user still
            // gets a usable editor view.
            await openSourceFallback(uri, log);
        }
    } else {
        log?.(`[mermaid-preview] no mermaid extension installed; opening source ${filePath}`);
        await openSourceFallback(uri, log);
    }
    return { uri, installed };
}

function formatPreviewMarkdown(body: string): string {
    return [
        "# Mermaid preview",
        "",
        "```mermaid",
        body.trimEnd(),
        "```",
        "",
    ].join("\n");
}

function isMermaidExtensionInstalled(
    override?: readonly vscode.Extension<unknown>[]
): boolean {
    const all = override ?? vscode.extensions.all;
    for (const ext of all) {
        if (KNOWN_MERMAID_PACKAGES.includes(ext.id)) {
            return true;
        }
        // Fallback heuristic: any extension whose display name or id
        // mentions "mermaid" is a candidate, even if it's not on the
        // known list. Keeps the preview flowing for niche extensions.
        const pkg = ext.packageJSON as { displayName?: string } | undefined;
        const haystack = `${ext.id} ${pkg?.displayName ?? ""}`.toLowerCase();
        if (haystack.includes("mermaid")) {
            return true;
        }
    }
    return false;
}

async function openSourceFallback(
    uri: vscode.Uri,
    log: ((msg: string) => void) | undefined
): Promise<void> {
    await vscode.window.showInformationMessage(
        "Install a Mermaid Preview extension (e.g. bierner.markdown-mermaid) " +
            "to render diagrams. Showing source for now.",
        "Open in Marketplace"
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    log?.(`[mermaid-preview] source opened in editor (no mermaid extension)`);
}

/**
 * Test helper: re-export the constant list so tests can assert the
 * known-package set without re-listing them.
 */
export const __test_only__ = { KNOWN_MERMAID_PACKAGES };
