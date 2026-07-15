#!/usr/bin/env bash
# =============================================================================
#  install-default-project.sh — 部署工作區預設結構與設定的安裝器
#
#  功能:
#    1. 把 resources/config/.ignore 部署成 .gitignore + .geminiignore + .claudeignore
#    2. 建立預設資料夾 (docs/tutorials, docs/backlog/, docs/specs/, plans/, pkg/, config/, cmd/, .vscode/)
#    3. 建立 AGENTS.md 指向 CLAUDE.md 的軟連結
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="${SCRIPT_DIR}/.ignore"

usage() {
  cat <<'EOF'
Usage: install-default-project.sh [TARGETS...] [--force] [--print] [--help]

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

# ── install ignore templates per target ───────────────────────────────────────
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

# ── create default folders ───────────────────────────────────────────────────
echo "[mkdir] creating default folders..."
mkdir -p docs/tutorials docs/backlog docs/specs plans pkg config cmd .vscode

# ── create default symbolic link AGENTS.md -> CLAUDE.md ──────────────────────
if [[ ! -e CLAUDE.md ]]; then
  echo "[info] CLAUDE.md does not exist, creating a default one..."
  cat <<'EOF' > CLAUDE.md
# CLAUDE.md
EOF
fi

if [[ ( -L AGENTS.md || -e AGENTS.md ) && $FORCE -eq 0 ]]; then
  echo "[skip]  AGENTS.md  (already exists; use --force to overwrite)"
else
  ln -sf CLAUDE.md AGENTS.md
  echo "[write] symlink AGENTS.md -> CLAUDE.md"
fi

cat <<'NOTE'

✓ Done. Default project initialized.
NOTE
ls -la .gitignore .geminiignore .claudeignore AGENTS.md 2>/dev/null || true
