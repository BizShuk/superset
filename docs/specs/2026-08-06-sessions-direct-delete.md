# Sessions 直接刪除 (Direct Delete)

## 結果 (Outcome)

`Sessions View` 的 `Delete Session` 會直接刪除所選 backing JSONL，不再顯示
confirmation popup。一般 ingest session 與 sample session 使用相同的單筆刪除行為。

## 契約 (Contract)

- 刪除目標必須是 configured Sessions store 內的 `.jsonl`。
- Sessions store 外的 path 與非 JSONL target 一律拒絕。
- 刪除成功後立即刷新 `Sessions View` 與已開啟的 summary。
- 刪除失敗時保留原檔並顯示 error notification。
- `Clear Sample Sessions` 仍是獨立的 bulk cleanup，只處理 `sample-*.jsonl`。

## 驗證 (Verification)

- Regression test 覆蓋 UUID ingest session 的單筆刪除與 cache eviction。
- Regression test 覆蓋 store boundary，確認 outside path 不會被刪除。
- Command test 覆蓋直接刪除流程，確認不呼叫 confirmation popup。
