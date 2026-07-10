// mermaid — terminal-link provider + preview command for Mermaid blocks
// emitted by long-running TUI sessions (e.g. `claude --output-mermaid`).
//
// This is a self-contained feature module split out of `src/terminals/`
// to match the "feature-as-folder" convention used by `todo/`, `mdns/`,
// `topology/`, etc. The four siblings are:
//
//   - `mermaidTrigger.ts`        pure line-scan to find ` ```mermaid ` blocks
//   - `mermaidLineBuffer.ts`     accumulates ANSI-stripped block bodies
//   - `mermaidLinkProvider.ts`    VSCode terminal-link provider (hover/click)
//   - `mermaidPreviewCommand.ts` `Superset: Mermaid Preview` command
//
// Unlike `todo/` or `mdns/`, mermaid has no TreeView / store / plugin
// shim of its own — it is wired directly from `src/terminals/index.ts`,
// which imports the classes/functions it needs. This barrel re-exports
// the public surface so callers can import from `../mermaid` in one
// line instead of reaching into individual files.

export { MermaidLineBuffer } from "./mermaidLineBuffer";
export {
    MermaidTerminalLinkProvider,
    type MermaidLinkClick,
    type MermaidLinkProviderDeps,
    type MermaidTerminalLink,
} from "./mermaidLinkProvider";
export {
    registerMermaidPreviewCommand,
    runMermaidPreview,
    type MermaidPreviewOptions,
    __test_only__,
} from "./mermaidPreviewCommand";
export {
    findFirstMermaidMatch,
    findAllMermaidMatches,
    type MermaidMatch,
} from "./mermaidTrigger";
