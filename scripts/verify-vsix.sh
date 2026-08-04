#!/usr/bin/env bash
# Post-build: assert the produced VSIX is well-formed.
# Usage: bash scripts/verify-vsix.sh [path-to-vsix]
#
# Checks:
#   1. No native pseudoterminal binding is bundled — Superset uses VS Code's
#      own terminals and must stay free of platform-specific prebuilds.
#   2. No source, workspace metadata, debug symbols, or stale compiled output.
#   3. extension/package.json exists at the root of the extension folder.
#   4. Required pkg/resources payload exists and no legacy resources path leaks.
set -euo pipefail

VSIX="${1:-superset-*.vsix}"

if ! command -v unzip >/dev/null 2>&1; then
    echo "✗ unzip is required for VSIX verification" >&2
    exit 1
fi

# Resolve a single VSIX path even when the glob matches multiple files
# (e.g. after a previous failed build).
matches=()
while IFS= read -r match; do
    matches+=("$match")
done < <(compgen -G "$VSIX")
if [[ ${#matches[@]} -eq 0 ]]; then
    echo "✗ No VSIX matched pattern: $VSIX" >&2
    exit 1
fi
if [[ ${#matches[@]} -gt 1 ]]; then
    echo "✗ Multiple VSIX files matched: ${matches[*]}" >&2
    exit 1
fi
VSIX="${matches[0]}"

# Use a tmp file to avoid SIGPIPE (grep -q exits early, closing the
# pipe while unzip is still writing — combined with `pipefail` this
# would mask the real exit code).
VSIX_LISTING=$(mktemp)
trap 'rm -f "$VSIX_LISTING"' EXIT
unzip -l "$VSIX" 2>/dev/null > "$VSIX_LISTING"

# 1. No pseudoterminal binding. Superset opens VS Code's own terminals; a
# native pty package would drag per-platform prebuilds (and their executable-bit
# and rebuild failure modes) back into the VSIX.
for pty_pkg in \
    "extension/node_modules/node-pty/" \
    "extension/node_modules/@homebridge/node-pty-prebuilt-multiarch/"; do
    if grep -qF "$pty_pkg" "$VSIX_LISTING"; then
        echo "✗ Pseudoterminal binding $pty_pkg leaked into $VSIX" >&2
        exit 1
    fi
done

# 2. Dev-only paths must not appear inside the extension/ folder.

for forbidden in \
    test/ \
    src/ \
    plans/ \
    docs/ \
    .codegraphy/ \
    .codex/ \
    .githooks/ \
    .vscode/; do
    if grep -qE "extension/$forbidden" "$VSIX_LISTING"; then
        echo "✗ Forbidden path extension/$forbidden leaked into $VSIX" >&2
        exit 1
    fi
done

for forbidden_file in \
    .claudeignore \
    .geminiignore \
    ecosystem.config.js \
    run.sh; do
    if grep -qE "extension/${forbidden_file}$" "$VSIX_LISTING"; then
        echo "✗ Forbidden file extension/$forbidden_file leaked into $VSIX" >&2
        exit 1
    fi
done

if grep -qE 'extension/node_modules/.*\.pdb$' "$VSIX_LISTING"; then
    echo "✗ Native debug symbols leaked into $VSIX" >&2
    exit 1
fi

for extraneous in @emnapi/ tslib/; do
    if grep -qF "extension/node_modules/$extraneous" "$VSIX_LISTING"; then
        echo "✗ Extraneous package $extraneous leaked into $VSIX" >&2
        exit 1
    fi
done

# A clean compile must not retain JavaScript emitted from a source file that
# has since been removed. This catches stale modules even when their folder
# name is not known in advance.
while IFS= read -r compiled_path; do
    relative_path="${compiled_path#extension/out/}"
    source_path="src/${relative_path%.js}.ts"
    source_tsx="${source_path%.ts}.tsx"
    if [[ ! -f "$source_path" && ! -f "$source_tsx" ]]; then
        echo "✗ Stale compiled file $compiled_path has no source" >&2
        exit 1
    fi
done < <(awk '$NF ~ /^extension\/out\/.*\.js$/ { print $NF }' "$VSIX_LISTING")

# 3. extension/package.json must exist.
if ! grep -qE "extension/package\.json$" "$VSIX_LISTING"; then
    echo "✗ extension/package.json missing in $VSIX" >&2
    exit 1
fi

# 4. Runtime templates and icons must be packaged from pkg/resources.
required_resources=(
    "extension/pkg/resources/icon.png"
    "extension/pkg/resources/config/.ignore"
    "extension/pkg/resources/config/install-default-project.sh"
    "extension/pkg/resources/config/setup-projects.sh"
    "extension/pkg/resources/git/githooks/scripts/sync-plugin-version.sh"
)

for required in "${required_resources[@]}"; do
    if ! grep -qF "$required" "$VSIX_LISTING"; then
        echo "✗ Required resource $required missing in $VSIX" >&2
        exit 1
    fi
done

if grep -qE "extension/resources/" "$VSIX_LISTING"; then
    echo "✗ Legacy extension/resources/ path leaked into $VSIX" >&2
    exit 1
fi

VSIX_SIZE=$(stat -f%z "$VSIX" 2>/dev/null || stat -c%s "$VSIX")
echo "✓ $VSIX ($VSIX_SIZE bytes) verified — no dev paths, package.json present"
