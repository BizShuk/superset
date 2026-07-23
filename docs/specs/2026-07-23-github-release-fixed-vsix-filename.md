# GitHub Release 固定 VSIX 檔名

## 狀態

已實作。

## 發布契約

`.github/workflows/release.yml` 仍由 `npm run build` 產生版本化的
`superset-<version>.vsix`，並要求工作目錄中恰好只有一個符合的產物。建立
GitHub Release 前，workflow 將該產物改名為固定的 `superset.vsix`。

GitHub Release 只上傳這一個 `superset.vsix` asset，不上傳其他 build 產物。
固定檔名讓安裝指令與自動下載流程不必先解析 package version；release tag 與
`package.json` version 完全相符的既有檢查維持不變。

## 驗證契約

`test/releaseWorkflow.test.ts` 鎖定 workflow 的改名步驟與
`gh release create` asset 參數，防止發布檔名退回版本化名稱。
