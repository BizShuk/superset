// Subset of the vscode.ExtensionManifest shape used by the
// diagnostics renderer. Defined locally so the renderer module
// stays `vscode`-free (and unit-testable). Mirrors the JSON
// shape vscode loads from `package.json` at runtime.

export interface CommandContribution {
    command: string;
    title: string;
    icon?: string;
}

export interface ExtensionManifest {
    contributes?: {
        commands?: CommandContribution[];
    };
}