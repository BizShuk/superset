# VSIX 跨平台打包健全性 (VSIX Cross-Platform Packaging Sanity)

> 確保 `vsce package` 產出的 `.vsix` 對所有目標平台(macOS / Linux / Windows × arm64 / x64)都包含對應的 `node-pty` prebuild,且**不會**把測試 / 開發用檔案或不需要的平台 binary 灌進去。

## 為何要做 (Why)

- **`@homebridge/node-pty-prebuilt-multiarch` 的 prebuild**:
  - 預期每個平台一份 `.node` 原生 binding(例如 `macos-arm64`、`linux-x64`、`win32-x64`)
  - 開發機(例如 macOS arm64)跑 `npm install` 時,npm 通常**只下載**當前平台的 prebuild(透過 `optionalDependencies` 機制);但**有些 npm 版本會全部抓下來**
  - `vsce package` 預設會把 `node_modules` 整個塞進 VSIX,包含所有抓下來的 prebuild
- **現況**:
  - `.vscodeignore` 內容(目前):
    ```
    out/**/*.map
    src/**
    tsconfig.json
    .gitignore
    ```
  - **沒有**任何 `node_modules/**/prebuilds/` 或 `build/Release/` 相關排除
  - `scripts/` 內的 `for_loop.sh` 是無關的 test 工具,但**也會被打包** — 雖只有 50 bytes,但顯示 ignore 規則沒在管
  - 沒有 `**/__tests__` / `**/test/**` / `**/*.test.js` 排除 → vitest 跑過的編譯產物可能被打包
  - `package.json` 沒有 `files` 欄位 → `vsce` 預設「白名單 = 全打包」邏輯生效
- **風險**:
  - 開發機 macOS arm64 → release VSIX 在 Linux x64 使用者安裝時,`node-pty` load 失敗(找不到對應 binary)
  - VSIX 體積可能膨脹到數 MB(原本 57KB 假設不成立,要看實際)
  - `for_loop.sh` 等無關檔案被打包,看起來不專業
- **驗證方式**:`unzip -l superset-0.0.2.vsix | grep node | head -20` 直接看內容

## 使用者審查要求 (User Review Required)

> [!IMPORTANT]
> - 是否要支援「**單一 VSIX 涵蓋所有平台**」的模式?vsce 預設不支援,但可以:
>   - **A. 為每個平台 build 一個 VSIX**(用 `vsce package --target linux-x64` 等多跑幾次)— 每個檔小,平台鎖定
>   - **B. 單一 VSIX 含所有 prebuild**(VSIX 大但 portable,VSCode runtime 會自動挑對的)— 使用者無感
>   - 推薦 B:UX 簡單 + VSCode 自動 platform detection;VSIX 變大 ~2-3MB 對 desktop 體驗影響極低
> - `engines.vscode` 仍維持 `^1.85.0`(尚未 bump);若 [chore] VSCode baseline alignment(2026-06-23#4A)先做完,本 plan 也要跟進
> - 推薦:本 plan 一次完成 `package.json` 的 `files` 欄位 + `.vscodeignore` 補強 + 一個驗證腳本

## 提議的變更 (Proposed Changes)

### `.vscodeignore` 補強 (Ignore Hardening)

#### [MODIFY] [.vscodeignore](file:///Users/bytedance/projects/superset/.vscodeignore)

```diff
 out/**/*.map
 src/**
 tsconfig.json
 .gitignore
+
+# Test artifacts
+test/**
+**/*.test.ts
+**/*.test.js
+**/__tests__/**
+**/coverage/**
+
+# Dev scripts
+scripts/**
+
+# Native build artifacts (keep only what vsce auto-includes)
+node_modules/.cache/**
+node_modules/**/build/Release/obj.target/**
+node_modules/**/build/Release/.deps/**
+
# Note: @homebridge/node-pty-prebuilt-multiarch/prebuilds/ is INTENTIONALLY
# included so the VSIX contains prebuilds for all target platforms.
# If single-platform is preferred, change to:
# node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/**
```

### `package.json` 的 `files` 白名單 (Optional)

#### [MODIFY] [package.json](file:///Users/bytedance/projects/superset/package.json)

- 加上 `files` 欄位,明確列出要打包的檔案:
  ```json
  "files": [
      "out/**",
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "images/**",
      "node_modules/@homebridge/node-pty-prebuilt-multiarch/**"
  ]
  ```
- 這比 `.vscodeignore` 黑名單更安全(預設不打包未列檔案)
- 但若使用者偏好「`vsce` 預設打包所有 + `.vscodeignore` 黑名單」,可跳過此欄位

### 驗證腳本 (Verification Script)

#### [NEW] [scripts/verify-vsix.sh](file:///Users/bytedance/projects/superset/scripts/verify-vsix.sh)

- 一個 bash 腳本,跑完 `vsce package` 後自動驗證:
  1. `unzip -l <vsix>` 列出所有 `node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/*.node` 檔案
  2. 確認至少包含 `darwin-arm64`、`linux-x64`、`win32-x64` 三種(若選 B 模式)
  3. 確認 `scripts/for_loop.sh` **不**在 VSIX 內
  4. 確認 `src/**`、`test/**` **不**在 VSIX 內
  5. 印出 VSIX 體積,若 > 5MB 警告

#### [MODIFY] [package.json](file:///Users/bytedance/projects/superset/package.json)

- `scripts.build` 改為:
  ```json
  "build": "npm run clean && npm install && tsc && npx @vscode/vsce package && bash scripts/verify-vsix.sh"
  ```

### 文件 (Documentation)

#### [MODIFY] [CLAUDE.md](file:///Users/bytedance/projects/superset/CLAUDE.md)

- 「`node-pty` 整合」段(現有「VSIX 大小影響:約 57 KB」)更新為:
  - 說明 VSIX 現在刻意包含所有平台 prebuild(跨平台使用)
  - 體積預期 ~2-3MB(原 57KB 是 mac-only 假設)
  - 指向 `scripts/verify-vsix.sh` 作為驗證工具

---

## 驗證計劃 (Verification Plan)

### 自動化驗證

- 跑 `npm run build`,確認:
  - `vsce package` 成功產出 `.vsix`
  - `scripts/verify-vsix.sh` 自動跑的 5 個檢查全綠
- 現有 `npm test` 仍 156 個 case 全綠(本 plan 不改 src 或 test)

### 手動驗證

- 在 macOS arm64 跑完 build,解開 VSIX:
  - `unzip -l superset-*.vsix | grep prebuilds` 應該看到 4-6 個平台 prebuild
  - `unzip -l superset-*.vsix | grep -E "test/|src/|for_loop.sh"` 應該**空**
- 把 .vsix 拿到 Linux x64 / Windows 機器的 Extension Development Host 安裝,確認:
  - `Superset: New Terminal` 仍可開 PTY terminal
  - TUI 偵測正常(`vscode.Pseudoterminal` + `node-pty` 整合沒壞)

### CI 整合(本次不做,留作 follow-up)

- 在 GitHub Action 跑 `npm run build` + `scripts/verify-vsix.sh` 作為 release gate
- 失敗時阻擋 marketplace 上傳

## 風險與緩解 (Risks & Mitigations)

| 風險                                    | 緩解                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| 排除規則太嚴,`vsce` 必要檔案被排除     | 跑完 build 後用 `verify-vsix.sh` 自動驗證;失敗時阻擋 commit                       |
| 排除規則太鬆,VSIX 仍含 dev artifacts    | 在 `verify-vsix.sh` 內列**白名單**(必須含的檔案),缺一即 fail                       |
| `node-pty` 升版時 prebuild 結構變了     | `verify-vsix.sh` 動態抓所有 `*.node` 檔案,不寫死平台名                              |
| VSIX 變太大,影響下載體驗                | 預期 ~2-3MB 可接受;若日後需要,改用 `--target` 鎖單一平台                          |
| 既有 release pipeline 受影響            | `package.json` 的 `build` script 是 wrapper,若需要快速 build 可用 `tsc && vsce package` 跳過驗證 |

## 預估工作量 (Effort Estimate)

- `.vscodeignore` 補強:15 分鐘
- `package.json` `files` 欄位:5 分鐘
- `scripts/verify-vsix.sh`:30 分鐘
- `package.json` `build` script 串接:5 分鐘
- `CLAUDE.md` 更新:10 分鐘
- 手動跨平台驗證:30 分鐘
- **總計:約 1.5 小時**

## 後續 (Follow-ups, 非本次範圍)

- **CI release gate**:把 `npm run build` + `verify-vsix.sh` 接到 GitHub Action,阻擋直接 `vsce publish`(避免手殘 ship 損壞的 VSIX)
- **CHANGELOG.md**:補上版本歷史,搭配 `verify-vsix.sh` 在 release 時自動 bump
- **手動 VSCode Marketplace publish 流程文件化**:目前 `package.json:267` 有 `package` script 但沒有 `publish`,要手動 `vsce publish`,補一段 README 段落
- **依賴 audit**:`npm audit` 整合進 CI,確保沒有 high/critical CVE 跟著 prebuild 進 VSIX
