# mDNS One-Click Connect 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mDNS TreeView 為每個 service 加 "Connect" 動作 — 依 service type 自動決定 `ssh <user>@<host>` / `open <scheme>` 並 spawn PTY-backed terminal。

**Architecture:** 新增 `superset.mdnsConnect` 命令,接受 `MdnsService` 參數;內部透過 `MdnsRegistry` 拿到 service,呼叫 `resolveConnectCommand(svc)` 純函式決定要 spawn 的命令字串,然後用既有 `PtyTerminalHost` 流程開新 terminal(類似 `superset.openTuiTerminal` 的 wiring,但寫到 PTY stdin)。Service type 對照:`_ssh` → `ssh`;`_http` / `_https` → `open`;`_ipp` / `_ipps` → `open`;其他 → 退回 quick pick 問用戶選動作。

**Tech Stack:** TypeScript / Vitest / `vscode.commands` / `PtyTerminalHost`

---

## 1. 為何要做 (Why)

- **現有痛點**:mDNS 列表可以看到印表機 / ssh 主機 / NAS,但用戶還得手動 `ssh pi@nas.local`,動作鏈長。
- **既有鋪墊**:`MdnsRegistry` 已解出 `host` / `addresses` / `port`;`PtyTerminalHost` 與 `node-pty` 整合已穩定(見 `CLAUDE.md` TUI 偵測方案 5)。
- **低風險**:只新增「按下 → spawn 一個 terminal」,不動既有偵測鏈。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| mDNS 列表只有「複製位址 / 顯示細節」 | 多一個「Connect」動作,直接開新 PTY terminal 連線 |
| 連線後切到該 terminal 需手動找 | 新 terminal 名稱格式:`Connect: <service name>`,並在 group 內排在最上 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                                |
| ------ | ----------------------------- | ------------------------------------------------------------------- |
| Create | `src/mdnsConnect.ts`          | 純函式 `resolveConnectCommand(svc): { cmd, args } \| null`           |
| Create | `test/mdnsConnect.test.ts`    | 純函式單元測試                                                      |
| Modify | `src/extension.ts`            | 註冊 `superset.mdnsConnect` + 重構 `spawnPtyTerminal` 接受自訂命令 |
| Modify | `package.json`                | 加 command + context menu                                           |
| Modify | `src/ptyTerminalHost.ts`      | 新增 optional `initialCommand?: string` 參數                        |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式解析 + 測試 (TDD)

**Files:**
- Create: `src/mdnsConnect.ts`
- Create: `test/mdnsConnect.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/mdnsConnect.test.ts
import { describe, it, expect } from "vitest";
import { resolveConnectCommand } from "../src/mdnsConnect";

const baseSvc = {
    name: "pi@nas",
    host: "nas.local",
    addresses: ["192.168.1.10"],
    port: 22,
    type: "_ssh._tcp",
} as any;

describe("resolveConnectCommand", () => {
    it("returns ssh for _ssh services", () => {
        const r = resolveConnectCommand(baseSvc);
        expect(r).toEqual({ cmd: "ssh", args: ["pi@nas.local"] });
    });

    it("returns ssh for _sftp services", () => {
        const r = resolveConnectCommand({ ...baseSvc, type: "_sftp._tcp" });
        expect(r?.cmd).toBe("ssh");
    });

    it("returns open for _http services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "router",
            type: "_http._tcp",
            port: 80,
        });
        expect(r).toEqual({ cmd: "open", args: ["http://nas.local:80"] });
    });

    it("returns null when host is missing (cannot connect)", () => {
        const r = resolveConnectCommand({ ...baseSvc, host: undefined });
        expect(r).toBeNull();
    });

    it("returns open with scheme for _ipp services", () => {
        const r = resolveConnectCommand({
            ...baseSvc,
            name: "printer",
            type: "_ipp._tcp",
            port: 631,
        });
        expect(r).toEqual({ cmd: "open", args: ["ipp://nas.local:631"] });
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- mdnsConnect`
Expected: FAIL — `resolveConnectCommand` 還沒定義。

- [ ] **Step 3: 實作純函式**

```typescript
// src/mdnsConnect.ts
import type { MdnsService } from "./types";

export interface ConnectCommand {
    readonly cmd: string;
    readonly args: readonly string[];
}

const SSH_TYPES = new Set(["_ssh._tcp", "_sftp._tcp"]);
const HTTP_TYPES = new Set(["_http._tcp", "_https._tcp"]);
const IPP_TYPES = new Set(["_ipp._tcp", "_ipps._tcp"]);

export function resolveConnectCommand(
    svc: Pick<MdnsService, "name" | "host" | "addresses" | "port" | "type">
): ConnectCommand | null {
    const target = svc.host ?? svc.addresses[0];
    if (!target) return null;

    if (SSH_TYPES.has(svc.type)) {
        const user = svc.name.includes("@") ? svc.name : `user@${target}`;
        return { cmd: "ssh", args: [user] };
    }
    if (HTTP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_https._tcp" ? "https" : "http";
        return {
            cmd: "open",
            args: [`${scheme}://${target}:${svc.port}`],
        };
    }
    if (IPP_TYPES.has(svc.type)) {
        const scheme = svc.type === "_ipps._tcp" ? "ipps" : "ipp";
        return {
            cmd: "open",
            args: [`${scheme}://${target}:${svc.port}`],
        };
    }
    return null;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- mdnsConnect`
Expected: PASS — 5 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/mdnsConnect.ts test/mdnsConnect.test.ts
git commit -m "feat(mdns): add pure resolveConnectCommand helper"
```

### Task 2: PtyTerminalHost 接受 initialCommand

**Files:**
- Modify: `src/ptyTerminalHost.ts:1-30`(建構參數)

- [ ] **Step 1: 加 constructor 參數**

找到 `PtyTerminalHost` 的 options 介面,加:

```typescript
readonly initialCommand?: string;
```

- [ ] **Step 2: 在 `open()` 內,spawn 之後 `write(initialCommand + "\n")`**

```typescript
// ptyTerminalHost.ts
open(initialDimensions: { columns: number; rows: number }): void {
    this.proc = this.spawn(this.shell, this.args, {
        cwd: this.cwd,
        env: this.env as Record<string, string>,
        cols: initialDimensions.columns,
        rows: initialDimensions.rows,
    });
    this.proc.onData((d) => this.detectActivity(d));
    this.proc.onExit((code) => this.handleExit(code));

    if (this.initialCommand) {
        // Defer one tick: shell may not be ready immediately.
        setTimeout(() => this.proc?.write(`${this.initialCommand}\n`), 50);
    }
}
```

> 註:`this.proc` 需為 `PtyProcess | undefined`,並 guard 掉 `?.write` 避免 race。

- [ ] **Step 3: 跑既有 PtyTerminalHost 測試確認沒壞**

Run: `npm test -- ptyTerminalHost`
Expected: 14 個既有 case 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/ptyTerminalHost.ts
git commit -m "feat(pty): support initialCommand for spawn-and-run"
```

### Task 3: 命令 + wiring

**Files:**
- Modify: `src/extension.ts`(在 `superset.mdnsCopy` 命令旁)
- Modify: `package.json:90-100`(context menu 區)

- [ ] **Step 1: extension.ts 註冊命令**

```typescript
subscriptions.push(
    vscode.commands.registerCommand(
        "superset.mdnsConnect",
        async (svc: MdnsService | undefined) => {
            if (!svc) return;
            const plan = resolveConnectCommand(svc);
            if (!plan) {
                vscode.window.showWarningMessage(
                    `Superset: 未知 service type "${svc.type}",無法連線`
                );
                return;
            }
            const cwd =
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
                process.cwd();
            const initialCommand = [plan.cmd, ...plan.args].join(" ");
            spawnPtyTerminal(
                `Connect: ${svc.name}`,
                cwd,
                initialCommand
            ).show();
        }
    )
);
```

並把 `spawnPtyTerminal` 改成接受第三個參數:

```typescript
function spawnPtyTerminal(
    name: string,
    cwd: string,
    initialCommand?: string
): vscode.Terminal { /* ...existing body, pass initialCommand into PtyTerminalHost... */ }
```

- [ ] **Step 2: package.json 加 command**

```json
{
    "command": "superset.mdnsConnect",
    "title": "Superset: Connect",
    "icon": "$(plug)"
}
```

context menu:

```json
{
    "command": "superset.mdnsConnect",
    "when": "viewItem == mdnsService",
    "group": "1_focus"
}
```

- [ ] **Step 3: build + 跑全部測試**

Run: `npm run build && npm test`
Expected: build 成功,所有 case 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(mdns): wire Connect command + context menu"
```

### Task 4: 自我審查 + 文件

- [ ] **Step 1: 自我審查**

  - [ ] 5 個 test case 都對應到 Task 1 實作
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `resolveConnectCommand` / `initialCommand` / `spawnPtyTerminal` 三個名字在所有 task 一致
  - [ ] `MdnsService` 型別欄位 `type` 已存在(查 `src/types.ts`,若無則先在 `types.ts` 加 readonly 欄位)

- [ ] **Step 2: README.md「mDNS」段落補 Connect 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Connect on mDNS services"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| `setTimeout(50ms)` 對慢啟動 shell 不夠 | 增加重試邏輯(本 plan 不做,留 follow-up) | 改回不自動 write,只開 terminal |
| Service type 不在對照表 | 顯示 warning,不 crash | 刪命令註冊即可 |
| 使用者按到非預期主機 | terminal 名稱含 service name,esc 可中斷;`PtyTerminalHost` 仍走 normal PTY flow | 同上 |

---

## 6. 完成定義

- [ ] 5 個 `mdnsConnect` test case 全綠
- [ ] mDNS 列表有 Connect 動作,按下會開新 PTY terminal 並跑命令
- [ ] 既有 48 個 case 全綠
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] mDNS one-click connect`
- 既有模組: `src/ptyTerminalHost.ts`, `src/extension.ts:spawnPtyTerminal`
- 測試位置: `test/mdnsConnect.test.ts` (本 plan 新增)
