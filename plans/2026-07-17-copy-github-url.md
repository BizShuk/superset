# Explorer Copy GitHub URL

## Goal

在 VS Code Explorer 的檔案右鍵選單加入 `Copy GitHub URL`，產生固定指向
`master` branch 的 GitHub 網頁 URL 並寫入 clipboard。

## Scope

- 使用穩定的 `explorer/context` menu contribution。
- 選單放在 GitLens 使用的 copy-path group：`6_copypath@100`。
- 接受 Explorer 傳入的本機檔案 `Uri`。
- 從 VS Code 內建 Git extension API 找到包含該檔案的 repository。
- 優先使用名為 `origin` 的 GitHub remote；若不存在，使用第一個 GitHub remote。
- 支援下列 remote 格式：
  - `git@github.com:owner/repo.git`
  - `ssh://git@github.com/owner/repo.git`
  - `https://github.com/owner/repo.git`
  - `http://github.com/owner/repo.git`
- 產生 `https://github.com/<owner>/<repo>/blob/master/<relative-path>`。
- 相對路徑依 URL path segment 編碼，保留 `/` 分隔符。
- 成功時寫入 clipboard 並顯示簡短確認訊息。
- 找不到 repository、GitHub remote，或檔案位於 repository 外時顯示錯誤訊息。

## Explicit Non-goals

- 不呼叫 GitHub API。
- 不檢查 `master` branch 是否存在。
- 不檢查 GitHub 上是否存在該檔案。
- 不使用目前 checkout branch 或 commit SHA。
- 不加入行號或 editor selection range。
- 不依賴 proposed API 或啟動旗標。

## Architecture

`src/git/githubUrl.ts` 放置無 `vscode` import 的純函式：

- GitHub remote URL 正規化。
- GitHub remote 選擇，`origin` 優先。
- repository-relative path 驗證與 URL 組裝。

`src/git/index.ts` 維持 thin orchestration layer：

1. 接收 Explorer `Uri`。
2. 取得內建 Git extension API。
3. 找到包含檔案的 repository。
4. 呼叫純函式產生 URL。
5. 寫入 clipboard 或顯示錯誤。

`package.json` 宣告 command 與 `explorer/context` menu。這個功能使用 stable API，
與既有 SCM Graph proposed API reset contribution 相互獨立。

## Error Handling

所有失敗皆停止在本機，不進行網路請求：

- command 未收到 file URI：提示從 Explorer 檔案右鍵執行。
- Git extension 未啟用：提示無法取得 Git repository。
- 找不到包含檔案的 repository：提示檔案不在 Git repository。
- 找不到 GitHub remote：提示 repository 沒有 GitHub remote。
- 相對路徑逃出 repository：拒絕產生 URL。

## Tests

- remote parser：SSH、SSH URL、HTTPS、HTTP、`.git` suffix 與非 GitHub host。
- remote selection：`origin` 優先，否則第一個 GitHub remote。
- URL builder：固定 `master`、空格與 Unicode path segment 編碼、拒絕 repo 外路徑。
- manifest contract：command 存在且 contribution 位於
  `explorer/context` 的 `6_copypath@100`。
- command orchestration：成功寫 clipboard；錯誤不寫 clipboard。

## Documentation and Version

- `README.md` 增加使用方式。
- `CLAUDE.md` 增加 GitHub URL data flow 與 non-goals。
- `package.json` 依專案規則做 patch version bump，並同步 `package-lock.json`。
