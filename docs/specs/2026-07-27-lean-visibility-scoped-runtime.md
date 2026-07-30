# Lean Visibility-Scoped Runtime 實作計畫

> `Agentic worker requirement`：使用 `executing-plans` 與
> `test-driven-development`；依序執行每個 task，並保留 unrelated
> dirty-worktree changes。

`Goal`：移除可避免的 hidden-panel work，讓重複的 Sessions refreshes
採 incremental 方式，並在不改變 visible feature behavior 的前提下恢復乾淨的 test baseline。

`Architecture`：background work 依循 Tree View visibility。terminal
provider 保持 event subscriptions active，但只在 visible 時執行 rename-refresh timer。
Sessions feature 擁有一個可重用的 `SessionStore`；store 依 file metadata
cache parsed append-only JSONL records，而 provider 負責 watcher lifecycle，且只在 visible 時 watch。

`Tech stack`：TypeScript、VS Code Extension API、Node.js filesystem APIs、
Vitest。

## 全域限制 (Global Constraints)

- 保持 `panelLayoutPlugin` 位於 activation order 最後。
- 保持 terminal activity sources `A` 與 `B` active；只有 Tree View
  rename-refresh timer 採 visibility-scoped。
- Sessions 保持 read-only，`sample-*.jsonl` 除外。
- 保留既有 `autop` Default Tools edits 與所有 unrelated dirty
  worktree changes。
- 使用 `cmd+alt+v`；VS Code keybinding JSON 接受 `Alt`，不接受 `Opt`，作為
  modifier token。
- 不新增 dependency。

---

### Task 1：恢復 manifest contract baseline

`Files`：

- Modify: `test/packageManifest.test.ts`

`Interfaces`：

- Consumes：`package.json#contributes.keybindings`
- Produces：符合 accepted VS Code keybinding token 的 contract test

- [x] `Step 1`：重現 focused failure。

執行：

```bash
npx vitest run test/packageManifest.test.ts
```

預期：Editor Layout case 會失敗，因為 test 預期
`cmd+opt+v`，而 manifest 包含 `cmd+alt+v`。

- [x] `Step 2`：替換兩個 stale expectations。

```typescript
expect(cycle?.key).toBe("cmd+alt+v");
expect(cycle?.mac).toBe("cmd+alt+v");
```

- [x] `Step 3`：驗證 focused contract。

執行：

```bash
npx vitest run test/packageManifest.test.ts
```

預期：所有 manifest tests 通過。

### Task 2：View hidden 時暫停 terminal rename polling

`Files`：

- Create: `test/terminalTreeProvider.lifecycle.test.ts`
- Modify: `src/terminals/treeProvider.ts`
- Modify: `src/terminals/index.ts`

`Interfaces`：

- Consumes：`TreeView.visible` 與
  `TreeView.onDidChangeVisibility(listener)`
- Produces：`TerminalTreeProvider.setVisible(visible: boolean): void`

- [x] `Step 1`：使用 fake timers 新增 failing lifecycle test。

Test 會 subscribe `onDidChangeTreeData`、start provider，在 hidden 狀態前進
three seconds，再切換 visibility：

```typescript
provider.start();
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(0);

provider.setVisible(true);
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(1);

provider.setVisible(false);
vi.advanceTimersByTime(3_000);
expect(refreshes).toHaveLength(1);
```

- [x] `Step 2`：執行 focused test，確認 API 缺失。

執行：

```bash
npx vitest run test/terminalTreeProvider.lifecycle.test.ts
```

預期：失敗，因為 `setVisible` 不存在，且 hidden polling 仍會執行。

- [x] `Step 3`：加入 visibility-owned timer synchronization。

`TerminalTreeProvider` 在 `start()` 保持 registry 與 group subscriptions，
但將 timer setup 移入：

```typescript
setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.syncRefreshTimer();
}
```

`syncRefreshTimer()` 先清除 existing timer，只有在 provider started、visible，且
configured interval 為 positive 時才建立新的 interval。

- [x] `Step 4`：將 provider 接到 actual Tree View。

在 `createTreeView` 後立即執行：

```typescript
treeProvider.setVisible(treeView.visible);
```

在 visibility listener 開頭執行：

```typescript
treeProvider.setVisible(visible);
```

- [x] `Step 5`：驗證 focused terminal tests。

執行：

```bash
npx vitest run test/terminalTreeProvider.lifecycle.test.ts test/treeProvider.test.ts test/terminalsPlugin.test.ts
```

預期：所有 focused tests 通過。

### Task 3：Cache Sessions records，並將 watcher 限定於 visibility

`Files`：

- Modify: `src/sessions/store.ts`
- Modify: `src/sessions/sessionsTreeProvider.ts`
- Modify: `src/sessions/index.ts`
- Modify: `test/sessionsStore.test.ts`
- Modify: `test/sessionsTreeProvider.test.ts`

`Interfaces`：

- Consumes：
  `parseSessionJsonl(text, filePath, sizeBytes, mtimeMs): SessionRecord`
- Produces：
  `SessionStore.listSessionProjects(workspacePath): SessionProject[]`
- Produces：
  `SessionStore.readSession(filePath): SessionRecord | undefined`
- Produces：
  `SessionStore.deleteSession(filePath): boolean`
- Produces：
  `SessionsTreeProvider.setVisible(visible: boolean): void`

- [x] `Step 1`：新增 failing cache regression test。

使用 parser spy 建立 `SessionStore`，對同一個 unchanged file list
兩次，append 一個 turn，再次 list：

```typescript
const parser = vi.fn(parseSessionJsonl);
const store = new SessionStore(() => root, parser);

const first = store.listSessionProjects(workspace);
const second = store.listSessionProjects(workspace);
expect(parser).toHaveBeenCalledTimes(1);
expect(second[0].sessions[0]).toBe(first[0].sessions[0]);

appendFileSync(filePath, jsonl(turn(2)));
const third = store.listSessionProjects(workspace);
expect(parser).toHaveBeenCalledTimes(2);
expect(third[0].sessions[0].turns).toHaveLength(2);
```

- [x] `Step 2`：新增 failing deletion-boundary test。

```typescript
expect(store.deleteSession(ingestedFile)).toBe(false);
expect(existsSync(ingestedFile)).toBe(true);
expect(store.deleteSession(sampleFile)).toBe(true);
expect(existsSync(sampleFile)).toBe(false);
```

- [x] `Step 3`：新增 failing provider visibility test。

在 visibility 之前，provider 尚未 scan store。第一次 visible
transition 時載入 projects；隱藏後釋放 watcher，但保留已載入的 snapshot：

```typescript
expect(provider.getChildren()).toEqual([{ kind: "empty" }]);
provider.setVisible(true);
expect(provider.getChildren()[0].kind).toBe("project");
provider.setVisible(false);
expect(provider.getChildren()[0].kind).toBe("project");
```

- [x] `Step 4`：執行 focused tests，確認 new contracts 失敗。

執行：

```bash
npx vitest run test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts
```

預期：失敗，因為 `SessionStore` 與 provider visibility lifecycle 尚不存在。

- [x] `Step 5`：實作 reusable store cache。

每個 cache entry 包含：

```typescript
interface CachedSession {
    readonly sizeBytes: number;
    readonly mtimeMs: number;
    readonly record: SessionRecord;
}
```

`readSessionFile` 先執行 `statSync`，只有兩個 metadata values 都相符時才重用 entry，
否則讀取並 parse JSONL。Directory scans 會淘汰已不存在的 cached files。
`deleteSession` 拒絕任何不符合 `sample-*.jsonl` 的 basename。

- [x] `Step 6`：給 provider 明確的 start/stop visibility lifecycle。

`setVisible(true)` 呼叫 `start()`；`setVisible(false)` 呼叫 `stop()`。
`start()` 只載入一次並以 idempotent 方式啟動 watcher。`stop()` 只 dispose
watcher；`dispose()` 也會 dispose event emitter。

- [x] `Step 7`：讓 tree 與 summary rendering 共用一個 store。

在 `src/sessions/index.ts` 建立一個 `SessionStore(dataDirOverride)`，
傳給 `SessionsTreeProvider`，供 content provider 與 delete command 使用，並連接 initial/current Tree View visibility。

- [x] `Step 8`：驗證 focused Sessions tests。

執行：

```bash
npx vitest run test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts test/sessionsOpenSummary.test.ts
```

預期：所有 focused tests 通過。

### Task 4：集中處理 Tree View visibility

`Files`：

- Create: `src/plugin/viewVisibility.ts`
- Create: `test/viewVisibility.test.ts`
- Modify: `src/terminals/index.ts`
- Modify: `src/sessions/index.ts`
- Modify: `src/mdns/index.ts`
- Modify: `src/topology/index.ts`
- Modify: `src/todo/index.ts`
- Modify: `src/projectsTodo/index.ts`

`Interfaces`：

- Consumes：
  `TreeView.onDidChangeVisibility(Event<TreeViewVisibilityChangeEvent>)`
- Produces：
  `registerViewVisibility(view, viewId, onVisibilityChange?): Disposable`

- [x] `Step 1`：新增 failing helper contract test。

Test 傳入 fake hidden view、捕捉 registered listener，並斷言 initial visibility
會抵達 lifecycle callback，而只有後續 `{ visible: true }` event 會回報 active view：

```typescript
const registration = registerViewVisibility(
    view,
    "superset.test",
    onVisibilityChange
);

expect(onVisibilityChange).toHaveBeenCalledWith(false);
listener({ visible: false });
expect(executeCommand).not.toHaveBeenCalled();
listener({ visible: true });
expect(executeCommand).toHaveBeenCalledWith(
    "superset.reportViewVisible",
    "superset.test"
);
registration.dispose();
```

- [x] `Step 2`：執行 focused test，確認 helper 缺失。

執行：

```bash
npx vitest run test/viewVisibility.test.ts
```

預期：失敗，因為 `src/plugin/viewVisibility.ts` 不存在。

- [x] `Step 3`：實作 shared helper。

Helper 先呼叫一次 `onVisibilityChange(view.visible)`，再從每個 VS Code event
destructure 出 `{ visible }`。它將每個 boolean transition forward 給 optional lifecycle callback，
並只在 `true` 時執行 `superset.reportViewVisible`。

- [x] `Step 4`：替換全部七個 duplicated callbacks。

`Terminals` 與 `Sessions` 傳入其 provider 的 `setVisible` method。其他
views 使用 two-argument form。這會移除所有錯誤將 `TreeViewVisibilityChangeEvent` 本身
當成 boolean 的 callbacks。

- [x] `Step 5`：驗證 helper 與 activation contracts。

執行：

```bash
npx vitest run test/viewVisibility.test.ts test/extensionActivate.test.ts test/terminalTreeProvider.lifecycle.test.ts test/sessionsTreeProvider.test.ts
npx tsc --noEmit
```

預期：所有 focused tests 通過，且 TypeScript exits `0`。

### Task 5：記錄 runtime contract 並驗證 release artifact

`Files`：

- Create: `docs/specs/2026-07-27-visibility-scoped-runtime-work.md`
- Modify: `CLAUDE.md`
- Modify: `docs/terminology.md`
- Modify: `.vscodeignore`
- Modify: `scripts/verify-vsix.sh`
- Modify: `package.json`
- Modify: `package-lock.json`

`Interfaces`：

- Consumes：current highest release tag 與既有 concurrent Default
  Tools manifest edits
- Produces：synchronized package versions 與 durable performance invariant

- [x] `Step 1`：記錄 measured baseline 與 implemented boundaries。

Spec 記錄：

- hidden `Terminals` 只停止 3-second rename tick；
- hidden `Sessions` 釋放其 recursive watcher；
- unchanged Sessions JSONL records 重用 parsed objects；
- ingestion records 仍無法透過 `deleteSession` 刪除；
- 沒有移除 runtime dependency，因為兩個 direct dependencies 都有使用。

- [x] `Step 2`：在 `CLAUDE.md` 加入 concise invariant。

新增 maintenance-contract bullet，說明 Tree View-only polling 與
watching 必須 visibility-scoped，而 functional terminal activity
tracking 維持 always on。

- [x] `Step 3`：同步 internal terminology。

在 Plugin architecture 下新增 `View Visibility Boundary`，在 Sessions 下新增 `Session Record
Cache`，並各自附上 implementation source。

- [x] `Step 4`：同步下一個 release version。

最高的 existing tag 是 `v0.22.4`；將 package 與 lockfile root
versions 設為 `0.22.5`，保留已完成的 `autop` 與 lockfile changes。

- [x] `Step 5`：新增 failing lean-package verification。

擴充 `scripts/verify-vsix.sh`，拒絕 workspace-only metadata、native
`.pdb` debug symbols、known extraneous packages，以及沒有對應 `src/*.ts` source 的 compiled `out/*.js` files。

- [x] `Step 6`：證明目前 VSIX 違反 new boundary。

執行：

```bash
bash scripts/verify-vsix.sh superset-0.22.5.vsix
```

預期：失敗，因為 pre-change artifact 包含 repo metadata 與 stale compiled modules。

- [x] `Step 7`：清理 stale output 並排除 non-runtime payload。

更新 `npm run clean`，在 compilation 前移除 `out/`。擴充
`.vscodeignore`，加入 exact workspace metadata、`.pdb`、node-pty source/test
payload，以及 `npm ls --depth=0` 回報的兩個 extraneous packages。
保留所有 platform prebuild 與必要的 `pkg/resources` files。

- [x] `Step 8`：rebuild 並記錄 package-size evidence。

執行：

```bash
npm run build
unzip -l superset-0.22.5.vsix | tail -1
```

預期：verifier 通過，file count 與 archive size 低於 pre-change 的
`558 files / 15.46 MB`，且兩個 Darwin spawn helpers 仍為 executable。

- [x] `Step 9`：執行 focused 與 full verification。

執行：

```bash
npm test
npx tsc --noEmit
npm run build
git diff --check
```

預期：zero failed tests、TypeScript exit `0`、build/VSIX verification exit
`0`，且沒有 whitespace errors。

- [x] `Step 10`：檢查 ownership 與 scope。

執行：

```bash
git status --short
git diff --stat
git diff -- src/terminals src/sessions test/packageManifest.test.ts test/terminalTreeProvider.lifecycle.test.ts test/sessionsStore.test.ts test/sessionsTreeProvider.test.ts docs/specs/2026-07-27-visibility-scoped-runtime-work.md CLAUDE.md package.json package-lock.json
```

預期：user-owned `autop` edits 仍存在，且每個 runtime change 都由 focused test 與 dated spec 覆蓋。
