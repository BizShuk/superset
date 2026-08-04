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
| `src/terminals/` | 終端機面板、高亮、群組、activity 偵測、原生 terminal 開啟 | `terminalsPlugin` |
| `src/mermaid/` | Mermaid preview command（detection 已移除） | `registerMermaidPreviewCommand` |
| `src/mdns/` | mDNS 服務發現與細節 | `mdnsPlugin` |
| `src/topology/` | 網路拓撲掃描與 tree 轉換 | `topologyPlugin` |
| `src/sessions/` | Agent session 清單與 summary markdown(讀 `sessiond` JSONL) | `sessionsPlugin` |
| `src/todo/` | 當前 workspace 的 `README.todo` 與 plans | `todoPlugin` |
| `src/projectsTodo/` | Workspace TODO 與跨專案 TODO sibling views | `projectsTodoPlugin` |
| `src/git/` | SCM reset、Explorer GitHub URL、Git hooks Install/Link 與 Status Bar | `gitPlugin` |
| `src/editorLayout/` | Editor group 四模式佈局（水平/垂直 × 均分/放大）與網格形狀 | `editorLayoutPlugin` |
| `src/diskUsage/` | 第一個 workspace volume 的 disk capacity Status Bar 顯示與週期刷新 | `diskUsagePlugin` |
| `src/cliLauncher/` | 獨立「CLI」面板：掃描兩層資料夾、subsequence 路徑過濾、每列顯示 git 分支與行數增減，三顆按鈕在該路徑開 terminal 跑 claude / codex / grok | `cliLauncherPlugin` |
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
- Terminal 一律由 VS Code 擁有。Superset 不持有 pseudoterminal、不 wrap、不替換、不重建既有 terminal；唯一開 terminal 的地方是 `src/terminals/nativeTerminal.ts#createNativeTerminal`（`vscode.window.createTerminal`），面板命令、`crossModuleState/terminalSpawner` lease 與 CLI Launcher 都走它，不得在其他 call site 直接呼叫 `createTerminal`。`createNativeTerminal` 的選用 `options.location` 只服務 CLI Launcher 的 editor-area 分頁需求；不傳時產生的 creation options 必須與原本的 panel 預設完全一致。決策記錄見 [`docs/specs/2026-08-04-remove-pty-use-native-terminals.md`](docs/specs/2026-08-04-remove-pty-use-native-terminals.md)。
- `TerminalRegistry` 是終端機狀態來源；`markUnseen` 必須保持 idempotent。`onDidOpenTerminal` 只做 `registry.add`，唯一排除條件是 `terminalFilter.ts#shouldTrackTerminal`（agent-owned 名稱），不得再依 creation options 分流。
- Tree View visibility 一律由 `src/plugin/viewVisibility.ts#registerViewVisibility` 接線並解構 event 的 `visible` boolean。UI-only polling / watcher 必須隨 View visibility 啟停；terminal activity source `A` / `B` 與 registry subscriptions 不屬於 UI-only work，不得因面板隱藏而停止。
- Activity 偵測的預設路徑是`零位元組`的來源 `A`（`processActivitySource`，進程樹輪詢）與 `B`（`shellIntegrationActivitySource`，execution start/end edge）。來源 `B` 不得呼叫 `execution.read()`；讀取位元組的 `OutputWatcher` 只在 `superset.terminals.legacyOutputWatcher` 開啟時建立。抑制政策（不在 registry / 正在 focus / 最近 focus / 已是 unseen）只能存在於 `ActivityCoordinator` 一處，不得再複製回各來源。
- 診斷日誌只在 `seen → unseen` 真的翻轉時輸出。被抑制的路徑是熱路徑，逐事件記錄會讓 OutputChannel 自己變成 EH 主執行緒的效能問題；Shell Integration reason 與 legacy `OutputWatcher` 日誌不得包含 command text 或 output payload，只能保留 lifecycle edge、exit code 與 byte count。
- 來源 `A` 每個 poll 只跑`一次` `ps`（供所有 terminal 共用），下一 tick 只在當前 tick settle 後排程，且 timer 必須 `unref()`。判定用累積 CPU 時間（`ps -o time=`）的 delta 而非 `%cpu`，並排除 shell 自身的 CPU —— 互動式 shell 光是重繪 prompt 就會累積，計入會讓每個閒置 terminal 看起來都在忙。
- Extension 不得引入 native pseudoterminal binding（`node-pty`、`@homebridge/node-pty-prebuilt-multiarch` 或任何 fork）。`scripts/verify-vsix.sh` 必須拒絕含有這些套件的 VSIX —— 它們會把 per-platform prebuild、executable bit 與 rebuild 失敗模式帶回打包流程。不可在 `.vscodeignore` 排除 production `node_modules`。
- `npm run clean` 必須先移除 generated `out/`，避免已刪 source 的 stale JavaScript 進入 VSIX。`npm run build` 必須以 `npm ci` 依 lockfile 重建 dependency tree，並使用 manifest 中 exact-pinned 的 `@vscode/vsce`，不得以未固定版本的 `npx` 下載打包器。`.vscodeignore` 排除 workspace metadata、native `.pdb` 與 dependency source/test payload，但必須保留 `pkg/resources/`；`scripts/verify-vsix.sh` 必須拒絕沒有對應 `src/*.ts` 的 packaged `out/*.js`。
- `spawnRunTerminal` 送出的是 `sendText(cmdline)`，不得補 `\r`：那是舊 PTY `handleInput` 的原始按鍵位元組語意，原生 terminal 會讀成第二次 Enter。
- CLI Launcher 的唯一資料來源是 `superset.cliLauncher.*` settings（`scope: application`、寫入 Global），不得引入 `globalState` 副本；掃描深度固定兩層且 root 本身不是節點。掃描讀取失敗一律回空陣列，一個打錯的 root 不得讓面板變成錯誤畫面。
- CLI Launcher 送進 terminal 的每一行都自帶 `cd '<path>'`，路徑一律以 POSIX single quote 包裝；terminal 重用以 `(path, agent)` 為 key，不比對顯示名稱（label 取 basename 會撞名）。非空命令在 delivery 前標記 `pending`，只有配對的 `onDidStartTerminalShellExecution` → `onDidEndTerminalShellExecution` 才解除 busy；busy 期間一律開新 terminal，不得把命令送進正在跑的 agent TUI stdin。
- CLI Launcher 的面板過濾是`逐段 (per segment)` 的 subsequence match：查詢以 `/` 切段，每段必須在`單一路徑段`內依序命中，段之間只能往後推進。subsequence 不得跨 `/` 或跨整條攤平路徑 —— `tool` 會在 `~/projects/collections/plans` 湊出 t-o-o-l 而誤命中，這是本功能第一版的實際 bug。單段查詢額外 fallback 比對顯示名稱；純規則集中在 `src/cliLauncher/filter.ts`。過濾字串是 ephemeral UI state，只存在 `CLILauncherTreeProvider` 記憶體中，不得寫入 settings 或 `globalState` —— settings 仍只描述路徑清單本身。過濾時 tree item id 必須帶上查詢字串當 scope，否則 VS Code 會沿用上一次的展開狀態。過濾以一次性 input box 套用，不做逐鍵即時過濾：掃描沒有快取，逐鍵會把 root 的 `readdir` 變成熱路徑。
- CLI Launcher 每一列的 description 是該路徑的 git 摘要 `<branch>(+<新增行>,-<刪除行>)`，不是路徑（完整路徑只留在 tooltip）。行數取 `git diff HEAD --numstat` 的加總（staged + unstaged，未追蹤不計，二進位略過）；分支取 `git branch --show-current`，detached 時退回短 hash。執行 git 前必須先確認`資料夾自己`有 `.git`（目錄或 submodule 的檔案）—— git 預設會沿父層往上找 repository，少了這個 gate，`~/projects/platform` 會顯示 `~/projects` 的狀態。乾淨 repo 仍顯示 `<branch>(+0,-0)`，只有非 repo 與讀取失敗才是空白；任何失敗（沒有 git、逾時、輸出過大）都當成沒有資訊，不得變成錯誤畫面。同一層的路徑要一次批次查詢（併發上限 8，分支與 diff 併發發出），第二層只在展開時才讀，不得逐列 await 或開面板就掃完兩層。
- CLI Launcher 的命令參數以 duck typing（`toCLIEntry`）解析，不得改用 `instanceof`：命令參數跨過 VS Code menu 層後型別不保證同源，`instanceof` 會靜默失敗成「按了沒反應」。
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
- Disk Usage Status Bar：[`docs/specs/2026-08-02-disk-usage-status-bar.md`](docs/specs/2026-08-02-disk-usage-status-bar.md)
- CLI Launcher（含自 `vscode-plugin-experiment` 移入的差異）：[`docs/specs/2026-08-04-cli-launcher.md`](docs/specs/2026-08-04-cli-launcher.md)
- CLI Launcher 路徑過濾（subsequence match）：[`docs/specs/2026-08-04-cli-launcher-path-filter.md`](docs/specs/2026-08-04-cli-launcher-path-filter.md)
- CLI Launcher git 分支與行數增減：[`docs/specs/2026-08-04-cli-launcher-git-branch-line-counts.md`](docs/specs/2026-08-04-cli-launcher-git-branch-line-counts.md)
- Visibility-scoped runtime 與 Sessions cache：[`docs/specs/2026-07-27-visibility-scoped-runtime-work.md`](docs/specs/2026-07-27-visibility-scoped-runtime-work.md)
- Security hardening：[`docs/specs/2026-07-27-security-hardening.md`](docs/specs/2026-07-27-security-hardening.md)
- Overall architecture：[`docs/specs/2026-07-02-architecture-master.md`](docs/specs/2026-07-02-architecture-master.md)
- Plugin framework：[`docs/specs/2026-07-02-architecture-pluginization.md`](docs/specs/2026-07-02-architecture-pluginization.md)
- Terminals / TUI：[`docs/specs/2026-06-20-terminal-dashboard-panel.md`](docs/specs/2026-06-20-terminal-dashboard-panel.md)、[`docs/specs/2026-07-02-architecture-terminals.md`](docs/specs/2026-07-02-architecture-terminals.md)
- Activity 偵測來源 `A` / `B`：[`docs/specs/2026-07-26-terminal-activity-sources-ab.md`](docs/specs/2026-07-26-terminal-activity-sources-ab.md)
- 移除 PTY、改用原生 terminal：[`docs/specs/2026-08-04-remove-pty-use-native-terminals.md`](docs/specs/2026-08-04-remove-pty-use-native-terminals.md)（取代先前的 PTY backpressure 與 spawn-helper 規格，後者僅存歷史語意）
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
- Default Tools CLI set：[`docs/specs/2026-07-22-default-tools-cli-set.md`](docs/specs/2026-07-22-default-tools-cli-set.md)、[`docs/specs/2026-07-27-default-tools-autop.md`](docs/specs/2026-07-27-default-tools-autop.md)、[`docs/specs/2026-07-27-default-tools-auth.md`](docs/specs/2026-07-27-default-tools-auth.md)、[`docs/specs/2026-07-27-default-tools-proxy.md`](docs/specs/2026-07-27-default-tools-proxy.md)、[`docs/specs/2026-08-03-default-tools-mdserver.md`](docs/specs/2026-08-03-default-tools-mdserver.md)
- Projects Setup：[`docs/specs/2026-07-22-projects-setup.md`](docs/specs/2026-07-22-projects-setup.md)、[`docs/specs/2026-07-23-projects-setup-repository-set.md`](docs/specs/2026-07-23-projects-setup-repository-set.md)
- Session JSONL 格式與 hook 事件：隨 `sessiond` 專案移至 [BizShuk/sessiond](https://github.com/BizShuk/sessiond)（[本地 `~/projects/ai/sessiond/docs/session/`](../ai/sessiond/docs/session/)）

外部 API：

- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [VS Code Terminal API](https://code.visualstudio.com/api/references/vscode-api#window.createTerminal)
