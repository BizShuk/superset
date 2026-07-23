# Superset 全專案術語 (Project Terminology)

本文件定義 Superset 文件、UI 文案、程式註解、issue 與設計討論使用的標準術語，
涵蓋 VS Code UI、所有已啟用 feature、跨 feature 操作與內部架構。描述 VS Code 介面時，
優先使用具體元件名稱，不以 `side panel` 或 `panel` 泛稱側欄內容。

本表描述 current implementation。歷史規格只保留當時語意；若與 `package.json`、程式碼或
[`CLAUDE.md`](../CLAUDE.md) 衝突，以目前 executable source 與 `CLAUDE.md` 為準。
尚未啟用或仍使用 proposed API 的項目會明確標示，不得寫成一般可用功能。

## 拼字與大小寫 (Spelling And Capitalization)

| 情境                           | 標準寫法                      | 說明                                                                 |
| ------------------------------ | ----------------------------- | -------------------------------------------------------------------- |
| 產品名稱                       | `Superset`                    | Extension、repository 與產品的統一名稱。                             |
| 第一個 View Container 顯示名稱 | `SuperSet`                    | 目前 manifest 的精確 title；不要用它取代產品名稱。                   |
| 第二個 View Container          | `Overall`                     | 收納跨 scope 的 sibling Views。                                      |
| 編輯器名稱                     | `VS Code`                     | 文件不使用 `VSCode`。API identifier 可保留 `vscode`。                |
| 協定名稱                       | `mDNS`                        | Multicast DNS protocol 的標準寫法。                                  |
| View 顯示名稱                  | `MDNS`                        | manifest 內的精確 View name。                                        |
| 待辦功能與檔名                 | `TODO`、`README.todo`         | `README.todo` 必須大小寫完全相符。TypeScript symbol 可使用 `Todo*`。 |
| Session daemon                 | `sessiond`                    | 外部 JSONL producer 的專案名稱，一律小寫。                           |
| VS Code prose                  | `Tree View`、`Tree Item`      | API type 或 symbol 才寫 `TreeView`、`TreeItem`。                     |
| Terminal technologies          | `PTY`、`TUI`                  | 第一次出現可寫 pseudoterminal、terminal user interface。             |
| Network technologies           | `DNS-SD`、`TXT`、`TTL`、`ARP` | 保留協定慣用大寫。                                                   |
| Source-control products        | `Git`、`GitHub`               | 不寫成 `gitHub` 或 `Github`。CLI command 仍為小寫 `git`。            |

## 介面層級 (UI Hierarchy)

```tree
VS Code Workbench
├── Activity Bar（活動列）
│   ├── SuperSet Activity Bar Item
│   └── Overall Activity Bar Item
├── Primary Side Bar（主側欄）
│   └── Active View Container（目前開啟的檢視容器）
│       └── View（檢視）
│           └── Tree View（樹狀檢視）
│               └── Tree Item（樹狀項目）
├── Secondary Side Bar（次側欄）
├── Editor（編輯器區域）
├── Panel（面板；通常放置 Terminal、Output、Problems）
└── Status Bar（狀態列）
```

`Activity Bar Item` 代表一個 `View Container`。選取該項目後，VS Code 會在
`Primary Side Bar` 顯示對應的 `View Container`。使用者可以移動 View 或 View
Container，因此 `Primary Side Bar` 描述的是預設位置，不是永久位置。

## 標準術語 (Canonical Terms)

| 術語                 | 中文           | 定義與使用方式                                                                      |
| -------------------- | -------------- | ----------------------------------------------------------------------------------- |
| `Workbench`          | 工作台         | VS Code 整個應用程式 UI。                                                           |
| `Activity Bar`       | 活動列         | 用來切換 View Container 的圖示列。                                                  |
| `Activity Bar Item`  | 活動列項目     | Activity Bar 上代表某個 View Container 的圖示。                                     |
| `View Container`     | 檢視容器       | 收納一個或多個 View；Superset 提供 `SuperSet` 與 `Overall`。                        |
| `Primary Side Bar`   | 主側欄         | 預設顯示 Activity Bar 所選 View Container 的區域。                                  |
| `Secondary Side Bar` | 次側欄         | 位於 Primary Side Bar 對側、亦可收納 View 的區域。                                  |
| `View`               | 檢視           | View Container 內可個別展開、收合或移動的功能區塊。                                 |
| `View Title`         | 檢視標題       | View 頂端的名稱，例如 `Terminals` 或 `TODO`。                                       |
| `View Title Actions` | 檢視標題動作   | View 標題右側的主要操作，以及 `...` 選單內的次要操作。                              |
| `Tree View`          | 樹狀檢視       | 以平面清單或階層樹呈現資料的 View 內容。                                            |
| `Tree Item`          | 樹狀項目       | Tree View 內的一個節點；在畫面上通常呈現為一列。                                    |
| `Panel`              | 面板           | 編輯器區域之外的另一個 View 區域，預設位於下方；常放 Terminal、Output 與 Problems。 |
| `Editor`             | 編輯器         | 顯示檔案、Markdown summary 或其他 editor-backed 內容的主要區域。                    |
| `Status Bar`         | 狀態列         | 視窗底部顯示狀態及捷徑的區域。                                                      |
| `Status Bar Item`    | 狀態列項目     | Status Bar 內由 extension 建立、可帶 command 與 tooltip 的項目。                    |
| `Command Palette`    | 命令面板       | 以 command title 搜尋及執行命令的 VS Code UI。                                      |
| `Quick Pick`         | 快速選擇器     | 從候選清單選取一項的浮動 UI。                                                       |
| `Input Box`          | 輸入框         | 輸入文字、名稱或 repository identifier 的浮動 UI。                                  |
| `Notification`       | 通知           | 非 modal 的 information、warning 或 error message。                                 |
| `Modal Confirmation` | 模態確認對話框 | 執行覆寫或破壞性操作前必須明確回覆的阻擋式 UI。                                     |
| `Output Channel`     | 輸出頻道       | 顯示 Superset 持續診斷 log 的 VS Code Output surface。                              |
| `Markdown Preview`   | Markdown 預覽  | 在 Editor 區域渲染 Markdown 的 built-in preview。                                   |
| `Webview View`       | Webview 檢視   | 放在 View Container 內的自訂 Webview。                                              |
| `Webview Panel`      | Webview 面板   | 放在 Editor 區域、以 editor tab 呈現的自訂 Webview。                                |

## Tree Item 組成 (Tree Item Anatomy)

Tree Item 可依功能包含以下元素：

| 元素                                  | 定義                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| `Expand/Collapse Control` (`twistie`) | 展開或收合 children 的箭頭。程式端由 `collapsibleState` 控制。     |
| `Checkbox`                            | 可勾選狀態。程式端由 `checkboxState` 控制。                        |
| `Icon`                                | 識別項目種類或狀態的圖示。程式端由 `iconPath` 控制。               |
| `Label`                               | Tree Item 的主要文字。                                             |
| `Description`                         | Label 後方較淡的補充文字，不應稱為 subtitle 或 badge。             |
| `Inline Actions`                      | Tree Item 右側直接顯示的操作圖示。                                 |
| `Tooltip`                             | 游標懸停時顯示的補充資訊。                                         |
| `Context Menu`                        | Tree Item 的右鍵選單。                                             |
| `Child Tree Item`                     | 展開 parent item 後顯示的下一層項目。                              |
| `Detail Row`                          | 用來呈現欄位名稱與值的 Child Tree Item；屬於 Superset 的語意名稱。 |

正式文件使用 `Tree Item`；描述畫面排列時可使用 `row`（列），例如
`session Tree Item` 或 `session row`。

## Superset 對應 (Superset Mapping)

| Manifest ID              | 顯示名稱         | 類型                               | 預設位置                  |
| ------------------------ | ---------------- | ---------------------------------- | ------------------------- |
| `superset`               | `SuperSet`       | View Container / Activity Bar Item | Primary Side Bar          |
| `superset-overall`       | `Overall`        | View Container / Activity Bar Item | Primary Side Bar          |
| `superset.terminals`     | `Terminals`      | Tree View                          | `SuperSet` View Container |
| `superset.mdns`          | `MDNS`           | Tree View                          | `SuperSet` View Container |
| `superset.topology`      | `Topology`       | Tree View                          | `SuperSet` View Container |
| `superset.sessions`      | `Sessions`       | Tree View                          | `SuperSet` View Container |
| `superset.todo`          | `TODO`           | Tree View                          | `SuperSet` View Container |
| `superset.workspaceTodo` | `Workspace TODO` | Tree View                          | `Overall` View Container  |
| `superset.projectsTodo`  | `Projects TODO`  | Tree View                          | `Overall` View Container  |

`src/projects/` 具有 `projectsPlugin` adapter，但目前未列入 composition root，也沒有對應的
manifest View。文件應稱為 `inactive Projects module`，不得描述成目前可見的 `Projects View`。

## Workspace 與 Project Scope

| 術語                     | 定義                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Workspace`              | 目前 VS Code window 開啟的工作範圍。不要直接假設它等同 `~/projects`。                                     |
| `Workspace Folder`       | `vscode.workspace.workspaceFolders` 內的一個 root folder。部分 Superset 功能只使用第一個 folder。         |
| `Current Workspace Root` | Superset 此次 activation 選定的 workspace root；沒有 opened folder 時才 fallback 到 process cwd。         |
| `Project`                | 由特定 feature 規則識別的目錄。TODO、Sessions 與 inactive Projects module 的 project discovery 規則不同。 |
| `Project Root`           | 某個 project 的絕對目錄路徑。TODO 寫入、plan scan 與 Git 操作皆以明確 root 為界。                         |
| `Projects Root`          | Projects TODO 固定使用的 `~/projects` root。root 自身為 depth 0 且不顯示為 project row。                  |
| `Descendant Project`     | 位於 current workspace root 下、符合該 feature discovery 規則的巢狀 project。                             |
| `Scope`                  | 一個 View 或操作允許讀寫的目錄邊界。不同 scope 不得混用 store、watcher 或 mutation target。               |
| `Scan Depth`             | 相對 scan root 的目錄層數；root 是 depth 0，直屬 child 是 depth 1。                                       |
| `Recursive Scan`         | 命中符合條件的目錄後仍繼續掃描 descendants，直到 max depth 或 prune rule。                                |
| `Pruned Subtree`         | 因 dot-prefix 或 skip directory 規則而整棵略過的目錄樹。                                                  |
| `Duplicate Suppression`  | 同一路徑同時落入 Workspace TODO 與 Projects TODO 時，只由 Workspace TODO 顯示。                           |

## Terminals 術語

| 術語                          | 定義                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Terminals View`              | `superset.terminals` Tree View；顯示 tracked terminals 與 terminal groups。                                                  |
| `Terminal Dashboard`          | Terminals feature 的產品能力名稱；正式 UI 位置仍稱 `Terminals View`。                                                        |
| `Terminal`                    | VS Code terminal instance。                                                                                                  |
| `Active Terminal`             | 目前使用者聚焦的 terminal；其輸出不應標為 unseen。                                                                           |
| `Background Terminal`         | 仍在執行但目前不是 active terminal 的 terminal。                                                                             |
| `Tracked Terminal`            | 已進入 `TerminalRegistry`、會出現在 Terminals View 並參與 unseen tracking 的 terminal。                                      |
| `Excluded Terminal`           | 因 agent-owned、hidden 或其他 guard 而不進入 dashboard 的 terminal；目前名稱含 `antigravity` 的 terminal 會被排除。          |
| `Terminal Handle`             | Domain-facing narrow contract，只暴露 `name`、`show()` 與 `dispose()`。                                                      |
| `Terminal Registry`           | Terminal presence 與 unseen state 的唯一 source of truth。                                                                   |
| `Unseen Output`               | Background terminal 在使用者離開後產生、尚未由重新聚焦清除的輸出。                                                           |
| `Unseen Terminal`             | `hasUnseenOutput` 為 true 的 tracked terminal。                                                                              |
| `New-output Indicator`        | `● 新輸出` 狀態；同步呈現在 Tree Item、terminal tab prefix 與 Status Bar。                                                   |
| `Recently Active Suppression` | 使用者剛離開 terminal 時忽略 trailing output，避免立即產生 false-positive unseen state。                                     |
| `markUnseen`                  | 將 terminal 標記為 unseen 的 idempotent registry transition；重複訊號不得重複污染狀態。                                      |
| `Shell Integration`           | VS Code 提供的 shell command/execution integration。                                                                         |
| `Shell Integration Fallback`  | 既有或無法安全替換的 terminal 透過 shell execution output 偵測活動；不保證捕捉所有 TUI redraw。                              |
| `PTY`                         | Pseudoterminal，提供 terminal process 的原始輸入輸出資料路徑。                                                               |
| `PTY-backed Terminal`         | 由 Superset 透過 `vscode.Pseudoterminal` 與 `node-pty` 建立的 terminal。                                                     |
| `TUI`                         | Terminal User Interface，例如 Claude Code、Vim 或 htop；full-screen redraw 不等同一般 shell command output。                 |
| `TUI Terminal`                | 由 `Superset: Open TUI Terminal` 新建的 PTY-backed Terminal。                                                                |
| `Raw PTY Data Path`           | 未依賴 shell command boundary、可觀察完整 terminal byte stream 的輸出路徑。                                                  |
| `Auto-replace`                | 將可安全重現的 plain Panel terminal 替換為 PTY-backed clone。custom shell、editor/split、hidden 或既有 PTY terminal 不替換。 |
| `Plain Panel Terminal`        | 使用 default shell、default location、可見且不是既有 pseudoterminal 的 terminal；此處 `Panel` 是 VS Code 正式區域名稱。      |
| `Terminal Group`              | 使用者建立、可命名、改色、排序與收合的 terminal 集合。                                                                       |
| `Ungrouped`                   | 尚未指派到自訂 group 的預設 terminal group。                                                                                 |
| `Group Unseen Count`          | group 內 unseen terminals 的聚合數量，顯示為 group description。                                                             |
| `Fuzzy Jump`                  | 依 terminal name、PID 或 cwd 搜尋並聚焦 terminal 的 Quick Pick flow。                                                        |
| `Terminal Activity Summary`   | 將 tracked terminal、PID、cwd、PTY 與 unseen state 擷取成一次性 Markdown snapshot。                                          |

## Terminal Mermaid 術語

| 術語                   | 定義                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `Mermaid Trigger Line` | trim 後大小寫不敏感地完全等於 `mermaid` 的 terminal line。                              |
| `Mermaid Body`         | Trigger Line 下一行開始，到第一個空白 terminator line 前的 diagram source。             |
| `Terminator Line`      | 去除 trailing whitespace 後沒有內容的 line，用來結束 Mermaid Body。                     |
| `Mermaid Line Buffer`  | 每個 terminal 保留近期 render lines 的 bounded ring buffer；寫入時移除 ANSI sequences。 |
| `Partial Line`         | 尚未收到 newline 的 terminal chunk 尾端，下一個 chunk 會先與它合併。                    |
| `Terminal Link`        | VS Code terminal 內可點擊的 `mermaid` trigger range。                                   |
| `Mermaid Preview`      | 將 captured body 寫入暫存 Markdown fenced block，再交給已安裝 Mermaid extension 渲染。  |
| `Preview Temp File`    | 每次 Mermaid Preview 建立的獨立 `superset-mermaid-*.md` 暫存檔。                        |
| `Source Fallback`      | 沒有 Mermaid renderer 時，在 Editor 開啟 generated Markdown source。                    |

## Sessions 術語

| 術語                           | 定義                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `Sessions View`                | `superset.sessions` read-only Tree View，以 `project → session` 兩層顯示 sessiond records。                                 |
| `sessiond`                     | 產生並維護 agent session JSONL store 的外部系統；Superset 只讀取其資料。                                                    |
| `Session Store Root`           | 預設 `~/.config/superset/data/sessions`；`superset.sessions.dataDir` 只供開發 scratch store override。                      |
| `Workspace Bucket`             | Store Root 下以 percent-encoded workspace path 命名的目錄。project identity 來自 decoded bucket path。                      |
| `Session`                      | 一個 agent 工作階段；on-disk 形式是一個 append-only JSONL file。                                                            |
| `Session Record`               | Superset 解析後的 meta、turns、file path、size、last-active time 與 malformed count 集合。                                  |
| `Session Meta`                 | JSONL 第一行的 `meta` record，包含 agent、session ID、workspace、title、resume、created time 與 schema version。            |
| `Turn`                         | JSONL 中 meta 之後的一筆 `turn` record；這是 storage contract 用語。                                                        |
| `Round`                        | Session Summary 內呈現一個 Turn 的 `##` heading；這是 presentation 用語。不要將 JSON field 改名為 round。                   |
| `Tool Call`                    | Turn 內選配的 tool execution record，在 summary 中使用 `###` heading。                                                      |
| `Agent`                        | Session producer，例如 `claude`、`codex`、`grok` 或 `antigravity`。parser 必須容忍未來的新值。                              |
| `Summary Source`               | Turn summary 的來源標記，例如 `heuristic`、`llm` 或 `native`。                                                              |
| `Resume Metadata`              | 用來恢復 session 的 kind、command 與 cwd。                                                                                  |
| `Session Project Group`        | Sessions View 的 top-level Tree Item，以 decoded workspace path 分組 sessions。                                             |
| `Session Row`                  | Session Tree Item；Label 是 title 或 session ID，Description 顯示 size、turn count 與 relative age。                        |
| `Session Summary`              | 由 JSONL record 動態產生、在 Markdown Preview 開啟的唯讀摘要文件。heading 契約為 session `#`、Round `##`、Tool Call `###`。 |
| `Session Source File`          | backing raw `.jsonl` file，由 `Open Session Source File` 開啟。                                                             |
| `Sample Session`               | 檔名以 `sample-` 開頭、由 Superset seed command 產生的測試資料。                                                            |
| `Ingest Session`               | 由 sessiond ingest path 產生、不是 `sample-` prefix 的正式 session file。                                                   |
| `Sample Prefix Gate`           | clear/delete path 只允許處理 `sample-*.jsonl` 的內部安全檢查；不得只依賴 UI 呼叫端過濾。                                    |
| `Malformed Line`               | 無法解析的 JSONL line；parser 略過並在 tooltip/summary 顯示 warning，不中止整個 session。                                   |
| `Schema Version`               | Session JSONL contract version；未知 future version 必須 graceful degradation。                                             |
| `Last Active`                  | last turn timestamp 與 file mtime 的較新值，用於排序及 relative age。                                                       |
| `Descendant Workspace Session` | bucket path 位於 current workspace root 下的 session；segment containment 不使用單純 string prefix。                        |
| `Store Watcher`                | 遞迴監看 session store 的 file watcher；新增 bucket 或 append turn 會刷新 Sessions View。                                   |

## TODO、Projects TODO 與 Plans 術語

### Scope 名稱

| 術語                       | 定義                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `TODO View`                | `superset.todo`；只讀寫 Current Workspace Root 的 `README.todo`，並顯示該 root 的 `plans/*.md`。                             |
| `Workspace TODO View`      | `superset.workspaceTodo`；在 current workspace root 內遞迴尋找 `README.todo`。root 為 depth 0，max depth 預設 5、可設 1–10。 |
| `Projects TODO View`       | `superset.projectsTodo`；固定掃描 `~/projects` depth 1–5，不提供自訂 root 或 depth。                                         |
| `Overall View Container`   | 收納 Workspace TODO 與 Projects TODO 兩個 sibling Views；不是合併後的單一 Tree View。                                        |
| `README.todo`              | 唯一被 TODO scan 接受的 case-sensitive filename。                                                                            |
| `TODO Document`            | 第一個 heading 為 `# TODO`、內容以 Markdown headings 與 list items 組成的 `README.todo`。                                    |
| `TODO Scope Boundary`      | TODO、Workspace TODO、Projects TODO 各自的 scan、store、watcher 與 write target；不可交叉使用。                              |
| `Workspace Project Row`    | Workspace TODO 中由 workspace-relative path 標示的 project Tree Item。                                                       |
| `Projects Project Row`     | Projects TODO 中以 `path.basename` 標示的 project Tree Item，預設收合。                                                      |
| `TODO Scan Skip Directory` | dot-prefixed directories，以及 `node_modules`、`out`、`dist`、`build`、`coverage`；命中後 prune whole subtree。              |

### Item 與狀態名稱

| 術語                      | 定義                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `TODO Item`               | TODO domain tree node 的泛稱；實際 kind 為 checkbox、list、section 或 plan。                                                           |
| `Checkbox Item`           | 原始行是 `- [ ]` 或 `- [x]` 的 actionable task，可切換 checked state。                                                                 |
| `List Item`               | 沒有 checkbox marker 的 Markdown list row；用於 free-form note，不可 toggle。                                                          |
| `Section`                 | 由 `##` 或更深 heading 解析出的 group，或由 provider 建立的 synthetic group。                                                          |
| `Real Section`            | 對應 `README.todo` 內實際 heading line 的 Section。                                                                                    |
| `Synthetic Section`       | 沒有實際 heading line的 virtual group，例如 `Default`、priority/file group 或 `Plans`。                                                |
| `Default Section`         | 文件在第一個 `##` heading 前的 items 所屬 synthetic section。                                                                          |
| `Archive Section`         | 名稱為 `Archive` 的歸檔區域；task archive 與 rollback 以此為目標或來源。                                                               |
| `Archived Subsection`     | 位於 Archive tree 下的 nested real section。                                                                                           |
| `Nested Item`             | 透過 Markdown indentation 成為另一 item child 的 item。                                                                                |
| `Pending Task`            | `checked == false` 的 Checkbox Item。List Item 與 Plan Item 不算 pending task。                                                        |
| `Completed Task`          | `checked == true` 的 Checkbox Item。                                                                                                   |
| `Pending Count Indicator` | Project 或 Section description 顯示的 pending task 數量，例如 `N pending` 或 `N ◐`；implementation 是 Description，不是 native badge。 |
| `Priority`                | Checkbox Item 的 `P0`、`P1`、`P2` 或 `None` 分類。P0 最高、P2 最低。                                                                   |
| `Section View`            | 按 Markdown section hierarchy 分組的 TODO projection。                                                                                 |
| `Priority View`           | 按 P0、P1、P2、None 分組的 TODO projection。                                                                                           |
| `File View`               | 按來源 file/path 分組的 local TODO projection；Projects TODO 不提供此 view type。                                                      |
| `Completed Filter`        | 隱藏或顯示 completed/archive content 的 View Title Action。                                                                            |
| `Priority Filter`         | 只保留指定 P0/P1/P2 items 的 View Title Action；可組合啟用。                                                                           |
| `Inline Link`             | TODO text 中的 Markdown link；由 `linkUtils.ts` 統一解析、開啟及格式化 copy text。                                                     |
| `Archive`                 | 將 TODO Item 或 Section 移至 Archive 的 mutation。不要與 Archive Plan 混為同一路徑。                                                   |
| `Rollback`                | 將 archived TODO Item 移回 active section 的 mutation。                                                                                |

### Plan lifecycle 名稱

| 術語                   | 定義                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `Active Plan`          | 位於 `<project>/plans/*.md`、仍在進行中的設計文件。                                                      |
| `Plan Item`            | 從 Active Plan 合成的 TODO domain item。內容不作為 TODO text 編輯，也不納入 pending count。              |
| `Plans Section`        | 每個 local/per-project scope 內合成的 `Plans` Section；沒有 top-level merged Plans row。                 |
| `Plan Title`           | Plan file 前八行內第一個 H1；沒有 H1 時由 basename humanize。                                            |
| `Plan Description`     | Plan Item 右側顯示的 basename（不含 `.md`）。                                                            |
| `Complete Plan`        | `plans/<file>` → `docs/specs/<file>`，表示 implementation complete。勾選 Plan Item 亦觸發此 transition。 |
| `Backlog Plan`         | `plans/<file>` → `docs/backlog/<file>`，表示保留但目前暫停。                                             |
| `Archive Plan`         | `plans/<file>` → `plans/archive/<file>`，表示只保留歷史價值。                                            |
| `Delete Plan`          | 刪除 `plans/<file>`，只適用於誤建且沒有歷史價值的 plan。                                                 |
| `Plan Target Conflict` | lifecycle target 已有同名檔；操作必須拒絕 overwrite 並要求人工處理。                                     |

## MDNS 與 mDNS 術語

| 術語                        | 定義                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `MDNS View`                 | `superset.mdns` Tree View 的 manifest 顯示名稱。                                            |
| `mDNS`                      | Multicast DNS discovery protocol。提到 protocol、transport 或 command 時使用此拼法。        |
| `DNS-SD`                    | DNS-Based Service Discovery；以 PTR、SRV、TXT、A/AAAA records 描述服務。                    |
| `mDNS Transport`            | 訂閱 multicast packets 並將 raw DNS records 交給 parser 的 I/O boundary。                   |
| `Service Instance`          | 一筆具名 DNS-SD service advertisement，例如 printer 或 SSH service。                        |
| `Instance Name`             | Service Instance 的完整名稱；first-seen name 會成為 Canonical Name。                        |
| `Service Type`              | 服務協定類型，例如 `_http._tcp`。MDNS View 以此建立 top-level group。                       |
| `Domain`                    | DNS domain，mDNS 通常為 `local`。                                                           |
| `Host`                      | SRV target hostname。                                                                       |
| `Address`                   | A/AAAA record 解析出的 IPv4 或 IPv6 address。                                               |
| `Port`                      | SRV record 宣告的 TCP/UDP port。                                                            |
| `Service Address`           | Copy action 使用的 `host:port` 表示。                                                       |
| `TXT Properties`            | TXT record 的 key-value metadata。                                                          |
| `Subtype`                   | PTR record 宣告的 service subtype。                                                         |
| `Network Endpoint`          | 由 host/address、port 與 type 描述的實際服務端點。                                          |
| `Network Key`               | `${host ?? addresses[0]}\|${port}\|${type}` secondary identity，用於 endpoint dedup。       |
| `Canonical Service`         | 多個 network-identical instances 合併後保留的 service value。                               |
| `Canonical Row`             | Canonical Service 在 MDNS View 中的唯一 Tree Item。                                         |
| `Canonical Name`            | 同一 Network Key 第一次發現的 Instance Name。                                               |
| `Alias`                     | 後續解析到同一 Network Key、被合併進 Canonical Service 的其他 Instance Name。               |
| `Network-identity Dedup`    | 以 Network Key 合併重複 instances 的流程。                                                  |
| `Pending Merge Window`      | Parser 暫存分散 DNS records、在發佈 service 前等待組合完整的時間窗。                        |
| `mDNS Registry`             | 協調 transport records、pending merge、store 與 expiration sweeper 的 domain boundary。     |
| `mDNS Store`                | 保存 Canonical Services、network-key indexes 與 detail cache 的 state owner。               |
| `Forward Network-key Index` | Network Key → Canonical Row key 的 lookup。                                                 |
| `Reverse Network-key Index` | Canonical Row key → Network Keys 的 lookup；更新或刪除 service 時用來釋放 stale slots。     |
| `Detail Cache`              | MDNS service detail fields 的 cache；service update/remove/expire 時必須同步 invalidation。 |
| `TTL`                       | DNS record time-to-live，以秒表示。service TTL 取組成 records 的 minimum TTL。              |
| `Grace Period`              | service expiration threshold；目前為 `3 × TTL`，缺 TTL 時 fallback 120 秒。                 |
| `Expiration Sweep`          | 週期性尋找超過 Grace Period 的 stale services 並同步移除 indexes。                          |
| `Removed`                   | Transport 明確告知 service removal。                                                        |
| `Expired`                   | Registry 因 TTL/last-seen 判定 service 過期。不得與 Removed 合併成同一事件語意。            |
| `First Seen`                | Canonical Service 首次被發現的 timestamp。                                                  |
| `Last Seen`                 | 最近一次持續 update 或 rediscovery 的 timestamp；merge 不得被較舊值倒退。                   |
| `Source Address`            | 收到 multicast packet 的來源 IP，用於 network interface diagnosis。                         |
| `Connect Action`            | 依 service type 嘗試以適當 URI scheme 連線，例如 `ssh://`。                                 |

## Topology 術語

| 術語                    | 定義                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `Topology View`         | `superset.topology` Tree View，顯示一次 network scan 的 structured result。                             |
| `Network Topology Scan` | 平行收集 interfaces、gateway、traceroute、DNS 與 ARP data 的一次操作。                                  |
| `Scan Input`            | Scanner transport 產生、交給 pure transformer 的 raw network data。                                     |
| `Topology Node`         | Scanner output 轉換後的 label、description、children domain node。                                      |
| `Local Interfaces`      | 非 internal IPv4/IPv6 interfaces 與 loopback entries 的 root section。                                  |
| `Network Interface`     | OS network device 及其 addresses、MAC 與 internal flag。                                                |
| `Local IP`              | 從 interfaces 與 gateway 推導出的本機 route origin。                                                    |
| `Loopback`              | internal local-only address，例如 `127.0.0.1` 或 `::1`。                                                |
| `Routing`               | Default Gateway 與 Trace 的 root section。                                                              |
| `Default Gateway`       | local network 的 default route next hop。                                                               |
| `Trace`                 | 到固定 target `8.8.8.8` 的 traceroute hierarchy。                                                       |
| `Hop`                   | traceroute path 中的一個節點，包含 hop index、IP、time 與選配 role。                                    |
| `Subnet Group`          | 依 IPv4 `/24` network 將 consecutive hops 分組的 Tree Item。                                            |
| `Unreachable`           | traceroute 回傳 `*` 時使用的 synthetic subnet state。                                                   |
| `DNS Servers`           | OS resolver addresses 的 root section。                                                                 |
| `ARP Table`             | 同網段 IP-to-MAC entries 的 root section。                                                              |
| `ARP Entry`             | 一個 neighbor IP 與 MAC address pair。                                                                  |
| `Scan Timeout`          | network scan 的 10-second failure boundary；逾時不得無限阻塞 View。                                     |
| `Topology Transformer`  | 將 Scan Inputs 純轉換為固定順序 `Local Interfaces → Routing → DNS Servers → ARP Table` 的 pure module。 |

## Markdown 與 Preview 術語

| 術語                   | 定義                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `Markdown Contributor` | 透過 `extendMarkdownIt` 參與 built-in Markdown Preview rendering 的 plugin；不是 Tree View feature。 |
| `Tree Preview`         | 將 info string 精確為 `tree` 的 fenced code block 渲染成 icon-enhanced directory tree。              |
| `tree Fenced Block`    | 以 triple backticks 與 `tree` info string 包住的 Markdown code block。                               |
| `Tree Connector`       | `│`、`├`、`└`、`─` 等 box-drawing prefix。                                                           |
| `Directory Entry`      | 名稱以 `/` 結尾、預覽顯示 folder icon 的 tree line。                                                 |
| `File Entry`           | 名稱不以 `/` 結尾、預覽顯示 file icon 的 tree line。                                                 |
| `Tree Inline Comment`  | tree line 第一個 `#` 起的 trailing comment，預覽以 dim style 顯示。                                  |
| `TODO Preview`         | 只對 first heading 精確為 `# TODO` 的 Markdown document 啟用的互動式 preview enhancement。           |
| `TODO Preview Gate`    | 檢查第一個 heading 是否為 top-level `# TODO`；不符合時 token stream 原樣返回。                       |
| `Section Wrapper`      | TODO Preview 將 heading-led content 包裝成可摺疊 `<section>` 的 transform。                          |
| `Filter Bar`           | TODO Preview 頂端的 sticky CSS controls。                                                            |
| `Hide Done`            | TODO Preview 隱藏 completed/archive content 的 CSS-only control。                                    |
| `Fold All`             | TODO Preview 統一收合或展開 sections 的 CSS-only control。                                           |
| `Markdown-it Chain`    | PluginManager 依 activation order 組合所有 Markdown Contributors 的 renderer chain。                 |

## Git 術語

| 術語                         | 定義                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Source Control Graph`       | VS Code Source Control 的 commit graph surface。不要泛稱為 Superset Panel。                                      |
| `History Item`               | Graph 中代表一個 commit、提供 SHA 與 subject 的 context item。                                                   |
| `SCM Context Command`        | 由 `scm/historyItem/context` menu contribution 取得 repository 與 History Item 的 command。                      |
| `Reset Soft`                 | 執行 `git reset --soft <sha>`；移動 HEAD，保留 index 與 working tree。                                           |
| `Reset Hard`                 | 執行 `git reset --hard <sha>`；重設 HEAD、index 與 working tree，必須先 Modal Confirmation。                     |
| `Proposed SCM API`           | `contribSourceControlHistoryItemMenu` proposed API；host 必須明確以 `--enable-proposed-api shuk.superset` 啟動。 |
| `Explorer Context Command`   | 從 Explorer file context menu 接收 resource URI 的 command。                                                     |
| `Copy GitHub URL`            | 依本機 repository、remote 與 relative file path 產生 fixed-`master` GitHub URL；不呼叫 GitHub API。              |
| `GitHub Remote`              | 可解析為 GitHub owner/repository 的 fetch 或 push URL。                                                          |
| `Origin Preference`          | 有 GitHub `origin` 時優先使用；否則選第一個可解析的 GitHub remote。                                              |
| `Repository-relative Path`   | resource file 相對 repository root 的 path；root 本身或 root 外 path 不產生 URL。                                |
| `Repository-local Git Hooks` | project 內 `.githooks/` 與 local Git config 的 hook setup。                                                      |
| `Git Hooks Template`         | Extension 隨附於 `pkg/resources/git/githooks/` 的 hook files。                                                   |
| `Install Git Hooks`          | copy-if-missing template 到第一個 opened folder 的 `.githooks/`，再執行 Link Git Hooks。既有同名檔不覆蓋。       |
| `Link Git Hooks`             | 設定 repository-local `core.hooksPath=.githooks`，不複製 template。                                              |
| `Hooks Linked`               | local `core.hooksPath` 為任意非空值；Superset 不驗證它是否實際指向 `.githooks/`。                                |
| `Git Hooks Status Item`      | `.githooks/` 存在但 local `core.hooksPath` 為空時顯示的 Status Bar Item。                                        |
| `First Opened Folder`        | Git hooks 功能唯一處理的 `workspaceFolders[0]`；multi-root 其餘 folders 不在 scope。                             |

## 安裝、操作與診斷術語

| 術語                           | 定義                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `Default Project Template`     | 初始化 standard ignore files、project directories 與 `AGENTS.md` symbolic link 的 bundled setup script。                      |
| `Ignore Target`                | Default Project Template 可處理的 `git`、`gemini`、`claude` target，分別對應 `.gitignore`、`.geminiignore`、`.claudeignore`。 |
| `Default Tools`                | `pm2`、`skills`、`dux`、`port` 與 `sessiond` 五個 CLI；各自在獨立 run terminal 以 `go install ...@master` 安裝。          |
| `Skill Repository`             | 傳給 `skills add` 的 GitHub identifier。Quick Pick curated 清單與順序由 `src/installCommands.ts#SKILL_REPOSITORIES` 定義；`description` 顯示用途，`detail` 顯示 GitHub repository，`bizshuk/cc-plugin` 為預設，清單末尾的 `自訂 repository…` 會開啟 Input Box。 |
| `Projects Setup`               | `Superset: Projects Setup`；建立固定 `~/projects` root，clone 標準 BizShuk repository set 並初始化 recursive submodules。     |
| `Projects Setup Repository Set` | `ai`、`cc-plugin`、`data`、`env_setup`、`game`、`iphone`、`platform`、`playground`、`product`、`research`、`social`、`tools`、`web`。 |
| `License Template`             | Superset 內嵌的 Apache-2.0、MIT 或 BSD-3-Clause `LICENSE` content。                                                           |
| `Run Terminal`                 | Superset 為 setup、Git 或其他 shell action 建立的可見 terminal；成功時可自動 exit。                                           |
| `Settings & Commands Overview` | `Superset: Open Settings` 動態產生的 registered-command Markdown overview；不是 native Settings editor。                      |
| `Diagnostics Snapshot`         | `Superset: Show Diagnostics` 產生的一次性 subsystem Markdown snapshot。                                                       |
| `Diagnostic Logs`              | `Superset` Output Channel 內持續追加的 timestamped runtime log。                                                              |
| `Reset Caches`                 | 清除 `workspaceState` 中 `superset.*` keys，再依序執行各 plugin reset handlers。                                              |
| `Reveal in Tree`               | 以 View ID 與 predicate 走訪 registered Tree View，聚焦並選取 matching Tree Item 的跨 feature command。                       |
| `Focus View`                   | 顯示指定 View Container，再聚焦其中一個 registered View 的 command flow。                                                     |
| `VSIX`                         | 可安裝的 VS Code extension package，由 `npm run build` 產生並驗證。                                                           |
| `Extension Development Host`   | 按 `F5` 啟動、用來測試 extension 的隔離 VS Code window。                                                                      |

## Plugin 與內部架構術語

| 術語                          | 定義                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Composition Root`            | `src/extension.ts`；建立 shared state 並宣告 plugin activation order。                                               |
| `Feature`                     | 一個使用者或 domain 能力，程式放在 `src/<feature>/`。                                                                |
| `Plugin`                      | 實作 `ExtensionPlugin`、把 Feature 接到 unified lifecycle 的 adapter。Feature 與 Plugin 不一定是同義詞。             |
| `Plugin Manager`              | 依序 activate/deactivate plugins、隔離錯誤、收集 disposables/reset handlers 並組合 Markdown contributors。           |
| `Plugin Context`              | Composition Root 注入 plugin 的受控 dependencies，包括 workspace、state、log、status 與 registration hooks。         |
| `Activation Order`            | Plugin 啟用順序；Markdown composition、command availability 與 panel layout restore 依賴此順序。                     |
| `Error Isolation`             | 單一 plugin activation failure 只標記該 plugin，不阻止 sibling plugins activation。                                  |
| `Disposable`                  | Command、watcher、event subscription 或 View 的 teardown handle，由 Plugin Manager 管理。                            |
| `Reset Handler`               | Plugin 註冊、由 Reset Caches 依序呼叫且個別隔離錯誤的 reset callback。                                               |
| `Tree View Registry`          | 保存 View ID、TreeView 與 TreeDataProvider 的 cross-feature registry，支援 Reveal in Tree。                          |
| `Store`                       | Feature 的 in-memory state owner 與 domain mutation boundary；不等同 filesystem store。                              |
| `Registry`                    | 以 identity 管理 live entities 與 lifecycle transitions 的 state owner，例如 TerminalRegistry、MdnsRegistry。        |
| `Provider`                    | 將 domain elements 提供給 VS Code View API 的 adapter，例如 TreeDataProvider。                                       |
| `Renderer`                    | 將 domain data 純轉換成 UI spec、Markdown 或 HTML 的邏輯。                                                           |
| `Transformer`                 | 將一種 domain representation 純轉換成另一種 representation 的模組。                                                  |
| `Parser`                      | 將 filesystem、protocol 或 text input 解析為 domain model 的純邏輯。                                                 |
| `Source of Truth`             | 某一類 state 或規則唯一允許被視為 authoritative 的 owner。                                                           |
| `Pure Domain Logic`           | 不 import `vscode`、可直接用 Vitest 驗證的 parser、store helper、renderer 或 transformer。                           |
| `VS Code-bound Orchestration` | Command registration、TreeView creation、watcher 與 notification 等依賴 VS Code host 的接線層。                      |
| `Cross-module State`          | Composition Root 建立、供少量 global commands 查找的 shared manager、channel 或 spawner reference。                  |
| `Workspace State`             | VS Code 為 extension 管理、以 workspace 為 scope 的 persisted Memento。                                              |
| `Global State`                | VS Code 為 extension 管理、跨 workspace 的 persisted Memento。                                                       |
| `Panel Layout Persistence`    | 記錄最近 visible View ID，activation 後在所有 Tree Views registered 完成時恢復 focus。名稱是既有 module identifier。 |
| `Static Resource`             | Extension 隨包附帶的非程式資產，統一放在 `pkg/resources/`。                                                          |
| `Contract Test`               | 驗證 manifest、activation、provider output 或純函式 boundary 的 regression test。                                    |
| `Full Build Verification`     | `npm run build` 的 clean、install、compile、VSIX package 與 package-content verification 流程。                      |

## Inactive Projects Module 術語

以下名稱只描述 `src/projects/` 的現有 domain model；該 module 目前未啟用：

| 術語               | 定義                                                     |
| ------------------ | -------------------------------------------------------- |
| `Project Subgroup` | Inactive Projects module 對 discovered projects 的分類。 |
| `Aggregation`      | 匯集層，例如 `product`。                                 |
| `Application`      | 應用層；未列入其他 known set 的一般 top-level project。  |
| `Framework`        | 框架層；Superset 本身屬於此類。                          |
| `Tool`             | 工具層，通常以獨立 CLI 被呼叫。                          |
| `Temporary`        | `~/projects/tmp` 下的暫存 project 分類。                 |

## 明細呈現方式 (Detail Presentation)

依明細實際出現的位置選用術語：

| 呈現方式                           | 使用術語                         | 範例                                |
| ---------------------------------- | -------------------------------- | ----------------------------------- |
| 展開 Tree Item 後顯示欄位          | `Detail Row` / `Child Tree Item` | MDNS 的 host、port、aliases         |
| 游標懸停顯示資訊                   | `Tooltip`                        | Session path、MDNS service summary  |
| 在獨立 View 顯示明細               | `Detail View`                    | 未來若新增 master-detail sidebar UI |
| 在 Editor 開啟明細                 | `Details Editor`                 | Session Markdown summary            |
| 以 modal dialog 顯示明細           | `Details Dialog`                 | MDNS `Show Service Detail`          |
| 在 View Container 內嵌自訂 Webview | `Webview View`                   | 未來的 sidebar custom view          |
| 在 Editor 區開啟自訂 Webview       | `Webview Panel`                  | Editor-tab 型自訂內容               |

不要用 `details panel` 同時指稱上述不同呈現方式。

## 用語規則 (Usage Rules)

| 避免              | 改用                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `side panel`      | `Primary Side Bar`；若指其中一區，使用具體的 `View` 名稱。                     |
| `Superset panel`  | `SuperSet View Container`。                                                    |
| `Terminals panel` | `Terminals View`。                                                             |
| `panel title`     | `View Title` 或 `View Container Title`，依實際層級選擇。                       |
| `row subtitle`    | `Tree Item Description`。                                                      |
| `row button`      | `Inline Action`。                                                              |
| `details panel`   | `Detail Row`、`Tooltip`、`Detail View`、`Details Editor` 或 `Details Dialog`。 |

程式內既有的 `panelLayout` 等 module 名稱屬於 implementation identifier；除非另有
rename 計畫，不因本文件修改。新增對外文件與 UI 說明則一律採用本文件的標準術語。

## 官方參考 (Official References)

- [Visual Studio Code User Interface](https://code.visualstudio.com/docs/editing/userinterface)
- [Visual Studio Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Visual Studio Code Views UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
- [Visual Studio Code Activity Bar UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/activity-bar)
