#!/usr/bin/env bash
# Seed the agent-session fixture matrix into the sessiond store, so the
# Sessions panel has something to render before the Go ingestor (and its
# unverified gemma summary path) is wired up.
#
# The fixtures themselves live in `src/sessions/sampleData.ts` — this script
# only drives the compiled module, so the matrix has exactly one definition
# and the panel, the tests and this script all see the same data.
#
#   ./scripts/seed-sessions.sh                    # seed the current repo
#   ./scripts/seed-sessions.sh -w ~/projects/foo  # seed another workspace
#   ./scripts/seed-sessions.sh -d /tmp/store      # write to a scratch store
#   ./scripts/seed-sessions.sh -l                 # list what is stored, no write
#   ./scripts/seed-sessions.sh -c                 # remove sample-*.jsonl only
#
# Only files named `sample-*.jsonl` are ever written or removed; sessions
# produced by a real `sessiond hook` run are never touched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE=""
DATA_DIR=""
MODE="seed"

usage() {
    # The header comment IS the help text — print it up to the first
    # non-comment line so the two can never drift apart.
    awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' \
        "${BASH_SOURCE[0]}"
    exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -w|--workspace) WORKSPACE="${2:?--workspace needs a path}"; shift 2 ;;
        -d|--data-dir)  DATA_DIR="${2:?--data-dir needs a path}"; shift 2 ;;
        -c|--clear)     MODE="clear"; shift ;;
        -l|--list)      MODE="list"; shift ;;
        -h|--help)      usage 0 ;;
        *) echo "✗ unknown argument: $1" >&2; usage 1 ;;
    esac
done

# Default to the workspace this repo IS — the common case is "let me see the
# panel in the editor I have open right here".
WORKSPACE="${WORKSPACE:-$REPO_ROOT}"
if [[ ! -d "$WORKSPACE" ]]; then
    echo "✗ workspace is not a directory: $WORKSPACE" >&2
    exit 1
fi
# The store keys on an absolute path; a relative one would encode to a
# segment the extension never looks up.
WORKSPACE="$(cd "$WORKSPACE" && pwd)"

if ! command -v node >/dev/null 2>&1; then
    echo "✗ node is required" >&2
    exit 1
fi

# The fixtures ship as TypeScript, so an out/ build must exist. Build it on
# demand rather than failing — this script is most useful on a fresh clone.
if [[ ! -f "$REPO_ROOT/out/sessions/sampleData.js" ]]; then
    echo "ℹ out/ missing — compiling (npx tsc)…"
    (cd "$REPO_ROOT" && npx tsc)
fi

export SUPERSET_WORKSPACE="$WORKSPACE"
export SUPERSET_DATA_DIR="$DATA_DIR"
export SUPERSET_MODE="$MODE"
export SUPERSET_OUT="$REPO_ROOT/out"

node <<'NODE'
const path = require("path");
const out = process.env.SUPERSET_OUT;
const { clearSampleSessions, sampleCoverage, writeSampleSessions } = require(
    path.join(out, "sessions", "sampleData.js")
);
const { listSessions, workspaceSessionsDir } = require(
    path.join(out, "sessions", "store.js")
);
const { buildSessionRow } = require(path.join(out, "sessions", "treeSpec.js"));

const workspace = process.env.SUPERSET_WORKSPACE;
const dataDir = process.env.SUPERSET_DATA_DIR || undefined;
const mode = process.env.SUPERSET_MODE;
const dir = workspaceSessionsDir(workspace, dataDir);

if (mode === "clear") {
    console.log(`✓ removed ${clearSampleSessions(workspace, dataDir)} sample session(s)`);
    console.log(`  ${dir}`);
    process.exit(0);
}

if (mode === "seed") {
    // Clear first so a shrunk matrix does not leave orphans behind.
    clearSampleSessions(workspace, dataDir);
    const written = writeSampleSessions(workspace, Date.now(), dataDir);
    console.log(`✓ seeded ${written.length} sample session(s)`);
    console.log(`  ${dir}\n`);
    console.log("Coverage:");
    for (const line of sampleCoverage()) console.log(`  · ${line}`);
    console.log("");
}

const records = listSessions(workspace, dataDir);
if (records.length === 0) {
    console.log(`(no sessions stored for ${workspace})`);
    process.exit(0);
}

const now = Date.now();
const rows = records.map((r) => {
    const spec = buildSessionRow(r, now);
    return [`[${r.meta.agent}]`, spec.label, spec.description];
});
// Pad on display width (CJK titles are double-width) so the columns line up
// in a terminal instead of drifting one cell per wide character.
const width = (s) => [...s].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const pad = (s, w) => s + " ".repeat(Math.max(0, w - width(s)));
const w0 = Math.max(...rows.map((r) => width(r[0])));
const w1 = Math.max(...rows.map((r) => width(r[1])));
console.log(`${records.length} session(s) in store:`);
for (const [agent, label, desc] of rows) {
    console.log(`  ${pad(agent, w0)}  ${pad(label, w1)}  ${desc}`);
}
NODE
