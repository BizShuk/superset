# 2026-08-10 — 移除 planner pm2 任務

`ecosystem.config.js` 原本註冊一個 `agy-superset-system` cron 任務（每日 0-9 時的第 50 分），
呼叫 `agy` 對本 repo 跑 `/system-planner`。本次移除整個檔案。

## 路徑指向一個不存在的目錄

任務的 `cwd` 與 `--add-dir` 都是 `/Users/shuk/projects/tmp/superset`。
Superset 實際在 `platform/superset`，`~/projects/tmp/` 根本不存在。
這支任務從未被 `pm2 apply` 註冊，所以錯誤也從未浮現。

`教訓`：`ecosystem.config.js` 是`宣告`不是`事實`。稽核背景任務要看 `pm2 list`，
不是看 repo 裡有沒有這個檔。統一介面把它列為`選備`就是這個意思——
沒有常駐程序的 repo 不該有這個檔。

## Superset 為什麼不需要它

Superset 是 VS Code 擴充功能，生命週期由 VS Code 的 extension host 擁有：
啟動、停用、重載都是 IDE 的事。這裡`沒有任何`可以由 pm2 看顧的常駐程序。
唯一曾經合理的用途是「定時對自己跑 planner」，而那是`開發流程`不是`產品執行`，
不該以 repo 內的 runtime config 形式存在。

## 相關

- 同一天同樣理由移除了 `gosdk/ecosystem.config.js`（`agy-gosdk-system`）。
