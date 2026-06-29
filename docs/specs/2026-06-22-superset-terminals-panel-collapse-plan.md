# Superset 側欄可收合 Panel 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `superset.terminals` 從 VSCode 內建 TreeView 改為自繪 WebviewView,讓整個 view 區塊可收合,摺疊狀態持久化到 `context.workspaceState`,並預留多 section 容器介面供後續 mDNS view 掛載。

**Architecture:** 三層分離:**資料層**(`TerminalRegistry` + `GroupStore` + 新增 `PanelStore`)只持有純狀態,透過既有 `onDidChange` 訂閱對外發事件;**協議層**(`panelProtocol.ts`)定義 host ↔ webview 的 JSON message 介面,`buildTreeSnapshot()` 純函式把 registry + groupStore 投影成可序列化 snapshot;**渲染層**(`media/panel.html` + `panel.js` + `panel.css`)在 webview 內重畫 tree,點擊列透過 `postMessage` 觸發 host 端命令。`PanelViewProvider` (vscode-bound) 沿用 DI 注入 store,只做 wiring,業務邏輯全部抽到純函式供 Vitest 測試。

**Tech Stack:** TypeScript 5.4 (strict)、Vitest 1.x、`vscode` engine `^1.85.0`(WebviewView 為穩定 API)、HTML/CSS/Vanilla JS(無前端框架)。

---

## 範圍與前提 (Scope & Prerequisites)

- 既有 48 個 test cases 必須全綠 (regression)
- 新增約 30 個 test cases
- 本輪結束時總計約 78 個 test cases 全綠
- 不動 `TerminalRegistry`、`GroupStore`、`OutputWatcher`、`PtyTerminalHost`、`HighlightPresenter`、`autoReplace` 的內部邏輯
- `extension.ts` 是組裝層;本輪結束時 `createTreeView('superset.terminals', ...)` 整段被 `registerWebviewViewProvider` 取代
- 工作目錄:`/Users/bytedance/projects/superset`
- 所有指令在該目錄下執行
- 對應 spec:`plans/2026-06-22-superset-terminals-panel-collapse.md`

---

## 檔案結構 (File Structure)

| 檔案 | 狀態 | 職責 |
|---|---|---|
| `src/types.ts` | 修改 | 加 `TerminalId` 別名 + `TerminalEntry` + `PanelSectionId` 型別 |
| `src/terminalRegistry.ts` | 修改 | `Entry` 加 `id: string`,`add()` 反射讀 `processId`;加 `getEntryByTerminal()` / `getById()` |
| `src/panelStore.ts` | **新增** | Side panel 視窗級 section 收合狀態,持久化到 `workspaceState` |
| `src/panelProtocol.ts` | **新增** | message 介面 + `buildTreeSnapshot` + `renderTree` + `routeWebviewMessage` 純函式 |
| `src/panelView.ts` | **新增** | `PanelViewProvider` (vscode-bound) |
| `src/treeProvider.ts` | **刪除** | `TerminalTreeProvider` class 與 `isGroup` guard |
| `src/extension.ts` | 修改 | 組裝:把 `createTreeView` 換成 `registerWebviewViewProvider`;加 `superset.toggleTerminalsCollapsed` 命令 |
| `media/panel.html` | **新增** | webview 入口,僅含 CSP 與外部 script/css 引用 |
| `media/panel.js` | **新增** | render + event handler + HTML5 drag-and-drop |
| `media/panel.css` | **新增** | 樣式 |
| `package.json` | 修改 | `views.superset.terminals` 加 `type: "webview"`;`menus.view/title` 加 toggle button |
| `test/panelStore.test.ts` | **新增** | PanelStore 純狀態 + workspaceState mock |
| `test/buildTreeSnapshot.test.ts` | **新增** | buildTreeSnapshot 純函式 |
| `test/panelProtocol.test.ts` | **新增** | 訊息路由 |
| `test/renderTree.test.ts` | **新增** | 純函式 renderTree(snapshot) → HTML 字串 |
| `test/terminalRegistry.test.ts` | 修改 | 加 id 欄位相關 case |
| `test/treeProvider.test.ts` | **刪除** | 隨 src/treeProvider.ts 一起移除 |

---

## Task 1: 擴充 `TerminalHandle` 與 `TerminalRegistry` 支援 stable id

**Files:**
- Modify: `src/types.ts`
- Modify: `src/terminalRegistry.ts`
- Modify: `test/terminalRegistry.test.ts`

> 為什麼先做:`buildTreeSnapshot` 與 `PanelViewProvider` 的 message 都需要 `terminalId` 字串,registry 是唯一擁有 `vscode.Terminal` 物件的地方,id 必須從 registry 開始。

- [ ] **Step 1: 寫 failing test**

修改 `test/terminalRegistry.test.ts`,在既有 describe 區塊尾端加:

```typescript
it("assigns a stable string id on add()", () => {
    const r = new TerminalRegistry();
    const t = { name: "bash", show: () => {}, dispose: () => {} } as any;
    r.add(t);
    const all = r.getAll();
    expect(typeof all[0].id).toBe("string");
    expect(all[0].id.length).toBeGreaterThan(0);
});

it("keeps the same id across markUnseen", () => {
    const r = new TerminalRegistry();
    const t = { name: "bash", show: () => {}, dispose: () => {} } as any;
    r.add(t);
    const idBefore = r.getAll()[0].id;
    r.markUnseen(t);
    const idAfter = r.getAll()[0].id;
    expect(idAfter).toBe(idBefore);
});

it("different terminals get different ids", () => {
    const r = new TerminalRegistry();
    const a = { name: "a", show: () => {}, dispose: () => {} } as any;
    const b = { name: "b", show: () => {}, dispose: () => {} } as any;
    r.add(a);
    r.add(b);
    const ids = r.getAll().map((e) => e.id);
    expect(ids[0]).not.toBe(ids[1]);
});
```

> 註:`getAll()` 本計畫改回傳 `TerminalEntry[]`(`{ id, terminal, hasUnseenOutput }`),下游改取 `.terminal` 與 `.id`。詳細改法見 Step 4。

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/bytedance/projects/superset
npm test -- terminalRegistry
```

預期:新 case 失敗(因為 `id` 尚未存在)。

- [ ] **Step 3: 修改 `src/types.ts`**

在檔案尾端加:

```typescript
export type TerminalId = string;

export interface TerminalEntry {
    readonly id: TerminalId;
    readonly terminal: TerminalHandle;
    readonly hasUnseenOutput: boolean;
}
```

- [ ] **Step 4: 修改 `src/terminalRegistry.ts`**

把 `interface Entry` 與 imports 改為:

```typescript
import type {
    RegistryChange,
    RegistryListener,
    TerminalHandle,
    TerminalId,
    TerminalEntry,
} from "./types";

interface Entry {
    id: TerminalId;
    terminal: TerminalHandle;
    hasUnseenOutput: boolean;
}
```

`add()` 改為:

```typescript
add(terminal: TerminalHandle): void {
    if (this.entries.has(terminal)) {
        return;
    }
    const procId = (terminal as unknown as { processId?: number }).processId;
    const id: TerminalId =
        procId !== undefined
            ? String(procId)
            : `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.entries.set(terminal, { id, terminal, hasUnseenOutput: false });
    this.emit({ type: "added", terminal });
}
```

`getAll()` 改回傳 `TerminalEntry[]`:

```typescript
getAll(): TerminalEntry[] {
    return Array.from(this.entries.values()).map((e) => ({
        id: e.id,
        terminal: e.terminal,
        hasUnseenOutput: e.hasUnseenOutput,
    }));
}
```

`getUnseen()` 改回傳 `TerminalEntry[]`:

```typescript
getUnseen(): TerminalEntry[] {
    const result: TerminalEntry[] = [];
    for (const e of this.entries.values()) {
        if (e.hasUnseenOutput) {
            result.push({ id: e.id, terminal: e.terminal, hasUnseenOutput: true });
        }
    }
    return result;
}
```

加 `getById()` 與 `getEntryByTerminal()`:

```typescript
getById(id: TerminalId): TerminalEntry | undefined {
    for (const e of this.entries.values()) {
        if (e.id === id) {
            return { id: e.id, terminal: e.terminal, hasUnseenOutput: e.hasUnseenOutput };
        }
    }
    return undefined;
}

getEntryByTerminal(terminal: TerminalHandle): TerminalEntry | undefined {
    const e = this.entries.get(terminal);
    return e ? { id: e.id, terminal: e.terminal, hasUnseenOutput: e.hasUnseenOutput } : undefined;
}
```

- [ ] **Step 5: 跑測試,確認新 case 過**

```bash
cd /Users/bytedance/projects/superset
npm test -- terminalRegistry
```

預期:全部綠。

- [ ] **Step 6: 修正下游呼叫端**

`grep -rn "registry.getAll()\|registry.getUnseen()" src/ test/` 找出所有呼叫點。

`src/extension.ts`、`src/treeProvider.ts`、`src/highlightPresenter.ts` 內對 `getAll()` / `getUnseen()` 的呼叫,改成取 `.terminal` 或 `.id`。

範例:

```typescript
// Before
for (const terminal of registry.getAll()) { ... }
// After
for (const entry of registry.getAll()) { const terminal = entry.terminal; ... }
```

- [ ] **Step 7: 跑全部測試**

```bash
cd /Users/bytedance/projects/superset
npm test
```

預期:既有 48 個 cases 全綠(個別因型別改動可能要小調測試碼,見 Step 8)。

- [ ] **Step 8: 同步更新既有測試**

`test/highlightPresenter.test.ts`、`test/outputWatcher.test.ts`、`test/treeProvider.test.ts` 內凡用到 `r.getAll()[0]` 之類,改成 `r.getAll()[0].terminal`。

- [ ] **Step 9: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/types.ts src/terminalRegistry.ts src/extension.ts src/treeProvider.ts src/highlightPresenter.ts test/terminalRegistry.test.ts test/highlightPresenter.test.ts test/outputWatcher.test.ts test/treeProvider.test.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(registry): assign stable string id to each terminal entry"
```

---

## Task 2: 實作 `PanelStore` 純狀態層

**Files:**
- Create: `src/panelStore.ts`
- Create: `test/panelStore.test.ts`

- [ ] **Step 1: 寫 failing test**

建立 `test/panelStore.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { PanelStore } from "../src/panelStore";

function fakeState(): {
    storage: Record<string, unknown>;
    get: (k: string) => unknown;
    update: (k: string, v: unknown) => Promise<void>;
} {
    const storage: Record<string, unknown> = {};
    return {
        storage,
        get: (k) => storage[k],
        update: async (k, v) => {
            storage[k] = v;
        },
    };
}

describe("PanelStore", () => {
    it("starts with all sections expanded by default", () => {
        const s = new PanelStore(fakeState() as any);
        expect(s.isCollapsed("terminals")).toBe(false);
        expect(s.isCollapsed("mdns")).toBe(false);
    });

    it("loads persisted collapsed state on construction", () => {
        const state = fakeState();
        state.storage["superset.panel.terminals.collapsed"] = true;
        const s = new PanelStore(state as any);
        expect(s.isCollapsed("terminals")).toBe(true);
    });

    it("toggle() flips the value and persists", async () => {
        const state = fakeState();
        const s = new PanelStore(state as any);
        const listener = vi.fn();
        s.onDidChange(listener);

        await s.toggle("terminals");
        expect(s.isCollapsed("terminals")).toBe(true);
        expect(state.storage["superset.panel.terminals.collapsed"]).toBe(true);
        expect(listener).toHaveBeenCalledWith({
            type: "collapsed",
            sectionId: "terminals",
            collapsed: true,
        });

        await s.toggle("terminals");
        expect(s.isCollapsed("terminals")).toBe(false);
        expect(state.storage["superset.panel.terminals.collapsed"]).toBe(false);
    });

    it("setCollapsed() is idempotent and does not fire when value unchanged", async () => {
        const state = fakeState();
        const s = new PanelStore(state as any);
        const listener = vi.fn();
        s.onDidChange(listener);

        await s.setCollapsed("terminals", false);
        expect(listener).not.toHaveBeenCalled();

        await s.setCollapsed("terminals", true);
        expect(listener).toHaveBeenCalledTimes(1);

        await s.setCollapsed("terminals", true);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("persists write failure does not throw", async () => {
        const state: any = {
            get: () => undefined,
            update: async () => {
                throw new Error("disk full");
            },
        };
        const s = new PanelStore(state);
        await expect(s.toggle("terminals")).resolves.toBeUndefined();
        expect(s.isCollapsed("terminals")).toBe(true);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/bytedance/projects/superset
npm test -- panelStore
```

預期:FAIL(`PanelStore` 不存在)。

- [ ] **Step 3: 實作 `src/panelStore.ts`**

```typescript
import type { Memento } from "vscode";

export type PanelSectionId = "terminals" | "mdns";

export type PanelStoreChange = {
    type: "collapsed";
    sectionId: PanelSectionId;
    collapsed: boolean;
};

export type PanelStoreListener = (change: PanelStoreChange) => void;

export interface PanelStoreDeps {
    workspaceState: Memento;
    log?: (msg: string) => void;
}

const KEY_PREFIX = "superset.panel.";
const KEY_SUFFIX = ".collapsed";
const ALL_SECTIONS: PanelSectionId[] = ["terminals", "mdns"];

function keyFor(sectionId: PanelSectionId): string {
    return `${KEY_PREFIX}${sectionId}${KEY_SUFFIX}`;
}

export class PanelStore {
    private collapsed = new Map<PanelSectionId, boolean>();
    private listeners = new Set<PanelStoreListener>();

    constructor(private readonly deps: PanelStoreDeps) {
        for (const id of ALL_SECTIONS) {
            const v = this.deps.workspaceState.get<boolean>(keyFor(id));
            this.collapsed.set(id, v === true);
        }
    }

    isCollapsed(sectionId: PanelSectionId): boolean {
        return this.collapsed.get(sectionId) === true;
    }

    async setCollapsed(
        sectionId: PanelSectionId,
        value: boolean
    ): Promise<void> {
        if (this.collapsed.get(sectionId) === value) {
            return;
        }
        this.collapsed.set(sectionId, value);
        this.emit({ type: "collapsed", sectionId, collapsed: value });
        try {
            await this.deps.workspaceState.update(keyFor(sectionId), value);
        } catch (err) {
            this.deps.log?.(
                `[panelStore] persist failed for ${sectionId}: ${err}`
            );
        }
    }

    async toggle(sectionId: PanelSectionId): Promise<void> {
        await this.setCollapsed(sectionId, !this.isCollapsed(sectionId));
    }

    onDidChange(listener: PanelStoreListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: PanelStoreChange): void {
        for (const l of this.listeners) {
            l(change);
        }
    }
}
```

- [ ] **Step 4: 跑測試確認全綠**

```bash
cd /Users/bytedance/projects/superset
npm test -- panelStore
```

預期:5 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/panelStore.ts test/panelStore.test.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add PanelStore for window-scoped section collapse state"
```

---

## Task 3: 實作 `buildTreeSnapshot` 純函式

**Files:**
- Create: `src/panelProtocol.ts`
- Create: `test/buildTreeSnapshot.test.ts`

- [ ] **Step 1: 寫 failing test**

建立 `test/buildTreeSnapshot.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildTreeSnapshot, type TreeSnapshot } from "../src/panelProtocol";
import { TerminalRegistry } from "../src/terminalRegistry";
import { GroupStore } from "../src/groupStore";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn(), dispose: vi.fn() };
}

describe("buildTreeSnapshot", () => {
    it("returns groups in store order with UNGROUPED first", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const t = fakeTerminal("bash");
        reg.add(t);
        gs.assignDefaultGroup(t);
        gs.createGroup("Frontend");

        const snap = buildTreeSnapshot(reg, gs);

        expect(snap.groups).toHaveLength(2);
        expect(snap.groups[0].name).toBe("未分組");
        expect(snap.groups[1].name).toBe("Frontend");
        expect(snap.groups[0].terminals).toHaveLength(1);
        expect(snap.groups[0].terminals[0].id).toBe(reg.getAll()[0].id);
    });

    it("strips UNSEEN_PREFIX from terminal names", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const t = { name: "● bash", show: vi.fn(), dispose: vi.fn() } as TerminalHandle;
        reg.add(t);
        gs.assignDefaultGroup(t);

        const snap = buildTreeSnapshot(reg, gs);
        expect(snap.groups[0].terminals[0].name).toBe("bash");
    });

    it("marks isUnseen on terminals and aggregates count on group", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        const c = fakeTerminal("c");
        reg.add(a);
        reg.add(b);
        reg.add(c);
        gs.assignDefaultGroup(a);
        gs.assignDefaultGroup(b);
        gs.assignDefaultGroup(c);
        reg.markUnseen(a);
        reg.markUnseen(c);

        const snap = buildTreeSnapshot(reg, gs);
        const terminals = snap.groups[0].terminals;
        const map = new Map(terminals.map((t) => [t.id, t.isUnseen]));
        const aEntry = reg.getAll().find((e) => e.terminal === a)!;
        const bEntry = reg.getAll().find((e) => e.terminal === b)!;
        const cEntry = reg.getAll().find((e) => e.terminal === c)!;
        expect(map.get(aEntry.id)).toBe(true);
        expect(map.get(bEntry.id)).toBe(false);
        expect(map.get(cEntry.id)).toBe(true);
        expect(snap.groups[0].unseenCount).toBe(2);
    });

    it("respects group.collapsed in snapshot", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const t = fakeTerminal("a");
        reg.add(t);
        gs.assignDefaultGroup(t);
        gs.toggleGroupCollapsed("ungrouped");

        const snap = buildTreeSnapshot(reg, gs);
        expect(snap.groups[0].collapsed).toBe(true);
    });

    it("emits group color in snapshot", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const g = gs.createGroup("X", "red");
        const t = fakeTerminal("a");
        reg.add(t);
        gs.moveTerminalToGroup(t, g.id);

        const snap = buildTreeSnapshot(reg, gs);
        expect(snap.groups[1].color).toBe("red");
    });

    it("returns single empty UNGROUPED when registry empty", () => {
        const reg = new TerminalRegistry();
        const gs = new GroupStore();
        const snap = buildTreeSnapshot(reg, gs);
        expect(snap.groups).toHaveLength(1);
        expect(snap.groups[0].terminals).toEqual([]);
        expect(snap.groups[0].unseenCount).toBe(0);
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/bytedance/projects/superset
npm test -- buildTreeSnapshot
```

預期:FAIL。

- [ ] **Step 3: 實作 `src/panelProtocol.ts` (僅 buildTreeSnapshot 與資料形狀部分)**

```typescript
import type { GroupColor, GroupStore } from "./groupStore";
import { stripUnseenPrefix } from "./treeSpec";
import type { TerminalId } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

export type SectionId = "terminals" | "mdns";

export interface SectionState {
    id: SectionId;
    title: string;
    collapsed: boolean;
}

export interface TerminalSnapshot {
    id: TerminalId;
    name: string;
    isUnseen: boolean;
}

export interface GroupSnapshot {
    id: string;
    name: string;
    color: GroupColor;
    collapsed: boolean;
    terminals: TerminalSnapshot[];
    unseenCount: number;
}

export interface TreeSnapshot {
    groups: GroupSnapshot[];
}

export function buildTreeSnapshot(
    registry: TerminalRegistry,
    groupStore: GroupStore
): TreeSnapshot {
    const unseenSet = new Set(registry.getUnseen().map((e) => e.id));
    const groups: GroupSnapshot[] = groupStore.getGroups().map((g) => {
        const terminals: TerminalSnapshot[] = [];
        let unseenCount = 0;
        for (const t of g.terminals) {
            const entry = registry.getEntryByTerminal(t);
            if (!entry) continue;
            const isUnseen = unseenSet.has(entry.id);
            if (isUnseen) unseenCount++;
            terminals.push({
                id: entry.id,
                name: stripUnseenPrefix(entry.terminal.name),
                isUnseen,
            });
        }
        return {
            id: g.id,
            name: g.name,
            color: g.color,
            collapsed: g.collapsed,
            terminals,
            unseenCount,
        };
    });
    return { groups };
}
```

- [ ] **Step 4: 跑測試確認綠**

```bash
cd /Users/bytedance/projects/superset
npm test -- buildTreeSnapshot
```

預期:6 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/panelProtocol.ts test/buildTreeSnapshot.test.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add buildTreeSnapshot pure function"
```

---

## Task 4: 實作 message 路由純函式

**Files:**
- Modify: `src/panelProtocol.ts`
- Create: `test/panelProtocol.test.ts`

- [ ] **Step 1: 寫 failing test**

建立 `test/panelProtocol.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
    routeWebviewMessage,
    type HostCommandContext,
} from "../src/panelProtocol";
import { TerminalRegistry } from "../src/terminalRegistry";
import { GroupStore } from "../src/groupStore";
import { PanelStore } from "../src/panelStore";
import type { TerminalHandle } from "../src/types";

function fakeState() {
    const storage: Record<string, unknown> = {};
    return {
        get: (k: string) => storage[k],
        update: async (k: string, v: unknown) => {
            storage[k] = v;
        },
    };
}

function makeCtx() {
    const reg = new TerminalRegistry();
    const gs = new GroupStore();
    const ps = new PanelStore(fakeState() as any);
    const focus = vi.fn();
    const dispose = vi.fn();
    const showInput = vi.fn(async () => "newname");
    const showQuickPick = vi.fn(async () => "green" as const);
    const createTerminal = vi.fn();
    const showInformation = vi.fn();
    const log = vi.fn();
    const ctx: HostCommandContext = {
        registry: reg,
        groupStore: gs,
        panelStore: ps,
        focusTerminal: focus,
        disposeTerminal: dispose,
        showInputBox: showInput,
        showQuickPick,
        createTerminal,
        showInformation,
        log,
    };
    return { ctx, reg, gs, ps, focus, dispose, showInput, showQuickPick, createTerminal, showInformation, log };
}

describe("routeWebviewMessage", () => {
    it("focus: calls focusTerminal on resolved entry", async () => {
        const { ctx, reg, focus } = makeCtx();
        const t: TerminalHandle = { name: "bash", show: vi.fn(), dispose: vi.fn() };
        reg.add(t);
        const id = reg.getAll()[0].id;
        await routeWebviewMessage(ctx, { type: "focus", terminalId: id });
        expect(focus).toHaveBeenCalledWith(t);
    });

    it("focus: unknown id is logged and ignored", async () => {
        const { ctx, focus, log } = makeCtx();
        await routeWebviewMessage(ctx, { type: "focus", terminalId: "nope" });
        expect(focus).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalled();
    });

    it("toggleGroup: calls groupStore.toggleGroupCollapsed", async () => {
        const { ctx, gs } = makeCtx();
        const spy = vi.spyOn(gs, "toggleGroupCollapsed");
        await routeWebviewMessage(ctx, { type: "toggleGroup", groupId: "ungrouped" });
        expect(spy).toHaveBeenCalledWith("ungrouped");
    });

    it("toggleSection: calls panelStore.toggle", async () => {
        const { ctx, ps } = makeCtx();
        const spy = vi.spyOn(ps, "toggle");
        await routeWebviewMessage(ctx, { type: "toggleSection", sectionId: "terminals" });
        expect(spy).toHaveBeenCalledWith("terminals");
    });

    it("moveTerminal: calls groupStore.moveTerminalToGroup with resolved terminal", async () => {
        const { ctx, reg, gs } = makeCtx();
        const t: TerminalHandle = { name: "a", show: vi.fn(), dispose: vi.fn() };
        reg.add(t);
        const id = reg.getAll()[0].id;
        const g = gs.createGroup("X");
        const spy = vi.spyOn(gs, "moveTerminalToGroup");
        await routeWebviewMessage(ctx, {
            type: "moveTerminal",
            terminalId: id,
            targetGroupId: g.id,
            position: 0,
        });
        expect(spy).toHaveBeenCalledWith(t, g.id, 0);
    });

    it("moveGroup: calls groupStore.moveGroup", async () => {
        const { ctx, gs } = makeCtx();
        const g = gs.createGroup("X");
        const spy = vi.spyOn(gs, "moveGroup");
        await routeWebviewMessage(ctx, {
            type: "moveGroup",
            groupId: g.id,
            targetIndex: 1,
        });
        expect(spy).toHaveBeenCalledWith(g.id, 1);
    });

    it("newTerminal: calls ctx.createTerminal()", async () => {
        const { ctx, createTerminal } = makeCtx();
        await routeWebviewMessage(ctx, { type: "newTerminal" });
        expect(createTerminal).toHaveBeenCalledOnce();
    });

    it("newGroup: prompts for name and creates", async () => {
        const { ctx, gs } = makeCtx();
        const spy = vi.spyOn(gs, "createGroup");
        await routeWebviewMessage(ctx, { type: "newGroup" });
        expect(spy).toHaveBeenCalledWith("newname");
    });

    it("deleteTerminal: disposes the resolved terminal", async () => {
        const { ctx, reg, dispose } = makeCtx();
        const t: TerminalHandle = { name: "a", show: vi.fn(), dispose: dispose };
        reg.add(t);
        const id = reg.getAll()[0].id;
        await routeWebviewMessage(ctx, { type: "deleteTerminal", terminalId: id });
        expect(dispose).toHaveBeenCalledOnce();
    });

    it("unknown type is logged and does not throw", async () => {
        const { ctx, log } = makeCtx();
        await expect(
            routeWebviewMessage(ctx, { type: "bogus" } as any)
        ).resolves.toBeUndefined();
        expect(log).toHaveBeenCalled();
    });

    it("deleteGroup: refuses to delete ungrouped", async () => {
        const { ctx, gs, log } = makeCtx();
        const spy = vi.spyOn(gs, "deleteGroup");
        await routeWebviewMessage(ctx, { type: "deleteGroup", groupId: "ungrouped" });
        expect(spy).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/bytedance/projects/superset
npm test -- panelProtocol
```

預期:FAIL。

- [ ] **Step 3: 在 `src/panelProtocol.ts` 內加 message 介面 + router**

在檔案最尾端加:

```typescript
import type { PanelStore } from "./panelStore";
import type { GroupColor, GroupId, GroupStore } from "./groupStore";
import type { TerminalHandle, TerminalId } from "./types";

export type HostMessage =
    | { type: "init"; snapshot: TreeSnapshot; sections: SectionState[] }
    | { type: "snapshot"; snapshot: TreeSnapshot }
    | { type: "collapseChanged"; sectionId: SectionId; collapsed: boolean };

export type WebviewMessage =
    | { type: "webviewReady" }
    | { type: "focus"; terminalId: TerminalId }
    | { type: "toggleGroup"; groupId: GroupId }
    | { type: "toggleSection"; sectionId: SectionId }
    | {
          type: "moveTerminal";
          terminalId: TerminalId;
          targetGroupId: GroupId;
          position?: number;
      }
    | { type: "moveGroup"; groupId: GroupId; targetIndex: number }
    | { type: "newTerminal" }
    | { type: "newGroup" }
    | { type: "renameGroup"; groupId: GroupId }
    | { type: "setGroupColor"; groupId: GroupId }
    | { type: "deleteGroup"; groupId: GroupId }
    | { type: "deleteTerminal"; terminalId: TerminalId }
    | { type: "renameTerminal"; terminalId: TerminalId }
    | { type: "copyName"; terminalId: TerminalId };

export interface HostCommandContext {
    registry: TerminalRegistry;
    groupStore: GroupStore;
    panelStore: PanelStore;
    focusTerminal(t: TerminalHandle): void;
    disposeTerminal(t: TerminalHandle): void;
    showInputBox(opts: { prompt: string; value?: string }): Promise<string | undefined>;
    showQuickPick<T extends string>(
        items: readonly T[],
        opts: { placeHolder: string }
    ): Promise<T | undefined>;
    createTerminal(): void;
    showInformation(msg: string): void;
    log(msg: string): void;
}

const COLOR_OPTIONS = [
    "red", "orange", "yellow", "green",
    "blue", "purple", "magenta", "gray",
] as const satisfies readonly GroupColor[];

export async function routeWebviewMessage(
    ctx: HostCommandContext,
    msg: WebviewMessage
): Promise<void> {
    try {
        switch (msg.type) {
            case "webviewReady":
                return;

            case "focus": {
                const entry = ctx.registry.getById(msg.terminalId);
                if (!entry) {
                    ctx.log(`[panel] focus ignored: unknown terminalId=${msg.terminalId}`);
                    return;
                }
                ctx.focusTerminal(entry.terminal);
                return;
            }

            case "toggleGroup":
                ctx.groupStore.toggleGroupCollapsed(msg.groupId);
                return;

            case "toggleSection":
                await ctx.panelStore.toggle(msg.sectionId);
                return;

            case "moveTerminal": {
                const entry = ctx.registry.getById(msg.terminalId);
                if (!entry) {
                    ctx.log(`[panel] move ignored: unknown terminalId=${msg.terminalId}`);
                    return;
                }
                ctx.groupStore.moveTerminalToGroup(
                    entry.terminal,
                    msg.targetGroupId,
                    msg.position
                );
                return;
            }

            case "moveGroup":
                ctx.groupStore.moveGroup(msg.groupId, msg.targetIndex);
                return;

            case "newTerminal":
                ctx.createTerminal();
                return;

            case "newGroup": {
                const name = await ctx.showInputBox({ prompt: "群組名稱" });
                if (!name) return;
                ctx.groupStore.createGroup(name);
                return;
            }

            case "renameGroup": {
                const g = ctx.groupStore.getGroup(msg.groupId);
                if (!g) return;
                const name = await ctx.showInputBox({
                    prompt: "新名稱",
                    value: g.name,
                });
                if (!name) return;
                ctx.groupStore.renameGroup(msg.groupId, name);
                return;
            }

            case "setGroupColor": {
                const color = await ctx.showQuickPick(COLOR_OPTIONS, {
                    placeHolder: "選擇顏色",
                });
                if (!color) return;
                ctx.groupStore.setGroupColor(msg.groupId, color);
                return;
            }

            case "deleteGroup":
                if (msg.groupId === "ungrouped") {
                    ctx.log("[panel] deleteGroup ignored: cannot delete ungrouped");
                    return;
                }
                ctx.groupStore.deleteGroup(msg.groupId);
                return;

            case "deleteTerminal": {
                const entry = ctx.registry.getById(msg.terminalId);
                if (!entry) {
                    ctx.log(`[panel] delete ignored: unknown terminalId=${msg.terminalId}`);
                    return;
                }
                ctx.disposeTerminal(entry.terminal);
                return;
            }

            case "renameTerminal": {
                const entry = ctx.registry.getById(msg.terminalId);
                if (!entry) {
                    ctx.log(`[panel] rename ignored: unknown terminalId=${msg.terminalId}`);
                    return;
                }
                ctx.focusTerminal(entry.terminal);
                await ctx.showInputBox({
                    prompt: "(rename flow happens via vscode built-in after focus)",
                });
                return;
            }

            case "copyName": {
                const entry = ctx.registry.getById(msg.terminalId);
                if (!entry) return;
                ctx.log(`[panel] copyName: ${entry.terminal.name}`);
                return;
            }
        }
    } catch (err) {
        ctx.log(
            `[panel] route error for type=${(msg as { type: string }).type}: ${err}`
        );
    }
}
```

- [ ] **Step 4: 跑測試確認綠**

```bash
cd /Users/bytedance/projects/superset
npm test -- panelProtocol
```

預期:11 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/panelProtocol.ts test/panelProtocol.test.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add webview message router with HostCommandContext DI"
```

---

## Task 5: 實作 `renderTree` 純函式

**Files:**
- Modify: `src/panelProtocol.ts`
- Create: `test/renderTree.test.ts`

- [ ] **Step 1: 寫 failing test**

建立 `test/renderTree.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { renderTree, escapeHtml, type TreeSnapshot } from "../src/panelProtocol";

const snap: TreeSnapshot = {
    groups: [
        {
            id: "g1",
            name: "Frontend",
            color: "blue",
            collapsed: false,
            unseenCount: 1,
            terminals: [
                { id: "t1", name: "npm run dev", isUnseen: true },
                { id: "t2", name: "git status", isUnseen: false },
            ],
        },
    ],
};

describe("renderTree", () => {
    it("returns string HTML containing group name and color glyph", () => {
        const html = renderTree(snap);
        expect(html).toContain("Frontend");
        expect(html).toContain("🟦");
    });

    it("renders terminal names with escape", () => {
        const s: TreeSnapshot = {
            groups: [
                {
                    id: "g1",
                    name: "G",
                    color: "gray",
                    collapsed: false,
                    unseenCount: 0,
                    terminals: [
                        { id: "t1", name: "<script>x</script>", isUnseen: false },
                    ],
                },
            ],
        };
        const html = renderTree(s);
        expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
        expect(html).not.toContain("<script>x</script>");
    });

    it("renders data-terminal-id for click routing", () => {
        const html = renderTree(snap);
        expect(html).toContain('data-terminal-id="t1"');
        expect(html).toContain('data-terminal-id="t2"');
    });

    it("renders unseen badge when isUnseen=true", () => {
        const html = renderTree(snap);
        expect(html).toContain('data-unseen="true"');
    });

    it("renders collapsed class on group when collapsed", () => {
        const s: TreeSnapshot = {
            groups: [
                {
                    id: "g1",
                    name: "G",
                    color: "gray",
                    collapsed: true,
                    unseenCount: 0,
                    terminals: [],
                },
            ],
        };
        const html = renderTree(s);
        expect(html).toContain("collapsed");
    });

    it("renders group unseen count", () => {
        const html = renderTree(snap);
        expect(html).toContain("1");
    });

    it("renders empty state when no groups", () => {
        const html = renderTree({ groups: [] });
        expect(html).toContain("empty");
    });

    it("escapeHtml escapes ampersands and quotes", () => {
        expect(escapeHtml(`a & b "c" 'd'`)).toBe(
            "a &amp; b &quot;c&quot; &#39;d&#39;"
        );
    });
});
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/bytedance/projects/superset
npm test -- renderTree
```

預期:FAIL。

- [ ] **Step 3: 在 `src/panelProtocol.ts` 加 `renderTree` + `escapeHtml`**

```typescript
const COLOR_GLYPH: Record<GroupColor, string> = {
    red: "🟥",
    orange: "🟧",
    yellow: "🟨",
    green: "🟩",
    blue: "🟦",
    purple: "🟪",
    magenta: "🟪",
    gray: "⬜",
};

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function renderTree(snapshot: TreeSnapshot): string {
    if (snapshot.groups.length === 0) {
        return `<div class="empty">尚無內容</div>`;
    }
    const out: string[] = [];
    for (const g of snapshot.groups) {
        out.push(
            `<section class="group ${g.collapsed ? "collapsed" : ""}" data-group-id="${escapeHtml(g.id)}">`
        );
        out.push(
            `<header class="group-header"><span class="glyph">${COLOR_GLYPH[g.color]}</span><span class="group-name">${escapeHtml(g.name)}</span>${
                g.unseenCount > 0
                    ? `<span class="badge">● ${g.unseenCount}</span>`
                    : ""
            }<button class="chevron" data-action="toggleGroup" data-group-id="${escapeHtml(g.id)}">${g.collapsed ? "▶" : "▼"}</button></header>`
        );
        if (!g.collapsed) {
            out.push(`<ul class="terminals">`);
            for (const t of g.terminals) {
                out.push(
                    `<li class="terminal" data-terminal-id="${escapeHtml(t.id)}" data-unseen="${t.isUnseen ? "true" : "false"}"><span class="icon">${t.isUnseen ? "●" : "▸"}</span><span class="name">${escapeHtml(t.name)}</span></li>`
                );
            }
            out.push(`</ul>`);
        }
        out.push(`</section>`);
    }
    return out.join("");
}
```

> 註:`COLOR_GLYPH` 在 `treeSpec.ts` 已 export;若要避免重複,改為 `import { COLOR_GLYPH } from "./treeSpec"`。

- [ ] **Step 4: 跑測試確認綠**

```bash
cd /Users/bytedance/projects/superset
npm test -- renderTree
```

預期:8 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/panelProtocol.ts test/renderTree.test.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add renderTree and escapeHtml pure functions"
```

---

## Task 6: 建立 webview 入口 (HTML / CSS / JS)

**Files:**
- Create: `media/panel.html`
- Create: `media/panel.css`
- Create: `media/panel.js`

- [ ] **Step 1: 建立 `media/panel.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'self';">
    <link rel="stylesheet" href="panel.css">
    <title>Superset</title>
</head>
<body>
    <section id="section-terminals" class="section">
        <div id="root" class="loading">載入中…</div>
    </section>
    <script src="panel.js"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 `media/panel.css`**

```css
:root {
    --bg: var(--vscode-sideBar-background);
    --fg: var(--vscode-sideBar-foreground);
    --hover-bg: var(--vscode-list-hoverBackground);
    --active-bg: var(--vscode-list-activeSelectionBackground);
    --border: var(--vscode-sideBarSectionHeader-border);
    --unseen: var(--vscode-charts-yellow, #d6a500);
}

* { box-sizing: border-box; }
body {
    margin: 0;
    padding: 4px 0;
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    color: var(--fg);
    background: var(--bg);
}

#root.loading { padding: 8px; opacity: 0.6; }

section.group { margin: 0 0 4px 0; }

.group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-top: 1px solid var(--border);
    user-select: none;
    cursor: default;
}

.glyph { font-size: 11px; }
.group-name { flex: 1; }
.badge { color: var(--unseen); font-weight: 600; }
.chevron {
    background: none;
    border: 0;
    color: var(--fg);
    cursor: pointer;
    padding: 0 4px;
}

ul.terminals { list-style: none; margin: 0; padding: 0; }

li.terminal {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px 2px 24px;
    cursor: pointer;
}
li.terminal:hover { background: var(--hover-bg); }
li.terminal[data-unseen="true"] .icon { color: var(--unseen); }
li.terminal .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty { padding: 8px; opacity: 0.6; }
```

- [ ] **Step 3: 建立 `media/panel.js`**

```javascript
(function () {
    "use strict";

    const vscode = acquireVsCodeApi();

    const root = document.getElementById("root");
    const termSection = document.getElementById("section-terminals");
    let currentSnapshot = { groups: [] };
    let sections = [];

    const GLYPH = {
        red: "🟥", orange: "🟧", yellow: "🟨", green: "🟩",
        blue: "🟦", purple: "🟪", magenta: "🟪", gray: "⬜",
    };

    function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }
    function escapeHtmlText(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function send(msg) {
        try { vscode.postMessage(msg); }
        catch (err) { console.error("[panel] postMessage failed", err); }
    }

    function render() {
        root.classList.remove("loading");
        if (!currentSnapshot.groups || currentSnapshot.groups.length === 0) {
            root.innerHTML = '<div class="empty">尚無內容</div>';
            return;
        }
        const out = [];
        for (const g of currentSnapshot.groups) {
            out.push('<section class="group ' + (g.collapsed ? "collapsed" : "") + '" data-group-id="' + escapeAttr(g.id) + '">');
            out.push(
                '<header class="group-header">'
                + '<span class="glyph">' + (GLYPH[g.color] || "⬜") + '</span>'
                + '<span class="group-name">' + escapeHtmlText(g.name) + '</span>'
                + (g.unseenCount > 0 ? '<span class="badge">● ' + g.unseenCount + '</span>' : '')
                + '<button class="chevron" data-action="toggleGroup" data-group-id="' + escapeAttr(g.id) + '">'
                + (g.collapsed ? "▶" : "▼") + '</button>'
                + '</header>'
            );
            if (!g.collapsed) {
                out.push('<ul class="terminals">');
                for (const t of g.terminals) {
                    out.push(
                        '<li class="terminal" data-terminal-id="' + escapeAttr(t.id) + '" data-unseen="' + (t.isUnseen ? "true" : "false") + '">'
                        + '<span class="icon">' + (t.isUnseen ? "●" : "▸") + '</span>'
                        + '<span class="name">' + escapeHtmlText(t.name) + '</span>'
                        + '</li>'
                    );
                }
                out.push('</ul>');
            }
            out.push('</section>');
        }
        root.innerHTML = out.join("");
        wireEvents();
    }

    function applySectionState() {
        if (!termSection) return;
        const sec = sections.find((s) => s.id === "terminals");
        termSection.style.display = sec && sec.collapsed ? "none" : "";
    }

    function wireEvents() {
        root.querySelectorAll('[data-action="toggleGroup"]').forEach((el) => {
            el.addEventListener("click", (ev) => {
                ev.stopPropagation();
                send({ type: "toggleGroup", groupId: el.getAttribute("data-group-id") });
            });
        });
        root.querySelectorAll(".terminal").forEach((el) => {
            el.addEventListener("click", () => {
                send({ type: "focus", terminalId: el.getAttribute("data-terminal-id") });
            });
            el.addEventListener("contextmenu", (ev) => {
                ev.preventDefault();
                showTerminalMenu(ev.clientX, ev.clientY, el.getAttribute("data-terminal-id"));
            });
            el.setAttribute("draggable", "true");
            el.addEventListener("dragstart", (ev) => {
                ev.dataTransfer.setData("text/plain", el.getAttribute("data-terminal-id"));
                ev.dataTransfer.effectAllowed = "move";
            });
        });
        root.querySelectorAll("section.group").forEach((el) => {
            el.addEventListener("dragover", (ev) => {
                ev.preventDefault();
                ev.dataTransfer.dropEffect = "move";
            });
            el.addEventListener("drop", (ev) => {
                ev.preventDefault();
                const terminalId = ev.dataTransfer.getData("text/plain");
                if (!terminalId) return;
                send({ type: "moveTerminal", terminalId, targetGroupId: el.getAttribute("data-group-id") });
            });
        });
    }

    function showTerminalMenu(x, y, terminalId) {
        const menu = document.createElement("div");
        menu.className = "context-menu";
        menu.style.position = "fixed";
        menu.style.left = x + "px";
        menu.style.top = y + "px";
        menu.innerHTML = [
            { label: "聚焦", action: "focus" },
            { label: "重新命名", action: "renameTerminal" },
            { label: "複製名稱", action: "copyName" },
            { label: "關閉", action: "deleteTerminal" },
        ].map((i) => '<div class="menu-item" data-action="' + i.action + '">' + i.label + '</div>').join("");
        document.body.appendChild(menu);
        menu.addEventListener("click", (ev) => {
            const action = ev.target.getAttribute("data-action");
            if (action) send({ type: action, terminalId });
            menu.remove();
        });
        setTimeout(() => {
            document.addEventListener("click", function dismiss() {
                menu.remove();
                document.removeEventListener("click", dismiss);
            });
        }, 0);
    }

    window.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== "object") return;
        switch (msg.type) {
            case "init":
                currentSnapshot = msg.snapshot;
                sections = msg.sections || [];
                render();
                applySectionState();
                break;
            case "snapshot":
                currentSnapshot = msg.snapshot;
                render();
                break;
            case "collapseChanged": {
                const sec = sections.find((s) => s.id === msg.sectionId);
                if (sec) sec.collapsed = msg.collapsed;
                applySectionState();
                break;
            }
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        send({ type: "webviewReady" });
    });
})();
```

- [ ] **Step 4: 確認 `.vscodeignore` 不排除 `media/`**

```bash
cd /Users/bytedance/projects/superset
cat .vscodeignore
```

若包含 `media/**` 把它移除。

- [ ] **Step 5: 確認 `tsconfig.json` 不編譯 `media/`**

`tsconfig.json` 目前 `include: ["src/**/*"]`,不會編譯 `media/`。`media/` 直接以原檔案形式被打包。

- [ ] **Step 6: Commit**

```bash
cd /Users/bytedance/projects/superset
git add media/panel.html media/panel.css media/panel.js .vscodeignore
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add webview entry assets (HTML/CSS/JS)"
```

---

## Task 7: 實作 `PanelViewProvider` (vscode-bound)

**Files:**
- Create: `src/panelView.ts`

- [ ] **Step 1: 建立 `src/panelView.ts`**

```typescript
import * as vscode from "vscode";
import {
    buildTreeSnapshot,
    routeWebviewMessage,
    type HostCommandContext,
    type HostMessage,
    type SectionState,
    type WebviewMessage,
} from "./panelProtocol";
import type { PanelStore } from "./panelStore";
import type { GroupStore } from "./groupStore";
import type { TerminalRegistry } from "./terminalRegistry";
import type { TerminalHandle } from "./types";

const SECTIONS: ReadonlyArray<{ id: "terminals" | "mdns"; title: string }> = [
    { id: "terminals", title: "Terminals" },
    { id: "mdns", title: "mDNS" },
];

export interface PanelViewDeps {
    registry: TerminalRegistry;
    groupStore: GroupStore;
    panelStore: PanelStore;
    /** Pre-loaded panel.html content (avoid fs in webview provider). */
    htmlContent: string;
    /** Creates a new PTY-backed terminal. */
    createTerminal(): void;
    log?: (msg: string) => void;
}

export class PanelViewProvider implements vscode.WebviewViewProvider {
    private disposables: vscode.Disposable[] = [];
    private view?: vscode.WebviewView;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly deps: PanelViewDeps
    ) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
        };
        webviewView.webview.html = this.getHtml(webviewView.webview);

        const ctx = this.buildContext();
        const messageDisposable = webviewView.webview.onDidReceiveMessage(
            (msg: WebviewMessage) => {
                void routeWebviewMessage(ctx, msg);
            }
        );

        const pushSnapshot = () => this.pushCurrentSnapshot();
        const unsubReg = this.deps.registry.onDidChange(pushSnapshot);
        const unsubGroup = this.deps.groupStore.onDidChange(pushSnapshot);
        const unsubPanel = this.deps.panelStore.onDidChange((change) => {
            this.postMessage({
                type: "collapseChanged",
                sectionId: change.sectionId,
                collapsed: change.collapsed,
            });
        });

        this.disposables.push(
            messageDisposable,
            { dispose: unsubReg },
            { dispose: unsubGroup },
            { dispose: unsubPanel },
            webviewView.onDidDispose(() => this.dispose())
        );
    }

    dispose(): void {
        for (const d of this.disposables) {
            try { d.dispose(); } catch (err) {
                this.deps.log?.(`[panel] dispose error: ${err}`);
            }
        }
        this.disposables = [];
        this.view = undefined;
    }

    private buildContext(): HostCommandContext {
        return {
            registry: this.deps.registry,
            groupStore: this.deps.groupStore,
            panelStore: this.deps.panelStore,
            focusTerminal: (t) => t.show(),
            disposeTerminal: (t) => t.dispose(),
            showInputBox: (opts) => vscode.window.showInputBox(opts),
            showQuickPick: <T extends string>(
                items: readonly T[],
                opts: { placeHolder: string }
            ) =>
                vscode.window.showQuickPick(
                    [...items] as string[],
                    opts
                ) as Promise<T | undefined>,
            createTerminal: () => this.deps.createTerminal(),
            showInformation: (m) => vscode.window.showInformationMessage(m),
            log: (m) => this.deps.log?.(m) ?? console.log(`[superset] ${m}`),
        };
    }

    private getCurrentSections(): SectionState[] {
        return SECTIONS.map((s) => ({
            id: s.id,
            title: s.title,
            collapsed: this.deps.panelStore.isCollapsed(s.id),
        }));
    }

    private pushCurrentSnapshot(): void {
        if (!this.view) return;
        this.postMessage({
            type: "snapshot",
            snapshot: buildTreeSnapshot(this.deps.registry, this.deps.groupStore),
        });
    }

    private postMessage(msg: HostMessage): void {
        try {
            this.view?.webview.postMessage(msg);
        } catch (err) {
            this.deps.log?.(`[panel] postMessage error: ${err}`);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "panel.js")
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "panel.css")
        );
        return this.deps.htmlContent
            .replace('href="panel.css"', `href="${styleUri}"`)
            .replace('src="panel.js"', `src="${scriptUri}"`);
    }

    /** Public for the host to send 'init' once webview signals ready. */
    pushInitIfReady(): void {
        if (!this.view) return;
        this.postMessage({
            type: "init",
            snapshot: buildTreeSnapshot(this.deps.registry, this.deps.groupStore),
            sections: this.getCurrentSections(),
        });
    }
}
```

> 註:`pushInitIfReady()` 提供給 host 在收到 `webviewReady` 訊息時呼叫;`routeWebviewMessage` 對 `webviewReady` 是 no-op,所以 host 端要自己加 `onDidReceiveMessage` listener 處理這個訊號。**為簡化**,改為在 `PanelViewProvider` 內部獨立 listener:

修改 `resolveWebviewView` 把 `webviewReady` 處理寫在內:

```typescript
const messageDisposable = webviewView.webview.onDidReceiveMessage(
    (msg: WebviewMessage) => {
        if (msg.type === "webviewReady") {
            this.postMessage({
                type: "init",
                snapshot: buildTreeSnapshot(
                    this.deps.registry,
                    this.deps.groupStore
                ),
                sections: this.getCurrentSections(),
            });
            return;
        }
        void routeWebviewMessage(ctx, msg);
    }
);
```

- [ ] **Step 2: 跑 type check**

```bash
cd /Users/bytedance/projects/superset
npm run build
```

預期:無錯誤。

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/panelView.ts
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): add PanelViewProvider with DI and message wiring"
```

---

## Task 8: 在 `extension.ts` 組裝 + 修改 `package.json`

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`
- Delete: `src/treeProvider.ts`
- Delete: `test/treeProvider.test.ts`

- [ ] **Step 1: 修改 `package.json`**

a. 把 `views.superset.terminals` 改為 webview:

```json
"views": {
  "superset": [
    {
      "id": "superset.terminals",
      "name": "Terminals",
      "type": "webview",
      "contextualTitle": "Superset"
    }
  ]
}
```

b. 在 `commands` 區段加 toggle 命令(放在 `superset.openTuiTerminal` 之後):

```json
{
  "command": "superset.toggleTerminalsCollapsed",
  "title": "Superset: Toggle Terminals Section",
  "icon": "$(chevron-up)"
}
```

c. 在 `menus.view/title` 區段加 toggle button:

```json
{
  "command": "superset.toggleTerminalsCollapsed",
  "when": "view == superset.terminals",
  "group": "navigation"
}
```

- [ ] **Step 2: 在 `src/extension.ts` 加 import**

在檔案頂端 imports 區塊加:

```typescript
import { PanelStore } from "./panelStore";
import { PanelViewProvider } from "./panelView";
import * as fs from "fs";
import * as path from "path";
```

- [ ] **Step 3: 移除 `createTreeView` 整段**

刪除:

```typescript
const treeView = vscode.window.createTreeView("superset.terminals", { ... });
subscriptions.push(treeView);
```

與其上方的 `treeProvider = new TerminalTreeProvider(...)`、`treeProvider.start()` 等組裝;若 `treeProvider` 變數後續沒用到,一併刪除。

> 註:`TerminalTreeProvider` 與 `isGroup` 從 `treeProvider.ts` import;`buildTreeItemSpec` 從 `treeSpec.ts` import — 移除後也要清理 imports。

- [ ] **Step 4: 加 `PanelStore` + `PanelViewProvider` 組裝**

在 `activate()` 內,合適位置(可在 pre-populate 之後):

```typescript
const panelStore = new PanelStore({
    workspaceState: context.workspaceState,
    log,
});

const htmlContent = fs.readFileSync(
    path.join(context.extensionPath, "media", "panel.html"),
    "utf8"
);

const panelProvider = new PanelViewProvider(context.extensionUri, {
    registry,
    groupStore,
    panelStore,
    htmlContent,
    createTerminal: () => {
        const cwd =
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
            process.cwd();
        spawnPtyTerminal("bash", cwd).show();
    },
    log,
});

subscriptions.push(
    vscode.window.registerWebviewViewProvider(
        "superset.terminals",
        panelProvider
    )
);
```

- [ ] **Step 5: 註冊 `superset.toggleTerminalsCollapsed` 命令**

放在 group 命令附近:

```typescript
subscriptions.push(
    vscode.commands.registerCommand(
        "superset.toggleTerminalsCollapsed",
        () => {
            void panelStore.toggle("terminals");
        }
    )
);
```

- [ ] **Step 6: 移除已不用的 imports**

從 `src/extension.ts` 移除:

```typescript
import { TerminalTreeProvider, isGroup } from "./treeProvider";
import { stripUnseenPrefix } from "./treeSpec";
```

(若 `stripUnseenPrefix` 還被其他地方用 — 像是 `superset.copyName` — 保留 import。實際 grep 後再決定。)

- [ ] **Step 7: 刪除 `src/treeProvider.ts` 與 `test/treeProvider.test.ts`**

```bash
cd /Users/bytedance/projects/superset
git rm src/treeProvider.ts test/treeProvider.test.ts
```

- [ ] **Step 8: 跑 build**

```bash
cd /Users/bytedance/projects/superset
npm run build
```

預期:無錯誤。

- [ ] **Step 9: 跑全部測試**

```bash
cd /Users/bytedance/projects/superset
npm test
```

預期:既有 48 cases + 新增 ~30 cases = 約 78 cases 全綠。

- [ ] **Step 10: 手動 smoke test (F5)**

按 F5 開 Extension Development Host:
1. 開新 terminal:`Ctrl+Shift+`` → panel 應列出 terminal
2. 切到第二個 terminal,在第一個跑 `sleep 5; echo done` → 第一個應有 unseen badge
3. 點 panel 上的 terminal row → 該 terminal 聚焦
4. 點 panel 上群組的 ▶/▼ → 群組收合/展開
5. 點 panel view title 的 chevron button → 整個 section 收合,body 隱藏;再點 → 展開
6. 重開 VSCode → 摺疊狀態恢復

- [ ] **Step 11: Commit**

```bash
cd /Users/bytedance/projects/superset
git add src/extension.ts package.json
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "feat(panel): wire PanelViewProvider into extension and add toggle command"
```

---

## Task 9: 更新 README 與 CLAUDE.md 反映新架構

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 `README.md`**

在「架構 (Architecture)」表格加入:

```
| `PanelStore` (新) | Side panel 視窗級 section 收合狀態 (workspaceState) | Memento |
| `PanelViewProvider` (新) | 自繪 WebviewView,接收 host → webview 訊息,渲染 panel | registry / groupStore / panelStore |
| `buildTreeSnapshot` (新) | 純函式:把 registry + groupStore 投影成 JSON snapshot | 純函式 |
| `renderTree` (新) | 純函式:snapshot → HTML 字串 (供 webview 與測試共用) | 純函式 |
```

「VSCode 終端機事件總覽」表加入:

```
| `WebviewView` API | 物件 | 自繪側欄 view 內容 | 穩定 |
| `registerWebviewViewProvider` | Window | 把 WebviewViewProvider 綁到 view id | 穩定 |
| `webview.onDidReceiveMessage` | 物件 | 接收 webview 端 postMessage | 穩定 |
| `webview.postMessage` | 物件 | 從 host 送訊息到 webview | 穩定 |
```

「測試」段落更新為:目前約 78 個 case,`PanelViewProvider` class 本體 (vscode-bound) 不做單元測試,渲染邏輯已抽到 `src/panelProtocol.ts` 純函式。

- [ ] **Step 2: 更新 `CLAUDE.md`**

在「架構速覽 (Architecture)」表加入 PanelStore、PanelViewProvider、`buildTreeSnapshot`、`renderTree`。

新增段落「側欄摺疊機制」:

```
`superset.terminals` view 從 TreeView 改為 WebviewView。
- 摺疊: 點 view title 的 chevron button 或命令面板 `Superset: Toggle Terminals Section`
- 狀態: 持久化到 `context.workspaceState` (key: `superset.panel.<SectionId>.collapsed`)
- 訊息契約: 見 `src/panelProtocol.ts`
```

「測試」段落更新測試案例數。

- [ ] **Step 3: Commit**

```bash
cd /Users/bytedance/projects/superset
git add README.md CLAUDE.md
git -c user.email=claude@anthropic.com -c user.name=Claude commit -m "docs: update README and CLAUDE.md for collapsible panel"
```

---

## Self-Review 檢核

跑 spec 對照檢核:

| Spec 需求 | 對應 Task |
|---|---|
| §1 view 區塊可收合 | Task 6 (panel.js) + Task 7 (PanelViewProvider) + Task 8 (toggle 命令) |
| §1 摺疊狀態持久化 | Task 2 (PanelStore) |
| §1 為 mDNS 預留 | Task 2 (`PanelSectionId` 含 `mdns`) + Task 7 (SECTIONS array) |
| §3 三層架構 | Task 2/3/4/5 (資料+協議+渲染) |
| §3.4 terminalId 反射 | Task 1 |
| §4 資料流 | Task 7 (訂閱 + postMessage) |
| §5 訊息契約 | Task 4 (router) + Task 5 (render) + Task 6 (panel.js wire) |
| §6 檔案結構 | Task 1-9 對應所有檔案 |
| §7 錯誤處理 | Task 1-7 全部 try/catch + log |
| §8 測試 | Task 1-5 新增測試 |
| §9 已知限制 | 透過降級方案(icon 固定 `$(chevron-up)`)處理 |

**Spec coverage:** 11 項全覆蓋。
**Placeholder scan:** 無 TBD / TODO;每個 code block 完整。
**Type consistency:** `TerminalEntry` (Task 1) → `getEntryByTerminal` (Task 3) → `getById` / `getEntryByTerminal` (Task 4) — 一致。

---

## 變更摘要 (Change Summary)

- **新增 7 檔**: `src/panelStore.ts`、`src/panelProtocol.ts`、`src/panelView.ts`、`media/panel.html`、`media/panel.css`、`media/panel.js`
- **新增 4 測試檔**: `test/panelStore.test.ts` (5 cases)、`test/buildTreeSnapshot.test.ts` (6 cases)、`test/panelProtocol.test.ts` (11 cases)、`test/renderTree.test.ts` (8 cases) — 共 30 新 cases
- **修改 5 檔**: `src/types.ts`、`src/terminalRegistry.ts`、`src/extension.ts`、`package.json`、`README.md`、`CLAUDE.md`
- **刪除 2 檔**: `src/treeProvider.ts`、`test/treeProvider.test.ts`
- **既有 48 tests 必須全綠** (Task 1 與 Task 8 處理)
- **本輪結束總計約 78 cases**
- **新 view type**:`superset.terminals` 從 `view` 改為 `webview`
- **新命令**:`superset.toggleTerminalsCollapsed`
- **新 persistence keys**:`superset.panel.terminals.collapsed`、`superset.panel.mdns.collapsed`
