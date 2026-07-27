# Security Hardening

## 狀態

已實作於 `0.22.9`。本規格記錄 2026-07-27 security review 後建立的執行
邊界、資源上限、生命週期、診斷資料與 Release supply-chain 契約。

## Threat Model

Superset 會接收同網段裝置送出的 mDNS records，也會把部分服務轉成
`Connect Action`。區網來源不能視為可信；攻擊者可控制 instance name、
host、port、TXT、address、record 數量與廣播頻率。

主要風險：

- 將 mDNS 字串直接串進 shell，造成 command injection。
- 以大量或持續 records 讓 pending/store/TXT/array 無限成長。
- coalesce debounce 被連續封包永久延後，pending 永不釋放。
- plugin activation/deactivation 不完整，留下 command、timer 或 singleton。
- diagnostic log 保存 command text、token 或 terminal output。
- Release build job 長時間持有 write token，或使用 mutable/unlocked tooling。

## mDNS Connect Boundary

`src/mdnsConnect.ts#resolveConnectCommand` 是 mDNS service 到執行意圖的唯一
pure boundary，結果為 discriminated union：

| `kind` | 支援 type | 執行路徑 |
| --- | --- | --- |
| `external` | `_http._tcp`、`_https._tcp`、`_ipp._tcp`、`_ipps._tcp` | `vscode.env.openExternal(vscode.Uri.parse(uri, true))` |
| `terminal` | `_ssh._tcp`、`_sftp._tcp` | 固定 `cmd: "ssh"` 與 validated `args` |

所有 action 先驗證：

- port 必須是 `1..65535` 的整數；
- target 必須是有效 IPv4、IPv6 或 DNS hostname；
- DNS target 先用 `domainToASCII` 正規化，拒絕 control/whitespace 與非法 label；
- SSH user 必須符合固定 allowlist，拒絕 leading option 與 shell metacharacter。

external URI 不進 shell。terminal action 由
`src/shellCommand.ts#joinShellCommand` 在最後邊界逐一 single-quote argument；
無法驗證或不支援的 service 回傳 `null`，UI 只顯示 warning。

## mDNS Resource Limits

所有 network-controlled collection 的上限集中在 `src/mdns/limits.ts`：

| 資源 | 上限 |
| --- | ---: |
| 每個 packet 處理的 records | `256` |
| pending services | `512` |
| stored services | `512` |
| DNS name | `255` UTF-8 bytes，每個 label `63` bytes |
| aliases / addresses / subtypes | 每類 `32` |
| TXT entries | `64` |
| TXT key / value | `128` / `1024` UTF-8 bytes |
| advertised TTL | `4500` seconds |

其他契約：

- coalesce 使用 first-valid-record 起算的固定 `250 ms` window；後續封包不得
  重設 timer。
- `stop()` 取消 timer 並清空 pending，restart 不得提交舊 records。
- store 到達容量時移除 insertion order 最舊的 service，並同步清除
  network-key indexes 與 detail cache。
- parser 拒絕 overlong DNS fields、invalid port/IP、control characters、
  oversized TXT 與 prototype-sensitive TXT keys。
- aliases、addresses、subtypes、TXT 與 reverse network-key index 在 merge
  後仍須保持上限。
- `ttl <= 0` 使用既有 `120` 秒 fallback；過大 TTL 夾到 `4500` 秒。

## Lifecycle Boundary

`src/extension.ts` 持有唯一 active `PluginManager` 與 diagnostic channel。
重新 activate 前先 await `deactivate()`；deactivate 反向停止 plugins，清除
manager、Tree View registry、diagnostic channel 與 terminal spawner
singleton，並 dispose Output Channel。

plugin 在 activation 中途 throw 時，`PluginManager` 立即 dispose 該 plugin
已註冊的 partial disposables，再移除 context/reset state。失敗 plugin
不能留下 command、watcher 或 timer。

terminal spawner 使用 lease cleanup：舊 plugin 的 delayed dispose 只有在
singleton 仍指向自己時才能清除，不能抹掉新 activation 已註冊的 spawner。

## Diagnostic Data Boundary

Shell Integration activity reason 只保留：

- `shell: started`
- `shell: finished`
- optional `exit=<code>`

reason 不含 command line。legacy `OutputWatcher` 只記 lifecycle 與 UTF-8 byte
count，不記 terminal name、command text、output chunk 或 thrown error payload。
實際 output 仍傳給 watcher consumer，僅禁止複製到 diagnostic channel。

## Release Supply Chain

`.github/workflows/release.yml` 分成 `build` 與 `release`：

| Job | Permission | 職責 |
| --- | --- | --- |
| `build` | `contents: read` | tag/version contract、clean build、tests、VSIX verifier、artifact upload |
| `release` | `contents: write` | 下載 verified artifact、固定命名為 `superset.vsix`、建立 GitHub Release |

Workflow 預設 permission 是 `contents: read`，checkout 使用
`persist-credentials: false`。`checkout`、`setup-node`、`upload-artifact`、
`download-artifact` 都固定到完整 commit SHA；兩個 job 只透過 retention
`1 day` 的 `superset-vsix` artifact 交接。

`npm run build` 使用 `npm ci`，打包器 `@vscode/vsce@3.9.2` 是 exact
devDependency 並寫入 lockfile；build 不再用未固定版本的 `npx` 下載工具。

## Verification

| 檢查 | 結果 |
| --- | --- |
| `npm test` | `91` files、`982` tests 通過 |
| `npm run build` | TypeScript compile、VSIX package、artifact verifier 通過；`233` files、`2,932,371` bytes |
| `npm audit --json` | `0` vulnerabilities |
| repository shell scripts 的 `shellcheck` | `0` findings |
| Release workflow | YAML parse 通過；四個 pinned SHAs 與各 upstream `refs/tags/v4` 相符 |
| `git diff --check` | 通過 |

`vsce` 仍提示 extension 有 `158` 個 compiled JavaScript files，未經 bundling。
這是既有 packaging performance 建議，不是本次安全邊界的失敗；runtime native
dependency 與 lean VSIX 契約仍由 `scripts/verify-vsix.sh` 驗證。

## Regression Contracts

安全行為由下列 focused tests 固定：

- `test/mdnsConnect.test.ts`、`test/shellCommand.test.ts`
- `test/mdnsRegistry.test.ts`、`test/mdnsStore.test.ts`
- `test/mdnsParser.test.ts`、`test/mdnsDedup.test.ts`
- `test/mdnsRegistry.expiration.test.ts`
- `test/pluginManager.test.ts`、`test/extensionActivate.test.ts`
- `test/installCommands.test.ts`
- `test/shellIntegrationActivitySource.test.ts`
- `test/shellExecutionSource.test.ts`
- `test/releaseWorkflow.test.ts`

完整交付仍以 `npm test`、`npm run build`、`npm audit`、
`scripts/verify-vsix.sh` 與 `git diff --check` 為準。
