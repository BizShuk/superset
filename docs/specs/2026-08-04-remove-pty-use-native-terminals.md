# 移除 PTY，改用原生 terminal (Remove PTY, Use Native Terminals)

`2026-08-04` — 已實作，版本 `0.23.0`。

## 決策 (Decision)

Superset 不再持有任何 pseudoterminal。所有開啟 terminal 的路徑一律呼叫
`vscode.window.createTerminal`，terminal 的 shell、process tree 與 scrollback
全部由 VSCode workbench 擁有；Superset 只從外部觀察。

## 移除範圍 (What Was Removed)

| 項目 | 說明 |
| --- | --- |
| `src/terminals/ptyTerminalHost.ts` | 541 行 PTY host：write buffer、backpressure watermark、flush budget、kill escalation、`buildShellEnv` |
| `src/terminals/ptyTerminalFactory.ts` | `PtyTerminalFactory`、`createNodePtySpawner`、`Map<Terminal, Host>` 生命週期 |
| `src/terminals/autoReplace.ts#decideAutoReplace` | auto-replace 決策(location / shellPath / hideFromUser / pty gate) |
| `lifecycle.ts#installAutoPtyReplacer` | `onDidOpenTerminal` 時 spawn PTY clone 再於 150ms 後 dispose 原 terminal 的替換流程 |
| `node-pty` dependency 與 `postinstall` | 連同 `scripts/prepare-node-pty.js`(macOS `spawn-helper` executable bit 修復) |
| `superset.terminals.highWaterMark` / `lowWaterMark` | 只對 PTY buffer 有意義的設定 |
| `superset.openTuiTerminal` 命令 | 存在理由只有 PTY 攔截；原生 terminal 下與 `superset.newTerminal` 完全等價 |
| 7 個 PTY 測試檔 | `ptyTerminalHost.*`(4)、`ptyProcessContract`、`ptyTerminalFactory`、`autoReplace` |

## 保留與替代 (What Replaces It)

- `src/terminals/nativeTerminal.ts#createNativeTerminal` 是`唯一`開 terminal 的地方，
  同時供給 terminals 面板命令與 `crossModuleState/terminalSpawner` lease。
- `src/terminals/terminalFilter.ts#shouldTrackTerminal`(原 `autoReplace.ts` 更名)
  保留 agent-owned terminal 排除規則；名稱是現在唯一的排除條件。
- `lifecycle.ts#installTerminalOpenTracker` 只做 `registry.add`，不再檢查
  creation options —— 沒有東西會被替換，也就沒有「能否忠實重建」的問題。
- Activity 偵測不受影響：來源 `A`(process tree 輪詢)與 `B`(shell integration
  execution edge)本來就`零位元組`，不依賴 PTY。TUI 偵測仍由來源 `A` 覆蓋。

## 行為變更 (Behavioral Changes)

- 使用者開的 terminal 不再被 dispose 後重建，terminal 的 location、custom shell、
  其他 extension 提供的 pseudoterminal 全部原樣保留。
- `spawnRunTerminal` 改送 `sendText(cmdline)`，不再附加 `\r`：那個 carriage
  return 是給 PTY `handleInput` 的原始按鍵位元組，原生 terminal 會讀成第二次
  Enter 並留下多餘 prompt。
- VSIX 不含任何 platform prebuild，Linux 安裝不再需要 `node-gyp` toolchain。
  `scripts/verify-vsix.sh` 的第 1 項檢查`反轉`：從「node-pty 必須存在且
  `spawn-helper` 可執行」變成「任何 pty binding 都不得出現」。

## 風險與取捨 (Trade-off)

放棄的是 100% TUI 輸出攔截 —— Superset 再也看不到 terminal 的位元組。實務上
高亮只需要一個 bit(「有沒有我沒看過的動靜」)，來源 `A` 以每輪一次 `ps` 就能
供給，且不讓輸出穿過 extension host 主執行緒；PTY 路徑的成本與輸出量成正比，
正是先前 backpressure、flush budget、kill escalation 這一整套加固要對付的問題。
移除後這些失效模式連同程式碼一起消失。
