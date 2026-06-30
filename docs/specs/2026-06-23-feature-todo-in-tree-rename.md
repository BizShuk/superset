# TODO In-Tree Rename 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓用戶在 TODO TreeView 內直接重新命名 checkbox 項目的 `text` 欄位,變更會寫回 `README.todo` 原始行。

**Architecture:** 既有 `TodoStore.toggle` 已示範「記憶體 mutate → 序列化整檔 → 寫回」流程;新增 `TodoStore.updateText(line, newText)` 採相同 pattern。命令 `superset.todoRename` 透過 `vscode.window.showInputBox` 取得新文字,呼叫 store 寫回。TreeView 加 context menu entry + F2 keybinding(在 panel focused 時)。

**Tech Stack:** TypeScript / Vitest / `vscode.commands` / 既有 `TodoStore`

---

## 1. 為何要做 (Why)

- **現有痛點**:目前只能 toggle 完成與否;要改文字得手動編輯 `README.todo`。
- **既有鋪墊**:`TodoStore.toggle` 走完整的 read-modify-write 循環,`updateText` 只是把 toggle 換成 replace 邏輯;UI 命令 / context menu / keybinding 已有 `superset.rename`(terminal)的範例可參考(`extension.ts:658-674`)。
- **低風險**:變更僅限 `README.todo` 單一檔案,且 `TodoStore` 已有 file watcher 會 reload,自我一致。

---

## 2. User-visible Change

| Before | After |
| --- | --- |
| TODO 樹只能勾選完成 | F2 / 右鍵「Rename」可改寫 checkbox 後的描述文字 |
| 改文字要回到 editor 改 README.todo | TreeView 內就地編輯,變更立即持久化 |

---

## 3. 檔案異動表 (File Structure)

| 動作   | 檔案                          | 職責                                                |
| ------ | ----------------------------- | --------------------------------------------------- |
| Modify | `src/todoStore.ts`            | 加 `updateText(line, newText)` 方法                 |
| Modify | `test/todoStore.test.ts`      | 新 case:rename 後 reload 讀得到新文字              |
| Modify | `src/extension.ts`            | 註冊 `superset.todoRename` 命令                     |
| Modify | `package.json`                | 加 command + context menu + keybinding              |

---

## 4. 實作步驟 (Tasks)

### Task 1: TodoStore.updateText + 測試 (TDD)

**Files:**
- Modify: `src/todoStore.ts`(找 toggle 實作)
- Modify: `test/todoStore.test.ts`

- [ ] **Step 1: 寫失敗測試**

```typescript
// test/todoStore.test.ts (append)
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

it("updateText rewrites the matching line in README.todo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "todo-rename-"));
    const file = join(dir, "README.todo");
    writeFileSync(
        file,
        "# TODO\n\n- [ ] Old name\n- [ ] Keep me\n",
        "utf8"
    );
    const store = new TodoStore(dir);
    await store.load();

    await store.updateText(/* line of "Old name" */ 4, "New name");

    const after = readFileSync(file, "utf8");
    expect(after).toContain("- [ ] New name");
    expect(after).toContain("- [ ] Keep me");
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `npm test -- todoStore`
Expected: FAIL — `updateText` 還沒定義。

- [ ] **Step 3: 實作 updateText**

```typescript
// src/todoStore.ts
public async updateText(line: number, newText: string): Promise<void> {
    // 1. mutate in-memory items
    const item = this.items.find((i) => i.line === line);
    if (item) item.text = newText;

    // 2. rewrite file: find the line by 1-based line number,
    //    replace the trailing " - [ ] ..." or " - [x] ..." with new text
    const content = await fs.promises.readFile(this.filePath, "utf8");
    const lines = content.split("\n");
    const target = lines[line - 1];
    if (target) {
        lines[line - 1] = target.replace(
            /^(\s*-\s*\[[ x]\]\s*)(.*)$/,
            (_, prefix) => `${prefix}${newText}`
        );
    }
    await fs.promises.writeFile(this.filePath, lines.join("\n"), "utf8");
    this.persist(); // existing in-memory state refresh
}
```

> 註:實際 regex 與 store 內部 `Item` 結構需對齊既有程式碼(本 plan 用「最小可用版本」展示 pattern)。

- [ ] **Step 4: 跑測試確認 pass**

Run: `npm test -- todoStore`
Expected: 既有 8 + 新 1 全綠。

- [ ] **Step 5: Commit**

```bash
git add src/todoStore.ts test/todoStore.test.ts
git commit -m "feat(todo): add updateText to rewrite README.todo line"
```

### Task 2: 命令 + keybinding

**Files:**
- Modify: `src/extension.ts:907-921`(在 todoToggle 旁)
- Modify: `package.json`

- [ ] **Step 1: 註冊命令**

```typescript
subscriptions.push(
    vscode.commands.registerCommand(
        "superset.todoRename",
        async (item: { line: number; text: string; kind: "checkbox" | "list" } | undefined) => {
            if (!item || item.kind !== "checkbox") return;
            const next = await vscode.window.showInputBox({
                prompt: "新文字",
                value: item.text,
            });
            if (!next || next === item.text) return;
            await todoStore.updateText(item.line, next);
        }
    )
);
```

- [ ] **Step 2: package.json 加 command + menu + keybinding**

```json
{
    "command": "superset.todoRename",
    "title": "Superset: Rename Todo",
    "icon": "$(edit)"
}
```

context menu:

```json
{
    "command": "superset.todoRename",
    "when": "viewItem == todoCheckbox",
    "group": "2_rename"
}
```

keybinding:

```json
{
    "command": "superset.todoRename",
    "key": "F2",
    "when": "focusedView == superset.todo && !inputFocus"
}
```

> 註:`viewItem == todoCheckbox` 需在 `todoTreeProvider.ts` 內把 `contextValue` 設成 `todoCheckbox`;若目前是 `todo` / `todoList`,本 plan 需先補一個 step 改 provider(列為 Task 2.0 預備步驟)。

- [ ] **Step 3: 跑全部測試**

Run: `npm run build && npm test`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts package.json
git commit -m "feat(todo): wire Rename command + F2 keybinding"
```

### Task 3: 自我審查

- [ ] **Step 1: 自我審查**

  - [ ] 1 個 todoStore test case 對應 Task 1
  - [ ] 沒有 `TBD` / `TODO` / 「similar to Task N」
  - [ ] `updateText` / `superset.todoRename` 名稱一致
  - [ ] `viewItem` 字串(`todoCheckbox`)與 provider `contextValue` 一致

- [ ] **Step 2: README.md「TODO」段落補 Rename 說明**
- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document Superset: Rename Todo"
```

---

## 5. 風險與 Rollback

| 風險 | 緩解 | Rollback |
| --- | --- | --- |
| 寫回 README.todo 破壞格式(例如 nested indent) | regex 嚴格比對 `^(\s*-\s*\[[ x]\]\s*)(.*)$`,不符則不動 | 刪命令註冊 + 把 `updateText` 改成只更新 in-memory |
| 子節點被 rename 影響 parent 判斷 | `updateText` 只動 line 本身,不改結構 | 同上 |
| F2 與 terminal rename 衝突 | keybinding `when` 限定 `focusedView == superset.todo` | 改 keybinding 條件 |

---

## 6. 完成定義

- [ ] 1 個 todoStore rename test case 綠
- [ ] F2 / 右鍵「Rename」可改寫 TODO 文字並持久化
- [ ] 既有 48 個 case 全綠
- [ ] README.md 已更新

---

## 相關連結

- 觸發來源: [`README.todo`](README.todo) — `[feature] TODO: edit text in-tree`
- 既有模組: `src/todoStore.ts:toggle`, `src/extension.ts:rename`
- 測試位置: `test/todoStore.test.ts`
