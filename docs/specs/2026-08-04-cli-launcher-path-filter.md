# CLI Launcher 路徑過濾 (逐段 subsequence match)

- 日期:2026-08-04
- 狀態:已實作 (`0.25.0`)
- 相關規格:[`2026-08-04-cli-launcher.md`](2026-08-04-cli-launcher.md)

## 問題 (Problem)

CLI 面板列出 `~/projects` 底下`兩層`資料夾。專案數量成長後,top level 就有十幾列,
展開第二層後上百列;要跑某個專案的 agent CLI 得先用眼睛在樹裡找。原生 tree view 的
type-ahead 只比對`單一節點的 label`,無法用「分類 + 專案」一次收斂
(例如同時表達 `platform` 與 `superset`)。

## 決策 (Decision)

在面板加上一個過濾條件,比對方式是`逐段 (per segment)` 的 subsequence match:查詢以
`/` 切段,每一段的字元必須`依序`出現在`同一個路徑段`裡,不要求連續;段與段之間依路徑
順序推進。連續 substring 比對會逼使用者記得完整資料夾名,單段 subsequence 讓 `tool`
命中 `tools`、`pl/sup` 命中 `platform/superset`。

### subsequence 不得跨 `/`(第一版的 bug)

第一版把整條縮寫路徑攤平成一個字串比對,結果查詢 `tool` 會命中
`~/projects/collections/plans`:`projec`**`t`**`s` 出 t、`c`**`o`**`llecti`**`o`**`ns`
出兩個 o、`p`**`l`**`ans` 出 l。路徑越長、字元越多,誤命中越嚴重,`~/projects/` 這個
共同前綴本身就送了一堆可用字元。

限制在單一段內之後,`tool` 只會對上 `tools`。要表達跨層條件就明確打 `/`
—— 這也讓「第一層 + 第二層」變成可以精確表達的查詢,而不是碰運氣。

### 比對規則

- 查詢正規化:轉小寫、移除所有空白(`pl sup` == `plsup`)。切段後沒有任何條件的
  查詢(`""`、`/`、`~/`)一律視為沒有過濾,不會把面板標成「過濾中」。
- 比對對象是`縮寫後路徑`(`collapseHome`,面板顯示的就是它)切出的各段;`~` 段丟棄。
- 段之間只能往後推進、可以跳過:`pj/sup` 命中 `~/projects/platform/superset`,
  `sup/pl` 不命中。
- `單段`查詢額外 fallback 比對`顯示名稱`,讓釘選項目可用與路徑無關的自訂 label 找到;
  多段查詢不做這個 fallback (段序是路徑語意,label 不在路徑裡)。
- 第一層命中 → 整包第二層一起留下(子路徑的段是父路徑的段加一,必然也命中)。
- 第一層未命中、第二層命中 → 保留第一層當掛載點,只留下命中的子節點,並將該列
  預設`展開`,讓命中項目直接可見。
- 父子皆未命中 → 整包丟棄。

### 狀態歸屬

過濾字串是 ephemeral UI state,由 `CLILauncherTreeProvider` 持有,`不寫`
settings 也`不寫` `globalState`:

- `superset.cliLauncher.*` settings 仍是路徑清單的唯一資料來源(既有 invariant)。
- 面板的顯示條件不是路徑清單的一部分,持久化它會讓「重開 VS Code 後專案列表少一半」
  變成無法解釋的狀態。

`CLIEntryTreeItem.id` 在過濾時加上查詢字串當 scope(`scan:<query>:<path>`)。
VS Code 以 id 記住每一列的展開狀態,沿用同一組 id 會讓想預設展開的節點停在上一次的
摺疊狀態。

### 互動 (UX)

- `CLI: Filter Paths`(標題列 `$(filter)`)開一次性的 `showInputBox`,預填目前條件;
  送出空字串等於清除,按 `Esc` 取消則維持原條件。
- `CLI: Clear Filter`(標題列 `$(filter-filled)`)只在 context key
  `superset.cliLauncher.filtered` 為 true 時出現。
- 過濾中 `TreeView.description` 顯示 `filter: <查詢>`。
- `Copy All Paths` 套用作用中的過濾 —— 它的定義是「複製面板`當下顯示`的全部」。
  Command Palette 的 quick pick `不`套用,它自己已經有搜尋框。

### 為什麼不是逐鍵即時過濾

`showInputBox` 是一次性的,不是每按一鍵就重畫樹。掃描結果刻意沒有快取
(`Reset Caches` == 重新掃描一次),逐鍵過濾會讓每個按鍵都對 root 重跑一輪
`readdir`,把冷路徑變成熱路徑。要換成即時過濾,得先決定掃描快取的失效策略。

## 實作 (Implementation)

| 檔案 | 變更 |
| --- | --- |
| `src/cliLauncher/filter.ts` | 新增:`normalizeFilterQuery`、`splitFilterQuery`、`pathSegments`、`isSubsequenceMatch`(單段用)、`matchesCLIEntry`、`filterCLIEntries`、`filterScannedFolders`(純函式,不依賴 `vscode`) |
| `src/cliLauncher/tree.ts` | provider 持有 query;`setFilter` 只在真的改變時 refresh;top level 套用過濾、id 加 query scope、過濾中預設展開 |
| `src/cliLauncher/index.ts` | 註冊 `superset.cliLauncherFilter` / `superset.cliLauncherClearFilter`;`applyFilter` 同步 view description 與 context key;dispose 時把 context key 收回 false |
| `package.json` | 兩個新命令與 `view/title` 選單;`navigation` 順序重排為 Filter / Clear Filter / Pin / Copy / Refresh |

## 測試 (Verification)

- `test/cliLauncherFilter.test.ts`:單段 subsequence 語意(順序、大小寫、缺字)、
  段序推進與跳段、`tool` 不得命中 `collections/plans` 等三筆的回歸測試、label
  fallback 只限單段查詢、父子留存規則、不變更輸入。
- `test/cliLauncherTree.test.ts`:provider 的正規化與 refresh 去抖、過濾後的樹形、
  展開狀態、id scope、自訂 label 過濾。
- `test/packageManifest.test.ts`、`test/extensionActivate.test.ts`:命令宣告、
  `Clear Filter` 的 `when` 條件、activation 時兩個命令確實註冊。
