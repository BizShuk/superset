#!/usr/bin/env bash
# Post-build: assert the produced VSIX is well-formed.
# Usage: bash scripts/verify-vsix.sh [path-to-vsix]
#
# Checks:
#   1. Upstream node-pty is bundled and both macOS spawn-helper files retain
#      executable POSIX modes.
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

# Build both a path listing and a mode-aware listing. The latter is necessary:
# `unzip -l` proves the helper exists but cannot catch the 0644 mode that makes
# node-pty fail with `posix_spawnp failed` on macOS.
# Use a tmp file to avoid SIGPIPE (grep -q exits early, closing the
# pipe while unzip is still writing — combined with `pipefail` this
# would mask the real exit code).
VSIX_LISTING=$(mktemp)
VSIX_MODE_LISTING=$(mktemp)
trap 'rm -f "$VSIX_LISTING" "$VSIX_MODE_LISTING"' EXIT
unzip -l "$VSIX" 2>/dev/null > "$VSIX_LISTING"
unzip -Z -l "$VSIX" 2>/dev/null > "$VSIX_MODE_LISTING"

# 1. node-pty runtime and macOS helper modes.
if ! grep -qF "extension/node_modules/node-pty/" "$VSIX_LISTING"; then
    echo "✗ extension/node_modules/node-pty missing in $VSIX" >&2
    exit 1
fi
if grep -qF "extension/node_modules/@homebridge/node-pty-prebuilt-multiarch/" "$VSIX_LISTING"; then
    echo "✗ Legacy @homebridge node-pty fork leaked into $VSIX" >&2
    exit 1
fi

for arch in darwin-x64 darwin-arm64; do
    helper="extension/node_modules/node-pty/prebuilds/$arch/spawn-helper"
    helper_row=$(awk -v helper="$helper" '$NF == helper { print; found = 1 } END { if (!found) exit 1 }' "$VSIX_MODE_LISTING") || {
        echo "✗ Required node-pty helper $helper missing in $VSIX" >&2
        exit 1
    }
    helper_mode=${helper_row%% *}
    if [[ "$helper_mode" != -rwx* ]]; then
        echo "✗ node-pty helper is not executable in $VSIX: $helper_mode $helper" >&2
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
