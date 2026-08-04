# Superset

VSCode 擴充功能 (extension):在主側欄 (Primary Side Bar) 整合多個觀察型面板 — `Terminals` 列出所有開啟中的終端機、背景終端機有新輸出時三處同步高亮;`MDNS` 掃同網段服務;`Topology` 掃描網路環境;`TODO` 管理工作區待辦;`Overall` 跨專案檢視所有進行中的計畫。Markdown `tree` 區塊與 `README.todo` 預覽也內建。

核心使用情境:背景跑 Claude Code 的終端機持續輸出時,使用者能在側欄一眼看到「哪個背景終端機有新動靜」,再 `Ctrl+Alt+T` 模糊跳轉過去。

---

a

## 功能總覽 (Features at a Glance)

| 面板 / 功能               | 用途                                                        | 適用對象                             |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| `Terminals`               | 終端機總覽 + 背景輸出高亮 + 群組管理 + Fuzzy 跳轉           | 任何有多 terminal 並行工作的人       |
| `Sessions`                | 依 current workspace 內的 project 分組瀏覽 agent sessions   | 同時操作 workspace / monorepo 的人   |
| `MDNS`                    | 列出同網段 DNS-SD / mDNS 服務(印表機、AirPlay、SSH 等)      | 需要快速存取區網裝置的人             |
| `Topology`                | 掃描 interfaces / routing / DNS / ARP,產出拓撲樹狀圖        | 需要掌握網路環境的開發者 / SRE       |
| `TODO`                    | 讀寫 `README.todo`,支援嵌套 + 優先級 + inline link          | 用 `README.todo` 管理工作的人        |
| `Overall → Projects TODO` | 跨專案總覽所有 `README.todo` 與 `plans/` 計畫文件           | 同時管理多個專案的人                 |
| Markdown `tree` 預覽      | ` ```tree ` fenced block 渲染為 📁/📄 icon 結構             | 撰寫文件時想插入目錄樹狀圖           |
| `README.todo` 預覽        | 摺疊/展開/過濾互動式檢視                                    | 想在 Markdown 預覽裡直接編輯 todo    |
| SCM Graph reset           | commit 右鍵直接執行 `Reset Soft` / `Reset Hard`             | 本機使用 proposed API 的 Git 使用者  |
| Explorer GitHub URL       | 檔案右鍵複製固定 `master` branch 的 GitHub URL              | 分享 repository 檔案連結的人         |
| Git Hooks 管理            | 補齊 `.githooks/`、設定 local `core.hooksPath` 與未連結提醒 | 使用 repository-local hooks 的開發者 |
| `Projects Setup`          | 建立 `~/projects` 並 clone BizShuk aggregation repositories | 初始化開發工作區的人                 |
| Editor Layout 四模式      | 水平與垂直方向`各自` even／max 的四種組合                   | 常同時開多個 editor group 的人       |
| `Disk Usage` Status Bar   | 顯示第一個 workspace 所在 volume 的已使用比例與容量 tooltip | 想隨時掌握工作磁碟空間的人           |

---

## 功能詳細說明 + 逐步操作 (Features in Detail)

### 1. `Terminals` — 終端機儀表板

#### 1.1 列出所有終端機 + 背景輸出高亮

**功能**:主側欄列出當前 Workspace 所有開啟中的終端機;當某個「非作用中」的終端機有新輸出時,**三處同步高亮**:

- 面板該列換成加重圖示 + `● 新輸出` 描述
- 終端機分頁名稱前綴加 `●`
- 狀態列顯示 `N 個終端機有新輸出`

聚焦回該終端機後,所有高亮自動解除。

**逐步使用**:

1. 開啟 VSCode,在主側欄 (Primary Side Bar) 找到 `Superset` icon → 點開 `Terminals` 面板。
2. 開幾個終端機(例如 `Ctrl+Shift+`` 開一個、`+` icon 再開一個)。
3. 把其中一個切為背景,在裡面跑會輸出內容的命令(例如 `claude`)。
4. 切回主視窗做事,稍等幾秒看:
    - `Terminals` 面板該列出現 `● 新輸出` description
    - 該 terminal 分頁名稱前綴加 `●`
    - 視窗右下角狀態列出現 `1 個終端機有新輸出`
5. 點一下該列(或在面板上按 `Enter`)→ 終端機聚焦,所有 `●` 自動清除。

> 若使用者聚焦時同時改了 terminal 名稱,清除時 Presenter 只剝 `●` 前綴、不還原舊名稱,以免覆寫使用者意圖。

#### 1.2 跑 TUI App(`claude`、`vim`、`htop`)

**功能**:TUI app 在 Shell Integration 眼中是一次永不結束的 execution,所以高亮改由 process tree 判定 —— Superset 每次輪詢跑`一次` `ps`,比較各 terminal 前景子程序的累計 CPU 時間,有推進就視為活動。用 VSCode 任何方式開的 terminal 都適用,不需要特定命令。

**逐步使用**:

1. 用平常的方式開 terminal(`Ctrl+` `` ` `` 或 `Superset: New Terminal`)。
2. 在裡面跑 `claude` 或 `vim`。
3. 切到其他 terminal,該 TUI terminal 持續有工作就會觸發高亮。

> **注意**:Superset 不再替換或重建任何 terminal —— terminal 一律由 VSCode 自己擁有,Superset 只從外部觀察。

#### 1.3 Fuzzy 跳轉 — `Ctrl+Alt+T`

**功能**:模糊搜尋 (Fuzzy Pick) 所有開啟中的 terminal,依名稱 / pid / 工作目錄比對,快速切換。

**逐步使用**:

1. 按 `Ctrl+Alt+T`(或命令面板 `Superset: Go to Terminal`)。
2. 輸入關鍵字(例如專案名、pid 末幾碼)。
3. 從 QuickPick 選項中按 Enter → 自動 focus 該 terminal。

#### 1.4 群組管理

**功能**:把多個 terminal 分組成可摺疊的群組(類似工作區 bookmark),支援拖拉排序、改色、`F2` 改名。

**逐步使用**:

1. 在面板上方按 `+` icon → 選 `Superset: New Group`。
2. 輸入群組名稱 → Enter。
3. 把某個 terminal 列**拖曳**到群組底下(拖拉由 panel 的 drag-and-drop controller 處理)。
4. 在群組列上按右鍵 → `Rename` / `Set Group Color` / `Delete` / `Toggle Collapse`。

#### 1.5 重置快取 — `Superset: Reset Caches`

**功能**:一鍵清除 `context.workspaceState` 中 `superset.*` 的所有鍵值、清空 mDNS / 拓撲狀態、重新載入 `README.todo`。

**逐步使用**:

1. 命令面板 → `Superset: Reset Caches`。
2. 跳出二次確認彈窗 → 選 `Yes`。
3. 所有快取清空,各面板重新載入。

---

### `Sessions` — Agent session 專案分組

**功能**:唯讀載入 `sessiond` JSONL store，將 current workspace root 與其所有 descendant workspace paths 視為 project，並以 `project → session` 兩層 TreeView 顯示。只有實際含 session 的 store bucket 會出現；同名巢狀 project 以 workspace-relative path 區分。

**逐步使用**:

1. 主側欄 `Superset` icon → 點開 `Sessions` 面板。
2. 展開 project row，查看依最近活動時間排序的 sessions。
3. 點 session 開啟 Markdown summary；右鍵可開 raw JSONL、複製 session id 或刪除。
4. 面板會監看 shared sessions root，子 project 新增 session 或 append turn 後自動刷新。
5. `Seed/Clear Sample Sessions` 只影響 current workspace root 的 `sample-*.jsonl`，不會修改 descendant projects 或 ingest 產生的 sessions。

預設資料根為 `~/.config/superset/data/sessions`；開發時可用 `superset.sessions.dataDir` 指向 scratch store。

---

### 2. `MDNS` — 區網服務探索

**功能**:訂閱同網段 mDNS / DNS-SD 廣播(印表機、AirPlay、SSH 等),以 tree view 列出所有可發現服務,展開可看位址、埠號、TXT 屬性等細節,並可一鍵複製 `host:port` 或連線。

#### 2.1 自動去重 (Network-identity dedup)

同一台主機常以多個 mDNS 實例名稱廣播,或同時走多張網卡 / IPv4+IPv6,造成面板重複列。`MdnsRegistry` 以 `host|port|type` 為網路身分 (`networkKey`) 把同一物理端點合併成單一列(canonical),只保留第一個看到的實例名稱,後續名稱寫進該列的 `aliases` 細節欄位。

實作位於 `src/mdns/mdnsDedup.ts`(純函式,無 `vscode` import,可單元測試):

- **`networkKey(s)`**:回傳 `${host ?? addresses[0]}|${port}|${type}`。`host` 沒拿到時 fallback 到第一個 IP,確保「同台機器用 IP 找到」也能跨 NIC 合併。
- **`mergeServices(a, b)`**:把後到的 `b` 合進先到的 `a`(canonical name wins):
    - `aliases`:`a.name` 之外的「舊 `a.aliases` + `a.name` + `b.name`」全集合去重
    - `addresses` / `subtypes`:聯集去重,保留順序
    - `ttl`:`min(a.ttl, b.ttl)`(對齊 `trackMinTtl` 語意)
    - `txt`:`b` 覆寫 `a` 的同名 key(最新優先)
    - `firstSeen`:`min`、`lastSeen`:`max` — 確保 alias 重出現不會留下過舊 `lastSeen` 觸發誤過期

`store.ts` 內維護兩個索引維持 dedup 一致性:

- `byNetworkKey: Map<nk, canonKey>`:網路身分 → canonical row
- `canonKeyToNk: Map<canonKey, Set<nk>>`:反向索引,讓「同一實例改 port」時能釋放舊 nk 槽位,避免後續不同服務誤佔而假合併

#### 2.2 過期移除 (TTL grace-period sweep)

服務一段時間未再廣播即自動過期移除,以 `3 × TTL` 為寬限期(RFC 6762 §10.1 cache-flush),沒帶 TTL 的記錄 fallback 到 120 秒。實作位於 `src/mdns/expiration.ts`(`MdnsExpirationSweeper` 類別,registry 持有):

| 常數                   | 值      | 說明                               |
| ---------------------- | ------- | ---------------------------------- |
| `EXPIRY_TICK_MS`       | `5_000` | 掃描週期                           |
| `TTL_GRACE_MULTIPLIER` | `3`     | grace period 倍率 (RFC 6762 §10.1) |
| `TTL_DEFAULT_SECONDS`  | `120`   | 記錄沒帶 TTL 時的 fallback         |

**`ClockSource` 注入**:sweeper 建構子接受 `ClockSource`(預設 `Date.now`),測試以 `vi.useFakeTimers()` + 注入 `{ now: () => fakeNow }` 精確控制時間,正式環境呼叫端不變。

**事件變體**:`MdnsChange` 多了 `expired`(與 `removed` 區分 — `removed` = transport 告知,`expired` = registry 自判),供監控/診斷用。`MdnsTreeProvider` 不分事件類型、只重抓 `getAll()`,故新增變體不影響消費端。

#### 2.3 別名顯示 (Aliases UI)

`buildMdnsDetailFields` (`src/mdns/mdnsTreeSpec.ts:36-38`) 在「主機」欄之後、「埠號」之前插入「別名」欄位,內容為 `aliases.join(", ")`;`aliases` 為空陣列或缺值時整欄省略。

#### 2.4 安全邊界 (Security Boundaries)

同網段的 mDNS 廣播一律視為不可信輸入。每個封包最多處理 `256` 筆 record，
pending 與已儲存服務各最多 `512` 筆；DNS name、TXT、address、alias、
subtype 與 TTL 也有固定上限，避免持續廣播造成 extension host 無限累積。

`Connect Action` 只有兩條執行路徑：

- `_http._tcp`、`_https._tcp`、`_ipp._tcp`、`_ipps._tcp` 經 VS Code
  `openExternal` 開啟已驗證 URI，不送進 shell。
- `_ssh._tcp`、`_sftp._tcp` 只接受已驗證的 user、host 與 port，再將
  `ssh` arguments 逐一 shell quote 後送入 terminal。

無法通過驗證或不支援的服務只顯示警告，不開 URI、也不執行 terminal command。

#### 2.5 逐步使用

1. 主側欄 `Superset` icon → 點開 `MDNS` 面板。
2. 面板開始訂閱 UDP/5353,數秒內應自動出現同網段服務。
3. 點某個服務列的右側 icon:
    - 📋 `Copy Service Address` → 複製 `host:port`
    - 👁 `Show Service Detail` → 顯示完整 TXT 屬性對話框
    - 🔌 `Connect` → HTTP / IPP 交給外部應用；SSH 以安全引用的 terminal command 連線
4. 點 `↻` icon 手動重新整理。
5. 想看細節欄位(別名、TXT 屬性):點 `>` icon 展開該列。

---

### 3. `Topology` — 網路拓撲掃描

**功能**:讀取本機 `netstat -rn` / `scutil --dns` / `arp -a` 等命令輸出,組裝成樹狀拓撲圖(本地介面 + 路由表 + DNS 設定 + ARP 表)。

**逐步使用**:

1. 主側欄 `Superset` icon → 點開 `Topology` 面板。
2. 點上方 `📡` icon(`Superset: Scan Network Topology`)→ 開始掃描。
3. 掃描逾時 10 秒(防止卡死),完成後面板顯示樹狀結果:
    - `Local Interfaces`:本機網卡 + IPv4/IPv6 + loopback
    - `Trace`:到 `8.8.8.8` 的路由 hops
    - `Routing`:default route + `/24` subnet 群組
    - `DNS`:resolvers + search domains
    - `ARP`:同 subnet 鄰居

> 掃描 timeout 由 `SCAN_TIMEOUT_MS = 10_000` 熔斷;若環境命令很慢(例如 VPN 環境),可能提早結束。

---

### 4. `TODO` — 工作區待辦管理

**功能**:讀取工作區根目錄的 `README.todo` 檔案,把所有待辦渲染成 TreeView,支援:

- 嵌套(子項目用縮排)
- 三種視角:`Section`(依文件 H2 群組)/ `Priority`(依 P0/P1/P2 群組)/ `File`(依來源檔)
- 過濾器:隱藏已完成、只看 P0/P1/P2
- Inline edit:`F2` 改名、勾選完成、archive / rollback
- Inline link:todo 文字裡若包含 `[link](path)`,可在右鍵選單 `Open Link` 直接跳轉

**逐步使用 — 第一次設定**:

1. 在 Workspace 根目錄建一份 `README.todo`(格式見下)。
2. 主側欄 `Superset` icon → 點開 `TODO` 面板。
3. 面板自動讀入並顯示。

**`README.todo` 範本**:

```markdown
# TODO

- [ ] 第一個待辦
- [ ] [P0] 緊急事項 — 帶優先級
    - [ ] 子任務(縮排兩格以上)
    - [x] 已完成 — 隱藏模式下不顯示
- [ ] 含 [說明文件](docs/notes.md) 的 inline link
- [ ] 清單項目(無 checkbox,不視為 todo)

## Archive

- [x] 已歸檔的舊任務
```

**逐步使用 — 日常操作**:

| 動作               | 操作                                                        |
| ------------------ | ----------------------------------------------------------- |
| 切換視角           | 點面板上方 `Section` / `Priority` / `File` icon             |
| 勾選完成           | 點該列左側 checkbox                                         |
| 改名               | 點該列 + `F2`(或右鍵 `Rename`),編輯後 Enter 自動寫回檔案    |
| 改優先級           | 右鍵 → `Change Priority` → 選 P0 / P1 / P2 / None           |
| 改歸屬 section     | 右鍵 → `Change Section` → 選目標                            |
| Archive / Rollback | 右鍵 → `Archive`(已完成移入 `## Archive`)/ `Rollback`(移回) |
| 過濾只看 P0        | 點 `🚦 P0` icon 切換(再點一次取消)                          |
| 隱藏已完成         | 點 `Filter` icon 切換                                       |
| 跳到 inline link   | 點該列右側 🔗 icon(若該 todo 帶 `[text](path)`)             |
| 新增 todo          | 點 section 列右側 `+` icon → 輸入文字 → Enter               |
| 開啟原始檔         | 點 section 列右側 📄 icon                                   |

---

### 5. `Overall → Projects TODO` — 跨專案總覽

三個 TODO view 的掃描邊界互相獨立:

| View             | 掃描邊界                                                  |
| ---------------- | --------------------------------------------------------- |
| `TODO`           | 只讀寫當前 project / workspace root 的 `README.todo`      |
| `Workspace TODO` | 從當前 workspace root (depth 0) 遞迴掃描,預設最大 depth 5 |
| `Projects TODO`  | 只從 `~/projects` 單一根目錄掃描 depth 1–5                |

功能:在 Activity Bar 的第二顆 `Superset-Overall` icon 下,遞迴總覽 `~/projects/` 裡大小寫完全相符的 `README.todo`。每個命中資料夾以該資料夾名稱建立 project group。命中後仍繼續掃描子孫,但不超過 depth 5。每個 project row 一律預設收合,展開可看:

- 該 project 自己的 `README.todo` sections(同上 TODO 面板的過濾 / 勾選 / rename 邏輯)
- 該 project 自己的 `## Plans` sub-section(列出 `plans/*.md` 文件,點 🔗 icon 可用 Markdown 預覽開啟)

**逐步使用**:

1. Activity Bar 點第二顆 `Superset-Overall` icon → 開啟 `Projects TODO` view。
2. 面板列出 `~/projects/` depth 1–5 內所有含精確 `README.todo` 的資料夾,並以資料夾名稱分組(預設全部收合)。
3. 點某個 project row 左側 `>` 展開 → 看到該 project 自己的 sections 與 `## Plans` 子節。
4. 在任一 project 上操作 todo / 過濾 / 點 `Open Project` icon — 行為與 TODO 面板一致,但寫回各自專案的 `README.todo`。

> 每個 project row 永遠保留(即使檔案全勾、priority filter 全空),目的是讓 overview 作為「哪些專案還有 todo 檔」的一覽表。

---

### 6. Markdown `tree` 區塊語法高亮 + 預覽渲染

**功能**:在 `.md` 檔案裡用 ` ```tree ` fenced block 寫目錄樹,編輯時有 TextMate 高亮,Markdown 預覽則渲染為帶 📁/📄 icon 的結構。

**逐步使用**:

1. 在 `.md` 檔案裡寫:

    ````markdown
    ```tree
    src/
    ├── extension.ts
    ├── shared.ts
    └── terminals/
        ├── index.ts
        └── types.ts
    ```
    ````

2. 編輯畫面:有 TextMate 高亮(box-drawing 連接符、節點名)。
3. 按 `Ctrl+Shift+V`(或右上角 split editor)開 Markdown 預覽。
4. 預覽畫面:節點渲染為 📁/📄 icon + 樹狀縮排。

> 支援行內註解:`src/  # 主程式` 會把 `# 主程式` 渲染為淡色註解。

---

### 7. `README.todo` Markdown 預覽增強

**功能**:在 `README.todo` 檔案的 Markdown 預覽裡,加上摺疊/展開按鈕與過濾互動,無需離開預覽就能操作。

**逐步使用**:

1. 在 VSCode 開啟 `README.todo` 檔。
2. 按 `Ctrl+Shift+V` 開啟 Markdown 預覽。
3. 預覽畫面:
    - 每個 `## Section` 標題旁有 `▸` / `▾` 三角 icon → 點擊摺疊/展開
    - 過濾按鈕列:全部 / 未完成 / P0 / P1 / P2 / 已完成 / 已 archive → 點擊即時切換
4. 勾選預覽裡的 checkbox → 自動寫回原始檔。

---

### 8. SCM Graph commit reset

`功能`:在 `Source Control → Graph` 的單一 commit 上按右鍵,直接顯示 `Reset Soft` 與 `Reset Hard`。`Reset Hard` 會先顯示 modal confirmation;`Reset Soft` 直接執行。

此功能使用 proposed `scm/historyItem/context`,Superset 宣告 `contribSourceControlHistoryItemMenu` 後,host 仍必須以 `--enable-proposed-api shuk.superset` 啟動。一般從 Dock 啟動不會自動帶入這個 flag。

開發測試:

1. 用 Antigravity IDE 開啟 repo。
2. 選 `.vscode/launch.json` 的 `Run Superset with Proposed SCM Menu`。
3. 按 `F5` 開 Extension Development Host。
4. 在新視窗的 `Source Control → Graph` 對單一 commit 按右鍵驗證兩個 reset command。

### 9. Explorer Copy GitHub URL

`功能`:在 Explorer 的 repository 檔案上按右鍵,選 `Copy GitHub URL`,將以下格式寫入 clipboard:

```text
https://github.com/<owner>/<repo>/blob/master/<relative-path>
```

URL 固定使用 `master` branch。Superset 只讀取本機 Git repository 與 GitHub remote 後組合字串,不呼叫 GitHub API,也不檢查 GitHub 上是否存在 `master` branch 或該檔案。

使用方式:

1. 在 Explorer 對 Git repository 內的檔案按右鍵。
2. 點 `Copy GitHub URL`。
3. URL 寫入 clipboard;GitHub `origin` remote 優先,沒有時使用第一個 GitHub remote。

### 10. Git Hooks 安裝與連結

`Superset: Install Git Hooks` 只在手動執行時,從 extension 內建模板補齊目前 VS Code 視窗第一個 opened folder 的 `.githooks/`。既有同名檔案不會被覆蓋;補齊成功後會設定 repository-local `core.hooksPath=.githooks`。

內建 `pre-push` 模板在將新 commit 推送到 `master` 時自動建立 annotated release tag。版本取 `max(最高 Git tag 的下一個 patch, package.json.version, .claude-plugin/plugin.json.version)`；不存在的 manifest 會被忽略，且只接受純 `major.minor.patch` 版本。Hook 只讀 manifest，不會回寫版本。

只需要重新設定 Git config 時,執行 `Superset: Link Git Hooks`。若 opened folder 已有 `.githooks/`,但 local `core.hooksPath` 沒有值,左側 Status Bar 會顯示 `Git hooks not linked`;點擊只執行 Link,不安裝模板。

Multi-root 視窗只處理第一個 folder。任何非空 local `core.hooksPath` 都視為已連結,Superset 不驗證它是否指向 `.githooks/`。

---

### 11. Default Project Template — workspace 初始化

`Superset: Install Default Project` 會在目前 workspace 根目錄執行內建安裝器，預設安裝三份標準 ignore files：

- `.gitignore`
- `.geminiignore`
- `.claudeignore`

同時建立標準 project directories（`docs/tutorials/`、`docs/backlog/`、`docs/specs/`、`plans/`、`pkg/`、`config/`、`cmd/`、`.vscode/`、`.agents/`），並建立 `AGENTS.md -> CLAUDE.md` symbolic link。若目標 ignore file 已存在，執行命令時會先顯示 overwrite confirmation；取消即可保留原檔。

安裝成功後 Run Terminal 會自動關閉(命令尾端的 `&& exit` 讓 shell 自行結束);命令失敗時 `&&` 短路，terminal 保留讓使用者讀錯誤訊息。

這個命令取代舊的 `Superset: Install Ignore Template`；舊 command ID `superset.installIgnoreTemplate` 已不再註冊。

---

### 12. Default Tools — Go CLI 安裝

`Superset: Install Default Tools` 會依序為目前使用者安裝九個 BizShuk Go CLI。每個 CLI 都在獨立的 Run Terminal 執行，完成後 shell 自動關閉：

- `pm2` — `github.com/bizshuk/pm2@master`
- `skills` — `github.com/bizshuk/skills@master`
- `dux` — `github.com/bizshuk/dux@master`
- `port` — `github.com/bizshuk/port@master`
- `sessiond` — `github.com/bizshuk/sessiond@master`
- `autop` — `github.com/bizshuk/autop@master`
- `auth` — `github.com/bizshuk/auth@master`
- `proxy` — `github.com/bizshuk/proxy@master`
- `mdserver` — `github.com/bizshuk/mdserver@master`

若只需要安裝 skill repository，使用 `Superset: Install Skills`。Quick Pick 可直接選擇下列 repository；若清單沒有目標，選擇 `自訂 repository…`，再於 Input Box 輸入 `owner/repository`。確認後會執行 `skills add <repository>`：

| 顯示名稱                             | 用途                                               | GitHub repository                         |
| ------------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| `bizshuk/cc-plugin`（預設）          | AI 編碼代理的全域設定、Skills、Agents 與記憶工具   | `bizshuk/cc-plugin`                       |
| `anthropics/claude-plugins-official` | Anthropic 維護的 Claude Code 高品質 Plugin 目錄    | `anthropics/claude-plugins-official`      |
| `anthropics/skills`                  | Anthropic 的 Agent Skills 範例、規格與文件處理技能 | `anthropics/skills`                       |
| `awesome-claude-code-subagents`      | 涵蓋多種開發任務的 Claude Code 專用 Subagents 合集 | `VoltAgent/awesome-claude-code-subagents` |
| `superpowers`                        | 以 Skills 驅動規劃、TDD、除錯與協作的開發方法      | `obra/superpowers`                        |
| `understand-anything`                | 把程式碼與文件轉成可搜尋、可提問的互動知識圖譜     | `Egonex-AI/Understand-Anything`           |
| `last30days`                         | 彙整近 30 天社群與網路討論，產出有來源的研究摘要   | `mvanhorn/last30days-skill`               |
| `ui-ux-pro-max-skill`                | 為多平台 UI/UX 產生設計系統、樣式與實作建議        | `nextlevelbuilder/ui-ux-pro-max-skill`    |

自訂輸入會先去除頭尾空白，並以單一 shell argument 安全傳給 `skills add`。按 `Esc` 關閉 Quick Pick 或 Input Box 都不會建立 Run Terminal。

---

### 13. Projects Setup — projects workspace 初始化

`Superset: Projects Setup` 會建立固定的 `~/projects` root，並從 GitHub clone 下列 BizShuk repositories：

```tree
~/projects/
├── ai/
├── cc-plugin/
├── data/
├── env_setup/
├── game/
├── iphone/
├── platform/
├── playground/
├── product/
├── research/
├── social/
├── tools/
└── web/
```

缺少的 repository 使用 `git clone --recurse-submodules`；已存在的 Git repository 不會被 pull 或覆蓋，只執行 `git submodule sync --recursive` 與 `git submodule update --init --recursive`。若同名路徑已存在但不是 Git repository，命令會保留該路徑、回報錯誤，並繼續處理其餘 repositories。

命令在可見的 Run Terminal 執行。全部成功時 terminal 自動關閉；任一 repository 失敗時 terminal 保留，方便查看錯誤。

---

### 14. Editor Layout — 四個 editor group 佈局模式

模式是`兩個方向各自`的 even／max `組合`，不是「選一個方向」：

```text
mode = { horizontal: even | max } × { vertical: even | max }
```

| 模式            | 左右方向     | 上下方向     | 在 `2×2` 網格上的效果                            |
| --------------- | ------------ | ------------ | ------------------------------------------------ |
| `H·Even V·Even` | 均分         | 均分         | 四格等大                                         |
| `H·Max V·Even`  | 作用中欄放大 | 均分         | 作用中那`一欄`變寬（預設佔 80%），欄內兩列仍等高 |
| `H·Even V·Max`  | 均分         | 作用中列放大 | 兩欄等寬，作用中那`一列`變高                     |
| `H·Max V·Max`   | 作用中欄放大 | 作用中列放大 | 作用中格子最大，其餘仍看得見                     |

`Ctrl+Alt+V` 循環四個組合，`Ctrl+Alt+Shift+V` 開 Quick Pick 直接挑。狀態列右側永遠顯示`兩個方向`（例：`H·Max V·Even 2×2`），點擊等同 Quick Pick。

決定套用到哪一層的是`方向`而不是深度。VS Code 的巢狀層一律垂直於父層，所以 root 往左右切時，`H` 的 sizing 管 root、`V` 管下一層；`Superset: Transpose Editor Grid` 翻轉 root 方向後，兩者管的層級跟著對調 —— 這也就是 NxM 的轉置（`2 欄 × 3 列` 變 `3 欄 × 2 列`），格子數不變。

`不會把格子擠不見`。每個非作用中的兄弟節點至少保有該層 `10%` 的空間；`maxRatio` 太大或同層兄弟太多時，作用中的比例會自動下修，必要時退化成均分。

其他行為：

- 四個模式`保留現有網格形狀與 root 方向`，只重寫各層比例；手動拖出來的巢狀結構不會被覆蓋 —— 每次套用都先讀回目前的真實網格。
- `只有兩個命令會改變網格形狀`：`Superset: Pick Editor Grid Shape` 與 `Superset: Reset Editor Grid Shape`。形狀清單只列出`格子總數與現有群組數相符`的選項，不會意外產生空群組或把 editor 併到別的群組去。
- 只要有一個方向是 `max`，佈局就會跟著作用中的群組跑；`H·Even V·Even` 不會自動重算，手動拖過的分隔線會留著。
- VS Code 對群組有最小寬高限制，`superset.editorLayout.maxRatio` 是`比例提示`而非保證值。
- 佈局命令只作用於`目前視窗`的 editor 區域；`Move Editor into New Window` 開出來的浮動視窗各有自己的網格。
- 設定 `superset.editorLayout.maxRatio` 控制 `max` 方向上作用中群組的佔比，預設 `0.8`，可調範圍 `0.5`–`0.9`。其餘設定：`defaultShape`、`followActiveGroup`、`restoreOnActivate`。

---

### 15. Disk Usage — Status Bar 磁碟容量

啟用 Superset 後，Status Bar 右側會顯示第一個 workspace 所在 volume 的已使用比例，例如
`$(database) Disk 80%`。Hover tooltip 會列出 used、free 與 total capacity；資料每 30 秒刷新一次。

這是 volume-level usage，不是 workspace folder 本身的檔案大小。若作業系統拒絕讀取該 volume，Status Bar 會顯示 `Disk —` 並在 tooltip 保留錯誤原因。

---

## 系統需求 (Requirements)

| 項目    | 版本 / 用途                                                            |
| ------- | ---------------------------------------------------------------------- |
| VSCode  | `^1.93.0`(需要 Shell Integration API 與 TabInputTerminal 穩定後的版本) |
| Node.js | `>=20.0.0`(開發環境)                                                   |
| npm     | 隨 Node 一起裝                                                         |
| Git     | `Projects Setup`、Git Hooks 與 GitHub URL 功能                         |

---

## 安裝 (Install)

### 方法 A:從 VSIX 安裝(推薦)

1. 從 [Releases](https://github.com/BizShuk/superset/releases) 下載最新 `superset.vsix`。
2. 安裝:

    ```bash
    code --install-extension superset.vsix
    ```

    或 VSCode UI:`Ctrl+Shift+X` 開 Extensions 面板 → 右上 `⋯` → `Install from VSIX...` → 選檔案。

3. 重新啟動 VSCode → 主側欄出現 `Superset` icon。

### 方法 B:從原始碼安裝(開發者)

```bash
git clone https://github.com/BizShuk/superset
cd superset
npm run build         # npm ci + 型別檢查 + 編譯 + 打包與驗證 VSIX
code --install-extension superset-*.vsix
```

---

## 指令速查 (Commands)

| 指令                                            | 預設快捷鍵          | 用途                                                                          |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| `Superset: Go to Terminal`                      | `Ctrl+Alt+T`        | Fuzzy 跳轉到 terminal                                                         |
| `Superset: Reset Caches`                        | —                   | 重置所有快取(有確認彈窗)                                                      |
| `Superset: Scan Network Topology`               | —                   | 掃描網路拓撲                                                                  |
| `Superset: Refresh mDNS`                        | —                   | 重新整理 mDNS 面板                                                            |
| `Superset: Copy Service Address`                | —                   | 複製 `host:port`                                                              |
| `Superset: Connect`                             | —                   | 驗證 mDNS 連線資料後，以外部 URI 或 SSH terminal 連線                         |
| `Superset: New Terminal`                        | `Ctrl+Shift+``      | 開新 terminal                                                                 |
| `Superset: New Group`                           | —                   | 新增 terminal 群組                                                            |
| `Superset: Rename` / `Rename Group`             | `F2`(terminal 面板) | 重新命名                                                                      |
| `Superset: Open README.todo`                    | —                   | 開啟專案 `README.todo`                                                        |
| `Superset: Toggle Todo`                         | —                   | 切換該列完成狀態                                                              |
| `Superset: Focus Panel` / `Focus Overall Panel` | —                   | 聚焦側欄面板                                                                  |
| `Superset: Show Diagnostic Logs`                | —                   | 開啟 Output Channel 看診斷 log                                                |
| `Superset: Reset Soft (this commit)`            | —                   | Graph commit 右鍵移動 HEAD,保留 index / working tree                          |
| `Superset: Reset Hard (this commit)`            | —                   | Graph commit 右鍵重置 HEAD / index / working tree                             |
| `Copy GitHub URL`                               | —                   | Explorer 檔案右鍵複製固定 `master` GitHub URL                                 |
| `Superset: Install Git Hooks`                   | —                   | 補齊 `.githooks/` 模板並設定 local hooks path                                 |
| `Superset: Link Git Hooks`                      | —                   | 只設定 local `core.hooksPath=.githooks`                                       |
| `Superset: Install Default Project`             | —                   | 安裝 ignore files、預設 project directories 與 `AGENTS.md` symbolic link      |
| `Superset: Install Default Tools`               | —                   | 安裝 `pm2`、`skills`、`dux`、`port`、`sessiond`、`autop`、`auth`、`proxy` CLI |
| `Superset: Projects Setup`                      | —                   | 建立 `~/projects` 並 clone 13 個 BizShuk repositories（含 submodules）        |
| `Superset: Cycle Editor Layout Mode`            | `Ctrl+Alt+V`        | 循環四個 editor group 佈局模式                                                |
| `Superset: Pick Editor Layout Mode`             | `Ctrl+Alt+Shift+V`  | Quick Pick 直接挑一個佈局模式                                                 |
| `Superset: Toggle Horizontal Editor Sizing`     | —                   | 只翻左右方向的 even／max                                                      |
| `Superset: Toggle Vertical Editor Sizing`       | —                   | 只翻上下方向的 even／max                                                      |
| `Superset: Transpose Editor Grid`               | —                   | 翻 root 方向，等同 NxM 網格轉置                                               |
| `Superset: Pick Editor Grid Shape`              | —                   | 重塑 editor 網格形狀（唯一會改變格子數的命令）                                |
| `Superset: Reset Editor Grid Shape`             | —                   | 回到設定的預設網格形狀                                                        |

完整命令清單見 [`package.json`](package.json) `contributes.commands`。

---

## 開發 (Develop)

```bash
npm ci                   # 依 lockfile 安裝相依
npm run build            # 型別檢查 + tsc 編譯 + vsce package + verify-vsix
npm run watch            # 邊改邊編譯
npm test                 # 跑全部單元測試 (Vitest)
npm run test:watch       # watch 模式
```

### 在 VSCode 裡試跑

1. 用 VSCode 打開 `superset/` 資料夾。
2. 一般功能直接按 `F5`;測試 SCM Graph reset 時選 `Run Superset with Proposed SCM Menu` launch configuration。
3. 按 `F5` → 跳出帶有 `--enable-proposed-api shuk.superset` 的 `Extension Development Host` 視窗。
4. 在新視窗驗證功能。

### 打包

```bash
npm run package
```

產出 `superset-<version>.vsix`(不含任何 native binding，內容由
`scripts/verify-vsix.sh` 驗證)。

---

## 疑難排解 (Troubleshooting)

| 現象                                  | 可能原因                                             | 解法                                                                                              |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Terminal 高亮完全沒反應               | 終端機沒裝 shell integration(例如 Windows `cmd.exe`) | 改用 PowerShell、bash、zsh 或 fish(預設內建整合腳本)                                              |
| TUI app 跑著沒高亮                    | TUI 閒置時不耗 CPU,process tree 判定為沒有活動       | 確認該程式真的在工作;`Superset: Show Diagnostics` 可看 activity 判定紀錄                          |
| `mDNS` 面板空白                       | 網路環境無 mDNS 廣播,或被防火牆擋 UDP/5353           | 確認網段有 mDNS 服務(印表機、AirPlay 等);macOS 防火牆需允許 VSCode 接收 mDNS                      |
| `Topology` 掃描逾時                   | `netstat` / `scutil` / `arp` 執行慢(尤其 VPN 環境)   | 暫時無法解決(10s 熔斷);手動跑命令驗證輸出                                                         |
| `Git hooks not linked` 一直顯示       | local `core.hooksPath` 未設定或 Link 失敗            | 點 Status Bar 或執行 `Superset: Link Git Hooks`;用 `git config --local --get core.hooksPath` 檢查 |
| Install 沒處理預期的 folder           | Multi-root 視窗只處理第一個 opened folder            | 將目標 folder 移到第一位,或在單一 folder 視窗執行                                                 |
| `Projects Setup` 留下失敗 terminal    | clone/submodule 失敗或同名路徑不是 Git repository    | 查看 terminal 的 failure list；修正 Git access 或衝突路徑後重跑                                   |
| F2 改名沒寫回檔案                     | `README.todo` 唯讀或無寫入權限                       | 確認檔案可寫;檢查 Output Channel 錯誤                                                             |
| `vsce package` 報 `Missing publisher` | `package.json` 缺 `publisher`                        | 預設填 `shuk`                                                                                     |
| VSIX 安裝後沒生效                     | 沒重啟 VSCode                                        | 重新啟動視窗                                                                                      |

---

## 已淘汰功能 (Deprecated Features)

| 淘汰日期   | 功能                                                            | 原始文件                                         | 說明                                                                                                 |
| ---------- | --------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 2026-07-26 | 整併完成 — 41 份 `docs/specs/` 2026-06-20 ~ 2026-07-10 歷史文件 | `docs/specs/2026-06-20-*.md` ~ `2026-07-10-*.md` | 全部 contents 收進 [`docs/specs/2026-07-26-Summary.md`](docs/specs/2026-07-26-Summary.md);無功能淘汰 |
| 2026-08-04 | PTY-backed terminal 與 `Superset: Open TUI Terminal` 命令 | [`docs/specs/2026-08-04-remove-pty-use-native-terminals.md`](docs/specs/2026-08-04-remove-pty-use-native-terminals.md) | Superset 不再持有 pseudoterminal:terminal 一律由 VSCode 開,`node-pty` 相依、auto-replace 層與 `superset.terminals.highWaterMark` / `lowWaterMark` 設定同時移除 |

`2026-07-26-Summary.md` 已由 [`2026-07-31-Summary.md`](docs/specs/2026-07-31-Summary.md) 吸收；既有歷史列保留原文，完整內容仍可從 git history 追溯。

## 授權 (License)

`Apache-2.0`,見 [`LICENSE`](LICENSE)。

---

## 相關連結 (Related)

- 技術脈絡與架構: [`CLAUDE.md`](CLAUDE.md)
- 已實作規格: [`docs/specs/`](docs/specs/)
- 進行中計畫: [`plans/`](plans/)
- VSCode Shell Integration: <https://code.visualstudio.com/docs/terminal/shell-integration>
