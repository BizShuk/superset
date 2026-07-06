#!/usr/bin/env bash
# =============================================================================
#  install-ignore.sh — 把 resources/config/.ignore 部署成 .gitignore +
#                     .geminiignore + .claudeignore 的工作區安裝器
#
#  用法 (從 repo 根目錄):
#      bash resources/config/install-ignore.sh              # 全部三個都裝
#      bash resources/config/install-ignore.sh git gemini  # 選特定的
#      bash resources/config/install-ignore.sh --force      # 覆蓋既有檔案
#      bash resources/config/install-ignore.sh --print     # 印內容到 stdout
#
#  安裝目標:
#    .gitignore      (git, 全套規則)
#    .geminiignore   (Gemini CLI / Code Assist, 全套規則)
#    .claudeignore   (Claude Code LLM 語境, 排除 .claude/ 自身以外的規則)
#
#  行為:
#    - 若目標檔已存在且未傳 --force → 跳過(不覆蓋)
#    - 首次安裝 → 寫入完整 .ignore 內容
#    - --print 模式只把內容印到 stdout, 不在磁碟上寫任何東西
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/.ignore"

usage() {
  cat <<'EOF'
Usage: install-ignore.sh [TARGETS...] [--force] [--print] [--help]

TARGETS:
  git      install .gitignore
  gemini   install .geminiignore
  claude   install .claudeignore
  (none)   → install all three

Flags:
  --force   overwrite existing target files
  --print   print resolved template to stdout, no filesystem writes
  --help    show this help
EOF
}

# ── arg parse ────────────────────────────────────────────────────────────────
FORCE=0
PRINT=0
TARGETS=()

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --print) PRINT=1 ;;
    --help|-h) usage; exit 0 ;;
    git|gemini|claude) TARGETS+=("$arg") ;;
    *) echo "Unknown arg: $arg" >&2; usage; exit 2 ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=(git gemini claude)
fi

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Template not found: $TEMPLATE" >&2
  exit 1
fi

# ── --print mode ─────────────────────────────────────────────────────────────
if [[ $PRINT -eq 1 ]]; then
  cat "$TEMPLATE"
  exit 0
fi

# ── install per target ───────────────────────────────────────────────────────
# 用 case 而不是 associative array, 維持 POSIX 兼容 (macOS 預設 sh 沒有 -A)

for target in "${TARGETS[@]}"; do
  case "$target" in
    git)    out=.gitignore ;;
    gemini) out=.geminiignore ;;
    claude) out=.claudeignore ;;
    *)
      echo "[err]  unknown target: $target" >&2
      continue
      ;;
  esac

  if [[ -e "$out" && $FORCE -eq 0 ]]; then
    echo "[skip]  $out  (already exists; use --force to overwrite)"
    continue
  fi

  cp "$TEMPLATE" "$out"
  echo "[write] $out  ($(wc -l < "$TEMPLATE") lines, target=$target)"
done

# ── 結尾說明 ────────────────────────────────────────────────────────────────
# .gitignore 用 git 讀; .geminiignore / .claudeignore 通常是 LLM 層用 glob 過濾
# 語意上跟 .gitignore 幾乎一樣, 但若專案要給 LLM 看到原始碼, 反而要 *放寬*:
#   - .claudeignore 預設已忽略 .claude/ 自己的目錄(內含 settings.local.json 等雜訊)
#   - 若想保留套件原始碼供 LLM 讀, 把 node_modules 從該檔移除即可
#     (本模板沒列 node_modules 在 .claudeignore 內忽略清單, 而 LLM 客戶端通常
#      自帶排除 node_modules — 維持一致行為)

cat <<'NOTE'

✓ Done. Summary:
NOTE
ls -la .gitignore .geminiignore .claudeignore 2>/dev/null || true
