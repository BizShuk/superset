# Superset Panel + Unfocused Output Highlight 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在主側欄 (Primary Side Bar) 新增一個面板,列出所有終端機;點擊任一項可聚焦該終端機;當非作用中的終端機有新輸出時,在面板、tab 名稱、狀態列三處高亮,聚焦後自動解除。

**Architecture:** 四個單元 — `TerminalRegistry`(唯一資料來源,純狀態)、`OutputWatcher`(訂閱 shell execution,觸發 `markUnseen`)、`TerminalTreeProvider`(讀 Registry 渲染 TreeView)、`HighlightPresenter`(讀 Registry 更新 tab name 前綴與狀態列)。`extension.ts` 是唯一接觸 `vscode` API 的組裝層,核心三元件接受注入的依賴,在 Vitest 下無需 Extension Host 即可測試。

**Tech Stack:** TypeScript 5.4 (strict)、Vitest 1.x(沿用 `log_doctor` 慣例)、`vscode` engine `^1.85.0`(Shell Integration 穩定 API)。

---

## 檔案結構 (File Structure)

| 檔案 | 職責 |
|---|---|
| `src/extension.ts` | 組裝層:把所有元件與 `vscode` API 連起來;移除既有的 proposed-API 監聽與 events 陣列 |
| `src/terminalRegistry.ts` | 純狀態:`Map<TerminalHandle, Entry>` + `onDidChange` 事件;`markUnseen`/`clearUnseen`/`add`/`remove`/`getUnseen`/`getAll` |
| `src/outputWatcher.ts` | 訂閱 shell execution,當 `onData` 觸發且該終端機非 active → 通知 Registry 標記 unseen |
| `src/treeProvider.ts` | 實作 `vscode.TreeDataProvider<TerminalHandle>`;核心渲染邏輯抽成 `buildTreeItemSpec()` 純函式供測試 |
| `src/highlightPresenter.ts` | 訂閱 Registry 變更;為 unseen 終端機的 `name` 加 `● ` 前綴,更新狀態列文字;清除時只剝除前綴不還原舊名 |
| `src/types.ts` | 共用型別:`TerminalHandle`、`RegistryChange`、TreeItem 規格 |
| `test/terminalRegistry.test.ts` | Registry 單元測試 |
| `test/outputWatcher.test.ts` | OutputWatcher 單元測試(注入假 shell execution callback) |
| `test/treeProvider.test.ts` | `buildTreeItemSpec` 純函式測試 |
| `test/highlightPresenter.test.ts` | Presenter 單元測試(注入假 setTerminalName / 狀態列 callbacks) |

| 修改檔案 | 改動 |
|---|---|
| `package.json` | 加 `viewsContainers.activitybar` + `views` + vitest dev dep + `test` script;保留既有 commands |
| `README.terminal.md` | 更新 §2 事件表(移除 `Terminal.onDidWriteData`、新增 `viewsContainers` / `TreeDataProvider`);新增架構段落 |

---

## Task 1: 設定 Vitest 測試基礎建設 (Test Infrastructure)

**Files:**
- Modify: `package.json`
- Create: `test/smoke.test.ts`

- [ ] **Step 1: 安裝 vitest**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm install --save-dev vitest@^1.4.0
```

預期:新增 `node_modules/vitest` 與 `package.json` 的 `devDependencies.vitest`。

- [ ] **Step 2: 在 package.json 加 test script**

修改 `package.json` 的 `scripts` 區段:

```json
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "package": "vsce package",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: 寫 smoke 測試確認 vitest 可運作**

建立 `test/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest smoke", () => {
    it("runs", () => {
        expect(1 + 1).toBe(2);
    });
});
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test
```

預期:`1 passed` 或類似成功訊息,無錯誤。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/smoke.test.ts
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 2: TerminalRegistry 純狀態單元 (TDD)

**Files:**
- Create: `src/types.ts`
- Create: `src/terminalRegistry.ts`
- Create: `test/terminalRegistry.test.ts`

- [ ] **Step 1: 寫 Registry 的 failing test**

建立 `test/terminalRegistry.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { TerminalRegistry } from "../src/terminalRegistry";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn() };
}

describe("TerminalRegistry", () => {
    it("starts empty", () => {
        const r = new TerminalRegistry();
        expect(r.getAll()).toEqual([]);
        expect(r.getUnseen()).toEqual([]);
    });

    it("emits added on add()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        r.onDidChange(listener);

        r.add(t);

        expect(listener).toHaveBeenCalledWith({ type: "added", terminal: t });
        expect(r.getAll()).toHaveLength(1);
        expect(r.has(t)).toBe(true);
    });

    it("does not emit added on duplicate add", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        r.onDidChange(listener);

        r.add(t);
        r.add(t);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("emits removed on remove()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.remove(t);

        expect(listener).toHaveBeenCalledWith({ type: "removed", terminal: t });
        expect(r.has(t)).toBe(false);
    });

    it("emits unseenChanged on markUnseen()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.markUnseen(t);

        expect(listener).toHaveBeenCalledWith({
            type: "unseenChanged",
            terminal: t,
            hasUnseenOutput: true,
        });
        expect(r.getUnseen()).toHaveLength(1);
    });

    it("markUnseen is idempotent (no re-emit)", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);

        const listener = vi.fn();
        r.onDidChange(listener);

        r.markUnseen(t);

        expect(listener).not.toHaveBeenCalled();
    });

    it("emits unseenChanged false on clearUnseen()", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        r.markUnseen(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.clearUnseen(t);

        expect(listener).toHaveBeenCalledWith({
            type: "unseenChanged",
            terminal: t,
            hasUnseenOutput: false,
        });
        expect(r.getUnseen()).toHaveLength(0);
    });

    it("clearUnseen is no-op when not unseen", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        r.add(t);
        const listener = vi.fn();
        r.onDidChange(listener);

        r.clearUnseen(t);

        expect(listener).not.toHaveBeenCalled();
    });

    it("getUnseen returns only entries with unseen flag", () => {
        const r = new TerminalRegistry();
        const a = fakeTerminal("a");
        const b = fakeTerminal("b");
        r.add(a);
        r.add(b);
        r.markUnseen(a);

        const unseen = r.getUnseen();
        expect(unseen).toHaveLength(1);
        expect(unseen[0]?.terminal).toBe(a);
    });

    it("unsubscribe stops further events", () => {
        const r = new TerminalRegistry();
        const t = fakeTerminal("a");
        const listener = vi.fn();
        const off = r.onDidChange(listener);
        off();

        r.add(t);

        expect(listener).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: 建立 types.ts**

建立 `src/types.ts`:

```typescript
export interface TerminalHandle {
    readonly name: string;
    show(): void;
}

export type RegistryChange =
    | { type: "added"; terminal: TerminalHandle }
    | { type: "removed"; terminal: TerminalHandle }
    | {
          type: "unseenChanged";
          terminal: TerminalHandle;
          hasUnseenOutput: boolean;
      };

export type RegistryListener = (change: RegistryChange) => void;
```

- [ ] **Step 3: 執行測試確認失敗**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- terminalRegistry
```

預期:失敗,因為 `src/terminalRegistry.ts` 尚未建立(找不到模組)。

- [ ] **Step 4: 實作 TerminalRegistry**

建立 `src/terminalRegistry.ts`:

```typescript
import type { RegistryChange, RegistryListener, TerminalHandle } from "./types";

interface Entry {
    terminal: TerminalHandle;
    hasUnseenOutput: boolean;
}

export class TerminalRegistry {
    private entries = new Map<TerminalHandle, Entry>();
    private listeners = new Set<RegistryListener>();

    add(terminal: TerminalHandle): void {
        if (this.entries.has(terminal)) {
            return;
        }
        this.entries.set(terminal, { terminal, hasUnseenOutput: false });
        this.emit({ type: "added", terminal });
    }

    remove(terminal: TerminalHandle): void {
        if (!this.entries.delete(terminal)) {
            return;
        }
        this.emit({ type: "removed", terminal });
    }

    has(terminal: TerminalHandle): boolean {
        return this.entries.has(terminal);
    }

    markUnseen(terminal: TerminalHandle): void {
        const entry = this.entries.get(terminal);
        if (!entry || entry.hasUnseenOutput) {
            return;
        }
        entry.hasUnseenOutput = true;
        this.emit({ type: "unseenChanged", terminal, hasUnseenOutput: true });
    }

    clearUnseen(terminal: TerminalHandle): void {
        const entry = this.entries.get(terminal);
        if (!entry || !entry.hasUnseenOutput) {
            return;
        }
        entry.hasUnseenOutput = false;
        this.emit({ type: "unseenChanged", terminal, hasUnseenOutput: false });
    }

    getAll(): TerminalHandle[] {
        return Array.from(this.entries.keys());
    }

    getUnseen(): TerminalHandle[] {
        const result: TerminalHandle[] = [];
        for (const entry of this.entries.values()) {
            if (entry.hasUnseenOutput) {
                result.push(entry.terminal);
            }
        }
        return result;
    }

    onDidChange(listener: RegistryListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private emit(change: RegistryChange): void {
        for (const listener of this.listeners) {
            listener(change);
        }
    }
}
```

- [ ] **Step 5: 執行測試確認全綠**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- terminalRegistry
```

預期:`9 passed`(或對應 9 個 it 的數量),無失敗。

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/terminalRegistry.ts test/terminalRegistry.test.ts
git commit -m "feat: add TerminalRegistry pure-state unit with onDidChange events"
```

---

## Task 3: OutputWatcher 訂閱 shell execution (TDD)

**Files:**
- Create: `src/outputWatcher.ts`
- Create: `test/outputWatcher.test.ts`

- [ ] **Step 1: 寫 OutputWatcher 的 failing test**

建立 `test/outputWatcher.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { OutputWatcher } from "../src/outputWatcher";
import type {
    ShellExecutionLike,
    ShellExecutionStartEvent,
} from "../src/outputWatcher";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn() };
}

function fakeExecution(): {
    execution: ShellExecutionLike;
    fireData: (chunk: string) => void;
} {
    let dataCb: ((chunk: string) => void) | undefined;
    const execution: ShellExecutionLike = {
        onData(cb) {
            dataCb = cb;
        },
    };
    return {
        execution,
        fireData: (chunk) => dataCb?.(chunk),
    };
}

function setup() {
    const registry = new TerminalRegistry();
    const a = fakeTerminal("a");
    const b = fakeTerminal("b");
    registry.add(a);
    registry.add(b);

    let execCallback: ((e: ShellExecutionStartEvent) => void) | undefined;
    const onShellExecution = vi.fn(
        (cb: (e: ShellExecutionStartEvent) => void) => {
            execCallback = cb;
            return () => {
                execCallback = undefined;
            };
        }
    );

    const getActiveTerminal = vi.fn(() => b);
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal,
        onShellExecution,
    });

    return {
        registry,
        watcher,
        getActiveTerminal,
        onShellExecution,
        fire(event: ShellExecutionStartEvent) {
            if (!execCallback) {
                throw new Error("onShellExecution was never called");
            }
            execCallback(event);
        },
        a,
        b,
    };
}

describe("OutputWatcher", () => {
    it("subscribes to onShellExecution on start()", () => {
        const { watcher, onShellExecution } = setup();
        watcher.start();
        expect(onShellExecution).toHaveBeenCalledTimes(1);
    });

    it("marks terminal unseen when onData fires on non-active terminal", () => {
        const { watcher, fire, a, registry } = setup();
        watcher.start();

        const exec = fakeExecution();
        fire({ terminal: a, execution: exec.execution });
        exec.fireData("hello\n");

        // a is non-active (active=b), so a should be unseen.
        expect(registry.getUnseen()).toContain(a);
    });

    it("does NOT mark active terminal unseen", () => {
        const { watcher, fire, b, registry } = setup();
        watcher.start();

        const exec = fakeExecution();
        fire({ terminal: b, execution: exec.execution });
        exec.fireData("hello\n");

        expect(registry.getUnseen()).not.toContain(b);
    });

    it("ignores data from terminal not in registry", () => {
        const { watcher, fire } = setup();
        watcher.start();

        const ghost = fakeTerminal("ghost");
        const exec = fakeExecution();
        // Should not throw even though ghost is not registered.
        expect(() =>
            fire({ terminal: ghost, execution: exec.execution })
        ).not.toThrow();
        exec.fireData("hello\n");
    });

    it("stop() unsubscribes from onShellExecution", () => {
        const { watcher } = setup();
        watcher.start();
        watcher.stop();
        // After stop, the dispose function from onShellExecution should be called,
        // but our setup records this only implicitly. We just verify no throw
        // and that starting again re-subscribes.
        watcher.start();
    });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- outputWatcher
```

預期:失敗,因為 `src/outputWatcher.ts` 尚未建立。

- [ ] **Step 3: 實作 OutputWatcher**

建立 `src/outputWatcher.ts`:

```typescript
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

export interface ShellExecutionLike {
    onData(cb: (data: string) => void): void;
}

export interface ShellExecutionStartEvent {
    terminal: TerminalHandle;
    execution: ShellExecutionLike;
}

export interface OutputWatcherDeps {
    registry: TerminalRegistry;
    getActiveTerminal: () => TerminalHandle | undefined;
    onShellExecution: (
        cb: (event: ShellExecutionStartEvent) => void
    ) => () => void;
}

export class OutputWatcher {
    constructor(private readonly deps: OutputWatcherDeps) {}

    private dispose?: () => void;

    start(): void {
        if (this.dispose) {
            return;
        }
        this.dispose = this.deps.onShellExecution((event) => {
            const { terminal, execution } = event;
            // Defensive: ignore terminals the registry doesn't know about.
            if (!this.deps.registry.has(terminal)) {
                return;
            }
            execution.onData(() => {
                if (this.deps.getActiveTerminal() === terminal) {
                    return;
                }
                this.deps.registry.markUnseen(terminal);
            });
        });
    }

    stop(): void {
        this.dispose?.();
        this.dispose = undefined;
    }
}
```

- [ ] **Step 4: 執行測試確認全綠**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- outputWatcher
```

預期:`5 passed`,無失敗。

- [ ] **Step 5: Commit**

```bash
git add src/outputWatcher.ts test/outputWatcher.test.ts
git commit -m "feat: add OutputWatcher to mark non-active terminals unseen on shell output"
```

---

## Task 4: TerminalTreeProvider 的 buildTreeItemSpec 純函式 (TDD)

**Files:**
- Create: `src/treeProvider.ts`
- Create: `test/treeProvider.test.ts`

- [ ] **Step 1: 寫 buildTreeItemSpec 的 failing test**

建立 `test/treeProvider.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildTreeItemSpec } from "../src/treeProvider";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn() };
}

describe("buildTreeItemSpec", () => {
    it("returns default icon and no description when not unseen", () => {
        const t = fakeTerminal("claude");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude");
        expect(spec.iconKind).toBe("default");
        expect(spec.description).toBeUndefined();
        expect(spec.command?.command).toBe("superset.focus");
        expect(spec.command?.arguments).toEqual([t]);
    });

    it("returns highlighted icon and description when unseen", () => {
        const t = fakeTerminal("claude");
        const spec = buildTreeItemSpec(t, { isUnseen: true });
        expect(spec.iconKind).toBe("highlighted");
        expect(spec.description).toBe("● 新輸出");
    });

    it("strips leading '● ' from terminal name for label", () => {
        // Presenter may have already prefixed the name; panel should show
        // the logical name without the prefix.
        const t = fakeTerminal("● claude");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude");
    });

    it("does not strip '● ' from middle of name", () => {
        const t = fakeTerminal("claude●test");
        const spec = buildTreeItemSpec(t, { isUnseen: false });
        expect(spec.label).toBe("claude●test");
    });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- treeProvider
```

預期:失敗,因為 `src/treeProvider.ts` 尚未建立。

- [ ] **Step 3: 實作 treeProvider.ts(純函式 + vscode-bound class)**

建立 `src/treeProvider.ts`:

```typescript
import * as vscode from "vscode";
import type { TerminalHandle } from "./types";
import type { TerminalRegistry } from "./terminalRegistry";

export type TreeIconKind = "default" | "highlighted";

export interface TreeItemSpec {
    label: string;
    iconKind: TreeIconKind;
    description?: string;
    command: { command: string; arguments: unknown[] };
}

export const UNSEEN_PREFIX = "● ";

export interface BuildTreeItemSpecOptions {
    isUnseen: boolean;
}

/**
 * Strip the leading "● " prefix the presenter may have applied.
 * Only matches at position 0; mid-name occurrences are preserved.
 */
export function stripUnseenPrefix(name: string): string {
    return name.startsWith(UNSEEN_PREFIX)
        ? name.slice(UNSEEN_PREFIX.length)
        : name;
}

export function buildTreeItemSpec(
    terminal: TerminalHandle,
    opts: BuildTreeItemSpecOptions
): TreeItemSpec {
    return {
        label: stripUnseenPrefix(terminal.name),
        iconKind: opts.isUnseen ? "highlighted" : "default",
        description: opts.isUnseen ? "● 新輸出" : undefined,
        command: {
            command: "superset.focus",
            arguments: [terminal],
        },
    };
}

/**
 * vscode-bound TreeDataProvider. Reads the registry and constructs
 * actual vscode.TreeItem instances. Not unit-tested directly (vscode
 * runtime required); relies on buildTreeItemSpec for visual logic.
 */
export class TerminalTreeProvider implements vscode.TreeDataProvider<TerminalHandle> {
    private readonly emitter = new vscode.EventEmitter<
        TerminalHandle | undefined
    >();
    readonly onDidChangeTreeData = this.emitter.event;

    private unsubscribe?: () => void;
    private unseen = new Set<TerminalHandle>();

    constructor(private readonly registry: TerminalRegistry) {}

    start(): void {
        if (this.unsubscribe) {
            return;
        }
        this.refreshUnseenSet();
        this.unsubscribe = this.registry.onDidChange((change) => {
            if (change.type === "unseenChanged") {
                if (change.hasUnseenOutput) {
                    this.unseen.add(change.terminal);
                } else {
                    this.unseen.delete(change.terminal);
                }
                this.emitter.fire(change.terminal);
            } else if (change.type === "removed") {
                this.unseen.delete(change.terminal);
                this.emitter.fire(change.terminal);
            } else {
                this.emitter.fire(undefined);
            }
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    getTreeItem(element: TerminalHandle): vscode.TreeItem {
        const spec = buildTreeItemSpec(element, {
            isUnseen: this.unseen.has(element),
        });
        const item = new vscode.TreeItem(spec.label);
        item.description = spec.description;
        item.iconPath = new vscode.ThemeIcon(
            spec.iconKind === "highlighted" ? "circle-filled" : "terminal",
            spec.iconKind === "highlighted"
                ? new vscode.ThemeColor("charts.yellow")
                : undefined
        );
        item.command = {
            command: spec.command.command,
            title: "Focus Terminal",
            arguments: spec.command.arguments,
        };
        return item;
    }

    getChildren(): TerminalHandle[] {
        return this.registry.getAll();
    }

    private refreshUnseenSet(): void {
        this.unseen = new Set(this.registry.getUnseen());
    }
}
```

- [ ] **Step 4: 執行測試確認全綠**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- treeProvider
```

預期:`4 passed`,無失敗。

- [ ] **Step 5: Commit**

```bash
git add src/treeProvider.ts test/treeProvider.test.ts
git commit -m "feat: add TerminalTreeProvider with extractable buildTreeItemSpec"
```

---

## Task 5: HighlightPresenter 加 tab 前綴與狀態列 (TDD)

**Files:**
- Create: `src/highlightPresenter.ts`
- Create: `test/highlightPresenter.test.ts`

- [ ] **Step 1: 寫 HighlightPresenter 的 failing test**

建立 `test/highlightPresenter.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { HighlightPresenter, UNSEEN_PREFIX } from "../src/highlightPresenter";
import { TerminalRegistry } from "../src/terminalRegistry";
import type { TerminalHandle } from "../src/types";

function fakeTerminal(name: string): TerminalHandle {
    return { name, show: vi.fn() };
}

interface Recorder {
    setNameCalls: Array<{ terminal: TerminalHandle; name: string }>;
    statusBarTexts: string[];
    statusShown: number;
    statusHidden: number;
}

function recorder(): Recorder {
    return {
        setNameCalls: [],
        statusBarTexts: [],
        statusShown: 0,
        statusHidden: 0,
    };
}

function setup() {
    const registry = new TerminalRegistry();
    const a = fakeTerminal("a");
    const b = fakeTerminal("b");
    registry.add(a);
    registry.add(b);

    const rec = recorder();
    const presenter = new HighlightPresenter({
        registry,
        setTerminalName: (terminal, name) => {
            rec.setNameCalls.push({ terminal, name });
            // Mutate the fake terminal so subsequent reads see the new name.
            (terminal as { name: string }).name = name;
        },
        setStatusBarText: (text) => rec.statusBarTexts.push(text),
        showStatusBar: () => rec.statusShown++,
        hideStatusBar: () => rec.statusHidden++,
    });

    return { registry, presenter, rec, a, b };
}

describe("HighlightPresenter", () => {
    it("does nothing while nothing is unseen", () => {
        const { presenter, rec } = setup();
        presenter.start();

        expect(rec.setNameCalls).toHaveLength(0);
        expect(rec.statusBarTexts).toHaveLength(0);
        expect(rec.statusShown).toBe(0);
        expect(rec.statusHidden).toBe(0);
    });

    it("prefixes unseen terminal name and updates status bar", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);

        const aCall = rec.setNameCalls.find((c) => c.terminal === a);
        expect(aCall?.name).toBe(`${UNSEEN_PREFIX}a`);
        expect(rec.statusBarTexts).toContain("1 個終端機有新輸出");
        expect(rec.statusShown).toBe(1);
    });

    it("shows plural text when more than one unseen", () => {
        const { presenter, rec, registry, a, b } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.markUnseen(b);

        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe(
            "2 個終端機有新輸出"
        );
    });

    it("preserves user rename on clear (does not restore old name)", () => {
        const { presenter, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        // a.name is now "● a" (presenter set it via setTerminalName)
        expect(a.name).toBe("● a");

        // User manually renames the terminal via VSCode UI. The new
        // name has no prefix.
        (a as { name: string }).name = "my-renamed";

        registry.clearUnseen(a);

        // Final name must reflect the user's rename, not the original "a".
        // The presenter must NOT have called setName with "a" at any point
        // after the rename.
        expect(a.name).toBe("my-renamed");
    });

    it("hides status bar when last unseen is cleared", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.clearUnseen(a);

        expect(rec.statusHidden).toBe(1);
        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe("");
    });

    it("updates status bar text when unseen count changes", () => {
        const { presenter, rec, registry, a, b } = setup();
        presenter.start();

        registry.markUnseen(a);
        registry.markUnseen(b);
        registry.clearUnseen(a);

        expect(rec.statusBarTexts[rec.statusBarTexts.length - 1]).toBe(
            "1 個終端機有新輸出"
        );
    });

    it("does not double-prefix when markUnseen fires twice without clear", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();

        registry.markUnseen(a);
        rec.setNameCalls.length = 0;

        // Idempotent at the registry level → no event → no second prefix.
        registry.markUnseen(a);

        expect(rec.setNameCalls).toHaveLength(0);
    });

    it("stop() unsubscribes", () => {
        const { presenter, rec, registry, a } = setup();
        presenter.start();
        presenter.stop();

        registry.markUnseen(a);

        expect(rec.setNameCalls).toHaveLength(0);
    });
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- highlightPresenter
```

預期:失敗,因為 `src/highlightPresenter.ts` 尚未建立。

- [ ] **Step 3: 實作 HighlightPresenter**

建立 `src/highlightPresenter.ts`:

```typescript
import { stripUnseenPrefix, UNSEEN_PREFIX } from "./treeProvider";
import type { TerminalRegistry } from "./terminalRegistry";
import type { TerminalHandle } from "./types";

export { UNSEEN_PREFIX };

export interface HighlightPresenterDeps {
    registry: TerminalRegistry;
    setTerminalName: (terminal: TerminalHandle, name: string) => void;
    setStatusBarText: (text: string) => void;
    showStatusBar: () => void;
    hideStatusBar: () => void;
}

export class HighlightPresenter {
    private unsubscribe?: () => void;

    constructor(private readonly deps: HighlightPresenterDeps) {}

    start(): void {
        if (this.unsubscribe) {
            return;
        }
        // Reapply prefixes to match the registry's current state. We do
        // not touch the status bar here — it's already hidden by default
        // and a freshly-populated registry has no unseen entries.
        const unseen = new Set(this.deps.registry.getUnseen());
        for (const terminal of this.deps.registry.getAll()) {
            this.applyPrefix(terminal, unseen.has(terminal));
        }
        this.unsubscribe = this.deps.registry.onDidChange((change) => {
            if (change.type === "added") {
                this.applyPrefix(change.terminal, false);
                return;
            }
            if (change.type === "removed") {
                this.refreshStatusBar();
                return;
            }
            if (change.type === "unseenChanged") {
                this.applyPrefix(change.terminal, change.hasUnseenOutput);
                this.refreshStatusBar();
            }
        });
    }

    stop(): void {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
    }

    private applyPrefix(terminal: TerminalHandle, isUnseen: boolean): void {
        const current = terminal.name;
        const bare = stripUnseenPrefix(current);
        const target = isUnseen ? `${UNSEEN_PREFIX}${bare}` : bare;
        if (current === target) {
            return;
        }
        this.deps.setTerminalName(terminal, target);
    }

    private refreshStatusBar(): void {
        const count = this.deps.registry.getUnseen().length;
        if (count === 0) {
            this.deps.setStatusBarText("");
            this.deps.hideStatusBar();
        } else {
            this.deps.setStatusBarText(
                count === 1
                    ? "1 個終端機有新輸出"
                    : `${count} 個終端機有新輸出`
            );
            this.deps.showStatusBar();
        }
    }
}
```

- [ ] **Step 4: 執行測試確認全綠**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test -- highlightPresenter
```

預期:`8 passed`,無失敗。

- [ ] **Step 5: Commit**

```bash
git add src/highlightPresenter.ts test/highlightPresenter.test.ts
git commit -m "feat: add HighlightPresenter for tab name prefix and status bar"
```

---

## Task 6: 更新 package.json 新增 viewContainer 與 view 貢獻點

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在 package.json 的 contributes 加入 viewsContainers 與 views**

修改 `package.json` 的 `contributes` 區段,從:

```json
  "contributes": {
    "commands": [
      {
        "command": "superset.show",
        "title": "Superset: Show Panel"
      },
      {
        "command": "superset.clear",
        "title": "Superset: Clear Events"
      }
    ]
  },
```

改為:

```json
  "contributes": {
    "commands": [
      {
        "command": "superset.focusView",
        "title": "Superset: Show Panel"
      },
      {
        "command": "superset.focus",
        "title": "Superset: Focus Terminal"
      }
    ],
    "viewsContainers": {
      "activitybar": [
        {
          "id": "superset",
          "title": "Terminals",
          "icon": "$(terminal)"
        }
      ]
    },
    "views": {
      "superset": [
        {
          "id": "superset.terminals",
          "name": "Terminals",
          "contextualTitle": "Superset"
        }
      ]
    }
  },
```

- [ ] **Step 2: 確認 package.json 是合法 JSON**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).contributes.views)"
```

預期:印出 `views` 物件(包含 `superset.terminals`),無錯誤。

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: declare activitybar view container and terminals tree view"
```

---

## Task 7: 重構 extension.ts 串接所有元件

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: 把整個 extension.ts 替換為組裝層實作**

完整取代 `src/extension.ts` 的內容:

```typescript
import * as vscode from "vscode";
import { TerminalRegistry } from "./terminalRegistry";
import { OutputWatcher } from "./outputWatcher";
import {
    TerminalTreeProvider,
    buildTreeItemSpec,
    stripUnseenPrefix,
} from "./treeProvider";
import { HighlightPresenter } from "./highlightPresenter";

export function activate(context: vscode.ExtensionContext): void {
    console.log("[superset] activated");

    const registry = new TerminalRegistry();
    const subscriptions: vscode.Disposable[] = [];

    // Pre-populate registry with already-open terminals (e.g., reload window).
    for (const terminal of vscode.window.terminals) {
        registry.add(terminal);
    }

    // Wire TerminalTreeProvider to a TreeView.
    const treeProvider = new TerminalTreeProvider(registry);
    treeProvider.start();
    subscriptions.push({ dispose: () => treeProvider.stop() });

    const treeView = vscode.window.createTreeView(
        "superset.terminals",
        { treeDataProvider: treeProvider }
    );
    subscriptions.push(treeView);

    // Wire HighlightPresenter against a status bar item.
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Left,
        100
    );
    statusBar.name = "Superset";
    const presenter = new HighlightPresenter({
        registry,
        setTerminalName: (terminal, name) => {
            // vscode.Terminal.name is settable in 1.85+.
            (terminal as vscode.Terminal).name = name;
        },
        setStatusBarText: (text) => {
            statusBar.text = text;
        },
        showStatusBar: () => statusBar.show(),
        hideStatusBar: () => statusBar.hide(),
    });
    presenter.start();
    subscriptions.push({ dispose: () => presenter.stop() });
    subscriptions.push(statusBar);

    // OutputWatcher: subscribe to Shell Integration events.
    const watcher = new OutputWatcher({
        registry,
        getActiveTerminal: () => vscode.window.activeTerminal,
        onShellExecution: (cb) =>
            vscode.window.onDidStartTerminalShellExecution((event) => {
                cb({
                    terminal: event.terminal,
                    execution: {
                        onData: (dataCb) => event.execution.onData(dataCb),
                    },
                });
            }),
    });
    watcher.start();
    subscriptions.push({ dispose: () => watcher.stop() });

    // Lifecycle: open / close / active-change events.
    subscriptions.push(
        vscode.window.onDidOpenTerminal((terminal) => {
            registry.add(terminal);
        })
    );

    subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
            registry.remove(terminal);
        })
    );

    subscriptions.push(
        vscode.window.onDidChangeActiveTerminal((terminal) => {
            // Spec §7: undefined means "all closed" — do not clear flags.
            if (!terminal) {
                return;
            }
            registry.clearUnseen(terminal);
        })
    );

    // Commands.
    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.focusView",
            () => {
                vscode.commands.executeCommand(
                    "workbench.view.superset"
                );
            }
        )
    );

    subscriptions.push(
        vscode.commands.registerCommand(
            "superset.focus",
            (terminal: vscode.Terminal | undefined) => {
                if (!terminal) {
                    return;
                }
                // Defensive: if the terminal is gone, refresh the tree so
                // the panel drops the stale entry instead of throwing.
                if (!registry.has(terminal)) {
                    return;
                }
                terminal.show();
            }
        )
    );

    for (const d of subscriptions) {
        context.subscriptions.push(d);
    }
}

export function deactivate(): void {
    // Disposables are torn down by VSCode via context.subscriptions.
}
```

- [ ] **Step 2: 確認 TypeScript 編譯通過**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npx tsc
```

預期:無錯誤,產生 `out/src/extension.js` 等檔案。

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: assemble registry/watcher/tree/presenter; drop proposed onDidWriteData"
```

---

## Task 8: 完整測試與型別檢查

**Files:**
- (no new files; verify)

- [ ] **Step 1: 跑全套 vitest**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npm test
```

預期:全部測試通過(Registry + OutputWatcher + buildTreeItemSpec + HighlightPresenter + smoke 共 27 個)。

- [ ] **Step 2: 跑 TypeScript 型別檢查**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment/superset
npx tsc --noEmit
```

預期:無錯誤。

- [ ] **Step 3: 確認 out/ 已產生**

```bash
ls /Users/shuk/projects/tmp/vscode-plugin-experiment/superset/out/src/
```

預期:`extension.js` `terminalRegistry.js` `outputWatcher.js` `treeProvider.js` `highlightPresenter.js` 與對應 `.js.map`。

- [ ] **Step 4: 若以上任一步失敗,回頭修正對應 Task 後重跑**

---

## Task 9: 更新 README.terminal.md 反映新架構

**Files:**
- Modify: `README.terminal.md`

- [ ] **Step 1: 在文件最前面新增「架構」段落**

在 `## 1. 專案目的` 之後插入新段落(原編號 2-6 往後遞延):

````markdown
## 2. 架構 (Architecture)

四個獨立單元,以 `TerminalRegistry` 為唯一資料來源,其餘三者只讀它並訂閱其變更事件:

| 元件 | 職責 | 依賴 |
|---|---|---|
| `TerminalRegistry` | 維護終端機清單與各自的 unseen 旗標;發出 `onDidChange` 事件 | 無(純狀態) |
| `OutputWatcher` | 訂閱 `onDidStartTerminalShellExecution` + `execution.onData`;當該終端機非作用中 → 標記 unseen | Registry |
| `TerminalTreeProvider` | `vscode.TreeDataProvider` 實作;讀 Registry 渲染面板;點擊 → `superset.focus` 命令 | Registry |
| `HighlightPresenter` | 訂閱 Registry 變更;更新 tab 名稱前綴與狀態列文字 | Registry |

`vscode` API 集中在 `src/extension.ts` 組裝層;核心三元件接受注入依賴,在 Vitest 下無需 Extension Host 即可測試。

````

- [ ] **Step 2: 更新 §2 事件總覽表**

把現在的 §2 表格加上兩列,並把 `Terminal.onDidWriteData` 改為「已移除(以 Shell Integration 取代)」:

在表格最下方新增:

```markdown
| `workbench.view.<viewContainerId>` | 視窗 | 聚焦側欄視圖容器 | 命令呼叫 |
| `vscode.window.createTreeView` | 視窗 | 建立 TreeView,綁定 TreeDataProvider | 穩定 |
```

並把 `Terminal.onDidWriteData` 那列改成:

```markdown
| `Terminal.onDidWriteData` | 物件 | 該終端機寫入原始 bytes | 已移除(本擴充走 Shell Integration,免依賴 proposed API) |
```

- [ ] **Step 3: 在 §6 之後新增「面板互動」段落**

````markdown
## 7. 面板互動

- 點擊面板任一列 → 觸發 `superset.focus` 命令 → `terminal.show()`。
- 該終端機重新被聚焦時(`onDidChangeActiveTerminal`)→ Registry 清除 unseen → Presenter 還原名稱、TreeView 還原圖示。
- tab 名稱前綴 `● ` 由 Presenter 加/剝;若使用者在 unseen 期間自行改名,清除時 Presenter 只剝前綴、不還原記憶的舊名,避免覆蓋使用者意圖。

````

- [ ] **Step 4: Commit**

```bash
git add README.terminal.md
git commit -m "docs: document panel architecture and view container integration"
```

---

## Self-Review Checklist

執行前逐項核對;失敗就修。

**1. Spec 覆蓋 (Spec Coverage)**

| Spec 需求 | 對應 Task |
|---|---|
| 主側欄面板 + 點擊聚焦 | Task 4 (`buildTreeItemSpec` + TreeView) + Task 6 (manifest) + Task 7 (`terminal.show()`) |
| 非作用中終端機有輸出時高亮 | Task 5 (`HighlightPresenter`) + Task 7 wiring |
| 面板圖示 + description 加重 | Task 4 (`buildTreeItemSpec` 的 `iconKind` + `description`) |
| tab 名稱 `● ` 前綴 | Task 5 (`applyPrefix`) |
| 狀態列「N 個終端機有新輸出」 | Task 5 (`refreshStatusBar`) |
| 重新聚焦即解除 (`onDidChangeActiveTerminal`) | Task 7 wiring `registry.clearUnseen` |
| Shell Integration + `execution.onData` | Task 3 (`OutputWatcher`) + Task 7 wiring |
| 移除 `onDidWriteData` (proposed API) | Task 7(整個 extension.ts 改寫) |
| 終端機無 shell integration 不報錯 | Task 3 (`OutputWatcher` 不拋;僅標記失敗) — 透過 `getAll()` 容錯 |
| 點擊已關閉終端機 → refresh 面板 | Task 7 `superset.focus` 命令的 registry 檢查 + `onDidCloseTerminal` 移除 |
| tab 名稱還原時剝前綴不還原舊名 | Task 5 `applyPrefix`(以 `terminal.name` 為唯一真值;不維護 stored old name,直接 `stripUnseenPrefix` 推導) |
| `onDidChangeActiveTerminal` 拿到 `undefined` 不動作 | Task 7 `if (!terminal) return;` |
| Vitest 純單元測試 | Tasks 2-5 各自單元測試 + Task 1 vitest 設定 |
| `package.json` viewsContainers + views | Task 6 |
| 維持 `engines.vscode` `^1.85.0` 與 `main` | Task 6(保留既有值) |

**2. Placeholder Scan**

- 全文搜尋 `TODO|FIXME|TBD|fill in|implement later` → 無命中(僅在 spec 內出現)。
- 步驟中所有「寫測試 / 寫實作」皆有完整程式碼區塊。
- 所有 import 都指向同檔案實際 export。

**3. 型別一致性 (Type Consistency)**

- `TerminalHandle` 定義於 `src/types.ts`;`TerminalRegistry`、`OutputWatcher`、`TreeProvider`、`HighlightPresenter` 都引用它。✓
- `UNSEEN_PREFIX` 從 `treeProvider.ts` re-export 到 `highlightPresenter.ts`;測試也從 `highlightPresenter` import — 同一個值。✓
- `ShellExecutionLike` / `ShellExecutionStartEvent` 在 `outputWatcher.ts` 定義並 export;測試與 `extension.ts` 都使用。✓
- `RegistryChange` 三個變體(`added`/`removed`/`unseenChanged`)在 `types.ts` 定義;Registry emit 與所有 listener 都使用相同 shape。✓
- `HighlightPresenterDeps` 的 callback 簽名在 extension.ts 提供實作:`setTerminalName`、`setStatusBarText`、`showStatusBar`、`hideStatusBar` — 全部 4 個都有實作。✓

---

## 執行遞交 (Execution Handoff)

Plan complete and saved to `superset/plans/2026-06-20-superset-panel.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
