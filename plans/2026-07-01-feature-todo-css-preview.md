# TODO Markdown 預覽:CSS 摺疊與過濾 (Implementation Plan)

`2026-07-01` · feature · 對應 feature module `src/todoPreview/`

為 `README.todo` 的 Markdown 內建預覽加兩個純 CSS 互動:一鍵隱藏已完成/封存任務、每節從標題摺疊並支援 fold all / unfold all。沿用 `treePreview` 的「markdown-it hook + `previewStyles` CSS + 純函式可測」路線,不開 Webview、不加 command。

---

## 目標 (Goals)

- 功能 1:一顆按鈕隱藏「已完成 (`- [x]`)、刪除線 (`~~text~~`)、`## Archive` 整區」。
- 功能 2:每個 section 可從標題點擊摺疊/展開;另一顆按鈕 fold all / unfold all。
- 全部以 CSS `:has()` + checkbox hack 完成,零 preview JS (避開 CSP 與重繪失效)。

## 非目標 (Non-Goals)

- 不做「先 fold all、再單獨展開某節」的獨立共存 — 見下方 CSS 天花板;需要時才另開 JS 計畫。
- 不改 `src/todo/` TreeView 面板;此計畫只影響 Markdown 預覽渲染。

---

## CSS 天花板 (Decision)

`★ 決策 ─────────────────────────────────────`
每節獨立摺疊:純 CSS 完美。
`fold all` 與「每節獨立狀態」完全共存:CSS 改不了個別 checkbox 的 checked 狀態,只能做
「主開關強制、個別服從」的 OR 語意 — 主開關開 → 全收;主開關關 → 回到各節自己狀態。
「先全收再單獨展開某節」必須 previewScripts (JS)。本計畫交付 CSS 能到的極限,JS 版另立。
`─────────────────────────────────────────────`

---

## 共用前置:section 包裹 (markdown-it core ruler)

兩個功能都依賴「每個 heading 領起的內容被包成一個容器」。加一支 `core` ruler 把 flat token 串重組:

```tree
<section class="sec" data-title="Archive">        # data-title 供功能 1 認 Archive
├── <input type="checkbox" class="sec-tgl" id="sec-3">   # 每節唯一 id,counter 生成
├── <label class="sec-head" for="sec-3"><h2>…</h2></label>
└── <div class="sec-body"> …此節所有內容… </div>
```

- 純函式 `wrapSections(tokens): tokens` 抽到 `sectionWrap.ts`,無 `vscode` import → Vitest 可測。
- id counter 當參數傳入以利測試 (對照 `renderLine` 的注入式純函式風格)。

## 功能 1:隱藏 completed / archived

命中三種表徵,一顆按鈕全收:

| 目標 | HTML (內建預覽產出) | 選擇器 |
| --- | --- | --- |
| `- [x]` 勾選 | `li.task-list-item` 內含 `input:checked` | `li.task-list-item:has(input:checked)` |
| `~~strike~~` | `<li>` 內含 `<s>`/`<del>` | `li:has(s), li:has(del)` |
| `## Archive` 整區 | `.sec[data-title]` | `.sec[data-title="Archive" i]` |

```tree
#hide-done { display: none }
.markdown-body:has(#hide-done:checked) li.task-list-item:has(input:checked),
.markdown-body:has(#hide-done:checked) li:has(s),
.markdown-body:has(#hide-done:checked) li:has(del),
.markdown-body:has(#hide-done:checked) .sec[data-title="Archive" i] { display: none }
```

## 功能 2:每節摺疊 + fold all / unfold all

每節摺疊 (點 `label` 標題):

```tree
.sec:has(.sec-tgl:checked) .sec-body { display: none }
.sec-head { cursor: pointer }
.sec-head::before                              { content: "▼ " }
.sec:has(.sec-tgl:checked) .sec-head::before   { content: "▶ " }
```

fold all / unfold all (單一 master,OR 覆蓋 + 兩態文字):

```tree
#fold-all { display: none }
.markdown-body:has(#fold-all:checked) .sec-body { display: none }
#fold-all + label::before          { content: "⊟ Fold all" }
#fold-all:checked + label::before  { content: "⊞ Unfold all" }
```

## 按鈕列 (filter bar)

`core` ruler 在文件最前面注一段工具列 (checkbox 需排在所有目標之前;`:has()` 讓 label 位置自由):

```tree
.filter-bar { position: sticky; top: 0; z-index: 1 }
```

含 `#hide-done` + label、`#fold-all` + label;label 文字用 `::before content` 隨狀態切換 (對照 package.json 的 `todoFilterP0 / P0On` 兩態 swap)。

---

## 落地檔案

```tree
src/todoPreview/
├── sectionWrap.ts          # 純函式 wrapSections + 注 filter bar;可單測
└── index.ts                # createTodoPreviewExtension(): { extendMarkdownIt }
styles/todo-preview.css     # 上述 CSS
test/todoPreview.test.ts    # sectionWrap / filter-bar 純函式案例
```

`package.json`:把 `./styles/todo-preview.css` 加進 `markdown.previewStyles` 陣列。無新 command / view。

## 接線注意 (extension.ts)

目前 `activate()` 只 `return createTreePreviewExtension()`。要多掛一個 `extendMarkdownIt`,包一層依序套用:

```tree
activate() 回傳單一 { extendMarkdownIt(md) }
└── md ← treePreview.extendMarkdownIt ← todoPreview.extendMarkdownIt   # 依序套同一個 md
```

---

## 驗收 (Acceptance)

- 開 `README.todo` 預覽 → 見 sticky filter bar 兩顆按鈕。
- 按 `Hide done`:`- [x]`、刪除線項、`## Archive` 整區消失;再按回復。
- 點任一 section 標題:該節內容收合、caret 由 ▼ 變 ▶。
- 按 `Fold all`:全部 section 收合、按鈕變 `Unfold all`;再按全展開。
- `npm test`:`todoPreview.test.ts` 綠。

## 風險 / 相依

- `:has()` 需較新 Chromium 核 — VSCode ≥ 1.83 內建 Electron 已支援,與 `engines.vscode ^1.93.0` 相容。
- 內建預覽需開啟 task-list 渲染 (VSCode 預設有),否則 `- [x]` 不會產出 `input:checked` → 功能 1 的 checkbox 分支失效 (刪除線/Archive 分支不受影響)。
- fold-all 與單節獨立共存的缺口為已知取捨,見上方 Decision。
