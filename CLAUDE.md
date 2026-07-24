# Superset 專案說明 (Project Notes)

Superset 是 VS Code 擴充功能，提供終端機活動偵測與高亮、TODO / 專案 / 網路面板，以及 Markdown `tree` 與 `README.todo` 預覽。對外功能、安裝與使用方式見 [`README.md`](README.md)；本檔只保留維護所需的技術脈絡與入口。

- 進行中、尚未實作的設計放在 [`plans/`](plans/)。
- 已實作的設計與歷史決策放在 [`docs/specs/`](docs/specs/)。
- Superset 全專案術語、VS Code UI 名稱與各 feature domain 用語以 [`docs/terminology.md`](docs/terminology.md) 為準。
- 每次變更都依 semantic versioning (`major` / `minor` / `patch`) 更新 `package.json` 與 `package-lock.json` 的 package version。

## 與根 `CLAUDE.md` 的關係

本專案是 `vscode-plugin-experiment` 的 git submodule，位於其 `superset/` 目錄。

- 根 `../CLAUDE.md`：跨專案方向與聚合層指令。
- 本檔：Superset 專屬建置指令、目前架構與不可破壞的契約。

兩者不重複記錄建置細節；業務範圍變更時同步更新 [`README.md`](README.md)，結構或關鍵決策變更時同步更新本檔。

## 常用指令 (Commands)

從 `superset/` 根目錄執行：

| 動作 | 指令 |
| --- | --- |
| 安裝相依套件 | `npm install` |
| 清理、編譯、打包並驗證 VSIX | `npm run build` |
| 邊改邊編譯 | `npm run watch` |
| 跑單元測試 | `npm test` |
| 持續跑測試 | `npm run test:watch` |
| 單獨打包 `.vsix` | `npx @vscode/vsce package` |
| 產生 Sessions 面板假資料 | `./scripts/seed-sessions.sh`（`-l` 只列出、`-c` 清除、`-h` 說明） |

執行環境以 `package.json#engines` 為準：VS Code `^1.93.0`、Node.js `>=20.0.0`。VS Code baseline 與 API 相容性決策見 [`docs/specs/2026-06-23-chore-vscode-baseline-alignment.md`](docs/specs/2026-06-23-chore-vscode-baseline-alignment.md)。

## 架構速覽 (Architecture)

`src/extension.ts` 是 declarative composition root。它建立 `PluginManager`、注入共用 context，並依序啟用 plugin；`PluginManager` 負責生命週期、錯誤隔離、disposable、reset handler 與 Markdown extension 組合。`panelLayoutPlugin` 必須最後啟用，確保恢復 view focus 時其他 TreeView 已完成註冊。

| 模組 | 職責 | 主要入口 |
| --- | --- | --- |
| `src/plugin/` | Plugin lifecycle、context、TreeView registry | `PluginManager` |
| `src/terminals/` | 終端機面板、高亮、群組、PTY 自動替換 | `terminalsPlugin` |
| `src/mermaid/` | Mermaid preview command（detection 已移除） | `registerMermaidPreviewCommand` |
| `src/mdns/` | mDNS 服務發現與細節 | `mdnsPlugin` |
| `src/topology/` | 網路拓撲掃描與 tree 轉換 | `topologyPlugin` |
| `src/sessions/` | Agent session 清單與 summary markdown(讀 `sessiond` JSONL) | `sessionsPlugin` |
| `src/todo/` | 當前 workspace 的 `README.todo` 與 plans | `todoPlugin` |
| `src/projects/` | 專案資料與 TreeView 元件 | `projectsPlugin`（目前未列入 composition root） |
| `src/projectsTodo/` | Workspace TODO 與跨專案 TODO sibling views | `projectsTodoPlugin` |
| `src/git/` | SCM reset、Explorer GitHub URL、Git hooks Install/Link 與 Status Bar | `gitPlugin` |
| `src/installCommands.ts` | Default Project、Default Tools、Skill Install 與 Projects Setup commands | `registerInstallCommands` |
| `src/treePreview/` | Markdown `tree` fence 渲染 | `treePreviewPlugin` |
| `src/todoPreview/` | `README.todo` 預覽重組與 CSS 互動 | `todoPreviewPlugin` |
| `src/panelLayout/` | TreeView layout persistence | `panelLayoutPlugin` |

目前 module 行為、資料流與歷史規格索引集中於 [`docs/specs/2026-07-20-architecture-current-modules.md`](docs/specs/2026-07-20-architecture-current-modules.md)。

## 維護契約 (Invariants)

- Feature 直接放在 `src/<feature>/`；domain types 留在 feature 內，共用 framework contracts 放在 `src/shared.ts` 與 `src/plugin/`。
- `treePreview`、`todoPreview` 是 Markdown contributor，不是 TreeView `register()` feature；hook 順序由 `src/extension.ts` 決定。
- TODO link parsing 與 copy formatting 的唯一 source of truth 是 `src/todoEngine/linkUtils.ts`，`todo` 與 `projectsTodo` 不另建副本。
- `TerminalRegistry` 是終端機狀態來源；既有 VS Code terminal 使用 Shell Integration fallback，PTY-backed terminal 透過 `node-pty` 取得完整 TUI data path。`markUnseen` 必須保持 idempotent。
- `node-pty` 是 runtime PTY binding（upstream `^1.1.0`）；不可換回 `@homebridge/node-pty-prebuilt-multiarch` fork 或在其他 fork 之間切換。不可在 `.vscodeignore` 排除 production `node_modules`。
- `src/projects/` 只負責專案清單；`src/projectsTodo/` 才負責 TODO 內容。`TODO` 只讀寫當前 project / workspace root，Workspace TODO 只遞迴當前 workspace，Projects TODO 只遞迴 `~/projects`；三者的掃描邊界不混用。
- Projects TODO 只認大小寫完全相符的 `README.todo`；`~/projects` root 為 depth 0 且不顯示，固定遞迴 depth 1–5，命中後繼續掃描子孫，每個命中資料夾以 `path.basename` 建立 group。
- Workspace TODO 只認大小寫完全相符的 `README.todo`；root 為 depth 0，預設最大 depth 5（設定 `superset.projectsTodo.maxDepth`，範圍 1–10），命中後仍繼續掃描子孫。
- Plan item 是 read-only domain kind，不納入 pending task 計數。Overview 不再有 top-level merged Plans row；plans 只出現在對應 local/per-project scope。
- `src/sessions/` 對 `sessiond` JSONL store 只讀，唯一寫入路徑是 `sample-*.jsonl` 假資料指令；清除也只認該 prefix，不得動到 ingest 產生的檔案。`deleteSession` 必須在內部守住 prefix gate（不接受「呼叫端已過濾」假設），`superset.sessionsDelete` 等 UI 命令直接呼叫 `deleteSession` 即可，禁止繞過 gate 刪除 ingest 產生的非 `sample-` 檔。
- Summary markdown 的 heading 契約固定為 `#` session /`##` round /`###` tool，由 `markdown.ts` 單點決定。`##` 層級保留給「Round」序列使用；其他段落（含 Resume、Summary、Overview 等）一律降到 `###` 或更深，確保 VS Code outline 將 round 顯示為同一連續序列，不被同層插入的 heading 打斷。
- mDNS service、network-key secondary index 與 expiration cleanup 必須同步更新，避免 stale index 或錯誤合併。
- Git hooks 只處理 `workspaceFolders[0]`；模板來源為 `pkg/resources/git/githooks/`。Install 採 copy-if-missing 後 Link，Status Bar 只做 Link；local `core.hooksPath` 只要非空即視為已連結。Repository 自用的 `.githooks/pre-push` 必須與內建模板保持一致。`pre-push` release tag 版本固定取 `max(最高 Git tag 的下一個 patch, package.json.version, .claude-plugin/plugin.json.version)`，缺少的 manifest 不納入候選。
- Projects Setup 固定以 `~/projects` 為 root，不提供自訂路徑；13 個 repository（包含 `social`）的 ordered set 以 `pkg/resources/config/setup-projects.sh` 為 runtime source of truth。首次 clone 必須使用 `--recurse-submodules`，重跑只補做 recursive submodule sync/update，不 pull 或覆蓋既有 repository。
- Extension 靜態資源統一放在 `pkg/resources/`；Git domain 模板放在 `pkg/resources/git/`。
- 純 domain logic 優先抽成無 `vscode` import 的函式或 store；VS Code-bound provider 以 pure renderer、contract test 或 activation test 覆蓋。

## 計劃與規格 (Plans vs Specs)

| 目錄 | 狀態 | 規則 |
| --- | --- | --- |
| `plans/` | 進行中 / 未實作 | 使用 `YYYY-MM-DD-<topic>.md`；完成並進入 git history 後才移入 specs |
| `docs/specs/` | 已實作的歷史記錄 | 新行為以新的 dated spec 補充，不改寫舊規格造成的歷史語意 |

SCM Graph reset proposed API 仍屬進行中工作，只以 [`plans/2026-07-17-scm-graph-proposed-api.md`](plans/2026-07-17-scm-graph-proposed-api.md) 為準，不得描述成已完成規格。

## 測試 (Testing)

- `npm test` 跑完整 Vitest suite。
- `npm run build` 會 clean、`npm install`、TypeScript compile、VSIX package，最後執行 `scripts/verify-vsix.sh`。
- 修改 manifest、activation order、TreeView registration 或 VSIX 打包內容時，除 unit tests 外必須跑完整 build。
- 不在本檔維護易漂移的測試檔與 case 數；測試行為以 `test/` 與相關 specs 為準。

## GitHub Actions 發布 (Release)

- [`.github/workflows/release.yml`](.github/workflows/release.yml) 只在推送 `v<major>.<minor>.<patch>` tag 時執行。
- Tag 必須與 `package.json` 的版本完全相符；workflow 會執行 build、測試與 VSIX 驗證。
- GitHub Release 只上傳單一固定檔名 `superset.vsix` asset，不上傳其他 build 產物。

## 規格索引 (Specification Index)

- Current module map：[`docs/specs/2026-07-20-architecture-current-modules.md`](docs/specs/2026-07-20-architecture-current-modules.md)
- Overall architecture：[`docs/specs/2026-07-02-architecture-master.md`](docs/specs/2026-07-02-architecture-master.md)
- Plugin framework：[`docs/specs/2026-07-02-architecture-pluginization.md`](docs/specs/2026-07-02-architecture-pluginization.md)
- Terminals / TUI / PTY：[`docs/specs/2026-06-20-terminal-dashboard-panel.md`](docs/specs/2026-06-20-terminal-dashboard-panel.md)、[`docs/specs/2026-07-02-architecture-terminals.md`](docs/specs/2026-07-02-architecture-terminals.md)
- Todo / Projects TODO / Plans：[`docs/specs/2026-07-02-architecture-superset.md`](docs/specs/2026-07-02-architecture-superset.md)、[`docs/specs/2026-07-08-feature-projects-todo-section-pending-badge.md`](docs/specs/2026-07-08-feature-projects-todo-section-pending-badge.md)、[`docs/specs/2026-07-09-feature-plans-source-scan.md`](docs/specs/2026-07-09-feature-plans-source-scan.md)、[`docs/specs/2026-07-22-projects-todo-recursive-scan.md`](docs/specs/2026-07-22-projects-todo-recursive-scan.md)
- mDNS：[`docs/specs/2026-07-02-architecture-mdns.md`](docs/specs/2026-07-02-architecture-mdns.md)
- Topology：[`docs/specs/2026-07-02-architecture-topology.md`](docs/specs/2026-07-02-architecture-topology.md)
- Markdown previews：[`docs/specs/2026-07-05-tree-comment-highlight.md`](docs/specs/2026-07-05-tree-comment-highlight.md)、[`docs/specs/2026-07-10-chore-dedup-mermaid-extract.md`](docs/specs/2026-07-10-chore-dedup-mermaid-extract.md)
- Explorer Copy GitHub URL：[`docs/specs/2026-07-17-copy-github-url.md`](docs/specs/2026-07-17-copy-github-url.md)、[`docs/specs/2026-07-17-copy-github-url-implementation.md`](docs/specs/2026-07-17-copy-github-url-implementation.md)
- Git Hooks Install / Link：[`docs/specs/2026-07-20-git-hooks-install-link.md`](docs/specs/2026-07-20-git-hooks-install-link.md)
- Git pre-push release 版本選擇：[`docs/specs/2026-07-22-git-pre-push-release-version.md`](docs/specs/2026-07-22-git-pre-push-release-version.md)
- GitHub Release 固定 VSIX 檔名：[`docs/specs/2026-07-23-github-release-fixed-vsix-filename.md`](docs/specs/2026-07-23-github-release-fixed-vsix-filename.md)
- Skill Install repository Quick Pick：[`docs/specs/2026-07-22-skill-install-repository-quick-pick.md`](docs/specs/2026-07-22-skill-install-repository-quick-pick.md)、[`docs/specs/2026-07-23-skill-install-expanded-repository-list.md`](docs/specs/2026-07-23-skill-install-expanded-repository-list.md)、[`docs/specs/2026-07-23-skill-install-custom-repository.md`](docs/specs/2026-07-23-skill-install-custom-repository.md)
- Install Skills command title：[`docs/specs/2026-07-23-install-skills-command-title.md`](docs/specs/2026-07-23-install-skills-command-title.md)
- Default Tools CLI set：[`docs/specs/2026-07-22-default-tools-cli-set.md`](docs/specs/2026-07-22-default-tools-cli-set.md)
- Projects Setup：[`docs/specs/2026-07-22-projects-setup.md`](docs/specs/2026-07-22-projects-setup.md)、[`docs/specs/2026-07-23-projects-setup-repository-set.md`](docs/specs/2026-07-23-projects-setup-repository-set.md)
- Session JSONL 格式與 hook 事件：隨 `sessiond` 專案移至 [BizShuk/sessiond](https://github.com/BizShuk/sessiond)（[本地 `~/projects/ai/sessiond/docs/session/`](../ai/sessiond/docs/session/)）

外部 API：

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Pseudoterminal API](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
- [node-pty upstream](https://github.com/microsoft/node-pty)
