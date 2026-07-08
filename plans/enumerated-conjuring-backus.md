# 為 projectsTodo section 列加上 pending 計數徽章

## Context (為何要做)

`ProjectsTodoTreeProvider` 目前在 **project** 列(資料夾行)右側已經顯示 `N pending` 計數,讓使用者一眼看到每個專案還有多少未完成工作。但 **section** 列(`## Section` 子標題行)目前只顯示原始的 `element.description`(在這個 tree 裡通常是 `undefined`),導致使用者必須展開每個 section 才能看到還有多少待辦。

本改動要把 section 列的右側補上 pending 計數,**與 project 列對齊視覺模式**,讓使用者在還沒展開 tree 之前就能比較各 section 的工作量。

格式採使用者決定的 `N ◐`(數字 + 半圓 unicode glyph),比 `N pending` 文字更不冗長,也與 project 列的 `N pending` 文字形成層級差異(粗細/輕重層次)。

## 設計決策 (User-resolved)

| 議題 | 決策 |
| --- | --- |
| 顯示格式 | `N ◐`(用 `${pending} ◐` template) |
| 計數為 0 | 一律顯示 `0 ◐`(與 project 列一致) |
| Archive section | 計算照跑,但**不顯示徽章**(避免 archive 區塊滿是 `0 ◐` 雜訊) |

**Archive 跳過的判定規則**:當 `computeSectionContextValue(element) === "projectsTodoSectionArchived"` 時不顯示徽章。這個 contextValue 已經在現有 `computeSectionContextValue` (line 186-195) 裡計算出來 — 它會對「位於 `## Archive` 底下的 `###` 子標題」回傳 archived。當使用者的 "Hide Completed/Archive" 過濾器開啟時,archive 子樹會在 `filterCompleted` 階段(line 487-489)整個被丟掉,所以 archived 列根本不會出現在 tree 上,規則不會在隱藏的 row 上誤觸發。

注意:top-level `## Archive` 因為 `computeSectionContextValue` line 188 的短路(`level === 2 && text.toLowerCase() === "archive"` → `"projectsTodoSection"`)會**繼續顯示徽章**,這是預期行為 — 使用者仍會想看到「archive 內共有多少項目」。

## 修改檔案

### 1. `src/projectsTodo/projectsTodoTreeProvider.ts`

**修改位置**:section 分支(原 line 95-108)。

把 `computeSectionContextValue` 的結果先存到區域變數,再依結果決定是否附加徽章,並複用於 `contextValue` 設定;DRY 處理。

**新內容**:

```ts
// 2. If it's a normal section inside a project
if (element.kind === "section") {
    const item = new vscode.TreeItem(element.text);
    item.iconPath = new vscode.ThemeIcon("tag");
    if (element.text === "README.todo") {
        item.iconPath = new vscode.ThemeIcon("file-text");
    } else if (element.text.includes(".")) {
        item.iconPath = new vscode.ThemeIcon("file");
    }
    // Compute contextValue once and reuse for the badge decision below
    // and the final contextValue assignment.
    const sectionContext = this.computeSectionContextValue(element);
    // Append a half-circle badge showing the count of pending (unchecked)
    // checkboxes. Children were already filtered by showCompleted /
    // priority in getChildren, so the count respects the active filter.
    // Archive sub-sections are skipped — by definition they hold finished
    // work, so a "0 ◐" badge is noise rather than signal.
    if (sectionContext !== "projectsTodoSectionArchived") {
        const pending = countPending(element.children);
        item.description = `${pending} ◐`;
    }
    item.tooltip = element.text;
    item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    item.contextValue = sectionContext;
    return item;
}
```

**為什麼這樣**:

- 沿用既有 `countPending` 純函式(line 268-280),不新增 helper。
- `countPending(element.children)` 安全:`countPending` 內部已處理 `!items || items.length === 0` → 0(見 line 268-269),所以 section 沒 `children` 不會爆。
- 不合併 `element.description`:在 `src/todo/parser.ts` 的 section 解析(line 50-58)從不寫入 `description`,且 projects tree 沒跑 `buildPriorityGroups` / `buildFileGroups`,所以這裡直接覆蓋是安全的(也不會丟失語意)。
- 不動 project 列(line 76-92)— 保留 `N pending` 文字格式,project/section 兩層刻意用不同字形語法。

### 2. `test/projectsTodoTreeProvider.test.ts`

在 `describe("ProjectsTodoTreeProvider", ...)` 區塊內新增 3 個 case(可選第 4 個防迴歸)。沿用既有 `beforeEach` 建立的 temp dir 與 store;每個 case 用 `writeFileSync` 覆寫 `cc-plugin/README.todo` 內容以建立不同 section 結構。

**Case 1**:section 顯示正確的 pending 計數。

```ts
it("shows pending count badge for section rows in getTreeItem", async () => {
    const p = join(tempDir, "projects", "cc-plugin");
    writeFileSync(
        join(p, "README.todo"),
        "## Foo\n- [ ] a\n- [ ] b\n- [x] c\n"
    );
    await store.load();

    const provider = new ProjectsTodoTreeProvider(store);
    const roots = await provider.getChildren();
    const section = (await provider.getChildren(roots![0]))![0];
    expect(section.text).toBe("Foo");

    const item = provider.getTreeItem(section);
    expect(item.label).toBe("Foo");
    expect(item.contextValue).toBe("projectsTodoSectionArchivable");
    expect(item.description).toBe("2 ◐");
});
```

**Case 2**:全部項目都完成時顯示 `0 ◐`(hide-completed 預設是關的,所以 `[x]` 仍在 tree 內但貢獻 0 個 pending)。

```ts
it("shows 0 pending badge for section with only completed items", async () => {
    const p = join(tempDir, "projects", "cc-plugin");
    writeFileSync(
        join(p, "README.todo"),
        "## Done\n- [x] a\n- [x] b\n"
    );
    await store.load();

    const provider = new ProjectsTodoTreeProvider(store);
    const roots = await provider.getChildren();
    const section = (await provider.getChildren(roots![0]))![0];
    expect(section.text).toBe("Done");

    const item = provider.getTreeItem(section);
    expect(item.description).toBe("0 ◐");
});
```

**Case 3**:archive 子 section(`###` 在 `## Archive` 底下)不顯示徽章;同檔內的 `## Active` 正常顯示。

```ts
it("hides pending badge for archive subsection rows", async () => {
    const p = join(tempDir, "projects", "cc-plugin");
    writeFileSync(
        join(p, "README.todo"),
        [
            "## Active",
            "- [ ] a",
            "## Archive",
            "### Old",
            "- [x] done",
        ].join("\n")
    );
    await store.load();

    const provider = new ProjectsTodoTreeProvider(store);
    const roots = await provider.getChildren();
    const sections = await provider.getChildren(roots![0]);

    const active = sections.find((s) => s.text === "Active")!;
    const archive = sections.find((s) => s.text === "Old")!;

    const activeItem = provider.getTreeItem(active);
    expect(activeItem.contextValue).toBe("projectsTodoSectionArchivable");
    expect(activeItem.description).toBe("1 ◐");

    const archiveItem = provider.getTreeItem(archive);
    expect(archiveItem.contextValue).toBe("projectsTodoSectionArchived");
    expect(archiveItem.description).toBeUndefined();
});
```

## 沿用既有函式 (no new helpers)

- `countPending` (`src/projectsTodo/projectsTodoTreeProvider.ts:268-280`) — 遞迴計算 `kind === "checkbox" && !checked` 的數量。簽章不變。
- `computeSectionContextValue` (`src/projectsTodo/projectsTodoTreeProvider.ts:186-195`) — 不動邏輯,只把回傳值存到區域變數複用。
- `filterCompleted` / `applyPriorityFilter` (`src/todo/todoTreeProvider.ts`) — 既有過濾鏈在 `getChildren` (line 207-209) 跑;`countPending` 看到的 `element.children` 已是過濾後的。

## 不修改的檔案

- `src/projectsTodo/types.ts` — `ProjectTodoItem` shape 不變。
- `src/projectsTodo/projectsTodoStore.ts` — 不變。
- `src/todo/parser.ts` — 不變。
- `src/todo/todoTreeProvider.ts` — 不變。
- `package.json` — 不新增 command 或 menu(這是純渲染變更)。

## 版本

依 `package.json` 規則 `<major,minor,patch>`,這是 UI 增強 → minor bump。`0.7.6` → `0.8.0`。

## 驗證 (Verification)

1. **單元測試**:`npm test`(Vitest),確認新增 3 個 case 與既有 5 個 case 全部綠燈。
2. **型別檢查 + 編譯**:`npm run build`(包含 `tsc` 與 `vsce package`)。確認無 type error。
3. **手動視覺確認**(在裝好的 dev extension 中):
    - 開啟任一 `## Foo` 結構的 `README.todo` 所在專案。
    - 切到「Overall → Projects TODO」面板。
    - 預期看到 project 行為 `N pending`,section 行為 `N ◐`。
    - 切到 P0 過濾器,展開任一 section,確認 section 列計數與底下顯示的 checkbox 一致。
    - 切換 "Hide Completed/Archive" filter 為 on,確認 `## Archive` 底下整個 subtree 從 tree 消失(既有行為,本次改動未觸及)。
    - 在過濾器 off 狀態下,確認 `###` 底下的 archive 子 section 沒有徽章(只顯示 section 文字,description 為 `undefined`)。
4. **迴歸檢查**:既有 `test/projectsTodoTreeProvider.test.ts` 5 個 case 維持綠燈(不應受影響 — 我們沒改 `getChildren` / `getTreeItem` 的 project 分支或 task 分支)。
