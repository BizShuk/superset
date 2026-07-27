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
| 依 lockfile 安裝相依套件 | `npm ci` |
| 清理、編譯、打包並驗證 VSIX | `npm run build` |
| 邊改邊編譯 | `npm run watch` |
| 跑單元測試 | `npm test` |
| 持續跑測試 | `npm run test:watch` |
| 單獨打包 `.vsix` | `npm run package` |
| 產生 Sessions 面板假資料 | `./scripts/seed-sessions.sh`（`-l` 只列出、`-c` 清除、`-h` 說明） |

執行環境以 `package.json#engines` 為準：VS Code `^1.93.0`、Node.js `>=20.0.0`。VS Code baseline 與 API 相容性決策見 [`docs/specs/2026-06-23-chore-vscode-baseline-alignment.md`](docs/specs/2026-06-23-chore-vscode-baseline-alignment.md)。

## 架構速覽 (Architecture)

`src/extension.ts` 是 declarative composition root。它建立並持有 active `PluginManager`、注入共用 context，並依序啟用 plugin；root `deactivate()` 反向停用 plugin 並清除跨模組 singleton。`PluginManager` 負責生命週期、錯誤隔離、disposable、reset handler 與 Markdown extension 組合。`panelLayoutPlugin` 必須最後啟用，確保恢復 view focus 時其他 TreeView 已完成註冊。

| 模組 | 職責 | 主要入口 |
| --- | --- | --- |
| `src/plugin/` | Plugin lifecycle、context、TreeView registry、visibility boundary | `PluginManager` |
| `src/terminals/` | 終端機面板、高亮、群組、activity 偵測、PTY 自動替換 | `terminalsPlugin` |
| `src/mermaid/` | Mermaid preview command（detection 已移除） | `registerMermaidPreviewCommand` |
| `src/mdns/` | mDNS 服務發現與細節 | `mdnsPlugin` |
| `src/topology/` | 網路拓撲掃描與 tree 轉換 | `topologyPlugin` |
| `src/sessions/` | Agent session 清單與 summary markdown(讀 `sessiond` JSONL) | `sessionsPlugin` |
| `src/todo/` | 當前 workspace 的 `README.todo` 與 plans | `todoPlugin` |
| `src/projectsTodo/` | Workspace TODO 與跨專案 TODO sibling views | `projectsTodoPlugin` |
| `src/git/` | SCM reset、Explorer GitHub URL、Git hooks Install/Link 與 Status Bar | `gitPlugin` |
| `src/editorLayout/` | Editor group 四模式佈局（水平/垂直 × 均分/放大）與網格形狀 | `editorLayoutPlugin` |
| `src/installCommands.ts` | Default Project、Default Tools、Skill Install 與 Projects Setup commands | `registerInstallCommands` |
| `src/treePreview/` | Markdown `tree` fence 渲染 | `treePreviewPlugin` |
| `src/todoPreview/` | `README.todo` 預覽重組與 CSS 互動 | `todoPreviewPlugin` |
| `src/panelLayout/` | TreeView layout persistence | `panelLayoutPlugin` |

目前 module 行為、資料流與歷史規格索引集中於 [`docs/specs/2026-07-20-architecture-current-modules.md`](docs/specs/2026-07-20-architecture-current-modules.md)。

## 維護契約 (Invariants)

- Feature 直接放在 `src/<feature>/`；domain types 留在 feature 內，共用 framework contracts 放在 `src/shared.ts` 與 `src/plugin/`。
- `treePreview`、`todoPreview` 是 Markdown contributor，不是 TreeView `register()` feature；hook 順序由 `src/extension.ts` 決定。
- 根 `deactivate()` 必須 await `PluginManager.deactivateAll()`，再 dispose diagnostic channel 並清掉 manager、TreeView registry、terminal spawner 等 module-level reference。`PluginContext.registerDisposable()` 寫入的是 manager-owned pool，不是 VS Code 的 `ExtensionContext.subscriptions`，不得假設 host 會自動釋放；啟用失敗也必須立即清掉該 plugin 已註冊的部分資源。長週期 maintenance timer 仍須 `unref()`，但 `unref()` 只是防線，不能取代 teardown。
- TODO link parsing 與 copy formatting 的唯一 source of truth 是 `src/todoEngine/linkUtils.ts`，`todo` 與 `projectsTodo` 不另建副本。
- `TerminalRegistry` 是終端機狀態來源；既有 VS Code terminal 使用 Shell Integration fallback，PTY-backed terminal 透過 `node-pty` 取得完整 TUI data path。`markUnseen` 必須保持 idempotent。
- Tree View visibility 一律由 `src/plugin/viewVisibility.ts#registerViewVisibility` 接線並解構 event 的 `visible` boolean。UI-only polling / watcher 必須隨 View visibility 啟停；terminal activity source `A` / `B`、PTY lifecycle 與 registry subscriptions 不屬於 UI-only work，不得因面板隱藏而停止。
- Activity 偵測的預設路徑是`零位元組`的來源 `A`（`processActivitySource`，進程樹輪詢）與 `B`（`shellIntegrationActivitySource`，execution start/end edge）。來源 `B` 不得呼叫 `execution.read()`；讀取位元組的 `OutputWatcher` 只在 `superset.terminals.legacyOutputWatcher` 開啟時建立。抑制政策（不在 registry / 正在 focus / 最近 focus / 已是 unseen）只能存在於 `ActivityCoordinator` 一處，不得再複製回各來源。
- 診斷日誌只在 `seen → unseen` 真的翻轉時輸出。被抑制的路徑是熱路徑，逐事件記錄會讓 OutputChannel 自己變成 EH 主執行緒的效能問題；Shell Integration reason 與 legacy `OutputWatcher` 日誌不得包含 command text 或 output payload，只能保留 lifecycle edge、exit code 與 byte count。
- 來源 `A` 每個 poll 只跑`一次` `ps`（供所有 terminal 共用），下一 tick 只在當前 tick settle 後排程，且 timer 必須 `unref()`。判定用累積 CPU 時間（`ps -o time=`）的 delta 而非 `%cpu`，並排除 shell 自身的 CPU —— 互動式 shell 光是重繪 prompt 就會累積，計入會讓每個閒置 terminal 看起來都在忙。
- `node-pty` 是 runtime PTY binding（upstream `^1.1.0`）；不可換回 `@homebridge/node-pty-prebuilt-multiarch` fork 或在其他 fork 之間切換。不可在 `.vscodeignore` 排除 production `node_modules`。
- `node-pty@1.1.0` 的 macOS `spawn-helper` 必須保持 executable bit。根 `postinstall` 以 `scripts/prepare-node-pty.js` 修復所有 Darwin prebuild，`scripts/verify-vsix.sh` 必須同時驗證 `darwin-x64` / `darwin-arm64` helper 在 VSIX 內為 executable；PTY spawn 例外必須回報 UI 並觸發 close，不得留下永久等待的 terminal。
- `npm run clean` 必須先移除 generated `out/`，避免已刪 source 的 stale JavaScript 進入 VSIX。`npm run build` 必須以 `npm ci` 依 lockfile 重建 dependency tree，並使用 manifest 中 exact-pinned 的 `@vscode/vsce`，不得以未固定版本的 `npx` 下載打包器。`.vscodeignore` 排除 workspace metadata、native `.pdb` 與 dependency source/test payload，但必須保留 `node-pty` runtime `lib/`、所有 platform `prebuilds/` 與 `pkg/resources/`；`scripts/verify-vsix.sh` 必須拒絕沒有對應 `src/*.ts` 的 packaged `out/*.js`。
- `PtyTerminalHost.pendingBytes` 的定義是`從 pty 收到、尚未交給 onDidWrite 的位元組`——本 class 自己持有的佇列深度。不得改回「已送下游、待 ack」的模型：`vscode.Pseudoterminal.onDidWrite` 是 fire-and-forget，renderer 不回 ack，那樣的計數器沒有東西能遞減，pty 一旦 pause 就永不 resume。
- Flush 必須受 `MAX_FLUSH_BYTES` 限制並在殘留時重排。切片以 code unit 為界且切點落在 high surrogate 時回退一格；teardown 用的 `flushWriteBuffer` 則刻意不套 budget，扣住尾端等同遺失。
- `onExit` 必須清掉 `proc` 與 `opened` 並設 `disposed`；`fireClose` 由 `closeFired` 保證只觸發一次。`disposed` 與 `opened` 是兩件事——只靠 `opened === false` 會讓 stray `open()` 復活一個使用者以為已死的 shell。`close()` 在 paused 時必須先補 `resume()` 再 kill，並於 `KILL_ESCALATION_MS` 後升級 `SIGKILL`。
- PTY 子 shell 的環境一律經 `buildShellEnv`，不得直接傳 `process.env`：必須剝除 `ELECTRON_*` / `VSCODE_*` / `NODE_OPTIONS` 並明確設定 `TERM`。
- `PtyTerminalFactory` 以 `Map<Terminal, Host>` 持有 host，`onDidCloseTerminal` 必須 `forget()`，feature dispose 必須 `dispose()`。
- 專案清單本身不是獨立 feature：`src/projectsTodo/` 同時擁有跨專案清單與 TODO 內容（含 `superset.openProject`）。`TODO` 只讀寫當前 project / workspace root，Workspace TODO 只遞迴當前 workspace，Projects TODO 只遞迴 `~/projects`；三者的掃描邊界不混用。
- Projects TODO 只認大小寫完全相符的 `README.todo`；`~/projects` root 為 depth 0 且不顯示，固定遞迴 depth 1–5，命中後繼續掃描子孫，每個命中資料夾以 `path.basename` 建立 group。
- Workspace TODO 只認大小寫完全相符的 `README.todo`；root 為 depth 0，預設最大 depth 5（設定 `superset.projectsTodo.maxDepth`，範圍 1–10），命中後仍繼續掃描子孫。
- Plan item 是 read-only domain kind，不納入 pending task 計數。Overview 不再有 top-level merged Plans row；plans 只出現在對應 local/per-project scope。
- `src/sessions/` 對 `sessiond` JSONL store 只讀，唯一寫入路徑是 `sample-*.jsonl` 假資料指令；清除也只認該 prefix，不得動到 ingest 產生的檔案。`deleteSession` 必須在內部守住 prefix gate（不接受「呼叫端已過濾」假設），`superset.sessionsDelete` 等 UI 命令直接呼叫 `deleteSession` 即可，禁止繞過 gate 刪除 ingest 產生的非 `sample-` 檔。
- Sessions 的 Tree View 與 summary renderer 必須共用單一 `SessionStore`。cache 只在 `sizeBytes + mtimeMs` 同時相符時重用 parsed record，directory scan 必須淘汰已刪除檔案；recursive Store Watcher 只在 `Sessions View` visible 時存在。
- Summary markdown 的 heading 契約固定為 `#` session /`##` round /`###` tool，由 `markdown.ts` 單點決定。`##` 層級保留給「Round」序列使用；其他段落（含 Resume、Summary、Overview 等）一律降到 `###` 或更深，確保 VS Code outline 將 round 顯示為同一連續序列，不被同層插入的 heading 打斷。
- Editor Layout 的 mode 是`兩個方向各自的 sizing 組合`（`{horizontal: even|max} × {vertical: even|max}`），固定四個字面值 `even-even` / `max-even` / `even-max` / `max-max`。決定某一層套用哪個 sizing 的是`該層的方向`而非深度：level 0 依 root `orientation`，以下逐層交替（`directionAt`）。不得回退成「選一個主軸」的單軸模型，也不得加入沿路徑攤平的深度補償 —— 那會讓 `2×2` 的兄弟節點被壓到最小尺寸而看似消失。
- 網格形狀 (grid shape) 與 root orientation 都與四個 mode 正交，不得升為第五個模式。四個 mode 一律走`保形 (topology-preserving)` 的 `restyleLayout`，保留樹形與 orientation、只重寫各層 `size`；orientation 只由 `transpose` 改變。`buildLayout` 是唯一會改變格子數的路徑，只能從 shape pick / reset 進入，且必須先過 `reconcileShape` 讓 `sum(shape) === groupCount`（`vscode.setEditorLayout` 對 leaf 數不符會新建空 group 或 `mergeGroup` 既有 group）。
- `activeShare` 必須保證每個非作用中的兄弟至少留下 `MIN_SIBLING_SHARE`，並且不得小於均分值；同層兄弟過多時退化為均分。這是防止 `max` 把格子擠到 VS Code 最小尺寸而視覺上消失的第一道防線。
- 送進 `setEditorLayout` 的 `size` 必須是`與 getEditorLayout 相同量級的整數像素`，每個 sibling set 沿用該 set 現有的像素總量（無法取得時退回 `FALLBACK_SET_TOTAL`），由 `allocateSizes` 以最大餘數法分配且每格至少 1。不可送出加總為 1 的小數比例 —— `createSerializedGrid` 以 size 總和推導虛擬網格尺寸，小數會造出 `1x1` 的網格，每個 group 都低於最小尺寸而被 clamp，結果是兄弟看似消失但實際存在。
- 因為 size 是像素，`layoutSignature` 必須以`同層佔比`比較而非原始像素，否則視窗縮放或 ±1px 誤差會被誤判成待套用的變更。
- Editor Layout 的 `activeIndex` 只能來自 `activeTabGroup.viewColumn - 1`。`tabGroups.all` 是 group `建立順序`，descriptor 的 leaf 序是 `GRID_APPEARANCE` 深度優先順序，兩者在 split / 搬移後會分歧；用 `all.indexOf` 會放大錯誤的 group。
- Editor Layout 的 signature guard 只比對`本次寫入 vs 上次寫入`，不得改成比對即時佈局 —— VS Code 會 clamp 最小寬高，requested 與 actual 本來就不同，比對即時佈局會讓 follow-active-group 無限重套。明確命令一律 `force`，事件驅動的重套才受 guard 約束。
- `orientation` 只在 root 生效，巢狀層自動垂直於父層；`size` 是同層相對值。方向命名與 VS Code 選單相反，見 [`docs/terminology.md`](docs/terminology.md)。
- `PluginManager` activation 失敗時必須立即 dispose 該 plugin 已註冊的 partial disposables；root `deactivate()` 必須 await reverse teardown，並清除 manager、Tree View registry、diagnostic channel 與 terminal spawner singleton。
- mDNS service、network-key secondary index 與 expiration cleanup 必須同步更新，避免 stale index 或錯誤合併。mDNS transport input 一律不可信：單包最多 `256` records、pending/store 各最多 `512` services、DNS name 最多 `255` UTF-8 bytes、alias/address/subtype 各最多 `32`、TXT 最多 `64` entries（key `128` bytes、value `1024` bytes），TTL 最高 `4500` 秒。
- `Connect Action` 必須先驗證 service type、DNS/IP target、port 與 SSH user。HTTP(S)/IPP(S) 只能走 `vscode.env.openExternal`；SSH 只能以 `cmd + args` plan 經 `joinShellCommand` 引用後進 terminal。mDNS payload 不得直接串接 shell command。
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
- `npm run build` 會 clean、`npm ci`、TypeScript compile、以 lockfile 內的 `@vscode/vsce` 打包 VSIX，最後執行 `scripts/verify-vsix.sh`。
- 修改 manifest、activation order、TreeView registration 或 VSIX 打包內容時，除 unit tests 外必須跑完整 build。
- 不在本檔維護易漂移的測試檔與 case 數；測試行為以 `test/` 與相關 specs 為準。

## GitHub Actions 發布 (Release)

- [`.github/workflows/release.yml`](.github/workflows/release.yml) 只在推送 `v<major>.<minor>.<patch>` tag 時執行。
- Tag 必須與 `package.json` 的版本完全相符；workflow 會執行 build、測試與 VSIX 驗證。
- Workflow 預設與 build job 只有 `contents: read`；checkout 不持久化 credentials。只有依賴 verified one-day artifact 的 release job 取得 `contents: write`，所有第三方 Actions 必須固定到完整 commit SHA。
- GitHub Release 只上傳單一固定檔名 `superset.vsix` asset，不上傳其他 build 產物。

## 規格索引 (Specification Index)

- Current module map：[`docs/specs/2026-07-20-architecture-current-modules.md`](docs/specs/2026-07-20-architecture-current-modules.md)
- Visibility-scoped runtime 與 Sessions cache：[`docs/specs/2026-07-27-visibility-scoped-runtime-work.md`](docs/specs/2026-07-27-visibility-scoped-runtime-work.md)
- Security hardening：[`docs/specs/2026-07-27-security-hardening.md`](docs/specs/2026-07-27-security-hardening.md)
- Overall architecture：[`docs/specs/2026-07-02-architecture-master.md`](docs/specs/2026-07-02-architecture-master.md)
- Plugin framework：[`docs/specs/2026-07-02-architecture-pluginization.md`](docs/specs/2026-07-02-architecture-pluginization.md)
- Terminals / TUI / PTY：[`docs/specs/2026-06-20-terminal-dashboard-panel.md`](docs/specs/2026-06-20-terminal-dashboard-panel.md)、[`docs/specs/2026-07-02-architecture-terminals.md`](docs/specs/2026-07-02-architecture-terminals.md)
- Activity 偵測來源 `A` / `B`：[`docs/specs/2026-07-26-terminal-activity-sources-ab.md`](docs/specs/2026-07-26-terminal-activity-sources-ab.md)
- PTY backpressure 與生命週期加固：[`docs/specs/2026-07-26-pty-backpressure-and-lifecycle-hardening.md`](docs/specs/2026-07-26-pty-backpressure-and-lifecycle-hardening.md)
- Extension host 關窗清理：[`docs/specs/2026-07-26-extension-host-shutdown-lifecycle.md`](docs/specs/2026-07-26-extension-host-shutdown-lifecycle.md)
- 移除 `src/projects/` 與死碼清理：[`docs/specs/2026-07-26-remove-projects-feature-and-dead-code.md`](docs/specs/2026-07-26-remove-projects-feature-and-dead-code.md)
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
- Default Tools CLI set：[`docs/specs/2026-07-22-default-tools-cli-set.md`](docs/specs/2026-07-22-default-tools-cli-set.md)、[`docs/specs/2026-07-27-default-tools-autop.md`](docs/specs/2026-07-27-default-tools-autop.md)、[`docs/specs/2026-07-27-default-tools-auth.md`](docs/specs/2026-07-27-default-tools-auth.md)、[`docs/specs/2026-07-27-default-tools-proxy.md`](docs/specs/2026-07-27-default-tools-proxy.md)
- Projects Setup：[`docs/specs/2026-07-22-projects-setup.md`](docs/specs/2026-07-22-projects-setup.md)、[`docs/specs/2026-07-23-projects-setup-repository-set.md`](docs/specs/2026-07-23-projects-setup-repository-set.md)
- Session JSONL 格式與 hook 事件：隨 `sessiond` 專案移至 [BizShuk/sessiond](https://github.com/BizShuk/sessiond)（[本地 `~/projects/ai/sessiond/docs/session/`](../ai/sessiond/docs/session/)）

外部 API：

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Pseudoterminal API](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
- [node-pty upstream](https://github.com/microsoft/node-pty)
