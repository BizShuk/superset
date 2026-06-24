# GitHub Actions CI 與 issue / PR 模板 (Continuous Integration Setup)

> 為 Superset 新增 `.github/workflows/ci.yml`,每個 PR 自動跑 `npm install && npm test && tsc --noEmit`(含矩陣策略覆蓋 macOS / Linux / Windows),並補上 issue / PR template,讓貢獻流程有清楚的「應該怎麼回報」、「應該怎麼貢獻」模板可循。

## 為何要做 (Why)

- **現況的根本問題**:`.github` 目錄根本不存在 — 沒有 CI workflow,沒有 issue template,沒有 PR template。
  - 結果:貢獻者開 PR → 維護者只能「本機跑 `npm test`」,沒有「PR-level gate」
  - 結果:貢獻者開 issue → 沒有結構化模板,經常缺 reproduction steps / environment
  - 結果:VSCode 擴充專案必備的「PR 通過 CI 才允許 merge」保護完全沒有
- **VSCode 擴充專案的常見痛點**:`node-pty` prebuild 在不同 OS 上行為不同(Linux 缺 `arp` 指令、macOS traceroute 用 `traceroute`、Windows 完全不一樣)— 沒有矩陣 CI,Linux 壞了開發者看不到
- **貢獻摩擦**:沒有 CONTRIBUTING.md,新貢獻者要靠「讀 codebase 反推規範」,效率極低
- **與既有提案的關聯**:
  - [chore] VSCode baseline alignment(2026-06-23#4A)engines 改了 → 沒有 CI 把關可能就漏在 1.85 上
  - [chore] VSIX cross-platform packaging(2026-06-23#5A)需要 CI 自動跑 `vsce package` 驗證 → 沒 CI 就要手動
  - [chore] Show Diagnostics webview(2026-06-24#6A)讓使用者自助診斷 → issue 進來時若附 diagnostic,維護者一鍵讀

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - **是否要跑跨 OS 矩陣 CI?**
>   - 預設:跑 3 OS(macOS / Linux / Windows)— 對 `node-pty` 擴充強烈推薦
>   - 替代:只跑 Linux(便宜但漏 mac/Windows bug)
>   - 預估成本:每 OS 約 2-3 分鐘,3 OS × 每 PR = 6-9 分鐘;對 open source 專案可在免費額度內
> - **是否要 cache `node_modules`?**
>   - 預設:用 `actions/setup-node@v4` 內建 `cache: 'npm'`,自動 cache `~/.npm`
>   - 效果:第一次 install ~60 秒 → 後續 ~15-20 秒
> - **是否要用 strict mode 分支保護?**
>   - 預設:在 `Settings → Branches → Branch protection rules` 要求 PR 通過 CI 才能 merge
>   - 替代:不設,純 informational — 不推薦
> - **是否要用 `vitest --coverage` 跑覆蓋率報告?**
>   - 預設:加 `@vitest/coverage-v8` 在 CI 跑覆蓋率,artifact 上傳到 PR comment
>   - 替代:不跑(降低複雜度)
>   - 推薦跑:可量化 [test-coverage-topology](2026-06-23-test-coverage-topology.md) 改進的效益

## 提議的變更 (Proposed Changes)

### CI Workflow

#### [NEW] [.github/workflows/ci.yml](file:///Users/bytedance/projects/superset/.github/workflows/ci.yml)

```yaml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  test:
    name: test (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
      - run: npx tsc --noEmit
```

#### [NEW] [.github/workflows/coverage.yml](file:///Users/bytedance/projects/superset/.github/workflows/coverage.yml)

- 跑覆蓋率(只在 Linux 即可,mac/Win 跑會拖慢):
  ```yaml
  name: Coverage
  on: [pull_request]
  jobs:
    coverage:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: '20'
            cache: 'npm'
        - run: npm ci
        - run: npx vitest run --coverage
        - uses: actions/upload-artifact@v4
          with:
            name: coverage
            path: coverage/
  ```

#### [NEW] [.github/workflows/release.yml](file:///Users/bytedance/projects/superset/.github/workflows/release.yml)

- 標籤觸發,跑 `vsce package` 並上傳 artifact(對接 [#5A VSIX cross-platform sanity](2026-06-23-chore-vsix-cross-platform-sanity.md)):
  ```yaml
  name: Release
  on:
    push:
      tags: ['v*']
  jobs:
    package:
      runs-on: ${{ matrix.os }}
      strategy:
        matrix:
          os: [macos-latest, ubuntu-latest, windows-latest]
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20', cache: 'npm' }
        - run: npm ci
        - run: npm run build
        - uses: actions/upload-artifact@v4
          with: { name: superset-${{ matrix.os }}, path: '*.vsix' }
  ```

### Templates

#### [NEW] [.github/ISSUE_TEMPLATE/bug_report.md](file:///Users/bytedance/projects/superset/.github/ISSUE_TEMPLATE/bug_report.md)

```markdown
## Description
<!-- What happened? -->

## Reproduction
<!-- Minimal steps to reproduce -->

## Expected

## Actual

## Environment
- VSCode version:
- Superset version:
- OS:
- Workspace type (single-folder / multi-root / none):

## Diagnostic snapshot
<!-- Run `Superset: Show Diagnostics` and paste the JSON here -->
```

#### [NEW] [.github/ISSUE_TEMPLATE/feature_request.md](file:///Users/bytedance/projects/superset/.github/ISSUE_TEMPLATE/feature_request.md)

- 簡短三段:問題陳述 / 提議解決方案 / 替代方案

#### [NEW] [.github/PULL_REQUEST_TEMPLATE.md](file:///Users/bytedance/projects/superset/.github/PULL_REQUEST_TEMPLATE.md)

```markdown
## Summary
<!-- What & why -->

## Linked plan
<!-- Path to plans/<date>-<slug>.md if applicable -->

## Test plan
<!-- How did you verify? -->

## Checklist
- [ ] `npm test` green
- [ ] `npx tsc --noEmit` green
- [ ] New tests added (if behavior changed)
- [ ] `README.todo` updated (if relevant)
```

### 文件

#### [NEW] [CONTRIBUTING.md](file:///Users/bytedance/projects/superset/CONTRIBUTING.md)

- 開發環境建置、跑測試、提 PR 流程、commit message 風格
- 引用 `[plans/](plans/)` 機制:任何「改變行為」的功能都應先有 plan
- 引用 `README.todo` 機制:plan 完成後勾掉對應條目

#### [MODIFY] [README.md](file:///Users/bytedance/projects/superset/README.md)

- 在頂端加 CI badge:`[![CI](https://github.com/BizShuk/superset/actions/workflows/ci.yml/badge.svg)](...)`

---

## 驗證計劃 (Verification Plan)

### 自動化驗證

- 推一個測試 PR,確認:
  - `CI / test (ubuntu-latest)` 跑完 ~3 分鐘,綠燈
  - `CI / test (macos-latest)` 跑完 ~3 分鐘,綠燈
  - `CI / test (windows-latest)` 跑完 ~3 分鐘,綠燈(可能因 `node-pty` 在 Windows 上 prebuild 較慢,可調整 timeout)
- 故意送一個 `npm test` 會紅的 PR,確認 CI 阻擋 merge
- 故意送一個 `tsc --noEmit` 會紅的 PR,確認 CI 阻擋 merge

### 手動驗證

- 用 GitHub UI 開一個 issue,確認 bug_report template 預先填好
- 開一個 PR,確認 PR template 自動載入

### 維護成本

- GitHub Actions 免費額度:每月 2000 分鐘(public repo 無限)
- 3 OS × 每 PR ~6-9 分鐘 + coverage + release → 月 100 個 PR 大概 ~1500 分鐘,在額度內
- 維護負擔:每年 ~2-3 次更新 `actions/checkout` / `setup-node` 版本

## 風險與緩解 (Risks & Mitigations)

| 風險                                | 緩解                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `node-pty` prebuild 在 CI 上下載失敗 | 鎖版 `package-lock.json`(已存在);`npm ci` 用 lockfile 而非 `npm install`              |
| macOS runner 慢且貴                 | `fail-fast: false` 讓 3 OS 平行;macOS runner 通常 2-3 分鐘可完成                       |
| Issue template 把貢獻者嚇跑          | 模板留大量 `<!-- -->` 註解當 placeholder,必要欄位用 `<!--- -->` 標 required 但仍可跳過 |
| Windows 上某些 node-pty 行為不同   | CI 矩陣本來就會抓出來;不修而是先有 visibility                                       |
| 維護者沒設 branch protection 規則   | 在 CONTRIBUTING.md 明確要求「PR 須通過 CI 才能 merge」;若 repo owner 未設,文件透明化 |

## 預估工作量 (Effort Estimate)

- 3 個 workflow yml 檔:1 小時
- 2 個 issue template + 1 個 PR template:30 分鐘
- CONTRIBUTING.md:30 分鐘
- README.md badge + 測試 PR:15 分鐘
- **總計:約 2.5 小時**

## 後續 (Follow-ups, 非本次範圍)

- **Dependabot 自動 PR**:`.github/dependabot.yml` 設定每週掃 `package.json` 與 `*.yml` action 版本,自動發 PR
- **CodeQL security scan**:`.github/workflows/codeql.yml` 跑 GitHub 內建 SAST
- **Release Drafter**:`.github/release-drafter.yml` 自動從 PR 累積 release notes
- **Vitest 的 `coverage` 資料夾 gitignore**:避免 coverage report 被 commit(本次先不處理,後續)
