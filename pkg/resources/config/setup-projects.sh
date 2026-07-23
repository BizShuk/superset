#!/usr/bin/env bash
# Create the conventional ~/projects root and clone the standard BizShuk
# aggregation repositories. Existing repositories are never pulled or
# overwritten; their nested submodules are only synchronized and initialized.

set -u

if [[ $# -ne 1 ]]; then
    echo "Usage: setup-projects.sh <projects-root>" >&2
    exit 2
fi

PROJECTS_ROOT="$1"
REPOSITORIES=(
    "bizshuk/ai"
    "bizshuk/cc-plugin"
    "bizshuk/data"
    "bizshuk/env_setup"
    "bizshuk/game"
    "bizshuk/iphone"
    "bizshuk/platform"
    "bizshuk/playground"
    "bizshuk/product"
    "bizshuk/research"
    "bizshuk/social"
    "bizshuk/tools"
    "bizshuk/web"
)

if ! command -v git >/dev/null 2>&1; then
    echo "[error] git is required but was not found in PATH" >&2
    exit 1
fi

if ! mkdir -p "$PROJECTS_ROOT"; then
    echo "[error] could not create projects root: $PROJECTS_ROOT" >&2
    exit 1
fi

FAILURES=()

for repository in "${REPOSITORIES[@]}"; do
    name="${repository##*/}"
    target="$PROJECTS_ROOT/$name"
    url="https://github.com/$repository.git"

    if [[ -d "$target/.git" || -f "$target/.git" ]]; then
        echo "[exists] $target"
        if ! git -C "$target" submodule sync --recursive; then
            echo "[error] could not synchronize submodules: $repository" >&2
            FAILURES+=("$repository")
            continue
        fi
        if ! git -C "$target" submodule update --init --recursive; then
            echo "[error] could not initialize submodules: $repository" >&2
            FAILURES+=("$repository")
            continue
        fi
        echo "[ready]  $repository"
        continue
    fi

    if [[ -e "$target" || -L "$target" ]]; then
        echo "[error] target exists but is not a Git repository: $target" >&2
        FAILURES+=("$repository")
        continue
    fi

    echo "[clone]  $repository"
    if git clone --recurse-submodules "$url" "$target"; then
        echo "[ready]  $repository"
    else
        echo "[error] clone failed: $repository" >&2
        FAILURES+=("$repository")
    fi
done

if [[ ${#FAILURES[@]} -gt 0 ]]; then
    echo >&2
    echo "Projects setup completed with ${#FAILURES[@]} failure(s):" >&2
    for repository in "${FAILURES[@]}"; do
        echo "  - $repository" >&2
    done
    exit 1
fi

echo
echo "Projects setup complete: $PROJECTS_ROOT"
