# Git pre-push release 版本選擇

日期：2026-07-22

## 目標

Superset 內建的 `pre-push` Git hook 在將新 commit 推送到 `master` 時，自動建立並推送 annotated release tag。Tag 不能只從既有 Git tag 推導，還必須納入 repository 內已維護的 package 與 Claude plugin 版本，避免自動建立比 manifest 更低的 release tag。

## 版本規則

Hook 從三個候選取數字 SemVer 最大值：

```text
next release version = max(
    patch(highest local Git tag),
    package.json.version if present,
    .claude-plugin/plugin.json.version if present
)
```

- Git tag 只認 `v<major>.<minor>.<patch>`；沒有合法 tag 時以 `v0.0.0` 為基準，候選為 `0.0.1`。
- Manifest 只認 `<major>.<minor>.<patch>` stable version，不接受 prerelease、build metadata 或前導零。
- Manifest 不存在時不納入比較；存在但 version 無法解析時記錄 `stderr` 訊息後忽略該候選。
- 版本比較依 `major`、`minor`、`patch` 依序做數字比較，不依賴平台 `sort` 行為。
- 最終 tag 為 `v<next release version>`。Hook 只讀兩個 manifest，不會修改檔案內容。

Claude plugin manifest 的 canonical path 是 `.claude-plugin/plugin.json`。`.claude/plugin.json` 不是本專案的 plugin manifest 介面。

## 保留行為

- 只處理 `master` branch 的新 commit push。
- 以現存最高 local version tag 為 Git 候選基準，不使用最近可達 tag。
- 建立 annotated tag，並由 hook 另行推送到當前 remote。
- Hook 自己觸發的 tag push 由 ref type gate 跳過，避免遞迴。
- Hook 失敗不 reject 原始 branch push；診斷透過 `stderr` 輸出。
- Install 仍為 copy-if-missing；workspace 已存在的同名 `pre-push` 不會被覆蓋。

## 測試

`test/gitHookPrePush.test.ts` 在暫存 Git repository 與 bare remote 上直接執行模板，驗證：

- 沒有 manifest 時取最高 Git tag 的下一個 patch。
- `package.json` 較低時不會使 release version 倒退。
- `package.json` 較高時直接使用該版本。
- `.claude-plugin/plugin.json` 為最高候選時使用該版本。
- 產生的 tag 為 annotated tag，且已推送到 remote。
