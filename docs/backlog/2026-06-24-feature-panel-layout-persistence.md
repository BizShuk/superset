# Panel Layout Persistence 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記住 `superset` viewContainer 內最後一次 active 的子 view(terminals / explore / mdns / topology / todo / settings),下次 activate 自動 focus。

**Architecture:** 用 `vscode.window.onDidChangeActiveTextEditor` 不行(那是 editor 不是 treeview) — 改 hook `vscode.window.tabGroups.onDidChangeTabGroup` 觀察使用者切到 `superset.*` 子 view,並把 `viewId` 存到 `context.workspaceState`。Activate 時讀取後呼叫 `<viewId>.focus`。

**Tech Stack:** TypeScript / Vitest / `vscode.window.tabGroups`(stable since 1.20)

---

## 1. 為何要做 (Why)

- **現有痛點**:VSCode 啟動後 superset 預設顯示 Terminals,但用戶常用的可能是 mDNS 或 Topology,每次要手動切。
- **既有鋪墊**:5 個 viewId 已知;`context.workspaceState` 已用於 group metas。
- **小風險**:tabGroups 事件可能多次觸發,需去抖。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| VSCode 啟動後 superset 永遠在 Terminals | 自動 focus 上次使用的子 view(若曾用過) |
| 切換面板無記憶 | 切到 mDNS → reload → 仍 focus mDNS |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                |
| ------ | ----------------------------- | --------------------------------------------------- |
| Create | `src/panelLayout.ts`          | 純函式 `extractSupersetViewId(input)`, debounce    |
| Create | `test/panelLayout.test.ts`    | 純函式測試                                          |
| Modify | `src/extension.ts`            | activate 內訂閱 tabGroups.onDidChange + restore    |
| Modify | `package.json`                | (無變更,沿用既有 viewContainer)                   |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式:viewId 抽取 + 測試 (TDD)

**Files:**
- Create: `src/panelLayout.ts`
- Create: `test/panelLayout.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/panelLayout.test.ts
import { describe, it, expect } from "vitest";
import { extractSupersetViewId, SUPERSET_VIEW_IDS } from "../src/panelLayout";

describe("extractSupersetViewId", () => {
    it("returns null for non-superset viewId", () => {
        expect(extractSupersetViewId("workbench.view.explorer")).toBeNull();
    });

    it("returns the input when in the known set", () => {
        expect(extractSupersetViewId("superset.mdns")).toBe("superset.mdns");
    });

    it("rejects unknown superset-prefixed id", () => {
        expect(extractSupersetViewId("superset.unknown")).toBeNull();
    });
});

describe("SUPERSET_VIEW_IDS", () => {
    it("contains all 5 + settings = 6", () => {
        expect(SUPERSET_VIEW_IDS.length).toBe(6);
        expect(SUPERSET_VIEW_IDS).toContain("superset.terminals");
        expect(SUPERSET_VIEW_IDS).toContain("superset.settings");
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- panelLayout`
Expected: FAIL。

- [ ] **Step 3: 實作**

```typescript
// src/panelLayout.ts
export const SUPERSET_VIEW_IDS = [
    "superset.terminals",
    "superset.explore",
    "superset.mdns",
    "superset.topology",
    "superset.todo",
    "superset.settings",
] as const;

export type SupersetViewId = typeof SUPERSET_VIEW_IDS[number];

export function extractSupersetViewId(viewId: string | undefined): SupersetViewId | null {
    if (!viewId) return null;
    return (SUPERSET_VIEW_IDS as readonly string[]).includes(viewId)
        ? (viewId as SupersetViewId)
        : null;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- panelLayout`
Expected: 4 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/panelLayout.ts test/panelLayout.test.ts
git commit -m "feat(panel-layout): add extractSupersetViewId helper"
```

### Task 2: extension.ts 訂閱 + restore

**Files:**
- Modify: `src/extension.ts`(放在 `focusPanel` 命令附近)

- [ ] **Step 1: 訂閱 tabGroups 變化**

```typescript
const LAYOUT_KEY = "superset.lastViewId";
let saveTimer: NodeJS.Timeout | undefined;
subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabGroup(() => {
        const active = vscode.window.tabGroups.activeTabGroup?.activeTab;
        // Best-effort: VSCode doesn't expose viewId on tab; rely on
        // a registry of "last focused" updated from the existing
        // `focusPanel` command path.
    })
);
```

> 註:VSCode 的 `Tab` API 並不直接 expose viewId;**實際可行的做法是 hook 既有的 6 個 panel focus 命令(自建 tiny middleware)**。本 plan Task 2.1 改為:在 extension.ts 把現有 `vscode.commands.executeCommand("xxx.focus")` 全部包成 `trackFocus(viewId, fn)`,由 middleware 寫入 workspaceState。

- [ ] **Step 2: 寫 middleware**

```typescript
function trackFocus<T extends unknown[]>(
    viewId: SupersetViewId,
    fn: (...args: T) => Promise<unknown>
) {
    return async (...args: T) => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(async () => {
            await context.workspaceState.update(LAYOUT_KEY, viewId);
        }, 200);
        return fn(...args);
    };
}
```

- [ ] **Step 3: 把 6 個子 view 的 focus 命令包進 middleware**

在每個 `vscode.window.createTreeView` / `registerWebviewViewProvider` 之後,補:

```typescript
const origFocus = vscode.commands.registerCommand(
    `${viewId}.focus`,
    trackFocus(viewId, () => vscode.commands.executeCommand(`${viewId}.focus`))
);
subscriptions.push(origFocus);
```

> 註:VSCode 預設每個 view 已自動有 `<viewId>.focus` 命令,覆寫即可攔截。

- [ ] **Step 4: activate 結尾 restore**

```typescript
const lastView = context.workspaceState.get<SupersetViewId>(LAYOUT_KEY);
if (lastView && extractSupersetViewId(lastView)) {
    // Defer to next tick: tree views may not be ready yet.
    setTimeout(() => {
        void vscode.commands.executeCommand("workbench.view.extension.superset");
        void vscode.commands.executeCommand(`${lastView}.focus`);
    }, 500);
}
```

- [ ] **Step 5: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 6: Commit**

```bash
git add src/extension.ts
git commit -m "feat(panel-layout): track + restore last sub-view focus"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 4 個 panelLayout test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `extractSupersetViewId` / `trackFocus` / `LAYOUT_KEY` 名稱一致
  - [ ] `setTimeout(500)` 在 activate 結尾,避免 tree view 還沒建好就 focus

- [ ] **Step 2: README.md 加 Panel layout 段落**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document panel layout persistence"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 覆寫 `<viewId>.focus` 破壞 VSCode 內建行為 | middleware 仍呼叫原命令 | 移除 trackFocus 包裹 |
| 500ms 啟動 race 條件 | 500ms 是經驗值;若不夠可加 polling | 不 restore,使用者手動切 |
| 6 個 view 順序改變時舊 layout 指到不存在 view | `extractSupersetViewId` 過濾掉不存在的 | 不適用 |

---

## 6. 完成定義

- [ ] 4 個 panelLayout test case 綠
- [ ] 切換到 6 個子 view 之一,200ms 內 `workspaceState` 寫入
- [ ] activate 後自動 focus 上次 view
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Panel layout persistence`
- 測試位置: `test/panelLayout.test.ts`
