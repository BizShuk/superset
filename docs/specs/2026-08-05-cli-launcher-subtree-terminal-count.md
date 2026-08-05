# CLI Launcher 父列彙總子路徑 Terminal 數

- 日期：2026-08-05
- 狀態：已實作 (`0.31.1`)
- 相關規格：[`2026-08-04-cli-launcher-path-terminals.md`](2026-08-04-cli-launcher-path-terminals.md)

## 問題 (Problem)

`🟡 <count>` 只算 path 自己的 terminals。實際使用時 agent 幾乎都跑在第二層
（`~/projects/platform/superset`），第一層（`~/projects/platform`）在收合狀態下
永遠顯示 0，看起來像沒有東西在跑。使用者必須逐一展開才能找到正在跑的資料夾，
違背「面板一眼看出哪裡有活動」的目的。

## 決策 (Decision)

Path row 的 `🟡` 改為`含子孫路徑的總數`；展開後列出的 terminal rows 維持只有
「屬於該 path 自己」的那些，兩者刻意分離：

- `CLITerminalTracker.countUnderPath(path)` 以路徑字首（`isDescendantPath`）
  彙總，不是加總已顯示的子列 —— 尚未展開、因此還沒建立 tree item 的第二層一樣要
  算進去。字首比對要求 `<parent>/`，`~/projects/webhooks` 不會被算進
  `~/projects/web`。
- `CLIEntryTreeItem` 同時吃 `terminalCount`（自己）與 `totalTerminalCount`（含子孫）。
  展開狀態（`collapsibleState`）看`自己`的數量，description 看`總數`。
- description 永遠只有`一個`數字（總數），來源改用`顏色`區分：自己有 terminal 是
  `🟡`，自己沒開、數字全來自子資料夾是 `🔵`。用顏色而不是 `(here: N)` 這種額外
  文字，是因為同一列還要塞 git 分支與行數增減，橫向空間有限。
- Tooltip 維持原契約的兩件事：完整 git 摘要與 `CLI terminals: <total>`，不重複
  顏色已經表達的資訊。
- Terminal lifecycle event 除了該 path 的列，還要更新`所有祖先列`（`pathItems` 中
  路徑為其祖先者），否則收合的第一層會停在舊數字。仍然只碰受影響的列，不重掃
  roots 也不重跑 git。

`isDescendantPath` 抽到 `entries.ts`（純資料層），`isHiddenPath` 一併改用它，
避免兩份字首比對邏輯。

## 驗證 (Verification)

- `test/cliLauncherTerminal.test.ts`：`countUnderPath` 計入子孫、排除同字首的兄弟
  路徑、terminal 關閉後扣回。
- `test/cliLauncherTree.test.ts`：第二層新增 terminal 後父列 description 變成
  `🔵 1`（第二層自己是 `🟡 1`）、tooltip 只有 `CLI terminals: 1`、展開父列仍只有
  資料夾、同層其他 root 不受影響，整棵樹重建（`refresh()`）後總數仍成立，
  以及兩層都有 terminal 時父列回到 `🟡 2`。
- 完整驗證使用 `npm test`。
