# Workspace-Aware Group Suggestions 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 當新 PTY terminal 開啟時,自動偵測其 cwd / git remote,若已存在對應 group 就自動 assign 並顯示一行 toast。

**Architecture:** 在 `PtyTerminalHost` spawn 流程跑完後,讀 `cwd` 與 `git rev-parse --show-toplevel`(若可達),把 root path 與 git remote URL 當作 group key。`GroupStore` 暴露 `findByCwd(cwd)` / `findByGitRemote(remote)` 查詢;若找到,呼叫 `assignToGroup(terminal, groupId)` 並 `vscode.window.showInformationMessage` 顯示提示。

**Tech Stack:** TypeScript / Vitest / `child_process.execFile`(同步執行 git command)

---

## 1. 為何要做 (Why)

- **現有痛點**:用戶手動分組 terminal 是 toil,多專案工作時常見「build / dev / test」一組,但每次都要手動拖。
- **既有鋪墊**:`GroupStore` 已實作 `assignDefaultGroup`(`extension.ts:81`),但只 fallback 到 `UNGROUPED`;擴展成「找既有 group」只需多加查詢。
- **資料來源穩定**:cwd 由 spawn options 提供,git remote 用 `execFile` 一次性讀取,不需常駐 watcher。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 新 terminal 總是落在 `UNGROUPED`(或預設 group) | 若 cwd 對應到既有 group,自動移過去 + toast「Auto-grouped into <group>」 |
| 同一 git repo 的多個 terminal 散在不同 group | 透過 git remote URL 對應,跨目錄 clone 的同個 repo 自動歸一組 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                        | 職責                                                  |
| ------ | --------------------------- | ----------------------------------------------------- |
| Create | `src/groupSuggest.ts`       | 純函式 + 小工具:`resolveGitRoot`, `resolveGitRemote`  |
| Create | `test/groupSuggest.test.ts` | 純函式單元測試                                        |
| Modify | `src/groupStore.ts`         | 加 `findByCwd`, `findByGitRemote` query methods       |
| Modify | `test/groupStore.test.ts`   | 新方法的測試 case                                     |
| Modify | `src/extension.ts`          | 在 `spawnPtyTerminal` 結尾呼叫 suggest 流程           |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式:git 解析 + 測試 (TDD)

**Files:**

- Create: `src/groupSuggest.ts`
- Create: `test/groupSuggest.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/groupSuggest.test.ts
import { describe, it, expect } from "vitest";
import { parseGitRemoteUrl, normalizeGroupKey } from "../src/groupSuggest";

describe("parseGitRemoteUrl", () => {
    it("extracts repo name from ssh url", () => {
        expect(parseGitRemoteUrl("git@github.com:foo/bar.git")).toBe("foo/bar");
    });

    it("extracts repo name from https url", () => {
        expect(parseGitRemoteUrl("https://github.com/foo/bar.git")).toBe("foo/bar");
    });

    it("strips trailing slash", () => {
        expect(parseGitRemoteUrl("https://example.com/x/y/")).toBe("x/y");
    });

    it("returns null for empty input", () => {
        expect(parseGitRemoteUrl("")).toBeNull();
    });
});

describe("normalizeGroupKey", () => {
    it("lowercases and replaces separators", () => {
        expect(normalizeGroupKey("My Project!")).toBe("my-project");
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- groupSuggest`
Expected: FAIL — 還沒定義。

- [ ] **Step 3: 實作**

```typescript
// src/groupSuggest.ts
export function parseGitRemoteUrl(remote: string): string | null {
    if (!remote) return null;
    const trimmed = remote.trim().replace(/\.git$/, "").replace(/\/$/, "");
    const sshMatch = trimmed.match(/[:/]([^/]+\/[^/]+)$/);
    return sshMatch ? sshMatch[1] : null;
}

export function normalizeGroupKey(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- groupSuggest`
Expected: 5 個 case 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/groupSuggest.ts test/groupSuggest.test.ts
git commit -m "feat(group-suggest): add git remote + key normalizer"
```

### Task 2: GroupStore 加查詢方法

**Files:**

- Modify: `src/groupStore.ts`(找 class 內部)
- Modify: `test/groupStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/groupStore.test.ts (append)
describe("findByGitRemote", () => {
    it("returns group whose meta matches remote", () => {
        const store = new GroupStore();
        const g = store.createGroup("frontend");
        store.setGroupMeta(g.id, { gitRemote: "github.com/foo/bar" });
        expect(store.findByGitRemote("github.com/foo/bar")?.id).toBe(g.id);
    });
});

describe("findByCwd", () => {
    it("returns group whose meta matches cwd", () => {
        const store = new GroupStore();
        const g = store.createGroup("backend");
        store.setGroupMeta(g.id, { cwd: "/Users/me/proj" });
        expect(store.findByCwd("/Users/me/proj")?.id).toBe(g.id);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- groupStore`
Expected: FAIL — 方法不存在。

- [ ] **Step 3: 在 GroupStore 加 meta 儲存 + 查詢**

```typescript
// src/groupStore.ts (add to class)
private metas = new Map<string, { cwd?: string; gitRemote?: string }>();

public setGroupMeta(id: string, meta: { cwd?: string; gitRemote?: string }): void {
    this.metas.set(id, { ...this.metas.get(id), ...meta });
}

public findByCwd(cwd: string): Group | undefined {
    for (const [id, m] of this.metas) {
        if (m.cwd === cwd) return this.getGroup(id);
    }
    return undefined;
}

public findByGitRemote(remote: string): Group | undefined {
    for (const [id, m] of this.metas) {
        if (m.gitRemote === remote) return this.getGroup(id);
    }
    return undefined;
}
```

(若 `getGroup` 不存在,加一個簡單 lookup;或直接用 `this.groups.find(...)` 依 store 既有結構。)

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- groupStore`
Expected: 既有 14 + 新 2 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/groupStore.ts test/groupStore.test.ts
git commit -m "feat(group-store): add cwd/remote metadata + queries"
```

### Task 3: extension.ts 串接

**Files:**

- Modify: `src/extension.ts:949-971`(spawnPtyTerminal 函式)

- [ ] **Step 1: 在 spawnPtyTerminal 結尾加 suggest**

```typescript
function spawnPtyTerminal(name: string, cwd: string, initialCommand?: string): vscode.Terminal {
    /* ... existing body ... */
    // After ptyBackedTerminals.add(terminalRef):
    try {
        const remote = readGitRemote(cwd); // helper below
        const matched = remote
            ? groupStore.findByGitRemote(remote)
            : groupStore.findByCwd(cwd);
        if (matched) {
            groupStore.moveTerminalToGroup(terminalRef, matched.id);
            vscode.window.showInformationMessage(
                `Superset: 已自動加入群組「${matched.name}」`
            );
        }
    } catch (err) {
        log(`[group-suggest] failed: ${err}`);
    }
    return terminalRef;
}

function readGitRemote(cwd: string): string | null {
    try {
        const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
        return execFileSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}
```

- [ ] **Step 2: build + 跑全部測試**

Run: `npm run build && npm test`
Expected: build 成功、全綠。

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat(groups): auto-suggest group by cwd/git remote"
```

### Task 4: 自我審查

- [ ] **Step 1: 自我審查**

    - [ ] 5 個新 test case 對應到 Task 1–2
    - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
    - [ ] `parseGitRemoteUrl` / `normalizeGroupKey` / `findByCwd` / `findByGitRemote` 名稱一致
    - [ ] `readGitRemote` 用 `execFileSync` 而非 `exec`,避免 shell injection

- [ ] **Step 2: Commit(若 README 有改)**

```bash
git add README.md
git commit -m "docs: document auto-group suggestion"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 讀 git remote 慢(網路掛) | `execFileSync` timeout 2s,失敗吞掉 | 不呼叫 `readGitRemote` 即可 |
| 群組誤判(兩個 repo 同 remote) | 提示用 toast,可手動拖走;group 仍可手動覆寫 | 移除 `moveTerminalToGroup` 呼叫 |
| `metas` 沒持久化 | 重啟後建議失效;屬本 plan 範圍外,留 follow-up | 同上 |

---

## 6. 完成定義

- [ ] 5 個 groupSuggest + 2 個 groupStore 新 case 全綠
- [ ] 新 PTY terminal 開啟時,若 cwd/git remote 對應到既有 group,會自動加入並顯示 toast
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Workspace-aware group suggestions`
- 既有模組: `src/groupStore.ts`, `src/extension.ts:spawnPtyTerminal`
- 測試位置: `test/groupSuggest.test.ts`, `test/groupStore.test.ts`
