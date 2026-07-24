// mermaid — preview command for Mermaid blocks.
//
// Detection (line buffer, terminal-link provider, trigger scanner) was
// removed; this module now only owns the rendering side. External
// callers — other extensions, the command palette, or a future
// re-introduction of detection — can still invoke
// `superset.mermaidPreview` with a body string.

export {
    registerMermaidPreviewCommand,
    runMermaidPreview,
    type MermaidPreviewOptions,
    __test_only__,
} from "./mermaidPreviewCommand";