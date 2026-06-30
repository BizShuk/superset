# VSCode API 基準對齊表 (VSCode API Baseline)

本文件列出專案所使用的 VSCode API 及其最低支援版本。此表可用於未來更新 `engines.vscode` 與進行 API 稽核的對照。

| API / 功能 | 最低支援版本 | 引入位置 / 說明 |
| :--- | :--- | :--- |
| `vscode.Terminal.name` (getter-only) | 1.90.0 | `src/terminals/highlightPresenter.ts` (1.90.0+ 在 runtime 嘗試寫入會拋錯) |
| `vscode.TabInputTerminal` | 1.86.0 | `src/extension.ts:485` (VSCode 1.86 引入的 tab 類型) |
| `vscode.window.onDidStartTerminalShellExecution` | 1.85.0 | `src/terminals/shellExecutionSource.ts` (Shell Integration 穩定 API) |
| `vscode.window.onDidEndTerminalShellExecution` | 1.85.0 | `src/terminals/shellExecutionSource.ts` |
| `vscode.window.createTerminal` (Pseudoterminal) | 1.74.0 | `src/terminals/ptyTerminalFactory.ts` |
| `vscode.Pseudoterminal` | 1.74.0 | `src/terminals/ptyTerminalFactory.ts` |
| `vscode.RelativePattern` | 1.64.0 | `src/todo/index.ts:54` |
| `vscode.TreeDragAndDropController` | 1.45.0 | `src/terminals/dragAndDrop.ts` |
| `vscode.window.createTreeView` | 1.37.0 | `src/todo/index.ts:16`, `src/terminals/index.ts` |
| `vscode.TreeDataProvider` | 1.37.0 | `src/todo/todoTreeProvider.ts`, `src/terminals/treeProvider.ts` |
| `vscode.EventEmitter` | 1.0.0 | 廣泛使用 |
| `vscode.Disposable` | 1.0.0 | 廣泛使用 |

## 維護指南

1. 當在專案中引入新的 VSCode API 時，應在此表中登記，並確認新 API 的最低 VSCode 版本。
2. 若新 API 的最低版本大於 `engines.vscode` 所設定的版本，應同步更新 `package.json` 中的 `engines.vscode` 與 `@types/vscode`，避免 runtime 異常。
