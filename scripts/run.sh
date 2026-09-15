#!/bin/bash
# run:setup — 冪等 (idempotent) 的前置作業，不啟動任何服務。
# 建置與打包是 `npm run build`，測試是 `npm run test`。
set -euo pipefail
cd "$(dirname "$0")/.."

# fresh clone 之後要能直接 build / test 與在編輯器內取得型別，依賴是唯一前置條件。
npm ci

echo "setup 完成；建置 VSIX 用 npm run build"
