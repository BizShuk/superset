# Skill Install Expanded Repository List

## 狀態

已實作。

## 行為

`Superset: Install Skills` 保留原本三個 repository 與既有順序，並在其後加入五個
skill repository：

| 顯示名稱 | 用途 | GitHub repository |
| --- | --- | --- |
| `awesome-claude-code-subagents` | 涵蓋多種開發任務的 Claude Code 專用 Subagents 合集 | `VoltAgent/awesome-claude-code-subagents` |
| `superpowers` | 以 Skills 驅動規劃、TDD、除錯與協作的開發方法 | `obra/superpowers` |
| `understand-anything` | 把程式碼與文件轉成可搜尋、可提問的互動知識圖譜 | `Egonex-AI/Understand-Anything` |
| `last30days` | 彙整近 30 天社群與網路討論，產出有來源的研究摘要 | `mvanhorn/last30days-skill` |
| `ui-ux-pro-max-skill` | 為多平台 UI/UX 產生設計系統、樣式與實作建議 | `nextlevelbuilder/ui-ux-pro-max-skill` |

全部八個 Quick Pick 項目都以簡短用途作為 `description`，並以
`GitHub · <repository>` 作為第二列 `detail`。用途與 repository 都可參與搜尋。
`bizshuk/cc-plugin` 維持第一項與預設選擇。

## 執行契約

選取新增項目後，Run Terminal 執行 `skills add <GitHub repository>`，不使用顯示名稱
取代 repository identifier。

## 驗證契約

`test/installCommands.test.ts` 固定完整 repository 順序、全部項目的用途 description、
GitHub detail、搜尋選項，以及新增項目的實際安裝 repository 對應。
