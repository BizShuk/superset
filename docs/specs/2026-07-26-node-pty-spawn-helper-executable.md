# node-pty macOS spawn-helper 可執行權限

## 狀態

已實作。落地於 v0.22.1。

## 問題

`Superset: Install Default Project` 透過 `spawnRunTerminal` 建立 PTY-backed
terminal，再執行內建安裝器。`node-pty@1.1.0` 的 macOS prebuild 將
`spawn-helper` 以 `0644` 安裝，現有 `superset-0.22.0.vsix` 也保留相同模式。

macOS 無法執行 helper，`node-pty.spawn()` 因而同步拋出
`posix_spawnp failed`。原本的 `PtyTerminalHost.open()` 沒有處理這個例外：
`opened` 已設為 `true`，但 process 與 exit callback 都沒有建立，結果是 VS Code
留下永遠不會完成的空白 terminal。

## 修正

### 安裝與打包

根 `package.json#postinstall` 執行 `scripts/prepare-node-pty.js`。腳本在
POSIX build host 上找出 `node_modules/node-pty/prebuilds/darwin-*` 的所有
`spawn-helper`，補上 executable bits。若 node-pty 走 source build，也處理
`build/Release/spawn-helper`。

這個步驟不只處理 build host 架構：在 Linux GitHub Actions 打包時，也會同時
把 `darwin-x64` 與 `darwin-arm64` helper 設為 executable，讓單一 VSIX 可在
兩種 macOS 架構啟動 PTY。

`scripts/verify-vsix.sh` 的 node-pty 檢查同步更新：

- 必須包含 upstream `extension/node_modules/node-pty/`
- 不得包含舊 `@homebridge/node-pty-prebuilt-multiarch`
- `darwin-x64/spawn-helper` 與 `darwin-arm64/spawn-helper` 必須存在
- 兩個 VSIX entry 的 POSIX mode 都必須以 `-rwx` 開頭

### Runtime 失敗路徑

`PtyTerminalHost.open()` 將 `deps.spawn()` 包在 `try/catch`。若 native binding、
helper 權限或 shell path 造成同步 spawn 失敗：

1. 記錄 `[pty] spawn ERROR`
2. 將 host 設為 disposed，清除 process 與 backpressure 狀態
3. 將具體錯誤送進 terminal output
4. 由 factory 顯示 VS Code error message
5. 觸發 `onDidClose(1)`

失敗後再次收到 stray `open()` 也不會重生 shell。

## 根因驗證

在原始 `node_modules` 與 v0.22.0 VSIX 中：

```text
-rw-r--r-- node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
-rw-r--r-- extension/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
```

直接以同一依賴建立 `/bin/zsh -i` PTY，會同步得到：

```text
Error: posix_spawnp failed.
```

將 arm64 helper 改為 `0755` 後，以真實 node-pty 執行
`install-default-project.sh`，三份 ignore files、標準資料夾與
`AGENTS.md -> CLAUDE.md` 均建立成功，process 以 exit code `0` 結束。

upstream `node-pty` 已在 `v1.2.0-beta.4` 納入
`ensure spawn-helper is executable for macos prebuilds` 修正；本專案仍維持
既有 stable `^1.1.0` binding，直到 upstream stable release 可安全升級。

## 測試契約

- `test/ptyTerminalHost.lifecycle.test.ts`：spawn throw 時輸出錯誤、回報、
  close code `1`，且不可再 spawn。
- `test/ptyTerminalFactory.test.ts`：factory 將 spawn failure 顯示到 VS Code UI。
- `scripts/verify-vsix.sh`：拒絕 macOS helper 缺失或沒有 executable mode 的 VSIX。
