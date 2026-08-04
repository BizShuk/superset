# CLI Launcher — 每列顯示 git 分支與行數增減

Date: 2026-08-04
Status: 已實作

## 背景 (Context)

CLI 面板每一列原本是 `<資料夾名> <路徑>`:label 已經是 basename、tooltip 也有完整
路徑,description 欄等於把同一份資訊講第三次。對「挑一個 cwd 開 agent CLI」這個
唯一用途來說,真正想先知道的是`在哪個分支`與`手上還有多少沒收的改動`。

## 決定 (Decision)

description 欄改為該路徑的 git 分支與行數增減:

```text
<branch>(+<新增或修改行數>,-<刪除行數>)
```

例:`master(+0,-0)`、`w-cli-git(+180,-165)`。

## 規則 (Rules)

- 分支來自 `git branch --show-current`。detached HEAD 時它是空字串,退回
  `git rev-parse --short HEAD` 顯示短 hash;兩者都拿不到才視為沒有 git 資訊。
- 行數來自 `git diff HEAD --numstat` 的加總,涵蓋 staged 與 unstaged —— 面板要的是
  「手上還有多少沒收的改動」,分兩欄反而看不出總量。`--numstat` 的二進位檔案兩欄
  是 `-`,直接略過。
- 尚無 commit 的 repo 沒有 `HEAD`,`git diff HEAD` 會失敗,退回 `git diff --numstat`
  (工作區 vs index)。這種 repo 仍會顯示 `master(+0,-0)` 而不是整列消失。
- 未追蹤檔案`不計入`:它們不在 `git diff` 的範圍內。要看未追蹤請開 SCM 面板。
- 執行 git 前先 `stat(<dir>/.git)`,只有`資料夾自己`是 repository 才跑。git 預設會
  沿父層往上找 repository —— `~/projects/platform` 不是 repo 時會顯示 `~/projects`
  或 `~` 的狀態,那是張冠李戴。`.git` 可能是目錄,也可能是 submodule / worktree 的
  檔案,因此用 `stat` 而不是 `isDirectory()`。
- 所有 git 命令都帶 `--no-optional-locks`:只為顯示數字不該去寫使用者的 index lock。
- 乾淨的 repository 仍然顯示 `<branch>(+0,-0)` —— 分支名本身就是有用資訊。只有
  `非 repository` 或讀取失敗才是空 description。
- 任何失敗(沒有 git、逾時 3 秒、stdout 超過 4 MB)一律當成沒有 git 資訊,不拋錯、
  不變成錯誤畫面 —— 與掃描失敗回空陣列的既有政策一致。
- 每個資料夾的分支與 diff 一起發出(`Promise.all`),不逐個 await;同時處理的資料夾
  數上限 8。一次 `getChildren` 先把該層所有路徑一起問完再分配給各列。
- 第二層的狀態在`展開時`才讀。開面板就把兩層全掃等於對每個
  `<category>/<project>` 都跑一次 git。
- 完整路徑移到 tooltip;有狀態時 tooltip 多一行標示三個欄位的意義。
- 不做快取。與掃描一致:`Refresh` / `Reset Caches` 就是重新讀一次,面板才不會顯示
  過期的分支。

## 檔案 (Files)

| 檔案 | 角色 |
| --- | --- |
| `src/cliLauncher/gitStatus.ts` | 新增。`.git` 判定、分支解析、`--numstat` 加總、格式化、併發上限 |
| `src/cliLauncher/tree.ts` | description 改用 git 摘要;`layer2Items` 改為 async |
| `test/cliLauncherGitStatus.test.ts` | 新增。`parseNumstat` 與 `formatGitFolderStatus` 的純函式測試 |
| `test/cliLauncherTree.test.ts` | 新增兩個 case:兩層各自的 description |

## 未採用 (Rejected)

- `git status --porcelain` 的檔案數(`staged:<n> unstaged:<n> <untracked>`):本規格的
  第一版,已被行數版本取代 —— 行數比檔案數更能反映改動規模。
- `git diff --shortstat` 的文字輸出:要再解析一次自然語言句型,`--numstat` 是結構化的。
- 把分支塞進 label:label 是命令參數的顯示來源,不該混入會變動的狀態字串。
