#!/bin/bash
# 預設執行程序：建置並打包擴充功能，同時執行單元測試。
set -e

echo "=== 安裝相依套件與建置專案 ==="
npm run build

echo "=== 執行單元測試 ==="
npm test

echo "=== 專案建置與驗證成功 ==="
