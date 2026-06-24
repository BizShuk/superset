# Reveal in Tree 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任何 `TerminalHandle`(或未來的其他 panel 節點)觸發 `superset.revealInTree` 時,自動 focus 對應的 `TreeView` 並 scroll/reveal 該 row。

**Architecture:** 用 stable API `vscode.commands.executeCommand("revealInTreeView", { viewId, item })`(自 VSCode 1.47 起 stable)。包一個共用 helper `revealInView(viewId, predicate)` 從 `vscode.window.visibleTreeViews` 找到目標 view、迭代 `dataProvider.getChildren()` 找出匹配 `predicate` 的 `TreeItem`、呼叫 stable command。對 `terminals` / `mDNS` / `topology` / `todo` 全部 panel 都生效。

**Tech Stack:** TypeScript / Vitest

---

## 1. 為何要做 (Why)

- **現有痛點**:用戶從 status bar 看到「unseen」想跳到 terminal 需手動展開 panel + 找;在 mDNS 看到「printer」想跳到 topology 對應節點也無路徑。
- **既有鋪墊**:5 個 panel 都已 `vscode.window.createTreeView(...)`,`viewId` 已知;stable `revealInTreeView` 命令在 1.47+ 可用。
- **低成本**:30 行 helper + 4 個命令註冊(每 panel 一個),全 codebase 跨模組受益。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 從 status bar 點 unseen 跳到 panel 後還要肉眼找 | 自動 reveal + 選中該 row;該 panel 還沒 focus 時先 focus |
| 從 mDNS service 想跳到對應 topology 節點無路徑 | `superset.mdnsRevealInTopology` 自動展開 topology tree 並 highlight |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                      |
| ------ | ----------------------------- | --------------------------------------------------------- |
| Create | `src/revealInTree.ts`         | 純函式 `findTreeItemByPredicate(provider, predicate)`     |
| Create | `test/revealInTree.test.ts`   | 純函式單元測試                                            |
| Modify | `src/extension.ts`            | 註冊 4 個 `superset.*Reveal` 命令,共用 helper            |
| Modify | `package.json`                | 加 commands + context menu                                |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式 + 測試 (TDD)

**Files:**
- Create: `src/revealInTree.ts`
- Create: `test/revealInTree.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/revealInTree.test.ts
import { describe, it, expect } from "vitest";
import { findTreeItemByPredicate } from "../src/revealInTree";

interface FakeItem {
    readonly id: string;
    readonly children?: readonly FakeItem[];
}

function makeProvider(items: readonly FakeItem[]) {
    return {
        getChildren: (el?: FakeItem) =>
            el ? el.children ?? [] : items,
    } as any;
}

describe("findTreeItemByPredicate", () => {
    it("returns null when no match", () => {
        const p = makeProvider([{ id: "a" }]);
        expect(findTreeItemByPredicate(p, (i) => i.id === "z")).toBeNull();
    });

    it("returns top-level match", () => {
        const p = makeProvider([{ id: "a" }, { id: "b" }]);
        expect(findTreeItemByPredicate(p, (i) => i.id === "b")?.id).toBe("b");
    });

    it("recurses into children", () => {
        const p = makeProvider([
            { id: "a", children: [{ id: "a1" }, { id: "a2" }] },
        ]);
        expect(findTreeItemByPredicate(p, (i) => i.id === "a2")?.id).toBe("a2");
    });

    it("returns first match (depth-first)", () => {
        const p = makeProvider([
            { id: "a", children: [{ id: "b" }] },
            { id: "b" },
        ]);
        expect(findTreeItemByPredicate(p, (i) => i.id === "b")?.id).toBe("b");
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- revealInTree`
Expected: FAIL — 還沒定義。

- [ ] **Step 3: 實作**

```typescript
// src/revealInTree.ts
export interface TreeNodeLike<T> {
    readonly children?: readonly T[] | undefined;
}

export interface TreeProvider<T extends TreeNodeLike<T>> {
    getChildren(element?: T): readonly T[] | Thenable<readonly T[]>;
}

export async function findTreeItemByPredicate<T extends TreeNodeLike<T>>(
    provider: TreeProvider<T>,
    predicate: (item: T) => boolean
): Promise<T | null> {
    const roots = await provider.getChildren(undefined);
    for (const root of roots) {
        const hit = await walk(root, predicate);
        if (hit) return hit;
    }
    return null;
}

async function walk<T extends TreeNodeLike<T>>(
    node: T,
    predicate: (item: T) => boolean
): Promise<T | null> {
    if (predicate(node)) return node;
    const kids = await node.children;
    if (!kids) return null;
    for (const k of kids) {
        const hit = await walk(k, predicate);
        if (hit) return hit;
    }
    return null;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- revealInTree`
Expected: 4 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/revealInTree.ts test/revealInTree.test.ts
git commit -m "feat(reveal): add findTreeItemByPredicate pure helper"
```

### Task 2: extension.ts 接 reveal 命令

**Files:**
- Modify: `src/extension.ts`(在 focusView 旁)
- Modify: `package.json`

- [ ] **Step 1: extension.ts 註冊 4 個 reveal 命令**

```typescript
async function revealInPanel(viewId: string, item: unknown) {
    if (!item) return;
    await vscode.commands.executeCommand("workbench.view.extension.superset");
    await vscode.commands.executeCommand(`${viewId}.focus`);
    await vscode.commands.executeCommand("revealInTreeView", { viewId, item });
}

subscriptions.push(
    vscode.commands.registerCommand("superset.terminalRevealInTree", (t) =>
        revealInPanel("superset.terminals", t)
    )
);
// similar for superset.mdnsRevealInTree, superset.topologyRevealInTree,
// superset.todoRevealInTree — each takes a panel-specific item.
```

- [ ] **Step 2: package.json 加 commands**

```json
{ "command": "superset.terminalRevealInTree", "title": "Superset: Reveal Terminal in Tree" }
```
(3 個 panel reveal 命令同樣方式加。)

- [ ] **Step 3: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(reveal): wire revealInTree for 4 panels"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 4 個 test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `findTreeItemByPredicate` / `revealInPanel` 名稱一致
  - [ ] `revealInTreeView` 確認在 `engines.vscode` 1.85+ 內穩定(查 VSCode API docs)

- [ ] **Step 2: README.md「Commands」段落加 reveal 命令說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Reveal in Tree commands"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 找不到匹配 item 跳出去什麼都不做 | helper 回傳 `null` 時 silent 跳過 | 改用 `vscode.window.showWarningMessage` 提示 |
| `revealInTreeView` 在 1.85 沒有(僅 1.90+) | Task 3 自我審查會查;若無,把 `engines.vscode` 升級到 1.90+(已在 I1 baseline plan 內) | 退回 manual reveal 邏輯 |
| 跨 panel 跳轉需要 type identity | 用 `predicate` 抽象掉,無需改既有 type | 不適用 |

---

## 6. 完成定義

- [ ] 4 個 `revealInTree` test case 全綠
- [ ] 4 個 panel 都有 `superset.*RevealInTree` 命令
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Superset: Reveal in Tree`
- 既有模組: 5 個 `vscode.window.createTreeView(...)`(terminals/explore/mdns/topology/todo)
- 測試位置: `test/revealInTree.test.ts`
