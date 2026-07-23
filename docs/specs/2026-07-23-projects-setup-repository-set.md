# Projects Setup Repository Set

## 狀態

已實作。

## Repository set

`Superset: Projects Setup` 依下列固定順序處理 `13` 個 BizShuk repositories：

1. `bizshuk/ai`
2. `bizshuk/cc-plugin`
3. `bizshuk/data`
4. `bizshuk/env_setup`
5. `bizshuk/game`
6. `bizshuk/iphone`
7. `bizshuk/platform`
8. `bizshuk/playground`
9. `bizshuk/product`
10. `bizshuk/research`
11. `bizshuk/social`
12. `bizshuk/tools`
13. `bizshuk/web`

Runtime source of truth 是
`pkg/resources/config/setup-projects.sh#REPOSITORIES`。本次在既有 repository set
加入 `bizshuk/social`，並固定上述處理順序；原始 command ID
`superset.projectsSetup` 與 `~/projects` root 契約不變。

## Submodule 契約

- 缺少的 repository 使用 `git clone --recurse-submodules`，在 clone 時初始化全部
  recursive submodules。
- 已存在的 Git repository 依序執行 `git submodule sync --recursive` 與
  `git submodule update --init --recursive`。
- 已存在的 repository 不會被 pull、reset 或覆蓋。
- 同名非 Git 路徑保留原狀並記錄失敗，其餘 repositories 繼續處理。

## 驗證契約

`test/projectsSetupScript.test.ts` 固定完整 repository 順序，並驗證 missing、
existing Git 與同名非 Git target 三種路徑。測試同時鎖定 recursive clone 與
recursive submodule sync/update 行為。
