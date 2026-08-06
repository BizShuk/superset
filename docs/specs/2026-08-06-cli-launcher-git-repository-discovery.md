# CLI Launcher Git Repository Discovery

- 日期：2026-08-06
- 狀態：已實作 (`0.35.0`)
- 相關規格：[`2026-08-04-cli-launcher.md`](2026-08-04-cli-launcher.md)

## 範圍 (Scope)

CLI Launcher 的兩層 default discovery 改為只顯示 Git repositories。這份規格取代
既有 CLI Launcher 規格中「任何資料夾都預設顯示」的 visibility contract；固定兩層
tree shape、explicit entries、Hidden Rules、path actions、filter 與 terminal lifecycle
契約維持不變。

## 行為 (Behavior)

- `superset.cliLauncher.roots` 仍只掃描 Layer 1 與 Layer 2，root 本身不顯示。
- 預設 row 必須由該資料夾自己的 `.git` directory 或 file 證明為 repository；不得沿
  parent directory 找到其他 repository 後誤判。
- Layer 1 repository 顯示自己，children 只保留 Layer 2 repositories。
- Layer 1 非 repository 若含有 Layer 2 repositories，保留為 Category Container；沒有
  repository child 時整列省略。
- Filesystem probe 失敗視為非 repository，不顯示 error row；同時 probe 上限為 8。

## Explicit Entry Boundary

Raw scan 仍保留完整兩層 directory candidates，因為 `superset.cliLauncher.entries` 是
加入 non-repository 的明確出口：

- literal Pinned Path 不依賴 scan，也不要求是 repository；
- Regex Dynamic Entry 先從完整兩層 candidates 展開，再套用 Git-only default
  projection，因此也能明確選取 non-repository；
- `hidden` precedence 與 literal override 維持既有契約。

這個順序避免 default list 被一般 `src/`、`docs/` 等資料夾淹沒，同時保留使用者把任何
合法 cwd 明確加入面板的能力。

## Consumer Consistency

Tree View、Command Palette Quick Pick 與 `Copy All Paths` 都必須使用相同的 default
repository projection。不能只改畫面，留下命令候選仍包含預設隱藏的 non-repository。

## 驗證 (Verification)

- Filesystem contract tests 覆蓋 `.git` directory、`.git` file、non-repository omission、
  Category Container 與 fail-soft behavior。
- Tree contract tests 覆蓋 Git-only default rows，以及 literal / Regex explicit entries
  仍可顯示 non-repository。
- Manifest contract tests 鎖定 `roots` 與 `entries` 的 user-facing settings 說明。
