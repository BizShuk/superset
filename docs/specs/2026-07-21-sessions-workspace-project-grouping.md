# Context

Superset 的 Sessions 面板目前只讀取 `ctx.workspaceFolder` 對應的一個 sessiond store bucket，並以單層清單呈現，因此目前 workspace 底下以不同 `workspace_path` 記錄的子專案 sessions 不會出現。這次要以 session store 的 workspace bucket 作為 project 判定來源：載入 current workspace root 與所有 descendant workspace paths，並在 TreeView 中按 project 分組；沒有 session 的實體目錄不顯示。實作時必須保留目前工作樹內既有的 Sessions、Git hooks 與版本變更，不覆寫平行進行中的修改。

# Implementation

1. 擴充 Sessions store 的 workspace-scope 查詢
    - 在 `src/sessions/store.ts` 保留並重用 `sessionsRoot`、`decodeWorkspace`、`parseSessionJsonl` 與既有單一 bucket 讀取邏輯。
    - 新增 project/group domain shape 與一個 workspace-scope loader：列舉 session root 的 encoded workspace buckets，decode 後用 `path.relative` 做 segment-safe containment，收錄 current workspace root 及 descendants，排除 `_unknown`、workspace 外路徑、非目錄與無有效 `.jsonl` session 的 bucket。
    - bucket 路徑作為分組的 canonical project path；即使個別 JSONL 的 meta 缺失或 `meta.workspace_path` 漂移，也不讓 session 被錯分到其他 project。
    - 每組 sessions 維持 `lastActiveMs` 新到舊；project groups 採 root 優先，其餘依 current workspace-relative path 穩定排序，避免 basename 相同的巢狀專案混淆。
    - 調整 `watchSessions`（或新增 workspace-scope watcher）固定監看 sessions root，讓既有 child bucket 更新及之後新建的 descendant bucket 都能觸發 refresh；root 不存在時仍維持 manual refresh 的 graceful fallback。

2. 將 Sessions TreeView 改為 project → session 兩層樹
    - 在 `src/sessions/sessionsTreeProvider.ts` 將 `SessionsElement` 擴充為 `project | session | empty`，provider reload 改用新的 workspace-scope loader。
    - top-level 只回傳有 sessions 的 project rows；project row 使用 folder/repository 類 ThemeIcon、可折疊狀態、workspace-relative label（root 使用 workspace basename），description 顯示 session count，tooltip 顯示 absolute project path。
    - project children 回傳該組 sessions；session rows繼續重用 `buildSessionRow`，並保留 `SESSION_CONTEXT_VALUE`、open summary、open source、copy id、delete 等既有 command 行為。
    - empty placeholder 的語意維持「整個 current workspace scope 尚無 session」，sample seed/clear 仍只針對 current workspace root bucket，避免一次寫入或刪除所有子專案 fixture。

3. 接線、文件與版本
    - 在 `src/sessions/index.ts` 更新功能註解與必要型別收窄；`asSession` 僅接受 session leaf，確保 project row 不會誤觸 session commands。
    - 更新 `README.md` 的 Sessions 使用說明，以及 `docs/specs/2026-07-20-architecture-current-modules.md` 的 current behavior，記錄 current workspace scope 與 project grouping；不改寫 sessiond JSONL contract。
    - 依專案 semantic versioning 契約同步更新 `package.json` 與 `package-lock.json` 的 patch version；執行時先重新確認現有未提交版本，從當時值遞增，避免覆蓋目前平行修改中的 `0.14.5`。

4. 補足回歸測試
    - 擴充 `test/sessionsStore.test.ts`：root + 多層 descendant buckets、相似字首但不屬於 workspace 的 sibling、`_unknown`、空 bucket、malformed/mismatched meta、group/session 排序，以及新 bucket 可被重載發現。
    - 新增或擴充 Sessions provider 的 VS Code mock contract tests，驗證 top-level project rows、project children、root label、duplicate basename 的 relative label、empty state，以及 session-only commands 的 element narrowing。
    - 若 manifest/version 或 activation mock 受影響，更新 `test/packageManifest.test.ts` / `test/extensionActivate.test.ts` 的最小必要 assertion，不改動無關測試。

# Verification

1. 執行 Sessions 相關 Vitest（store、provider、open summary 與 manifest contract），確認新分組與既有 Markdown/open/delete/sample 行為都通過。
2. 執行 `npm test` 跑完整 test suite，確認其他 TreeView/plugin 沒有回歸。
3. 執行 `npm run build`，完成 clean、install、TypeScript compile、VSIX package 與 `verify-vsix.sh`；此變更包含 manifest/version 與 TreeView 行為，必須做完整 build。
4. 用 scratch `superset.sessions.dataDir` 建立 current workspace root、nested project、outside sibling 三種 encoded buckets，啟動 Extension Development Host：Sessions 應只顯示 root + nested project groups；展開後 session 新到舊，outside sibling 不出現。
5. 在執行中新增 descendant bucket 或 append turn，確認 watcher 自動新增/刷新 group；逐一驗證 Open Summary、Open Source、Copy ID、Delete，並確認 Seed/Clear Sample 只影響 root project。
