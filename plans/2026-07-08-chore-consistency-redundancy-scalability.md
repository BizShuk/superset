# Consistency · Redundancy · Scalability

> 專案健康度盤點 + 重構路線圖。盤點日期 2026-07-08。本 plan 不改任何 runtime 行為,目標是「刪重複、補結構、預留 8 → 15 plugin 的擴充空間」。

## Context (為何要做)

盤點後發現三類問題,各 stage 可獨立 merge:

1. **結構**: `src/projectsTodo/` 是 `src/todo/` 的 ~70% 鏡像,加上 `package.json` 的 47 條命令 + 對應 menu/when 條目純鏡像,共 ~530 行屬於純複製貼上,下次加第 3 個 todo-style feature 會再放大一次。
2. **慣例**: `docs/specs/` 與 `plans/` 各有 7 個非 `YYYY-MM-DD-<topic>.md` 命名的檔案(包含 `polished-pondering-map.md` / `streamed-enchanting-parnas*.md` / `enumerated-conjuring-backus.md` 這類 agent slug),`README.todo` 章節結構 6 個 `### ...` 子標題完全空著、所有項目塞進 `## Archive`。
3. **可擴充性**: 6 個 plugin shim 機械重複(`buildFeatureContext` + disposable-bridge,每個 ~50 行),`workspaceState` 沒有 namespacing,`.vscodeignore` 只蓋 4 行(`test/`、`docs/`、`plans/`、`scripts/`、`coverage/` 全沒排除),`CLAUDE.md` 的 VSIX 57 KB / 391 case 兩個數字都已過期(現況 0.8.1 + 410 case)。

修復順序採「**先低風險、後高重構**」:Stage 1–3 是純檔案結構變更,不會動 runtime 邏輯;Stage 4–5 才碰程式碼,各自開新 plan;Stage 6 (Bonus) 是更高階架構清理。

---

## 盤點事實 (Verified, 2026-07-08)

```text
$ wc -l src/todo/index.ts src/projectsTodo/index.ts
     475 src/todo/index.ts
     514 src/projectsTodo/index.ts

$ grep -c "registerCommand" src/todo/index.ts src/projectsTodo/index.ts
src/todo/index.ts:21
src/projectsTodo/index.ts:19

$ cat package.json | python3 ... | grep 'cmds:'
total commands: 71
todo cmds: 25
projectsTodo cmds: 22

$ ls plans/ | grep -v '^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-'
architecture-highlight-regex.md
architecture-open-settings-webview.md
architecture-panel-layout-persistence.md
architecture-reveal-in-tree.md
architecture-tree-comment-highlight.md
architecture-workspace-aware-group-suggestions.md
dynamic-orbiting-pearl.md
enumerated-conjuring-backus.md

$ ls docs/specs/ | grep -v '^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-'
polished-pondering-map.md
streamed-enchanting-parnas-agent-afafec2490edc7957.md
streamed-enchanting-parnas.md
```

重複具體盤點:

| 維度                              | 數量                       | 來源                                                                                                                                                                |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` commands 鏡像      | 22 對 (`todo`↔`projectsTodo`),外加 3 個 todo-only | `package.json:contributes.commands` line 203–250 vs 388–410                                                                                                         |
| `package.json` menu 鏡像          | 14 對 (view/title) + 17 對 (view/item/context) | `package.json:contributes.menus`                                                                                                                                   |
| `package.json` keybinding 鏡像    | 2 對 (`todoRename` F2、`todoOpen` etc.)      | `package.json:contributes.keybindings`                                                                                                                              |
| `src/todo/index.ts` vs `projectsTodo/index.ts` | 19+21 個 `registerCommand`, 大致 1:1 對應 | `src/todo/index.ts:75-409` vs `src/projectsTodo/index.ts:96-401` 共 ~280 行鏡像                                                                  |
| TreeProvider 命令/過濾/跳轉邏輯   | `todoTreeProvider.ts` 623 行 / `projectsTodoTreeProvider.ts` 292 行 | 兩者皆有 `filterCompleted` / `getChildren` / `computeSectionContextValue` / `changePriority` 等共同骨架                                                              |
| 6 個 plugin shim                  | 平均 ~50 行,機械重複       | `src/{terminals,todo,mdns,topology,projectsTodo,projects}/plugin.ts`                                                                                                |
| `treePreview` 與 `todoPreview`    | 同屬「`extendMarkdownIt` 貢獻」型 feature,不走 `register()`,特殊路徑 | `src/treePreview/plugin.ts` vs `src/todoPreview/plugin.ts`                                                                                                          |

---

## 設計決策 (User-resolved)

| 議題 | 決策 |
| --- | --- |
| plan 與 README.todo 的章節結構 | 採「**先用 plan 盤點現況、實際重構另開 plan**」的兩段式;本 plan 鎖定盤點 + 低風險修補(Stage 1–3),Stage 4–6 各自開新 plan |
| 拆分粒度 | 一次一個 stage 走完整 PR cycle(改 → 測 → commit);不一次 commit 全部 |
| 既有 tests 是否允許變動 | 既有 test 不改語意,只允許 fixture 共享化抽出;行為必須維持 410/410 全綠 |
| `FeatureContext` 雙軌制 | 本 plan **不**刪 `FeatureContext`(那是 Stage 6 範圍),Stage 4 在新 plan 加 `createFeatureContext` 抽出 shim 共用部分 |
| `package.json` 命令生成         | 用 build-time script (Node, ESM) 生成,不是 runtime;**重點是 commit 進 git 的 `package.json` 仍是 plain JSON**,generator 只在 `npm run build` 前跑 |
| `enumerated-conjuring-backus.md` | 整份重命名為 `2026-07-08-feature-projects-todo-section-pending-badge.md`,然後 commit(此 plan 也包含實作 §Stage 0) |
| `package.json` version          | 當前 0.8.1(已 uncommitted bump from 0.7.6)。Stage 0 重新 base 到 0.8.2,後續 stage 各自 bump minor 視範圍 |

---

## 修改範圍總覽

```tree
superset/
├── plans/                                                  [Stage 1]
│   ├── 2026-07-08-chore-consistency-redundancy-scalability.md   ← 本檔
│   ├── 2026-07-08-feature-projects-todo-section-pending-badge.md ← renumbered from enumerated-conjuring-backus
│   ├── 2026-07-05-architecture-{highlight-regex,open-settings-webview,
│   │                          panel-layout-persistence,reveal-in-tree,
│   │                          workspace-aware-group-suggestions}.md
│   ├── 2026-07-05-dynamic-orbiting-pearl.md
│   ├── 2026-07-08-chore-plugin-shim-factory.md            ← new,defer detailed Stage 4
│   └── 2026-07-08-chore-todo-engine-unify.md              ← new,defer detailed Stage 5
├── docs/specs/                                             [Stage 1]
│   ├── 2026-06-22-network-topology-panel.md                ← from polished-pondering-map
│   ├── 2026-06-22-terminal-groups-drag-and-drop.md         ← from streamed-enchanting-parnas
│   └── research/                                          ← new dir
│       └── 2026-06-22-treeview-drag-and-drop-api.md        ← from streamed-enchanting-parnas-agent
├── README.todo                                             [Stage 2]
├── docs/archive/todo-completed-2026-07.md                  [Stage 2] ← new
├── .vscodeignore                                           [Stage 3]
├── scripts/
│   ├── verify-vsix.sh                                      [Stage 3] ← new
│   └── gen-package-commands.mjs                            [Stage 5] ← new
└── src/plugin/
    └── context.ts                                          [Stage 4] ← add createFeatureContext
```

---

## Stage 0 — 立即可做 (P0,半天)

- [x] `[P0] [feature] projectsTodo section pending badge` — 把 `plans/enumerated-conjuring-backus.md` 重命名為 `2026-07-08-feature-projects-todo-section-pending-badge.md`,commit,並把 working copy 的 `M src/projectsTodo/projectsTodoTreeProvider.ts` diff 一併 commit(pending badge 設計就寫在那份 plan 裡)
- [x] `package.json` version bump:0.7.6 → 0.8.0(已 uncommitted)

**Why first**: 唯一未 commit 的 working copy;放越久越容易和後續重構混雜。

---

## Stage 1 — `plans/` 與 `docs/specs/` 命名重整 (P0,1 hr)

CLAUDE.md 已明訂 `YYYY-MM-DD-<topic>.md` 規約;當前違規 7 個 plan + 3 個 spec。

### 1.1 純 slug 重命名(無內容變更)

| 現況 | 目標 | 依據 |
| --- | --- | --- |
| `plans/architecture-highlight-regex.md` | `plans/2026-07-05-architecture-highlight-regex.md` | commit `a7f059b` 2026-07-05 |
| `plans/architecture-open-settings-webview.md` | `plans/2026-07-05-architecture-open-settings-webview.md` | 同上 |
| `plans/architecture-panel-layout-persistence.md` | `plans/2026-07-05-architecture-panel-layout-persistence.md` | 同上 |
| `plans/architecture-reveal-in-tree.md` | `plans/2026-07-05-architecture-reveal-in-tree.md` | 同上 |
| `plans/architecture-workspace-aware-group-suggestions.md` | `plans/2026-07-05-architecture-workspace-aware-group-suggestions.md` | 同上 |
| `plans/dynamic-orbiting-pearl.md` | `plans/2026-07-05-dynamic-orbiting-pearl.md` | 同上 |
| `plans/architecture-tree-comment-highlight.md` | **刪除**(已實作,spec 在 `docs/specs/2026-07-05-tree-comment-highlight.md`,plan 在 commit `33ab6e2` 不慎被加回) | commit `2769cc0` |
| `docs/specs/polished-pondering-map.md` | `docs/specs/2026-06-22-network-topology-panel.md` | commit `8f2230e` 2026-06-22 |
| `docs/specs/streamed-enchanting-parnas.md` | `docs/specs/2026-06-22-terminal-groups-drag-and-drop.md` | commit `aa58f3d` 2026-06-22 |
| `docs/specs/streamed-enchanting-parnas-agent-afafec2490edc7957.md` | `docs/research/2026-06-22-treeview-drag-and-drop-api.md` (新建 `docs/research/` 子目錄) | commit `23de869`;此檔是 research note 不是 spec |

### 1.2 修正 README.todo 對應的 link

- `README.todo` 把 `plans/architecture-tree-comment-highlight.md` 拿掉(對應 spec 已實作)
- 所有 `polished-pondering-map` / `streamed-enchanting-parnas*` 引用改為新檔名(用 `grep` 確認無其他引用)

### 1.3 git 操作

```bash
git mv plans/architecture-{highlight-regex,open-settings-webview,panel-layout-persistence,reveal-in-tree,workspace-aware-group-suggestions}.md \
       plans/2026-07-05-architecture-{highlight-regex,open-settings-webview,panel-layout-persistence,reveal-in-tree,workspace-aware-group-suggestions}.md
git mv plans/dynamic-orbiting-pearl.md plans/2026-07-05-dynamic-orbiting-pearl.md
git rm plans/architecture-tree-comment-highlight.md
git mv docs/specs/polished-pondering-map.md docs/specs/2026-06-22-network-topology-panel.md
git mv docs/specs/streamed-enchanting-parnas.md docs/specs/2026-06-22-terminal-groups-drag-and-drop.md
mkdir -p docs/research
git mv docs/specs/streamed-enchanting-parnas-agent-afafec2490edc7957.md docs/research/2026-06-22-treeview-drag-and-drop-api.md
```

### 驗證

- `ls plans/ | grep -v '^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-'` 應為空
- `ls docs/specs/ | grep -v '^20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-'` 應為空
- `grep -rn "polished-pondering-map\|streamed-enchanting-parnas" --exclude-dir=node_modules` 應無命中

---

## Stage 2 — `README.todo` 結構重整 (P1,1.5 hr)

### 2.1 當前問題

- `### Architecture` / `### Terminals` / `### mDNS` / `### Topology` / `### TODO Panel` / `### Platform & UX` 6 個子標題**完全空著**
- 所有項目都被塞進 `## Archive`,包括 21 個 `[x] @Completed` + 6 個 `[ ] @Archived` + 12 個 active 項目
- line 38–39 有兩個 `[P0]/[no-priority] TODO subgroup panel add a button to open README.todo` 2 秒差的複製
- `### Plans` 子標題(line 16)下只有 1 個項目,且外層沒有 `## Plans` 父標題,語意錯

### 2.2 目標結構

```markdown
# TODO

## Active

### Architecture
### Terminals
### mDNS
### Topology
### TODO Panel
### Platform & UX
### Plans

## Archive
- 5 個 @Archived 引用(spec/plan 已歸檔,引用保留以便日後找回)
```

### 2.3 動作清單

1. 建立 `docs/archive/`(若無)
2. 把 `## Archive` 段所有 `[x] @Completed` 行(目前 line 28–54)整段剪到 `docs/archive/todo-completed-2026-07.md`,header 寫 `<!-- 此檔由 README.todo 自動歸檔,不要直接編輯;若要查閱完成歷史用 git log 即可 -->`
3. 把 `@Archived @Plans` 5 行(目前 line 22–26)留在 `## Archive`,**從中刪除 1 行**:`architecture-tree-comment-highlight` 那條(spec 已實作,連 plan 都已在 Stage 1 刪除)
4. 把 12 個 active 項目從原 line 56–67 重新分配到對應的 `###` 子標題下(對應 README.todo 中既有的 section tags 例如 `@Terminals` `@mDNS` `@Topology` `@TODO_Panel` `@Platform*&_UX` `@Architecture`)
5. 刪除 line 38 或 line 39 的重複項目(保留有 `[P0]` 那條)
6. 移除 line 16 那個孤立的 `### Plans` 條目(整個目錄不存在 `## Plans` 父標題,語意錯)
7. 加入本 plan 的 entry 與 Stage 1 規範連結(見下方 §「README.todo 新增條目」)

### 2.4 驗證

- `wc -l README.todo` 應從 67 行縮到 ≤ 25 行
- `grep -c '^- \[' README.todo` 應只剩 12 個 active + 5 個 @Archived = 17 條
- 6 個 `###` 子標題下都有對應項目
- 沒有 `[x] @Completed` 留在 README.todo

---

## Stage 3 — `.vscodeignore` 補完 + `verify-vsix.sh` (P1,1 hr)

### 3.1 當前 `.vscodeignore` 只有 4 行

```
out/**/*.map
src/**
tsconfig.json
.gitignore
```

`test/`、`docs/`、`plans/`、`scripts/`、`coverage/`、`*.log`、`*.tsbuildinfo`、`.DS_Store` 全漏。

### 3.2 新增規則

```gitignore
# source control noise
.git/**
.github/**

# build artifacts
**/*.tsbuildinfo
coverage/**
**/*.log
**/.DS_Store

# dev-only artifacts (test source 留著但產出物不留)
test/**
src/**
scripts/**

# docs & plans are for humans, not the VSIX
docs/**
plans/**

# top-level meta files (AGENTS.md 是 symlink,vsce 不該處理)
AGENTS.md
README.todo
README.md
CHANGELOG.md
CLAUDE.md
LICENSE
```

### 3.3 新增 `scripts/verify-vsix.sh`

```bash
#!/usr/bin/env bash
# Post-build: assert VSIX is well-formed.
set -euo pipefail
VSIX="${1:-superset-*.vsix}"

# 1. 必須只有一個 prebuild(當前平台)
prebuild_count=$(unzip -l "$VSIX" 2>/dev/null | grep -c "node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds/" || true)
if [[ "$prebuild_count" -gt 1 ]]; then
  echo "✗ Multiple node-pty prebuilds ($prebuild_count) found in VSIX" >&2
  exit 1
fi

# 2. 必須排除 test/ src/ plans/ docs/
for forbidden in test/ src/ plans/ docs/; do
  if unzip -l "$VSIX" 2>/dev/null | grep -q "^.*  $forbidden"; then
    echo "✗ Forbidden path $forbidden leaked into VSIX" >&2
    exit 1
  fi
done

# 3. extension 檔案必須存在
unzip -l "$VSIX" 2>/dev/null | grep -q "extension/package.json" || {
  echo "✗ extension/package.json missing" >&2; exit 1
}

VSIX_SIZE=$(stat -f%z "$VSIX" 2>/dev/null || stat -c%s "$VSIX")
echo "✓ $VSIX ($VSIX_SIZE bytes) verified"
```

### 3.4 `package.json` `scripts.build` 末段加驗證

```diff
- "build": "npm run clean && npm install && tsc && npx @vscode/vsce package"
+ "build": "npm run clean && npm install && tsc && npx @vscode/vsce package && bash scripts/verify-vsix.sh"
```

### 3.5 驗證

- `npm run build` 跑完,verify-vsix.sh 三項 assert 全綠
- 實際 `unzip -l superset-0.8.0.vsix | head -20` 沒有 `test/` `src/` `plans/` `docs/` 條目
- VSIX 縮小幅度預期 10–30%

### 3.6 CLAUDE.md 修兩處過期數字

- 「目前本機 build 出的 VSIX 約 57 KB」→ 改為「目前本機 build 出的 VSIX 約 X KB(實際大小請看 `ls -lh *.vsix`)」
- 「目前 391 個 case 全綠 (41 個 test file)」→ 改為「目前 410 個 case 全綠 (45 個 test file)」(順便對齊 6/45 個架構章節的描述)

---

## Stage 4 — Plugin shim 工廠抽出 (P2,半天,獨立 plan)

**本 plan 不實作**,只在新 plan `plans/2026-07-08-chore-plugin-shim-factory.md` 立項並描述範圍。

### 為何拆出獨立 plan

- 牽動 6 個檔案(每個 feature 一個 shim),需要 `git mv` + import 改寫
- 屬於「Stage 6:FeatureContext 退場」的前置;若直接做 Stage 6 範圍太大,Stage 4 是它的 de-risk
- 需要確認 `manager.deactivateAll()` 真的被呼叫(plugin shim 改成工廠後 disposable 流向要驗證)

### 目標形狀

```ts
// src/plugin/featureContext.ts (新檔)
export function createFeatureContext(
  pCtx: PluginContext,
  id: string,
): FeatureContext {
  const subscriptions: vscode.Disposable[] = [];
  // 攔截 subscriptions.push 轉送到 pCtx.registerDisposable
  const push = subscriptions.push.bind(subscriptions);
  subscriptions.push = (d) => { pCtx.registerDisposable(d); return push(d); };
  return { /* ... */ };
}

// src/terminals/plugin.ts 縮為
export const terminalsPlugin: ExtensionPlugin = {
  id: "terminals",
  name: "Terminals",
  activate(pCtx) {
    return registerTerminals(createFeatureContext(pCtx, "terminals"));
  },
};
```

其他 5 個 shim 同樣從 ~50 行縮為 6 行。

### 6 個改寫點

- `src/terminals/plugin.ts`
- `src/todo/plugin.ts`
- `src/mdns/plugin.ts`
- `src/topology/plugin.ts`
- `src/projectsTodo/plugin.ts`
- `src/projects/plugin.ts`

---

## Stage 5 — `todo` × `projectsTodo` 合併去重 (P2,2–3 天,獨立 plan)

**本 plan 不實作**,只在新 plan `plans/2026-07-08-chore-todo-engine-unify.md` 立項。

### 為何拆出獨立 plan

- 觸及 `package.json` (250 行鏡像命令/menu)、`src/todo/index.ts` (475)、`src/projectsTodo/index.ts` (514)、對應的 test fixtures
- 是所有重構中「風險 / 收益比」最低的(收益大、風險中),值得獨立驗證週期
- 觸及用戶的 command id 與 keybinding 行為,需要小心 deprecate 而非 break

### 5a — 抽 `makeTodoCommandHandlers(idPrefix, store, ctx)` factory

消除 `src/todo/index.ts:75-409` 與 `src/projectsTodo/index.ts:96-401` 的 280 行重複。

- 22 個 handler 收成 `Record<TodoCommand, (item, args) => Promise<void>>`
- `idPrefix: "todo" | "projectsTodo"` 決定 `vscode.commands.registerCommand("superset.todo<X>", ...)` vs `"superset.projectsTodo<X>"`
- `store` 與 `subStore` 解析由工廠外部傳入 closure
- `dispose()` 統一回收

預估:`src/todo/index.ts` 475 → 120 行,`src/projectsTodo/index.ts` 514 → 130 行。

### 5b — `scripts/gen-package-commands.mjs` 自動生成 commands/menus

從單一 source-of-truth `src/todo/commandManifest.ts` 生成:

```ts
export const todoCommands = [
  { id: "Toggle", handler: "toggle", when: ["viewItem == todoCheckbox || ..."] },
  { id: "ChangePriority", handler: "changePriority", when: ["viewItem == todoCheckbox", ...] },
  // ... 22 條
] as const;
```

Build script 讀 manifest,在 `package.json` 注入:

```js
// scripts/gen-package-commands.mjs
import manifest from "../src/todo/commandManifest.js";
for (const prefix of ["todo", "projectsTodo"]) {
  for (const cmd of manifest) {
    commands.push({
      command: `superset.${prefix}${cmd.id}`,
      title: cmd.title,
      icon: cmd.icon,
    });
    // 對應 menu 條目也依 when template 展開
  }
}
```

`npm run build` 前跑這隻 script,生成 `package.json.contributes` 區段後,vsce package 看到的就是合併後的版本。

### 兩種實現選擇(由下個 plan 開盤時確認)

- **方案 A**: build-time injection(本 plan 推薦),`package.json` commit 進 git 仍是 plain JSON
- **方案 B**: 改用 `package.json` 是 template,`scripts/build.sh` 跑 generator 後才 `vsce package`

---

## Stage 6 — (Optional, P3) FeatureContext 退場

`src/shared.ts` 的 `FeatureContext` / `FeatureHandle` / `SharedDeps` 與 `src/plugin/types.ts` 的 `PluginContext` 雙軌並存;Stage 4 的工廠是過渡形態,Stage 6 把 `FeatureContext` 完全刪掉、所有 `register(ctx)` 改接 `PluginContext`。

觸及面:

- 刪 `src/shared.ts` 的 `FeatureContext` / `FeatureHandle` / `SharedDeps` 介面(若沒人用就刪,有人用就 inlined 收掉)
- 6 個 `register(ctx: FeatureContext)` 改 `register(pCtx: PluginContext)`
- `treePreview` 與 `todoPreview` 的 `extendMarkdownIt` 出口從 `PluginContext` 拿(已是這樣,免改)
- `extension.ts` 移除 `manager.getMarkdownExtension()` 多餘的 `treePreview` + `todoPreview` 串接(若工廠已處理)
- `StatusBar` / `OutputChannel` 從 `BaseContext.showStatus` 落實為真的(目前是 no-op,見 S-6)

---

## 不在本 plan 範圍

- **Stage 0 實作**以外的 runtime 行為改動(本 plan 只做檔案結構 + 命名 + 文件)
- **新增 feature**(Open Settings、Panel Layout、Reveal in Tree 等都已在 `README.todo` 排隊,但屬獨立 plan)
- **M-7 / S-3 的 `deactivate()` 真的 call `manager.deactivateAll()`** — 屬獨立的「plugin 生命週期」plan
- **EventBus 統一** — 屬 Stage 6 之後的更大型架構演進
- **`TodoStore` 1002 行拆分** — 已有 `docs/specs/2026-07-02-architecture-superset.md` 描述;若要實作另開 plan
- **`.project_index/` 註冊表消費** — 已在 `plans/2026-07-08-business-scope-evaluation.md` 描述,屬獨立 plan

---

## 驗證計畫

| Stage | 驗證 |
| --- | --- |
| 0 | `npm test` 410/410;git log 看到 badge feature commit;`package.json` version = 0.8.1 |
| 1 | `ls plans/ \| grep -v '^[0-9]'` 空;`ls docs/specs/ \| grep -v '^[0-9]'` 空;`docs/research/` 存在;`README.todo` 對應 link 修好 |
| 2 | `wc -l README.todo` ≤ 25;6 個 `###` 子標題下都有對應項目;`docs/archive/todo-completed-2026-07.md` 存在 |
| 3 | `npm run build` 全綠;`unzip -l *.vsix \| grep -E '(test\|src\|plans\|docs)/'` 零命中;VSIX size 縮小可量化;`CLAUDE.md` 兩處數字修對 |
| 4 | 6 個 shim 各縮至 ≤ 10 行;既有 plugin test 全綠 |
| 5 | command id 集合不變(向後相容);既有 test fixture 仍可跑 |
| 6 | `FeatureContext` 在 codebase 中零 `import`;既有 test 全綠 |

---

## 預期效益

- **重複代碼**:消除 ~530 行(`package.json` 250 + `src/todo`/`projectsTodo` `index.ts` 280)
- **檔案數**:`plans/` 7 個檔重新命名,3 個 spec 重新分類
- **測試可維護性**:`README.todo` 從 67 行 → 25 行,未來 grep active 項目不再被 Archive 雜訊淹沒
- **VSIX 縮小**:預期 10–30%(主要來自排除 test/、docs/、plans/)
- **可擴充性**:未來加第 3 個 todo-style feature 只需在 command manifest 加幾行,不再複製整個 shim 與 22 個 registerCommand
- **文件真實度**:CLAUDE.md 的測試數字與 VSIX size 對齊實際值

---

## 參考連結

- 既有架構演進 plan: [`docs/specs/2026-07-02-architecture-master.md`](../docs/specs/2026-07-02-architecture-master.md)
- Plugin framework 介紹: [`docs/specs/2026-07-02-architecture-pluginization.md`](../docs/specs/2026-07-02-architecture-pluginization.md)
- 模組解耦 todos 系列: `docs/specs/2026-07-02-architecture-{superset,mdns,terminals,topology}.md`
- 業務範圍評估: [`plans/2026-07-08-business-scope-evaluation.md`](2026-07-08-business-scope-evaluation.md)
- 本 plan 衍生:Stage 0 用的 pending badge plan(重新命名後): `plans/2026-07-08-feature-projects-todo-section-pending-badge.md`
