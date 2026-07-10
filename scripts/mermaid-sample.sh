#!/usr/bin/env bash
# Echoes a Mermaid block prefixed with the standalone `mermaid` trigger
# keyword so the terminal link provider detects it. Pipe into a terminal
# or just run it in one — the `mermaid` word on line 1 becomes a
# clickable link (hover shows "Mermaid preview").
#
#   ./scripts/mermaid-sample.sh
#   ./scripts/mermaid-sample.sh | cat   # still triggers detection

set -euo pipefail

cat <<'EOF'
mermaid
flowchart TD
    A["開始 (Start)"] --> B{"有 mermaid 關鍵字?"}
    B -->|"是"| C["觸發連結"]
    B -->|"否"| D["不觸發"]
    C --> E["hover 顯示 Mermaid preview"]
    E --> F["點擊開預覽"]
    D --> A

EOF
