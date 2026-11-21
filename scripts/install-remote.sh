#!/usr/bin/env bash
# Install the latest GitHub Release VSIX into the local agy-ide.
set -euo pipefail

RELEASE_URL="https://github.com/BizShuk/superset/releases/latest/download/superset.vsix"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
vsix="$tmp_dir/superset.vsix"

echo "Downloading $RELEASE_URL"
curl -fsSL --retry 3 -o "$vsix" "$RELEASE_URL"
unzip -tq "$vsix" >/dev/null
unzip -p "$vsix" extension/package.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log("Release version: "+JSON.parse(s).version))'

agy-ide --install-extension "$vsix" --force
