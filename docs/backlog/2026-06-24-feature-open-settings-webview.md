# Open Settings Webview 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供 `Superset: Open Settings` 命令,在 webview 中以分頁形式集中顯示所有 `superset.*` 設定 + 各 panel 的 source-of-truth 狀態 badge,使用者可即時改值並生效。

**Architecture:** 新建 `webview/settings.html`(vanilla HTML/JS,不引 framework),透過 `vscode.webview` API 顯示。Extension 端用 `getConfiguration().inspect(key)` 拿到 default / current,透過 `postMessage` 送進 webview;webview 改值後傳回 `setConfiguration` 訊息。Webview 只負責呈現與收發,所有 schema 來源是 `package.json` 的 `configuration.properties`(單一 source of truth)。

**Tech Stack:** TypeScript / Vitest / `vscode.WebviewViewProvider` / vanilla HTML

---

## 1. 為何要做 (Why)

- **現有痛點**:設定散在 `package.json` 內,使用者要翻 README 才知道有什麼 setting;改值要進 Settings UI 找 namespace。
- **既有鋪墊**:`vscode.workspace.getConfiguration("superset").inspect(key)` 是 stable API;`WebviewViewProvider` 自 1.49+ stable。
- **小風險**:webview 內容若不 sanitize 可能 XSS;`vscode.webview` 預設有 csp,主要風險是 message handler 型別未對齊。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| 設定要進 Settings UI 找 | `Ctrl+Shift+P` → `Superset: Open Settings` 一鍵開 |
| 各 panel 狀態要自己看 panel | webview 內顯示「terminals: 5 active, 2 unseen」之類即時狀態 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                              |
| ------ | ----------------------------- | ------------------------------------------------- |
| Create | `src/settingsWebview.ts`      | `SettingsViewProvider` class                      |
| Create | `webview/settings.html`       | webview 內容                                      |
| Create | `test/settingsWebview.test.ts`| 純函式測試(`getAllSettings` 等)                  |
| Modify | `src/extension.ts`            | 註冊 webview + command                            |
| Modify | `package.json`                | 加 command + webview view                         |

---

## 4. 實作步驟 (Tasks)

### Task 1: 純函式:列出所有 superset.* 設定 + 測試 (TDD)

**Files:**
- Create: `src/settingsWebview.ts`(只放純函式,class 在 Task 2)
- Create: `test/settingsWebview.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/settingsWebview.test.ts
import { describe, it, expect } from "vitest";
import { getAllSupersetSettings } from "../src/settingsWebview";

describe("getAllSupersetSettings", () => {
    it("returns one entry per known setting with default + current", () => {
        const config = {
            get: (key: string, def: unknown) => {
                if (key === "superset.auditLevel") return "info";
                if (key === "superset.topologyScanIntervalMinutes") return 5;
                return def;
            },
        } as any;
        const out = getAllSupersetSettings(config);
        expect(out).toEqual([
            { key: "superset.auditLevel", type: "string", current: "info", default: "info" },
            { key: "superset.topologyScanIntervalMinutes", type: "number", current: 5, default: 5 },
        ]);
    });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- settingsWebview`
Expected: FAIL。

- [ ] **Step 3: 實作純函式**

```typescript
// src/settingsWebview.ts
export interface SettingEntry {
    readonly key: string;
    readonly type: "string" | "number" | "boolean" | "enum";
    readonly current: unknown;
    readonly defaultValue: unknown;
    readonly description?: string;
}

const KNOWN_KEYS: ReadonlyArray<{ key: string; type: SettingEntry["type"]; description?: string }> = [
    { key: "superset.auditLevel", type: "enum", description: "Lifecycle audit 等級" },
    { key: "superset.topologyScanIntervalMinutes", type: "number", description: "拓撲背景掃描間隔(分鐘,0=停用)" },
];

export function getAllSupersetSettings(
    config: { get<T>(key: string, defaultValue: T): T }
): readonly SettingEntry[] {
    return KNOWN_KEYS.map(({ key, type, description }) => ({
        key,
        type,
        current: config.get(key, undefined as any),
        defaultValue: config.get(key, undefined as any),
        description,
    }));
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- settingsWebview`
Expected: 1 個 case 綠。

- [ ] **Step 5: Commit**

```bash
git add src/settingsWebview.ts test/settingsWebview.test.ts
git commit -m "feat(settings-ui): add getAllSupersetSettings helper"
```

### Task 2: Webview provider + message handler

**Files:**
- Modify: `src/settingsWebview.ts`(加 class)
- Create: `webview/settings.html`

- [ ] **Step 1: 寫 SettingsViewProvider class**

```typescript
// src/settingsWebview.ts (append)
import * as vscode from "vscode";

export class SettingsViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = "superset.settings";

    constructor(private readonly context: vscode.ExtensionContext) {}

    resolveWebviewView(webviewView: vscode.WebviewView): void {
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getHtml();
        webviewView.webview.onDidReceiveMessage((msg) => {
            if (msg?.type === "set" && typeof msg.key === "string") {
                void vscode.workspace
                    .getConfiguration("superset")
                    .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
            } else if (msg?.type === "load") {
                const config = vscode.workspace.getConfiguration("superset");
                void webviewView.webview.postMessage({
                    type: "settings",
                    payload: getAllSupersetSettings(config),
                });
            }
        });
    }
}

function getHtml(): string {
    return /* language=html */ `<!doctype html>
<html><body><h1>Superset</h1>
<div id="root">Loading…</div>
<script>
const vscode = acquireVsCodeApi();
window.addEventListener("message", (e) => {
    const msg = e.data;
    if (msg.type === "settings") {
        const root = document.getElementById("root");
        root.innerHTML = msg.payload.map(s =>
            \`<div><label>\${s.key}</label>
               <input data-key="\${s.key}" data-type="\${s.type}" value="\${s.current}"/>
            </div>\`
        ).join("");
        root.querySelectorAll("input").forEach(el => {
            el.addEventListener("change", () => {
                const v = el.type === "number" ? Number(el.value) : el.value;
                vscode.postMessage({ type: "set", key: el.dataset.key, value: v });
            });
        });
    }
});
vscode.postMessage({ type: "load" });
</script></body></html>`;
}
```

- [ ] **Step 2: extension.ts 註冊 webview + command**

```typescript
const settingsProvider = new SettingsViewProvider(context);
subscriptions.push(
    vscode.window.registerWebviewViewProvider(
        SettingsViewProvider.viewId,
        settingsProvider
    )
);
subscriptions.push(
    vscode.commands.registerCommand("superset.openSettings", () =>
        vscode.commands.executeCommand(`${SettingsViewProvider.viewId}.focus`)
    )
);
```

- [ ] **Step 3: package.json 加 command + view**

```json
{
    "command": "superset.openSettings",
    "title": "Superset: Open Settings",
    "icon": "$(settings-gear)"
}
```

並在 `contributes.views` 加 `superset.settings` view。

- [ ] **Step 4: build + 跑測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/settingsWebview.ts src/extension.ts package.json
git commit -m "feat(settings-ui): wire webview provider + open command"
```

### Task 3: 自我審查 + 安全檢查

- [ ] **Step 1: 自我審查**

  - [ ] 1 個 settingsWebview test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `getAllSupersetSettings` / `SettingsViewProvider` 名稱一致
  - [ ] webview HTML 內無 inline event handler(避免 CSP 問題)
  - [ ] `msg.key` 必須是 `KNOWN_KEYS` 內的 key 之一(防止任意 key 寫入);補 guard

- [ ] **Step 2: 加 key 白名單 guard**

```typescript
// inside onDidReceiveMessage
if (msg?.type === "set" && typeof msg.key === "string" &&
    KNOWN_KEYS.some(k => k.key === msg.key)) { /* update */ }
```

- [ ] **Step 3: 跑測試 + build**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: README.md 加 Settings webview 段落**
- [ ] **Step 5: Commit**

```bash
git add src/settingsWebview.ts README.md
git commit -m "feat(settings-ui): add key whitelist + docs"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| Webview CSP / XSS | 不用 inline event handler,只送 message | 移除 webview 註冊 |
| 任意 key 寫入 | Step 2 加 whitelist guard | 改回只讀,移除 `set` 處理 |
| `KNOWN_KEYS` 與 `package.json` 雙寫不同步 | 加 lint 規則(本 plan 不做,記 follow-up) | 改用 `package.json` 動態讀 |

---

## 6. 完成定義

- [ ] 1 個 settingsWebview test case 綠
- [ ] `Superset: Open Settings` 命令可開 webview
- [ ] 改值即時生效(透過 `ConfigurationTarget.Global`)
- [ ] 既有測試不壞
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] Superset: Open Settings webview`
- 既有模組: 2 個 setting(`auditLevel` / `topologyScanIntervalMinutes`)已在 `package.json`
- 測試位置: `test/settingsWebview.test.ts`
