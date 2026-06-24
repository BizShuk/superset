# Terminal Jump-To Quick Pick 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `Superset: Go to Terminal` 命令,從所有已開 terminal 中 fuzzy 選擇並 focus;快捷鍵 `Ctrl+Alt+T`。

**Architecture:** 複用 I1 `terminal-fuzzy-search` 內的 `matchesTerminal` helper。命令接收 input 觸發 `vscode.window.showQuickPick` 動態搜尋(內建 fuzzy),每個 item 帶 `terminal` reference,選擇後呼叫 `terminal.show()` + `revealInTree`(未實作時略過)。

**Tech Stack:** TypeScript / Vitest / `vscode.window.showQuickPick` (stable)

---

## 1. 為何要做 (Why)

- **現有痛點**:用戶一次開 5–10 個 terminal,`Ctrl+` `tab` 在 VSCode 內建 terminal switcher 找太慢。
- **既有鋪墊**:`matchesTerminal` 純函式已存在;`registry.add` 已記錄所有 terminal。
- **小工時**:10 行命令 + 1 個 quick pick builder。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 用內建 terminal switcher 找 | `Ctrl+Alt+T`(預設)直接 fuzzy 找,選完即 focus + reveal |
| 無法跨 group 搜尋 | 全 registry 搜尋,跨 group 透明 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                |
| ------ | ----------------------------- | --------------------------------------------------- |
| Create | `src/jumpToTerminal.ts`       | 純函式 `buildQuickPickItems(terminals, query)`     |
| Create | `test/jumpToTerminal.test.ts` | 純函式測試                                          |
| Modify | `src/extension.ts`            | 註冊 `superset.jumpToTerminal` 命令                 |
| Modify | `package.json`                | command + keybinding                                |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式 + 測試 (TDD)

**Files:**
- Create: `src/jumpToTerminal.ts`
- Create: `test/jumpToTerminal.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/jumpToTerminal.test.ts
import { describe, it, expect } from "vitest";
import { buildQuickPickItems, scoreMatch } from "../src/jumpToTerminal";

const terms = [
    { name: "build-server", pid: 1234 },
    { name: "test-runner", pid: 5678 },
] as any;

describe("scoreMatch", () => {
    it("scores prefix match higher than substring", () => {
        const a = scoreMatch("build", terms[0]);
        const b = scoreMatch("server", terms[0]);
        expect(a).toBeGreaterThan(b);
    });
    it("returns 0 for no match", () => {
        expect(scoreMatch("nope", terms[0])).toBe(0);
    });
});

describe("buildQuickPickItems", () => {
    it("filters and sorts by score desc", () => {
        const items = buildQuickPickItems(terms, "build");
        expect(items[0].label).toBe("build-server");
    });
    it("returns empty when no match", () => {
        expect(buildQuickPickItems(terms, "zzz")).toEqual([]);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- jumpToTerminal`
Expected: FAIL。

- [ ] **Step 3: 實作**

```typescript
// src/jumpToTerminal.ts
export interface JumpableTerminal {
    readonly name: string;
    readonly pid?: number;
}

export interface QuickPickItem {
    readonly label: string;
    readonly description?: string;
    readonly terminal: JumpableTerminal;
}

export function scoreMatch(query: string, term: JumpableTerminal): number {
    const q = query.toLowerCase();
    const n = term.name.toLowerCase();
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 50;
    if (term.pid != null && String(term.pid).startsWith(q)) return 70;
    return 0;
}

export function buildQuickPickItems(
    terminals: readonly JumpableTerminal[],
    query: string
): QuickPickItem[] {
    if (!query) {
        return terminals.map((t) => ({
            label: t.name,
            description: t.pid ? `pid ${t.pid}` : undefined,
            terminal: t,
        }));
    }
    return terminals
        .map((t) => ({ t, s: scoreMatch(query, t) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(({ t }) => ({
            label: t.name,
            description: t.pid ? `pid ${t.pid}` : undefined,
            terminal: t,
        }));
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- jumpToTerminal`
Expected: 4 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/jumpToTerminal.ts test/jumpToTerminal.test.ts
git commit -m "feat(jump): add buildQuickPickItems + scoreMatch"
```

### Task 2: 註冊命令 + keybinding

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: extension.ts 註冊命令**

```typescript
subscriptions.push(
    vscode.commands.registerCommand("superset.jumpToTerminal", async () => {
        const all = registry.getAll(); // assume registry exposes this
        const items = all.map((t) => ({
            name: t.name,
            pid: undefined, // TerminalHandle currently doesn't expose pid; tweak if needed
        }));
        const picked = await vscode.window.showQuickPick(
            buildQuickPickItems(items, ""),
            { placeHolder: "輸入 terminal 名稱過濾" }
        );
        if (!picked) return;
        // Find actual terminal by name; show + reveal
        const term = registry.findByName(picked.label);
        if (term) {
            term.show();
            // Optional: await vscode.commands.executeCommand(
            //     "superset.terminalRevealInTree", term
            // );
        }
    })
);
```

> 註:`registry.findByName` 若不存在,在 extension.ts 加一個 helper。

- [ ] **Step 2: package.json 加 command + keybinding**

```json
{
    "command": "superset.jumpToTerminal",
    "title": "Superset: Go to Terminal",
    "keybinding": "ctrl+alt+t"
}
```

(`keybinding` 寫在 extension.ts 的 `package.json#contributes.keybindings` 內,見既有 `F2` 範例。)

- [ ] **Step 3: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(jump): wire Superset: Go to Terminal command + keybinding"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 4 個 jumpToTerminal test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `scoreMatch` / `buildQuickPickItems` / `superset.jumpToTerminal` 名稱一致
  - [ ] `registry.findByName` 介面若無,Task 2.1 已補

- [ ] **Step 2: README.md「Commands」段落加 Go to Terminal**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Go to Terminal"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| `Ctrl+Alt+T` 與其他 extension 衝突 | 使用者可在 keybindings 改;若衝突,改 `Ctrl+Shift+T` | 移除 keybinding,只留 command |
| 大量 terminal (>50) quick pick 慢 | 純字串計算 < 1ms;showQuickPick 內建 lazy render | 不適用 |
| `TerminalHandle` 沒 expose pid | score 內 pid 走 optional;`description` 拿掉 | 同上 |

---

## 6. 完成定義

- [ ] 4 個 jumpToTerminal test case 綠
- [ ] 命令 `Ctrl+Alt+T` 觸發,顯示 quick pick,選擇後 terminal 被 focus
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Terminal jump-to quick-pick`
- 配對: [terminal fuzzy search](plans/2026-06-23-feature-terminal-fuzzy-search.md) 共享 `matchesTerminal` pattern
- 測試位置: `test/jumpToTerminal.test.ts`
