# Terminal Fuzzy Search 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `superset.terminals` TreeView 上方加一個 fuzzy search 輸入框,即時依名稱 / cwd / 進程名稱過濾面板內容。

**Architecture:** 把 search query 視為 `treeProvider` 的「filter state」(不寫入 store,以 `extension.ts` 內的 closure 持有),`getChildren()` 依 query 對 registry + group 做 substring 過濾。比對欄位依序為:terminal name → `processId`(若 `TerminalHandle` expose)→ 從 `Terminal.creationOptions.cwd` 取 cwd。VSCode 沒有原生 TreeView search,需要自繪:用一個 `getChildren` 的 filter,並在 `extension.ts` 用 `vscode.window.createTreeView` 的 message 屬性提示用戶。

**Tech Stack:** TypeScript / Vitest / `vscode.TreeView` (no new deps)

---

## 1. 為何要做 (Why)

- **現有痛點**:終端機一多(>10)就難找;`treeProvider` 已經按 group 排序,但沒有文字篩選。
- **既有鋪墊**:`treeProvider.ts:195` 已 export `buildTreeItemSpec` 純函式,把渲染邏輯與 vscode 解耦;過濾邏輯可以加在 `getChildren` 之前,不動既有渲染。
- **低風險**:UI-only,只在 TreeView 內隱藏節點,不影響 registry / OutputWatcher / PtyTerminalHost 等核心鏈。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 終端機清單依 group 排序,需肉眼掃描 | TreeView 標題列右側新增「🔍 Search」按鈕,點擊後輸入框出現;輸入即時過濾 |
| 無 cwd / pid 線索 | 過濾同時比對 name / cwd / pid,空字串比對全部 |

---

## 3. 檔案異動表 (File Structure)

| 動作       | 檔案                                              | 職責                                          |
| ---------- | ------------------------------------------------- | --------------------------------------------- |
| Modify     | `src/treeProvider.ts`                             | 加 `setFilter(query)` + `getFilter()`,`getChildren` 套用 |
| Create     | `src/treeFilter.ts`                               | 純函式 `matchesTerminal(term, handle, cwd)`,易測 |
| Create     | `test/treeFilter.test.ts`                         | 純函式單元測試                                |
| Modify     | `src/extension.ts`                                | 註冊 `superset.terminalSearch` 命令,持有 query state |
| Modify     | `package.json`                                    | 加 `superset.terminalSearch` command + menu |
| (Optional) | `src/types.ts`                                    | `TerminalHandle` 加 `readonly cwd?: string` (若目前無) |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式比對邏輯 + 測試 (TDD)

**Files:**
- Create: `src/treeFilter.ts`
- Create: `test/treeFilter.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/treeFilter.test.ts
import { describe, it, expect } from "vitest";
import { matchesTerminal } from "../src/treeFilter";

describe("matchesTerminal", () => {
    const handle = { name: "build-server", processId: Promise.resolve(1234) } as any;

    it("returns true when query is empty", () => {
        expect(matchesTerminal("", handle, "/Users/me/proj")).toBe(true);
    });

    it("matches against name case-insensitively", () => {
        expect(matchesTerminal("BUILD", handle, "/x")).toBe(true);
    });

    it("matches against cwd basename", () => {
        expect(matchesTerminal("proj", handle, "/Users/me/proj")).toBe(true);
    });

    it("matches against cwd full path", () => {
        expect(matchesTerminal("me/p", handle, "/Users/me/proj")).toBe(true);
    });

    it("returns false when nothing matches", () => {
        expect(matchesTerminal("nope", handle, "/x")).toBe(false);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- treeFilter`
Expected: FAIL — `matchesTerminal` 還沒定義。

- [ ] **Step 3: 實作純函式**

```typescript
// src/treeFilter.ts
export interface FilterableTerminal {
    readonly name: string;
}

export function matchesTerminal(
    query: string,
    handle: FilterableTerminal,
    cwd: string | undefined
): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if (handle.name.toLowerCase().includes(q)) return true;
    if (cwd && cwd.toLowerCase().includes(q)) return true;
    return false;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- treeFilter`
Expected: PASS — 5 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/treeFilter.ts test/treeFilter.test.ts
git commit -m "feat(tree-filter): add pure matchesTerminal helper"
```

### Task 2: treeProvider 套用 filter

**Files:**
- Modify: `src/treeProvider.ts:1-195`

- [ ] **Step 1: 加 filter 欄位 + setter**

在 `class TerminalTreeProvider` 內:

```typescript
private filter: string = "";

public setFilter(q: string): void {
    if (this.filter === q) return;
    this.filter = q;
    this.refresh();
}

public getFilter(): string {
    return this.filter;
}
```

- [ ] **Step 2: 在 `getChildren` 套用**

找到 `getChildren` 對 terminal 的列舉段落(回傳 `TerminalHandle[]` 的地方),在 return 前加:

```typescript
if (this.filter) {
    return items.filter((t) => matchesTerminal(this.filter, t, /* cwd lookup */ undefined));
}
```

> 註:cwd 來源需透過 `creationOptions.cwd` 取;若無法取得,先以 `name` 比對為主,並在 plan 內留 TODO 在 Task 3 補。

- [ ] **Step 3: 跑既有測試確認沒壞**

Run: `npm test`
Expected: 48 個既有 case 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/treeProvider.ts
git commit -m "feat(tree-provider): apply filter in getChildren"
```

### Task 3: 註冊命令 + menu

**Files:**
- Modify: `src/extension.ts:576-585`(focusView 命令附近)
- Modify: `package.json:25-128`

- [ ] **Step 1: 註冊命令**

在 `extension.ts` 內 `focusView` 命令旁:

```typescript
subscriptions.push(
    vscode.commands.registerCommand("superset.terminalSearch", async () => {
        const q = await vscode.window.showInputBox({
            prompt: "過濾終端機(名稱 / cwd)",
            value: treeProvider.getFilter(),
        });
        if (q === undefined) return; // user cancelled
        treeProvider.setFilter(q);
    })
);
```

- [ ] **Step 2: package.json 加 command + menu**

在 `commands` 陣列內加:

```json
{
    "command": "superset.terminalSearch",
    "title": "Superset: Search Terminals",
    "icon": "$(search)"
}
```

在 `menus.view/title` 內、Terminals section 加:

```json
{
    "command": "superset.terminalSearch",
    "when": "view == superset.terminals",
    "group": "navigation"
}
```

- [ ] **Step 3: build + 跑測試**

Run: `npm run build && npm test`
Expected: build 成功、測試全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(ui): wire Superset: Search Terminals command"
```

### Task 4: README + 自我審查

- [ ] **Step 1: 在 README.md 的「Commands」段落補上新命令**
- [ ] **Step 2: 自我審查 checklist**

  - [ ] 5 個 test case 都對應到一個實作 step
  - [ ] 沒有出現 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `setFilter` / `getFilter` / `matchesTerminal` 在所有 task 名稱一致
  - [ ] `cwd` 沒取得時不 crash(降級為 name-only 比對)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Search Terminals"
```

---

## 5. 風險與 Rollback (Risks)

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 過濾後用戶忘記清空,看不到 terminal | 輸入框 `value: getFilter()` 預填,esc 可關;`superset.terminalClearSearch` 預留命令(本輪不實作) | 刪 `setFilter` 呼叫,過濾 state 變 noop |
| cwd 取不到 (VSCode API 未 expose) | Task 2 已標 TODO,僅比對 name 仍堪用 | 退版 `treeProvider` 內 filter 區塊即可 |
| 大數量 terminal (>100) 過濾慢 | 純字串比對,O(n) 100 個 < 1ms | 改用 prefix tree(超出本 plan) |

---

## 6. 完成定義 (Done When)

- [ ] 6 個 test case 全綠(`treeFilter.test.ts` 5 + 既有 48)
- [ ] `Superset: Search Terminals` 命令可執行、輸入即時過濾
- [ ] 沒有改動 `TerminalRegistry` / `OutputWatcher` / `PtyTerminalHost` 等核心鏈的外部行為
- [ ] README 已更新

---

## 相關連結 (References)

- 觸發來源: [`README.todo`](README.todo) — `[feature] Terminal fuzzy search`
- 既有模組: `src/treeProvider.ts:buildTreeItemSpec` (純函式渲染)
- 測試位置: `test/treeFilter.test.ts` (本 plan 新增)
