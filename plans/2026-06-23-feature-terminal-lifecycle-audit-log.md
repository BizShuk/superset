# Terminal Lifecycle Audit Log 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 terminal 開/關/改名/換組/unseen 變化等 lifecycle 事件統一寫進既有的 `Superset` OutputChannel,讓用戶能完整回放「這條 session 發生了什麼」。

**Architecture:** 新增 `src/auditLog.ts` 模組,提供 `audit(event, payload)` 函式把事件寫入 OutputChannel(可注入)。在 `extension.ts` 既有的 `registry.onDidChange` / `groupStore` 變化點加上 audit 呼叫。為避免 noise,事件分 `info` / `debug` 兩級,debug 預設關閉,可在 `superset.auditLevel` setting 切換。

**Tech Stack:** TypeScript / Vitest / `vscode.OutputChannel` / 既有 `Superset` channel

---

## 1. 為何要做 (Why)

- **現有痛點**:`extension.ts` 內 `log()` 只在「可疑行為」印;一般 lifecycle 事件(開新 terminal、改名、移群組)沒有審計軌跡。
- **既有鋪墊**:Diagnostic channel `Superset` 已建立(`extension.ts:70`);`registry.onDidChange` 與 `groupStore` 已有事件介面;`OutputChannel.appendLine` 是同步 API,效能影響可忽略。
- **支援 debug**:很多終端機行為的 bug(「為什麼這個 terminal 自動被關了?」)需要 lifecycle 軌跡才能還原。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| OutputChannel 只有「registry.added / active-changed / shell-exec」等內部事件 | 加上「terminal renamed / moved / unseen-set / unseen-clear / group renamed / group deleted」 |
| 預設 verbose 模式,印很多 chunk | 預設 `info` 等級,chunk 級事件關閉;可由 setting 開 `debug` |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                    |
| ------ | ----------------------------- | ------------------------------------------------------- |
| Create | `src/auditLog.ts`             | `AuditLogger` class,可注入 OutputChannel 與 level      |
| Create | `test/auditLog.test.ts`       | 純函式 + 注入 channel 的測試                            |
| Modify | `src/extension.ts`            | 註冊 audit 訂閱 + 引入 `superset.auditLevel` setting    |
| Modify | `package.json`                | 加 `superset.auditLevel` enum setting                   |

---

## 4. 實作步驟 (Tasks)

### Task 1: AuditLogger + 測試 (TDD)

**Files:**
- Create: `src/auditLog.ts`
- Create: `test/auditLog.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/auditLog.test.ts
import { describe, it, expect, vi } from "vitest";
import { AuditLogger, type AuditLevel } from "../src/auditLog";

describe("AuditLogger", () => {
    function makeChannel() {
        return { appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() } as any;
    }

    it("info level records info events", () => {
        const ch = makeChannel();
        const log = new AuditLogger(ch, "info");
        log.info("terminal.opened", { name: "bash" });
        expect(ch.appendLine).toHaveBeenCalledWith(
            expect.stringContaining("[info] terminal.opened name=bash")
        );
    });

    it("info level skips debug events", () => {
        const ch = makeChannel();
        const log = new AuditLogger(ch, "info");
        log.debug("terminal.chunk", { bytes: 1024 });
        expect(ch.appendLine).not.toHaveBeenCalled();
    });

    it("debug level records both", () => {
        const ch = makeChannel();
        const log = new AuditLogger(ch, "debug");
        log.debug("terminal.chunk", { bytes: 1 });
        log.info("terminal.opened", { name: "bash" });
        expect(ch.appendLine).toHaveBeenCalledTimes(2);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- auditLog`
Expected: FAIL — 還沒定義。

- [ ] **Step 3: 實作 AuditLogger**

```typescript
// src/auditLog.ts
import type * as vscode from "vscode";

export type AuditLevel = "info" | "debug";

export interface AuditChannel {
    appendLine(line: string): void;
}

export class AuditLogger {
    constructor(
        private readonly channel: AuditChannel,
        private readonly level: AuditLevel = "info"
    ) {}

    public info(event: string, payload?: Record<string, unknown>): void {
        this.write("info", event, payload);
    }

    public debug(event: string, payload?: Record<string, unknown>): void {
        if (this.level !== "debug") return;
        this.write("debug", event, payload);
    }

    private write(
        level: AuditLevel,
        event: string,
        payload?: Record<string, unknown>
    ): void {
        const time = new Date().toISOString().slice(11, 23);
        const flat = payload
            ? Object.entries(payload)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(" ")
            : "";
        this.channel.appendLine(`[${time}] [${level}] ${event} ${flat}`.trim());
    }
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- auditLog`
Expected: 3 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/auditLog.ts test/auditLog.test.ts
git commit -m "feat(audit): add AuditLogger with info/debug levels"
```

### Task 2: extension.ts 串接

**Files:**
- Modify: `src/extension.ts:31-100`(activate 開頭)+ `extension.ts:91-101`(registry.onDidChange)

- [ ] **Step 1: 建 audit logger**

在 `extension.ts` `log()` 定義附近:

```typescript
const auditLevel = vscode.workspace
    .getConfiguration("superset")
    .get<AuditLevel>("auditLevel", "info");
const audit = new AuditLogger(
    { appendLine: (line) => diag.appendLine(`[audit] ${line}`) },
    auditLevel
);
```

- [ ] **Step 2: 訂閱 registry 事件 + groupStore 事件**

```typescript
registry.onDidChange((change) => {
    if (change.type === "added") {
        audit.info("terminal.added", { name: change.terminal.name });
    } else if (change.type === "removed") {
        audit.info("terminal.removed", { name: change.terminal.name });
    } else if (change.type === "unseenChanged") {
        audit.debug("terminal.unseen", {
            name: change.terminal.name,
            hasUnseen: change.hasUnseenOutput,
        });
    }
});

groupStore.onDidChange((change) => {
    audit.info("group.changed", { type: change.type });
});
```

> 註:`groupStore.onDidChange` 需為既有 API;若無,本 plan 加 Task 2.1 在 `groupStore.ts` 暴露事件。

- [ ] **Step 3: package.json 加 setting**

```json
"superset.auditLevel": {
    "type": "string",
    "enum": ["info", "debug"],
    "default": "info",
    "description": "Lifecycle audit 等級"
}
```

- [ ] **Step 4: 跑全部測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(audit): wire registry + groupStore events to audit log"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 3 個 auditLog test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `info` / `debug` / `appendLine` 名稱一致
  - [ ] `groupStore.onDidChange` 若不存在已在 Task 2.1 補上

- [ ] **Step 2: README.md「Diagnostic / Logging」段落補 audit 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document audit log setting"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| audit 把 OutputChannel 灌爆 | 預設 `info` 等級過濾 chunk;可在 setting 切到 `off`(本 plan 不實作,留 follow-up) | 刪 audit 訂閱 |
| 大量 `terminal.unseen` debug 訊息 | `debug` 等級預設關閉;要開要明確 setting | 同上 |
| groupStore 沒有事件 API | Task 2.1 加;若現有 API 結構不相容,改用輪詢(超出本 plan,記 follow-up) | 移除 groupStore 訂閱 |

---

## 6. 完成定義

- [ ] 3 個 auditLog test case 綠
- [ ] 啟用後,terminal.added / removed / unseen / group.changed 等事件都會進 OutputChannel
- [ ] setting `superset.auditLevel = debug` 可看到 chunk 級事件
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Terminal lifecycle audit log`
- 既有模組: `src/extension.ts:diag`, `src/terminalRegistry.ts:onDidChange`
- 測試位置: `test/auditLog.test.ts`
