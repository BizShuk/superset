# Visibility-Scoped Runtime Work

## 背景

這次審查聚焦在 extension host 的 idle work、Sessions JSONL 重複解析與
Tree View lifecycle。既有 terminal activity source `A` / `B` 是功能資料
來源，不屬於 UI-only work，因此保持常駐；只有在畫面隱藏後沒有使用價值的
polling / watcher 會暫停。

## 審查結論

| 發現 | 原行為 | 新契約 |
| --- | --- | --- |
| Terminal rename refresh | `Terminals` 隱藏時仍每 `3 秒`刷新整棵 Tree View | timer 只在 provider started 且 View visible 時存在 |
| Sessions watcher | extension activation 立即遞迴監看整個 Session Store Root | `Sessions View` visible 時才 scan / watch，隱藏時釋放 watcher |
| Sessions JSONL parse | 每次 watcher refresh 重讀並 parse 所有 session files | `SessionStore` 依 `size + mtime` 重用 unchanged `Session Record` |
| View visibility event | 各 feature 重複 callback，並把 event object 當 boolean | `registerViewVisibility` 單點解構 `{ visible }` |
| Session deletion | 舊 filesystem helper 可刪除任意 session file | `deleteSession` 內部只接受 `sample-*.jsonl` |
| Editor Layout test | test 使用 VS Code 不接受的 `opt` modifier token | contract 對齊 manifest 的 `cmd+alt+v` |
| VSIX payload | stale `out/`、repo metadata、native debug symbols 被打包 | clean compile + `.vscodeignore` + artifact verification |

## 結構

```tree
src/plugin/viewVisibility.ts
└── registerViewVisibility
    ├── 初始 visible → feature lifecycle callback
    ├── visibility event → boolean lifecycle callback
    └── visible=true → superset.reportViewVisible

src/sessions/store.ts
└── SessionStore
    ├── project / session discovery
    ├── Session Record Cache
    ├── summary read
    ├── Sample Prefix Gate
    └── Store Watcher factory
```

`SessionsTreeProvider` 只擁有 Tree View snapshot、emitter 與 watcher
lifecycle；filesystem、cache 與 delete boundary 都由同一個
`SessionStore` 擁有。Tree View 與 virtual Markdown summary 共用該 store，
避免兩條 read path 各自建立 cache。

## Cache 契約

- `sessiond` JSONL 是 append-only；append 一定改變 file size。
- cache hit 必須同時符合 `sizeBytes` 與 `mtimeMs`。
- stat / read / parse 任一步失敗時移除該 cache entry。
- directory scan 會移除已不存在的 cached file，避免長期累積 stale entry。
- data root 改變時清空整個 cache。
- `Reset Caches` 先清空 `SessionStore`，再重新載入 Tree View 與 open summary。

## Visibility 契約

- `registerViewVisibility` 是所有已啟用 Tree View 的 visibility event
  唯一接線點。
- helper 必須解構 `TreeViewVisibilityChangeEvent.visible`；event object
  本身不可當成 boolean。
- `TerminalTreeProvider` 隱藏時只停止 rename tick；registry subscriptions、
  activity source `A` / `B`、PTY lifecycle 與 unseen state 仍保持運作。
- `SessionsTreeProvider` 隱藏時停止 watcher，但保留最後一次 snapshot 與
  parsed cache；再次顯示時先同步 reload 再重新監看。
- mDNS / Topology / TODO domain lifecycle 本次不改變；它們只共用正確的
  panel-layout visibility reporting。

## 效能證據

本機 microbenchmark 使用 `200` 個 session files、每檔 `150` turns，
連續執行 `10` 次 project refresh：

| 路徑 | 總時間 | 平均 refresh |
| --- | ---: | ---: |
| 修改前：每次全部 read + parse | `158.2 ms` | `15.8 ms` |
| 修改後：首次 cold load | `19.2 ms` | 不適用 |
| 修改後：cache warm 的 10 次 refresh | `9.0 ms` | `0.9 ms` |

warm refresh 在這組本機 workload 約減少 `94%`。這是同一台機器上的
microbenchmark，用來驗證 cache 方向；不是跨硬體的容量或 latency 保證。

## Lean VSIX

`npm run clean` 原本只刪除 `.vsix`，TypeScript 已移除的 source 仍會留下
舊 `out/*.js` 並被後續版本持續打包。本次改為 compile 前移除整個 generated
`out/`，且 `verify-vsix.sh` 逐一確認 packaged JavaScript 有對應 source。

`.vscodeignore` 另外排除：

- workspace-only `.codegraphy/`、`.codex/`、`.githooks/`、`.vscode/` 與
  local runner files；
- `node-pty` source / test / build metadata，但保留 `lib/` 與所有
  `prebuilds/`；
- Windows `.pdb` native debug symbols，不移除 `.node`、`.dll`、`.exe`；
- `npm ls --depth=0` 明確標為 extraneous 的 `@emnapi/wasi-threads` 與
  `tslib`。

| Artifact | 修改前 | 修改後 | 變化 |
| --- | ---: | ---: | ---: |
| Files | `558` | `231` | `-58.6%` |
| VSIX archive | `15.46 MB` | `2.79 MB` | `-81.9%` |
| Uncompressed payload | `66,107,385 bytes` | `6,668,849 bytes` | `-89.9%` |

`scripts/verify-vsix.sh` 仍驗證 Darwin x64 / arm64 `spawn-helper` executable
mode、production `node-pty` 與所有 `pkg/resources`。

`vsce` 仍會建議把 `129` 個 compiled modules bundle 成較少檔案。這需要新增
bundler、把 `node-pty` 設為 native external，並重新驗證 source maps 與所有
activation paths；本次不以未量測的啟動時間假設交換既有 native packaging
可靠性。

## Dependency Hygiene

| Dependency | Verdict | 證據 |
| --- | --- | --- |
| `multicast-dns` | keep | `src/mdns/mdnsTransport.ts` 的 runtime transport |
| `node-pty` | keep | `src/terminals/ptyTerminalFactory.ts` 的 runtime PTY binding |
| `@types/multicast-dns` | keep | runtime package 的 TypeScript declarations |
| `@types/node` / `@types/vscode` | keep | Node.js 與 VS Code compile contracts |
| `typescript` / `vitest` | keep | compiler 與 test runner |

沒有新增 dependency，也沒有安全可移除的 direct dependency。工作目錄曾出現的
`@emnapi/wasi-threads` / `tslib` 是 install tree extraneous state，不是
`package.json` direct dependency；它們不加入 manifest，也由
`.vscodeignore` 阻止進入 release artifact。
