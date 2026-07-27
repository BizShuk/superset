# Extension Host 關窗清理

## 狀態

已實作。source version 為 `v0.22.4`。

## 現場症狀

關閉 `iphone_sync` 視窗後，Antigravity 的 `window [8]` renderer 已不存在，
但其 extension host `PID 57920` 當時仍持續存活。現場檢查確認：

| 證據 | 觀察 |
| --- | --- |
| process mapping | `57920` 仍是 `extension-host [8]`，沒有對應 renderer |
| open file | 仍寫入 `window8/exthost/exthost.log` 與 `4-Superset.log` |
| open socket | 仍持有 `UDP *:5353` |
| terminal error | 每約 `3,000 ms` 記錄 `Unable to refresh tree view superset.terminals: Canceled` |
| mDNS error | 網路封包抵達時仍嘗試 refresh 已取消的 `superset.mdns` TreeView |

`TerminalTreeProvider` 的固定 refresh interval 正是 `3,000 ms`；
`MulticastDnsTransport` 的 socket 也只有呼叫 `stop()` 才會 `destroy()`。
這兩個時間與 handle 都和現場狀態相符。

## 根因

根 `src/extension.ts` 的 `deactivate()` 是空函式，且其註解錯誤假設
VS Code 會透過 `ExtensionContext.subscriptions` 自動釋放 plugin resource。

實際 ownership 是：

```text
feature disposable
└── PluginContext.registerDisposable()
    └── PluginManager.disposables
        └── 只有 PluginManager.deactivateAll() 會 dispose
```

因此視窗關閉時沒有任何路徑會停止 manager-owned resource：

- `TerminalTreeProvider` 的 3 秒 refresh timer
- mDNS expiration timer 與 UDP/5353 transport
- terminal activity source、PTY host、status item 與 VS Code event subscription
- TODO / Projects TODO / Sessions filesystem watcher
- commands、TreeView 與 TreeView registry entry

另有兩個同源缺口：

- `Sessions` 只回傳 aggregate `FeatureHandle`，但未將它放進 plugin pool；
  即使 root 開始呼叫 `deactivateAll()`，其 watcher 與 commands 仍不會被處理。
- plugin 若在 `activate()` 中途失敗，因為尚未加入 `activePlugins`，
  原本的 `deactivateAll()` 也永遠不會看到先前已註冊的部分資源。

## 修正

| 模組 | 行為 |
| --- | --- |
| `src/extension.ts` | 保存 active runtime；`deactivate()` 等待 in-flight activation，await `manager.deactivateAll()`，最後清掉 singleton reference 並 dispose diagnostic channel |
| `src/plugin/manager.ts` | plugin 啟用失敗時立即 best-effort deactivate 並 dispose 部分資源；正常 teardown 保持反向 plugin 順序且 idempotent |
| `src/sessions/index.ts` | 將 aggregate handle 放進 `ctx.subscriptions` bridge，使 watcher、commands、TreeView 與 content provider 進入 manager pool |
| `src/terminals/treeProvider.ts` | 3 秒 maintenance interval 呼叫 `unref()`，不讓該 timer 單獨 pin 住 Node event loop |
| `src/mdns/expiration.ts` | 5 秒 expiration interval 呼叫 `unref()`；UDP transport 仍由正式 teardown 關閉 |
| cross-module state | teardown 清掉 diagnostic channel、plugin manager、TreeView registry 與 terminal spawner reference |

`unref()` 不是 teardown 的替代品。mDNS UDP socket、filesystem watcher、
PTY child process 等 handle 仍會保持 host 存活，因此 authoritative path
仍是 root `deactivate()` → `PluginManager.deactivateAll()`。

## 生命週期契約

- `activate()` / `deactivate()` 可重入；新 activation 必須先等前一輪 teardown。
- shutdown 若與 activation 重疊，先等 activation settle，再反向清理已啟用 plugin。
- `deactivate()` 可重複呼叫；同一 runtime 的 resource 只 dispose 一次。
- failed plugin 不得留到整體 shutdown 才清理，因為它不在 `activePlugins`。
- module-level reference 必須在 feature teardown 後清空，避免下一個 window reload
  取得上一輪的 manager、TreeView provider 或 PTY factory。
- 新增長週期 timer 時必須同時提供 clear/stop ownership 與 `unref()` 防線。

## 版本

修正前 `package.json` 為 `0.22.1`，repository 已有 `v0.22.2` 與
`v0.22.3` tag；為保持 release version 單調遞增，本次 package version
直接更新為 `0.22.4`。

## 驗證

| 步驟 | 結果 |
| --- | --- |
| TypeScript | `npx tsc --noEmit`：通過 |
| lifecycle targeted tests | `22/22` 通過 |
| full tests | 單 worker、`30s` timeout：`87 files / 940 tests` 全部通過 |
| VSIX build / verifier | `superset-0.22.4.vsix`，`16,101,550 bytes`；verifier 通過 |
| packaged code | VSIX 內 `extension/out/extension.js` 包含 root `deactivateAll()` 呼叫 |
| local install | Antigravity CLI 確認 `shuk.superset@0.22.4` |
| orphan `PID 57920` cleanup | 精確核對 PID、parent、start time 與 UDP/5353 後送 `SIGTERM`；正常退出，未使用 `SIGKILL` |

既有 `PID 57920` 載入的是舊版程式碼，source patch 不會反向觸發其
`deactivate()`，因此已另外終止該確認沒有 renderer 的 orphan process。
目前仍開啟的 Antigravity window 要在下次 reload 後才會載入已安裝的
`0.22.4`；安裝流程沒有強制 reload，以免中斷未儲存工作。
