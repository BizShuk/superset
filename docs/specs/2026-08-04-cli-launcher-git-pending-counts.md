# CLI Launcher — 每列顯示 git 待處理計數

Date: 2026-08-04
Status: 已實作

## 背景 (Context)

CLI 面板每一列原本是 `<資料夾名> <路徑>`:label 已經是 basename、tooltip 也有完整
路徑,description 欄等於把同一份資訊講第三次。對「挑一個 cwd 開 agent CLI」這個
唯一用途來說,真正想先知道的是`這個 repo 還有沒有東西沒收`。

## 決定 (Decision)

description 欄改為該路徑的 git 待處理檔案數:

```text
staged:<index 變更數> unstaged:<工作區變更數> <未追蹤數>
```

未追蹤數刻意`不帶標籤`,依使用者指定的格式輸出。

## 規則 (Rules)

- 資料來源是 `git --no-optional-locks status --porcelain=v1`,在該資料夾為 cwd 執行。
  `--no-optional-locks` 避免只為顯示數字就去寫使用者的 index lock。
- 執行前先 `stat(<dir>/.git)`,只有`資料夾自己`是 repository 才跑 git。git 預設會
  沿父層往上找 repository —— `~/projects/platform` 不是 repo 時會顯示 `~/projects`
  或 `~` 的狀態,那是張冠李戴。`.git` 可能是目錄,也可能是 submodule / worktree 的
  檔案,因此用 `stat` 而不是 `isDirectory()`。
- 計數規則(porcelain v1 的 `XY` 兩欄):`??` 計入 untracked;`!!` 忽略;`X` 非空白
  計入 staged;`Y` 非空白計入 unstaged。unmerged(`UU`、`AA` …)兩欄都是字母,
  因此同時計入兩側 —— 它確實兩邊都待處理。rename(`R  old -> new`)是一筆。
- 未追蹤項目用 git 預設的 `normal`:整包未追蹤資料夾算一筆,不逐檔展開。
  `-uall` 會在有大量未追蹤檔案(例如未 ignore 的 `node_modules`)的 repo 上失控。
- 乾淨的 repository 與非 repository 一律回傳空字串,description 不顯示。面板一列
  一個 repo,幾十個 `staged:0 unstaged:0 0` 只是噪音。
- 任何失敗(不是 repo、沒有 git、逾時 3 秒、stdout 超過 4 MB)一律當成沒有 git
  資訊,不拋錯、不變成錯誤畫面 —— 這與掃描失敗回空陣列的既有政策一致。
- 同時執行的 git 行程上限 8。一次 `getChildren` 先把該層所有路徑一起問完再分配給
  各列,不逐列 await:逐列會把數十次 `git status` 串成序列。
- 第二層的計數在`展開時`才讀。開面板就把兩層全掃等於對每個
  `<category>/<project>` 都 spawn 一次 git。
- 完整路徑移到 tooltip;有計數時 tooltip 多一行標示三個數字的意義。
- 不做快取。與掃描一致:`Refresh` / `Reset Caches` 就是重新讀一次,面板才不會顯示
  過期的數字。

## 檔案 (Files)

| 檔案 | 角色 |
| --- | --- |
| `src/cliLauncher/gitStatus.ts` | 新增。`.git` 判定、spawn、porcelain 解析、格式化、併發上限 |
| `src/cliLauncher/tree.ts` | description 改用計數;`layer2Items` 改為 async |
| `test/cliLauncherGitStatus.test.ts` | 新增。解析與格式化的純函式測試 |
| `test/cliLauncherTree.test.ts` | 新增兩個 case:兩層各自的 description |

## 未採用 (Rejected)

- `git status --porcelain=v2`:欄位更多但這裡只需要兩個狀態欄,v1 的 `XY` 已足夠。
- 逐檔展開未追蹤(`-uall`):在未 ignore 大目錄的 repo 上會把面板變成熱路徑。
- 保留路徑在 description、把計數塞進 label:label 是命令參數的顯示來源,不該混入
  會變動的狀態字串。
