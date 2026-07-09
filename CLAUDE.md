# Superset 專案說明 (Project Notes)

VSCode 擴充功能:主側欄列出所有終端機,偵測背景終端機的新輸出並三處高亮(面板圖示、tab 名稱、狀態列)。本檔案記錄專案結構、建置指令與「為何這樣設計」的決策脈絡,作為日後維護與重構的依據。

> 對外文件 (功能描述、安裝、使用) 見 [`README.md`](README.md);設計決策歷史見 [`plans/`](plans/) (進行中計劃) 與 [`docs/specs/`](docs/specs/) (已實作的歷史規格)。

Update version in @package.json every change based on <majore,minor,patch>

---

## 與根 `CLAUDE.md` 的關係

本專案是 `vscode-plugin-experiment` 的子模組 (git submodule),位於 `superset/` 底下。

- 根 `../CLAUDE.md`:多專案聚合,定義 `md-tree-highlight` 等子模組的建置指令
- 本檔案 (`superset/CLAUDE.md`):`superset` 自己專屬的建置、TUI 偵測方案、版本紀錄

兩個檔案的「建置指令」段落不重複;本檔案只記 `superset/` 自己獨有的內容。

---

## 常用指令 (Commands)

從 `superset/` 目錄下執行:

| 動作                           | 指令                       |
| ------------------------------ | -------------------------- |
| 安裝相依套件 (第一次 / 更新後) | `npm install`              |
| 型別檢查 + 編譯                | `npm run build`            |
| 邊改邊編譯                     | `npm run watch`            |
| 跑單元測試                     | `npm test`                 |
| 持續跑測試                     | `npm run test:watch`       |
| 打包成 `.vsix`                 | `npx @vscode/vsce package` |

> `engines.vscode` 為 `^1.90.0`，需要 Shell Integration API 與 TabInputTerminal 穩定後的版本。1.90 之前 `Terminal.name` 還可寫，之後變 getter-only — 我們對齊到 1.90+ 的語意。

---

## TUI 偵測方案對照 (TUI Detection Approaches)

「TUI 偵測」指:在背景終端機跑 TUI app (`claude`、`vim`、`htop` 等) 時,即時偵測到新輸出並高亮。TUI 的特性是「一次長跑 shell command + 全螢幕 ANSI redraw」,shell integration 的 `execution.read()` 對這類 raw PTY 串流解析不可靠,需要另尋事件源。

### 方案演進史

| 階段         | 方案                                                                         | 為何放棄                                                                                        |
| ------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1            | `vscode.window.onDidStartTerminalShellExecution` + `execution.read()`        | 對 TUI 長跑 command 解析不穩,redraw chunk 漏                                                    |
| 2a           | `window.onDidWriteTerminalData` (全域 PTY byte 事件)                         | 已是 **proposed API** (`terminalDataWriteEvent`),需 `enabledApiProposals` + 啟動旗標;用戶摩擦大 |
| 2b           | `Terminal.onDidWriteData` (per-terminal)                                     | 同樣 proposed API,但 lifecycle 對齊較乾淨                                                       |
| 3            | 輪詢 `terminal.buffer` 算 diff                                               | 公開 API 拿不到 `terminal.buffer`;xterm hack 維護成本高                                         |
| 4            | `vscode.Pseudoterminal` + `node-pty` + 手動命令                              | 只覆蓋用戶主動開的 terminal,普通 + 鈕仍漏 TUI                                                   |
| **5 (現行)** | **Auto-PTY**:`onDidOpenTerminal` 偵測非 PTY terminal → 自動替換成 PTY-backed | **全部新開 terminal 均完整攔截 TUI;`ptyBackedTerminals` Set 防止 infinite loop**                |

### 為何選方案 4 (PTY-backed terminals)

`★ 決策 ─────────────────────────────────────`

- **完全繞過 VSCode 抽象層**:VSCode 內建 terminal 的 PTY 在 renderer process,extension 拿不到。唯一 extension 拿得到 PTY 的方式是「自己開」 — 用 `vscode.Pseudoterminal` 接 `node-pty`。
- **不需 proposed API 旗標**:`Pseudoterminal` 是穩定 API,`node-pty` 是普通 npm 套件。沒有啟動摩擦。
- **TUI 100% 攔截**:`node-pty` 開 master 端給我們讀,所有 PTY write (含 TUI redraw) 一個不漏。
- **取捨 (方案 5)**:`onDidOpenTerminal` 自動替換新 terminal,但 activate 時已存在的 terminal 不置換(避免打斷用戶工作)。Pre-existing terminal 仍靠 `OutputWatcher` fallback。
  `─────────────────────────────────────────────`

升級路徑:若未來要讓「既有 VSCode 內建 terminal」也吃到 TUI 偵測,目前沒有穩定 API 可走(只能回頭用 proposed API)。在 VSCode 開放 PTY 公開 API 前,方案 4 是最務實的選擇。

### 為何 `onDidEndTerminalShellExecution` 救不了 TUI

底層機制:shell integration script 注入 bash/zsh/pwsh 的 prompt hook,送出 OSC 633 控制序列,terminal 解析後轉成 API 事件:

```tree
OSC 633 ; A ST            → prompt 開始
OSC 633 ; B ST            → command input 開始 (prompt 結束)
OSC 633 ; C ST            → 指令執行開始    ──► onDidStartTerminalShellExecution
   ...command stdout/stderr...
OSC 633 ; D ; <exitCode>  → 指令結束       ──► onDidEndTerminalShellExecution
OSC 633 ; E ; <cmdline>   → 設定命令文字
```

- **`onDidEnd` 是「一般指令結束」的標準訊號**:`event.exitCode` 來自 shell 在 precmd 階段抓 `$?` 塞進 `D;<code>` 段;VSCode 解析成 `number | undefined`。`undefined` 出現於:shell 沒回報 code 段、指令被中斷、terminal 在指令進行中被 dispose。start↔end 配對靠**同一個 `execution` 物件參照**(不是指令文字),所以消費端用它當 Map key;`start` 不保證有對應 `end`(terminal 中途 dispose),故 end 時要 `delete` 避免 Map 洩漏。
- **對 TUI 失效的根因**:TUI (`claude`、`vim`、`htop`) 對 shell 而言是**一條長跑指令**,整段只有一組 C…D。`onDidEnd` 只在**整個 TUI 程式退出那一刻觸發一次**,TUI 執行期間的所有輸出/redraw 它一律收不到。
- **可用 vs 不可用**:
    - 想偵測「背景 TUI 跑到一半有新輸出」→ ❌ end 幫不上,必須維持 PTY (方案 5)。
    - 想知道「指令跑完 / 成功失敗 / TUI 被關掉」→ ✅ end + `exitCode` 正是標準做法,可另行整合(例如長指令完成提示),但與 TUI 即時偵測是兩條獨立路徑。

---

## 架構速覽 (Architecture)

### Composition Root

`src/extension.ts` (~120 行) 是 composition root,**完全 declarative** — 列 plugin 清單,其餘由 `PluginManager` 處理:

- 建立 `OutputChannel` + diagnostic logger
- 建立 `PluginManager` 並把 `workspaceFolder` / `extensionUri` / `Memento` 注入
- 依序 `activateAll([treePreview, todoPreview, terminals, mdns, topology, todo, globalCommands])` — 每個 plugin 自己負責 register commands / TreeView / disposable
- 透過 `manager.getMarkdownExtension()` 收集 `treePreview` + `todoPreview` 的 `contributeMarkdownIt`,回傳給 VSCode 觸發 Markdown 預覽
- 加新 feature 不再需要改 `extension.ts`:在 plugin 陣列加一行即可

`globalCommands` 是一個 inline `ExtensionPlugin`,把原本的 `resetCaches` / `focusView` / `showLogs` / `focusPanel` 收進來,並透過 `setPluginManager()` 拿到 manager 引用以呼叫 `resetAll()`。

### Feature Modules

每個 feature 是 `src/<feature>/` 一個資料夾 (沒有 `features/` 中間層),自帶 `index.ts` (組裝入口)、`types.ts` (該 feature 的 domain types) 與實作檔。四個 TreeView feature 走統一的 `register(ctx: FeatureContext): FeatureHandle` 介面;`treePreview` 是例外 (見表後說明):

| 模組                | 職責                                           | 主要元件                                                  |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| `src/terminals/`    | 終端機面板 + 高亮 + PTY 自動替換               | TerminalRegistry, OutputWatcher, PtyTerminalHost, ...     |
| `src/mdns/`         | mDNS 服務發現 TreeView                         | MdnsRegistry, MdnsTreeProvider                            |
| `src/topology/`     | 網路拓撲掃描 TreeView                          | TopologyStore, TopologyTreeProvider                       |
| `src/todo/`         | TODO 清單 TreeView + 過濾器 badge              | TodoStore, TodoTreeProvider, computeTodoBadgeTitle(badge) |
| `src/projects/`     | 專案分組 TreeView 面板                         | ProjectStore, ProjectsTreeProvider                        |
| `src/projectsTodo/` | 跨專案 TODO 總覽 (Overview,`superset-overall`) | ProjectsTodoStore, ProjectsTodoTreeProvider               |
| `src/treePreview/`  | Markdown `tree` 區塊語法高亮 + 預覽渲染        | createTreePreviewExtension, renderLine                    |
| `src/todoPreview/`  | `README.todo` 預覽:CSS 摺疊 + 過濾按鈕         | createTodoPreviewExtension, wrapSections                  |

> `treePreview` 與 `todoPreview` 同屬「Markdown 預覽貢獻」型 feature (不走 `register()`,只交出 `extendMarkdownIt`);`extension.ts` 用 `composeMarkdownExtensions()` 把兩者串到同一個 `md` 再回傳給 VSCode。`todoPreview` 純 CSS 互動 (`:has()` + checkbox hack,見 `styles/todo-preview.css`),無 preview JS;核心 `core` ruler 只在文件首個 heading 為 `# TODO` 時才重組 (`isTodoDoc` gate),其餘 markdown 預覽不受影響。「fold all + 單節獨立展開」共存為 CSS 天花板 (需 JS),刻意不做。

> 跨 feature 共用的框架型別 (`FeatureContext`、`FeatureHandle`、`SharedDeps`) 放在 `src/shared.ts`;各 feature 自己的 domain 型別放在該資料夾的 `types.ts` (原本集中在單一 `src/types.ts` 的 grab-bag 已依 feature 拆分)。

### `src/terminals/` 內部拆檔 (SRP)

`terminals/index.ts` 只做組裝 (registry、treeView、presenter、watcher、factory、commands 的接線 + 生命週期事件 + disposable 收集);各職責抽成獨立檔:

| 檔案                        | 職責                                                            | 可單元測試   |
| --------------------------- | --------------------------------------------------------------- | ------------ |
| `watchedTerminalTracker.ts` | 「使用者正在看哪個 terminal」狀態機 (含 recency 視窗,注入時鐘)  | ✓            |
| `dragAndDrop.ts`            | TreeView drag-and-drop controller (terminal/group 搬移)         | vscode-bound |
| `ptyTerminalFactory.ts`     | 建 PTY-backed terminal (node-pty spawner + Pseudoterminal 接線) | 部分         |
| `shellExecutionSource.ts`   | `onDidStartTerminalShellExecution` → OutputWatcher 事件 adapter | vscode-bound |
| `commands.ts`               | `registerTerminalCommands` / `registerGroupCommands`            | vscode-bound |

### Tree Preview (從 md-tree-highlight 合併)

`src/treePreview/` 是原獨立套件 `md-tree-highlight` (git submodule) 併入 superset 的成果。它不開 TreeView、不註冊 command、不產生 disposable,所以不走 `register()`;它的貢獻是 VSCode Markdown 預覽的 `extendMarkdownIt` hook,只能透過 `activate()` 的回傳值交出。

- `treePreview/renderLine.ts`:純函式,把單行 `tree` 內容 (box-drawing 連接符 + 名稱 + 可選 `# comment`) 轉成帶 📁/📄 icon 的 HTML span;無 `vscode` import,可直接單元測試。
- `index.ts`:`createTreePreviewExtension()` 用 `renderLine` 包出 `{ extendMarkdownIt }`,攔截 ` ```tree ` fenced block。
- 宣告性貢獻在 `package.json`:`languages` (tree)、`grammars` (`syntaxes/tree.tmLanguage.json` + markdown injection)、`markdown.markdownItPlugins: true`、`markdown.previewStyles` (`styles/tree.css`)。
- 因為要交出 `extendMarkdownIt`,`activate()` 的回傳型別從 `void` 改為 `MarkdownItExtension`。

### Plugin Framework (Stage 1, 進行中)

`src/plugin/` 引入輕量插件底座,作為後續 Stage 2–5 把四個 feature 模組拆出去的中介層。`FeatureContext` / `FeatureHandle` / `SharedDeps` 暫不替換(那是 Stage 6 的事),這層只做「介面已就緒、treePreview 已先套用」的純增量,讓 `extension.ts` 在 Stage 6 之前不必改動。

| 檔案                    | 職責                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `plugin/types.ts`       | `ExtensionPlugin` / `PluginContext` / `MarkdownIt` 介面                                                               |
| `plugin/context.ts`     | `createPluginContext` 工廠,封裝 `registerDisposable` / `registerResetHandler`                                         |
| `plugin/manager.ts`     | `PluginManager`:依序 `activate`、錯誤邊界、disposable 託管、`resetAll` / `deactivateAll`、合併 `contributeMarkdownIt` |
| `plugin/index.ts`       | barrel — 外部統一 `import { PluginManager, ... } from "./plugin"`                                                     |
| `treePreview/plugin.ts` | `treePreviewPlugin: ExtensionPlugin`,把 `createTreePreviewExtension` 的 hook 包成 `contributeMarkdownIt`              |

**錯誤邊界**:`PluginManager.activateAll` 對每個 plugin 各自 `try-catch`,失敗僅 log + 在 `workspaceState` 標 `plugin.failed.<id>`,**不會**中斷其他 plugin。這解決 master plan §1 列的「單一模組掛掉導致整個 extension 啟用失敗」。

**驗證**:`test/pluginManager.test.ts` (7 case) + `test/treePreviewPlugin.test.ts` (3 case) 涵蓋:順序 activate / 錯誤隔離 / workspaceState 標記 / disposable 託管 / reset handler 容錯 / `contributeMarkdownIt` 鏈式組合 / 無貢獻時 `getMarkdownExtension()` 回 `undefined`。

### Todo Feature 拆檔 (Stage 2)

`src/todo/` 從 661 行單檔拆為 SRP-對齊的三層 (parser / repository / store),純增量、公開介面零變化,所以既有的 25 個 `TodoStore` 黑箱測試**未改任何一行即全部通過**。

| 檔案                 | 職責                                                                                                                                                                                        | 行數級距      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `todo/parser.ts`     | 純函式 `parseTodoFile(content)` — Markdown 字串 → `TodoItem[]` AST;無 I/O,無 `vscode` import                                                                                                | 抽自 store    |
| `todo/repository.ts` | `TodoRepository.read()` / `.write(content)` — 唯一接觸 `fs/promises` 的地方;`read()` 同時回傳 parsed items 與 raw content (store 寫回時需要後者)                                            | 新建          |
| `todo/todoStore.ts`  | 純記憶體狀態 + observer;所有 I/O 委派給 repository,`load()` 改用 `parseTodoFile`;public methods 簽章完全不變                                                                                | 從 661 行微縮 |
| `todo/plugin.ts`     | `todoPlugin: ExtensionPlugin` shim,把 `PluginContext` 包成既有 `FeatureContext` 後呼叫 `register()`;`ctx.subscriptions.push` 攔截轉送到 `pCtx.registerDisposable`,disposable 進 plugin pool | 新建          |
| `todo/index.ts`      | 既有 `register(ctx: FeatureContext)` 入口;**本 stage 不動**,Stage 6 才清                                                                                                                    | 既有          |

**為何不做 AST-level serialize**:`plans/architecture-superset.md` §3 提議「改 AST 後整體序列化」,但本 stage 採**純粹 extract 而非重寫**策略 — 把行數 splice 邏輯原封不動搬進 store,避免 25 個既有 case 行為漂移 (master plan §7 風險一:Markdown 寫回破壞原始排版)。AST 序列化是後續獨立 PR 的事,風險與本 stage 解耦。

**測試新增**:`test/todoParser.test.ts` (8 case,純函式 roundtrip / nested / sections / bare list / 邊界) + `test/todoPlugin.test.ts` (3 case,介面契約 — id / 無 markdown 貢獻 / 有 deactivate;**activate 行為留到 Stage 6 整合測試**,因為 `index.ts` chain-import `vscode`,純 vitest 環境要 mock 整個 vscode surface 過重)。

### mDNS Feature 拆檔 (Stage 3)

`src/mdns/mdnsRegistry.ts` (488 行) 拆成 SRP-對齊的三層 (parser / store / expiration),registry 變成 thin coordinator。`MdnsRegistry` 公開介面零變化 → 既有的 23 個 case (`mdnsRegistry.test.ts` 15 + `mdnsRegistry.expiration.test.ts` 8) **未改任何一行** 即全部通過。

| 檔案                   | 職責                                                                                                                                                                                                           | 行數級距 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `mdns/parser.ts`       | 純函式 `applyPtr/Srv/Txt/Address` + `extractSubtype` / `stripSubtype` / `freezeMutable` / `trackMinTtl`;無 I/O,無 `vscode` import                                                                              | 新建     |
| `mdns/store.ts`        | `MdnsStore`: `services` Map + `byNetworkKey` + `canonKeyToNk` + `DetailCache`;`upsert(key, svc)` 自動 dedup,`remove(key)` 清索引,`getDetailCached` / `invalidateDetail`                                        | 新建     |
| `mdns/expiration.ts`   | `MdnsExpirationSweeper`: 包 `setInterval` 與 grace-period 計算;接受 `MdnsStore` + `ClockSource` + `ExpireListener`;`sweep()` 可手動觸發供測試用                                                                | 新建     |
| `mdns/mdnsRegistry.ts` | 改寫為 coordinator:持有 `store` + `sweeper` + `coalesceTimer` + `pending` map;`handlePtr/Srv/Txt/Address` **立即** apply parser 函式(保留原本 packet 進來時 stamp `lastSeen` 的時序,master plan §7 風險一防範) | 縮小     |
| `mdns/plugin.ts`       | `mdnsPlugin: ExtensionPlugin` shim(同 todo plugin 模式)                                                                                                                                                        | 新建     |
| `mdns/index.ts`        | 既有 `register(ctx: FeatureContext)` 入口;**本 stage 不動**                                                                                                                                                    | 既有     |

**為何不重做防抖合併的時序**:`plans/architecture-mdns.md` §7 風險一強調「`coalesceTimer` 與防抖調度必須留在 coordinator 層,所有暫存記錄統一以批次形式提交給 store」。本 stage 把 `handlePtr/Srv/Txt` 維持為「packet 進來立即 apply 到 pending,250ms 後 flush 凍結成 service」。Address 例外:因 `applyAddress` 需要走整個 pending map(`host` 比對),只能在 flush 階段跑 — 與原 `handleAddress` 行為一致。

**測試新增**:`test/mdnsParser.test.ts` (15 case,純函式 — subtype 抽取/TTL tracking/SRV 跳過無 port/Buffer TXT 解析/dedupe 位址) + `test/mdnsStore.test.ts` (8 case,`upsert` added/updated/network-key 合併/port change 釋放舊 nk/remove/clear/detail cache hit/miss/invalidate) + `test/mdnsPlugin.test.ts` (3 case,介面契約同 todo)。

### Terminals Feature 適配 (Stage 4)

`plans/architecture-terminals.md` §1 列了三個抽取目標 (`GroupRepository` / `PtyProcessController` / `TerminalLifecycleCoordinator`),但**實地盤點後三個都不適用現況**:

- `GroupStore` (`groupStore.ts`) 已經是純記憶體,**完全沒有 `workspaceState` 引用**;`grep -r workspaceState src/terminals/` 無命中。`GroupRepository` 抽出後會是空殼。
- `PtyTerminalHost` 已經有 `PtyProcess` / `PtySpawner` 介面抽象 + `deps.spawn` 注入,15 個 test 全是 mock-based,`PtyProcessController` 已在介面層完成(只是沒獨立檔案)。
- `TerminalLifecycleCoordinator` 抽取 260 行 `index.ts` 內 4 個 `onDid*` 事件源與 `decideAutoReplace` / `ptyFactory.isPtyBacked` 交叉邏輯,風險高。

**本 stage 範圍收斂為兩項**:

- `src/terminals/plugin.ts` (`terminalsPlugin: ExtensionPlugin` shim,模式同 todo/mdns)
- `test/ptyProcessContract.test.ts` (12 case,獨立鎖住 `PtyProcess` 介面契約 — open/handleInput/setDimensions/close 冪等/markUnseen 觸發條件/process exit → onClose/未 open 時為 no-op)

**為何保留 `index.ts` 整檔不動**:terminals 模組是 `vscode`-bound 重災區(15 個檔案 / 1900 行),`onDidOpenTerminal` 自動替換邏輯涉及 `ptyFactory.isPtyBacked` + `shouldTrackTerminal` + `decideAutoReplace` + `creationOptions` 多重判斷,任何協調器抽取都會需要替每個依賴寫 mock,效益低。`PtyProcess` 介面已是測試友好的抽象,後續真要做 coordinator 可從「事件源 → 委派函式」這個最小切面開始,不必一次到位。

### Topology Feature 拆檔 (Stage 5)

`topologyStore.scan()` 原本是 171 行的 God Function(子計畫 §1 點名批評),把 interfaces / routing / DNS / ARP 四段樹狀組裝 + `/24` subnet 遞迴插入演算法 + local IP 推導全部揉在一個 closure 裡。本 stage 抽成 SRP-對齊的三層 + 加 timeout。

| 檔案                        | 職責                                                                                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `topology/transformer.ts`   | 純函式 `transformScan(ScanInputs)` → `TopologyNode[]`;內部由 `buildInterfacesNode` / `buildTraceNode` / `buildRoutingNode` / `buildDnsNode` / `buildArpNode` 五個小組件構成,`subnet24` 與 `insertInto` 為私有輔助 |
| `topology/topologyStore.ts` | 改寫為 thin coordinator:`runScan` 委派給 `transformScan`;**新增 `SCAN_TIMEOUT_MS = 10_000` 與 `Promise.race` 熔斷**,子計畫 §6 stage 3 風險防範                                                                    |
| `topology/treeProvider.ts`  | rename 自 `topologyTreeProvider.ts`,對齊 todo / terminals 命名風格                                                                                                                                                |
| `topology/treeSpec.ts`      | rename 自 `topologyTreeSpec.ts`                                                                                                                                                                                   |
| `topology/plugin.ts`        | `topologyPlugin: ExtensionPlugin` shim(模式同 todo/mdns/terminals)                                                                                                                                                |

**為何保留 `TopologyNode` 形狀耦合 vscode TreeItem**:子計畫 §1 把這個當技術債,但本 stage **沒做解耦** — 改形狀會破壞 9 個 `topologyStore.test.ts` 黑箱 case,風險超過效益(子計畫自己也說是 follow-up)。

**測試新增**:`test/topologyTransformer.test.ts` (8 case,純函式 — 空輸入 / Local Interfaces 含 loopback / IPv6 註解 / subnet 切換遞迴 / Unreachable `* * *` / 段落順序) + `test/topologyPlugin.test.ts` (3 case,介面契約同前幾個 plugin)。既有 9 個 `topologyStore.test.ts` + 8 個 `localIp.test.ts` + 3 個 `topologyTreeSpec.test.ts` 全部未改邏輯即通過(只 `treeSpec.test.ts` import 跟著 rename 改一行)。

**踩坑記錄**:第一次寫 transformer 測試時誤以為 subnet 變化會在 `traceRoot.children` 加 sibling,實際 `insertInto` 是**把新 group 遞迴塞進上一個 group 的 children**。改測試反映真實行為,並加註解解釋。

---

## 計劃 vs 規格目錄 (plans/ vs docs/specs/)

兩個目錄存放 markdown 文件,功能不同:

| 目錄          | 用途                                               | 何時放入                                                  |
| ------------- | -------------------------------------------------- | --------------------------------------------------------- |
| `plans/`      | **進行中 / 未實作** 的設計與實作計劃               | 寫計劃時;feature 實作完成、push 成功後,搬到 `docs/specs/` |
| `docs/specs/` | **已實作且 push** 的歷史規格文件(已不再變動的紀錄) | 對應功能 commit 進 git history 後                         |

`docs/specs/` 內的檔案視為「事後記錄」,不再被當作進行中的計劃修改;新的變更以新 plan 形式開在 `plans/`,完成後整份升級進 `docs/specs/`。

### Terminals Feature 內部元件

以 `TerminalRegistry` 為唯一資料來源:

| 元件                   | 職責                                      | 訂閱來源                           |
| ---------------------- | ----------------------------------------- | ---------------------------------- |
| `TerminalRegistry`     | 維護終端機清單與 unseen 旗標              | —                                  |
| `OutputWatcher`        | Shell Integration events → markUnseen     | `onDidStartTerminalShellExecution` |
| `PtyTerminalHost`      | 真實 PTY 寫入 → markUnseen (TUI 完整偵測) | 內部 `node-pty.spawn` 的 `onData`  |
| `TerminalTreeProvider` | TreeView 面板                             | registry                           |
| `HighlightPresenter`   | tab 名稱前綴 + 狀態列文字                 | registry                           |

兩個偵測來源並存,`registry.markUnseen` 是 idempotent,雙重觸發無副作用:

- **既有 VSCode terminal**:`OutputWatcher` 透過 shell integration 監聽,可能漏 TUI
- **`Superset: Open TUI Terminal` 開的 terminal**:`PtyTerminalHost` 透過自己握的 PTY 100% 攔截,適合跑 TUI

### `PtyTerminalHost` 生命週期

```tree
[1] 使用者執行「Superset: Open TUI Terminal」命令
    │
    ├── extension.ts 建 PtyTerminalHost(getTerminal=closure, spawn, ...)
    │       closure 此時指向 undefined
    │
    ├── extension.ts 用 host 組出 vscode.Pseudoterminal 物件
    │
    ├── vscode.window.createTerminal({ name: "Superset TUI", pty })
    │       ← closure 此時指向新建的 vscode.Terminal
    │       ← onDidOpenTerminal 事件觸發,terminal 進 registry
    │
    └── terminal.show() → 框架呼叫 pty.open(dims)
            │
            └── PtyTerminalHost.open() 呼叫 spawn → node-pty.spawn(shell, "-i", ...)
                    │
                    └── 後續所有 PTY write 都走 host.detectActivity()
                            → 若非 active → registry.markUnseen(terminal)
```

關鍵: `getTerminal: () => terminalRef` 是 closure,host 內部不直接持有 terminal 參考,而是延遲到第一次資料流入時再取。這避免「terminal 還沒建好就要 reference」的 chicken-and-egg。

### Agent-owned terminal 排除 (Antigravity)

某些 terminal 是其他 agent/extension 擁有的背景工作終端機 (background worker),不是給用戶操作的工作面 (work surface),出現在面板上只是雜訊。最典型的例子是 Antigravity 開出來的 `Antigravity Agent` terminal。

- **`shouldTrackTerminal(name)`** (`src/terminals/autoReplace.ts`):純函式,name 含 `antigravity` (case-insensitive) → 不進面板。在兩個入口 (pre-populate loop 與 `onDidOpenTerminal`) 都先過這道閘,被排除的 terminal 從不進 registry,因此沒有 row、沒有高亮、也沒有 PTY wrap。
- **與 `decideAutoReplace` 的關係**:`shouldTrackTerminal` 先跑,agent terminal 在 PTY-replace 決策前就被丟掉;`decideAutoReplace` 內仍保留同樣的 `/antigravity/i` 檢查作 defense-in-depth。
- 名稱匹配兩邊一致,新增同類 agent 時兩處一起改。

### Projects TODO Overview 行為 (Overview Surfaces Every Project With A `README.todo`)

`src/projectsTodo/` 是另一個獨立 module (不要跟 `src/projects/` 搞混 — 後者只是列出 `~/projects/` 下的資料夾,**沒有** TODO 內容)。`Projects TODO` 顯示在 `superset-overall` 這個 viewContainer (Activity Bar 第二顆 icon),定位是跨專案待辦總覽。

掃描範圍 (`ProjectsTodoStore.load`):從 `~/projects/` 出發往下遞迴,最深 3 層 (`MAX_SCAN_DEPTH`),任何含有 `README.todo` 檔案的資料夾都會被收。每個被收的資料夾會掛一個內部 `TodoStore` 來 reuse 既有的 parse / write 邏輯,外面再 observe `loaded` 事件觸發 tree refresh。

`★ 設計 ─────────────────────────────────────`

- **Overview 一定列出有 `README.todo` 的專案**,即使該檔案:
    1. 全部都是 `- [x]` (在 hide-completed 模式下被 `filterCompleted` 清空)
    2. 檔案本身是空的 (只有 `# TODO` heading)
    3. 啟用了 priority filter (例如只看 `P0`) 但該專案只有其他 priority 的 task
- 舊版 `getChildren()` 在上述情境下會跳過整個 project row (使用者看到的 bug — 「all-done 專案從 overview 消失」)。修正後改為:
    - project row 永遠保留
    - 過濾後若 children 為空 → 收合 (`CollapsibleState.Collapsed`),展開才會看到空內容
    - 過濾後 children 非空 → 展開 (`Expanded`),即時看到 sections
- 這個語意呼應「Overview 是一覽表」的使用情境 — 使用者想知道「哪些專案還有 todo 檔」,而不是「哪些專案還有**可見的** task」;`- [x]` 的歸檔、priority filter 的主動篩選都不該讓 project 從 overview 消失。
  `─────────────────────────────────────────────`

`Pending` 計數 (`countPending(element.children)`) 仍是「目前過濾條件下可見的未勾選 task 數」 — 過濾條件會影響 children list,所以該數字會跟著 filter 走。當 children 為空時顯示 `0 pending`,這是「目前 filter 下沒有可見未完成 task」的真實狀態,而非「檔案內沒有未完成 task」(差異在 hide-completed + 全部 `[x]` 的情境)。

測試覆蓋:`projectsTodoTreeProvider.test.ts` 加了 4 個 case — all-completed、empty file、priority filter 全排除、collapsed/expanded 兩態。

---

## `node-pty` 整合

`@homebridge/node-pty-prebuilt-multiarch` 是 `node-pty` 的 prebuilt fork,提供 macOS / Linux / Windows 的 prebuilt binary。`npm install` 時自動挑對應 platform 的 prebuild,不需本地 native build toolchain。

VSIX 大小影響:vsce 只打包當前 platform 的 prebuild (例如 macOS arm64 跑 package 只會包那個 .node 檔),跨平台 prebuild 留在 node_modules 但不會進 VSIX。目前本機 build 出的 VSIX 約 157 KB(不含 `test/`、`docs/`、`plans/`;看 `ls -lh *.vsix` 取實際值)。

---

## mDNS 模組設計 (mDNS Module)

`MdnsRegistry` (`src/mdns/mdnsRegistry.ts`) 是純資料層:訂閱 `MdnsTransport`、解析 DNS-SD 記錄、用 observer pattern 對外發 `MdnsChange`。沒有 `vscode` import,可在純 Node 測試。

### 封包 → 合併 → 提交

- `handlePacket` 把一個 UDP datagram 內的 PTR/SRV/TXT/A/AAAA 記錄寫進 `pending: Map<instanceName, MutableService>`,250ms debounce 後 `flushPending` 一次凍結成 `MdnsService` 提交。同一 datagram 的多筆記錄合併成一個 service 才發事件,避免抖動。
- `services: Map<instanceName, MdnsService>` 以實例名稱為主鍵。

### 去重:network identity secondary key

- 同一台主機可能以多個 mDNS 實例名稱廣播、或同時走多張網卡 / IPv4+IPv6,造成面板重複列。`byNetworkKey: Map<host|port|type, canonicalName>` 為次索引;`flushPending` 提交時若新 service 的 network key 已存在於另一個實例名下,就 `mergeServices` 進該 canonical row(first-seen 名稱為準),其餘名稱存進 `service.aliases`,不再新增列。純函式 `networkKey` / `mergeServices` 在 `src/mdns/mdnsDedup.ts`。
- `canonKeyToNk` 反向索引讓「同一實例改 port」時能釋放舊 network-key 槽位,避免後續不同服務誤佔而假合併。
- `mergeServices` 同時聯集 addresses/subtypes、取 min ttl、取 max `lastSeen` / min `firstSeen` — 後者關鍵:新封包合併進 canonical 時不會留下過舊的 `lastSeen`,否則過期掃描會誤刪剛出現的服務。

### 過期:TTL grace period

- `services` 只增不減會讓面板塞滿已離線服務。`expireStale()` 每 `EXPIRY_TICK_MS`(5s)掃一次,`now - lastSeen > (ttl || TTL_DEFAULT_SECONDS) × 1000 × TTL_GRACE_MULTIPLIER`(3× TTL,RFC 6762 §10.1)就移除並發 `MdnsChange: "expired"` 事件。沒帶 TTL 的記錄 fallback 到 120s。持續收到封包的服務 `lastSeen` 不斷更新,永遠不過期。
- `MdnsChange` 多了 `expired` 變體(與 `removed` 區分:`removed` = transport 告知,`expired` = registry 自判),供監控/診斷用。`MdnsTreeProvider` 不分事件類型、只重抓 `getAll()`,故新增變體不影響消費端。
- `ClockSource`(預設 `Date.now`)為建構子選用依賴,測試以 `vi.useFakeTimers()` + 注入 `{ now: () => fakeNow }` 精確控制時間;正式環境呼叫端不變。
- 過期移除 canonical row 時同步清 `byNetworkKey` / `canonKeyToNk`,保持索引一致。

---

## 型別與 API 細節

### 為何 `TerminalHandle` 介面只有三個方法

`src/terminals/types.ts` 定義的 `TerminalHandle` 只 expose `name` / `show` / `dispose`。這是刻意的:

- 讓 fake terminal 在測試中容易構造 (見 `test/ptyTerminalHost.test.ts:11-13`)
- 避免把 deprecated / proposed API 變成核心契約
- 真實 `vscode.Terminal` 結構上滿足這個介面 (有更多方法但不衝突)

### `terminal.name` 在新版 VSCode 為 getter-only

`@types/vscode@1.85` 之後 `Terminal.name` 在 runtime 變 getter-only,`highlightPresenter.ts` 的 `nameWriteSupported` flag 自動降級到「面板 + 狀態列」模式 (見 `test/highlightPresenter.test.ts` 9 個 case 的倒數第二個)。

---

## 測試 (Testing)

`npm test` 跑 Vitest,目前 444 個 case 全綠 (46 個 test file):

| 測試檔                             | 對象                                                                   | 案例數 |
| ---------------------------------- | ---------------------------------------------------------------------- | ------ |
| `terminalRegistry.test.ts`         | 純狀態機                                                               | 17     |
| `watchedTerminalTracker.test.ts`   | watched-terminal 狀態機 + recency                                      | 8      |
| `outputWatcher.test.ts`            | Shell Integration watcher                                              | 6      |
| `ptyTerminalHost.test.ts`          | PTY host (TUI 偵測核心)                                                | 15     |
| `treeProvider.test.ts`             | 面板渲染 (`buildTreeItemSpec`)                                         | 11     |
| `highlightPresenter.test.ts`       | tab 前綴 + 狀態列 + 降級                                               | 11     |
| `badge.test.ts`                    | TODO badge 純函式                                                      | 6      |
| `autoReplace.test.ts`              | PTY 替換決策 + agent 排除                                              | 11     |
| `groupStore.test.ts`               | 群組 metadata                                                          | 25     |
| `jumpToTerminal.test.ts`           | 終端機 fuzzy 跳轉                                                      | (新增) |
| `localIp.test.ts`                  | 本機 IP 推導                                                           | (新增) |
| `mdnsDedup.test.ts`                | mDNS 去重純函式                                                        | 8      |
| `mdnsDetailCache.test.ts`          | mDNS detail 快取                                                       | (新增) |
| `mdnsRegistry.test.ts`             | mDNS registry + 去重                                                   | 15     |
| `mdnsRegistry.expiration.test.ts`  | mDNS 服務過期                                                          | 8      |
| `mdnsTreeSpec.test.ts`             | mDNS 面板渲染 + 細節欄位                                               | 12     |
| `resetCaches.test.ts`              | 快取重置鍵掃描                                                         | (新增) |
| `todoStore.test.ts`                | TODO store                                                             | 6      |
| `todoTreeProvider.test.ts`         | TODO 面板渲染                                                          | 17     |
| `topologyScanner.test.ts`          | 拓撲掃描                                                               | (新增) |
| `topologyStore.test.ts`            | 拓撲 store                                                             | 4      |
| `treePreview.test.ts`              | tree 區塊 renderLine 純函式                                            | 7      |
| `todoPreview.test.ts`              | section 包裹 + TODO gate 純函式                                        | 8      |
| `treePreviewPlugin.test.ts`        | treePreview ExtensionPlugin 介面                                       | 3      |
| `todoParser.test.ts`               | TodoParser 純函式                                                      | 8      |
| `todoPlugin.test.ts`               | todoPlugin 介面契約                                                    | 3      |
| `mdnsParser.test.ts`               | MdnsParser 純函式                                                      | 15     |
| `mdnsStore.test.ts`                | MdnsStore state + dedup                                                | 8      |
| `mdnsPlugin.test.ts`               | mdnsPlugin 介面契約                                                    | 3      |
| `ptyProcessContract.test.ts`       | PtyProcess 介面契約                                                    | 12     |
| `terminalsPlugin.test.ts`          | terminalsPlugin 介面契約                                               | 3      |
| `topologyTransformer.test.ts`      | TopologyTransformer 純函式                                             | 8      |
| `topologyPlugin.test.ts`           | topologyPlugin 介面契約                                                | 3      |
| `todoPreviewPlugin.test.ts`        | todoPreviewPlugin 介面契約                                             | 3      |
| `extensionActivate.test.ts`        | extension.ts end-to-end activate                                       | 5      |
| `pluginManager.test.ts`            | PluginManager 生命週期 + 錯誤隔離                                      | 7      |
| `projectsStore.test.ts`            | ProjectStore 掃描與分組                                                | 2      |
| `projectsPlugin.test.ts`           | projectsPlugin 介面契約                                                | 3      |
| `projectsTodoStore.test.ts`        | ProjectsTodoStore 跨專案掃描                                           | 8      |
| `projectsTodoTreeProvider.test.ts` | ProjectsTodoTreeProvider 渲染 + 過濾                                   | 12     |
| `installCommands.test.ts`          | installDefaultTools / skillInstall 走 PTY spawner + `&& exit` 自動關閉 | 5      |
| `smoke.test.ts`                    | 整體 smoke                                                             | 1      |

`TerminalTreeProvider` class 本體 (vscode-bound) 不做單元測試,渲染邏輯已抽到 `src/terminals/treeSpec.ts` 純函式。

---

## 相關連結

- 設計規格(已實作): [`docs/specs/2026-06-20-terminal-dashboard-panel.md`](docs/specs/2026-06-20-terminal-dashboard-panel.md)
- 進行中計劃: [`plans/`](plans/)

---

## Plan Files Integration

`plans/` 是設計中、未實作的 plan 文件 (`YYYY-MM-DD-<topic>.md`),傳統上需要手動翻資料夾才看得到。Local TODO panel (`src/todo/`) 把當前 workspace 的 `plans/*.md` 收成「工作區內計畫」;跨專案 TODO panel (`src/projectsTodo/`) 把整個 `~/projects` workspace 的 plan 收成「所有進行中計畫」。兩者語意不同,行為分述。

### Local TODO (0.8.4+)

Local panel 把當前工作區 root 下的 `plans/*.md` 收成 `<workspace>/<file>.md` 的 read-only item,附在 README.todo 的 section list 後。

### 設計重點 (local)

- **Pure scan**:`src/todo/plansSource.ts` 是純函式模組 (對齊 `parser.ts` 風格),`scanPlans(root)` 用 `readdir` + `stat` + 8-line head read 取 H1,無 `vscode` import。
- **合成 section**:`makePlansSection()` 在 `plansSource.ts` 共用;`level: undefined` 讓 `computeSectionContextValue` 走非 archivable 路徑,不會冒出 archive context menu。
- **Discriminated union**:`TodoItem.kind` 加 `"plan"` + 必填 `filePath` 欄位;`applyPriorityFilter` passthrough (任何 P0/P1/P2 filter 都保留 plan),`filterCompleted` 因 plan 無 checked 自動透過。
- **不開啟不寫入**:點 row 文字不做任何事 (與一般 non-link todo 一致);右側的「Open」icon 由 `package.json` 的 `viewItem == todoPlan` `group: "inline"` menu entry 提供 (對稱 `todoOpenLink`),觸發 `superset.todoOpenPlan` 走 `markdown.showPreview`。
- **三視圖行為差異**:
    - **Section view**:Plans section 末端附加,有 `N plans` description (無 `N ◐` badge)
    - **Priority view**:plan item 自然落入「None」group (沒 priority tag)
    - **File view**:plan item 群組在 synthetic `plans/` group,排 `README.todo` 之後

### 為何 kind 新增而非復用 list

`kind: "list"` 是「`- foo` 沒 checkbox 標記的 free-form note」,可能有 priority tag 也可能進 archive。Plan 是「整份 design doc 的 read-only entry」,這兩個語意混用會逼 `applyPriorityFilter` / `filterCompleted` / `countPending` 處處加 `if (item.filePath)` 分流。明確定義新 kind 比到處加 hack 乾淨,也避免 plan 被誤勾/誤 archive 的 UI 風險。

### Overview — Workspace Plans Row (0.8.5+)

Overview (`superset-overall` viewContainer) 不再為每個 project 各自附加 `## Plans` section,改成在 panel 末端開一個 top-level **「Plans」row**,把整個 `~/projects` workspace 的 plan 文件扁平列出。

### 設計重點 (overview)

- **Two-root, one-layer scan**:`getPlanRoots(home)` 回傳 `["~/projects", "~/projects/tmp"]` 兩條絕對路徑;`scanRootPlans(root)` 對每個 root 走 `readdir` 找第一層子目錄,呼叫 `scanPlans(child)` 讀其 `plans/*.md`。**不**遞迴到孫層,所以 `~/projects/foo/sub/plans/` 屬於 `foo` 自身,不由 overview 額外展開。
- **為何用這兩個 root**:`~/projects` 是所有專案的家目錄,`~/projects/tmp/` 是「進行中子分類」,兩者對應根 `CLAUDE.md` §分層。`~/tmp` 不存在;`playground/` 與 `archive/` 是同層分類,其中的「實驗/歸檔樣本」本身不是 live 專案,故不列入。
- **Flat list**:Top-level「Plans」row 的 children 是所有 plan 攤平後的清單(每筆帶 `projectName` / `projectPath` 標記來源,給 inline `openProject` 用),按 `(projectName, basename)` 字典序排序。不再有「plans-only 專案」這個概念 — 只有 `README.todo` 才定義一個 project,plans 永遠是附加的 read-only 條目。
- **filter passthrough**:Overview 的 `hide-completed` 與 priority filter 對 plan 完全不影響 (plan 沒有 checked / priority 概念),所以 plan 永遠出現在該 row 之下。
- **API 重命名**:`getPlanItems(p)` / `getPlanItemsEntries()` 已移除,改用 `getWorkspacePlans(): readonly WorkspacePlan[]` 一次拿整份。`WorkspacePlan = { info, projectName, projectPath }`,`info` 仍是原 `PlanInfo`。
- **Inline `openProject`**:Plan 子項右側的 `openProject` icon (由 `package.json` `viewItem == projectsTodoPlan` 提供) 跳到 plan 所屬的 project 目錄。Top-level「Plans」row 本身沒有這個 menu (它的 `projectPath` 是空字串 sentinel,`openProject` handler 會 null-check 後 no-op)。
- VSCode Terminal API 官方文件:<https://code.visualstudio.com/docs/terminal/shell-integration>
- VSCode Pseudoterminal:<https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal>
- node-pty:<https://github.com/homebridge/node-pty-prebuilt-multiarch>
