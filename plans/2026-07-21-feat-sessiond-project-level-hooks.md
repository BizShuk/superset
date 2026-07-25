# Context

目前 working tree 已完成安全的 `sessiond uninstall` 與 install fail-closed 基礎，但 install/uninstall targets 仍是 user-level `~/.claude/settings.json`、`~/.codex/config.toml`。需求改為 project-level hooks，讓 hook 只作用於目前 repository，避免 malfunction 影響所有 Claude Code / Codex sessions。

本次沿用既有 dry-run、backup、atomic write、symlink preservation 與 strict ownership parsing，不重做 recovery 架構。Claude 採唯一共享專案慣例 `<project-root>/.claude/settings.json`；Codex 採 `<project-root>/.codex/config.toml`。不新增 scope/path flags，也不採 `.claude/settings.local.json`，避免同一功能出現多個設定來源。

# Implementation plan

1. 將 target resolution 從 HOME 改為 project root
   - 在 `pkg/install/install.go` 將 `Options.Home` 改為內部測試用的 `ProjectRoot` / `WorkingDir` injection；CLI 不暴露自訂 root 選項。
   - 新增 `resolveProjectRoot`：優先從 invocation cwd 執行 `git rev-parse --show-toplevel`；從 repository 子目錄執行仍定位到 root，Git worktree 則定位到該 worktree root。
   - 非 Git 目錄 fallback 到 invocation cwd，絕不 fallback 到 HOME。
   - targets 固定為：
     - Claude：`<root>/.claude/settings.json`
     - Codex：`<root>/.codex/config.toml`
   - `Run` 與 `RunUninstall` 共用相同 root/target resolution，確保 install/uninstall 對稱。

2. 保留並調整既有安全寫入流程
   - `install --apply` 可在 project root 下建立缺少的 `.claude` / `.codex` directories 與 config files；dry-run 不建立任何路徑。
   - `uninstall` 對缺少的 project config 維持 no-op，且不建立路徑。
   - 沿用 strict Claude JSON shape validation、Codex unique marker validation、sessiond-owned entry removal、unique backup、atomic write 與 symlink target preservation。
   - backup 固定建立在實際 project config target 旁；單一 target 失敗不阻止另一 target。
   - 修正 package/file comments 與 status output，不再描述 user HOME config。

3. 處理既有 user-level hooks 的 migration risk
   - 正常 install/uninstall 不讀寫 `~/.claude` 或 `~/.codex`，避免 project operation 意外變更 global state。
   - CLI/README 明確提示：舊版已安裝的 HOME hooks 不會自動遷移或刪除；project install 驗證成功後，使用者需以舊版 backup 或手動精確移除 legacy entries。
   - 不加入自動 legacy cleanup、migration flag 或第二套 scope option；若之後需要，另做明確的 recovery command。

4. 更新 CLI wiring 與說明
   - 更新 `cmd/install.go` 與 `cmd/uninstall.go` help：從 cwd 解析 project root，列出 project-level paths，保留 default dry-run / `--apply`。
   - CLI 將 cwd 傳入 package，測試則可注入 `ProjectRoot`，避免 tests shell out 或觸碰真實 repository。
   - 維持已完成的 `uninstall` command registration 與 sessiond `0.2.0`；本次同一未提交 change set 不再重複 bump version。

5. 將 tests 從 fake HOME 改成 fake project
   - 重構 `pkg/install/install_test.go` fixtures，使用 `t.TempDir()` project root；所有 install/uninstall assertions 改查 `.claude/settings.json` 與 `.codex/config.toml` under project root。
   - 新增 root resolution cases：project root override、nested cwd、non-Git cwd fallback、Git repository、Git worktree（可用時）。
   - 新增 isolation assertion：即使 test HOME 內存在 legacy hooks，project install/uninstall 也不得修改它們。
   - 驗證 apply 建立 project dirs、dry-run 不建立、nested invocation 寫 root、install→uninstall round trip、malformed fail-closed、symlink、backup、idempotence 與 per-target failure。
   - 更新 `cmd/root_test.go`，確認 help 不再出現 HOME target，並保留 `--apply` / positional argument contract。

6. 同步 README 與設計脈絡
   - 更新 `README.md` Hook wiring table 為 `<git-root>/.claude/settings.json` 與 `<git-root>/.codex/config.toml`。
   - 說明 nested cwd / worktree / non-Git fallback、Claude settings precedence（managed → CLI → local → project → user），以及本工具固定使用 shared project settings。
   - 說明 Codex project hooks 需要 project trusted，且 hooks support/feature enablement 依 installed Codex version；不把不穩定 feature flag 當成通用保證。
   - 更新仍宣稱 HOME install path 的進行中 plan/spec reference；不改寫無關歷史文件。

# Critical files

- `pkg/install/install.go`
- `pkg/install/uninstall.go`
- `pkg/install/install_test.go`
- `cmd/install.go`
- `cmd/uninstall.go`
- `cmd/root_test.go`
- `README.md`
- repository 中仍記載 HOME hook target 的 sessiond plan/spec（僅同步相關段落）

# Verification

1. Go checks：
   - `gofmt -l` 僅檢查本次變更 Go files，應無輸出。
   - `go test ./...`
   - `go test -race ./...`
   - `go vet ./...`
   - `go build ./...`
2. Isolated project CLI smoke test：
   - 建 temporary Git repo 與獨立 temporary HOME。
   - 從 repo nested directory 執行 `sessiond install`，確認 dry-run 完全無變更。
   - 執行 `sessiond install --apply`，確認只產生 `<repo>/.claude/settings.json` 與 `<repo>/.codex/config.toml`。
   - 執行 `sessiond uninstall` / `--apply`，確認 dry-run、owned-only removal、backup、second-run no-op。
   - 確認 temporary HOME 內預置的 global configs byte-for-byte unchanged。
3. Repository checks：
   - `npm test`
   - `package.json` / `package-lock.json` versions 維持同步。
   - `git diff --check`
   - IDE diagnostics 無新增問題。
